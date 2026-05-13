// ============================================
// Axion — Stress Test Dashboard
// ============================================

let ws = null;
let isRunning = false;
let reconnectTimer = null;

// Notifications
let notifications = [];
let unreadCount = 0;

// Heartbeat
const canvas = document.getElementById('heartbeatCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const heartbeatData = [];
const MAX_DATA_POINTS = 300;
let heartbeatValue = 0;
let targetBPM = 0;
let ecgPhase = 0;

// Welcome
const welcomeOverlay = document.getElementById('welcomeOverlay');
const welcomeStartBtn = document.getElementById('welcomeStartBtn');
let welcomeDismissed = false;

// DOM elements (all grabbed safely)
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const resetBtn = document.getElementById('resetBtn');
const heartbeatStatus = document.getElementById('heartbeatStatus');
const connectionStatus = document.getElementById('connectionStatus');
const menuToggle = document.getElementById('menuToggle');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const navItems = document.querySelectorAll('.nav-item');
const viewContainers = document.querySelectorAll('.view-container');
const toastContainer = document.getElementById('toastContainer');
const themeToggle = document.getElementById('themeToggle');
const notificationBadge = document.getElementById('notificationBadge');
const notificationBtn = document.getElementById('notificationBtn');
const notificationDropdown = document.getElementById('notificationDropdown');
const notificationList = document.getElementById('notificationList');
const notificationClear = document.getElementById('notificationClear');
const breadcrumbMain = document.getElementById('breadcrumbMain');
const breadcrumbSub = document.getElementById('breadcrumbSub');
const concurrencySlider = document.getElementById('concurrencySlider');
const concurrencyInput = document.getElementById('concurrency');
const delaySlider = document.getElementById('delaySlider');
const delayInput = document.getElementById('requestDelay');

let testHistory = [];

// ============================================
// Welcome Overlay
// ============================================
function dismissWelcome() {
    if (welcomeDismissed || !welcomeOverlay) return;
    welcomeDismissed = true;
    welcomeOverlay.classList.add('fade-out');
    setTimeout(() => {
        if (welcomeOverlay && welcomeOverlay.parentNode) {
            welcomeOverlay.remove();
        }
    }, 500);
    localStorage.setItem('axion-welcome-dismissed', 'true');
}

function initWelcome() {
    const dismissed = localStorage.getItem('axion-welcome-dismissed');
    if (dismissed === 'true' && welcomeOverlay) {
        welcomeOverlay.remove();
        welcomeDismissed = true;
    }
}

if (welcomeStartBtn) {
    welcomeStartBtn.addEventListener('click', () => {
        dismissWelcome();
        setTimeout(() => {
            const el = document.getElementById('targetUrl');
            if (el) { el.focus(); el.select(); }
        }, 400);
    });
}

// ============================================
// Theme Toggle
// ============================================
function initTheme() {
    const saved = localStorage.getItem('axion-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
}

function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('axion-theme', next);
    updateThemeIcon(next);
    showToast('Switched to ' + next + ' mode', 'info');
}

function updateThemeIcon(theme) {
    if (!themeToggle) return;
    const icon = themeToggle.querySelector('i');
    if (!icon) return;
    icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
}

// ============================================
// Navigation (View Switching)
// ============================================
function switchView(viewName) {
    viewContainers.forEach(v => v.classList.remove('active'));
    
    const target = document.getElementById('view-' + viewName);
    if (target) target.classList.add('active');

    navItems.forEach(item => item.classList.remove('active'));
    const activeNav = document.querySelector('.nav-item[data-view="' + viewName + '"]');
    if (activeNav) activeNav.classList.add('active');

    const titles = {
        dashboard: ['Dashboard', 'Live Test'],
        history: ['History', 'Past Results'],
        settings: ['Settings', 'Configuration'],
        docs: ['Documentation', 'Guides']
    };
    const t = titles[viewName] || ['Dashboard', ''];
    if (breadcrumbMain) breadcrumbMain.textContent = t[0];
    if (breadcrumbSub) breadcrumbSub.textContent = t[1];

    if (window.innerWidth <= 768) closeSidebar();
    if (viewName === 'history') fetchHistory();
}

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const viewName = item.dataset.view;
        if (viewName) switchView(viewName);
    });
});

