// views.js — lender-facing (admin) pages. Helpers `esc`, `toast`, `withBusy` come from app.js.

const statusPill = (audit) => {
    if (audit.status === 'Passed') return '<span class="pill pill-pass"><span class="material-symbols-outlined text-[14px]" aria-hidden="true">check_circle</span>Passed</span>';
    if (audit.status === 'Failed') return '<span class="pill pill-fail"><span class="material-symbols-outlined text-[14px]" aria-hidden="true">warning</span>Failed</span>';
    return `<span class="pill pill-wait"><span class="material-symbols-outlined text-[14px]" aria-hidden="true">hourglass_top</span>${esc(audit.status)}</span>`;
};
const scoreBar = (audit, threshold) => {
    if (typeof audit.score !== 'number') return '<span class="text-on-surface-variant">—</span>';
    const color = audit.score >= threshold ? '#2D6A4F' : '#ba1a1a';
    return `<div class="flex items-center gap-3"><div class="score-track" role="img" aria-label="Fairness score ${audit.score} of 100"><div class="score-fill" style="width:${audit.score}%;background:${color}"></div></div><span class="font-semibold tabular-nums">${audit.score}</span></div>`;
};
const pageFrame = (title, subtitle, body, width = 1100) => `
<div class="px-margin-mobile md:px-margin-desktop py-10" style="max-width:${width}px">
  <header class="mb-8">
    <h1 class="font-headline-lg text-headline-lg text-primary">${title}</h1>
    ${subtitle ? `<p class="text-on-surface-variant mt-1 max-w-prose">${subtitle}</p>` : ''}
  </header>${body}
</div>`;
const tableShell = (head, bodyId, colspan, loading = 'Loading…') => `
<div class="overflow-x-auto border border-outline-variant rounded-lg bg-white">
  <table class="data-table"><thead><tr>${head}</tr></thead><tbody id="${bodyId}"><tr><td colspan="${colspan}" class="text-on-surface-variant">${loading}</td></tr></tbody></table>
</div>`;
const emptyBox = (html) => `<p class="text-on-surface-variant border border-dashed border-outline-variant rounded-lg p-8 text-center">${html}</p>`;
const inputCls = 'w-full h-12 px-4 rounded-lg border border-outline-variant bg-white';
const btnCls = 'h-11 px-5 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-container transition-colors disabled:opacity-50';
const getAuditsWithData = async () => (await window.api.dashboard.getRecentAudits()).filter((a) => a.hasAnalysis);

/* ------------------------------------------------------------------ */
/* Portfolio                                                           */
/* ------------------------------------------------------------------ */
pages.bankDashboard = () => pageFrame('Portfolio', '<span id="dash-subtitle">Loading your portfolio…</span>', `
  <a id="appeals-banner" href="#/appeals" class="hidden mb-6 flex items-center justify-between gap-4 rounded-lg border border-[#b6c8ec] bg-[#eef3ff] px-4 py-3 hover:bg-[#e4ecff]">
    <span class="flex items-center gap-2"><span class="material-symbols-outlined" aria-hidden="true">gavel</span><span id="appeals-banner-text"></span></span>
    <span class="font-semibold text-primary">Review →</span>
  </a>
  <dl class="grid grid-cols-2 md:grid-cols-4 border-y border-outline-variant mb-10">
    ${['Models audited', 'Pass rate', 'Records evaluated', 'Average fairness score'].map((label, i) => `
    <div class="py-5 px-1 md:px-6 ${i ? 'md:border-l border-outline-variant' : ''}">
      <dt class="text-on-surface-variant text-sm">${label}</dt>
      <dd class="font-headline-md text-headline-md text-primary mt-1 tabular-nums" data-stat="${i}">—</dd>
    </div>`).join('')}
  </dl>
  <section aria-labelledby="audits-heading">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
      <h2 id="audits-heading" class="font-title-lg text-title-lg text-primary">Model audits</h2>
      <div class="flex gap-3 w-full sm:w-auto">
        <input id="audit-filter" type="search" placeholder="Filter by model or status" class="h-10 flex-1 sm:w-64 px-3 rounded-lg border border-outline-variant bg-white text-sm" aria-label="Filter audits"/>
        <a href="#/audits" class="h-10 px-4 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:bg-primary-container inline-flex items-center gap-1 whitespace-nowrap"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">add</span>New audit</a>
      </div>
    </div>
    ${tableShell('<th>Model</th><th>Date</th><th>Status</th><th>Fairness score</th><th class="text-right">Report</th>', 'audits-body', 5)}
  </section>`);

