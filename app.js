/* ============================================================
   CLOCK APP - Logica principale
   Storage:
     - auth (localStorage): { users: [{ id, username, display, passHash, role, perms:{clock,goals,tasks}, createdAt }] }
     - session (sessionStorage): userId corrente
     - remember (localStorage): { userId, expiresAt } se "Salva login" attivo (30gg)
     - sessions, goals, tasks: come prima
   Regole pause:
     - "break" (Vai in pausa) = NON pagato: sottratto dalle ore lavorate
     - "lunch" (Pausa pranzo)  = PAGATO: conta come ore lavorate
     - Break entries: { in, out|null, type: 'break'|'lunch' }
   ============================================================ */

const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_ADMIN = {
    username: 'admin',
    display: 'Admin',
    password: 'Admin2026!',
};

const K = {
    AUTH: 'clockapp:auth',
    SESSIONS: 'clockapp:sessions',
    GOALS: 'clockapp:goals',
    TASKS: 'clockapp:tasks',
    SESSION_USER: 'clockapp:sessionUser',
    REMEMBER: 'clockapp:remember',
    DAYS_OFF: 'clockapp:daysOff',
    GOAL_LISTS: 'clockapp:goalLists',
    GOAL_SESSIONS: 'clockapp:goalSessions',
};

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ============ SERVER SYNC ============ */
const API_STATE  = '/api/state';
const SYNC_KEYS  = [K.AUTH, K.SESSIONS, K.GOALS, K.TASKS, K.DAYS_OFF, K.GOAL_LISTS, K.GOAL_SESSIONS];
const SYNC_DEBOUNCE_MS = 400;
let _syncTimer = null;
let _syncing   = false;
let _serverOnline = false;

async function fetchRemoteState() {
    try {
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 4000);
        const res = await fetch(API_STATE, { signal: ac.signal, cache: 'no-store' });
        clearTimeout(to);
        if (!res.ok) return null;
        _serverOnline = true;
        return await res.json();
    } catch {
        _serverOnline = false;
        return null;
    }
}

async function pushRemoteState() {
    if (_syncing) return;
    _syncing = true;
    try {
        const payload = {
            auth:         JSON.parse(localStorage.getItem(K.AUTH))          ?? { users: [] },
            sessions:     JSON.parse(localStorage.getItem(K.SESSIONS))      ?? [],
            goals:        JSON.parse(localStorage.getItem(K.GOALS))         ?? [],
            tasks:        JSON.parse(localStorage.getItem(K.TASKS))         ?? [],
            daysOff:      JSON.parse(localStorage.getItem(K.DAYS_OFF))      ?? {},
            goalLists:    JSON.parse(localStorage.getItem(K.GOAL_LISTS))    ?? [],
            goalSessions: JSON.parse(localStorage.getItem(K.GOAL_SESSIONS)) ?? [],
        };
        const res = await fetch(API_STATE, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
        });
        _serverOnline = res.ok;
        updateSyncIndicator();
    } catch (e) {
        _serverOnline = false;
        updateSyncIndicator();
        console.warn('[sync] push failed', e);
    } finally {
        _syncing = false;
    }
}

function scheduleSync() {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(pushRemoteState, SYNC_DEBOUNCE_MS);
}

// All'avvio: sostituisci localStorage con dati remoti (se il server ha già dati)
async function initSyncFromServer() {
    const remote = await fetchRemoteState();
    if (!remote) return false;
    const hasData = remote.auth && Array.isArray(remote.auth.users) && remote.auth.users.length > 0;
    if (!hasData) return true; // server online ma vuoto: teniamo il locale, verrà pushato
    localStorage.setItem(K.AUTH,          JSON.stringify(remote.auth));
    localStorage.setItem(K.SESSIONS,      JSON.stringify(remote.sessions || []));
    localStorage.setItem(K.GOALS,         JSON.stringify(remote.goals || []));
    localStorage.setItem(K.TASKS,         JSON.stringify(remote.tasks || []));
    localStorage.setItem(K.DAYS_OFF,      JSON.stringify(remote.daysOff || {}));
    localStorage.setItem(K.GOAL_LISTS,    JSON.stringify(remote.goalLists || []));
    localStorage.setItem(K.GOAL_SESSIONS, JSON.stringify(remote.goalSessions || []));
    return true;
}

// Aggiorna lo stato in-memory da server e ri-render (usato su focus)
async function refreshFromServer() {
    if (_syncing) return;
    const remote = await fetchRemoteState();
    if (!remote?.auth?.users?.length) { updateSyncIndicator(); return; }
    localStorage.setItem(K.AUTH,          JSON.stringify(remote.auth));
    localStorage.setItem(K.SESSIONS,      JSON.stringify(remote.sessions || []));
    localStorage.setItem(K.GOALS,         JSON.stringify(remote.goals || []));
    localStorage.setItem(K.TASKS,         JSON.stringify(remote.tasks || []));
    localStorage.setItem(K.DAYS_OFF,      JSON.stringify(remote.daysOff || {}));
    localStorage.setItem(K.GOAL_LISTS,    JSON.stringify(remote.goalLists || []));
    localStorage.setItem(K.GOAL_SESSIONS, JSON.stringify(remote.goalSessions || []));
    state.auth         = remote.auth;
    state.sessions     = remote.sessions || [];
    state.goals        = remote.goals || [];
    state.tasks        = remote.tasks || [];
    state.daysOff      = remote.daysOff || {};
    state.goalLists    = remote.goalLists || [];
    state.goalSessions = remote.goalSessions || [];
    if (state.currentUser) {
        const updated = state.auth.users.find(u => u.id === state.currentUser.id);
        if (updated) state.currentUser = updated;
    }
    if (state.realUser) {
        const updatedReal = state.auth.users.find(u => u.id === state.realUser.id);
        if (updatedReal) state.realUser = updatedReal;
    }
    updateSyncIndicator();
    if (!$('#app-screen').classList.contains('hidden')) renderAll();
}

function updateSyncIndicator() {
    const el = $('#sync-indicator');
    if (!el) return;
    el.classList.toggle('offline', !_serverOnline);
    el.title = _serverOnline
        ? 'Sincronizzato con il server'
        : 'Server non raggiungibile — modifiche salvate solo localmente';
}

// Refresh quando la tab torna in focus
window.addEventListener('focus', refreshFromServer);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshFromServer();
});

/* ============ STATE ============ */
let state = {
    auth: { users: [] },
    currentUser: null,
    realUser: null, // admin reale quando sta impersonando un altro utente
    sessions: [],
    goals: [],
    tasks: [],
    daysOff: {},
    goalLists: [],
    goalListFilter: 'all',
    goalSessions: [], // { [userId]: { 'YYYY-MM-DD': true } }
    currentTab: 'clock',
    taskFilter: 'all',
    periodView: 'week',
    editingGoalId: null,
    editingTaskId: null,
    editingUserId: null,
    tickerId: null,
};

/* ============ UTILS ============ */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Crea (se non esiste) una categoria/lista con nome basato sullo username
function ensureListForUser(username) {
    if (!username) return;
    const listName = username.charAt(0).toUpperCase() + username.slice(1);
    if (!state.goalLists) state.goalLists = [];
    if (state.goalLists.some(l => l.name.toLowerCase() === listName.toLowerCase())) return;
    state.goalLists.push({ id: uid(), name: listName });
    save(K.GOAL_LISTS, state.goalLists);
}

// Account pre-configurati che vengono creati su ogni browser al primo caricamento.
// Solo l'admin può creare altri utenti dal pannello Admin.
const SEED_ACCOUNTS = [
    { username: 'lorenzo', display: 'Lorenzo', password: 'Admin2026!', role: 'admin' },
    { username: 'gec',     display: 'Gec',     password: 'Gecush123',  role: 'employee' },
];

// Seed one-shot: timbrature di gec da lunedì 1 a venerdì 11 settembre 2026.
// Ogni giorno: 09:00-15:30, pausa 10:30-11:00 (non pagata), pranzo 12:30-13:00 (pagato).
// = 6h30 timbrate - 30min pausa = 6h di lavoro effettivo.
// Skip sab/dom, skip giorni già timbrati, gira una sola volta per browser (flag).
function seedGecSeptember2026() {
    const FLAG = 'clockapp:seedGecSept2026';
    if (localStorage.getItem(FLAG)) return;
    const gec = state.auth?.users?.find(u => u.username.toLowerCase() === 'gec');
    if (!gec) return;
    const start = new Date(2026, 8, 1);
    const end   = new Date(2026, 8, 11);
    let added = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow === 0 || dow === 6) continue; // salta sab/dom
        const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
        const mk = (h, min) => new Date(y, m, day, h, min, 0).toISOString();
        const dayIso = mk(0, 0).slice(0, 10);
        if (state.sessions.some(s => s.userId === gec.id && s.in && s.in.slice(0, 10) === dayIso)) continue;
        state.sessions.push({
            id: uid(),
            userId: gec.id,
            in: mk(9, 0),
            out: mk(15, 30),
            breaks: [
                { in: mk(10, 30), out: mk(11, 0),  type: 'break' },
                { in: mk(12, 30), out: mk(13, 0),  type: 'lunch' },
            ],
        });
        added++;
    }
    if (added > 0) {
        state.sessions.sort((a, b) => (b.in || '').localeCompare(a.in || ''));
        save(K.SESSIONS, state.sessions);
    }
    localStorage.setItem(FLAG, '1');
}

// Fix mirato: aggiunge (o rimpiazza) le timbrature dei giorni mancanti
// Ven 4 / Sab 5 / Mar 8 / Gio 10 settembre 2026 con la pattern standard 6h.
// Se un giorno ha già una sessione con ore molto diverse, la rimpiazza.
function seedGecMissingSeptember2026() {
    const FLAG = 'clockapp:seedGecMissingSept2026';
    if (localStorage.getItem(FLAG)) return;
    const gec = state.auth?.users?.find(u => u.username.toLowerCase() === 'gec');
    if (!gec) return;
    const missing = [4, 5, 8, 10];
    let changed = 0;
    for (const dayNum of missing) {
        const y = 2026, m = 8, day = dayNum;
        const mk = (h, min) => new Date(y, m, day, h, min, 0).toISOString();
        const dayIso = mk(0, 0).slice(0, 10);
        // Rimuovi eventuali sessioni esistenti di gec su questo giorno (potrebbero essere aperte o parziali)
        const before = state.sessions.length;
        state.sessions = state.sessions.filter(s => !(s.userId === gec.id && s.in && s.in.slice(0, 10) === dayIso));
        if (state.sessions.length !== before) changed++;
        state.sessions.push({
            id: uid(),
            userId: gec.id,
            in: mk(9, 0),
            out: mk(15, 30),
            breaks: [
                { in: mk(10, 30), out: mk(11, 0), type: 'break' },
                { in: mk(12, 30), out: mk(13, 0), type: 'lunch' },
            ],
        });
        changed++;
    }
    if (changed > 0) {
        state.sessions.sort((a, b) => (b.in || '').localeCompare(a.in || ''));
        save(K.SESSIONS, state.sessions);
    }
    localStorage.setItem(FLAG, '1');
}

async function seedDefaultAccounts() {
    if (!state.auth) state.auth = { users: [] };
    for (const s of SEED_ACCOUNTS) {
        const passHash = await sha256(s.password);
        state.auth.users.push({
            id: uid(),
            username: s.username,
            display: s.display,
            passHash,
            passPlain: s.password,
            role: s.role,
            perms: { clock: true, goals: true, tasks: true },
            createdAt: new Date().toISOString(),
        });
    }
    save(K.AUTH, state.auth);
}