// ============================================
// Mobile Sidebar
// ============================================
function openSidebar() {
    if (!sidebar || !sidebarOverlay) return;
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    if (!sidebar || !sidebarOverlay) return;
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

if (menuToggle) {
    menuToggle.addEventListener('click', () => {
        if (sidebar && sidebar.classList.contains('open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    });
}

if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', closeSidebar);
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (sidebar && sidebar.classList.contains('open')) closeSidebar();
        if (notificationDropdown && notificationDropdown.classList.contains('active')) {
            notificationDropdown.classList.remove('active');
        }
    }
});

window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && sidebar && sidebar.classList.contains('open')) {
        closeSidebar();
    }
    drawHeartbeat();
});

// ============================================
// Notifications (persistent, decrement on view)
// ============================================
function loadNotifications() {
    try {
        const saved = localStorage.getItem('axion-notifications');
        if (saved) {
            notifications = JSON.parse(saved);
            unreadCount = notifications.filter(n => !n.read).length;
        }
    } catch (e) {
        notifications = [];
        unreadCount = 0;
    }
    updateNotificationBadge();
}

function saveNotifications() {
    try {
        localStorage.setItem('axion-notifications', JSON.stringify(notifications));
    } catch (e) {
        // Storage may be full
    }
}

function addNotification(message, type) {
    type = type || 'info';
    const notification = {
        id: Date.now(),
        message: message,
        type: type,
        time: new Date().toLocaleTimeString(),
        read: false
    };

    notifications.unshift(notification);
    unreadCount++;

    if (notifications.length > 30) {
        const removed = notifications.splice(30);
        const removedUnread = removed.filter(n => !n.read).length;
        unreadCount = Math.max(0, unreadCount - removedUnread);
    }

    saveNotifications();
    updateNotificationBadge();

    if (notificationDropdown && notificationDropdown.classList.contains('active')) {
        renderNotificationList();
    }

    showToast(message, type);
}

function markAllAsRead() {
    let changed = false;
    notifications.forEach(n => {
        if (!n.read) { n.read = true; changed = true; }
    });
    if (changed) {
        unreadCount = 0;
        saveNotifications();
        updateNotificationBadge();
        renderNotificationList();
    }
}

function clearNotifications() {
    notifications = [];
    unreadCount = 0;
    saveNotifications();
    updateNotificationBadge();
    renderNotificationList();
    showToast('Notifications cleared', 'info');
}

function updateNotificationBadge() {
    if (!notificationBadge) return;
    if (unreadCount > 0) {
        notificationBadge.style.display = 'flex';
        notificationBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    } else {
        notificationBadge.style.display = 'none';
    }
}

function renderNotificationList() {
    if (!notificationList) return;

    if (notifications.length === 0) {
        notificationList.innerHTML = '<div class="notification-empty"><i class="fa-solid fa-bell-slash"></i><span>No notifications yet</span></div>';
        return;
    }

    notificationList.innerHTML = notifications.map(n => {
        const iconMap = {
            success: 'fa-circle-check icon-success',
            error: 'fa-circle-xmark icon-error',
            warning: 'fa-triangle-exclamation icon-warning',
            info: 'fa-circle-info icon-info'
        };
        return '<div class="notification-item' + (n.read ? '' : ' unread') + '">' +
            '<i class="fa-solid ' + (iconMap[n.type] || iconMap.info) + '"></i>' +
            '<div class="notification-item-content">' +
            '<div class="notification-item-message">' + escapeHtml(n.message) + '</div>' +
            '<div class="notification-item-time">' + n.time + '</div>' +
            '</div>' +
            (n.read ? '' : '<i class="fa-solid fa-circle" style="font-size:0.35rem;color:var(--accent-primary);margin-top:0.5rem;"></i>') +
            '</div>';
    }).join('');
}

