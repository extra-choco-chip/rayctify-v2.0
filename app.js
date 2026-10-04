// app.js

const app = {
    init() {
        this.appDiv = document.body; // Using body for global event listeners
        this.bindGlobalHandlers();
        
        // Listen for hash changes
        window.addEventListener('hashchange', () => this.handleRoute());
        
        // Initial route
        this.handleRoute();
    },

    bindGlobalHandlers() {
        // The dashboard shell stays mounted between routes, so bind once at the
        // document level. This also covers the desktop, sidebar, and mobile
        // controls that are already present in index.html.
        document.addEventListener('click', async (event) => {
            const logoutControl = event.target.closest('#logout-btn-top, #logout-btn-side, #logout-btn-mobile');
            if (!logoutControl) return;

            event.preventDefault();
            if (logoutControl.dataset.loggingOut === 'true') return;

            logoutControl.dataset.loggingOut = 'true';
            logoutControl.setAttribute('aria-busy', 'true');
            try {
                await window.api.auth.logout();
                window.location.hash = '#/login';
            } catch (error) {
                console.error('Logout failed:', error);
                alert('Unable to log out. Please try again.');
            } finally {
                logoutControl.dataset.loggingOut = 'false';
                logoutControl.removeAttribute('aria-busy');
            }
        });
    },

    async handleRoute() {
        let hash = window.location.hash;
        const user = await window.api.auth.getCurrentUser();
        
        // Handle root or empty hash
        if (!hash || hash === '#') {
            if (user) {
                window.location.hash = user.role === 'applicant' ? '#/applicant' : '#/dashboard';
            } else {
                window.location.hash = '#/login';
            }
            return;
        }

        // Prevent showing login/signup if already logged in
        if (hash === '#/login' || hash === '#/signup') {
            if (user) {
                window.location.hash = user.role === 'applicant' ? '#/applicant' : '#/dashboard';
                return;
            }
        }

        // Access Control: Block applicant from accessing internal bank admin tools
        const adminRoutes = ['#/dashboard', '#/auditor', '#/arena', '#/interceptor', '#/vaccine', '#/reports', '#/settings'];
        if (user && user.role === 'applicant' && adminRoutes.includes(hash)) {
            window.location.hash = '#/applicant';
            return;
        }

        try {
            switch (hash) {
                case '#/login':
                    this.render(pages.login(), this.initLogin.bind(this), 'auth', user);
                    break;
                case '#/signup':
                    this.render(pages.signUp(), this.initSignup.bind(this), 'auth', user);
                    break;
                case '#/dashboard':
                    await this.requireAdmin();
                    this.render(pages.bankDashboard(), this.initDashboard.bind(this), 'dashboard', user);
                    break;
                case '#/applicant':
                    await this.requireAuth();
                    this.render(pages.applicantDashboard(), this.initApplicant.bind(this), 'dashboard', user);
                    break;
                case '#/auditor':
                    await this.requireAdmin();
                    this.render(pages.modelAuditor(), this.initAuditor.bind(this), 'dashboard', user);
                    break;
                case '#/arena':
                    await this.requireAdmin();
                    this.render(pages.theArena(), this.initArena.bind(this), 'dashboard', user);
                    break;
                case '#/interceptor':
                    await this.requireAdmin();
                    this.render(pages.theInterceptor(), this.initInterceptor.bind(this), 'dashboard', user);
                    break;
                case '#/vaccine':
                    await this.requireAdmin();
                    this.render(pages.vaccineGenerator(), this.initVaccine.bind(this), 'dashboard', user);
                    break;
                case '#/decision':
                    await this.requireAuth();
                    this.render(pages.applicationDecision(), this.initDecision.bind(this), 'dashboard', user);
                    break;
                case '#/reports':
                    await this.requireAdmin();
                    this.render(pages.auditReports(), this.initReports.bind(this), 'dashboard', user);
                    break;
                case '#/settings':
                    await this.requireAdmin();
                    this.render(pages.settings(), this.initSettings.bind(this), 'dashboard', user);
                    break;
                default:
                    window.location.hash = user?.role === 'applicant' ? '#/applicant' : '#/dashboard';
            }
        } catch (error) {
            console.error("Routing error:", error);
        }
    },

    render(html, initFn, layout = 'dashboard', user = null) {
        const shell = document.getElementById('shell');
        const authContent = document.getElementById('auth-content');
        const appContent = document.getElementById('app-content');
        
        if (layout === 'dashboard') {
            authContent.classList.add('hidden');
            shell.classList.remove('hidden');
            appContent.classList.add('animate-fade-in');
            appContent.innerHTML = html;
            setTimeout(() => appContent.classList.remove('animate-fade-in'), 400);
            
            // Update role-based navigation and headers
            this.updateNavigation(user);
        } else {
            shell.classList.add('hidden');
            authContent.classList.remove('hidden');
            authContent.classList.add('flex');
            authContent.classList.add('animate-fade-in');
            authContent.innerHTML = html;
            setTimeout(() => authContent.classList.remove('animate-fade-in'), 400);
        }
        
        if (initFn) setTimeout(initFn, 0);
    },

    async requireAuth() {
        const user = await window.api.auth.getCurrentUser();
        if (!user) {
            window.location.hash = '#/login';
            throw new Error('Not authenticated');
        }
        return user;
    },

    async requireAdmin() {
        const user = await this.requireAuth();
        if (user.role !== 'admin') {
            window.location.hash = '#/applicant';
            throw new Error('Unauthorized');
        }
        return user;
    },
    
    updateNavigation(user) {
        if (!user) return;
        const hash = window.location.hash;
        const isApplicant = user.role === 'applicant';

        // 1. Update user profile display and badges in topnav & mobile
        const userDisplay = document.getElementById('user-display-name');
        if (userDisplay) {
            userDisplay.textContent = user.name || (isApplicant ? 'John Doe' : 'Admin User');
        }
        const userBadge = document.getElementById('user-role-badge');
        if (userBadge) {
            userBadge.textContent = isApplicant ? 'Applicant' : 'Admin';
            userBadge.className = isApplicant 
                ? 'font-label-md text-[10px] px-2 py-0.5 rounded-full bg-secondary text-white font-bold uppercase tracking-wider'
                : 'font-label-md text-[10px] px-2 py-0.5 rounded-full bg-primary text-on-primary font-bold uppercase tracking-wider';
        }
        const mobileBadge = document.getElementById('mobile-role-badge');
        if (mobileBadge) {
            mobileBadge.textContent = isApplicant ? 'Applicant' : 'Admin';
            mobileBadge.className = isApplicant
                ? 'text-[10px] px-2 py-0.5 rounded-full bg-secondary text-white font-bold uppercase ml-1'
                : 'text-[10px] px-2 py-0.5 rounded-full bg-primary text-on-primary font-bold uppercase ml-1';
        }

        // 2. Update search placeholder
        const searchInput = document.getElementById('global-search-input');
        if (searchInput) {
            searchInput.placeholder = isApplicant 
                ? 'Search your application details, criteria, rights...'
                : 'Search models, audits, fairness metrics...';
        }

        // 3. Update topnav links
        const topnavMenu = document.getElementById('topnav-menu-items');
        if (topnavMenu) {
            if (isApplicant) {
                topnavMenu.innerHTML = `
                    <a href="#/applicant" class="font-body-md text-body-md ${hash === '#/applicant' ? 'text-primary border-b-2 border-primary pb-1 font-semibold' : 'text-on-surface-variant hover:text-primary transition-colors'}">My Application</a>
                    <a href="#/decision" class="font-body-md text-body-md ${hash === '#/decision' ? 'text-primary border-b-2 border-primary pb-1 font-semibold' : 'text-on-surface-variant hover:text-primary transition-colors'}">Explainability & Rights</a>
                    <span class="font-label-md text-xs px-2.5 py-1 rounded-full bg-secondary-fixed text-on-secondary-fixed font-semibold flex items-center gap-1">
                        <span class="material-symbols-outlined text-[14px]">verified</span> Protected Consumer
                    </span>
                `;
            } else {
                topnavMenu.innerHTML = `
                    <a href="#/dashboard" class="font-body-md text-body-md ${hash === '#/dashboard' ? 'text-primary border-b-2 border-primary pb-1 font-semibold' : 'text-on-surface-variant hover:text-primary transition-colors'}">Global View</a>
                    <a href="#/reports" class="font-body-md text-body-md ${hash === '#/reports' ? 'text-primary border-b-2 border-primary pb-1 font-semibold' : 'text-on-surface-variant hover:text-primary transition-colors'}">Compliance</a>
                    <a href="#/settings" class="font-body-md text-body-md ${hash === '#/settings' ? 'text-primary border-b-2 border-primary pb-1 font-semibold' : 'text-on-surface-variant hover:text-primary transition-colors'}">Settings</a>
                    <a href="#/applicant" class="font-label-md text-xs px-2.5 py-1 rounded-md bg-[#bde9d8] text-[#002018] hover:bg-secondary-fixed transition-colors font-medium flex items-center gap-1 ml-2" title="Preview consumer applicant view">
                        <span class="material-symbols-outlined text-[14px]">visibility</span> Preview Applicant View
                    </a>
                `;
            }
        }

        // 4. Update sidebar header
        const sidebarTitle = document.getElementById('sidebar-title');
        const sidebarSubtitle = document.getElementById('sidebar-subtitle');
        if (sidebarTitle && sidebarSubtitle) {
            if (isApplicant) {
                sidebarTitle.textContent = 'Applicant Portal';
                sidebarSubtitle.textContent = 'Fair Lending Transparency';
            } else {
                sidebarTitle.textContent = 'Bank Governance';
                sidebarSubtitle.textContent = 'Enterprise Suite';
            }
        }

        // 5. Update sidebar navigation items
        const sidebarNav = document.getElementById('sidebar-nav-list');
        if (sidebarNav) {
            if (isApplicant) {
                sidebarNav.innerHTML = `
                    <a href="#/applicant" class="flex items-center gap-base p-3 mb-1 cursor-pointer text-on-surface-variant hover:bg-surface-container-high transition-all rounded-lg font-label-md text-label-md sidebar-link ${hash === '#/applicant' ? 'active bg-secondary-container text-on-secondary-container font-semibold' : ''}">
                        <span class="material-symbols-outlined" data-icon="assignment">assignment</span> My Application
                    </a>
                    <a href="#/decision" class="flex items-center gap-base p-3 mb-1 cursor-pointer text-on-surface-variant hover:bg-surface-container-high transition-all rounded-lg font-label-md text-label-md sidebar-link ${hash === '#/decision' ? 'active bg-secondary-container text-on-secondary-container font-semibold' : ''}">
                        <span class="material-symbols-outlined" data-icon="visibility">visibility</span> Decision & Explainability
                    </a>
                `;
            } else {
                sidebarNav.innerHTML = `
                    <a href="#/dashboard" class="flex items-center gap-base p-3 mb-1 cursor-pointer text-on-surface-variant hover:bg-surface-container-high transition-all rounded-lg font-label-md text-label-md sidebar-link ${hash === '#/dashboard' ? 'active bg-secondary-container text-on-secondary-container font-semibold' : ''}">
                        <span class="material-symbols-outlined" data-icon="dashboard">dashboard</span> Overview
                    </a>
                    <a href="#/auditor" class="flex items-center gap-base p-3 mb-1 cursor-pointer text-on-surface-variant hover:bg-surface-container-high transition-all rounded-lg font-label-md text-label-md sidebar-link ${hash === '#/auditor' ? 'active bg-secondary-container text-on-secondary-container font-semibold' : ''}">
                        <span class="material-symbols-outlined" data-icon="fact_check">fact_check</span> Auditor
                    </a>
                    <a href="#/arena" class="flex items-center gap-base p-3 mb-1 cursor-pointer text-on-surface-variant hover:bg-surface-container-high transition-all rounded-lg font-label-md text-label-md sidebar-link ${hash === '#/arena' ? 'active bg-secondary-container text-on-secondary-container font-semibold' : ''}">
                        <span class="material-symbols-outlined" data-icon="swords">swords</span> Arena
                    </a>
                    <a href="#/interceptor" class="flex items-center gap-base p-3 mb-1 cursor-pointer text-on-surface-variant hover:bg-surface-container-high transition-all rounded-lg font-label-md text-label-md sidebar-link ${hash === '#/interceptor' ? 'active bg-secondary-container text-on-secondary-container font-semibold' : ''}">
                        <span class="material-symbols-outlined" data-icon="security">security</span> Interceptor
                    </a>
                    <a href="#/vaccine" class="flex items-center gap-base p-3 mb-1 cursor-pointer text-on-surface-variant hover:bg-surface-container-high transition-all rounded-lg font-label-md text-label-md sidebar-link ${hash === '#/vaccine' ? 'active bg-secondary-container text-on-secondary-container font-semibold' : ''}">
                        <span class="material-symbols-outlined" data-icon="vaccines">vaccines</span> Vaccine Generator
                    </a>
                    <a href="#/decision" class="flex items-center gap-base p-3 mb-1 cursor-pointer text-on-surface-variant hover:bg-surface-container-high transition-all rounded-lg font-label-md text-label-md sidebar-link ${hash === '#/decision' ? 'active bg-secondary-container text-on-secondary-container font-semibold' : ''}">
                        <span class="material-symbols-outlined" data-icon="rule">rule</span> Decisions
                    </a>
                    <a href="#/reports" class="flex items-center gap-base p-3 mb-1 cursor-pointer text-on-surface-variant hover:bg-surface-container-high transition-all rounded-lg font-label-md text-label-md sidebar-link ${hash === '#/reports' ? 'active bg-secondary-container text-on-secondary-container font-semibold' : ''}">
                        <span class="material-symbols-outlined" data-icon="summarize">summarize</span> Reports
                    </a>
                    <a href="#/settings" class="flex items-center gap-base p-3 mb-1 cursor-pointer text-on-surface-variant hover:bg-surface-container-high transition-all rounded-lg font-label-md text-label-md sidebar-link ${hash === '#/settings' ? 'active bg-secondary-container text-on-secondary-container font-semibold' : ''}">
                        <span class="material-symbols-outlined" data-icon="settings">settings</span> Settings
                    </a>
                `;
            }
        }

        // Prevent empty links from breaking routing
        document.querySelectorAll('a[href="#"]').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
            });
        });
    },

    // -----------------------------------------------------
    // Page Initializers
    // -----------------------------------------------------
    
    initLogin() {
        const form = document.querySelector('#auth-content form');
        const btn = form?.querySelector('button[type="submit"]');
        if (!form || !btn) return;
        
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const emailInput = document.getElementById('email');
            const passwordInput = document.getElementById('password');
            const email = emailInput && emailInput.value ? emailInput.value : 'admin@rayctify.com';
            const password = passwordInput && passwordInput.value ? passwordInput.value : 'password';

            btn.innerHTML = `<span class="spinner"></span> Logging in...`;
            try {
                const res = await window.api.auth.login(email, password);
                const role = res?.user?.role;
                window.location.hash = role === 'applicant' ? '#/applicant' : '#/dashboard';
            } catch (err) {
                alert(err.message);
                btn.innerHTML = `Login`;
            }
        });
        
        // Make Sign up link work
        const signupLink = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Sign up'));
        if (signupLink) signupLink.setAttribute('href', '#/signup');
    },
    
    initSignup() {
        const form = document.querySelector('#auth-content form');
        const btn = form?.querySelector('button[type="submit"]');
        if (!form || !btn) return;
        
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const emailInput = document.getElementById('work_email');
            const passwordInput = document.getElementById('password');
            const email = emailInput && emailInput.value ? emailInput.value : 'new@rayctify.com';
            const password = passwordInput && passwordInput.value ? passwordInput.value : 'password';

            btn.innerHTML = `<span class="spinner"></span> Creating account...`;
            try {
                await window.api.auth.signup(email, password);
                window.location.hash = '#/login';
            } catch (err) {
                btn.innerHTML = `Create Institutional Account <span class="material-symbols-outlined text-[18px]">arrow_forward</span>`;
            }
        });
        
        // Login link
        document.querySelectorAll('a').forEach(a => {
            if (a.textContent.includes('Log in')) {
                a.setAttribute('href', '#/login');
            }
        });
    },

    initDashboard() {
        const newAuditBtn = document.querySelector('header button');
        if (newAuditBtn) {
            newAuditBtn.addEventListener('click', () => {
                window.location.hash = '#/auditor';
            });
        }
        
        // Settings/Compliance links in topnav
        document.querySelectorAll('nav span').forEach(span => {
            if (span.textContent.trim() === 'Settings') {
                span.addEventListener('click', () => window.location.hash = '#/settings');
            }
        });
    },
    
    initAuditor() {
        const dropZone = document.querySelector('.border-dashed');
        if (!dropZone) return;
        this.enableModelUpload(dropZone);
    },

    enableModelUpload(dropZone, onSuccess) {
        const acceptedExtensions = ['pkl', 'pmml', 'onnx', 'joblib', 'csv'];
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = acceptedExtensions.map(extension => `.${extension}`).join(',');
        fileInput.className = 'hidden';
        dropZone.appendChild(fileInput);

        const upload = async (file) => {
            if (!file) return;
            const extension = file.name.split('.').pop().toLowerCase();
            if (!acceptedExtensions.includes(extension)) {
                alert(`Unsupported model format. Choose: ${acceptedExtensions.map(item => `.${item}`).join(', ')}`);
                return;
            }
            if (file.size > 500 * 1024 * 1024) {
                alert('Model files must be 500MB or smaller.');
                return;
            }

            const originalContent = dropZone.innerHTML;
            dropZone.innerHTML = `<div class="flex flex-col items-center justify-center py-12"><span class="spinner mb-4"></span><p>Uploading ${file.name}...</p></div>`;
            try {
                const result = await window.api.auditor.uploadModel(file);
                if (result.kind === 'model') {
                    const nextZone = dropZone.cloneNode(false);
                    nextZone.innerHTML = `<div class="flex flex-col items-center justify-center py-12"><span class="material-symbols-outlined text-primary text-4xl mb-4">check_circle</span><p class="mb-3">${file.name} uploaded successfully.</p><p class="text-sm mb-4">Upload an evaluation CSV to calculate fairness metrics.</p><button class="px-6 py-2 rounded-full bg-surface-variant text-on-surface font-label-md text-label-md hover:bg-surface-dim transition-colors">Upload evaluation CSV</button></div>`;
                    dropZone.replaceWith(nextZone);
                    this.enableModelUpload(nextZone, onSuccess);
                } else {
                    dropZone.innerHTML = `<div class="flex flex-col items-center justify-center py-12"><span class="material-symbols-outlined text-primary text-4xl mb-4">check_circle</span><p>${file.name} analyzed successfully.</p></div>`;
                }
                if (onSuccess) setTimeout(() => onSuccess(result), 500);
            } catch (error) {
                const nextZone = dropZone.cloneNode(false);
                nextZone.innerHTML = originalContent;
                dropZone.replaceWith(nextZone);
                this.enableModelUpload(nextZone, onSuccess);
                alert(error.message || 'Model upload failed. Please try again.');
            }
        };

        fileInput.addEventListener('change', () => upload(fileInput.files[0]));
        dropZone.addEventListener('click', event => {
            if (!event.target.closest('input')) fileInput.click();
        });
        dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('border-primary', 'bg-surface-container-highest'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-primary', 'bg-surface-container-highest'));
        dropZone.addEventListener('drop', event => { event.preventDefault(); dropZone.classList.remove('border-primary', 'bg-surface-container-highest'); upload(event.dataTransfer.files[0]); });
    },
    
    initArena() {
        const uploadHeading = Array.from(document.querySelectorAll('h3')).find(heading => heading.textContent.includes('Upload Model Weights'));
        if (uploadHeading) this.enableModelUpload(uploadHeading.closest('div[class*="border-dashed"]'), () => this.refreshArenaAnalysis());
        this.refreshArenaAnalysis();
        // Attach sliders logic (visual only)
        const sliders = document.querySelectorAll('input[type="range"]');
        sliders.forEach(slider => {
            slider.addEventListener('input', (e) => {
                const parent = slider.parentElement.parentElement;
                const valueDisplay = parent.querySelector('.text-primary, .text-on-surface');
                if (valueDisplay) {
                    if (valueDisplay.textContent.includes('%')) {
                        valueDisplay.textContent = e.target.value + '%';
                    } else if (valueDisplay.textContent.includes('K')) {
                        valueDisplay.textContent = e.target.value + 'K';
                    } else {
                        valueDisplay.textContent = e.target.value;
                    }
                }
            });
        });
    },

    async refreshArenaAnalysis() {
        try {
            const { analysis, model } = await window.api.analysis.getLatest();
            const modelHeading = Array.from(document.querySelectorAll('h2')).find(item => item.textContent.trim() === 'Your Model');
            const modelBadge = modelHeading?.parentElement.querySelector('span');
            if (model && modelBadge) modelBadge.textContent = model.name;
            const valueFor = heading => Array.from(document.querySelectorAll('h3')).find(item => item.textContent.trim() === heading)?.closest('div[class*="bg-surface-beige"]');
            const approvalGap = valueFor('Approval Gap');
            const riskDelta = valueFor('Risk Delta');
            const fairnessScore = valueFor('Fairness Score');
            const outcomeHeading = Array.from(document.querySelectorAll('h4')).find(item => item.textContent.includes('Simulated Outcome'));
            const outcome = outcomeHeading?.parentElement.querySelector('.font-headline-lg');
            const confidence = outcomeHeading?.parentElement.querySelector('.font-data-mono');
            if (!analysis) {
                if (approvalGap) approvalGap.querySelector('.font-headline-lg').textContent = '—';
                if (riskDelta) riskDelta.querySelector('.font-headline-lg').textContent = '—';
                if (fairnessScore) fairnessScore.querySelector('.font-headline-md').textContent = '—';
                if (outcome) {
                    outcome.textContent = 'Awaiting Evaluation';
                    outcome.classList.remove('text-error', 'text-primary');
                    outcome.classList.add('text-on-surface');
                }
                if (confidence) confidence.textContent = 'Upload the matching evaluation CSV';
                return;
            }
            if (approvalGap) approvalGap.querySelector('.font-headline-lg').textContent = `${analysis.approvalGap}%`;
            if (riskDelta) riskDelta.querySelector('.font-headline-lg').textContent = analysis.riskDelta === null ? 'N/A' : analysis.riskDelta.toFixed(3);
            if (fairnessScore) fairnessScore.querySelector('.font-headline-md').textContent = `${analysis.fairnessScore}/100`;
            if (outcome) {
                const passed = analysis.fairnessScore >= 80;
                outcome.textContent = passed ? 'Fairness Pass' : 'Bias Detected';
                outcome.classList.toggle('text-error', !passed);
                outcome.classList.toggle('text-primary', passed);
                outcome.classList.remove('text-on-surface');
            }
            if (confidence) {
                confidence.textContent = analysis.accuracy === null
                    ? `Based on ${analysis.records} evaluation records`
                    : `Evaluation accuracy: ${analysis.accuracy}%`;
            }
        } catch (error) {
            console.error('Could not load fairness analysis:', error);
        }
    },
    
    initInterceptor() {
        const uploadHeading = Array.from(document.querySelectorAll('h3')).find(heading => heading.textContent.includes('Drag and drop model file'));
        if (uploadHeading) this.enableModelUpload(uploadHeading.closest('div[class*="border-dashed"]'));
        const buttons = document.querySelectorAll('button');
        let healBtn = null;
        buttons.forEach(b => {
            if (b.textContent.includes('Calculate Healing') || b.textContent.includes('Heal')) {
                healBtn = b;
            }
        });
        
        if (healBtn) {
            healBtn.addEventListener('click', async () => {
                healBtn.innerHTML = `<span class="spinner"></span> Processing...`;
                await window.api.interceptor.healModel();
                healBtn.innerHTML = `<span class="material-symbols-outlined">check</span> Healed`;
                healBtn.classList.remove('bg-primary');
                healBtn.classList.add('bg-dark-primary');
                setTimeout(() => {
                    window.location.hash = '#/vaccine';
                }, 1000);
            });
        }
    },
    
    initVaccine() {
        const buttons = document.querySelectorAll('button');
        let runBtn = null;
        buttons.forEach(b => {
            if (b.textContent.includes('Run Healing Calculation') || b.textContent.includes('Generate')) {
                runBtn = b;
            }
        });
        
        if (runBtn) {
            runBtn.addEventListener('click', async () => {
                runBtn.innerHTML = `<span class="spinner"></span> Generating...`;
                await window.api.vaccine.generateVaccine();
                runBtn.innerHTML = `Export Dataset <span class="material-symbols-outlined ml-2">download</span>`;
            });
        }
    },
    
    initReports() {
        // Search functionality
        const searchInput = document.querySelector('input[type="text"]');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                document.querySelectorAll('tbody tr').forEach(row => {
                    const text = row.textContent.toLowerCase();
                    row.style.display = text.includes(term) ? '' : 'none';
                });
            });
        }
    },
    
    initSettings() {
        const buttons = document.querySelectorAll('button');
        let saveBtn = null;
        buttons.forEach(b => {
            if (b.textContent.includes('Save')) {
                saveBtn = b;
            }
        });

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const originalText = saveBtn.textContent;
                saveBtn.innerHTML = `<span class="spinner"></span> Saving...`;
                await window.api.settings.updateSettings({});
                saveBtn.textContent = 'Saved!';
                setTimeout(() => {
                    saveBtn.textContent = originalText;
                }, 2000);
            });
        }
    },
    
    async initApplicant() {
        try {
            const statusData = await window.api.applicant.getStatus();
            if (!statusData) return;

            const titleEl = document.getElementById('applicant-title-status');
            const refEl = document.getElementById('applicant-ref');
            const badgeEl = document.getElementById('applicant-badge-status');
            const banner = document.getElementById('applicant-notification-banner');

            if (titleEl) titleEl.textContent = `Application ${statusData.status}`;
            if (refEl) refEl.textContent = `Reference ID: ${statusData.referenceId || 'APP-9482-XY'}`;

            if (badgeEl) {
                if (statusData.appealRequested) {
                    badgeEl.innerHTML = `<span class="material-symbols-outlined text-[16px]">gavel</span> Appeal in Review`;
                    badgeEl.className = 'bg-[#ffdcbd] text-[#56340e] px-4 py-1.5 rounded-full font-label-md text-label-md border border-[#f0bd8b] flex items-center gap-2 font-medium';
                } else {
                    badgeEl.innerHTML = `<span class="material-symbols-outlined text-[16px]">schedule</span> ${statusData.status}`;
                }
            }

            if (statusData.appealRequested && banner) {
                banner.className = 'mb-6 p-4 rounded-xl bg-[#c0ecdb] text-[#002018] border border-[#a4d0c0] flex items-start sm:items-center gap-3 shadow-sm';
                banner.innerHTML = `
                    <span class="material-symbols-outlined text-primary text-[24px]">verified</span>
                    <div>
                        <strong class="block font-title-lg text-sm">Human Review In Progress</strong>
                        <p class="font-body-md text-xs mt-0.5">Your appeal was registered on ${statusData.appealDate || 'recently'}. A senior human compliance auditor has been assigned to conduct an independent review under fair lending standards.</p>
                    </div>
                `;
                banner.classList.remove('hidden');
            }

            // Key factors binding
            if (statusData.creditScore) {
                const scoreEl = document.getElementById('applicant-val-score');
                if (scoreEl) scoreEl.textContent = statusData.creditScore;
            }
            if (statusData.income) {
                const incEl = document.getElementById('applicant-val-income');
                if (incEl) incEl.textContent = statusData.income;
            }
            if (statusData.debtToIncome) {
                const dtiEl = document.getElementById('applicant-val-dti');
                if (dtiEl) dtiEl.textContent = statusData.debtToIncome;
            }
            if (statusData.employment) {
                const empEl = document.getElementById('applicant-val-emp');
                if (empEl) empEl.textContent = statusData.employment;
            }
        } catch (err) {
            console.error('Failed to load applicant status:', err);
        }
    },

    async initDecision() {
        const contactBtn = document.getElementById('btn-applicant-contact');
        const reevalBtn = document.getElementById('btn-applicant-reeval');
        const feedback = document.getElementById('decision-feedback');
        const badge = document.getElementById('decision-badge');

        if (reevalBtn) {
            reevalBtn.addEventListener('click', async () => {
                const orig = reevalBtn.innerHTML;
                reevalBtn.disabled = true;
                reevalBtn.innerHTML = `<span class="spinner"></span> Re-evaluating...`;
                try {
                    const res = await window.api.applicant.reevaluate();
                    if (badge) {
                        badge.textContent = 'Re-evaluation Active';
                        badge.className = 'font-label-md text-label-md text-primary uppercase tracking-wider font-semibold';
                    }
                    if (feedback) {
                        feedback.className = 'mt-4 p-4 rounded-xl bg-[#c0ecdb] text-[#002018] border border-[#a4d0c0] flex items-center gap-3 animate-fade-in';
                        feedback.innerHTML = `
                            <span class="material-symbols-outlined text-primary text-[24px]">task_alt</span>
                            <div>
                                <strong class="block font-label-md text-sm">Debiased Re-evaluation Dispatched</strong>
                                <p class="text-xs mt-0.5">${res.message || 'Application re-submitted through RayCtify Fair Interceptor.'}</p>
                            </div>
                        `;
                        feedback.classList.remove('hidden');
                    }
                } catch (e) {
                    alert(e.message || 'Re-evaluation request failed');
                } finally {
                    reevalBtn.disabled = false;
                    reevalBtn.innerHTML = orig;
                }
            });
        }

        if (contactBtn) {
            contactBtn.addEventListener('click', async () => {
                const notes = prompt('Enter your inquiry or dispute details for the human compliance officer:', 'I would like to request an expedited manual review of my credit evaluation due to recent debt payoff.');
                if (notes === null) return;

                const orig = contactBtn.innerHTML;
                contactBtn.disabled = true;
                contactBtn.innerHTML = `<span class="spinner"></span> Submitting Appeal...`;
                try {
                    const res = await window.api.applicant.appeal(notes);
                    if (badge) {
                        badge.textContent = 'Appeal Under Human Review';
                    }
                    if (feedback) {
                        feedback.className = 'mt-4 p-4 rounded-xl bg-[#c0ecdb] text-[#002018] border border-[#a4d0c0] flex items-center gap-3 animate-fade-in';
                        feedback.innerHTML = `
                            <span class="material-symbols-outlined text-primary text-[24px]">gavel</span>
                            <div>
                                <strong class="block font-label-md text-sm">Appeal Successfully Submitted</strong>
                                <p class="text-xs mt-0.5">Your inquiry and dispute notes have been logged for mandatory human inspection under ECOA fair lending procedures.</p>
                            </div>
                        `;
                        feedback.classList.remove('hidden');
                    }
                } catch (e) {
                    alert(e.message || 'Appeal failed');
                } finally {
                    contactBtn.disabled = false;
                    contactBtn.innerHTML = orig;
                }
            });
        }
    }
};

window.addEventListener('DOMContentLoaded', () => {
    app.init();
});