app.initDashboard = async function () {
    let audits = [], threshold = 80, reportsByAudit = {};
    const filter = document.getElementById('audit-filter');
    if (app.filterQuery) { filter.value = app.filterQuery; app.filterQuery = ''; document.getElementById('global-search-input').value = ''; }

    const renderAudits = () => {
        const term = filter.value.trim().toLowerCase();
        const rows = audits.filter((a) => `${a.modelName} ${a.status}`.toLowerCase().includes(term));
        document.getElementById('audits-body').innerHTML = rows.length ? rows.map((a) => `
            <tr>
              <td class="font-semibold">${esc(a.modelName)}</td>
              <td class="text-on-surface-variant tabular-nums">${esc(a.date)}</td>
              <td>${statusPill(a)}</td>
              <td>${scoreBar(a, threshold)}</td>
              <td class="text-right">${reportsByAudit[a.id] ? `<a class="text-primary font-semibold hover:underline" target="_blank" rel="noopener" href="/api/reports/${esc(reportsByAudit[a.id])}/download">Open report</a>` : '<span class="text-on-surface-variant">—</span>'}</td>
            </tr>`).join('')
            : `<tr><td colspan="5">${emptyBox(audits.length ? 'No audits match that filter.' : 'No audits yet. <a class="text-primary font-semibold underline" href="#/audits">Run your first audit</a>.')}</td></tr>`;
    };
    filter.addEventListener('input', renderAudits);

    try {
        const [m, a, reports] = await Promise.all([window.api.dashboard.getMetrics(), window.api.dashboard.getRecentAudits(), window.api.reports.getReports()]);
        threshold = m.threshold; audits = a;
        reportsByAudit = Object.fromEntries(reports.map((r) => [r.auditId, r.id]));
        const values = [m.modelsAudited, m.passRate === null ? '—' : `${m.passRate}%`, m.totalInferences.toLocaleString(), m.fairnessScore === null ? '—' : `${m.fairnessScore}/100`];
        document.querySelectorAll('[data-stat]').forEach((el) => { el.textContent = values[Number(el.dataset.stat)]; });
        document.getElementById('dash-subtitle').textContent = `${m.awaiting} awaiting evaluation data · pass threshold ${m.threshold}/100 and four-fifths rule`;
        if (m.openAppeals) {
            document.getElementById('appeals-banner').classList.remove('hidden');
            document.getElementById('appeals-banner-text').textContent = `${m.openAppeals} applicant appeal${m.openAppeals === 1 ? '' : 's'} waiting for human review`;
        }
        renderAudits();
    } catch (error) { toast(error.message || 'Could not load the portfolio', 'error'); }
};

/* ------------------------------------------------------------------ */
/* Audits                                                              */
/* ------------------------------------------------------------------ */
pages.audits = () => pageFrame('Audits', 'Upload a model, then the evaluation CSV that holds its predictions. RayCtify measures outcomes by protected group and gives a verdict against your policy.', `
  <ol class="flex flex-wrap gap-x-8 gap-y-2 mb-6 text-sm text-on-surface-variant" aria-label="Steps">
    <li><span class="font-semibold text-primary">1.</span> Upload a model <span class="opacity-70">(optional)</span></li>
    <li><span class="font-semibold text-primary">2.</span> Upload its evaluation CSV</li>
    <li><span class="font-semibold text-primary">3.</span> Review the verdict</li>
  </ol>
  <div id="audit-zone" role="button" tabindex="0" aria-label="Upload a model file or evaluation CSV" class="border-2 border-dashed border-outline rounded-lg bg-white hover:bg-surface-beige transition-colors cursor-pointer"></div>
  <input id="audit-file" type="file" accept=".pkl,.pmml,.onnx,.joblib,.csv" class="hidden"/>
  <p class="text-xs text-on-surface-variant mt-2">Model files (.pkl, .pmml, .onnx, .joblib) are not run or stored. Only the file name and size are recorded. Fairness is measured from the evaluation CSV.</p>
  <div id="audit-result" class="mt-8" aria-live="polite"></div>
  <details class="mt-8 rounded-lg border border-outline-variant bg-white p-5">
    <summary class="cursor-pointer font-semibold text-primary">Evaluation CSV format</summary>
    <div class="mt-3 text-sm space-y-2 max-w-prose">
      <p>One row per decision. Column names are case-insensitive.</p>
      <ul class="list-disc pl-5">
        <li><code>protected_group</code> (or <code>group</code>, <code>gender</code>, <code>race</code>): the group each person belongs to. At least two groups.</li>
        <li><code>prediction</code> (or <code>score</code>): the model's decision. 1/0, yes/no, approved/denied, or a probability (≥ 0.5 counts as approved).</li>
        <li><code>label</code> (or <code>actual</code>, <code>outcome</code>): optional ground truth. Enables accuracy and error-rate gaps.</li>
      </ul>
      <p><a class="text-primary font-semibold underline" href="/sample-evaluation.csv" download>Download a sample file</a></p>
    </div>
  </details>`, 900);