async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const pad = (n) => String(n).padStart(2, '0');

function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${pad(m)}m`;
}
function fmtDurationHMS(ms) {
    const s = Math.floor(ms / 1000);
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
function fmtTime(iso) {
    const d = new Date(iso);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function dateKey(d) {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`;
}
function isDayOff(userId, dateOrKey) {
    if (!userId) return false;
    const key = typeof dateOrKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOrKey)
        ? dateOrKey : dateKey(dateOrKey);
    return !!state.daysOff?.[userId]?.[key];
}
function toggleDayOff(userId, dateOrKey) {
    const key = typeof dateOrKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOrKey)
        ? dateOrKey : dateKey(dateOrKey);
    if (!state.daysOff[userId]) state.daysOff[userId] = {};
    if (state.daysOff[userId][key]) delete state.daysOff[userId][key];
    else state.daysOff[userId][key] = true;
    if (Object.keys(state.daysOff[userId]).length === 0) delete state.daysOff[userId];
    save(K.DAYS_OFF, state.daysOff);
    return isDayOff(userId, key);
}

function fmtDayLabel(iso) {
    const d = new Date(iso);
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const target = new Date(d); target.setHours(0,0,0,0);
    if (target.getTime() === today.getTime()) return 'Oggi';
    if (target.getTime() === yesterday.getTime()) return 'Ieri';
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
}
function save(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
    if (SYNC_KEYS.includes(key)) scheduleSync();
}

/* ============ TOAST ============ */
let toastTimeout;
function toast(msg) {
    const t = $('#toast');
    $('#toast-text').textContent = msg;
    t.classList.remove('hidden');
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.classList.add('hidden'), 300);
    }, 2400);
}

/* ============ SCREEN ============ */
function showScreen(id) {
    ['login-screen', 'app-screen'].forEach(s => $('#' + s).classList.add('hidden'));
    $('#' + id).classList.remove('hidden');
}

/* ============ AUTH / BOOT ============ */
async function bootAuth() {
    // Fetch stato dal server (sostituisce localStorage se il server ha dati)
    await initSyncFromServer();
    updateSyncIndicator();

    state.auth = load(K.AUTH, { users: [] });

    // Prima installazione: seed degli account preconfigurati (admin + dipendente)
    if (!state.auth.users || state.auth.users.length === 0) {
        await seedDefaultAccounts();
    }

    // Migrazione: se admin ha ancora la password di default, popola passPlain
    const defaultAdminHash = await sha256(DEFAULT_ADMIN.password);
    let mutated = false;
    for (const u of state.auth.users) {
        if (!u.passPlain && u.role === 'admin' && u.passHash === defaultAdminHash) {
            u.passPlain = DEFAULT_ADMIN.password;
            mutated = true;
        }
    }
    if (mutated) save(K.AUTH, state.auth);

    // Prova remember-me (localStorage con scadenza)
    const remember = load(K.REMEMBER, null);
    if (remember && remember.expiresAt > Date.now()) {
        const u = state.auth.users.find(x => x.id === remember.userId);
        if (u) {
            state.currentUser = u;
            sessionStorage.setItem(K.SESSION_USER, u.id);
            enterApp();
            return;
        }
        localStorage.removeItem(K.REMEMBER);
    }
    if (remember && remember.expiresAt <= Date.now()) {
        localStorage.removeItem(K.REMEMBER);
    }

    // Prova session storage
    const sessionUserId = sessionStorage.getItem(K.SESSION_USER);
    if (sessionUserId) {
        const u = state.auth.users.find(x => x.id === sessionUserId);
        if (u) {
            state.currentUser = u;
            enterApp();
            return;
        }
    }

    showScreen('login-screen');
    setTimeout(() => $('#login-user').focus(), 300);
}

$('#welcome-continue')?.addEventListener('click', () => {
    $('#modal-welcome')?.classList.add('hidden');
    $('#login-pass').focus();
});

$('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#login-user').value.trim().toLowerCase();
    const pass = $('#login-pass').value;
    const remember = $('#login-remember').checked;
    const hash = await sha256(pass);

    const user = state.auth.users.find(u => u.username.toLowerCase() === username && u.passHash === hash);
    if (!user) {
        const err = $('#login-error');
        err.classList.remove('hidden');
        $('#login-pass').value = '';
        $('#login-pass').focus();
        setTimeout(() => err.classList.add('hidden'), 2400);
        return;
    }

    state.currentUser = user;
    sessionStorage.setItem(K.SESSION_USER, user.id);
    if (remember) {
        save(K.REMEMBER, { userId: user.id, expiresAt: Date.now() + REMEMBER_MS });
    } else {
        localStorage.removeItem(K.REMEMBER);
    }
    toast(user.role === 'admin' ? 'Accesso admin ✓' : `Ciao ${user.display.split(' ')[0]}!`);
    enterApp();
});

$('#logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem(K.SESSION_USER);
    localStorage.removeItem(K.REMEMBER);
    state.currentUser = null;
    state.realUser = null;
    $('#login-pass').value = '';
    $('#login-remember').checked = false;
    showScreen('login-screen');
    setTimeout(() => $('#login-user').focus(), 300);
});

/* ============ IMPERSONATION ============ */
function startImpersonation(userId) {
    // Solo admin reale può impersonare
    const source = state.realUser || state.currentUser;
    if (source?.role !== 'admin') return;
    const target = state.auth.users.find(u => u.id === userId);
    if (!target || target.id === source.id) return;
    state.realUser = source;
    state.currentUser = target;
    toast(`Ora visualizzi come ${target.display || target.username}`);
    enterApp();
}
function stopImpersonation() {
    if (!state.realUser) return;
    const back = state.realUser;
    state.realUser = null;
    state.currentUser = back;
    toast(`Sei tornato a ${back.display || back.username}`);
    enterApp();
}
$('#stop-impersonation-btn').addEventListener('click', stopImpersonation);

/* ============ VIEW-AS DROPDOWN (header) ============ */
function isRealAdmin() {
    const real = state.realUser || state.currentUser;
    return real?.role === 'admin';
}

function renderViewAsMenu() {
    const list = $('#viewas-menu-list');
    list.innerHTML = '';
    const realAdmin = state.realUser || state.currentUser;
    if (!realAdmin) return;

    // Opzione "Torna a te" se sto impersonando
    if (state.realUser) {
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'viewas-item viewas-back';
        back.dataset.action = 'viewas-stop';
        back.innerHTML = `
            <div class="viewas-avatar self">↩</div>
            <div class="viewas-info">
                <div class="viewas-name">Torna a ${escapeHtml(realAdmin.display || realAdmin.username)}</div>
                <div class="viewas-role">Il tuo account admin</div>
            </div>
        `;
        list.appendChild(back);
    }

    // Elenco utenti (escludi utente correntemente visualizzato)
    for (const u of state.auth.users) {
        if (u.id === state.currentUser.id) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'viewas-item' + (u.role === 'admin' ? ' is-admin' : '');
        btn.dataset.action = 'viewas-pick';
        btn.dataset.id = u.id;
        const initial = (u.display || u.username).charAt(0).toUpperCase();
        btn.innerHTML = `
            <div class="viewas-avatar">${initial}</div>
            <div class="viewas-info">
                <div class="viewas-name">${escapeHtml(u.display || u.username)}${u.role === 'admin' ? '<span class="viewas-tag">admin</span>' : ''}</div>
                <div class="viewas-role">@${escapeHtml(u.username)}</div>
            </div>
        `;
        list.appendChild(btn);
    }

    if (list.children.length === 0) {
        list.innerHTML = '<div class="viewas-empty">Nessun altro utente disponibile</div>';
    }
}

$('#viewas-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('#viewas-menu');
    const wasHidden = menu.classList.contains('hidden');
    if (wasHidden) {
        renderViewAsMenu();
        menu.classList.remove('hidden');
        $('#viewas-btn').classList.add('open');
    } else {
        menu.classList.add('hidden');
        $('#viewas-btn').classList.remove('open');
    }
});

// Click su un item della lista
$('#viewas-menu-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    $('#viewas-menu').classList.add('hidden');
    $('#viewas-btn').classList.remove('open');
    if (action === 'viewas-stop') stopImpersonation();
    else if (action === 'viewas-pick') {
        if (state.realUser && id === state.realUser.id) stopImpersonation();
        else startImpersonation(id);
    }
});

// Chiudi al click fuori
document.addEventListener('click', (e) => {
    if (!e.target.closest('#viewas-wrap')) {
        $('#viewas-menu').classList.add('hidden');
        $('#viewas-btn').classList.remove('open');
    }
});
// Chiudi con Esc
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        $('#viewas-menu').classList.add('hidden');
        $('#viewas-btn').classList.remove('open');
    }
});

/* ============ PERMS ============ */
function can(perm) {
    const u = state.currentUser;
    if (!u) return false;
    if (u.role === 'admin') return true;
    return !!u.perms?.[perm];
}

/* ============ ENTER APP ============ */
function enterApp() {
    state.sessions = load(K.SESSIONS, []);
    let migrated = false;
    for (const s of state.sessions) {
        if (!Array.isArray(s.breaks)) { s.breaks = []; migrated = true; }
    }
    if (migrated) save(K.SESSIONS, state.sessions);

    state.goals = load(K.GOALS, []);
    state.tasks = load(K.TASKS, []);
    state.daysOff = load(K.DAYS_OFF, {});
    state.goalLists = load(K.GOAL_LISTS, []);
    state.goalSessions = load(K.GOAL_SESSIONS, []);
    // Seed liste: una per ogni utente esistente (se mancante)
    for (const u of state.auth.users) ensureListForUser(u.username);
    // Seed one-shot delle timbrature storiche di gec (1-11 sett 2026)
    seedGecSeptember2026();
    seedGecMissingSeptember2026();

    const u = state.currentUser;
    const isAdmin = u.role === 'admin';
    const firstName = u.display ? u.display.split(' ')[0] : u.username;
    $('#user-greeting').textContent = isAdmin ? `Admin · ${u.display || u.username}` : `Ciao ${firstName}`;
    $('.tab-admin').classList.toggle('hidden', !isAdmin);

    // Applica permessi ai tab
    $$('.tab[data-perm]').forEach(tab => {
        const allowed = can(tab.dataset.perm);
        tab.classList.toggle('hidden', !allowed);
    });

    // Se il tab corrente non è consentito, vai al primo consentito
    const allowedTabs = [...$$('.tab')].filter(t => !t.classList.contains('hidden')).map(t => t.dataset.tab);
    const activeTab = document.querySelector('.tab.active')?.dataset.tab;
    let targetTab = activeTab;
    if (!allowedTabs.includes(activeTab)) targetTab = allowedTabs[0];
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === targetTab));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === targetTab));
    state.currentTab = targetTab;

    // Banner impersonation
    const banner = $('#impersonation-banner');
    if (state.realUser) {
        banner.classList.remove('hidden');
        $('#imp-name').textContent = u.display || u.username;
    } else {
        banner.classList.add('hidden');
    }

    // Bottone "Visualizza come" (solo per admin reale)
    $('#viewas-wrap').classList.toggle('hidden', !isRealAdmin());
    // Chiudi menu se aperto
    $('#viewas-menu').classList.add('hidden');
    $('#viewas-btn').classList.remove('open');

    showScreen('app-screen');
    startLiveClock();
    renderAll();
}

