// script expects Appwrite UMD to be loaded via a <script src="https://cdn.jsdelivr.net/npm/appwrite@21.4.0"></script>
document.addEventListener('DOMContentLoaded', () => {
	const PolyTask = (function () {
		// --- config & state -------------------------------------------------
		const APPWRITE_ENDPOINT = window.APPWRITE_ENDPOINT || 'https://nyc.cloud.appwrite.io/v1';
		// Hard-coded Appwrite project ID — replace with your real project id
		const APPWRITE_PROJECT = window.APPWRITE_PROJECT || 'polytask';
		const APPWRITE_DATABASE = window.APPWRITE_DATABASE || window.APPWRITE_DATABASE_ID || 'events';

		let cachedUserId = null;
		let AppwriteModule = null;
		let currentDay = startOfDay(new Date());

		async function invokeWithCompat(target, methodName, legacyArgs = [], modernPayload) {
			const fn = target && typeof target[methodName] === 'function' ? target[methodName] : null;
			if (!fn) return { called: false, value: undefined };
			const arity = Number.isInteger(fn.length) ? fn.length : legacyArgs.length;
			const value = arity <= 1
				? await fn.call(target, modernPayload !== undefined ? modernPayload : legacyArgs[0])
				: await fn.apply(target, legacyArgs);
			return { called: true, value };
		}

		// --- small helpers --------------------------------------------------
		function showFormError(form, msg) {
			if (!form) return;
			const el = form.querySelector('#formError') || form.querySelector('#pwMismatch');
			if (el) {
				el.style.display = msg ? 'block' : 'none';
				el.textContent = msg || '';
			} else if (msg) alert(msg);
		}

		async function ensureAppwriteClient() {
			// Expect the Appwrite UMD global (window.Appwrite) to be present because
			// the SDK is included directly in the HTML via CDN.
			if (typeof window !== 'undefined' && window.Appwrite) {
				AppwriteModule = window.Appwrite;
				return new AppwriteModule.Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT);
			}
			console.error('Appwrite SDK not found on window. Please include the CDN script before script.js: <script src="https://cdn.jsdelivr.net/npm/appwrite@21.4.0"></script>');
			throw new Error('Appwrite SDK not loaded');
		}

		function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }

		// --- collection management ------------------------------------------
		async function ensureUserCollection(userId) {
			if (!userId) throw new Error('User ID required to ensure collection');
			const client = await ensureAppwriteClient();
			const App = AppwriteModule;
			const db = new App.Databases(client);
			
			// Check if collection exists
			try {
				const existing = await invokeWithCompat(db, 'getCollection', [APPWRITE_DATABASE, userId], {
					databaseId: APPWRITE_DATABASE,
					collectionId: userId
				});
				if (existing.called && existing.value) {
					console.log(`Collection ${userId} already exists`);
					return existing.value;
				}
				// Try legacy signature
				const col = await db.getCollection(APPWRITE_DATABASE, userId);
				if (col) {
					console.log(`Collection ${userId} already exists`);
					return col;
				}
			} catch (err) {
				// Collection doesn't exist, create it
				console.log(`Collection ${userId} not found, creating...`);
			}

			// Create collection with user ID as collection ID and set permissions
			// Permissions: allow the owner (user) to read, create, update, and delete their own documents
			const permissions = [
				`read("user:${userId}")`,
				`create("user:${userId}")`,
				`update("user:${userId}")`,
				`delete("user:${userId}")`
			];
			
			const created = await invokeWithCompat(db, 'createCollection', [APPWRITE_DATABASE, userId, userId, permissions, false], {
				databaseId: APPWRITE_DATABASE,
				collectionId: userId,
				name: userId,
				permissions: permissions,
				documentSecurity: false
			});
			const collection = created.called ? created.value : await db.createCollection(APPWRITE_DATABASE, userId, userId, permissions, false);
			console.log(`Created collection ${userId} with permissions:`, permissions);

			// Create attributes matching existing schema: due, assigned, category, color, name
			// due (datetime, required)
			await invokeWithCompat(db, 'createDatetimeAttribute', [APPWRITE_DATABASE, userId, 'due', true], {
				databaseId: APPWRITE_DATABASE,
				collectionId: userId,
				key: 'due',
				required: true
			});

			// assigned (datetime, optional)
			await invokeWithCompat(db, 'createDatetimeAttribute', [APPWRITE_DATABASE, userId, 'assigned', false], {
				databaseId: APPWRITE_DATABASE,
				collectionId: userId,
				key: 'assigned',
				required: false
			});

			// category (string, optional, size 20)
			await invokeWithCompat(db, 'createStringAttribute', [APPWRITE_DATABASE, userId, 'category', 20, false], {
				databaseId: APPWRITE_DATABASE,
				collectionId: userId,
				key: 'category',
				size: 20,
				required: false
			});

			// color (string, optional, size 20, default 'cadet')
			await invokeWithCompat(db, 'createStringAttribute', [APPWRITE_DATABASE, userId, 'color', 20, false, 'cadet'], {
				databaseId: APPWRITE_DATABASE,
				collectionId: userId,
				key: 'color',
				size: 20,
				required: false,
				default: 'cadet'
			});

			// name (string, required, size 50)
			await invokeWithCompat(db, 'createStringAttribute', [APPWRITE_DATABASE, userId, 'name', 50, true], {
				databaseId: APPWRITE_DATABASE,
				collectionId: userId,
				key: 'name',
				size: 50,
				required: true
			});

			// estimateMinutes (integer, optional, min 1)
			try {
				await invokeWithCompat(db, 'createIntegerAttribute', [APPWRITE_DATABASE, userId, 'estimateMinutes', false, 1], {
					databaseId: APPWRITE_DATABASE,
					collectionId: userId,
					key: 'estimateMinutes',
					required: false,
					min: 1
				});
			} catch (e) {
				// ignore if already exists or if backend rejects optional bounds signature
			}

			console.log(`Created attributes for collection ${userId}`);
			return collection;
		}

		// --- auth helpers --------------------------------------------------
		async function getCurrentUserId() {
			if (cachedUserId) return cachedUserId;
			try {
				const client = await ensureAppwriteClient();
				const App = AppwriteModule || (typeof window !== 'undefined' && window.Appwrite) || null;
				if (!App) return null;
				const account = new App.Account(client);
				const u = await account.get();
				cachedUserId = u && (u.$id || u.$uid || u.id);
				return cachedUserId || null;
			} catch (err) {
				// common reasons: not authenticated or network/CORS issues
				console.warn('Could not get current Appwrite user:', err && err.message ? err.message : err);
				return null;
			}
		}

		// --- db helpers ----------------------------------------------------
		async function listUserTasks() {
			const userId = await getCurrentUserId();
			if (!userId) return [];
			const client = await ensureAppwriteClient();
			const App = AppwriteModule;
			const db = new App.Databases(client);
			if (!App.Query || typeof db.listDocuments !== 'function') throw new Error('Appwrite Databases.listDocuments or Query not available');
			// Use userId as collection ID
			const modern = await invokeWithCompat(db, 'listDocuments', [APPWRITE_DATABASE, userId], {
				databaseId: APPWRITE_DATABASE,
				collectionId: userId
			});
			const res = modern.called ? modern.value : await db.listDocuments(APPWRITE_DATABASE, userId);
			return (res && res.documents) || [];
		}

		async function createUserTask(data) {
			const userId = await getCurrentUserId();
			if (!userId) throw new Error('User not authenticated');
			const client = await ensureAppwriteClient();
			const App = AppwriteModule;
			const db = new App.Databases(client);
			// No need for ownerId - each user has their own collection
			if (typeof db.createDocument !== 'function') throw new Error('Appwrite Databases.createDocument not available');
			const uniqueId = App.ID && typeof App.ID.unique === 'function' ? App.ID.unique() : 'unique()';
			// Use userId as collection ID
			const created = await invokeWithCompat(db, 'createDocument', [APPWRITE_DATABASE, userId, uniqueId, data], {
				databaseId: APPWRITE_DATABASE,
				collectionId: userId,
				documentId: uniqueId,
				data: data
			});
			if (created.called) return created.value;
			return await db.createDocument(APPWRITE_DATABASE, userId, uniqueId, data);
		}

		// --- calendar rendering --------------------------------------------
		function startOfDay(date) { const d = new Date(date); d.setHours(0,0,0,0); return d; }
		function formatDateISO(d) { return d.toISOString().slice(0,10); }
		function friendlyDayLabel(d) { return d.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' }); }

		async function loadAndRender() {
			const calendarEl = document.getElementById('calendar');
			if (!calendarEl) return;
			const display = document.getElementById('currentDateDisplay');
			if (display) display.textContent = friendlyDayLabel(currentDay);
			calendarEl.innerHTML = '<p>Loading tasks...</p>';
			let docs = [];
			try { docs = await listUserTasks(); } catch (err) { console.error('Could not list tasks', err); }
			const tasks = (docs || []).map(d => {
				const preferred = d.assigned || d.due; // prefer assigned; fallback to due
				const dateStr = preferred ? String(preferred).slice(0,10) : '';
				return {
					id: d.$id || d.$uid || d.id || '',
					title: d.name || '',
					date: dateStr,
					category: d.category || '',
					color: d.color || 'cadet',
					estimateMinutes: typeof d.estimateMinutes === 'number' ? d.estimateMinutes : null
				};
			});
			renderCalendar(tasks);
		}

		function renderCalendar(tasks) {
			const calendarEl = document.getElementById('calendar');
			if (!calendarEl) return;
			const byDate = {};
			tasks.forEach(t => { if (!t.date) return; const key = t.date.slice(0,10); (byDate[key] || (byDate[key]=[])).push(t); });
			const key = formatDateISO(currentDay);
			calendarEl.innerHTML = '';
			// wrapper for the day (no inner boxed card so times appear inside the main card)
			const wrapper = document.createElement('div'); wrapper.className = 'calendar-inner';
			const header = document.createElement('div'); header.style.display = 'flex'; header.style.justifyContent = 'space-between'; header.style.alignItems = 'center';
			header.innerHTML = `<strong>${friendlyDayLabel(currentDay)}</strong><small>${key}</small>`;
			wrapper.appendChild(header);
			// day grid: left times, right events
			const dayGrid = document.createElement('div'); dayGrid.className = 'day-grid';
			const timeCol = document.createElement('div'); timeCol.className = 'time-column';
			for (let h = 0; h < 24; h++) {
				const slot = document.createElement('div'); slot.className = 'time-slot';
				const hh = String(h).padStart(2,'0'); slot.textContent = hh + ':00';
				timeCol.appendChild(slot);
			}
			const eventsCol = document.createElement('div'); eventsCol.className = 'events-column';
			const list = document.createElement('div'); list.style.marginTop = '12px';
			const items = byDate[key] || [];
			if (!items.length) {
				const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No tasks for this day'; list.appendChild(empty);
			} else {
				items.forEach(it => {
					const card = document.createElement('div'); card.className = 'event-card';
					card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;"><div><strong>${escapeHtml(it.title)}</strong>${it.category ? `<div style="font-size:0.85rem;opacity:.8">${escapeHtml(it.category)}</div>` : ''}</div></div>`;
					list.appendChild(card);
				});
			}
			eventsCol.appendChild(list);
			dayGrid.appendChild(timeCol);
			dayGrid.appendChild(eventsCol);
			wrapper.appendChild(dayGrid);
			calendarEl.appendChild(wrapper);
		}

		// --- UI wiring -----------------------------------------------------
		function initPasswordToggles() {
			document.querySelectorAll('.toggle-btn[data-toggle], #togglePassword').forEach(btn => {
				btn.addEventListener('click', () => {
					const targetId = btn.dataset.toggle || 'password';
					const pwd = document.getElementById(targetId); if (!pwd) return;
					const isPassword = pwd.type === 'password'; pwd.type = isPassword ? 'text' : 'password';
					btn.setAttribute('aria-pressed', String(isPassword)); btn.textContent = isPassword ? 'Hide' : 'Show';
				});
			});
		}

		function initAuthHandlers() {
			const loginForm = document.getElementById('loginForm');
			if (loginForm) loginForm.addEventListener('submit', async (e) => {
				e.preventDefault(); showFormError(loginForm,'');
				const email = (document.getElementById('email')||{}).value || ''; const password = (document.getElementById('password')||{}).value || '';
				if (!email || !password) return showFormError(loginForm,'Please enter email and password.');
				try {
					const client = await ensureAppwriteClient(); const App = AppwriteModule; const account = new App.Account(client);
					let handled = false;
					const modern = await invokeWithCompat(account, 'createEmailPasswordSession', [email, password], { email, password });
					if (modern.called) handled = true;
					if (!handled) {
						const legacy = await invokeWithCompat(account, 'createEmailSession', [email, password], { email, password });
						handled = legacy.called;
					}
					if (!handled && typeof account.createSession === 'function' && account.createSession.length > 1) {
						await account.createSession(email, password);
						handled = true;
					}
					if (!handled) throw new Error('Appwrite session method missing');
					
					// Get user ID and ensure their collection exists
					cachedUserId = null; // Clear cache to force fresh fetch
					const userId = await getCurrentUserId();
					if (userId) {
						try {
							await ensureUserCollection(userId);
						} catch (collErr) {
							console.warn('Could not ensure user collection:', collErr);
						}
					}
					
					window.location.href = '/home';
				} catch (err) { console.error('Login error',err); showFormError(loginForm, err.message || 'Sign in failed'); }
			});

			const signupForm = document.getElementById('signupForm');
			if (!signupForm) return;
			const pwd = document.getElementById('password'); const confirm = document.getElementById('confirmPassword'); const submitBtn = document.getElementById('submitBtn'); const pwMismatch = document.getElementById('pwMismatch');
			function validate(){ const match = pwd && confirm && pwd.value && confirm.value && pwd.value === confirm.value; const terms = !!(document.getElementById('terms')||{}).checked; if (pwMismatch) pwMismatch.style.display = match ? 'none' : 'block'; if (submitBtn) submitBtn.disabled = !(match && terms); }
			[pwd,confirm].forEach(el => el && el.addEventListener('input', validate)); const terms = document.getElementById('terms'); if (terms) terms.addEventListener('change', validate);
			signupForm.addEventListener('submit', async (e) => {
				e.preventDefault(); showFormError(signupForm,'');
				const fullName = (document.getElementById('fullName')||{}).value||''; const email = (document.getElementById('email')||{}).value||''; const passwordVal = (document.getElementById('password')||{}).value||''; const confirmVal = (document.getElementById('confirmPassword')||{}).value||''; const termsChecked = !!(document.getElementById('terms')||{}).checked;
				if (!email || !passwordVal || !confirmVal) return showFormError(signupForm,'Please complete all fields.'); if (passwordVal !== confirmVal) return showFormError(signupForm,'Passwords do not match.'); if (!termsChecked) return showFormError(signupForm,'You must accept the terms.');
				try {
					const client = await ensureAppwriteClient(); const App = AppwriteModule; const account = new App.Account(client);
					const desiredId = App.ID && typeof App.ID.unique === 'function' ? App.ID.unique() : 'unique()';
					let created = await invokeWithCompat(account, 'create', [desiredId, email, passwordVal, fullName], {
						userId: desiredId,
						email,
						password: passwordVal,
						name: fullName
					});
					if (!created.called) {
						created = await invokeWithCompat(account, 'createAccount', [email, passwordVal, fullName], {
							email,
							password: passwordVal,
							name: fullName
						});
					}
					if (!created.called) throw new Error('Account create not available');
					const session = await invokeWithCompat(account, 'createEmailPasswordSession', [email, passwordVal], { email, password: passwordVal });
					if (!session.called) {
						const legacy = await invokeWithCompat(account, 'createEmailSession', [email, passwordVal], { email, password: passwordVal });
						if (!legacy.called && typeof account.createSession === 'function' && account.createSession.length > 1) {
							await account.createSession(email, passwordVal);
						}
					}
					
					// Get the newly created user ID and ensure their collection exists
					cachedUserId = null; // Clear cache to force fresh fetch
					const userId = await getCurrentUserId();
					if (userId) {
						try {
							await ensureUserCollection(userId);
						} catch (collErr) {
							console.warn('Could not ensure user collection:', collErr);
						}
					}
					
					window.location.href = '/home';
				} catch (err) { console.error('Signup error',err); showFormError(signupForm, err.message || 'Sign up failed'); }
			});
		}

		function initModalAndForm() {
			const createBtn = document.getElementById('createTaskBtn'); const modal = document.getElementById('taskModal'); const cancelBtn = document.getElementById('cancelTask'); const taskForm = document.getElementById('taskCreateForm');
			if (createBtn && modal) {
				createBtn.addEventListener('click', () => { 
					const dateEl = document.getElementById('taskDueDate'); 
					if (dateEl) dateEl.value = formatDateISO(currentDay); 
					modal.style.display = 'flex'; 
					const title = document.getElementById('taskTitle'); 
					if (title) title.focus(); 
				});
			}
			if (cancelBtn && modal) cancelBtn.addEventListener('click', () => { modal.style.display = 'none'; });
			if (!taskForm) return;
			taskForm.addEventListener('submit', async (e) => {
				e.preventDefault(); 
				const name = document.getElementById('taskTitle').value.trim(); 
				const dueDate = document.getElementById('taskDueDate').value; 
				const category = document.getElementById('taskCategory').value.trim();
				const estimateStr = (document.getElementById('taskEstimateMinutes')||{}).value || '';
				const estimateMinutes = estimateStr ? Math.max(1, parseInt(estimateStr, 10)) : null;
				
				if (!name || !dueDate) return alert('Please enter task name and due date');
				
				// Convert date string to ISO datetime format for Appwrite
				const dueDateTime = new Date(dueDate + 'T23:59:59.000Z').toISOString();
				
				const taskData = {
					name: name,
					due: dueDateTime,
					category: category || null,
					color: 'cadet',
					assigned: null,
					estimateMinutes: estimateMinutes
				};
				
				try { 
					await createUserTask(taskData); 
					modal.style.display='none'; 
					taskForm.reset(); 
					await loadAndRender(); 
				} catch (err) { 
					console.error('create task error',err); 
					alert(err.message || 'Could not create task'); 
				}
			});
		}

		function initNavigation() {
			const prevDay = document.getElementById('prevDay'); const nextDay = document.getElementById('nextDay');
			if (prevDay) prevDay.addEventListener('click', () => { currentDay.setDate(currentDay.getDate()-1); loadAndRender(); });
			if (nextDay) nextDay.addEventListener('click', () => { currentDay.setDate(currentDay.getDate()+1); loadAndRender(); });
		}

		// --- public init ----------------------------------------------------
		async function init() {
			initPasswordToggles();
			initAuthHandlers();
			initModalAndForm();
			initNavigation();
			// If we're on the home/calendar page, ensure the user is authenticated.
			if (document.getElementById('calendar')) {
				const userId = await getCurrentUserId();
				if (!userId) {
					// Not logged in: send to login page
					console.info('User not authenticated — redirecting to /login');
					window.location.href = '/login';
					return;
				}
				await loadAndRender();
			}
		}

		// expose a couple helpers for tests
		return { init, createUserTask, listUserTasks, getCurrentUserId };
	})();

	// start
	PolyTask.init().catch(err => console.error('Failed to initialize PolyTask', err));

	});
