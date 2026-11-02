# RayCtify v2.0

Fairness auditing for lenders, plus an applicant portal where people can follow their application and ask for a human review.
Zero dependencies: Node.js 22.5+ for the built-in SQLite store (Node 18+ falls back to a JSON file).

```bash
node server.js            # http://localhost:3000
```

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Lender staff (admin) | admin@rayctify.com | `password` |
| Applicant | applicant@example.com | `password` |

Set `DEMO_PASSWORD` before the first run to seed different passwords. In production (`NODE_ENV=production`) the server refuses to start while any account still uses `password`.

## What's in it

**Lender console**

| Page | What it does |
|---|---|
| Portfolio | Live metrics, filterable audit table, banner when appeals are waiting |
| Audits | Upload a model, then its evaluation CSV; get a Passed/Failed verdict, per-group rates, a printable report |
| Compare models | Two audits side by side: fairness, accuracy, per-group approval rates |
| Mitigation | Per-group plan to reach parity, and reweighing weights (Kamiran & Calders) exported as CSV |
| Appeals | Review applicant appeals, approve or uphold, leave a note the applicant sees |
| Compliance reports | A printable report per audit |
| Fairness policy | Pass threshold, framework label, retention period, staff invites, password change, activity log |

**Applicant portal:** *My application* (status, progress, information considered) and *Your rights* (request a human review, see the outcome and reviewer note).

Old links (`#/auditor`, `#/arena`, `#/interceptor`, `#/vaccine`, `#/settings`, `#/decision`) redirect to the new pages.

## Evaluation CSV

One row per decision. Required: `protected_group` (or `group`, `gender`, `race`) and `prediction` (or `score`). Optional: `label` (enables accuracy and error-rate gaps). See `sample-evaluation.csv`.

A model **passes** when its fairness score (100 − approval-rate gap) meets your threshold *and* its disparate-impact ratio is at least 0.80 (four-fifths rule).

## Configuration

| Variable | Purpose |
|---|---|
| `PORT` | default 3000 |
| `DB_FILE` | SQLite path, default `./rayctify.db` |
| `STORAGE=json` | force the legacy JSON store (`DATA_FILE`); an existing `data.json` is imported into SQLite once |
| `DEMO_PASSWORD` | password for the seeded demo accounts |
| `NODE_ENV=production` | Secure cookies, HSTS, default-password guard |
| `TRUST_PROXY=1` | use `X-Forwarded-For` for rate limiting (only behind a proxy you control) |
| `CSP_ENFORCE=1` | enforce the Content-Security-Policy (default is report-only; check the browser console first) |

## Security

- scrypt password hashing (async, constant-time compare); HttpOnly SameSite cookies; sessions expire after 8h and are cleaned up
- Login/signup/password rate limiting per IP; role checks on every API route; applicants only ever see their own record
- Staff accounts only by single-use, 7-day invite codes (stored hashed). Public signup always creates an applicant
- Static file whitelist (the database is never served); HTML escaping of all user-supplied text; CSV formula neutralising in exports
- Append-only activity log (sign-ins, audits, policy changes, invites, appeals, data deletion)
- Retention: stored per-group evaluation data is deleted automatically after your configured period; scores, verdicts and report headers are kept
- Uploaded models are **never loaded or run**. Keep it that way: opening `.pkl`/`.joblib` files executes code

## Known limits

- Fairness is measured from the evaluation CSV you supply. Models are recorded (name, size) but not executed.
- Mitigation produces a plan and weights. It does not change your model.
- Applicant intake is out of scope: new applicant accounts get an illustrative application record.
- Tailwind loads from its CDN. For production, build a local stylesheet and then enforce the CSP.
- No email: no password reset or email verification. Signup reveals whether an email is already registered, which cannot be fixed properly without email verification.
- Applicant data (income, credit score, notes) is stored unencrypted in the database. Use disk encryption and restrict file permissions.
- Sessions are in memory (a restart signs everyone out). Back up `rayctify.db` with the `-wal` file, or `sqlite3 .backup`.