app.initAudits = function () {
    const zone = document.getElementById('audit-zone');
    const input = document.getElementById('audit-file');
    const result = document.getElementById('audit-result');
    let pendingModel = null;

    const setZone = (state, name = '') => {
        const body = {
            idle: ['upload_file', 'Drop a model file or evaluation CSV here', 'or click to browse'],
            model: ['task', `Model recorded: ${esc(name)}`, 'Now add its evaluation CSV'],
            busy: ['hourglass_top', `Analyzing ${esc(name)}…`, 'This can take a few seconds for large files']
        }[state];
        zone.innerHTML = `<div class="flex flex-col items-center text-center py-12 px-4"><span class="material-symbols-outlined text-primary text-4xl mb-3" aria-hidden="true">${body[0]}</span><p class="font-semibold">${body[1]}</p><p class="text-sm text-on-surface-variant mt-1">${body[2]}</p></div>`;
    };
    setZone('idle');

    const showResult = async (res) => {
        const a = res.analysis, passed = res.verdict === 'Passed';
        let reportId = null;
        try { reportId = (await window.api.reports.getReports()).find((r) => r.auditId === res.auditId)?.id; } catch { /* link is optional */ }
        app.selectedAudit = res.auditId;
        const stat = (label, value) => `<div class="p-4"><dt class="text-sm text-on-surface-variant">${label}</dt><dd class="font-title-lg text-title-lg text-primary tabular-nums">${value}</dd></div>`;
        result.innerHTML = `
          <div class="rounded-lg border ${passed ? 'border-primary' : 'border-error'} bg-white">
            <div class="p-5 flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant">
              <div><h2 class="font-title-lg text-title-lg">${esc(a.sourceFile)}</h2><p class="text-sm text-on-surface-variant">${a.records.toLocaleString()} records · ${a.groupRates.length} groups</p></div>
              ${statusPill({ status: res.verdict })}
            </div>
            <dl class="grid grid-cols-2 md:grid-cols-4 divide-x divide-outline-variant">
              ${stat('Fairness score', `${a.fairnessScore}/100`)}${stat('Approval gap', `${a.approvalGap} pts`)}${stat('Disparate impact', a.disparateImpact)}${stat('Accuracy', a.accuracy === null ? 'n/a' : `${a.accuracy}%`)}
            </dl>
            <div class="overflow-x-auto"><table class="data-table"><thead><tr><th>Group</th><th>Records</th><th>Approval rate</th></tr></thead><tbody>
              ${a.groupRates.map((g) => `<tr><td>${esc(g.group)}</td><td class="tabular-nums">${g.total}</td><td class="tabular-nums">${g.approvalRate}%</td></tr>`).join('')}
            </tbody></table></div>
            <div class="p-4 flex flex-wrap gap-4 text-sm font-semibold text-primary border-t border-outline-variant">
              ${reportId ? `<a class="hover:underline" target="_blank" rel="noopener" href="/api/reports/${esc(reportId)}/download">Open report</a>` : ''}
              <a class="hover:underline" href="#/mitigation">Plan mitigation</a>
              <a class="hover:underline" href="#/compare">Compare with another model</a>
            </div>
          </div>`;
    };

    const handle = async (file) => {
        if (!file) return;
        if (!/\.(pkl|pmml|onnx|joblib|csv)$/i.test(file.name)) { toast('Supported files: .pkl, .pmml, .onnx, .joblib, or an evaluation .csv', 'error'); return; }
        setZone('busy', file.name);
        try {
            const res = await window.api.auditor.uploadModel(file);
            if (res.kind === 'model') { pendingModel = res.model.name; result.innerHTML = ''; setZone('model', pendingModel); toast(res.message); }
            else { pendingModel = null; setZone('idle'); await showResult(res); }
        } catch (error) { setZone(pendingModel ? 'model' : 'idle', pendingModel || ''); toast(error.message, 'error'); }
    };

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; handle(f); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('bg-surface-beige'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('bg-surface-beige'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('bg-surface-beige'); handle(e.dataTransfer.files[0]); });
};

/* ------------------------------------------------------------------ */
/* Compare models                                                      */
/* ------------------------------------------------------------------ */
pages.compare = () => pageFrame('Compare models', 'Put two audited models side by side to see which treats groups more evenly, and what that costs in accuracy.', `
  <div class="grid md:grid-cols-2 gap-6 mb-8">
    ${['a', 'b'].map((slot, i) => `
    <div class="rounded-lg border border-outline-variant bg-white p-5">
      <label for="arena-${slot}" class="block font-label-md text-label-md mb-1.5">Model ${i ? 'B' : 'A'}</label>
      <select id="arena-${slot}" class="${inputCls}"><option value="">Loading…</option></select>
      <button type="button" data-upload="${slot}" class="mt-3 text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">upload_file</span>Add an evaluation CSV</button>
    </div>`).join('')}
  </div>
  <input id="arena-file" type="file" accept=".csv" class="hidden"/>
  <div id="arena-result" aria-live="polite">${emptyBox('Choose two audits that have evaluation data to compare them.')}</div>`);

