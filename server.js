'use strict';
/**
 * RayCtify server — zero-dependency Node.js (>=18).
 *
 *   node server.js
 *
 * Environment:
 *   PORT                 default 3000
 *   DB_FILE              SQLite database, default ./rayctify.db (Node >= 22.5, built in)
 *   STORAGE=json         force the legacy JSON file store
 *   DATA_FILE            JSON store path, default ./data.json (also imported once into SQLite)
 *   DEMO_PASSWORD        password for the seeded demo accounts (default "password")
 *   NODE_ENV=production  Secure cookies + HSTS; refuses to start while demo accounts still use "password"
 *   TRUST_PROXY=1        read the client IP from X-Forwarded-For (only behind a proxy you control)
 *   CSP_ENFORCE=1        enforce the Content-Security-Policy (default: report-only, see browser console)
 * Admin accounts are created by invite: an admin generates a single-use code in Fairness policy.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'rayctify.db');
let sqlite = null;
try { if (process.env.STORAGE !== 'json') sqlite = require('node:sqlite'); } catch { /* Node < 22.5: use the JSON store */ }
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const RETENTION_DAYS = { '30_days': 30, '90_days': 90, '1_year': 365, '7_years': 2555 };
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVITY = 500;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'password';
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_MODEL_BYTES = 500 * 1024 * 1024;
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const MODEL_EXTENSIONS = ['pkl', 'pmml', 'onnx', 'joblib'];
// Only these files are ever served statically (data.json must never be reachable).
const PUBLIC_FILES = new Set(['index.html', 'app.js', 'backend.js', 'pages.js', 'views.js', 'styles.css', 'logo.svg', 'sample-evaluation.csv']);
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.csv': 'text/csv' };

/* ------------------------------------------------------------------ */
/* Passwords & sessions                                                */
/* ------------------------------------------------------------------ */
const scrypt = require('util').promisify(crypto.scrypt);
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const safeEqual = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const newSalt = () => crypto.randomBytes(16).toString('hex');
// Request handlers use the async versions so a login never blocks the event loop.
const hashPassword = async (password) => { const salt = newSalt(); return `${salt}:${(await scrypt(String(password), salt, 64)).toString('hex')}`; };
const verifyPassword = async (password, record) => {
  const [salt, hash] = String(record || '').split(':');
  if (!salt || !hash) return false;
  return safeEqual((await scrypt(String(password), salt, 64)).toString('hex'), hash);
};
// Sync versions: startup only (seeding, default-password check).
const hashPasswordSync = (password) => { const salt = newSalt(); return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`; };
const verifyPasswordSync = (password, record) => { const [salt, hash] = String(record || '').split(':'); return Boolean(salt && hash) && safeEqual(crypto.scryptSync(String(password), salt, 64).toString('hex'), hash); };
const DUMMY_HASH = hashPasswordSync(crypto.randomBytes(8).toString('hex'));

const sessions = new Map(); // token -> { userId, expires, model }
const attempts = new Map(); // rate-limit key -> { count, resetAt }

const clientIp = (req) => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
const rateLimited = (key, limit = 10, windowMs = 15 * 60 * 1000) => {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) { attempts.set(key, { count: 1, resetAt: now + windowMs }); return false; }
  entry.count += 1;
  return entry.count > limit;
};

/* ------------------------------------------------------------------ */
/* Store (in-memory cache, atomic writes)                              */
/* ------------------------------------------------------------------ */
let store;
const today = () => new Date().toISOString().slice(0, 10);
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;

const defaultApplication = () => ({
  referenceId: `APP-${Math.floor(1000 + Math.random() * 9000)}-${crypto.randomBytes(1).toString('hex').toUpperCase()}`,
  status: 'Under Review', stage: 2, submittedDate: today(), product: 'Prime Mortgage Loan',
  creditScore: 720, income: '$85,000', debtToIncome: '24%', employment: '5 Years',
  decisionDate: null, appealRequested: false, notes: '', appealDate: null
});

function seed() {
  return {
    users: [
      { id: 'u1', email: 'admin@rayctify.com', passwordHash: hashPasswordSync(DEMO_PASSWORD), name: 'Admin User', role: 'admin' },
      { id: 'u2', email: 'applicant@example.com', passwordHash: hashPasswordSync(DEMO_PASSWORD), name: 'John Doe', role: 'applicant' }
    ],
    audits: [
      { id: 'a3', modelName: 'FraudDetection_v4', date: '2023-10-15', status: 'Passed', score: 98, records: 0 },
      { id: 'a2', modelName: 'MortgageApproval_v1', date: '2023-10-20', status: 'Failed', score: 68, records: 0 },
      { id: 'a1', modelName: 'CreditScoring_v2', date: '2023-10-25', status: 'Passed', score: 94, records: 0 }
    ],
    reports: [],
    settings: { orgName: 'Acme Bank', complianceStandard: 'ISO-42001', dataRetention: '30_days', fairnessThreshold: 80 },
    applications: { u2: { ...defaultApplication(), referenceId: 'APP-9482-XY', submittedDate: '2023-10-24' } }
  };
}

function migrate() {
  store.users ||= []; store.audits ||= []; store.reports ||= []; store.applications ||= {}; store.invites ||= []; store.activity ||= [];
  store.settings = { orgName: 'Acme Bank', complianceStandard: 'ISO-42001', dataRetention: '30_days', fairnessThreshold: 80, ...(store.settings || {}) };
  if (store.applicantStatus) { // legacy single-applicant record
    const applicant = store.users.find((u) => u.role === 'applicant');
    if (applicant && !store.applications[applicant.id]) store.applications[applicant.id] = { ...defaultApplication(), ...store.applicantStatus };
    delete store.applicantStatus;
  }
  delete store.dashboardMetrics; // metrics are now computed from real audits
  store.audits = store.audits.filter((a) => a.status !== 'Queued'); // drop stale test rows
}

/* SQLite: one table per collection holding each record as JSON, written incrementally. */
let db;
const persisted = new Map(); // "table:id" -> "pos|json" of what is already in the database
const LIST_TABLES = ['users', 'audits', 'reports', 'invites', 'activity'];

function loadSqlite() {
  db = new sqlite.DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  for (const table of [...LIST_TABLES, 'applications', 'settings']) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, pos INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)`);
  }
  const rows = (table) => db.prepare(`SELECT id, pos, data FROM ${table} ORDER BY pos`).all();
  const remember = (table, r) => persisted.set(`${table}:${r.id}`, `${r.pos}|${r.data}`);
  if (!db.prepare('SELECT COUNT(*) AS c FROM users').get().c) {
    // First run: import the legacy JSON store if there is one, otherwise seed demo data.
    const legacy = fs.existsSync(DATA_FILE);
    store = legacy ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : seed();
    migrate();
    if (legacy) { fs.renameSync(DATA_FILE, `${DATA_FILE}.migrated`); console.log(`Imported ${DATA_FILE} into SQLite (original kept as .migrated).`); }
  } else {
    store = { applications: {} };
    for (const table of LIST_TABLES) { const r = rows(table); r.forEach((x) => remember(table, x)); store[table] = r.map((x) => JSON.parse(x.data)); }
    for (const r of rows('applications')) { remember('applications', r); store.applications[r.id] = JSON.parse(r.data); }
    const settings = rows('settings'); settings.forEach((x) => remember('settings', x));
    store.settings = settings.length ? JSON.parse(settings[0].data) : {};
    migrate();
  }
  saveSqlite();
}