if (notificationBtn) {
    notificationBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!notificationDropdown) return;
        const isOpening = !notificationDropdown.classList.contains('active');
        if (isOpening) {
            notificationDropdown.classList.add('active');
            markAllAsRead();
        } else {
            notificationDropdown.classList.remove('active');
        }
    });
}

if (notificationClear) {
    notificationClear.addEventListener('click', (e) => {
        e.stopPropagation();
        clearNotifications();
    });
}

document.addEventListener('click', (e) => {
    if (notificationDropdown && notificationDropdown.classList.contains('active')) {
        const wrapper = document.querySelector('.notification-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
            notificationDropdown.classList.remove('active');
        }
    }
});

// ============================================
// Slider Sync
// ============================================
if (concurrencySlider && concurrencyInput) {
    concurrencySlider.addEventListener('input', () => { concurrencyInput.value = concurrencySlider.value; });
    concurrencyInput.addEventListener('input', () => {
        const v = parseInt(concurrencyInput.value) || 1;
        concurrencySlider.value = Math.min(v, 100);
    });
}

if (delaySlider && delayInput) {
    delaySlider.addEventListener('input', () => { delayInput.value = delaySlider.value; });
    delayInput.addEventListener('input', () => {
        const v = parseInt(delayInput.value) || 0;
        delaySlider.value = Math.min(v, 1000);
    });
}

// ============================================
// WebSocket Connection
// ============================================
function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + window.location.host + '/ws');

    ws.onopen = () => {
        console.log('Connected to Axion engine');
        updateConnectionStatus(true);
        showToast('Connected to engine', 'success');
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    };

    ws.onmessage = (event) => {
        try {
            handleMessage(JSON.parse(event.data));
        } catch (e) {
            console.error('Failed to parse message:', e);
        }
    };

    ws.onclose = () => {
        updateConnectionStatus(false);
        if (!reconnectTimer) reconnectTimer = setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = () => updateConnectionStatus(false);
}

function updateConnectionStatus(connected) {
    const dot = document.querySelector('.status-dot');
    const txt = document.querySelector('.status-text');
    if (connected) {
        if (connectionStatus) connectionStatus.innerHTML = '<i class="fa-solid fa-circle connection-dot"></i> Connected';
        if (dot) { dot.style.background = 'var(--accent-success)'; dot.style.animation = 'pulse-dot 2s infinite'; }
        if (txt) txt.textContent = 'System Ready';
    } else {
        if (connectionStatus) connectionStatus.innerHTML = '<i class="fa-solid fa-circle connection-dot" style="color:var(--accent-warning)"></i> Reconnecting...';
        if (dot) { dot.style.background = 'var(--accent-warning)'; dot.style.animation = 'pulse-dot 2s infinite'; }
        if (txt) txt.textContent = 'Disconnected';
    }
}

// ============================================
// Message Handler
// ============================================
function handleMessage(message) {
    if (!message || !message.type) return;
    switch (message.type) {
        case 'stats':
            updateStats(message.data);
            updateHeartbeat(message.data);
            break;
        case 'vitals':
            updateVitals(message.data);
            break;
        case 'status':
            updateStatus(message.data);
            break;
        case 'error':
            showToast(message.data && message.data.message ? message.data.message : 'An error occurred', 'error');
            break;
    }
}