app.initCompare = async function () {
    const selects = { a: document.getElementById('arena-a'), b: document.getElementById('arena-b') };
    const result = document.getElementById('arena-result');
    const fileInput = document.getElementById('arena-file');
    let pendingSlot = 'a';
    const fmt = (v, unit) => (v === null || v === undefined ? '—' : `${v}${unit}`);

    const render = (r) => {
        const maxRate = Math.max(1, ...r.groups.flatMap((g) => [g.a ?? 0, g.b ?? 0]));
        const bar = (value, color) => value === null ? '<div class="text-xs text-on-surface-variant h-4">not in this evaluation</div>'
            : `<div class="flex items-center gap-2"><div class="h-3 rounded-full" style="width:${(value / maxRate) * 100}%;min-width:2px;background:${color}"></div><span class="text-xs tabular-nums">${value}%</span></div>`;
        result.innerHTML = `
          <p class="font-headline-md text-headline-md text-primary mb-6 max-w-prose">${esc(r.summary)}</p>
          <div class="overflow-x-auto border border-outline-variant rounded-lg bg-white mb-8"><table class="data-table">
            <thead><tr><th>Metric</th>${[r.a, r.b].map((m) => `<th>${esc(m.name)} <span class="pill ${m.status === 'Passed' ? 'pill-pass' : 'pill-fail'} ml-1">${esc(m.status)}</span></th>`).join('')}</tr></thead>
            <tbody>${r.rows.map((m) => `<tr><td>${esc(m.label)} <span class="text-on-surface-variant text-xs">(${m.better} is better)</span></td>
              ${['a', 'b'].map((side) => `<td class="tabular-nums ${m.winner === side ? 'font-semibold text-primary' : ''}">${m.winner === side ? '<span class="material-symbols-outlined text-[16px] mr-1" aria-label="better">check_circle</span>' : ''}${fmt(m[side], m.unit)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
          <h2 class="font-title-lg text-title-lg text-primary mb-3">Approval rate by group</h2>
          <div class="border border-outline-variant rounded-lg bg-white p-5 space-y-5">
            ${r.groups.map((g) => `<div><p class="text-sm font-semibold mb-1.5">${esc(g.group)}</p><div class="grid sm:grid-cols-2 gap-x-6 gap-y-1">
              <div><p class="text-xs text-on-surface-variant mb-0.5">${esc(r.a.name)}</p>${bar(g.a, '#2D6A4F')}</div>
              <div><p class="text-xs text-on-surface-variant mb-0.5">${esc(r.b.name)}</p>${bar(g.b, '#7a9e8c')}</div></div></div>`).join('')}
          </div>
          ${r.groupsDiffer ? '<p class="text-sm text-on-surface-variant mt-3">The two evaluations do not contain the same protected groups, so group-level numbers are not directly comparable.</p>' : ''}`;
    };

    const compare = async () => {
        const a = selects.a.value, b = selects.b.value;
        if (!a || !b) return;
        if (a === b) { result.innerHTML = emptyBox('Pick two different audits.'); return; }
        result.innerHTML = '<p class="text-on-surface-variant p-8 text-center"><span class="spinner"></span>Comparing…</p>';
        try { render(await window.api.arena.compareModels({ a, b })); }
        catch (error) { result.innerHTML = ''; toast(error.message, 'error'); }
    };

    const loadAudits = async (preselect) => {
        const audits = await getAuditsWithData();
        for (const slot of ['a', 'b']) {
            const keep = preselect?.slot === slot ? preselect.id : selects[slot].value;
            selects[slot].innerHTML = `<option value="">${audits.length ? 'Select an audit' : 'No audits with evaluation data yet'}</option>` +
                audits.map((x) => `<option value="${esc(x.id)}" ${x.id === keep ? 'selected' : ''}>${esc(x.modelName)} (${esc(x.date)})</option>`).join('');
        }
    };
    try { await loadAudits(); } catch (error) { toast(error.message, 'error'); }
    Object.values(selects).forEach((el) => el.addEventListener('change', compare));

    document.querySelectorAll('[data-upload]').forEach((btn) => btn.addEventListener('click', () => { pendingSlot = btn.dataset.upload; fileInput.click(); }));
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0]; fileInput.value = '';
        if (!file) return;
        if (!/\.csv$/i.test(file.name)) { toast('Upload an evaluation .csv file.', 'error'); return; }
        try {
            const res = await window.api.auditor.uploadModel(file);
            await loadAudits({ slot: pendingSlot, id: res.auditId });
            toast(`${file.name} audited: ${res.verdict}`);
            compare();
        } catch (error) { toast(error.message, 'error'); }
    });
};