/* ============ SESSION MATH ============ */
// Somma il tempo delle pause NON pagate (type 'break' o legacy senza type)
function breakMs(sess, now = Date.now()) {
    let total = 0;
    for (const b of (sess.breaks || [])) {
        if (b.type === 'lunch') continue;
        const start = new Date(b.in).getTime();
        const end = b.out ? new Date(b.out).getTime() : now;
        total += Math.max(0, end - start);
    }
    return total;
}
// Somma il tempo di pausa pranzo (pagato)
function lunchMs(sess, now = Date.now()) {
    let total = 0;
    for (const b of (sess.breaks || [])) {
        if (b.type !== 'lunch') continue;
        const start = new Date(b.in).getTime();
        const end = b.out ? new Date(b.out).getTime() : now;
        total += Math.max(0, end - start);
    }
    return total;
}
// Il pranzo è pagato, quindi non viene sottratto: sottraiamo solo i break non pagati
function workMs(sess, now = Date.now()) {
    const start = new Date(sess.in).getTime();
    const end = sess.out ? new Date(sess.out).getTime() : now;
    return Math.max(0, (end - start) - breakMs(sess, now));
}
function activeBreak(sess) { return (sess.breaks || []).find(b => !b.out) || null; }
// Sessioni dell'utente loggato (per stats/history/clock personali)
function mySessions() {
    const uid = state.currentUser?.id;
    return state.sessions.filter(s => s.userId === uid);
}
// Sessione aperta dell'utente loggato (clock in/out riguarda solo lui)
function openSession() {
    const uid = state.currentUser?.id;
    return state.sessions.find(s => !s.out && s.userId === uid);
}

/* ============ TABS ============ */
$$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        if (tab.classList.contains('hidden')) return;
        const target = tab.dataset.tab;
        $$('.tab').forEach(t => t.classList.toggle('active', t === tab));
        $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === target));
        state.currentTab = target;
    });
});

/* ============ LIVE CLOCK ============ */
function startLiveClock() {
    const tick = () => {
        const now = new Date();
        $('#live-time').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        $('#live-date').textContent = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
        updateSessionTimer();
        updateGoalTimers();
    };
    tick();
    if (state.tickerId) clearInterval(state.tickerId);
    state.tickerId = setInterval(tick, 1000);
}

function updateSessionTimer() {
    const open = openSession();
    const tSection = $('#session-timer');
    const bd = $('#session-breakdown');
    if (!open) { tSection.classList.add('hidden'); return; }
    const activeB = activeBreak(open);
    const isLunch = activeB?.type === 'lunch';
    const isBreak = activeB && !isLunch;
    const bMs = breakMs(open);
    const lMs = lunchMs(open);
    const wMs = workMs(open);
    $('#session-value').textContent = fmtDurationHMS(wMs);
    tSection.classList.remove('hidden');
    tSection.classList.toggle('paused', isBreak);
    tSection.classList.toggle('lunch', isLunch);
    $('.session-label', tSection).textContent = isLunch
        ? 'Pausa pranzo · le ore continuano a contare'
        : isBreak
            ? 'In pausa · lavoro fermo'
            : 'Sessione in corso';
    const parts = [];
    if (bMs > 0) parts.push(`Pause: ${fmtDurationHMS(bMs)}`);
    if (lMs > 0) parts.push(`Pranzo: ${fmtDurationHMS(lMs)}`);
    if (parts.length > 0) {
        bd.textContent = parts.join(' · ');
        bd.classList.remove('hidden');
    } else {
        bd.classList.add('hidden');
    }
}

/* ============ CLOCK IN / OUT ============ */
$('#clock-btn').addEventListener('click', () => {
    if (!can('clock')) return toast('Non hai il permesso di timbrare');
    const open = openSession();
    if (open) {
        const b = activeBreak(open);
        if (b) b.out = new Date().toISOString();
        open.out = new Date().toISOString();
        save(K.SESSIONS, state.sessions);
        toast(`Uscita registrata • ${fmtDuration(workMs(open))} lavorati`);
        openNotesModal(open);
    } else {
        state.sessions.unshift({ id: uid(), userId: state.currentUser.id, in: new Date().toISOString(), out: null, breaks: [] });
        save(K.SESSIONS, state.sessions);
        toast('Buon lavoro! 💪');
        confettiBurst();
    }
    renderClockPanel();
});

/* ============ NOTE SESSIONE (post clock-out) ============ */
let _notesSessionId = null;
function openNotesModal(session) {
    _notesSessionId = session.id;
    const workStr = fmtDuration(workMs(session));
    const breakStr = fmtDuration(breakMs(session));
    const lunchStr = fmtDuration(lunchMs(session));
    const parts = [`Sessione: ${workStr} lavorati`];
    if (breakMs(session) > 0) parts.push(`pausa ${breakStr}`);
    if (lunchMs(session) > 0) parts.push(`pranzo ${lunchStr}`);
    $('#notes-summary').textContent = parts.join(' · ');
    $('#notes-text').value = session.notes || '';
    $('#modal-notes').classList.remove('hidden');
    setTimeout(() => $('#notes-text').focus(), 150);
}
$('#notes-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!_notesSessionId) return;
    const val = $('#notes-text').value.trim();
    if (val.length < 3) {
        toast('Scrivi almeno 3 caratteri di note');
        $('#notes-text').focus();
        return;
    }
    const s = state.sessions.find(x => x.id === _notesSessionId);
    if (s) {
        s.notes = val;
        save(K.SESSIONS, state.sessions);
    }
    _notesSessionId = null;
    $('#modal-notes').classList.add('hidden');
    toast('📝 Note salvate');
    renderClockPanel();
});

$('#break-btn').addEventListener('click', () => {
    const open = openSession();
    if (!open) return;
    const b = activeBreak(open);
    if (b && b.type !== 'lunch') {
        b.out = new Date().toISOString();
        toast('Bentornato! Ora si riprende 🚀');
    } else if (!b) {
        open.breaks.push({ in: new Date().toISOString(), out: null, type: 'break' });
        toast('Pausa avviata ☕');
    }
    save(K.SESSIONS, state.sessions);
    renderClockPanel();
});

$('#lunch-btn').addEventListener('click', () => {
    const open = openSession();
    if (!open) return;
    const b = activeBreak(open);
    if (b && b.type === 'lunch') {
        b.out = new Date().toISOString();
        toast('Buon rientro! 🍽');
    } else if (!b) {
        open.breaks.push({ in: new Date().toISOString(), out: null, type: 'lunch' });
        toast('Buon pranzo! 🍝');
    }
    save(K.SESSIONS, state.sessions);
    renderClockPanel();
});

function renderClockPanel() {
    const open = openSession();
    const btn = $('#clock-btn');
    const pill = $('#status-pill');
    const actions = $('#break-actions');
    const breakBtn = $('#break-btn');
    const lunchBtn = $('#lunch-btn');
    const activeB = open ? activeBreak(open) : null;
    const isLunch = activeB?.type === 'lunch';
    const isBreak = activeB && !isLunch;

    if (open) {
        btn.classList.add('active');
        $('#clock-btn-label').textContent = 'CLOCK OUT';
        $('#clock-btn-sub').textContent = 'Termina la sessione';
        actions.classList.remove('hidden');

        // Break button
        breakBtn.classList.toggle('paused', isBreak);
        breakBtn.classList.toggle('hidden', isLunch); // nascondi durante il pranzo
        $('#break-btn-label').textContent = isBreak ? 'Riprendi lavoro' : 'Vai in pausa';

        // Lunch button
        lunchBtn.classList.toggle('active', isLunch);
        lunchBtn.classList.toggle('hidden', isBreak); // nascondi durante la pausa
        $('#lunch-btn-label').textContent = isLunch ? 'Fine pausa pranzo' : 'Pausa pranzo';

        pill.classList.toggle('active', !activeB);
        pill.classList.toggle('paused', isBreak);
        pill.classList.toggle('lunch', isLunch);
        $('#status-text').textContent = isLunch ? 'In pausa pranzo' : isBreak ? 'In pausa' : 'In servizio';
    } else {
        btn.classList.remove('active');
        $('#clock-btn-label').textContent = 'CLOCK IN';
        $('#clock-btn-sub').textContent = 'Inizia la sessione';
        pill.classList.remove('active', 'paused', 'lunch');
        $('#status-text').textContent = 'Fuori servizio';
        actions.classList.add('hidden');
    }
    updateSessionTimer();
    renderStats();
    renderHistory();
    renderWeekly();
}

/* ============ STATS ============ */
function renderStats() {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0);
    const dow = (now.getDay() + 6) % 7;
    const startOfWeek = new Date(startOfDay); startOfWeek.setDate(startOfDay.getDate() - dow);

    let todayWork = 0, weekWork = 0, sessionsToday = 0;
    let todayBreak = 0, todayLunch = 0;
    const workedDaysSet = new Set();

    for (const s of mySessions()) {
        const inD = new Date(s.in);
        const w = workMs(s);
        const b = breakMs(s);
        const l = lunchMs(s);
        if (inD >= startOfDay) { todayWork += w; sessionsToday++; todayBreak += b; todayLunch += l; }
        if (inD >= startOfWeek) {
            weekWork += w;
            const key = inD.toDateString();
            workedDaysSet.add(key);
        }
    }
    $('#stat-today').textContent      = fmtDuration(todayWork);
    $('#stat-today-sub').textContent  = `${sessionsToday} ${sessionsToday === 1 ? 'sessione' : 'sessioni'}`;
    $('#stat-week').textContent       = fmtDuration(weekWork);
    $('#stat-week-sub').textContent   = `${workedDaysSet.size} ${workedDaysSet.size === 1 ? 'giorno lavorato' : 'giorni lavorati'}`;
    $('#stat-breaks').textContent     = fmtDuration(todayBreak);
    $('#stat-breaks-sub').textContent = todayLunch > 0
        ? `pranzo: ${fmtDuration(todayLunch)} (pagato)`
        : 'pause non pagate';
}

/* ============ HISTORY ============ */
function renderHistory() {
    const list = $('#history-list');
    const empty = $('#history-empty');
    list.innerHTML = '';
    const mine = mySessions();
    if (mine.length === 0) {
        empty.classList.remove('hidden');
        $('#history-count').textContent = '0 sessioni';
        return;
    }
    empty.classList.add('hidden');
    $('#history-count').textContent = `${mine.length} ${mine.length === 1 ? 'sessione' : 'sessioni'}`;

    const items = mine.slice(0, 30);
    for (const s of items) {
        const isOpen = !s.out;
        const w = workMs(s);
        const b = breakMs(s);
        const l = lunchMs(s);
        const el = document.createElement('div');
        el.className = 'history-item' + (isOpen ? ' open' : '');
        const extras = [];
        if (b > 0) extras.push(`pausa ${fmtDuration(b)}`);
        if (l > 0) extras.push(`🍽 ${fmtDuration(l)}`);
        const breakInfo = extras.length > 0 ? `<span class="muted" style="font-size:11px;margin-left:8px">· ${extras.join(' · ')}</span>` : '';
        const notesHtml = s.notes ? `<div class="history-notes">📝 ${escapeHtml(s.notes)}</div>` : '';
        el.innerHTML = `
            <div class="day">${fmtDayLabel(s.in)}</div>
            <div class="times">
                <span>${fmtTime(s.in)}</span>
                <span class="arrow">→</span>
                <span>${isOpen ? '<em style="color:var(--success)">in corso</em>' : fmtTime(s.out)}</span>
                ${breakInfo}
            </div>
            <div class="duration">${fmtDuration(w)}</div>
            ${notesHtml}
        `;
        list.appendChild(el);
    }
}

