
// --- small helpers --------------------------------------------------
export function fireConfetti() {
    const colors = ['#EF6F6C', '#465775', '#F7B074', '#FFF07C', '#ACDD91', '#59C9A5'];
    for (let i = 0; i < 40; i++) {
        const el = document.createElement('div');
        el.className = 'confetti';
        // Random start position near top (rain effect)
        el.style.left = Math.random() * 100 + 'vw';
        el.style.top = '-10px';
        el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        // Random fall speed and delay
        const duration = Math.random() * 1.5 + 1.5; 
        el.style.animation = `fall ${duration}s linear forwards`;
        el.style.animationDelay = (Math.random() * 0.5) + 's';
        
        document.body.appendChild(el);
        setTimeout(() => el.remove(), (duration + 1) * 1000);
    }
}

export function showToast(message, type = 'info', action = null) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);

    if (action && action.label && typeof action.onClick === 'function') {
        const btn = document.createElement('button');
        btn.textContent = action.label;
        btn.style.marginLeft = '12px';
        btn.style.padding = '4px 8px';
        btn.style.border = '1px solid currentColor';
        btn.style.borderRadius = '4px';
        btn.style.background = 'transparent';
        btn.style.color = 'inherit';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '0.8rem';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            action.onClick();
            toast.remove();
        });
        toast.appendChild(btn);
    }

    container.appendChild(toast);
    // Auto remove (longer if there is an action)
    const duration = action ? 6000 : 3000;
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('fade-out');
            toast.addEventListener('animationend', () => toast.remove());
        }
    }, duration);
}

export function showFormError(form, msg) {
    if (!form) return;
    const el = form.querySelector('#formError') || form.querySelector('#pwMismatch');
    if (el) {
        el.style.display = msg ? 'block' : 'none';
        el.textContent = msg || '';
    } else if (msg) showToast(msg, 'error');
}

export function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }

export function startOfDay(date) { const d = new Date(date); d.setHours(0,0,0,0); return d; }
export function formatDateISO(d) { return d.toISOString().slice(0,10); }
export function friendlyDayLabel(d) { return d.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' }); }
