
import { initAuth, checkSession, logout } from './auth.js';
import { ensureSchema } from './appwrite.js';
import { loadAndRender, adjustCurrentDay, getCurrentDay, setCurrentDay, setViewMode, setModalHandlers } from './calendar.js';
import { initTaskModal, initScheduleModal, initEditModal, setupSmartInputFeedback } from './modals.js';
import { initTimer } from './timer.js';
import { showToast, formatDateISO, fireConfetti } from './ui.js';
import { categorizeTasks, autoSchedule, listUserTasks, createUserTask, updateUserTask, deleteUserTask, calculateStreak, clearCompletedTasks } from './tasks.js';
import { parseSmartInput } from './parser.js';

// Global state for theme
let currentTheme = localStorage.getItem('theme') || 'light';

function initSettings() {
    // 1. Theme
    if (currentTheme === 'dark') document.body.classList.add('dark');
    
    // Wire up old and new theme toggles
    const themeToggles = ['toggleThemeBtn', 'dmToggle', 'darkModeToggle', 'settingDarkMode'];
    themeToggles.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (el.type === 'checkbox') el.checked = (currentTheme === 'dark');
            el.addEventListener(el.type === 'checkbox' ? 'change' : 'click', () => {
                document.body.classList.toggle('dark');
                currentTheme = document.body.classList.contains('dark') ? 'dark' : 'light';
                localStorage.setItem('theme', currentTheme);
                // Sync others
                themeToggles.forEach(tid => {
                    const tel = document.getElementById(tid);
                    if (tel && tel.type === 'checkbox') tel.checked = (currentTheme === 'dark');
                });
            });
        }
    });

    // 2. Audio
    const audioToggle = document.getElementById('settingAudio');
    if (audioToggle) {
        audioToggle.checked = localStorage.getItem('settings_audio') !== 'false';
        audioToggle.addEventListener('change', (e) => {
            localStorage.setItem('settings_audio', e.target.checked);
        });
    }

    // 3. Haptics
    const hapticsToggle = document.getElementById('settingHaptics');
    if (hapticsToggle) {
        hapticsToggle.checked = localStorage.getItem('settings_haptics') !== 'false';
        hapticsToggle.addEventListener('change', (e) => {
            localStorage.setItem('settings_haptics', e.target.checked);
        });
    }

    // 4. Modal Handling
    const modal = document.getElementById('settingsModal');
    const openBtn = document.getElementById('openSettingsBtn');
    
    window.closeSettings = () => {
        if (!modal) return;
        modal.style.opacity = '0';
        setTimeout(() => { modal.style.display = 'none'; }, 200);
    };

    if (modal && openBtn) {
        openBtn.addEventListener('click', () => {
            modal.style.display = 'flex';
            // slight delay to allow display:flex to apply before opacity transition
            setTimeout(() => { modal.style.opacity = '1'; }, 10);
        });
        
        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) window.closeSettings();
        });
    }
}

function initNavigation() {
    // Calendar navigation
    const prevBtn = document.getElementById('prevDayBtn') || document.getElementById('prevDay');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
             adjustCurrentDay(-1);
             loadAndRender();
        });
    }

    const nextBtn = document.getElementById('nextDayBtn') || document.getElementById('nextDay');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
             adjustCurrentDay(1);
             loadAndRender();
        });
    }

    document.getElementById('todayBtn')?.addEventListener('click', () => {
        // Instant reset: Update state and re-render without page reload
        setCurrentDay(new Date());
        loadAndRender();
    });

    // View Toggle
    const viewGroup = document.getElementById('viewModeGroup'); // Radio buttons
    if (viewGroup) {
        viewGroup.addEventListener('change', (e) => {
             if (e.target.name === 'viewMode') {
                 setViewMode(e.target.value);
                 loadAndRender();
             }
        });
    }
}

function initHotkeys(taskModalOpen) {
    document.addEventListener('keydown', (e) => {
        // Ignore if user is typing in an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            if (e.key === 'Escape') {
                 e.target.blur(); // Allow Escape to blur input
            }
            return;
        }

        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            taskModalOpen(formatDateISO(getCurrentDay())); 
        }
        
        if (e.key === 'Escape') {
             // Close any open modal
             document.querySelectorAll('.modal-overlay, #taskModal, #editEventModal, #defineScheduleModal, #settingsModal').forEach(m => m.style.display = 'none');
             const popup = document.getElementById('createTaskBtn-popup');
             if (popup) popup.style.display = '';
        }

        // Calendar Navigation (Left/Right Arrows)
        if (window.location.href.includes('/calendar/')) {
            if (e.key === 'ArrowLeft') {
                adjustCurrentDay(-1);
                loadAndRender();
            }
            if (e.key === 'ArrowRight') {
                adjustCurrentDay(1);
                loadAndRender();
            }
            if (e.key === 't') { // 't' for Today
                setCurrentDay(new Date());
                loadAndRender();
            }
        }
    });
}

