// pages.js — public (sign in / sign up) and applicant-facing pages.
// Admin pages are in views.js. Both attach their init functions to `app`.
const pages = {};

/* ------------------------------------------------------------------ */
/* Sign in / sign up                                                   */
/* ------------------------------------------------------------------ */
const authLayout = (inner) => `
<div class="flex flex-1 w-full min-h-screen">
  <aside class="hidden lg:flex w-1/2 bg-primary text-on-primary p-16 flex-col justify-between" aria-hidden="true">
    <div class="flex items-center gap-3"><img src="logo.svg" alt="" class="h-10 w-10"><span class="font-headline-md text-headline-md">RayCtify</span></div>
    <div>
      <h1 class="font-display-lg text-display-lg mb-8">Fairness by design.<br>Trust by audit.</h1>
      <ul class="space-y-5 font-body-lg text-body-lg">
        <li class="flex gap-3"><span class="material-symbols-outlined">balance</span>Measure approval gaps between groups, including the four-fifths rule.</li>
        <li class="flex gap-3"><span class="material-symbols-outlined">healing</span>Get a concrete mitigation plan and reweighing data when a model falls short.</li>
        <li class="flex gap-3"><span class="material-symbols-outlined">gavel</span>Give applicants a clear route to human review of any decision.</li>
      </ul>
    </div>
    <p class="text-sm opacity-70">Group-level outcome analysis from your own evaluation data.</p>
  </aside>
  <section class="flex-1 flex items-center justify-center p-6 sm:p-12">
    <div class="w-full max-w-md">${inner}</div>
  </section>
</div>`;

const textField = (id, label, type = 'text', extra = '') => `
  <div>
    <label for="${id}" class="block font-label-md text-label-md mb-1.5">${label}</label>
    <input id="${id}" name="${id}" type="${type}" ${extra} class="w-full h-12 px-4 rounded-lg border border-outline-variant bg-white"/>
  </div>`;

pages.login = () => authLayout(`
  <h2 class="font-headline-lg text-headline-lg text-primary mb-1">Welcome back</h2>
  <p class="text-on-surface-variant mb-8">Sign in to your account.</p>
  <form id="login-form" class="space-y-5" novalidate>
    ${textField('email', 'Email', 'email', 'autocomplete="username" required')}
    ${textField('password', 'Password', 'password', 'autocomplete="current-password" required')}
    <button id="auth-submit" type="submit" class="w-full h-12 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-container transition-colors">Sign in</button>
  </form>
  <p class="mt-6 text-sm text-on-surface-variant">New here? <a href="#/signup" class="text-primary font-semibold hover:underline">Create an account</a></p>`);

pages.signUp = () => authLayout(`
  <h2 class="font-headline-lg text-headline-lg text-primary mb-1">Create your account</h2>
  <p class="text-on-surface-variant mb-8">Applicants can follow their application and request a human review. Lender staff need an invite code from an existing administrator.</p>
  <form id="signup-form" class="space-y-5" novalidate>
    ${textField('email', 'Email', 'email', 'autocomplete="username" required')}
    <div>
      <label for="password" class="block font-label-md text-label-md mb-1.5">Password</label>
      <input id="password" name="password" type="password" autocomplete="new-password" required aria-describedby="pw-hint" class="w-full h-12 px-4 rounded-lg border border-outline-variant bg-white"/>
      <p id="pw-hint" class="text-xs text-on-surface-variant mt-1">At least 10 characters.</p>
    </div>
    <div>
      <label for="invite-code" class="block font-label-md text-label-md mb-1.5">Staff invite code <span class="font-normal text-on-surface-variant">(optional)</span></label>
      <input id="invite-code" name="invite-code" autocomplete="off" placeholder="Leave blank if you are an applicant" class="w-full h-12 px-4 rounded-lg border border-outline-variant bg-white"/>
    </div>
    <button id="auth-submit" type="submit" class="w-full h-12 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-container transition-colors">Create account</button>
  </form>
  <p class="mt-6 text-sm text-on-surface-variant">Already have an account? <a href="#/login" class="text-primary font-semibold hover:underline">Sign in</a></p>`);

/* ------------------------------------------------------------------ */
/* Applicant helpers                                                   */
/* ------------------------------------------------------------------ */
const RESOLVED = ['Approved on Appeal', 'Decision Upheld After Review'];
const statusTone = (status) => {
    if (status === 'Approved on Appeal') return 'bg-secondary-container text-on-secondary-container';
    if (status === 'Decision Upheld After Review') return 'bg-[#ffdcbd] text-[#56340e]';
    if (status === 'Appeal Under Human Review') return 'bg-[#d6e3ff] text-[#001b3e]';
    return 'bg-surface-container-high text-on-surface';
};