/* ============ WEEKLY / MONTHLY ============ */
function aggregateDays(startDate, dayCount, userId = null) {
    const start = new Date(startDate); start.setHours(0,0,0,0);
    const days = [];
    for (let i = 0; i < dayCount; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        days.push({ date: d, workMs: 0, breakMs: 0, lunchMs: 0, sessions: 0 });
    }
    const endMs = start.getTime() + dayCount * 86400000;
    const source = userId ? state.sessions.filter(s => s.userId === userId) : state.sessions;
    for (const s of source) {
        const inD = new Date(s.in);
        const t = new Date(inD).setHours(0,0,0,0);
        if (t < start.getTime() || t >= endMs) continue;
        const idx = Math.floor((t - start.getTime()) / 86400000);
        days[idx].workMs  += workMs(s);
        days[idx].breakMs += breakMs(s);
        days[idx].lunchMs += lunchMs(s);
        days[idx].sessions++;
    }
    return days;
}

function getPeriodRange() {
    const now = new Date();
    if (state.periodView === 'month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const count = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        return { start, count, label: 'mese' };
    }
    const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0);
    const dow = (now.getDay() + 6) % 7;
    const start = new Date(startOfDay); start.setDate(startOfDay.getDate() - dow);
    return { start, count: 7, label: 'settimana' };
}

function renderWeekly() {
    const { start, count, label } = getPeriodRange();
    const isAdmin = state.currentUser?.role === 'admin';
    const isMonth = label === 'mese';

    // Header: titolo + range
    if (isMonth) {
        const name = start.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
        $('#period-title').textContent = 'Riepilogo mese';
        $('#week-range').textContent = name.charAt(0).toUpperCase() + name.slice(1);
    } else {
        const end = new Date(start); end.setDate(start.getDate() + 6);
        const fmtRange = (d) => `${pad(d.getDate())}/${pad(d.getMonth()+1)}`;
        $('#period-title').textContent = 'Riepilogo settimana';
        $('#week-range').textContent = `${fmtRange(start)} – ${fmtRange(end)}`;
    }

    if (isAdmin) {
        renderUserMatrix(start, count, isMonth);
    } else {
        renderOwnDays(start, count, isMonth);
    }
}

function renderMonth() { renderWeekly(); }

function renderOwnDays(start, count, isMonth) {
    // Vista classica per dipendente: celle giorno con le SUE ore
    const days = aggregateDays(start, count, state.currentUser?.id);
    let totalWork = 0, workedDays = 0;
    for (const d of days) { totalWork += d.workMs; if (d.workMs > 0) workedDays++; }

    $('#week-days-count').textContent = workedDays;
    $('#week-days-label').textContent = workedDays === 1 ? 'giorno lavorato' : 'giorni lavorati';
    $('#week-hours-count').textContent = fmtDuration(totalWork);
    $('#month-weekhdr').classList.toggle('hidden', !isMonth);
    $('#user-matrix-wrap').classList.add('hidden');

    const list = $('#week-list');
    list.classList.remove('hidden');
    list.className = 'week-list' + (isMonth ? ' month-view' : '');
    list.innerHTML = '';
    if (isMonth) {
        const firstDow = (start.getDay() + 6) % 7;
        for (let i = 0; i < firstDow; i++) {
            const blank = document.createElement('div');
            blank.className = 'week-day blank';
            list.appendChild(blank);
        }
        for (let i = 0; i < count; i++) list.appendChild(dayCell(days[i], null, true));
    } else {
        const dayNames = ['LUN','MAR','MER','GIO','VEN','SAB','DOM'];
        for (let i = 0; i < 7; i++) list.appendChild(dayCell(days[i], dayNames[i], false));
    }
}

function renderUserMatrix(start, count, isMonth) {
    // Vista admin: matrice utenti × giorni
    $('#week-list').classList.add('hidden');
    $('#month-weekhdr').classList.add('hidden');
    $('#user-matrix-wrap').classList.remove('hidden');

    // Aggrega per utente
    const rows = state.auth.users.map(u => {
        const days = aggregateDays(start, count, u.id);
        const total = days.reduce((sum, d) => sum + d.workMs, 0);
        return { user: u, days, total };
    }).sort((a, b) => b.total - a.total);

    // Header totali (grand total su tutti gli utenti)
    let grandWork = 0;
    const workedDaysGlobal = new Set();
    for (const r of rows) {
        for (let i = 0; i < r.days.length; i++) {
            grandWork += r.days[i].workMs;
            if (r.days[i].workMs > 0) workedDaysGlobal.add(i + '|' + r.user.id);
        }
    }
    $('#week-days-count').textContent = rows.reduce((s, r) => s + r.days.filter(d => d.workMs > 0).length, 0);
    $('#week-days-label').textContent = 'giorni-persona lavorati';
    $('#week-hours-count').textContent = fmtDuration(grandWork);

    // Costruzione grid
    const matrix = $('#user-matrix');
    matrix.innerHTML = '';
    matrix.style.gridTemplateColumns = `minmax(160px, 200px) repeat(${count}, minmax(32px, 1fr)) minmax(80px, 100px)`;

    // Riga header
    const hdrUser = document.createElement('div');
    hdrUser.className = 'mx-hdr mx-user-col';
    hdrUser.textContent = 'Utente';
    matrix.appendChild(hdrUser);

    const today = new Date(); today.setHours(0,0,0,0);
    const dayNames = ['L','M','M','G','V','S','D'];
    for (let i = 0; i < count; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const isToday = d.toDateString() === new Date().toDateString();
        const cell = document.createElement('div');
        cell.className = 'mx-hdr mx-day-hdr' + (isToday ? ' today' : '');
        if (isMonth) {
            cell.innerHTML = `<div class="mx-day-num">${d.getDate()}</div><div class="mx-day-name">${dayNames[(d.getDay() + 6) % 7]}</div>`;
        } else {
            const idx = i;
            cell.innerHTML = `<div class="mx-day-name">${['LUN','MAR','MER','GIO','VEN','SAB','DOM'][idx]}</div><div class="mx-day-num">${d.getDate()}</div>`;
        }
        matrix.appendChild(cell);
    }
    const hdrTotal = document.createElement('div');
    hdrTotal.className = 'mx-hdr mx-total-col';
    hdrTotal.textContent = 'Totale';
    matrix.appendChild(hdrTotal);

    // Righe utente
    for (const row of rows) {
        const u = row.user;
        const isSelf = u.id === state.currentUser.id;
        const userCell = document.createElement('div');
        userCell.className = 'mx-user-cell' + (u.role === 'admin' ? ' is-admin' : '');
        userCell.innerHTML = `
            <div class="mx-avatar">${(u.display || u.username).charAt(0).toUpperCase()}</div>
            <div class="mx-user-info">
                <div class="mx-user-name">${escapeHtml(u.display || u.username)}${isSelf ? '<span class="mx-you">tu</span>' : ''}</div>
                ${u.role === 'admin' ? '<div class="mx-user-role">Admin</div>' : ''}
            </div>
        `;
        matrix.appendChild(userCell);

        for (let i = 0; i < count; i++) {
            const d = row.days[i];
            const dateObj = d.date;
            const isFuture = dateObj.getTime() > Date.now();
            const isToday = dateObj.toDateString() === new Date().toDateString();
            const worked = d.workMs > 0;
            const off = isDayOff(u.id, dateObj);
            const hours = Math.floor(d.workMs / 3600000);
            const mins = Math.round((d.workMs % 3600000) / 60000);
            const cell = document.createElement('div');
            cell.className = 'mx-day'
                + (worked ? ' worked' : '')
                + (off ? ' day-off' : '')
                + (isFuture ? ' future' : '')
                + (isToday ? ' today' : '');
            // Admin: TUTTE le celle sono cliccabili (per gestire giorni liberi)
            cell.dataset.dayIso = dateObj.toISOString();
            cell.dataset.userId = u.id;
            cell.setAttribute('role', 'button');
            cell.setAttribute('tabindex', '0');
            const tag = worked ? fmtDuration(d.workMs) : off ? 'giorno libero' : 'nessuna sessione';
            cell.title = `${(u.display || u.username)} · ${dateObj.toLocaleDateString('it-IT')} · ${tag}`;
            if (worked) {
                let label;
                if (hours >= 1) label = `${hours}h${mins >= 30 ? '⁺' : ''}`;
                else label = `${mins}m`;
                cell.innerHTML = `<span class="mx-day-val">${label}</span>`;
                if (d.lunchMs > 0) cell.innerHTML += `<span class="mx-flag lunch" title="Pausa pranzo">🍽</span>`;
                if (d.breakMs > 0) cell.innerHTML += `<span class="mx-flag break" title="Pausa">☕</span>`;
                if (off) cell.innerHTML += `<span class="mx-flag off" title="Giorno libero (ma ha lavorato)">🏖</span>`;
            } else if (off) {
                cell.innerHTML = `<span class="mx-day-off-icon">🏖</span>`;
            }
            matrix.appendChild(cell);
        }

        const totalCell = document.createElement('div');
        totalCell.className = 'mx-total-cell' + (row.total > 0 ? ' worked' : '');
        totalCell.textContent = fmtDuration(row.total);
        matrix.appendChild(totalCell);
    }
}

function dayCell(d, dayName, isMonthView) {
    const isToday = d.date.toDateString() === new Date().toDateString();
    const isFuture = d.date.getTime() > Date.now();
    const worked = d.workMs > 0;
    const off = isDayOff(state.currentUser?.id, d.date);
    const el = document.createElement('div');
    el.className = 'week-day'
        + (isToday ? ' today' : '')
        + (worked ? ' worked' : '')
        + (off ? ' day-off' : '')
        + (isFuture ? ' future' : '');
    // Tutte le celle cliccabili (per gestire i giorni liberi)
    el.dataset.dayIso = d.date.toISOString();
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    const metaParts = [];
    if (worked && !isMonthView) {
        metaParts.push(`${d.sessions}×`);
        if (d.breakMs > 0) metaParts.push(`pausa ${fmtDuration(d.breakMs)}`);
        if (d.lunchMs > 0) metaParts.push(`🍽 ${fmtDuration(d.lunchMs)}`);
    }
    const hoursDisplay = worked
        ? fmtDuration(d.workMs)
        : off
            ? '🏖'
            : '—';
    el.innerHTML = `
        ${dayName ? `<div class="wd-name">${dayName}</div>` : ''}
        <div class="wd-num">${pad(d.date.getDate())}</div>
        <div class="wd-hours ${worked ? '' : off ? 'off' : 'empty'}">${hoursDisplay}</div>
        ${!worked && off ? '<div class="wd-meta wd-off-label">Libero</div>' : ''}
        ${metaParts.length > 0 ? `<div class="wd-meta">${metaParts.join(' · ')}</div>` : ''}
    `;
    return el;
}