function saveSqlite() {
  const upsert = {};
  const live = new Set();
  const put = (table, id, pos, obj) => {
    const data = JSON.stringify(obj);
    const key = `${table}:${id}`, fingerprint = `${pos}|${data}`;
    live.add(key);
    if (persisted.get(key) === fingerprint) return;
    (upsert[table] ||= db.prepare(`INSERT INTO ${table} (id, pos, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET pos = excluded.pos, data = excluded.data`)).run(id, pos, data);
    persisted.set(key, fingerprint);
  };
  db.exec('BEGIN');
  try {
    for (const table of LIST_TABLES) store[table].forEach((record, i) => put(table, record.id, i, record));
    for (const [id, record] of Object.entries(store.applications)) put('applications', id, 0, record);
    put('settings', 'main', 0, store.settings);
    for (const key of [...persisted.keys()]) { // remove rows deleted from memory (e.g. trimmed activity log)
      if (live.has(key)) continue;
      const i = key.indexOf(':');
      db.prepare(`DELETE FROM ${key.slice(0, i)} WHERE id = ?`).run(key.slice(i + 1));
      persisted.delete(key);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function loadStore() {
  if (sqlite) return loadSqlite();
  if (fs.existsSync(DATA_FILE)) { store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); migrate(); }
  else store = seed();
  saveJson();
}
function saveJson() {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}
function saveStore() { return sqlite ? saveSqlite() : saveJson(); }

/** Append-only (capped) record of security-relevant actions. Caller is responsible for saveStore(). */
function logActivity(actor, action, detail = '') {
  store.activity.unshift({ id: newId('l'), time: new Date().toISOString(), actor: actor ? actor.email : 'system', action, detail: String(detail).slice(0, 200) });
  if (store.activity.length > MAX_ACTIVITY) store.activity.length = MAX_ACTIVITY;
}

/** Deletes stored evaluation breakdowns older than the configured retention period. Scores and verdicts are kept. */
function purgeExpired() {
  const days = RETENTION_DAYS[store.settings.dataRetention];
  if (!days) return;
  const cutoff = Date.now() - days * 86400000;
  let purged = 0;
  for (const audit of store.audits) {
    if (audit.analysis && Date.parse(audit.analysis.generatedAt) < cutoff) { delete audit.analysis; audit.analysisPurged = true; purged += 1; }
  }
  if (purged) { logActivity(null, 'retention.purge', `Deleted evaluation data for ${purged} audit(s) past the ${store.settings.dataRetention.replace('_', ' ')} retention period`); saveStore(); }
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

const sendJson = (res, status, payload, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
};
const ok = (res, payload = {}) => sendJson(res, 200, { success: true, ...payload });

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
  const i = p.indexOf('=');
  return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
}));
const cookieHeader = (token, maxAge) =>
  `rayctify_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${IS_PROD ? '; Secure' : ''}`;