// ============================================
// Stats Updates
// ============================================
function updateStats(stats) {
    if (!stats) return;
    setText('rps', Math.round(stats.currentRPS).toLocaleString());
    setText('totalRequests', stats.totalRequests.toLocaleString());
    const total = (stats.successCount || 0) + (stats.errorCount || 0);
    const sRate = total > 0 ? ((stats.successCount / total) * 100) : 0;
    const eRate = total > 0 ? ((stats.errorCount / total) * 100) : 0;
    setText('successRate', sRate.toFixed(1) + '%');
    setText('successCount', stats.successCount.toLocaleString());
    setText('totalForRate', total.toLocaleString());
    setWidth('successBar', sRate + '%');
    setText('errorRate', eRate.toFixed(1) + '%');
    setText('errorCount', stats.errorCount.toLocaleString());
    setWidth('errorBar', eRate + '%');
    setText('avgLatency', Math.round(stats.averageLatencyMs));
    setText('minLatency', Math.round(stats.minLatencyMs));
    setText('maxLatency', Math.round(stats.maxLatencyMs));
    setText('p99Latency', Math.round(stats.p99LatencyMs));
    setText('activeWorkers', stats.activeWorkers);
    targetBPM = Math.min(Math.round(stats.currentRPS * 6), 180);
    setText('heartbeatBPM', targetBPM || '--');
}

function updateVitals(vitals) {
    if (!vitals) return;
    setText('memory', Math.round(vitals.memoryMB));
    setText('goroutines', vitals.numGoroutines);
}

function updateStatus(data) {
    let statusText = typeof data === 'string' ? data : (data && data.status ? data.status : 'stopped');

    if (data && data.status === 'completed') {
        fetchHistory();
        if (data.record) {
            addNotification('Test completed: ' + data.record.totalRequests + ' requests', 'success');
        }
    }

    isRunning = statusText === 'running';

    if (startBtn) {
        startBtn.disabled = isRunning;
        startBtn.innerHTML = isRunning
            ? '<i class="fa-solid fa-spinner fa-spin"></i> Running...'
            : '<i class="fa-solid fa-play"></i> Start Test';
    }
    if (stopBtn) stopBtn.disabled = !isRunning;

    const dot = document.querySelector('.status-dot');
    const txt = document.querySelector('.status-text');

    if (isRunning) {
        if (dot) { dot.style.background = 'var(--accent-pulse)'; dot.style.animation = 'pulse-beat 0.5s infinite'; }
        if (txt) txt.textContent = 'Test Running';
        if (heartbeatStatus) {
            heartbeatStatus.innerHTML = '<i class="fa-solid fa-circle"></i><span>Stress test in progress...</span>';
            heartbeatStatus.className = 'heartbeat-status running';
        }
        addNotification('Stress test started');
    } else {
        if (dot) { dot.style.background = 'var(--accent-success)'; dot.style.animation = 'pulse-dot 2s infinite'; }
        if (txt) txt.textContent = 'System Ready';
        if (heartbeatStatus) {
            heartbeatStatus.innerHTML = '<i class="fa-solid fa-circle"></i><span>Test stopped</span>';
            heartbeatStatus.className = 'heartbeat-status';
        }
        targetBPM = 0;
        setText('heartbeatBPM', '--');
    }
}

// ============================================
// Heartbeat Visualization
// ============================================
function updateHeartbeat(stats) {
    if (!stats) return;
    const errorRate = stats.totalRequests > 0 ? (stats.errorCount / stats.totalRequests) : 0;

    if (stats.currentRPS > 0 && errorRate < 0.1) {
        heartbeatValue = generateECGPoint(true, errorRate);
        if (heartbeatStatus) heartbeatStatus.className = 'heartbeat-status running';
    } else if (errorRate > 0.5) {
        heartbeatValue = 0.05 + Math.random() * 0.1;
        if (heartbeatStatus) heartbeatStatus.className = 'heartbeat-status critical';
    } else if (errorRate > 0.1) {
        heartbeatValue = generateECGPoint(false, errorRate);
        if (heartbeatStatus) heartbeatStatus.className = 'heartbeat-status warning';
    } else {
        heartbeatValue = 0.1 + Math.sin(Date.now() / 1000) * 0.05;
    }

    heartbeatData.push(heartbeatValue);
    if (heartbeatData.length > MAX_DATA_POINTS) heartbeatData.shift();
    drawHeartbeat();
}