const timeline = (app) => {
    const steps = ['Submitted', 'Verification', 'Risk assessment', 'Decision'];
    const resolved = RESOLVED.includes(app.status);
    return `<ol class="flex flex-wrap gap-y-4 items-center" aria-label="Application progress">${steps.map((label, i) => {
        const n = i + 1;
        const state = resolved || n < app.stage ? 'done' : n === app.stage ? 'current' : 'todo';
        const dot = state === 'done' ? 'bg-primary text-on-primary' : state === 'current' ? 'bg-white border-2 border-primary text-primary' : 'bg-surface-container-high text-on-surface-variant';
        const icon = state === 'done' ? 'check' : state === 'current' ? 'hourglass_empty' : 'circle';
        return `<li class="flex items-center" ${state === 'current' ? 'aria-current="step"' : ''}>
            <span class="w-9 h-9 rounded-full grid place-items-center ${dot}"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">${icon}</span></span>
            <span class="ml-2 mr-4 text-sm ${state === 'todo' ? 'text-on-surface-variant' : 'font-semibold'}">${label}</span>
            ${n < steps.length ? '<span class="hidden sm:block w-8 h-px bg-outline-variant mr-4" aria-hidden="true"></span>' : ''}</li>`;
    }).join('')}</ol>`;
};

const factorList = (app) => [
    ['Credit score', app.creditScore], ['Annual income', app.income], ['Debt-to-income', app.debtToIncome], ['Employment', app.employment]
].map(([label, value]) => `<div class="p-4 rounded-lg bg-surface-beige border border-surface-variant"><dt class="text-sm text-on-surface-variant">${label}</dt><dd class="font-title-lg text-title-lg text-primary mt-1">${esc(value ?? '—')}</dd></div>`).join('');

const resolutionNotice = (app) => {
    if (app.appealRequested) {
        return `<div class="rounded-lg border border-[#b6c8ec] bg-[#eef3ff] p-4"><p class="font-semibold">Your request for human review was received${app.appealDate ? ` on ${esc(app.appealDate)}` : ''}.</p>
            ${app.notes ? `<p class="text-sm mt-1 text-on-surface-variant">You wrote: “${esc(app.notes)}”</p>` : ''}</div>`;
    }
    const r = app.lastResolution;
    if (!r) return '';
    const approved = r.outcome === 'approved';
    return `<div class="rounded-lg border ${approved ? 'border-primary bg-secondary-container/40' : 'border-[#e7c9a4] bg-[#fff4e6]'} p-4">
        <p class="font-semibold">${approved ? 'Your appeal was approved.' : 'After human review, the original decision stands.'} <span class="font-normal text-on-surface-variant">Reviewed ${esc(r.date)}</span></p>
        ${r.comment ? `<p class="text-sm mt-1">${esc(r.comment)}</p>` : ''}</div>`;
};

/* ------------------------------------------------------------------ */
/* Applicant: My application                                           */
/* ------------------------------------------------------------------ */
pages.applicantDashboard = () => `
<div class="px-margin-mobile md:px-margin-desktop py-10 max-w-[900px]">
  <header class="mb-8">
    <h1 id="applicant-title-status" class="font-headline-lg text-headline-lg text-primary">Your application</h1>
    <p class="text-on-surface-variant mt-1">Reference <span id="applicant-ref" class="font-semibold tabular-nums">…</span> · <span id="applicant-product"></span></p>
  </header>
  <div id="applicant-body" class="space-y-8"><p class="text-on-surface-variant"><span class="spinner"></span>Loading…</p></div>
</div>`;