/** Returns { token, ref } where ref is the live session object (mutable). */
function getSession(req) {
  const token = cookies(req).rayctify_session;
  const ref = token && sessions.get(token);
  if (!ref) return null;
  if (ref.expires < Date.now()) { sessions.delete(token); return null; }
  return { token, ref };
}
const getUser = (req) => { const s = getSession(req); return s && store.users.find((u) => u.id === s.ref.userId); };
const publicUser = (u) => u && { id: u.id, name: u.name, role: u.role, email: u.email };

function requireUser(req, roles) {
  const user = getUser(req);
  if (!user) throw new HttpError(401, 'Authentication required');
  if (roles && !roles.includes(user.role)) throw new HttpError(403, 'You do not have access to this resource');
  return user;
}

const readJson = (req, limit = 1_000_000) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; if (raw.length > limit) { reject(new HttpError(413, 'Request body too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new HttpError(400, 'Invalid JSON body')); } });
  req.on('error', reject);
});

/** Reads a multipart upload. Streams the whole body (up to maxBytes) but only keeps the first 10 MB. */
const readUpload = (req, maxBytes) => new Promise((resolve, reject) => {
  let size = 0, retained = 0;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > maxBytes) { reject(new HttpError(413, 'Model files must be 500MB or smaller')); req.destroy(); return; }
    if (retained < MAX_CSV_BYTES) { const kept = chunk.subarray(0, MAX_CSV_BYTES - retained); chunks.push(kept); retained += kept.length; }
  });
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const header = raw.toString('latin1', 0, Math.min(raw.length, 16384));
    const match = /filename="([^"]*)"/i.exec(header);
    const name = path.basename((match && match[1]) || 'Uploaded model').slice(0, 120);
    const start = raw.indexOf(Buffer.from('\r\n\r\n')) + 4;
    const end = raw.lastIndexOf(Buffer.from('\r\n--'));
    resolve({ name, size, complete: size <= MAX_CSV_BYTES, content: start >= 4 && end > start ? raw.subarray(start, end) : Buffer.alloc(0) });
  });
  req.on('error', reject);
});

/* ------------------------------------------------------------------ */
/* Fairness analysis                                                   */
/* ------------------------------------------------------------------ */
function csvLine(line) {
  const values = [];
  let value = '', quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { values.push(value.trim()); value = ''; }
    else value += c;
  }
  values.push(value.trim());
  return values;
}
function toBinary(value) {
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'approved', 'approve', 'positive', 'pass'].includes(v)) return 1;
  if (['0', 'false', 'no', 'denied', 'deny', 'negative', 'fail'].includes(v)) return 0;
  const n = Number(v);
  return v !== '' && Number.isFinite(n) ? Number(n >= 0.5) : null;
}
const pct = (n, digits = 2) => Number((n * 100).toFixed(digits));

