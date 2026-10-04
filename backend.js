// Browser API adapter. It preserves the current window.api contract so the UI
// can use the real server without any markup or design changes.
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

const api = {
    auth: {
        async login(email, password) { return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); },
        async signup(email, password, role = 'admin') { return request('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, role }) }); },
        async logout() { return request('/api/auth/logout', { method: 'POST' }); },
        async getCurrentUser() { return (await request('/api/auth/session')).user; }
    },
    dashboard: {
        async getMetrics() { return (await request('/api/dashboard/metrics')).metrics; },
        async getRecentAudits() { return (await request('/api/dashboard/audits')).audits; }
    },
    auditor: {
        async uploadModel(file) {
            if (file instanceof File) {
                const formData = new FormData();
                formData.append('model', file, file.name);
                return request('/api/auditor/uploads', { method: 'POST', body: formData });
            }
            return request('/api/auditor/uploads', { method: 'POST', body: JSON.stringify(file) });
        }
    },
    analysis: { async getLatest() { return request('/api/analysis/latest'); } },
    arena: { async compareModels(params) { return request('/api/arena/compare', { method: 'POST', body: JSON.stringify(params) }); } },
    interceptor: { async healModel() { return request('/api/interceptor/heal', { method: 'POST' }); } },
    vaccine: { async generateVaccine() { return request('/api/vaccine/generate', { method: 'POST' }); } },
    reports: { async getReports() { return (await request('/api/reports')).reports; } },
    settings: {
        async getSettings() { return (await request('/api/settings')).settings; },
        async updateSettings(newSettings) { return request('/api/settings', { method: 'PUT', body: JSON.stringify(newSettings) }); }
    },
    applicant: {
        async getStatus() { return (await request('/api/applicant/status')).status; },
        async reevaluate() { return request('/api/applicant/re-evaluate', { method: 'POST' }); },
        async appeal(notes) { return request('/api/applicant/appeal', { method: 'POST', body: JSON.stringify({ notes }) }); }
    }
};

window.api = api;