/* ============ DAY DETAIL MODAL ============ */
function openDayModal(dayStart, userId = null) {
    const start = new Date(dayStart); start.setHours(0,0,0,0);
    // Se non è specificato un utente: admin vede tutti, dipendente vede solo se stesso
    const filterUser = userId || (state.currentUser?.role === 'admin' ? null : state.currentUser?.id);
    const daySessions = state.sessions
        .filter(s => {
            if (filterUser && s.userId !== filterUser) return false;
            const t = new Date(s.in); t.setHours(0,0,0,0);
            return t.getTime() === start.getTime();
        })
        .sort((a, b) => new Date(a.in) - new Date(b.in));

    let totalWork = 0, totalBreak = 0, totalLunch = 0;
    for (const s of daySessions) {
        totalWork  += workMs(s);
        totalBreak += breakMs(s);
        totalLunch += lunchMs(s);
    }

    const isToday = start.toDateString() === new Date().toDateString();
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(0,0,0,0);
    const isYesterday = start.getTime() === yesterday.getTime();
    let title = isToday ? 'Oggi' : isYesterday ? 'Ieri' : start.toLocaleDateString('it-IT', { weekday: 'long' }).replace(/^./, c => c.toUpperCase());
    // Se filtrato per utente, aggiungi il nome
    if (userId) {
        const u = state.auth.users.find(x => x.id === userId);
        if (u) title = `${u.display || u.username} · ${title}`;
    }
    $('#day-detail-title').textContent = title;
    $('#day-detail-date').textContent = start.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
    $('#day-work').textContent  = fmtDuration(totalWork);
    $('#day-break').textContent = fmtDuration(totalBreak);
    $('#day-lunch').textContent = fmtDuration(totalLunch);

    const list = $('#day-sessions');
    list.innerHTML = '';
    if (daySessions.length === 0) {
        list.innerHTML = '<div class="muted" style="text-align:center;padding:16px">Nessuna sessione</div>';
    } else {
        for (const s of daySessions) {
            const w = workMs(s);
            const b = breakMs(s);
            const l = lunchMs(s);
            const user = state.auth.users.find(u => u.id === s.userId);
            const userTag = user ? user.display || user.username : null;
            const extras = [];
            if (b > 0) extras.push(`<span class="sess-tag break">pausa ${fmtDuration(b)}</span>`);
            if (l > 0) extras.push(`<span class="sess-tag lunch">🍽 ${fmtDuration(l)}</span>`);
            const el = document.createElement('div');
            el.className = 'day-session-item' + (!s.out ? ' open' : '');
            const notesHtml = s.notes ? `<div class="sess-notes">📝 ${escapeHtml(s.notes)}</div>` : '';
            el.innerHTML = `
                <div class="sess-times">
                    <span class="sess-time">${fmtTime(s.in)}</span>
                    <span class="sess-arrow">→</span>
                    <span class="sess-time">${s.out ? fmtTime(s.out) : '<em>in corso</em>'}</span>
                </div>
                <div class="sess-meta">
                    ${userTag ? `<span class="sess-tag user">${escapeHtml(userTag)}</span>` : ''}
                    ${extras.join('')}
                </div>
                <div class="sess-duration">${fmtDuration(w)}</div>
                ${notesHtml}
            `;
            list.appendChild(el);
        }
    }

    // Sezione giorno libero: admin può gestire chiunque, dipendente solo se stesso
    const targetUserId = filterUser || state.currentUser?.id;
    const canEditOff = state.currentUser?.role === 'admin' || targetUserId === state.currentUser?.id;
    const off = isDayOff(targetUserId, start);
    const offSection = $('#day-off-section');
    const offBadge = $('#day-off-badge');
    offSection.classList.toggle('hidden', !canEditOff);
    offBadge.classList.toggle('hidden', !off);
    const toggleBtn = $('#day-off-toggle');
    toggleBtn.dataset.userId = targetUserId;
    toggleBtn.dataset.dayKey = dateKey(start);
    toggleBtn.classList.toggle('active', off);
    $('#day-off-icon').textContent = off ? '✕' : '🏖';
    $('#day-off-label').textContent = off ? 'Rimuovi giorno libero' : 'Segna come giorno libero';

    $('#modal-day').classList.remove('hidden');
}

// Toggle giorno libero dal modal
$('#day-off-toggle').addEventListener('click', () => {
    const btn = $('#day-off-toggle');
    const uid = btn.dataset.userId;
    const key = btn.dataset.dayKey;
    if (!uid || !key) return;
    const nowOff = toggleDayOff(uid, key);
    toast(nowOff ? '🏖 Giorno libero salvato' : 'Giorno libero rimosso');
    btn.classList.toggle('active', nowOff);
    $('#day-off-icon').textContent = nowOff ? '✕' : '🏖';
    $('#day-off-label').textContent = nowOff ? 'Rimuovi giorno libero' : 'Segna come giorno libero';
    $('#day-off-badge').classList.toggle('hidden', !nowOff);
    renderWeekly();
});

// Click / keyboard su celle giorno (weekly, monthly, matrix)
document.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-day-iso]');
    if (!cell) return;
    openDayModal(cell.dataset.dayIso, cell.dataset.userId || null);
});
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const cell = document.activeElement?.closest?.('[data-day-iso]');
    if (!cell) return;
    e.preventDefault();
    openDayModal(cell.dataset.dayIso, cell.dataset.userId || null);
});

/* ============ DATE PICKER (calendario custom inline) ============ */
const _pickers = {};

function createInlinePicker(id) {
    const hidden    = document.getElementById(id);
    const title     = document.getElementById(id + '-title');
    const grid      = document.getElementById(id + '-grid');
    const container = document.getElementById(id + '-picker');
    if (!hidden || !title || !grid || !container) return null;

    let viewYear, viewMonth;

    function render() {
        const sel = hidden.value ? new Date(hidden.value + 'T00:00:00') : null;
        if (sel) sel.setHours(0,0,0,0);
        const today = new Date(); today.setHours(0,0,0,0);

        const first = new Date(viewYear, viewMonth, 1);
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const firstDow = (first.getDay() + 6) % 7;
        const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();

        const monthName = first.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
        title.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

        grid.innerHTML = '';
        for (let i = 0; i < 42; i++) {
            let day, m, y, isOther = false;
            if (i < firstDow) {
                day = daysInPrev - firstDow + i + 1;
                m = viewMonth - 1; y = viewYear;
                if (m < 0) { m = 11; y--; }
                isOther = true;
            } else if (i < firstDow + daysInMonth) {
                day = i - firstDow + 1;
                m = viewMonth; y = viewYear;
            } else {
                day = i - firstDow - daysInMonth + 1;
                m = viewMonth + 1; y = viewYear;
                if (m > 11) { m = 0; y++; }
                isOther = true;
            }
            const d = new Date(y, m, day);
            const iso = dateKey(d);
            const isToday    = d.getTime() === today.getTime();
            const isSelected = sel && d.getTime() === sel.getTime();

            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'dp-day'
                + (isOther ? ' other' : '')
                + (isToday ? ' today' : '')
                + (isSelected ? ' selected' : '');
            cell.textContent = day;
            cell.dataset.iso = iso;
            grid.appendChild(cell);
        }
    }

    function setValue(iso) {
        hidden.value = iso || '';
        if (iso) {
            const d = new Date(iso + 'T00:00:00');
            viewYear  = d.getFullYear();
            viewMonth = d.getMonth();
        } else {
            const n = new Date();
            viewYear  = n.getFullYear();
            viewMonth = n.getMonth();
        }
        render();
    }

    container.addEventListener('click', (e) => {
        const nav = e.target.closest('[data-nav]');
        if (nav) {
            viewMonth += parseInt(nav.dataset.nav, 10);
            if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
            if (viewMonth > 11) { viewMonth = 0;  viewYear++; }
            render();
            return;
        }
        const dayBtn = e.target.closest('.dp-day');
        if (dayBtn) { setValue(dayBtn.dataset.iso); return; }
        const action = e.target.closest('[data-action]');
        if (action) {
            if (action.dataset.action === 'clear') setValue(null);
            else if (action.dataset.action === 'today') setValue(dateKey(new Date()));
        }
    });

    _pickers[id] = { setValue, getValue: () => hidden.value };
    setValue(null);
    return _pickers[id];
}

createInlinePicker('goal-due');

/* ============ GOALS ============ */
$('#add-goal-btn').addEventListener('click', () => openGoalModal());

function openGoalModal(goal = null) {
    state.editingGoalId = goal?.id ?? null;
    $('#modal-goal-title').textContent = goal ? 'Modifica obiettivo' : 'Nuovo obiettivo';
    $('#goal-title').value = goal?.title ?? '';
    $('#goal-desc').value  = goal?.desc ?? '';
    renderGoalListPicker(goal?.listId ?? null);
    _pickers['goal-due']?.setValue(goal?.due ?? null);
    $('#modal-goal').classList.remove('hidden');
    setTimeout(() => $('#goal-title').focus(), 100);
}

$('#goal-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#goal-title').value.trim();
    if (!title) return;
    const listId = $('#goal-list-id').value || null;
    const data = {
        title,
        desc: $('#goal-desc').value.trim(),
        due:  $('#goal-due').value || null,
        listId,
    };
    if (state.editingGoalId) {
        const g = state.goals.find(x => x.id === state.editingGoalId);
        Object.assign(g, data);
        toast('Obiettivo aggiornato');
    } else {
        state.goals.unshift({ id: uid(), ...data, createdAt: new Date().toISOString(), completed: false });
        toast('Nuovo obiettivo creato 🎯');
    }
    save(K.GOALS, state.goals);
    closeModals();
    renderGoals();
    renderTaskGoalOptions();
});

function renderGoalListPicker(currentListId) {
    const wrap = $('#goal-list-picker');
    const hidden = $('#goal-list-id');
    wrap.innerHTML = '';
    // Se non c'è una lista o quella scelta non esiste più, default alla prima
    const validIds = new Set(state.goalLists.map(l => l.id));
    if (!validIds.has(currentListId)) currentListId = state.goalLists[0]?.id ?? '';
    hidden.value = currentListId;
    for (const l of state.goalLists) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'list-pill' + (currentListId === l.id ? ' active' : '');
        b.dataset.listId = l.id;
        b.textContent = l.name;
        wrap.appendChild(b);
    }
}

// Click su una pill nel modal
$('#goal-list-picker').addEventListener('click', (e) => {
    const p = e.target.closest('.list-pill');
    if (!p) return;
    $$('#goal-list-picker .list-pill').forEach(x => x.classList.toggle('active', x === p));
    $('#goal-list-id').value = p.dataset.listId || '';
});

function renderGoalsFilter() {
    const row = $('#goals-filter');
    if (!row) return;
    row.innerHTML = '';
    const mk = (id, label, extra = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (state.goalListFilter === id ? ' active' : '') + (extra ? ' ' + extra : '');
        b.dataset.listFilter = id;
        b.textContent = label;
        return b;
    };
    row.appendChild(mk('all', 'Tutte'));
    for (const l of state.goalLists) row.appendChild(mk(l.id, l.name));
    const archivedCount = state.goals.filter(g => g.archived).length;
    row.appendChild(mk('archived', `Storico${archivedCount > 0 ? ' · ' + archivedCount : ''}`, 'chip-archive'));
}

$('#goals-filter').addEventListener('click', (e) => {
    const c = e.target.closest('[data-list-filter]');
    if (!c) return;
    state.goalListFilter = c.dataset.listFilter;
    renderGoals();
});