function calculateAnalysis(csv, sourceFile) {
  const rows = csv.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map(csvLine);
  if (rows.length < 3) throw new HttpError(400, 'The evaluation CSV needs a header and at least two records');
  const headers = rows.shift().map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const find = (names) => headers.findIndex((h) => names.includes(h));
  const predIdx = find(['prediction', 'predicted', 'pred', 'ypred', 'score', 'probability']);
  const labelIdx = find(['label', 'actual', 'outcome', 'ytrue', 'target']);
  const groupIdx = find(['protectedgroup', 'group', 'gender', 'sex', 'race', 'ethnicity']);
  if (predIdx < 0 || groupIdx < 0) throw new HttpError(400, 'CSV needs prediction (or score) and protected_group (or gender, race, ethnicity) columns');

  const groups = new Map();
  let correct = 0, labeled = 0, records = 0;
  for (const row of rows) {
    const pred = toBinary(row[predIdx]);
    const group = String(row[groupIdx] || '').trim();
    if (pred === null || !group) continue;
    if (!groups.has(group)) groups.set(group, { total: 0, approved: 0, negatives: 0, falsePositives: 0, positives: 0, truePositives: 0, cells: [0, 0] });
    const g = groups.get(group);
    g.total += 1; g.approved += pred;
    const label = labelIdx < 0 ? null : toBinary(row[labelIdx]);
    if (label !== null) {
      labeled += 1; correct += Number(pred === label);
      if (label === 0) { g.negatives += 1; g.falsePositives += pred; } else { g.positives += 1; g.truePositives += pred; }
    }
    g.cells[label !== null ? label : pred] += 1; // basis for reweighing weights
    records += 1;
  }
  if (groups.size < 2 || records < 2) throw new HttpError(400, 'CSV needs valid predictions for at least two protected groups');

  const groupRates = [...groups.entries()].map(([group, g]) => ({
    group, total: g.total, approvalRate: g.approved / g.total,
    falsePositiveRate: g.negatives ? g.falsePositives / g.negatives : null,
    truePositiveRate: g.positives ? g.truePositives / g.positives : null
  }));
  const spread = (key) => { const v = groupRates.map((r) => r[key]).filter((x) => x !== null); return v.length > 1 ? Math.max(...v) - Math.min(...v) : null; };
  const approvals = groupRates.map((r) => r.approvalRate);
  const approvalGap = (Math.max(...approvals) - Math.min(...approvals)) * 100;
  const maxApproval = Math.max(...approvals);
  const disparateImpact = maxApproval > 0 ? Math.min(...approvals) / maxApproval : 1;
  const riskDelta = spread('falsePositiveRate');
  const tprGap = spread('truePositiveRate');

  // Kamiran & Calders reweighing: w(g, y) = P(g) P(y) / P(g, y)
  const yTotals = [0, 0];
  for (const g of groups.values()) { yTotals[0] += g.cells[0]; yTotals[1] += g.cells[1]; }
  const weights = [];
  for (const [group, g] of groups) for (const y of [0, 1]) {
    if (!g.cells[y]) continue;
    weights.push({ group, label: y, count: g.cells[y], weight: Number(((g.total * yTotals[y]) / (records * g.cells[y])).toFixed(4)) });
  }

  return {
    sourceFile, records,
    groupRates: groupRates.map((r) => ({
      group: r.group, total: r.total, approvalRate: pct(r.approvalRate),
      falsePositiveRate: r.falsePositiveRate === null ? null : pct(r.falsePositiveRate),
      truePositiveRate: r.truePositiveRate === null ? null : pct(r.truePositiveRate)
    })),
    approvalGap: Number(approvalGap.toFixed(2)),
    riskDelta: riskDelta === null ? null : Number(riskDelta.toFixed(3)),
    tprGap: tprGap === null ? null : Number(tprGap.toFixed(3)),
    disparateImpact: Number(disparateImpact.toFixed(3)),
    fairnessScore: Number(Math.max(0, 100 - approvalGap).toFixed(1)),
    accuracy: labeled ? Number(((correct / labeled) * 100).toFixed(1)) : null,
    weights, weightBasis: labelIdx < 0 ? 'prediction' : 'label',
    generatedAt: new Date().toISOString()
  };
}

/** Pass requires the configured fairness score AND the four-fifths (80%) disparate-impact rule. */
const passes = (analysis) => analysis.fairnessScore >= store.settings.fairnessThreshold && analysis.disparateImpact >= 0.8;