/* ------------------------------------------------------------------ */
/* Mitigation (plan + reweighing data)                                 */
/* ------------------------------------------------------------------ */
pages.mitigation = () => pageFrame('Mitigation', 'When a model falls short, see how far each group is from parity and export reweighing data to retrain it.', `
  <div class="max-w-md mb-6">
    <label for="mit-audit" class="block font-label-md text-label-md mb-1.5">Audit</label>
    <select id="mit-audit" class="${inputCls}"><option value="">Loading…</option></select>
  </div>
  <div id="mit-body" aria-live="polite">${emptyBox('Select an audit that has evaluation data.')}</div>`);

app.initMitigation = async function () {
    const select = document.getElementById('mit-audit');
    const body = document.getElementById('mit-body');
    const pct = (v) => `${v}%`;
    const signed = (v) => `${v > 0 ? '+' : ''}${v} pts`;

    const render = (d, tab) => {
        const tabBtn = (id, label) => `<button role="tab" aria-selected="${tab === id}" data-tab="${id}" class="px-4 py-2 -mb-px border-b-2 font-semibold ${tab === id ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-primary'}">${label}</button>`;
        const panel = tab === 'plan' ? `
            <p class="max-w-prose mb-4">${d.plan.recordsToReview === 0 ? 'Every group is already at the same approval rate.'
                : `To bring every group to the overall approval rate of <strong>${pct(d.plan.targetApprovalRate)}</strong>, about <strong>${d.plan.recordsToReview.toLocaleString()}</strong> decisions would need a second look (for example through group-aware thresholds or manual review). The approval gap today is ${d.plan.approvalGapBefore} points.`}</p>
            <div class="overflow-x-auto border border-outline-variant rounded-lg bg-white"><table class="data-table">
              <thead><tr><th>Group</th><th>Approval rate now</th><th>Target</th><th>Shift</th><th>Decisions to review</th></tr></thead>
              <tbody>${d.plan.groups.map((g) => `<tr><td class="font-semibold">${esc(g.group)}</td><td class="tabular-nums">${pct(g.currentApprovalRate)}</td><td class="tabular-nums">${pct(g.targetApprovalRate)}</td><td class="tabular-nums">${signed(g.shiftPoints)}</td><td class="tabular-nums">${g.recordsToReview.toLocaleString()}</td></tr>`).join('')}</tbody>
            </table></div>
            <p class="text-xs text-on-surface-variant mt-3">This is a plan, not an automatic fix. RayCtify does not change your model.</p>`
          : `
            <p class="max-w-prose mb-4">Reweighing gives each (group, outcome) combination a sample weight so that outcome no longer depends on group in the training data. Use the CSV as <code>sample_weight</code> when you refit your model, then audit it again. Weights are based on ${d.basis === 'label' ? 'the true labels in your evaluation file' : 'the model’s predictions, because no label column was supplied'}.</p>
            <div class="overflow-x-auto border border-outline-variant rounded-lg bg-white mb-4"><table class="data-table">
              <thead><tr><th>Group</th><th>Outcome</th><th>Records</th><th>Weight</th></tr></thead>
              <tbody>${d.weights.map((w) => `<tr><td>${esc(w.group)}</td><td>${w.label ? 'Approved' : 'Denied'}</td><td class="tabular-nums">${w.count}</td><td class="tabular-nums font-semibold">${w.weight}</td></tr>`).join('')}</tbody>
            </table></div>
            <a class="${btnCls} inline-flex items-center gap-2" href="/api/mitigation/${esc(d.audit.id)}/weights.csv" download><span class="material-symbols-outlined text-[20px]" aria-hidden="true">download</span>Download weights CSV</a>`;
        body.innerHTML = `<div class="flex gap-2 border-b border-outline-variant mb-6" role="tablist">${tabBtn('plan', 'Plan')}${tabBtn('weights', 'Reweighing data')}</div>${panel}`;
        body.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => render(d, b.dataset.tab)));
    };

    const load = async () => {
        if (!select.value) { body.innerHTML = emptyBox('Select an audit that has evaluation data.'); return; }
        body.innerHTML = '<p class="p-8 text-center text-on-surface-variant"><span class="spinner"></span>Loading…</p>';
        try { render(await window.api.mitigation.get(select.value), 'plan'); }
        catch (error) { body.innerHTML = ''; toast(error.message, 'error'); }
    };

    try {
        const audits = await getAuditsWithData();
        select.innerHTML = (audits.length ? '' : '<option value="">No audits with evaluation data yet</option>') +
            audits.map((a) => `<option value="${esc(a.id)}" ${a.id === app.selectedAudit ? 'selected' : ''}>${esc(a.modelName)} (${esc(a.date)}): ${esc(a.status)}</option>`).join('');
        if (audits.length) load(); else body.innerHTML = emptyBox('No audits with evaluation data yet. <a class="text-primary font-semibold underline" href="#/audits">Run an audit</a> first.');
    } catch (error) { toast(error.message, 'error'); }
    select.addEventListener('change', () => { app.selectedAudit = select.value; load(); });
};