function isAppPage() {
    return window.location.href.includes('/dashboard/') || 
           window.location.href.includes('/calendar/') || 
           window.location.href.includes('/tasks/');
}

function isAuthPage() {
    return window.location.href.includes('/login/') || window.location.href.includes('/signup/');
}


function initDashboardSmartBox() {
    const dashInput = document.getElementById('dashboardSmartAdd');
    if (dashInput) {
        // Create feedback el manually to place it outside the flex container
        const flexRow = dashInput.parentNode; 
        const feedbackDiv = document.createElement('div');
        feedbackDiv.id = 'dashboard-smart-feedback';
        feedbackDiv.style.fontSize = '0.9rem';
        feedbackDiv.style.fontWeight = '600';
        // Use a color that stands out on the gradient background
        feedbackDiv.style.color = 'var(--maize)'; 
        feedbackDiv.style.marginTop = '0.5rem';
        feedbackDiv.style.minHeight = '1.2rem';
        feedbackDiv.style.transition = 'opacity 0.2s';
        feedbackDiv.style.opacity = '0';
        
        if (flexRow && flexRow.parentNode) {
            flexRow.parentNode.insertBefore(feedbackDiv, flexRow.nextSibling);
        }
        
        setupSmartInputFeedback(dashInput, null, feedbackDiv);
    }
}

async function runApp() {
    console.log('Starting PolyTask...');
    initSettings();

    // 1. Auth Check
    const user = await checkSession();
    
    // Redirect logic
    if (!user) {
        if (isAppPage()) {
            window.location.href = '../login/index.html'; 
            return;
        }
    } else {
        // User is logged in
        if (isAuthPage()) {
            window.location.href = '../dashboard/index.html';
            return;
        }
    }

    // Initialize Auth UI (listeners for login forms if they exist)
    initAuth();

    // Check if we have the app container (Dashboard/Calendar/Tasks) or specific container
    const appContainer = document.getElementById('appContainer') || 
                         document.querySelector('.timeline-container') ||
                         document.querySelector('.calendar-large') || 
                         isAppPage(); // Allow execution if we are on a known app page

    const loginSection = document.getElementById('loginSection');

    // Handle SPA-like toggling if elements exist (e.g. if we are on a single page)
    if (user && appContainer && loginSection) {
        loginSection.style.display = 'none';
        if (typeof appContainer.style !== 'undefined') appContainer.style.display = 'block';
    }

    if (user) {
        const avatar = document.getElementById('userAvatar');
        if (avatar) avatar.innerText = user.name ? user.name.charAt(0).toUpperCase() : 'U';
        document.getElementById('logoutBtn')?.addEventListener('click', logout);

        // Only init DB and heavyweight stuff if we are arguably IN the app
        if (appContainer) {
            try {
                await ensureSchema();
            } catch (err) {
                console.warn('Schema init error', err);
            }

            initNavigation();
            // initCalendarInteractions removed as it was empty
            try {
                const { openCreateModal } = initTaskModal();
                const { openScheduleModal } = initScheduleModal();
                const { openGeneralEditModal } = initEditModal();
                setModalHandlers(openCreateModal, openScheduleModal, openGeneralEditModal);
                initHotkeys(openCreateModal);
                initDashboardSmartBox();
            } catch (e) { console.warn('Modal init failed', e); }

            initTimer();

            // Run calendar render only if calendar element exists, otherwise simple data init is enough
            if (document.getElementById('calendar')) {
                 await loadAndRender();
            }

            // Background tasks
            setTimeout(async () => {
                try {
                    await categorizeTasks();
                    await autoSchedule(getCurrentDay());
                    if (document.getElementById('calendar')) loadAndRender(); 
                } catch (err) {
                    console.warn('Background tasks warning:', err);
                }
            }, 1000);
        }
    } else {
         // Not logged in.
         // If loginSection exists (login page), ensure it's visible.
         if (loginSection) loginSection.style.display = 'flex';
         if (appContainer && typeof appContainer.style !== 'undefined') appContainer.style.display = 'none';
    }
}

// Start
runApp().catch(err => console.error('Fatal Error:', err));

