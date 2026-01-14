// Achievement tracking system for PolyTask
// This module tracks user progress, unlocks achievements, and syncs with Appwrite

import { ensureAppwriteClient, getAppwriteModule, getCurrentUserId } from './appwrite.js';

const STORAGE_KEY = 'polytask_achievements';
const STATS_KEY = 'polytask_stats';
const LAST_SYNC_KEY = 'polytask_achievements_last_sync';
const ACHIEVEMENTS_COLLECTION = 'achievements_data';
const ACHIEVEMENTS_DB = 'events';

// Initialize or get achievements collection
async function ensureAchievementsCollection() {
    try {
        const client = await ensureAppwriteClient();
        const App = getAppwriteModule();
        const db = new App.Databases(client);
        const userId = await getCurrentUserId();
        
        if (!userId) return;
        
        // Try to create collection if it doesn't exist
        let collectionCreated = false;
        try {
            // Create the collection with proper settings
            const collection = await db.createCollection(
                ACHIEVEMENTS_DB, 
                ACHIEVEMENTS_COLLECTION,
                'Achievement Data',  // Display name
                [],  // No permissions at collection level - will set at document level
                true // Enable document-level permissions
            );
            console.log('✓ Achievements collection created');
            collectionCreated = true;
        } catch (e) {
            // Collection might already exist
            if (e.code === 409 || e.message.includes('already exists')) {
                console.log('✓ Achievements collection already exists');
                collectionCreated = false;
            } else {
                console.warn('✗ Could not create achievements collection:', e.message);
                throw e;
            }
        }
        
        // Create attributes - these will fail gracefully if they already exist
        const attributes = [
            { key: 'userId', size: 255, desc: 'User ID' },
            { key: 'data', size: 65535, desc: 'JSON Data' },
            { key: 'timestamp', size: 255, desc: 'Timestamp' },
            { key: 'type', size: 50, desc: 'Type (achievements|stats)' }
        ];
        
        for (const attr of attributes) {
            try {
                await db.createStringAttribute(
                    ACHIEVEMENTS_DB,
                    ACHIEVEMENTS_COLLECTION,
                    attr.key,
                    attr.size,
                    true // required
                );
                console.log(`  ✓ Created attribute: ${attr.key}`);
            } catch (e) {
                if (e.code === 409 || e.message.includes('already exists')) {
                    console.log(`  ✓ Attribute already exists: ${attr.key}`);
                } else {
                    console.warn(`  ✗ Could not create ${attr.key} attribute:`, e.message);
                }
            }
        }
        
        console.log('✓ Achievements collection schema ready');
    } catch (e) {
        console.warn('✗ Failed to ensure achievements collection:', e.message);
    }
}

// Track when tasks are completed
export function trackTaskCompletion(task) {
    const stats = getStats();
    stats.tasksCompleted++;
    
    // Check for time-based achievements
    if (task.$createdAt) {
        const date = new Date(task.$createdAt);
        const hour = date.getHours();
        
        if (hour < 7) {
            stats.earlyBirdTasks++;
        }
        if (hour >= 22) {
            stats.nightOwlTasks++;
        }
    }
    
    saveStats(stats);
    checkForNewAchievements();
}

// Track when tasks are created
export function trackTaskCreation() {
    const stats = getStats();
    stats.tasksCreated++;
    saveStats(stats);
    checkForNewAchievements();
}

// Track focus session completion
export function trackFocusSession(minutes) {
    const stats = getStats();
    stats.focusSessions++;
    stats.totalFocusMinutes += minutes;
    saveStats(stats);
    checkForNewAchievements();
}

// Update streak information
export function updateStreak(currentStreak) {
    const stats = getStats();
    stats.currentStreak = currentStreak;
    stats.maxStreak = Math.max(stats.maxStreak || 0, currentStreak);
    saveStats(stats);
    checkForNewAchievements();
}

// Storage helpers
function getStats() {
    const stored = localStorage.getItem(STATS_KEY);
    if (stored) {
        return JSON.parse(stored);
    }
    return {
        tasksCreated: 0,
        tasksCompleted: 0,
        currentStreak: 0,
        maxStreak: 0,
        focusSessions: 0,
        totalFocusMinutes: 0,
        earlyBirdTasks: 0,
        nightOwlTasks: 0,
        perfectDays: 0,
        maxTasksInDay: 0,
        categoriesUsed: 0
    };
}