function generateECGPoint(healthy, errorRate) {
    ecgPhase += healthy ? (0.05 + Math.random() * 0.02) : (0.02 + Math.random() * 0.08);
    if (ecgPhase > 1) ecgPhase = 0;
    let value;
    const x = ecgPhase;
    if (x < 0.1) value = 0.1 + Math.sin(x * Math.PI / 0.1) * 0.15;
    else if (x < 0.2) value = 0.1;
    else if (x < 0.3) {
        const p = (x - 0.2) / 0.1;
        if (p < 0.1) value = 0.1 - p * 2;
        else if (p < 0.4) value = -0.1 + (p - 0.1) * 3;
        else if (p < 0.5) value = 0.8;
        else if (p < 0.8) value = 0.8 - (p - 0.5) * 4;
        else value = 0.1;
    } else if (x < 0.4) value = 0.1 + Math.random() * 0.02;
    else if (x < 0.6) value = 0.1 + Math.sin((x - 0.4) * Math.PI / 0.2) * 0.2;
    else value = 0.1 + Math.random() * 0.03;
    value += (Math.random() - 0.5) * errorRate * 0.5;
    return Math.max(-0.1, Math.min(0.9, value));
}

function drawHeartbeat() {
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.5)';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    if (heartbeatData.length < 2) {
        ctx.strokeStyle = 'rgba(139, 149, 168, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        return;
    }

    // Color by health state
    let glow, lineStart, lineEnd, fillStart, fillEnd;
    if (heartbeatStatus && heartbeatStatus.className.includes('critical')) {
        glow = 'rgba(239,68,68,0.6)'; lineStart = '#ef4444'; lineEnd = '#dc2626';
        fillStart = 'rgba(239,68,68,0.15)'; fillEnd = 'rgba(239,68,68,0.01)';
    } else if (heartbeatStatus && heartbeatStatus.className.includes('warning')) {
        glow = 'rgba(245,158,11,0.6)'; lineStart = '#f59e0b'; lineEnd = '#d97706';
        fillStart = 'rgba(245,158,11,0.15)'; fillEnd = 'rgba(245,158,11,0.01)';
    } else {
        glow = 'rgba(16,185,129,0.6)'; lineStart = '#10b981'; lineEnd = '#059669';
        fillStart = 'rgba(16,185,129,0.15)'; fillEnd = 'rgba(16,185,129,0.01)';
    }

    const stepX = w / MAX_DATA_POINTS;
    const midY = h / 2;
    const amp = h * 0.4;

    ctx.shadowColor = glow;
    ctx.shadowBlur = 15;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, lineStart);
    grad.addColorStop(0.5, lineEnd);
    grad.addColorStop(1, lineStart);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    heartbeatData.forEach((v, i) => {
        const x = i * stepX;
        const y = midY - (v - 0.5) * amp * 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Fill area under curve
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const fGrad = ctx.createLinearGradient(0, 0, 0, h);
    fGrad.addColorStop(0, fillStart);
    fGrad.addColorStop(1, fillEnd);
    ctx.fillStyle = fGrad;
    ctx.fill();
}

// ============================================
// Actions
// ============================================
if (startBtn) {
    startBtn.addEventListener('click', async () => {
        const targetUrlEl = document.getElementById('targetUrl');
        const concurrencyEl = document.getElementById('concurrency');
        const requestDelayEl = document.getElementById('requestDelay');
        const durationEl = document.getElementById('duration');

        if (!targetUrlEl || !concurrencyEl || !requestDelayEl || !durationEl) return;

        const targetUrl = targetUrlEl.value.trim();
        const concurrency = parseInt(concurrencyEl.value);
        const requestDelay = parseInt(requestDelayEl.value);
        const duration = parseInt(durationEl.value);

        if (!targetUrl) { showToast('Please enter a target URL', 'error'); return; }
        try { new URL(targetUrl); } catch { showToast('Invalid URL format', 'error'); return; }

        if (!welcomeDismissed) dismissWelcome();

        startBtn.disabled = true;
        startBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Starting...';

        try {
            const response = await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetUrl: targetUrl,
                    concurrency: concurrency,
                    requestDelayMs: requestDelay,
                    durationSecs: duration
                })
            });
            if (!response.ok) throw new Error('Failed to start test');
            heartbeatData.length = 0;
            ecgPhase = 0;
            showToast('Stress test started successfully', 'success');
        } catch (error) {
            showToast('Error: ' + error.message, 'error');
            startBtn.disabled = false;
            startBtn.innerHTML = '<i class="fa-solid fa-play"></i> Start Test';
        }
    });
}