// Expose Core API for Dashboard and Layouts
window.PolyTask = {
    getCurrentUser: checkSession,
    logout: logout,
    listUserTasks: listUserTasks,
    createUserTask: createUserTask,
    updateUserTask: updateUserTask,
    deleteUserTask: deleteUserTask,
    parseSmartInput: parseSmartInput,
    fireConfetti: fireConfetti,
    calculateStreak: calculateStreak,
    clearCompletedTasks: clearCompletedTasks,
    
    // Dashboard Focus Widget Logic
    focusState: {
        timer: null,
        isRunning: false,
        timeLeft: 25 * 60,
        defaultTime: 25 * 60
    },
    toggleFocus: function() {
        const btn = document.querySelector('button[onclick="PolyTask.toggleFocus()"]');
        
        if (this.focusState.isRunning) {
            // Pause
            clearInterval(this.focusState.timer);
            this.focusState.isRunning = false;
            if (btn) btn.textContent = 'Start';
        } else {
            // Start
            if (btn) btn.textContent = 'Pause';
            this.focusState.isRunning = true;
            this.focusState.timer = setInterval(() => {
                this.focusState.timeLeft--;
                if (this.focusState.timeLeft <= 0) {
                    this.focusState.timeLeft = 0;
                    this.resetFocus();
                    showToast('Focus completed!', 'success');
                }
                this.updateFocusWidget();
            }, 1000);
        }
    },
    resetFocus: function() {
        clearInterval(this.focusState.timer);
        this.focusState.isRunning = false;
        this.focusState.timeLeft = this.focusState.defaultTime;
        this.updateFocusWidget();
        const btn = document.querySelector('button[onclick="PolyTask.toggleFocus()"]');
        if (btn) btn.textContent = 'Start';
    },
    updateFocusWidget: function() {
        const display = document.getElementById('focusDisplay');
        if (!display) return;
        const m = Math.floor(this.focusState.timeLeft / 60);
        const s = this.focusState.timeLeft % 60;
        display.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        // Update Title for visibility
        if (this.focusState.isRunning) {
            document.title = `${display.textContent} - Focus`;
        } else {
            document.title = 'PolyTask — Dashboard';
        }
    }
};

// Global Quick Add Handler for Dashboard
window.handleDashboardQuickAdd = async () => {
    const input = document.getElementById('dashboardSmartAdd');
    if (!input || !input.value.trim()) return;
    const text = input.value.trim();
    const btn = document.querySelector('button[onclick="handleDashboardQuickAdd()"]');
    
    // Visual feedback
    if (btn) btn.textContent = '...';
    try {
        const parsed = parseSmartInput(text);
        let dueIso = new Date().toISOString(); 
        if (parsed.date) {
            // If smart parser found a date, combine it with time
            let d = new Date(parsed.date); // typically YYYY-MM-DD local
            if (parsed.time) {
                const [h, m] = parsed.time.split(':');
                d.setHours(h, m, 0, 0); // set local time
            } else {
                d.setHours(23, 59, 59, 999); // End of day default
            }
            dueIso = d.toISOString();
        } else if (parsed.time) {
             // Time only? assume today
             const now = new Date();
             const [h, m] = parsed.time.split(':');
             now.setHours(h, m, 0, 0);
             if (now < new Date()) now.setDate(now.getDate() + 1); // if time passed, assume tomorrow? Or just let it be.
             dueIso = now.toISOString();
        }

        const taskData = {
            name: parsed.title,
            due: dueIso,
            assigned: parsed.time ? dueIso : null, // If explicit time, assign it
            estimateMinutes: parsed.duration || 60,
            priority: 'medium'
        };
        
        await createUserTask(taskData);
        input.value = '';
        fireConfetti();
        showToast('Task added from dashboard!', 'success');
        
        // Refresh stats if on dashboard
        if (typeof categorizeTasks === 'function') await categorizeTasks();
        // Reload page or stats? simplest is reload, but let's try to update DOM if possible.
        // For now, let's just let the user see the success.
        
    } catch (err) {
        console.error(err);
        showToast('Could not add task', 'error');
    } finally {
        if (btn) btn.textContent = 'Add';
    }
};

window.toggleDarkMode = () => {
    const btn = document.getElementById('toggleThemeBtn');
    if (btn) {
        btn.click();
    } else {
         document.body.classList.toggle('dark');
         const currentTheme = document.body.classList.contains('dark') ? 'dark' : 'light';
         localStorage.setItem('theme', currentTheme);
    }
};