function renderGoals() {
    renderGoalsFilter();
    const list = $('#goals-list');
    const empty = $('#goals-empty');
    list.innerHTML = '';
    let items = state.goals;
    if (state.goalListFilter === 'archived') {
        items = items.filter(g => g.archived);
        // Ordina per data archiviazione desc
        items = [...items].sort((a, b) => new Date(b.archivedAt || 0) - new Date(a.archivedAt || 0));
    } else {
        items = items.filter(g => !g.archived);
        if (state.goalListFilter !== 'all') items = items.filter(g => g.listId === state.goalListFilter);
    }
    if (items.length === 0) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    for (const g of items) {
        const tasks = state.tasks.filter(t => t.goalId === g.id);
        const done = tasks.filter(t => t.done).length;
        const pct = tasks.length ? Math.round((done / tasks.length) * 100) : (g.completed ? 100 : 0);
        const isDone = pct === 100 && tasks.length > 0;
        const glist = g.listId ? state.goalLists.find(l => l.id === g.listId) : null;
        const gopen = openGoalSessionFor(g.id);
        const gpause = gopen && activeBreak(gopen);
        const gtotal = goalWorkMs(g.id);
        const gliveMs = gopen ? workMs(gopen) : 0;

        let timerBlock = '';
        if (gopen) {
            timerBlock = `
                <div class="goal-timer ${gpause ? 'paused' : 'running'}">
                    <div class="goal-timer-label">${gpause ? '⏸ In pausa' : '▶ In corso'}</div>
                    <div class="goal-timer-value" data-goal-timer="${g.id}">${fmtDurationHMS(gliveMs)}</div>
                </div>
            `;
        }

        const timerActions = gopen ? `
            <button class="btn goal-btn goal-btn-pause" data-action="goal-pause" data-id="${g.id}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
                    ${gpause
                        ? '<polygon points="6 3 20 12 6 21" fill="currentColor" stroke="none"/>'
                        : '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'}
                </svg>
                <span>${gpause ? 'Riprendi' : 'Pausa'}</span>
            </button>
            <button class="btn goal-btn goal-btn-stop" data-action="goal-stop" data-id="${g.id}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
                <span>Termina</span>
            </button>
        ` : `
            <button class="btn goal-btn goal-btn-start" data-action="goal-start" data-id="${g.id}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21"/></svg>
                <span>Avvia</span>
            </button>
        `;

        const isArchived = !!g.archived;
        const headActions = isArchived
            ? `
                <button class="icon-btn" data-action="restore-goal" data-id="${g.id}" title="Ripristina">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
                </button>
                <button class="icon-btn danger" data-action="del-goal-forever" data-id="${g.id}" title="Elimina definitivamente">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                </button>
            `
            : `
                <button class="icon-btn" data-action="edit-goal" data-id="${g.id}" title="Modifica">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>
                <button class="icon-btn danger" data-action="del-goal" data-id="${g.id}" title="Archivia (sposta nello storico)">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
                </button>
            `;

        const el = document.createElement('div');
        el.className = 'goal-item'
            + (isDone ? ' completed' : '')
            + (gopen ? ' active' : '')
            + (isArchived ? ' archived' : '');
        el.innerHTML = `
            <div class="goal-head">
                <div>
                    <div class="goal-title-row">
                        ${glist ? `<span class="goal-list-badge">${escapeHtml(glist.name)}</span>` : ''}
                        ${isArchived ? '<span class="goal-archived-badge">Storico</span>' : ''}
                        <div class="goal-title">${escapeHtml(g.title)}</div>
                    </div>
                    ${g.desc ? `<div class="goal-desc">${escapeHtml(g.desc)}</div>` : ''}
                </div>
                <div class="goal-actions">${headActions}</div>
            </div>
            <div class="progress-bar"><div class="progress-fill ${isDone ? 'done' : ''}" style="width:${pct}%"></div></div>
            <div class="goal-meta">
                <span>${done} / ${tasks.length} task completate</span>
                <span>•</span>
                <span>${pct}%</span>
                ${gtotal > 0 ? `<span>•</span><span>⏱ ${fmtDuration(gtotal)} totali</span>` : ''}
                ${g.due ? `<span>•</span><span>Scadenza: ${new Date(g.due).toLocaleDateString('it-IT')}</span>` : ''}
                ${isArchived && g.archivedAt ? `<span>•</span><span>Archiviato: ${new Date(g.archivedAt).toLocaleDateString('it-IT')}</span>` : ''}
            </div>
            ${!isArchived ? timerBlock : ''}
            ${!isArchived ? `<div class="goal-timer-actions">${timerActions}</div>` : ''}
        `;
        list.appendChild(el);
    }
}

/* ============ ARCHIVIA / RIPRISTINA / ELIMINA obiettivo ============ */
function archiveGoal(id) {
    const g = state.goals.find(x => x.id === id);
    if (!g) return;
    // Se il timer è in corso su questo, chiudilo
    const open = openGoalSessionFor(id);
    if (open) {
        const b = activeBreak(open);
        if (b) b.out = new Date().toISOString();
        open.out = new Date().toISOString();
        save(K.GOAL_SESSIONS, state.goalSessions);
    }
    g.archived = true;
    g.archivedAt = new Date().toISOString();
    save(K.GOALS, state.goals);
    renderGoals();
    renderTasks();
    toast('📦 Obiettivo spostato nello storico');
}
function restoreGoal(id) {
    const g = state.goals.find(x => x.id === id);
    if (!g) return;
    delete g.archived;
    delete g.archivedAt;
    save(K.GOALS, state.goals);
    renderGoals();
    renderTasks();
    toast('✓ Obiettivo ripristinato');
}
function deleteGoalForever(id) {
    if (!confirm('Eliminare DEFINITIVAMENTE questo obiettivo e tutte le sue task? Azione irreversibile.')) return;
    state.goals = state.goals.filter(g => g.id !== id);
    state.tasks = state.tasks.filter(t => t.goalId !== id);
    state.goalSessions = state.goalSessions.filter(s => s.goalId !== id);
    save(K.GOALS, state.goals);
    save(K.TASKS, state.tasks);
    save(K.GOAL_SESSIONS, state.goalSessions);
    renderGoals();
    renderTasks();
    toast('Obiettivo eliminato');
}

/* ============ TASKS ============ */
$('#add-task-btn').addEventListener('click', () => {
    if (state.goals.length === 0) {
        toast('Crea prima un obiettivo!');
        $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'goals'));
        $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === 'goals'));
        return;
    }
    openTaskModal();
});

function openTaskModal(task = null) {
    state.editingTaskId = task?.id ?? null;
    $('#modal-task-title').textContent = task ? 'Modifica task' : 'Nuova task';
    $('#task-title').value = task?.title ?? '';
    renderTaskGoalOptions(task?.goalId);
    const prio = task?.prio ?? 'med';
    $$('input[name="prio"]').forEach(r => r.checked = r.value === prio);
    $('#modal-task').classList.remove('hidden');
    setTimeout(() => $('#task-title').focus(), 100);
}

function renderTaskGoalOptions(selected) {
    const sel = $('#task-goal');
    sel.innerHTML = '<option value="">Seleziona obiettivo…</option>';
    for (const g of state.goals) {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.title;
        if (g.id === selected) opt.selected = true;
        sel.appendChild(opt);
    }
}

$('#task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title  = $('#task-title').value.trim();
    const goalId = $('#task-goal').value;
    const prio   = document.querySelector('input[name="prio"]:checked').value;
    if (!title || !goalId) return;

    if (state.editingTaskId) {
        const t = state.tasks.find(x => x.id === state.editingTaskId);
        Object.assign(t, { title, goalId, prio });
        toast('Task aggiornata');
    } else {
        state.tasks.unshift({ id: uid(), title, goalId, prio, done: false, createdAt: new Date().toISOString() });
        toast('Task aggiunta ✅');
    }
    save(K.TASKS, state.tasks);
    closeModals();
    renderTasks();
    renderGoals();
});

$$('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
        $$('.chip').forEach(c => c.classList.toggle('active', c === chip));
        state.taskFilter = chip.dataset.filter;
        renderTasks();
    });
});

$$('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.period-btn').forEach(b => b.classList.toggle('active', b === btn));
        state.periodView = btn.dataset.period;
        renderWeekly();
    });
});

function renderTasks() {
    const list = $('#tasks-list');
    const empty = $('#tasks-empty');
    list.innerHTML = '';

    // Escludi task di obiettivi archiviati
    const archivedGoalIds = new Set(state.goals.filter(g => g.archived).map(g => g.id));
    let items = state.tasks.filter(t => !archivedGoalIds.has(t.goalId));
    if (state.taskFilter === 'open') items = items.filter(t => !t.done);
    if (state.taskFilter === 'done') items = items.filter(t => t.done);

    if (items.length === 0) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    for (const t of items) {
        const goal = state.goals.find(g => g.id === t.goalId);
        const el = document.createElement('div');
        el.className = 'task-item' + (t.done ? ' done' : '');
        el.innerHTML = `
            <div class="task-check" data-action="toggle-task" data-id="${t.id}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="3"><path d="M4 12l5 5L20 6"/></svg>
            </div>
            <div>
                <div class="task-title">${escapeHtml(t.title)}</div>
                ${goal ? `<div class="task-goal-badge">🎯 ${escapeHtml(goal.title)}</div>` : ''}
            </div>
            <span class="prio ${t.prio}">${prioLabel(t.prio)}</span>
            <button class="icon-btn danger" data-action="del-task" data-id="${t.id}" title="Elimina">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            </button>
        `;
        list.appendChild(el);
    }
}

function prioLabel(p) { return p === 'high' ? 'Alta' : p === 'low' ? 'Bassa' : 'Media'; }

/* ============ USERS (admin) ============ */
$('#add-user-btn').addEventListener('click', () => openUserModal());

function openUserModal(user = null) {
    state.editingUserId = user?.id ?? null;
    $('#modal-user-title').textContent = user ? 'Modifica utente' : 'Nuovo utente';
    $('#user-display').value = user?.display ?? '';
    $('#user-username').value = user?.username ?? '';
    $('#user-username').disabled = false;
    $('#user-pass').value = user?.passPlain ?? '';
    if (!user) {
        $('#user-pass-hint').textContent = 'min 4 caratteri';
        $('#user-pass').placeholder = 'Password';
    } else if (user.passPlain) {
        $('#user-pass-hint').textContent = 'visibile · modificala per cambiarla';
        $('#user-pass').placeholder = 'Password';
    } else {
        $('#user-pass-hint').textContent = 'non recuperabile · impostane una nuova';
        $('#user-pass').placeholder = 'Imposta una nuova password (min 4)';
    }
    $('#user-pass').required = !user || !user.passPlain;
    $('#user-pass').minLength = 4;
    const perms = user?.perms ?? { clock: true, goals: true, tasks: true };
    $('#perm-clock').checked = !!perms.clock;
    $('#perm-goals').checked = !!perms.goals;
    $('#perm-tasks').checked = !!perms.tasks;
    // Non permettere di modificare i propri permessi/username dell'admin corrente
    const isSelf = user && user.id === state.currentUser.id;
    $('#perm-clock').disabled = isSelf && user.role === 'admin';
    $('#perm-goals').disabled = isSelf && user.role === 'admin';
    $('#perm-tasks').disabled = isSelf && user.role === 'admin';
    $('#modal-user').classList.remove('hidden');
    setTimeout(() => $('#user-display').focus(), 100);
}

