
// --- config & state -------------------------------------------------
export const APPWRITE_ENDPOINT = 'https://nyc.cloud.appwrite.io/v1';
// Hard-coded Appwrite project ID — replace with your real project id
export const APPWRITE_PROJECT = 'polytask';
export const APPWRITE_DATABASE = 'events';

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
    if (!userId) throw new Error('User ID required to ensure collection');
    const client = await ensureAppwriteClient();
    const App = AppwriteModule;
    
    // --- TablesDB Abstraction ---
    const tablesDB = {
        createTable: async ({ databaseId, tableId, name, columns, permissions, documentSecurity }) => {
            const db = new App.Databases(client);
            const requiredKeys = columns.map(c => c.key);
            let collection = null;

            // 1. Ensure Collection Exists
            try {
                // Try to get existing
                const existing = await invokeWithCompat(db, 'getCollection', [databaseId, tableId], { databaseId, collectionId: tableId });
                if (existing.called && existing.value) {
                    collection = existing.value;
                } else {
                    // Fallback standard call
                    collection = await db.getCollection(databaseId, tableId);
                }
            } catch (e) {
                // Not found, create it
                console.log(`Creating collection (table) ${tableId}...`);
                try {
                    const created = await invokeWithCompat(db, 'createCollection', [databaseId, tableId, name, permissions, documentSecurity], {
                        databaseId,
                        collectionId: tableId,
                        name,
                        permissions,
                        documentSecurity
                    });
                    
                    if (created.called) {
                        collection = created.value;
                    } else if (typeof db.createCollection === 'function') {
                        collection = await db.createCollection(databaseId, tableId, name, permissions, documentSecurity);
                    } else {
                        console.error(`Client SDK cannot create collection '${tableId}'. Using fallback logic (check console).`);
                        // Start polling in case the server/function creates it asynchronously
                        // or if we simply failed to detect it.
                        await new Promise(r => setTimeout(r, 1000));
                        try {
                            collection = await db.getCollection(databaseId, tableId);
                        } catch (retryErr) {
                            throw new Error(`Collection creation failed and manual retrieval failed. Client SDK lacks createCollection permission.`);
                        }
                    }
                } catch (createErr) {
                    console.error('Failed to create table:', createErr);
                    throw createErr;
                }
            }

            // 2. Ensure Schema (Columns)
            for (const col of columns) {
                try {
                    // Map generic types to specific Appwrite Attribute methods
                    if (col.type === 'datetime') {
                        // args: db, col, key, required, default
                        await invokeWithCompat(db, 'createDatetimeAttribute', [databaseId, tableId, col.key, col.required, col.default], {
                            databaseId, collectionId: tableId, key: col.key, required: col.required, default: col.default
                        });
                    } else if (col.type === 'string') {
                        // args: db, col, key, size, required, default
                        await invokeWithCompat(db, 'createStringAttribute', [databaseId, tableId, col.key, col.size, col.required, col.default], {
                            databaseId, collectionId: tableId, key: col.key, size: col.size, required: col.required, default: col.default
                        });
                    } else if (col.type === 'integer') {
                        // args: db, col, key, required, min, max, default
                        await invokeWithCompat(db, 'createIntegerAttribute', [databaseId, tableId, col.key, col.required, col.min, col.max, col.default], {
                            databaseId, collectionId: tableId, key: col.key, required: col.required, min: col.min, max: col.max, default: col.default
                        });
                    } else if (col.type === 'boolean') {
                        // args: db, col, key, required, default
                        await invokeWithCompat(db, 'createBooleanAttribute', [databaseId, tableId, col.key, col.required, col.default], {
                            databaseId, collectionId: tableId, key: col.key, required: col.required, default: col.default
                        });
                    }
                    // Add other types (email, float, etc.) if needed in future
                } catch (err) {
                    // Ignore specific "Attribute already exists" errors
                    if (err.code !== 409 && (!err.message || !err.message.includes('already exists'))) {
                        console.warn(`Warning: Could not create column ${col.key}:`, err.message);
                    }
                }
            }

            // 2.5 Ensure Indexes
            // (Assuming indexes are passed in arguments if needed, currently empty in usage so omitted here or kept if used)
             if (Array.isArray(indexes)) {
                for (const idx of indexes) {
                    try {
                        // createIndex(databaseId, collectionId, key, type, attributes, orders)
                        await invokeWithCompat(db, 'createIndex', [databaseId, tableId, idx.key, idx.type, idx.attributes, idx.orders], {
                            databaseId, collectionId: tableId, key: idx.key, type: idx.type, attributes: idx.attributes, orders: idx.orders
                        });
                    } catch (err) {
                        if (err.code !== 409 && (!err.message || !err.message.includes('already exists'))) {
                            console.warn(`Warning: Could not create index ${idx.key}:`, err.message);
                        }
                    }
                }
            }

            // 3. Poll for readiness (Wait for attributes to be 'available')
            // Attributes must be ready before we can write data
            const maxRetries = 20; // 10 seconds (20 * 500ms)
            for (let i = 0; i < maxRetries; i++) {
                try {
                    const listData = await invokeWithCompat(db, 'listAttributes', [databaseId, tableId], { databaseId, collectionId: tableId });
                    const attrs = listData.called ? listData.value.attributes : (await db.listAttributes(databaseId, tableId)).attributes;
                    
                    const ready = requiredKeys.every(k => {
                        const found = attrs.find(a => a.key === k);
                        return found && found.status === 'available';
                    });

                    if (ready) {
                        console.log(`Table ${tableId} schema is ready.`);
                        return collection;
                    }
                } catch (pollErr) {
                    console.warn('Polling table attributes...', pollErr);
                }
                await new Promise(r => setTimeout(r, 500));
            }
            
            console.warn(`Table ${tableId} creation timed out waiting for attributes.`);
            return collection;
        }
    };

    // --- Execute Schema Definition ---
    // Matches the 'Neal' user collection structure
    // Added 'indexes' as undefined in your original code loop but I'll define it empty here for safety
    const indexes = []; 

    return await tablesDB.createTable({
        databaseId: APPWRITE_DATABASE,
        tableId: userId,
        name: userId,
        permissions: [
            `read("user:${userId}")`,
            `create("user:${userId}")`,
            `update("user:${userId}")`,
            `delete("user:${userId}")`
        ],
        documentSecurity: false,
        columns: [
            { key: 'due',            type: 'datetime', required: true },
            { key: 'name',           type: 'string',   size: 50, required: true },
            { key: 'assigned',       type: 'datetime', required: false }, // Optional
            { key: 'category',       type: 'string',   size: 20, required: false },
            { key: 'color',          type: 'string',   size: 20, required: false, default: 'cadet' },
            { key: 'estimated_time', type: 'integer',  required: true, min: 0 },
            { key: 'complete',       type: 'boolean',  required: false, default: false },
            { key: 'repeat',         type: 'boolean',  required: false, default: false },
            { key: 'priority',       type: 'string',   size: 20, required: true }
        ],
        indexes: [] 
    });
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
