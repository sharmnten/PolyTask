
// --- config & state -------------------------------------------------
export const APPWRITE_ENDPOINT = 'https://nyc.cloud.appwrite.io/v1';
// Hard-coded Appwrite project ID — replace with your real project id
export const APPWRITE_PROJECT = 'polytask';
export const APPWRITE_DATABASE = 'events';
export const APPWRITE_COLLECTION_TASKS = 'tasks';

let AppwriteModule = null;
let cachedUserId = null;

export async function ensureAppwriteClient() {
    // Expect the Appwrite UMD global (window.Appwrite) to be present because
    // the SDK is included directly in the HTML via CDN.
    if (typeof window !== 'undefined' && window.Appwrite) {
        AppwriteModule = window.Appwrite;
        return new AppwriteModule.Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT);
    }
    console.error('Appwrite SDK not found on window. Please include the CDN script before script.js: <script src="https://cdn.jsdelivr.net/npm/appwrite@21.4.0"></script>');
    throw new Error('Appwrite SDK not loaded');
}

export async function invokeWithCompat(target, methodName, legacyArgs = [], modernPayload) {
    const fn = target && typeof target[methodName] === 'function' ? target[methodName] : null;
    if (!fn) return { called: false, value: undefined };
    const arity = Number.isInteger(fn.length) ? fn.length : legacyArgs.length;
    const value = arity <= 1
        ? await fn.call(target, modernPayload !== undefined ? modernPayload : legacyArgs[0])
        : await fn.apply(target, legacyArgs);
    return { called: true, value };
}

// --- collection management ------------------------------------------
export async function ensureUserCollection(userId) {
    // Legacy: We now use a single 'tasks' collection.
    // This function remains to support the legacy signature but acts as a no-op 
    // or ensures the global collection exists (if permissible).
    return null;
}

// --- auth helpers --------------------------------------------------
export async function getCurrentUser() {
    try {
        const client = await ensureAppwriteClient();
        const App = AppwriteModule || (typeof window !== 'undefined' && window.Appwrite) || null;
        if (!App) return null;
        const account = new App.Account(client);
        return await account.get();
    } catch (err) {
        return null;
    }
}

export async function getCurrentUserId() {
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

// Clear cached user ID (useful for login/logout)
export function clearCachedUserId() {
    cachedUserId = null;
}

export function getAppwriteModule() {
    return AppwriteModule;
}

// --- public initialization ---------------------------------------
export async function ensureSchema() {
    const userId = await getCurrentUserId();
    if (!userId) {
        console.warn('Cannot ensure schema, no user logged in.');
        return;
    }
    console.log('Ensuring schema for user collection:', userId);
    return await ensureUserCollection(userId);
}