$('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const display = $('#user-display').value.trim();
    const username = $('#user-username').value.trim().toLowerCase();
    const pass = $('#user-pass').value;
    const perms = {
        clock: $('#perm-clock').checked,
        goals: $('#perm-goals').checked,
        tasks: $('#perm-tasks').checked,
    };
    if (!display || !username) return;
    if (!/^[a-z0-9_.-]{2,30}$/.test(username)) return toast('Username: 2-30 caratteri, lettere/numeri/._-');

    if (state.editingUserId) {
        const u = state.auth.users.find(x => x.id === state.editingUserId);
        if (!u) return;
        u.display = display;
        // Cambio username: check unicità
        if (username !== u.username.toLowerCase()) {
            if (state.auth.users.some(x => x.id !== u.id && x.username.toLowerCase() === username)) {
                return toast('Username già in uso');
            }
            u.username = username;
        }
        // Cambio password: se il valore è diverso dal plain corrente, aggiorna
        if (pass && pass !== u.passPlain) {
            if (pass.length < 4) return toast('Password troppo corta');
            u.passHash = await sha256(pass);
            u.passPlain = pass;
        } else if (!pass && !u.passPlain) {
            return toast('Imposta una password');
        }
        // Non alterare i permessi dell'admin su se stesso
        if (!(u.id === state.currentUser.id && u.role === 'admin')) {
            u.perms = perms;
        }
        save(K.AUTH, state.auth);
        // Se sto modificando me stesso, aggiorno currentUser
        if (u.id === state.currentUser.id) {
            state.currentUser = u;
            $('#user-greeting').textContent = u.role === 'admin' ? `Admin · ${u.display}` : `Ciao ${u.display.split(' ')[0]}`;
            renderAdminProfileForm();
        }
        toast('Utente aggiornato');
    } else {
        if (!pass || pass.length < 4) return toast('Password troppo corta');
        if (state.auth.users.some(x => x.username.toLowerCase() === username)) {
            return toast('Username già in uso');
        }
        const passHash = await sha256(pass);
        state.auth.users.push({
            id: uid(),
            username,
            display,
            passHash,
            passPlain: pass,
            role: 'employee',
            perms,
            createdAt: new Date().toISOString(),
        });
        save(K.AUTH, state.auth);
        ensureListForUser(username);
        toast(`Utente ${display} creato ✓`);
    }
    closeModals();
    renderUsers();
});

function renderUsers() {
    const list = $('#users-list');
    list.innerHTML = '';
    const users = state.auth.users;
    for (const u of users) {
        const permsBadges = u.role === 'admin'
            ? '<span class="perm-badge admin">Tutti i permessi</span>'
            : ['clock','goals','tasks']
                .filter(p => u.perms?.[p])
                .map(p => `<span class="perm-badge">${permLabel(p)}</span>`)
                .join('') || '<span class="perm-badge muted">Nessun permesso</span>';
        const isSelf = u.id === state.currentUser.id;
        const canDelete = u.role !== 'admin' || users.filter(x => x.role === 'admin').length > 1;
        const el = document.createElement('div');
        el.className = 'user-item' + (u.role === 'admin' ? ' is-admin' : '');
        el.innerHTML = `
            <div class="user-avatar">${(u.display || u.username).charAt(0).toUpperCase()}</div>
            <div class="user-info">
                <div class="user-name">
                    ${escapeHtml(u.display || u.username)}
                    ${u.role === 'admin' ? '<span class="role-pill">ADMIN</span>' : ''}
                    ${isSelf ? '<span class="role-pill self">Tu</span>' : ''}
                </div>
                <div class="user-username">@${escapeHtml(u.username)}</div>
                <div class="user-perms">${permsBadges}</div>
            </div>
            <div class="user-actions">
                ${!isSelf ? `
                <button class="icon-btn viewas" data-action="viewas-user" data-id="${u.id}" title="Visualizza come ${escapeHtml(u.display || u.username)}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>` : ''}
                <button class="icon-btn" data-action="edit-user" data-id="${u.id}" title="Modifica">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>
                ${canDelete && !isSelf ? `
                <button class="icon-btn danger" data-action="del-user" data-id="${u.id}" title="Elimina">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                </button>` : ''}
            </div>
        `;
        list.appendChild(el);
    }
}

function permLabel(p) {
    return p === 'clock' ? 'Timbratura' : p === 'goals' ? 'Obiettivi' : 'Task';
}

/* ============ GOAL SESSIONS (timer per obiettivo) ============ */
function myGoalSessions() {
    const uid = state.currentUser?.id;
    return state.goalSessions.filter(s => s.userId === uid);
}
function openGoalSession() {
    const uid = state.currentUser?.id;
    return state.goalSessions.find(s => !s.out && s.userId === uid) || null;
}
function openGoalSessionFor(goalId) {
    const uid = state.currentUser?.id;
    return state.goalSessions.find(s => !s.out && s.userId === uid && s.goalId === goalId) || null;
}
function goalWorkMs(goalId) {
    let total = 0;
    for (const s of myGoalSessions()) {
        if (s.goalId !== goalId) continue;
        total += workMs(s);
    }
    return total;
}

function startGoal(goalId) {
    // Se già in corso su un altro goal, chiudilo prima
    const open = openGoalSession();
    if (open && open.goalId !== goalId) {
        const b = activeBreak(open);
        if (b) b.out = new Date().toISOString();
        open.out = new Date().toISOString();
        const prevName = state.goals.find(g => g.id === open.goalId)?.title;
        toast(`"${prevName || 'Obiettivo'}" fermato · ${fmtDuration(workMs(open))}`);
    }
    if (open && open.goalId === goalId) return; // già in corso su questo
    state.goalSessions.unshift({
        id: uid(),
        goalId,
        userId: state.currentUser.id,
        in: new Date().toISOString(),
        out: null,
        breaks: [],
    });
    save(K.GOAL_SESSIONS, state.goalSessions);
    const name = state.goals.find(g => g.id === goalId)?.title || 'Obiettivo';
    toast(`▶ "${name}" avviato`);
    renderGoals();
}

function pauseGoal(goalId) {
    const open = openGoalSessionFor(goalId);
    if (!open) return;
    const b = activeBreak(open);
    if (b) {
        b.out = new Date().toISOString();
        toast('▶ Ripreso');
    } else {
        open.breaks.push({ in: new Date().toISOString(), out: null, type: 'break' });
        toast('⏸ In pausa');
    }
    save(K.GOAL_SESSIONS, state.goalSessions);
    renderGoals();
}

function stopGoal(goalId) {
    const open = openGoalSessionFor(goalId);
    if (!open) return;
    const b = activeBreak(open);
    if (b) b.out = new Date().toISOString();
    open.out = new Date().toISOString();
    save(K.GOAL_SESSIONS, state.goalSessions);
    // Termina = archivia il goal (va nello storico)
    const g = state.goals.find(x => x.id === goalId);
    if (g && !g.archived) {
        g.archived = true;
        g.archivedAt = new Date().toISOString();
        save(K.GOALS, state.goals);
    }
    const name = g?.title || 'Obiettivo';
    toast(`⏹ "${name}" terminato · ${fmtDuration(workMs(open))} · nello Storico`);
    renderGoals();
    renderTasks();
}

// Aggiornamento live dei timer visibili (chiamato dal ticker ogni secondo)
function updateGoalTimers() {
    const open = openGoalSession();
    if (!open) return;
    const el = document.querySelector(`[data-goal-timer="${open.goalId}"]`);
    if (el) el.textContent = fmtDurationHMS(workMs(open));
}

/* ============ DELEGATED ACTIONS ============ */
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;

    if (action === 'edit-goal') {
        openGoalModal(state.goals.find(g => g.id === id));
    } else if (action === 'del-goal') {
        archiveGoal(id);
    } else if (action === 'restore-goal') {
        restoreGoal(id);
    } else if (action === 'del-goal-forever') {
        deleteGoalForever(id);
    } else if (action === 'toggle-task') {
        const t = state.tasks.find(x => x.id === id);
        t.done = !t.done;
        save(K.TASKS, state.tasks);
        renderTasks(); renderGoals();
        if (t.done) confettiBurst(20);
    } else if (action === 'del-task') {
        state.tasks = state.tasks.filter(x => x.id !== id);
        save(K.TASKS, state.tasks);
        renderTasks(); renderGoals();
    } else if (action === 'edit-user') {
        openUserModal(state.auth.users.find(u => u.id === id));
    } else if (action === 'viewas-user') {
        startImpersonation(id);
    } else if (action === 'del-user') {
        const u = state.auth.users.find(x => x.id === id);
        if (!u) return;
        if (!confirm(`Eliminare l'utente ${u.display || u.username}?`)) return;
        state.auth.users = state.auth.users.filter(x => x.id !== id);
        save(K.AUTH, state.auth);
        renderUsers();
        toast('Utente eliminato');
    } else if (action === 'goal-start') {
        startGoal(id);
    } else if (action === 'goal-pause') {
        pauseGoal(id);
    } else if (action === 'goal-stop') {
        stopGoal(id);
    }
});

/* ============ MODALS CLOSE ============ */
document.querySelectorAll('[data-close], .modal-backdrop').forEach(el => {
    el.addEventListener('click', closeModals);
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModals();
});
function closeModals() {
    // Escludi welcome + notes (obbligatorio riempire le note)
    $$('.modal').forEach(m => {
        if (m.id === 'modal-welcome' || m.id === 'modal-notes') return;
        m.classList.add('hidden');
    });
    state.editingGoalId = null;
    state.editingTaskId = null;
    state.editingUserId = null;
}

/* ============ RENDER ALL ============ */
function renderAll() {
    renderClockPanel();
    renderWeekly();
    renderGoals();
    renderTasks();
    renderTaskGoalOptions();
    if (state.currentUser?.role === 'admin') { renderUsers(); renderAdminProfileForm(); }
}