if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/stop', { method: 'POST' });
            showToast('Test stopped', 'info');
        } catch (error) {
            console.error('Error stopping test:', error);
        }
    });
}

if (resetBtn) {
    resetBtn.addEventListener('click', () => {
        setVal('targetUrl', 'https://httpbin.org/get');
        setVal('concurrency', 10);
        setVal('requestDelay', 100);
        setVal('duration', 0);
        if (concurrencySlider) concurrencySlider.value = 10;
        if (delaySlider) delaySlider.value = 100;
        ['rps', 'totalRequests', 'successRate', 'errorRate', 'successCount', 'errorCount',
         'avgLatency', 'minLatency', 'maxLatency', 'p99Latency'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = id.includes('Rate') ? '0%' : '0';
        });
        setWidth('successBar', '0%');
        setWidth('errorBar', '0%');
        heartbeatData.length = 0;
        drawHeartbeat();
        showToast('Configuration reset', 'info');
    });
}

const validateBtn = document.getElementById('validateUrl');
if (validateBtn) {
    validateBtn.addEventListener('click', () => {
        const urlEl = document.getElementById('targetUrl');
        if (!urlEl) return;
        const url = urlEl.value.trim();
        try { new URL(url); showToast('URL is valid', 'success'); }
        catch { showToast('Invalid URL format', 'error'); }
    });
}

// ============================================
// History & Reports
// ============================================
async function fetchHistory() {
    try {
        const response = await fetch('/api/history');
        if (response.ok) {
            testHistory = await response.json();
            renderHistory();
        }
    } catch (error) {
        console.error('History fetch error:', error);
    }
}

function renderHistory() {
    const list = document.getElementById('historyList');
    const count = document.getElementById('historyCount');
    const empty = document.getElementById('historyEmpty');
    if (!list) return;
    if (count) count.textContent = testHistory.length;

    // Remove existing cards
    list.querySelectorAll('.history-card').forEach(c => c.remove());

    if (testHistory.length === 0) {
        if (empty) empty.style.display = '';
        return;
    }
    if (empty) empty.style.display = 'none';

    testHistory.forEach((record, i) => {
        list.appendChild(createHistoryCard(record, i));
    });
}

