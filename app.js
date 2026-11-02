// app.js — shared helpers, route table, router, navigation and sign-in/sign-up.
// Page templates live in pages.js (public + applicant) and views.js (admin).

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

window.toast = (message, type = 'info') => {
    const stack = document.getElementById('toast-stack');
    const node = document.createElement('div');
    node.className = `toast ${type === 'error' ? 'error' : ''}`;
    node.setAttribute('role', type === 'error' ? 'alert' : 'status');
    node.textContent = message;
    stack.appendChild(node);
    setTimeout(() => node.remove(), type === 'error' ? 6000 : 4000);
};

/** Wraps an async click/submit handler: disables the button, shows a spinner, restores it afterwards. */
const withBusy = async (button, label, task) => {
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${esc(label)}`;
    try { return await task(); } finally { button.disabled = false; button.innerHTML = original; }
};

/* One table drives routing, permissions and navigation. */
const ROUTES = {
    '#/login':      { page: 'login', init: 'initLogin', public: true },
    '#/signup':     { page: 'signUp', init: 'initSignup', public: true },
    '#/dashboard':  { page: 'bankDashboard', init: 'initDashboard', roles: ['admin'], label: 'Portfolio', icon: 'dashboard' },
    '#/audits':     { page: 'audits', init: 'initAudits', roles: ['admin'], label: 'Audits', icon: 'fact_check' },
    '#/compare':    { page: 'compare', init: 'initCompare', roles: ['admin'], label: 'Compare models', icon: 'compare_arrows' },
    '#/mitigation': { page: 'mitigation', init: 'initMitigation', roles: ['admin'], label: 'Mitigation', icon: 'healing' },
    '#/appeals':    { page: 'appeals', init: 'initAppeals', roles: ['admin'], label: 'Appeals', icon: 'gavel' },
    '#/reports':    { page: 'reports', init: 'initReports', roles: ['admin'], label: 'Compliance reports', icon: 'summarize' },
    '#/policy':     { page: 'policy', init: 'initPolicy', roles: ['admin'], label: 'Fairness policy', icon: 'tune' },
    '#/applicant':  { page: 'applicantDashboard', init: 'initApplicant', roles: ['applicant'], label: 'My application', icon: 'home' },
    '#/rights':     { page: 'rights', init: 'initRights', roles: ['applicant'], label: 'Your rights', icon: 'balance' }
};
const REDIRECTS = { '#/auditor': '#/audits', '#/arena': '#/compare', '#/interceptor': '#/mitigation', '#/vaccine': '#/mitigation', '#/settings': '#/policy', '#/decision': '#/rights' };
const HOME = { admin: '#/dashboard', applicant: '#/applicant' };
const PORTALS = {
    admin: { title: 'Lender console', subtitle: 'Fairness governance' },
    applicant: { title: 'Applicant portal', subtitle: 'Your application' }
};

const app = {
    navToken: 0,
    filterQuery: '',      // set by the global search, consumed by the Portfolio page
    selectedAudit: null,  // audit chosen on the Audits page, preselected on Mitigation

    init() {
        window.addEventListener('hashchange', () => this.handleRoute());
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());

        document.getElementById('menu-btn').addEventListener('click', () => this.toggleMenu());
        document.getElementById('sidebar-nav-list').addEventListener('click', () => this.toggleMenu(false));

        document.getElementById('global-search').addEventListener('submit', (event) => {
            event.preventDefault();
            this.filterQuery = document.getElementById('global-search-input').value.trim();
            if (window.location.hash === '#/dashboard') this.handleRoute(); else window.location.hash = '#/dashboard';
        });
        this.handleRoute();
    },

    toggleMenu(force) {
        const sidebar = document.getElementById('sidebar');
        const open = force ?? sidebar.classList.contains('hidden');
        sidebar.classList.toggle('hidden', !open);
        sidebar.classList.toggle('flex', open);
        document.getElementById('menu-btn').setAttribute('aria-expanded', String(open));
    },

    async logout() {
        try { await window.api.auth.logout(); } catch { /* the session is dropped either way */ }
        window.location.hash = '#/login';
        this.handleRoute();
    },

    async handleRoute() {
        const token = ++this.navToken;
        const hash = (window.location.hash || '#/').split('?')[0];
        if (REDIRECTS[hash]) { window.location.hash = REDIRECTS[hash]; return; }

        let user = null;
        try { user = await window.api.auth.getCurrentUser(); } catch { /* treated as signed out */ }
        if (token !== this.navToken) return; // a newer navigation superseded this one

        const route = ROUTES[hash];
        if (!user) {
            if (!route || !route.public) { window.location.hash = '#/login'; return; }
            return this.renderAuth(route);
        }
        if (!route || route.public || !route.roles.includes(user.role)) { window.location.hash = HOME[user.role]; return; }
        this.renderShell(user, hash, route);
    },

    renderAuth(route) {
        document.getElementById('shell').classList.add('hidden');
        const auth = document.getElementById('auth-content');
        auth.classList.remove('hidden'); auth.classList.add('flex');
        auth.innerHTML = pages[route.page]();
        document.title = `${route.page === 'login' ? 'Sign in' : 'Create account'} · RayCtify`;
        this[route.init]();
    },

    async renderShell(user, hash, route) {
        const auth = document.getElementById('auth-content');
        auth.classList.add('hidden'); auth.classList.remove('flex');
        const shell = document.getElementById('shell');
        shell.classList.remove('hidden'); shell.classList.add('flex');
        this.updateNavigation(user, hash);

        const content = document.getElementById('app-content');
        content.innerHTML = pages[route.page]();
        content.focus({ preventScroll: true });
        window.scrollTo(0, 0);
        document.title = `${route.label} · ${window.api.orgName || 'RayCtify'}`;
        this[route.init]();
        if (user.role === 'admin') this.refreshBell();
    },

    updateNavigation(user, activeHash) {
        const portal = PORTALS[user.role];
        document.getElementById('org-name').textContent = window.api.orgName || 'RayCtify';
        document.getElementById('user-display-name').textContent = user.name;
        document.getElementById('user-role-badge').textContent = user.role;
        document.getElementById('sidebar-title').textContent = portal.title;
        document.getElementById('sidebar-subtitle').textContent = portal.subtitle;
        document.getElementById('global-search').style.display = user.role === 'admin' ? '' : 'none';
        document.getElementById('bell').classList.toggle('hidden', user.role !== 'admin');

        document.getElementById('sidebar-nav-list').innerHTML = Object.entries(ROUTES)
            .filter(([, r]) => !r.public && r.roles.includes(user.role))
            .map(([href, r]) => {
                const active = href === activeHash;
                return `<a href="${href}" ${active ? 'aria-current="page"' : ''} class="flex items-center gap-base p-3 rounded-lg font-label-md text-label-md transition-colors ${active ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'}">
                    <span class="material-symbols-outlined" aria-hidden="true">${r.icon}</span> ${esc(r.label)}</a>`;
            }).join('');
    },

    /** The bell shows how many applicant appeals are waiting for a human. */
    async refreshBell() {
        try {
            const { openAppeals } = await window.api.dashboard.getMetrics();
            const dot = document.getElementById('bell-dot');
            dot.textContent = openAppeals; dot.classList.toggle('hidden', !openAppeals);
            document.getElementById('bell').setAttribute('aria-label', openAppeals ? `${openAppeals} appeals awaiting review` : 'Open appeals');
        } catch { /* non-critical */ }
    },

    /* ---------------- Sign in / sign up ---------------- */
    initLogin() {
        document.getElementById('login-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            if (!email || !password) { toast('Enter your email and password.', 'error'); return; }
            try {
                const { user } = await withBusy(document.getElementById('auth-submit'), 'Signing in…', () => window.api.auth.login(email, password));
                window.location.hash = HOME[user.role];
            } catch (error) { toast(error.message, 'error'); }
        });
    },

    initSignup() {
        document.getElementById('signup-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const invite = document.getElementById('invite-code').value.trim();
            if (!email || password.length < 10) { toast('Enter a valid email and a password of at least 10 characters.', 'error'); return; }
            try {
                const { user } = await withBusy(document.getElementById('auth-submit'), 'Creating account…', async () => {
                    await window.api.auth.signup(email, password, invite);
                    return window.api.auth.login(email, password);
                });
                window.location.hash = HOME[user.role];
            } catch (error) { toast(error.message, 'error'); }
        });
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());