/* ------------------------------------------------------------------ */
/* Appeals                                                             */
/* ------------------------------------------------------------------ */
pages.appeals = () => pageFrame('Appeals', 'Applicants who asked for a human to review their decision. Your note is shown to the applicant.', `
  <section aria-labelledby="open-h" class="mb-10">
    <h2 id="open-h" class="font-title-lg text-title-lg text-primary mb-3">Waiting for review</h2>
    <div id="appeals-open" aria-live="polite"><p class="text-on-surface-variant">Loading…</p></div>
  </section>
  <section aria-labelledby="done-h">
    <h2 id="done-h" class="font-title-lg text-title-lg text-primary mb-3">Resolved</h2>
    ${tableShell('<th>Applicant</th><th>Reference</th><th>Outcome</th><th>Reviewed</th><th>Note to applicant</th>', 'appeals-done', 5)}
  </section>`, 1000);

app.initAppeals = async function () {
    const open = document.getElementById('appeals-open');
    const render = async () => {
        const { open: openList, resolved } = await window.api.appeals.list();
        open.innerHTML = openList.length ? `<ul class="space-y-4">${openList.map((a) => `
          <li class="rounded-lg border border-outline-variant bg-white p-5">
            <p class="font-semibold">${esc(a.name || a.email)} <span class="text-on-surface-variant font-normal">· ${esc(a.referenceId)} · ${esc(a.product)} · appealed ${esc(a.appealDate || '')}</span></p>
            <p class="mt-2 max-w-prose">“${esc(a.notes)}”</p>
            <label class="block text-sm text-on-surface-variant mt-4 mb-1" for="note-${esc(a.userId)}">Note to the applicant (optional)</label>
            <textarea id="note-${esc(a.userId)}" rows="2" maxlength="500" class="w-full p-3 rounded-lg border border-outline-variant text-sm"></textarea>
            <div class="flex flex-wrap gap-2 mt-3">
              <button data-resolve="approved" data-user="${esc(a.userId)}" class="h-10 px-4 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:bg-primary-container disabled:opacity-50">Approve on appeal</button>
              <button data-resolve="upheld" data-user="${esc(a.userId)}" class="h-10 px-4 rounded-lg border border-outline text-sm font-semibold hover:bg-surface-container-high disabled:opacity-50">Uphold original decision</button>
            </div></li>`).join('')}</ul>` : emptyBox('No appeals are waiting. Nice work.');
        document.getElementById('appeals-done').innerHTML = resolved.length ? resolved.map((a) => `
          <tr><td class="font-semibold">${esc(a.name || a.email)}</td><td class="tabular-nums">${esc(a.referenceId)}</td>
          <td><span class="pill ${a.resolution.outcome === 'approved' ? 'pill-pass' : 'pill-wait'}">${a.resolution.outcome === 'approved' ? 'Approved' : 'Upheld'}</span></td>
          <td class="tabular-nums text-on-surface-variant">${esc(a.resolution.date)} · ${esc(a.resolution.by)}</td><td>${esc(a.resolution.comment) || '<span class="text-on-surface-variant">—</span>'}</td></tr>`).join('')
          : '<tr><td colspan="5" class="text-on-surface-variant text-center py-6">Nothing resolved yet.</td></tr>';
        app.refreshBell();
    };
    open.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-resolve]');
        if (!button) return;
        const comment = document.getElementById(`note-${button.dataset.user}`).value.trim();
        try {
            await withBusy(button, 'Saving…', () => window.api.appeals.resolve(button.dataset.user, button.dataset.resolve, comment));
            toast('Saved. The applicant can see the outcome in their portal.');
            await render();
        } catch (error) { toast(error.message, 'error'); }
    });
    try { await render(); } catch (error) { toast(error.message, 'error'); }
};

/* ------------------------------------------------------------------ */
/* Compliance reports                                                  */
/* ------------------------------------------------------------------ */
pages.reports = () => pageFrame('Compliance reports', 'A report is generated each time an evaluation CSV is audited. Open one to print it or save it as PDF.', `
  <div class="mb-3"><input id="report-filter" type="search" placeholder="Search reports" class="h-10 w-full sm:w-64 px-3 rounded-lg border border-outline-variant bg-white text-sm" aria-label="Search reports"/></div>
  ${tableShell('<th>Report</th><th>Generated</th><th>Size</th><th class="text-right">Open</th>', 'reports-body', 4)}`);