function createHistoryCard(record, index) {
    const card = document.createElement('div');
    card.className = 'history-card';

    const sRate = record.totalRequests > 0 ? ((record.successCount / record.totalRequests) * 100).toFixed(1) : 0;
    const eRate = record.totalRequests > 0 ? ((record.errorCount / record.totalRequests) * 100).toFixed(1) : 0;
    const statusIcon = record.status === 'completed' ? 'fa-circle-check' : 'fa-circle-stop';
    const statusClass = record.status === 'completed' ? 'completed' : 'stopped';
    const statusText = record.status === 'completed' ? 'Completed' : 'Manually stopped';

    card.innerHTML =
        '<div class="history-card-summary">' +
            '<div class="history-status-icon ' + statusClass + '"><i class="fa-solid ' + statusIcon + '"></i></div>' +
            '<div class="history-card-info">' +
                '<div class="history-card-url" title="' + escapeHtml(record.targetUrl) + '">' + escapeHtml(record.targetUrl) + '</div>' +
                '<div class="history-card-meta">' +
                    '<span><i class="fa-solid fa-calendar"></i> ' + new Date(record.startedAt).toLocaleString() + '</span>' +
                    '<span><i class="fa-solid fa-clock"></i> ' + formatDuration(record.durationSecs) + '</span>' +
                    '<span><i class="fa-solid fa-bolt"></i> ' + record.concurrency + ' workers</span>' +
                '</div>' +
            '</div>' +
            '<div class="history-card-stats">' +
                '<div class="history-mini-stat"><div class="mini-value success">' + sRate + '%</div><div class="mini-label">Success</div></div>' +
                '<div class="history-mini-stat"><div class="mini-value error">' + eRate + '%</div><div class="mini-label">Errors</div></div>' +
                '<div class="history-mini-stat"><div class="mini-value">' + Math.round(record.avgRPS) + '</div><div class="mini-label">Avg RPS</div></div>' +
            '</div>' +
            '<div class="history-card-expand-icon"><i class="fa-solid fa-chevron-down"></i></div>' +
        '</div>' +
        '<div class="history-card-detail">' +
            '<div class="history-detail-grid">' +
                '<div class="history-detail-item"><div class="detail-label">Test ID</div><div class="detail-value">#' + record.id + '</div></div>' +
                '<div class="history-detail-item"><div class="detail-label">Status</div><div class="detail-value">' + statusText + '</div></div>' +
                '<div class="history-detail-item"><div class="detail-label">Duration</div><div class="detail-value">' + formatDuration(record.durationSecs) + '</div></div>' +
                '<div class="history-detail-item"><div class="detail-label">Total Requests</div><div class="detail-value">' + record.totalRequests.toLocaleString() + '</div></div>' +
                '<div class="history-detail-item"><div class="detail-label">Success / Error</div><div class="detail-value">' + record.successCount + ' / ' + record.errorCount + '</div></div>' +
                '<div class="history-detail-item"><div class="detail-label">Concurrency</div><div class="detail-value">' + record.concurrency + ' workers</div></div>' +
                '<div class="history-detail-item"><div class="detail-label">Request Delay</div><div class="detail-value">' + record.requestDelayMs + 'ms</div></div>' +
                '<div class="history-detail-item"><div class="detail-label">Avg RPS</div><div class="detail-value">' + Math.round(record.avgRPS) + '</div></div>' +
                '<div class="history-detail-item"><div class="detail-label">Peak RPS</div><div class="detail-value">' + Math.round(record.maxRPS) + '</div></div>' +
                '<div class="history-detail-item"><div class="detail-label">Avg Latency</div><div class="detail-value">' + Math.round(record.averageLatencyMs) + 'ms</div></div>' +
                '<div class="history-detail-item"><div class="detail-label">P99 Latency</div><div class="detail-value">' + Math.round(record.p99LatencyMs) + 'ms</div></div>' +
                '<div class="history-detail-item"><div class="detail-label">Min / Max Latency</div><div class="detail-value">' + Math.round(record.minLatencyMs) + ' / ' + Math.round(record.maxLatencyMs) + 'ms</div></div>' +
            '</div>' +
            '<div class="history-detail-actions">' +
                '<button class="btn-secondary download-btn" data-format="json" data-index="' + index + '"><i class="fa-solid fa-download"></i> JSON</button>' +
                '<button class="btn-secondary download-btn" data-format="csv" data-index="' + index + '"><i class="fa-solid fa-file-csv"></i> CSV</button>' +
            '</div>' +
        '</div>';

    // Toggle expand
    card.querySelector('.history-card-summary').addEventListener('click', () => {
        const wasExpanded = card.classList.contains('expanded');
        document.querySelectorAll('.history-card.expanded').forEach(c => c.classList.remove('expanded'));
        if (!wasExpanded) card.classList.add('expanded');
    });

    // Download buttons
    card.querySelectorAll('.download-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadReport(record, btn.dataset.format);
        });
    });

    return card;
}

