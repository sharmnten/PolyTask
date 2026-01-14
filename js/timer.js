
import { showToast, fireConfetti } from './ui.js';
import { trackFocusSession } from './achievement-tracker.js';

let focusTask = null;
let focusInterval = null;
let focusSeconds = 0;
let totalFocusMinutes = 0; // session based
const focusDurationInitial = 25 * 60; // 25 min default

export function initTimer() {
    const startBtn = document.getElementById('startFocusBtn');
    const stopBtn = document.getElementById('stopFocusBtn');

    if (startBtn) {
        startBtn.addEventListener('click', () => {
             startFocusMode(null);
        });
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            endFocusSession();
        });
    }

    if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
}

export function startFocusMode(task) {
    if (focusInterval) {
        showToast('Focus session already active', 'info');
        return;
    }
    focusTask = task;
    focusSeconds = focusDurationInitial;
    
    const focusOverlay = document.getElementById('focusOverlay');
    const focusTaskName = document.getElementById('focusTaskName');
    
    if (focusOverlay) {
        focusOverlay.style.display = 'flex';
        // Add a class to body to hide scrollbars if desired
        document.body.style.overflow = 'hidden';
    }
    
    if (focusTaskName) {
        focusTaskName.innerText = task ? task.name : 'Deep Work';
    }

    updateFocusDisplay();
    focusInterval = setInterval(() => {
        focusSeconds--;
        updateFocusDisplay();
        if (focusSeconds <= 0) {
            endFocusSession(true);
        }
    }, 1000);
}

function updateFocusDisplay() {
    const display = document.getElementById('focusTimerDisplay');
    const title = document.getElementById('focusTaskName');
    if (!display) return;

    const m = Math.floor(focusSeconds / 60);
    const s = focusSeconds % 60;
    const timeStr = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    display.innerText = timeStr;
    document.title = `${timeStr} - Focus`;
}

export function endFocusSession(completed = false) {
    if (focusInterval) {
        clearInterval(focusInterval);
        focusInterval = null;
    }
    
    const focusOverlay = document.getElementById('focusOverlay');
    if (focusOverlay) {
        focusOverlay.style.display = 'none';
        document.body.style.overflow = '';
    }
    
    document.title = 'PolyTask';

    // Log the session
    const duration = Math.round((focusDurationInitial - focusSeconds) / 60);
    if (duration > 0) {
        totalFocusMinutes += duration;
        updateFocusLog(duration, focusTask ? focusTask.name : 'Focus Session');
        
        // Track achievement
        trackFocusSession(duration);
    }

    if (completed) {
        fireConfetti();
        const snd = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU'); // dummy or real sound
        // Real sound not included to save space, but you can add one.
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Focus Session Complete', { body: 'Great job! Take a break.' });
        }
        showToast('Focus session complete!', 'success');
    }

    focusTask = null;
}

function updateFocusLog(minutes, label) {
    const list = document.getElementById('focusLogList');
    const totalEl = document.getElementById('totalFocusTime');
    
    if (totalEl) totalEl.innerText = `${totalFocusMinutes}m`;
    
    if (list) {
        const item = document.createElement('li');
        const time = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        item.innerHTML = `<span>${time} - ${label}</span> <span class="badge">${minutes}m</span>`;
        if (list.firstChild) {
            list.insertBefore(item, list.firstChild);
        } else {
            list.appendChild(item);
        }
    }
}
