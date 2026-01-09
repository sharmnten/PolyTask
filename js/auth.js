
import { 
    ensureAppwriteClient, 
    getAppwriteModule, 
    invokeWithCompat, 
    ensureUserCollection, 
    getCurrentUserId,
    getCurrentUser,
    clearCachedUserId 
}  from './appwrite.js';
import { showFormError } from './ui.js';

export const checkSession = getCurrentUser;

export async function logout() {
    const client = await ensureAppwriteClient();
    const App = getAppwriteModule();
    const account = new App.Account(client);
    await account.deleteSession('current');
    clearCachedUserId();
    // Redirect to home/login
    window.location.href = '../index.html'; 
}

export function initAuth() {
    return initAuthHandlers();
}

export function initAuthHandlers() {
    const loginForm = document.getElementById('loginForm');
    // If we're on the login page and already authenticated, skip to /dashboard/
    if (loginForm) {
        (async () => {
            try {
                const client = await ensureAppwriteClient(); 
                const App = getAppwriteModule(); 
                const account = new App.Account(client);
                const u = await account.get();
                if (u && (u.$id || u.id)) { window.location.href = '../dashboard/'; return; }
            } catch (_) {}
        })();
        // Prefill from localStorage remember
        try {
            const savedRemember = localStorage.getItem('pt_remember') === '1';
            const savedEmail = localStorage.getItem('pt_email') || '';
            const rememberEl = document.getElementById('remember');
            if (rememberEl) rememberEl.checked = savedRemember;
            if (savedEmail) { const emailEl = document.getElementById('email'); if (emailEl) emailEl.value = savedEmail; }
        } catch (_) {}
    }
    if (loginForm) loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); showFormError(loginForm,'');
        const email = (document.getElementById('email')||{}).value || ''; const password = (document.getElementById('password')||{}).value || '';
        if (!email || !password) return showFormError(loginForm,'Please enter email and password.');
        try {
            const client = await ensureAppwriteClient(); const App = getAppwriteModule(); const account = new App.Account(client);
            let handled = false;
            try {
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
            } catch (sessionErr) {
                // Only swallow "session active" errors
                if (sessionErr.message && (sessionErr.message.includes('session is active') || sessionErr.message.includes('should be guest'))) {
                    // Verify we actually have a session
                    const u = await account.get();
                    if (u && (u.$id || u.id)) { 
                        console.log('Recovered existing session');
                        handled = true; 
                    } else {
                        throw sessionErr;
                    }
                } else {
                    throw sessionErr;
                }
            }
            
            // Get user ID and ensure their collection exists
            clearCachedUserId(); // Clear cache to force fresh fetch
            const userId = await getCurrentUserId();
            if (userId) {
                try {
                    await ensureUserCollection(userId);
                } catch (collErr) {
                    console.warn('Could not ensure user collection:', collErr);
                }
            }
            
            // Remember preference and email for convenience on this device
            try {
                const rememberEl = document.getElementById('remember');
                const remember = !!(rememberEl && rememberEl.checked);
                if (remember) {
                    localStorage.setItem('pt_remember','1');
                    localStorage.setItem('pt_email', email);
                } else {
                    localStorage.removeItem('pt_remember');
                    localStorage.removeItem('pt_email');
                }
            } catch (_) {}
            window.location.href = '../dashboard/index.html';
        } catch (err) { console.error('Login error',err); showFormError(loginForm, err.message || 'Sign in failed'); }
    });

    const signupForm = document.getElementById('signupForm');
    if (!signupForm) return;
    const pwd = document.getElementById('password'); const confirm = document.getElementById('confirmPassword'); const submitBtn = document.getElementById('submitBtn'); const pwMismatch = document.getElementById('pwMismatch');
    function validate(){ const match = pwd && confirm && pwd.value && confirm.value && pwd.value === confirm.value; const terms = !!(document.getElementById('terms')||{}).checked; if (pwMismatch) pwMismatch.style.display = match ? 'none' : 'block'; if (submitBtn) submitBtn.disabled = !(match && terms); }
    [pwd,confirm].forEach(el => el && el.addEventListener('input', validate)); const terms = document.getElementById('terms'); if (terms) terms.addEventListener('change', validate);
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault(); 
        showFormError(signupForm,'');
        
        try {
            const fullName = (document.getElementById('fullName')||{}).value||''; 
            const email = (document.getElementById('email')||{}).value||''; 
            const passwordVal = (document.getElementById('password')||{}).value||''; 
            const confirmVal = (document.getElementById('confirmPassword')||{}).value||''; 
            const termsChecked = !!(document.getElementById('terms')||{}).checked;

            if (!email || !passwordVal || !confirmVal) throw new Error('Please complete all fields.'); 
            if (passwordVal !== confirmVal) throw new Error('Passwords do not match.'); 
            if (!termsChecked) throw new Error('You must accept the terms.');
            
            let client, App, account;
            client = await ensureAppwriteClient(); 
            App = getAppwriteModule(); 
            account = new App.Account(client);
            
            // 1. Create Account
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
            // If creation failed but didn't throw (e.g. called=false), ensure we handle it?
            // invokeWithCompat returns { called: false } if method not found.
            // If we tried both and failed, throw.
            if (!created.called) throw new Error('Account create method not available in SDK');
        
            // 2. Create Session (Login)
            await createSession(account, email, passwordVal);

            // 3. User Setup
            // Get the newly created user ID and ensure their collection exists (now just ensures global tasks)
            clearCachedUserId(); // Clear cache to force fresh fetch
            const userId = await getCurrentUserId();
            if (userId) {
                try {
                    await ensureUserCollection(userId);
                } catch (collErr) {
                    console.warn('Could not ensure user collection:', collErr);
                }
            }
            
            window.location.href = '../dashboard/index.html';

        } catch (err) { 
            console.error('Signup error', err); 
            // Handle "User already exists" scenario if it came from create()
            if (err.code === 409 || (err.message && (err.message.includes('already exists') || err.type === 'user_already_exists'))) {
                console.log('User already exists, attempting to log in...');
                try {
                    const client = await ensureAppwriteClient(); 
                    const App = getAppwriteModule(); 
                    const account = new App.Account(client);
                    await createSession(account, (document.getElementById('email')||{}).value||'', (document.getElementById('password')||{}).value||'');
                    window.location.href = '../dashboard/index.html';
                    return;
                } catch (loginErr) {
                    showFormError(signupForm, 'Account exists but login failed. Please check credentials.');
                    return;
                }
            }
            
            showFormError(signupForm, err.message || 'Sign up failed'); 
        }
    });
}

async function createSession(account, email, password) {
    let sessionResult = await invokeWithCompat(account, 'createEmailPasswordSession', [email, password], { email, password });
    if (sessionResult.called) return sessionResult.value;

    const legacy = await invokeWithCompat(account, 'createEmailSession', [email, password], { email, password });
    if (legacy.called) return legacy.value;

    if (typeof account.createSession === 'function' && account.createSession.length > 1) {
        return await account.createSession(email, password);
    }
    throw new Error('Session create method not available in SDK');
}