app.initReports = async function () {
    let reports = [];
    const render = () => {
        const term = document.getElementById('report-filter').value.trim().toLowerCase();
        const rows = reports.filter((r) => r.title.toLowerCase().includes(term));
        document.getElementById('reports-body').innerHTML = rows.length ? rows.map((r) => `
            <tr><td class="font-semibold">${esc(r.title)}</td><td class="text-on-surface-variant tabular-nums">${esc(r.date)}</td><td class="text-on-surface-variant">${esc(r.size)}</td>
            <td class="text-right"><a class="text-primary font-semibold hover:underline" target="_blank" rel="noopener" href="/api/reports/${esc(r.id)}/download">Open</a></td></tr>`).join('')
            : `<tr><td colspan="4">${emptyBox(reports.length ? 'No reports match your search.' : 'No reports yet. <a class="text-primary font-semibold underline" href="#/audits">Run an audit</a> to generate one.')}</td></tr>`;
    };
    document.getElementById('report-filter').addEventListener('input', render);
    try { reports = await window.api.reports.getReports(); render(); } catch (error) { toast(error.message, 'error'); }
};

/* ------------------------------------------------------------------ */
/* Fairness policy (policy, team access, account, activity)            */
/* ------------------------------------------------------------------ */
pages.policy = () => pageFrame('Fairness policy', 'The rules audits are judged against, who can access this console, and a record of what happened.', `
  <div class="space-y-12">
    <section aria-labelledby="pol-h"><h2 id="pol-h" class="font-title-lg text-title-lg text-primary mb-4">Policy</h2>
      <form id="settings-form" class="space-y-5 max-w-xl" novalidate>
        <div><label for="set-org" class="block font-label-md text-label-md mb-1.5">Organization name</label><input id="set-org" name="orgName" maxlength="80" required class="${inputCls}"/></div>
        <div><label for="set-standard" class="block font-label-md text-label-md mb-1.5">Compliance framework</label>
          <select id="set-standard" name="complianceStandard" class="${inputCls}">
            <option value="ISO-42001">ISO/IEC 42001 (AI management systems)</option><option value="NIST-AI-RMF">NIST AI Risk Management Framework</option>
            <option value="EU-AI-ACT">EU AI Act</option><option value="ECOA">ECOA / Regulation B</option></select>
          <p class="text-sm text-on-surface-variant mt-1.5">Printed on every report. It labels your reports; it does not certify compliance.</p></div>
        <div><label for="set-retention" class="block font-label-md text-label-md mb-1.5">Keep evaluation data for</label>
          <select id="set-retention" name="dataRetention" class="${inputCls}"><option value="30_days">30 days</option><option value="90_days">90 days</option><option value="1_year">1 year</option><option value="7_years">7 years</option></select>
          <p class="text-sm text-on-surface-variant mt-1.5">After this period the per-group breakdown behind an audit is deleted automatically. Scores, verdicts and report headers are kept.</p></div>
        <div><label for="set-threshold" class="block font-label-md text-label-md mb-1.5">Minimum fairness score to pass: <output id="threshold-out" class="font-semibold">80</output></label>
          <input id="set-threshold" name="fairnessThreshold" type="range" min="50" max="100" step="1" class="w-full accent-[#2D6A4F]"/>
          <p class="text-sm text-on-surface-variant mt-1.5">Fairness score is 100 minus the approval-rate gap between groups. A model must also meet the four-fifths rule (disparate impact ≥ 0.80). Changes apply to future audits.</p></div>
        <div class="flex items-center gap-4"><button id="settings-save" type="submit" class="${btnCls}">Save policy</button></div>
      </form></section>

    <section aria-labelledby="team-h"><h2 id="team-h" class="font-title-lg text-title-lg text-primary mb-2">Team access</h2>
      <p class="text-on-surface-variant mb-4 max-w-prose">Staff accounts are created with a single-use invite code that expires after 7 days. Share it privately; it is shown only once.</p>
      <button id="invite-btn" class="${btnCls}">Create invite code</button>
      <div id="invite-code-box" class="hidden mt-4 max-w-xl rounded-lg border border-primary bg-secondary-container/40 p-4"></div>
      <div class="mt-6 max-w-xl">${tableShell('<th>Created</th><th>By</th><th>Status</th>', 'invites-body', 3)}</div></section>

    <section aria-labelledby="acct-h"><h2 id="acct-h" class="font-title-lg text-title-lg text-primary mb-4">Your account</h2>
      <form id="password-form" class="space-y-4 max-w-xl" novalidate>
        <div><label for="pw-current" class="block font-label-md text-label-md mb-1.5">Current password</label><input id="pw-current" type="password" autocomplete="current-password" class="${inputCls}"/></div>
        <div><label for="pw-new" class="block font-label-md text-label-md mb-1.5">New password <span class="font-normal text-on-surface-variant">(10+ characters)</span></label><input id="pw-new" type="password" autocomplete="new-password" class="${inputCls}"/></div>
        <button id="pw-save" type="submit" class="${btnCls}">Change password</button>
        <p class="text-sm text-on-surface-variant">Other devices signed in to your account are signed out.</p>
      </form></section>

    <section aria-labelledby="act-h"><h2 id="act-h" class="font-title-lg text-title-lg text-primary mb-2">Activity log</h2>
      <p class="text-on-surface-variant mb-4">The most recent 50 actions: sign-ins, audits, policy changes, appeals and data deletions.</p>
      ${tableShell('<th>Time (UTC)</th><th>Who</th><th>Action</th><th>Detail</th>', 'activity-body', 4)}</section>
  </div>`, 960);