/* ============ UTILS ============ */
function escapeHtml(s) {
    return (s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/* ============ CONFETTI ============ */
const confettiCanvas = $('#confetti');
const cctx = confettiCanvas.getContext('2d');
function sizeConfetti() {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
}
sizeConfetti();
window.addEventListener('resize', sizeConfetti);

let confettiParticles = [];
function confettiBurst(count = 60) {
    const colors = ['#7c5cff', '#22d3ee', '#ff5d9e', '#22c98a', '#ffb547'];
    for (let i = 0; i < count; i++) {
        confettiParticles.push({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2 - 60,
            vx: (Math.random() - 0.5) * 12,
            vy: (Math.random() - 1) * 10 - 4,
            g:  0.35,
            size: 4 + Math.random() * 6,
            color: colors[(Math.random() * colors.length) | 0],
            rot: Math.random() * Math.PI,
            vr: (Math.random() - 0.5) * 0.2,
            life: 120,
        });
    }
    if (!confettiAnimating) animateConfetti();
}
let confettiAnimating = false;
function animateConfetti() {
    confettiAnimating = true;
    cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    for (let i = confettiParticles.length - 1; i >= 0; i--) {
        const p = confettiParticles[i];
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life--;
        cctx.save();
        cctx.translate(p.x, p.y);
        cctx.rotate(p.rot);
        cctx.fillStyle = p.color;
        cctx.globalAlpha = Math.max(0, Math.min(1, p.life / 60));
        cctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        cctx.restore();
        if (p.life <= 0 || p.y > confettiCanvas.height + 20) confettiParticles.splice(i, 1);
    }
    if (confettiParticles.length > 0) {
        requestAnimationFrame(animateConfetti);
    } else {
        confettiAnimating = false;
        cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
}

/* ============ AMBIENT PARTICLES ============ */
const pCanvas = $('#particles');
const pctx = pCanvas.getContext('2d');
function sizeParticles() {
    pCanvas.width = window.innerWidth;
    pCanvas.height = window.innerHeight;
}
sizeParticles();
window.addEventListener('resize', sizeParticles);

const dots = Array.from({ length: 40 }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    r: Math.random() * 1.5 + 0.3,
    vx: (Math.random() - 0.5) * 0.15,
    vy: (Math.random() - 0.5) * 0.15,
    a: 0.1 + Math.random() * 0.3,
}));

function animateParticles() {
    pctx.clearRect(0, 0, pCanvas.width, pCanvas.height);
    for (const d of dots) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0) d.x = pCanvas.width; if (d.x > pCanvas.width) d.x = 0;
        if (d.y < 0) d.y = pCanvas.height; if (d.y > pCanvas.height) d.y = 0;
        pctx.beginPath();
        pctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        pctx.fillStyle = `rgba(180, 200, 255, ${d.a})`;
        pctx.fill();
    }
    requestAnimationFrame(animateParticles);
}
animateParticles();

/* ============ ADMIN ACTIONS ============ */
$('#export-csv-btn').addEventListener('click', () => {
    const rows = [['data', 'giorno', 'utente', 'ingresso', 'uscita', 'pausa_min', 'pranzo_min', 'lavoro_min', 'note']];
    const sorted = [...state.sessions].sort((a, b) => new Date(a.in) - new Date(b.in));
    for (const s of sorted) {
        const inD = new Date(s.in);
        const outD = s.out ? new Date(s.out) : null;
        const dateStr = `${inD.getFullYear()}-${pad(inD.getMonth()+1)}-${pad(inD.getDate())}`;
        const dayName = inD.toLocaleDateString('it-IT', { weekday: 'long' });
        const inStr = `${pad(inD.getHours())}:${pad(inD.getMinutes())}`;
        const outStr = outD ? `${pad(outD.getHours())}:${pad(outD.getMinutes())}` : '';
        const bMin = Math.round(breakMs(s) / 60000);
        const lMin = Math.round(lunchMs(s) / 60000);
        const wMin = Math.round(workMs(s) / 60000);
        const user = state.auth.users.find(u => u.id === s.userId);
        const userName = user ? (user.display || user.username) : '—';
        rows.push([dateStr, dayName, userName, inStr, outStr, bMin, lMin, wMin, s.notes || '']);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timbrature_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV scaricato ✓');
});

$('#admin-profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const display = $('#admin-display').value.trim();
    const username = $('#admin-username').value.trim().toLowerCase();
    const password = $('#admin-password').value;

    if (!display) return toast('Il nome non può essere vuoto');
    if (!/^[a-z0-9_.-]{2,30}$/.test(username)) return toast('Username: 2-30 caratteri, lettere/numeri/._-');
    if (!password || password.length < 4) return toast('Password troppo corta (min 4)');

    // Unicità username (escludi se stesso)
    const conflict = state.auth.users.find(u => u.id !== state.currentUser.id && u.username.toLowerCase() === username);
    if (conflict) return toast('Username già in uso da un altro utente');

    const u = state.auth.users.find(x => x.id === state.currentUser.id);
    if (!u) return;
    u.display = display;
    u.username = username;
    if (password !== u.passPlain) {
        u.passHash = await sha256(password);
        u.passPlain = password;
    }
    save(K.AUTH, state.auth);
    state.currentUser = u;

    // Aggiorna UI
    $('#user-greeting').textContent = `Admin · ${u.display}`;
    renderUsers();
    renderAdminProfileForm();
    toast('Profilo aggiornato ✓');
});

function renderAdminProfileForm() {
    if (state.currentUser?.role !== 'admin') return;
    $('#admin-display').value = state.currentUser.display || '';
    $('#admin-username').value = state.currentUser.username || '';
    $('#admin-password').value = state.currentUser.passPlain || '';
}

$('#reset-all-btn').addEventListener('click', () => {
    if (!confirm('Attenzione: verranno cancellati timbrature, obiettivi, task, utenti e credenziali. Confermi?')) return;
    if (!confirm('Sicuro? Questa azione è irreversibile.')) return;
    Object.values(K).forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); });
    location.reload();
});

/* ============ EFFETTI VISIVI (cursor glow, parallax, ripple, gradient shifter) ============ */

// 1) CURSOR GLOW — alone luminoso che segue il mouse
(() => {
    const glow = document.getElementById('cursor-glow');
    if (!glow) return;
    let rafId = null, tx = 0, ty = 0, cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const tick = () => {
        cx += (tx - cx) * 0.15;
        cy += (ty - cy) * 0.15;
        glow.style.transform = `translate(${cx - 250}px, ${cy - 250}px)`;
        rafId = requestAnimationFrame(tick);
    };
    document.addEventListener('mousemove', (e) => {
        tx = e.clientX; ty = e.clientY;
        if (!rafId) tick();
    });
    // Nascondi su touch (mobile)
    if (matchMedia('(hover: none)').matches) glow.style.display = 'none';
})();

// 3) PARALLAX SUI BLOB — l'intero layer sfondo si muove leggermente col mouse
(() => {
    const blobs = document.querySelector('.bg-blobs');
    if (!blobs) return;
    document.addEventListener('mousemove', (e) => {
        const x = (e.clientX / window.innerWidth  - 0.5) * 24;
        const y = (e.clientY / window.innerHeight - 0.5) * 24;
        blobs.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    });
})();

// 4) RIPPLE SUI BOTTONI — click crea onda espansa (escluso clock-btn: ha già i rings)
(() => {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-primary, .btn-danger, .goal-btn, .btn-block, .imp-btn, .dp-btn.primary');
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        const size = Math.max(r.width, r.height) * 2;
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - r.left - size / 2) + 'px';
        ripple.style.top  = (e.clientY - r.top  - size / 2) + 'px';
        btn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 700);
    });
})();

// 5) GRADIENT SHIFTER (ora del giorno) — palette blob cambia in base all'ora
(() => {
    const palettes = {
        // 05-11: mattina — pastelli caldi/rosati
        morning:   { b1: '#7c5cff', b2: '#ffb547', b3: '#ff9dc4', bg: '#0a0713' },
        // 11-16: giorno — colori pieni brand
        day:       { b1: '#7c5cff', b2: '#22d3ee', b3: '#ff5d9e', bg: '#05060b' },
        // 16-20: tramonto — arancioni/magenta
        sunset:    { b1: '#ff5d9e', b2: '#ff8f5e', b3: '#7c5cff', bg: '#0d0510' },
        // 20-05: notte — freddi/profondi
        night:     { b1: '#3d1a8a', b2: '#22d3ee', b3: '#5b6485', bg: '#03040a' },
    };
    function currentPalette() {
        const h = new Date().getHours();
        if (h >= 5  && h < 11) return palettes.morning;
        if (h >= 11 && h < 16) return palettes.day;
        if (h >= 16 && h < 20) return palettes.sunset;
        return palettes.night;
    }
    function apply() {
        const p = currentPalette();
        document.documentElement.style.setProperty('--blob-1-color', p.b1);
        document.documentElement.style.setProperty('--blob-2-color', p.b2);
        document.documentElement.style.setProperty('--blob-3-color', p.b3);
        document.documentElement.style.setProperty('--bg-0', p.bg);
    }
    apply();
    // Riapplica ogni 10 min per catturare cambi ora
    setInterval(apply, 10 * 60 * 1000);
})();

// 6) SOUND DESIGN (Web Audio API, sintetico, no file)
const SoundFX = (() => {
    let ctx = null;
    let enabled = localStorage.getItem('clockapp:sound') !== '0'; // default ON
    function ensure() {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
    }
    function tone(freq, dur = 0.15, type = 'sine', vol = 0.08) {
        if (!enabled) return;
        try {
            ensure();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            gain.gain.value = vol;
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
            osc.connect(gain).connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + dur);
        } catch {}
    }
    function chord(freqs, dur = 0.2, type = 'sine', vol = 0.05) {
        freqs.forEach((f, i) => setTimeout(() => tone(f, dur, type, vol), i * 40));
    }
    return {
        clockIn:  () => chord([523, 784], 0.2, 'sine', 0.06),   // C5 + G5
        clockOut: () => chord([392, 262], 0.25, 'sine', 0.05),  // G4 + C4
        breakOn:  () => tone(440, 0.12, 'sine', 0.05),
        breakOff: () => tone(659, 0.12, 'sine', 0.05),
        taskDone: () => chord([784, 988, 1319], 0.15, 'triangle', 0.05), // G5-B5-E6
        goalStart:() => chord([523, 659, 784], 0.15, 'triangle', 0.05),
        goalStop: () => tone(330, 0.3, 'sine', 0.05),
        get enabled() { return enabled; },
        toggle: () => {
            enabled = !enabled;
            localStorage.setItem('clockapp:sound', enabled ? '1' : '0');
            document.getElementById('sound-on-icon').classList.toggle('hidden', !enabled);
            document.getElementById('sound-off-icon').classList.toggle('hidden', enabled);
            document.getElementById('sound-toggle').classList.toggle('muted', !enabled);
            if (enabled) tone(880, 0.08); // feedback breve
            return enabled;
        },
    };
})();

// Init stato bottone sound
(() => {
    const btn = document.getElementById('sound-toggle');
    if (!btn) return;
    const on = SoundFX.enabled;
    document.getElementById('sound-on-icon').classList.toggle('hidden', !on);
    document.getElementById('sound-off-icon').classList.toggle('hidden', on);
    btn.classList.toggle('muted', !on);
    btn.addEventListener('click', () => SoundFX.toggle());
})();

// Hook suoni (tutti in capture-phase per anticipare gli handler principali)
(() => {
    // Clock in/out
    const clockBtn = document.getElementById('clock-btn');
    if (clockBtn) clockBtn.addEventListener('click', () => {
        openSession() ? SoundFX.clockOut() : SoundFX.clockIn();
    }, true);
    // Break/lunch buttons
    const breakBtn = document.getElementById('break-btn');
    if (breakBtn) breakBtn.addEventListener('click', () => {
        const s = openSession();
        const b = s && activeBreak(s);
        b ? SoundFX.breakOff() : SoundFX.breakOn();
    }, true);
    // Delegated: goal timer + task done
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        switch (btn.dataset.action) {
            case 'goal-start': SoundFX.goalStart(); break;
            case 'goal-pause': {
                const g = state.goals.find(x => x.id === btn.dataset.id);
                const open = g && openGoalSessionFor(g.id);
                if (open && activeBreak(open)) SoundFX.breakOff();
                else SoundFX.breakOn();
                break;
            }
            case 'goal-stop': SoundFX.goalStop(); break;
            case 'toggle-task': {
                const t = state.tasks.find(x => x.id === btn.dataset.id);
                if (t && !t.done) SoundFX.taskDone();
                break;
            }
        }
    }, true);
})();

/* ============ GO! ============ */
bootAuth();
