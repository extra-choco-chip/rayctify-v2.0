// Browser API adapter: thin wrappers over the JSON API used by every page.
const request = async (path, options = {}) => {
    const isFormData = options.body instanceof FormData;
    const response = await fetch(path, {
        credentials: 'same-origin',
        headers: { ...(isFormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) },
        ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
};
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) });

const api = {
    orgName: null,
    auth: {
        login: (email, password) => post('/api/auth/login', { email, password }),
        signup: (email, password, inviteCode) => post('/api/auth/signup', { email, password, inviteCode: inviteCode || undefined }),
        logout: () => post('/api/auth/logout'),
        changePassword: (current, next) => post('/api/auth/password', { current, next }),
        async getCurrentUser() { const r = await request('/api/auth/session'); api.orgName = r.orgName; return r.user; }
    },
    dashboard: {
        async getMetrics() { return (await request('/api/dashboard/metrics')).metrics; },
        async getRecentAudits() { return (await request('/api/dashboard/audits')).audits; }
    },
    auditor: {
        uploadModel(file) {
            const formData = new FormData();
            formData.append('model', file, file.name);
            return request('/api/auditor/uploads', { method: 'POST', body: formData });
        }
    },
    arena: { compareModels: (params) => post('/api/arena/compare', params) },
    mitigation: { get: (auditId) => request(`/api/mitigation/${encodeURIComponent(auditId)}`) },
    reports: { async getReports() { return (await request('/api/reports')).reports; } },
    settings: {
        async getSettings() { return (await request('/api/settings')).settings; },
        updateSettings: (settings) => request('/api/settings', { method: 'PUT', body: JSON.stringify(settings) })
    },
    team: {
        createInvite: () => post('/api/invites'),
        async listInvites() { return (await request('/api/invites')).invites; },
        async activity() { return (await request('/api/activity')).activity; }
    },
    appeals: {
        list: () => request('/api/appeals'),
        resolve: (userId, outcome, comment) => post(`/api/appeals/${encodeURIComponent(userId)}/resolve`, { outcome, comment })
    },
    applicant: {
        async getStatus() { return (await request('/api/applicant/status')).status; },
        appeal: (notes) => post('/api/applicant/appeal', { notes })
    }
};

window.api = api;