app.initPolicy = async function () {
    const form = document.getElementById('settings-form');
    const threshold = form.elements.fairnessThreshold, out = document.getElementById('threshold-out');
    threshold.addEventListener('input', () => { out.textContent = threshold.value; });

    const loadInvites = async () => {
        const invites = await window.api.team.listInvites();
        document.getElementById('invites-body').innerHTML = invites.length ? invites.map((i) => `<tr><td class="tabular-nums">${esc(i.created)}</td><td>${esc(i.createdBy)}</td><td><span class="pill ${i.status === 'Open' ? 'pill-wait' : i.status === 'Used' ? 'pill-pass' : 'pill-fail'}">${esc(i.status)}</span></td></tr>`).join('')
            : '<tr><td colspan="3" class="text-on-surface-variant">No invites yet.</td></tr>';
    };
    const loadActivity = async () => {
        const rows = (await window.api.team.activity()).slice(0, 50);
        document.getElementById('activity-body').innerHTML = rows.length ? rows.map((r) => `<tr><td class="tabular-nums text-on-surface-variant whitespace-nowrap">${esc(r.time.slice(0, 19).replace('T', ' '))}</td><td>${esc(r.actor)}</td><td><code>${esc(r.action)}</code></td><td>${esc(r.detail)}</td></tr>`).join('')
            : '<tr><td colspan="4" class="text-on-surface-variant">Nothing recorded yet.</td></tr>';
    };

    try {
        const s = await window.api.settings.getSettings();
        form.elements.orgName.value = s.orgName; form.elements.complianceStandard.value = s.complianceStandard;
        form.elements.dataRetention.value = s.dataRetention; threshold.value = s.fairnessThreshold; out.textContent = s.fairnessThreshold;
        await Promise.all([loadInvites(), loadActivity()]);
    } catch (error) { toast(error.message || 'Could not load settings', 'error'); }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            const res = await withBusy(document.getElementById('settings-save'), 'Saving…', () => window.api.settings.updateSettings({
                orgName: form.elements.orgName.value, complianceStandard: form.elements.complianceStandard.value,
                dataRetention: form.elements.dataRetention.value, fairnessThreshold: Number(threshold.value) }));
            window.api.orgName = res.settings.orgName;
            document.getElementById('org-name').textContent = res.settings.orgName;
            toast('Policy saved.'); loadActivity();
        } catch (error) { toast(error.message, 'error'); }
    });

    document.getElementById('invite-btn').addEventListener('click', async (event) => {
        try {
            const { code, expires } = await withBusy(event.currentTarget, 'Creating…', () => window.api.team.createInvite());
            const box = document.getElementById('invite-code-box');
            box.classList.remove('hidden');
            box.innerHTML = `<p class="text-sm mb-2">Copy this code now. It is single-use and expires ${esc(expires)}.</p><div class="flex items-center gap-3"><code class="text-lg font-semibold select-all break-all">${esc(code)}</code><button type="button" id="copy-invite" class="text-sm font-semibold text-primary hover:underline">Copy</button></div>`;
            document.getElementById('copy-invite').addEventListener('click', () => navigator.clipboard?.writeText(code).then(() => toast('Copied.'), () => toast('Copy failed. Select the code and copy it manually.', 'error')));
            loadInvites(); loadActivity();
        } catch (error) { toast(error.message, 'error'); }
    });

    document.getElementById('password-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const current = document.getElementById('pw-current'), next = document.getElementById('pw-new');
        if (next.value.length < 10) { toast('The new password must be at least 10 characters.', 'error'); return; }
        try {
            await withBusy(document.getElementById('pw-save'), 'Saving…', () => window.api.auth.changePassword(current.value, next.value));
            current.value = ''; next.value = ''; toast('Password changed.'); loadActivity();
        } catch (error) { toast(error.message, 'error'); }
    });
};