function downloadReport(record, format) {
    let content, filename, mimeType;
    if (format === 'json') {
        content = JSON.stringify(record, null, 2);
        filename = 'axion-report-' + record.id + '.json';
        mimeType = 'application/json';
    } else {
        const headers = ['ID', 'Target URL', 'Status', 'Concurrency', 'Delay (ms)', 'Duration (s)',
            'Total Requests', 'Success', 'Errors', 'Avg RPS', 'Max RPS', 'Avg Latency (ms)',
            'P99 Latency (ms)', 'Min Latency (ms)', 'Max Latency (ms)', 'Started', 'Completed'];
        const vals = [record.id, record.targetUrl, record.status, record.concurrency,
            record.requestDelayMs, record.durationSecs, record.totalRequests, record.successCount,
            record.errorCount, record.avgRPS, record.maxRPS, record.averageLatencyMs,
            record.p99LatencyMs, record.minLatencyMs, record.maxLatencyMs, record.startedAt,
            record.completedAt];
        content = headers.join(',') + '\n' + vals.map(v => '"' + v + '"').join(',');
        filename = 'axion-report-' + record.id + '.csv';
        mimeType = 'text/csv';
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Downloaded ' + format.toUpperCase(), 'success');
}

const clearBtn = document.getElementById('clearHistoryBtn');
if (clearBtn) {
    clearBtn.addEventListener('click', () => {
        if (confirm('Clear all test history?')) {
            testHistory = [];
            renderHistory();
            showToast('History cleared', 'info');
        }
    });
}

// ============================================
// Documentation — Expandable Cards
// ============================================
document.querySelectorAll('.doc-expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = btn.closest('.doc-card');
        if (!card) return;
        const wasExpanded = card.classList.contains('expanded');
        document.querySelectorAll('.doc-card.expanded').forEach(c => c.classList.remove('expanded'));
        if (!wasExpanded) {
            card.classList.add('expanded');
            setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
        }
    });
});

const docsSearch = document.getElementById('docsSearch');
if (docsSearch) {
    docsSearch.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        document.querySelectorAll('.doc-card').forEach(card => {
            const text = (card.textContent || '').toLowerCase();
            card.style.display = !q || text.includes(q) ? '' : 'none';
        });
    });
}

window.copyCode = function(btn) {
    const block = btn.closest('.doc-code-block');
    if (!block) return;
    const code = block.querySelector('code').textContent;
    navigator.clipboard.writeText(code).then(() => {
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = 'fa-solid fa-check';
            setTimeout(() => { icon.className = 'fa-solid fa-copy'; }, 2000);
        }
    }).catch(() => showToast('Failed to copy code', 'error'));
};

// ============================================
// Toast Notifications
// ============================================
function showToast(message, type) {
    type = type || 'info';
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
    toast.innerHTML = '<i class="fa-solid ' + (icons[type] || icons.info) + '"></i><span>' + message + '</span>';
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
    }, 3000);
}

// ============================================
// Helpers
// ============================================
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function setWidth(id, val) { const el = document.getElementById(id); if (el) el.style.width = val; }
function formatDuration(s) {
    if (s < 60) return s.toFixed(1) + 's';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + 'm ' + sec + 's';
}
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================
// Init
// ============================================
function initApp() {
    initTheme();
    initWelcome();
    loadNotifications();
    renderNotificationList();
    connectWebSocket();
    drawHeartbeat();
    switchView('dashboard');
    fetchHistory();
    console.log('🫀 Axion Dashboard initialized');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}