function mitigationPlan(analysis) {
  const totalApproved = analysis.groupRates.reduce((s, g) => s + (g.approvalRate / 100) * g.total, 0);
  const target = totalApproved / analysis.records;
  const groups = analysis.groupRates.map((g) => {
    const shift = target - g.approvalRate / 100;
    return { group: g.group, currentApprovalRate: g.approvalRate, targetApprovalRate: pct(target), shiftPoints: pct(shift), recordsToReview: Math.round(Math.abs(shift) * g.total) };
  });
  return {
    targetApprovalRate: pct(target), approvalGapBefore: analysis.approvalGap, approvalGapTarget: 0, groups,
    recordsToReview: groups.reduce((s, g) => s + g.recordsToReview, 0)
  };
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function reportHtml(audit) {
  const a = audit.analysis;
  const org = store.settings;
  const passed = audit.status === 'Passed';
  const rows = a ? a.groupRates.map((g) => `<tr><td>${esc(g.group)}</td><td>${g.total}</td><td>${g.approvalRate}%</td><td>${g.falsePositiveRate === null ? '—' : g.falsePositiveRate + '%'}</td></tr>`).join('') : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(audit.modelName)} — Fairness Audit</title>
<style>body{font:15px/1.6 Georgia,serif;color:#1c1b1b;max-width:760px;margin:48px auto;padding:0 24px}h1{font-size:28px;margin:0 0 4px;color:#012d1d}
.meta{color:#414844;font:13px system-ui,sans-serif;margin-bottom:32px}table{border-collapse:collapse;width:100%;font:14px system-ui,sans-serif;margin:16px 0}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #c1c8c2}th{background:#f2efe9}.verdict{display:inline-block;padding:4px 14px;border-radius:99px;font:600 13px system-ui,sans-serif;background:${passed ? '#c0ecdb' : '#ffdad6'};color:${passed ? '#002018' : '#93000a'}}
dl{display:grid;grid-template-columns:220px 1fr;gap:6px 16px;font:14px system-ui,sans-serif}dt{color:#414844}dd{margin:0;font-weight:600}.print{float:right;font:13px system-ui,sans-serif}
@media print{.print{display:none}}</style></head><body>
<a class="print" href="#" onclick="window.print();return false">Print / Save as PDF</a>
<h1>Fairness Audit: ${esc(audit.modelName)}</h1>
<div class="meta">${esc(org.orgName)} · ${esc(org.complianceStandard)} · Audit date ${esc(audit.date)} · Audit ID ${esc(audit.id)}</div>
<p><span class="verdict">${esc(audit.status)}</span></p>
${a ? `<dl><dt>Fairness score</dt><dd>${a.fairnessScore} / 100 (threshold ${org.fairnessThreshold})</dd>
<dt>Approval-rate gap</dt><dd>${a.approvalGap} percentage points</dd>
<dt>Disparate impact ratio</dt><dd>${a.disparateImpact} (four-fifths rule requires ≥ 0.80)</dd>
<dt>False-positive-rate delta</dt><dd>${a.riskDelta ?? 'n/a (no labels)'}</dd>
<dt>Accuracy on evaluation set</dt><dd>${a.accuracy === null ? 'n/a (no labels)' : a.accuracy + '%'}</dd>
<dt>Records evaluated</dt><dd>${a.records}</dd></dl>
<h2>Outcomes by protected group</h2>
<table><thead><tr><th>Group</th><th>Records</th><th>Approval rate</th><th>False-positive rate</th></tr></thead><tbody>${rows}</tbody></table>
<p style="font:13px system-ui,sans-serif;color:#414844">Evaluation file: ${esc(a.sourceFile)}. Generated ${esc(a.generatedAt)}. This report measures group-level outcome disparities in the supplied evaluation data; it is not legal advice and does not establish compliance on its own.</p>`
  : `<p>This audit carries a score of ${audit.score}/100. ${audit.analysisPurged ? 'Its evaluation data was deleted under the organization\'s retention policy.' : 'No evaluation data is stored for it.'}</p>`}
</body></html>`;
}

function upsertReport(audit) {
  let report = store.reports.find((r) => r.auditId === audit.id);
  if (!report) { report = { id: newId('r'), auditId: audit.id }; store.reports.unshift(report); }
  Object.assign(report, { title: `${audit.modelName} Fairness Audit`, date: today(), size: `${Math.max(1, Math.round(Buffer.byteLength(reportHtml(audit)) / 1024))} KB` });
  return report;
}

/* ------------------------------------------------------------------ */
/* Derived data                                                        */
/* ------------------------------------------------------------------ */
function metrics() {
  const scored = store.audits.filter((a) => typeof a.score === 'number');
  const passed = scored.filter((a) => a.status === 'Passed').length;
  return {
    modelsAudited: scored.length,
    awaiting: store.audits.length - scored.length,
    passRate: scored.length ? Math.round((passed / scored.length) * 100) : null,
    totalInferences: store.audits.reduce((s, a) => s + (a.records || 0), 0),
    fairnessScore: scored.length ? Math.round(scored.reduce((s, a) => s + a.score, 0) / scored.length) : null,
    openAppeals: Object.values(store.applications).filter((x) => x.appealRequested).length,
    threshold: store.settings.fairnessThreshold
  };
}
const publicAudit = ({ analysis, ...audit }) => ({ ...audit, hasAnalysis: Boolean(analysis) });
const csvCell = (v) => { const t = String(v).replace(/"/g, '""'); return `"${/^[=+\-@\t\r]/.test(t) ? "'" : ''}${t}"`; }; // neutralises spreadsheet formula injection

function auditWithAnalysis(id) {
  const audit = store.audits.find((a) => a.id === id);
  if (!audit) throw new HttpError(404, 'Audit not found');
  if (!audit.analysis) throw new HttpError(409, audit.analysisPurged ? 'Evaluation data for this audit was deleted under your retention policy' : 'This audit has no evaluation data yet');
  return audit;
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });

route('GET', '/api/health', (req, res) => ok(res, { status: 'ok' }));

route('GET', '/api/auth/session', (req, res) => ok(res, { user: publicUser(getUser(req)) || null, orgName: store.settings.orgName }));

route('POST', '/api/auth/login', async (req, res) => {
  const { email, password } = await readJson(req);
  const normalized = String(email || '').trim().toLowerCase();
  const ip = clientIp(req);
  if (rateLimited(`login:${ip}:${normalized}`) || rateLimited(`login-ip:${ip}`, 100)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const user = store.users.find((u) => u.email === normalized);
  const valid = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !valid) { logActivity(null, 'login.failed', normalized.slice(0, 80)); saveStore(); throw new HttpError(401, 'Invalid email or password'); }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, expires: Date.now() + SESSION_TTL_MS, model: null });
  logActivity(user, 'login'); saveStore();
  sendJson(res, 200, { success: true, user: publicUser(user) }, { 'Set-Cookie': cookieHeader(token, SESSION_TTL_MS / 1000) });
});

route('POST', '/api/auth/signup', async (req, res) => {
  const { email, password, inviteCode } = await readJson(req);
  const normalized = String(email || '').trim().toLowerCase();
  if (rateLimited(`signup:${clientIp(req)}`, 10)) throw new HttpError(429, 'Too many attempts. Try again later.');
  if (!/^\S+@\S+\.\S+$/.test(normalized) || String(password || '').length < 10) throw new HttpError(400, 'Enter a valid email and a password of at least 10 characters');
  if (store.users.some((u) => u.email === normalized)) throw new HttpError(409, 'An account with this email already exists');
  let invite = null;
  if (inviteCode) {
    const hash = sha256(String(inviteCode).trim());
    invite = store.invites.find((i) => !i.usedBy && i.expires > Date.now() && safeEqual(i.codeHash, hash));
    if (!invite) throw new HttpError(403, 'This invite code is invalid, expired or already used');
  }
  const user = { id: newId('u'), email: normalized, passwordHash: await hashPassword(password), name: normalized.split('@')[0], role: invite ? 'admin' : 'applicant' };
  store.users.push(user);
  if (invite) invite.usedBy = user.id; else store.applications[user.id] = defaultApplication();
  logActivity(user, 'signup', `role ${user.role}`);
  saveStore();
  ok(res, { user: publicUser(user) });
});

route('POST', '/api/auth/logout', (req, res) => {
  const s = getSession(req);
  if (s) sessions.delete(s.token);
  sendJson(res, 200, { success: true }, { 'Set-Cookie': cookieHeader('', 0) });
});

route('POST', '/api/auth/password', async (req, res) => {
  const user = requireUser(req);
  const { current, next } = await readJson(req);
  if (rateLimited(`pw:${user.id}`, 10)) throw new HttpError(429, 'Too many attempts. Try again later.');
  if (!(await verifyPassword(current, user.passwordHash))) throw new HttpError(403, 'Current password is incorrect');
  if (String(next || '').length < 10) throw new HttpError(400, 'New password must be at least 10 characters');
  user.passwordHash = await hashPassword(next);
  const keep = getSession(req).token;
  for (const [token, session] of sessions) if (session.userId === user.id && token !== keep) sessions.delete(token);
  logActivity(user, 'password.change'); saveStore();
  ok(res);
});

route('POST', '/api/invites', (req, res) => {
  const user = requireUser(req, ['admin']);
  const code = `rcty-${crypto.randomBytes(9).toString('base64url')}`;
  const invite = { id: newId('i'), codeHash: sha256(code), createdBy: user.email, created: today(), expires: Date.now() + INVITE_TTL_MS, usedBy: null };
  store.invites.unshift(invite);
  logActivity(user, 'invite.create'); saveStore();
  ok(res, { code, expires: new Date(invite.expires).toISOString().slice(0, 10) }); // the code is shown once and never stored in plain text
});
route('GET', '/api/invites', (req, res) => {
  requireUser(req, ['admin']);
  ok(res, { invites: store.invites.slice(0, 20).map((i) => ({ id: i.id, created: i.created, createdBy: i.createdBy, status: i.usedBy ? 'Used' : i.expires < Date.now() ? 'Expired' : 'Open' })) });
});
route('GET', '/api/activity', (req, res) => { requireUser(req, ['admin']); ok(res, { activity: store.activity.slice(0, 200) }); });

route('GET', '/api/dashboard/metrics', (req, res) => { requireUser(req, ['admin']); ok(res, { metrics: metrics() }); });
route('GET', '/api/dashboard/audits', (req, res) => { requireUser(req, ['admin']); ok(res, { audits: store.audits.map(publicAudit) }); });

route('POST', '/api/auditor/uploads', async (req, res) => {
  const user = requireUser(req, ['admin']);
  const session = getSession(req).ref;
  if (!String(req.headers['content-type'] || '').includes('multipart/form-data')) throw new HttpError(400, 'Upload a file using multipart form data');
  const upload = await readUpload(req, MAX_MODEL_BYTES);
  const extension = upload.name.split('.').pop().toLowerCase();

  if (extension === 'csv') {
    if (!upload.complete) throw new HttpError(400, 'Evaluation CSV files must be 10MB or smaller');
    const analysis = calculateAnalysis(upload.content, upload.name);
    let audit = session.model && store.audits.find((a) => a.id === session.model.auditId);
    if (!audit) { audit = { id: newId('a'), modelName: upload.name.replace(/\.csv$/i, ''), date: today() }; store.audits.unshift(audit); }
    Object.assign(audit, { status: passes(analysis) ? 'Passed' : 'Failed', score: analysis.fairnessScore, records: analysis.records, analysis, date: today() });
    upsertReport(audit);
    session.model = null;
    logActivity(user, 'audit.evaluate', `${audit.modelName}: ${audit.status}`);
    saveStore();
    return ok(res, { kind: 'evaluation', message: 'Evaluation data analyzed', analysis, auditId: audit.id, verdict: audit.status });
  }
  if (!MODEL_EXTENSIONS.includes(extension)) throw new HttpError(400, 'Supported uploads: .pkl, .pmml, .onnx, .joblib, or an evaluation .csv');
  const audit = { id: newId('a'), modelName: upload.name, date: today(), status: 'Awaiting evaluation data', score: null, size: upload.size };
  store.audits.unshift(audit);
  session.model = { name: upload.name, size: upload.size, auditId: audit.id };
  logActivity(user, 'audit.model', audit.modelName);
  saveStore();
  ok(res, { kind: 'model', model: session.model, message: 'Model received. Upload an evaluation CSV to calculate fairness metrics.', id: audit.id });
});

const ARENA_METRICS = [
  { key: 'fairnessScore', label: 'Fairness score', better: 'higher', unit: '/100' },
  { key: 'approvalGap', label: 'Approval-rate gap', better: 'lower', unit: ' pts' },
  { key: 'disparateImpact', label: 'Disparate impact ratio', better: 'higher', unit: '' },
  { key: 'riskDelta', label: 'False-positive-rate delta', better: 'lower', unit: '' },
  { key: 'tprGap', label: 'True-positive-rate gap', better: 'lower', unit: '' },
  { key: 'accuracy', label: 'Accuracy', better: 'higher', unit: '%' }
];

route('POST', '/api/arena/compare', async (req, res) => {
  requireUser(req, ['admin']);
  const { a, b } = await readJson(req);
  if (!a || !b || a === b) throw new HttpError(400, 'Choose two different audits to compare');
  const A = store.audits.find((x) => x.id === a && x.analysis);
  const B = store.audits.find((x) => x.id === b && x.analysis);
  if (!A || !B) throw new HttpError(400, 'Both audits need evaluation data. Upload an evaluation CSV for each model in the Auditor.');

  const rows = ARENA_METRICS.map((m) => {
    const va = A.analysis[m.key], vb = B.analysis[m.key];
    let winner = null;
    if (va !== null && vb !== null && va !== vb) winner = (m.better === 'higher') === (va > vb) ? 'a' : 'b';
    return { ...m, a: va, b: vb, winner };
  });
  const groupNames = [...new Set([...A.analysis.groupRates, ...B.analysis.groupRates].map((g) => g.group))];
  const rate = (an, group) => an.groupRates.find((g) => g.group === group)?.approvalRate ?? null;
  const groups = groupNames.map((group) => ({ group, a: rate(A.analysis, group), b: rate(B.analysis, group) }));

  const fairDelta = Number((B.analysis.fairnessScore - A.analysis.fairnessScore).toFixed(1));
  const accDelta = A.analysis.accuracy !== null && B.analysis.accuracy !== null ? Number((B.analysis.accuracy - A.analysis.accuracy).toFixed(1)) : null;
  let summary;
  if (fairDelta === 0) summary = `${A.modelName} and ${B.modelName} have identical fairness scores.`;
  else {
    const [fair, other, d] = fairDelta > 0 ? [B, A, fairDelta] : [A, B, -fairDelta];
    summary = `${fair.modelName} is fairer than ${other.modelName} by ${d} points.`;
    if (accDelta !== null && accDelta !== 0) {
      const fairerIsB = fairDelta > 0;
      const accFairer = fairerIsB ? accDelta : -accDelta;
      summary += accFairer < 0 ? ` That costs ${Math.abs(accFairer)} points of accuracy.` : ` It is also ${accFairer} points more accurate.`;
    }
  }
  const verdict = (x) => ({ id: x.id, name: x.modelName, status: x.status, analysis: x.analysis });
  ok(res, { a: verdict(A), b: verdict(B), rows, groups, summary, groupsDiffer: groupNames.some((g) => rate(A.analysis, g) === null || rate(B.analysis, g) === null) });
});

route('GET', '/api/mitigation/([\\w-]+)', (req, res, [id]) => {
  requireUser(req, ['admin']);
  const audit = auditWithAnalysis(id);
  ok(res, { audit: { id: audit.id, name: audit.modelName, status: audit.status, score: audit.score }, plan: mitigationPlan(audit.analysis), weights: audit.analysis.weights, basis: audit.analysis.weightBasis });
});
route('GET', '/api/mitigation/([\\w-]+)/weights.csv', (req, res, [id]) => {
  requireUser(req, ['admin']);
  const audit = auditWithAnalysis(id);
  const csv = ['group,label,count,sample_weight', ...audit.analysis.weights.map((w) => `${csvCell(w.group)},${w.label},${w.count},${w.weight}`)].join('\n');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="reweighing-${audit.id}.csv"` });
  res.end(csv);
});

route('GET', '/api/reports', (req, res) => { requireUser(req, ['admin']); ok(res, { reports: store.reports }); });
route('GET', '/api/reports/([\\w-]+)/download', (req, res, [id]) => {
  requireUser(req, ['admin']);
  const report = store.reports.find((r) => r.id === id);
  const audit = report && store.audits.find((a) => a.id === report.auditId);
  if (!audit) throw new HttpError(404, 'Report not found');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(reportHtml(audit));
});

route('GET', '/api/settings', (req, res) => { requireUser(req, ['admin']); ok(res, { settings: store.settings }); });
route('PUT', '/api/settings', async (req, res) => {
  requireUser(req, ['admin']);
  const input = await readJson(req);
  const next = { ...store.settings };
  if (input.orgName !== undefined) { const v = String(input.orgName).trim(); if (!v || v.length > 80) throw new HttpError(400, 'Organization name must be 1–80 characters'); next.orgName = v; }
  if (input.complianceStandard !== undefined) { if (!['ISO-42001', 'NIST-AI-RMF', 'EU-AI-ACT', 'ECOA'].includes(input.complianceStandard)) throw new HttpError(400, 'Unknown compliance standard'); next.complianceStandard = input.complianceStandard; }
  if (input.dataRetention !== undefined) { if (!['30_days', '90_days', '1_year', '7_years'].includes(input.dataRetention)) throw new HttpError(400, 'Unknown retention period'); next.dataRetention = input.dataRetention; }
  if (input.fairnessThreshold !== undefined) { const n = Number(input.fairnessThreshold); if (!Number.isFinite(n) || n < 50 || n > 100) throw new HttpError(400, 'Fairness threshold must be between 50 and 100'); next.fairnessThreshold = n; }
  const user = getUser(req);
  const changed = Object.keys(next).filter((k) => next[k] !== store.settings[k]);
  store.settings = next;
  if (changed.length) logActivity(user, 'settings.update', changed.join(', '));
  purgeExpired(); saveStore();
  ok(res, { settings: next });
});

/* Applicant portal: every applicant only ever sees their own record. */
route('GET', '/api/applicant/status', (req, res) => {
  const user = requireUser(req, ['applicant', 'admin']);
  const owner = user.role === 'admin' ? 'u2' : user.id; // admins preview the demo applicant, read-only
  ok(res, { status: store.applications[owner] || null });
});
route('POST', '/api/applicant/appeal', async (req, res) => {
  const user = requireUser(req, ['applicant']);
  const notes = String((await readJson(req)).notes || '').trim().slice(0, 1000);
  const app = store.applications[user.id] ||= defaultApplication();
  Object.assign(app, { status: 'Appeal Under Human Review', appealRequested: true, appealDate: today(), notes: notes || 'Human review requested by applicant.', lastResolution: null });
  logActivity(user, 'appeal.submit', app.referenceId); saveStore();
  ok(res, { message: 'Appeal submitted for human review.', status: app });
});

/* Admin appeal queue: closes the loop with the applicant portal. */
route('GET', '/api/appeals', (req, res) => {
  requireUser(req, ['admin']);
  const entries = Object.entries(store.applications).map(([userId, a]) => {
    const u = store.users.find((x) => x.id === userId);
    return { userId, name: u?.name, email: u?.email, referenceId: a.referenceId, product: a.product, appealDate: a.appealDate, notes: a.notes, resolution: a.lastResolution || null, open: Boolean(a.appealRequested) };
  });
  ok(res, { open: entries.filter((e) => e.open), resolved: entries.filter((e) => !e.open && e.resolution).sort((x, y) => String(y.resolution.date).localeCompare(x.resolution.date)) });
});
route('POST', '/api/appeals/([\\w-]+)/resolve', async (req, res, [userId]) => {
  const admin = requireUser(req, ['admin']);
  const { outcome, comment } = await readJson(req);
  const app = store.applications[userId];
  if (!app || !app.appealRequested) throw new HttpError(404, 'No open appeal for this applicant');
  if (!['approved', 'upheld'].includes(outcome)) throw new HttpError(400, 'Outcome must be "approved" or "upheld"');
  const note = String(comment || '').trim().slice(0, 500);
  Object.assign(app, {
    status: outcome === 'approved' ? 'Approved on Appeal' : 'Decision Upheld After Review', appealRequested: false, decisionDate: today(), stage: 4,
    lastResolution: { outcome, comment: note, by: admin.name, date: today() }
  });
  logActivity(admin, `appeal.${outcome}`, app.referenceId); saveStore();
  ok(res, { status: app });
});

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */
function serveStatic(req, res, pathname) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const target = path.join(__dirname, file);
  if (!PUBLIC_FILES.has(file) || !fs.existsSync(target)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': `${MIME[path.extname(file)]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader(process.env.CSP_ENFORCE === '1' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  try {
    const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
    for (const r of routes) {
      const m = r.method === req.method && r.pattern.exec(pathname);
      if (m) return await r.handler(req, res, m.slice(1));
    }
    throw new HttpError(404, 'API route not found');
  } catch (error) {
    if (!(error instanceof HttpError)) console.error(error);
    if (!res.headersSent) sendJson(res, error.status || 500, { error: error.status ? error.message : 'Unexpected server error' });
  }
});

loadStore();
purgeExpired();
setInterval(purgeExpired, 60 * 60 * 1000).unref();
setInterval(() => { // housekeeping: expired sessions and stale rate-limit counters
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expires < now) sessions.delete(token);
  for (const [key, entry] of attempts) if (entry.resetAt < now) attempts.delete(key);
}, 10 * 60 * 1000).unref();

if (IS_PROD && store.users.some((u) => verifyPasswordSync('password', u.passwordHash))) {
  console.error('Refusing to start in production while an account still uses the password "password".\nSet DEMO_PASSWORD (12+ chars) before the first run, or start once without NODE_ENV=production and change the passwords in Fairness policy.');
  process.exit(1);
}
server.listen(PORT, () => {
  console.log(`RayCtify is running at http://localhost:${PORT} (storage: ${sqlite ? 'SQLite ' + path.basename(DB_FILE) : 'JSON file'})`);
  if (store.users.some((u) => verifyPasswordSync('password', u.passwordHash))) {
    console.warn('! Demo accounts use the default password. Set DEMO_PASSWORD before first run, or change them, for any real deployment.');
  }
});