function saveStats(stats) {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    syncToServer(stats); // Sync stats to server
}

function getAchievementData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        return JSON.parse(stored);
    }
    return {
        unlockedAchievements: [],
        totalXP: 0,
        lastNotified: []
    };
}

function saveAchievementData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    syncToServer(data); // Sync achievements to server
}

// Check for newly unlocked achievements and show notifications
function checkForNewAchievements() {
    // Only check if we're on a page that has the achievements notification system
    if (typeof window.PolyTaskAchievements !== 'undefined' && 
        typeof window.PolyTaskAchievements.checkAchievements === 'function') {
        // Trigger check asynchronously
        setTimeout(() => {
            window.PolyTaskAchievements.checkAchievements();
        }, 100);
    }
}

// Server sync functions
async function syncToServer(data) {
    try {
        const userId = await getCurrentUserId();
        if (!userId) return; // Not authenticated
        
        const client = await ensureAppwriteClient();
        const App = getAppwriteModule();
        const db = new App.Databases(client);
        
        // Prepare data for storage
        const syncData = {
            userId: userId,
            data: JSON.stringify(data),
            timestamp: new Date().toISOString(),
            type: Array.isArray(data.unlockedAchievements) ? 'achievements' : 'stats'
        };
        
        // Try to update or create document
        const docId = `${userId}_${syncData.type}`;
        
        try {
            // Try to update existing document
            await db.updateDocument(ACHIEVEMENTS_DB, ACHIEVEMENTS_COLLECTION, docId, syncData);
        } catch (e) {
            // If document doesn't exist, create it
            if (e.code === 404 || e.message.includes('not found')) {
                const App = getAppwriteModule();
                const permissions = [
                    App.Permission.read(App.Role.user(userId)),
                    App.Permission.update(App.Role.user(userId)),
                    App.Permission.delete(App.Role.user(userId))
                ];
                await db.createDocument(ACHIEVEMENTS_DB, ACHIEVEMENTS_COLLECTION, docId, syncData, permissions);
            }
        }
        
        // Update last sync time
        localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    } catch (e) {
        // Silent fail - local storage is the fallback
        console.warn('Failed to sync achievements to server:', e);
    }
}

// Load achievements from server
export async function loadAchievementsFromServer() {
    try {
        const userId = await getCurrentUserId();
        if (!userId) return null;
        
        const client = await ensureAppwriteClient();
        const App = getAppwriteModule();
        const db = new App.Databases(client);
        
        const docId = `${userId}_achievements`;
        const doc = await db.getDocument(ACHIEVEMENTS_DB, ACHIEVEMENTS_COLLECTION, docId);
        
        if (doc && doc.data) {
            const data = JSON.parse(doc.data);
            // Save to local storage to sync with local state
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            return data;
        }
    } catch (e) {
        // Document might not exist yet, return null
        console.warn('Could not load achievements from server:', e);
    }
    return null;
}

// Load stats from server
export async function loadStatsFromServer() {
    try {
        const userId = await getCurrentUserId();
        if (!userId) return null;
        
        const client = await ensureAppwriteClient();
        const App = getAppwriteModule();
        const db = new App.Databases(client);
        
        const docId = `${userId}_stats`;
        const doc = await db.getDocument(ACHIEVEMENTS_DB, ACHIEVEMENTS_COLLECTION, docId);
        
        if (doc && doc.data) {
            const data = JSON.parse(doc.data);
            // Save to local storage to sync with local state
            localStorage.setItem(STATS_KEY, JSON.stringify(data));
            return data;
        }
    } catch (e) {
        // Document might not exist yet, return null
        console.warn('Could not load stats from server:', e);
    }
    return null;
}

// Sync local data to server on app startup
export async function syncAchievementsFromLocal() {
    try {
        await ensureAchievementsCollection();
        
        const achievements = getAchievementData();
        const stats = getStats();
        
        await syncToServer(achievements);
        await syncToServer(stats);
    } catch (e) {
        console.warn('Failed to sync achievements:', e);
    }
}

// Export for use in other modules
export function getAchievementStats() {
    return {
        stats: getStats(),
        achievements: getAchievementData()
    };
}