app.initApplicant = async function () {
    const body = document.getElementById('applicant-body');
    try {
        const a = await window.api.applicant.getStatus();
        if (!a) { body.innerHTML = '<p>We could not find an application for your account.</p>'; return; }
        document.getElementById('applicant-title-status').textContent = `Application: ${a.status}`;
        document.getElementById('applicant-ref').textContent = a.referenceId;
        document.getElementById('applicant-product').textContent = a.product;
        body.innerHTML = `
          <section aria-label="Status" class="space-y-4">
            <span id="applicant-badge-status" class="pill ${statusTone(a.status)}">${esc(a.status)}</span>
            ${timeline(a)}
            ${resolutionNotice(a)}
          </section>
          <section aria-labelledby="factors-h">
            <h2 id="factors-h" class="font-title-lg text-title-lg text-primary mb-3">Information considered</h2>
            <dl class="grid grid-cols-2 md:grid-cols-4 gap-3">${factorList(a)}</dl>
            <p class="text-sm text-on-surface-variant mt-3">If anything here is wrong, tell us when you request a review.</p>
          </section>
          <section class="rounded-lg border border-outline-variant bg-white p-6">
            <h2 class="font-title-lg text-title-lg text-primary mb-2">How your application is evaluated</h2>
            <p class="max-w-prose">This lender audits its decision models for differences in outcomes between groups of applicants. Audits do not guarantee any individual decision is correct, so you can always ask a person to look at yours.</p>
            <a href="#/rights" class="inline-flex items-center gap-1 mt-4 text-primary font-semibold hover:underline">Your rights and how to request a review <span class="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span></a>
          </section>`;
    } catch (error) { body.innerHTML = ''; toast(error.message, 'error'); }
};

/* ------------------------------------------------------------------ */
/* Applicant: Your rights                                              */
/* ------------------------------------------------------------------ */
pages.rights = () => `
<div class="px-margin-mobile md:px-margin-desktop py-10 max-w-[900px]">
  <header class="mb-8">
    <h1 class="font-headline-lg text-headline-lg text-primary">Your rights</h1>
    <p class="text-on-surface-variant mt-1">What you can ask for, and how to ask for a human review.</p>
  </header>
  <div id="rights-body" class="space-y-8"><p class="text-on-surface-variant"><span class="spinner"></span>Loading…</p></div>
</div>`;

app.initRights = async function () {
    const body = document.getElementById('rights-body');
    try {
        const a = await window.api.applicant.getStatus();
        if (!a) { body.innerHTML = '<p>We could not find an application for your account.</p>'; return; }
        const locked = a.appealRequested;
        body.innerHTML = `
          <section aria-label="Current status" class="space-y-3">
            <span id="decision-badge" class="pill ${statusTone(a.status)}">${esc(a.status)}</span>
            ${resolutionNotice(a)}
          </section>
          <section aria-labelledby="req-h" class="rounded-lg border border-outline-variant bg-white p-6">
            <h2 id="req-h" class="font-title-lg text-title-lg text-primary mb-2">Ask for a human review</h2>
            <p class="text-sm text-on-surface-variant mb-4">A member of staff will look at your application again. Tell us anything you think was missed or is wrong.</p>
            <label for="appeal-notes" class="block font-label-md text-label-md mb-1.5">Your message</label>
            <textarea id="appeal-notes" rows="4" maxlength="1000" ${locked ? 'disabled' : ''} class="w-full p-3 rounded-lg border border-outline-variant bg-white" placeholder="For example: my recent repayment history is not reflected."></textarea>
            <div class="mt-4"><button id="btn-appeal" ${locked ? 'disabled' : ''} class="h-11 px-6 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-container disabled:opacity-50 disabled:cursor-not-allowed">${locked ? 'Review already requested' : 'Request human review'}</button></div>
          </section>
          <section aria-labelledby="rights-h">
            <h2 id="rights-h" class="font-title-lg text-title-lg text-primary mb-3">What you can expect</h2>
            <ul class="space-y-3 max-w-prose">
              ${[
                ['person', 'A person can review any decision', 'You do not have to accept an automated outcome.'],
                ['description', 'Reasons for a decline', 'In many places, including under ECOA / Regulation B in the United States, lenders must tell you the specific reasons credit was declined. Ask us if you have not received them.'],
                ['edit_note', 'Correct your information', 'If any detail we hold about you is wrong, you can ask us to fix it and reconsider.'],
                ['balance', 'Equal treatment', 'Decisions should not depend on protected characteristics such as race, sex, age or religion.']
              ].map(([icon, title, text]) => `<li class="flex gap-3"><span class="material-symbols-outlined text-primary mt-0.5" aria-hidden="true">${icon}</span><div><p class="font-semibold">${title}</p><p class="text-on-surface-variant text-sm">${text}</p></div></li>`).join('')}
            </ul>
            <p class="text-xs text-on-surface-variant mt-4">This is general information, not legal advice.</p>
          </section>`;
        document.getElementById('btn-appeal').addEventListener('click', async (event) => {
            try {
                await withBusy(event.currentTarget, 'Sending…', () => window.api.applicant.appeal(document.getElementById('appeal-notes').value.trim()));
                toast('Your request was sent. A person will review your application.');
                app.initRights();
            } catch (error) { toast(error.message, 'error'); }
        });
    } catch (error) { body.innerHTML = ''; toast(error.message, 'error'); }
};
