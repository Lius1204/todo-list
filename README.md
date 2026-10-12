# Todo List Website

A learning project built with plain **Node.js (no web framework)**, **CSV file storage**, **JWT authentication**, **Gmail SMTP email verification**, and a seeded list of **1,000,000 fake emails** that is checked for duplicates on every sign-up in well under the 0.5 s requirement.

## 1. Project overview

- Three pages: **Login**, **Sign Up**, **Task List (Assign Task)**.
- All verified (`active`) accounts share **one task list**. There are no owner restrictions: any active user can create, edit, assign, complete, reopen, or delete any task.
- Sign-up flow (matches the required 3-step flow):
  1. A new account is created with `status = pending` and persisted to CSV.
  2. A verification email is sent **asynchronously** (the API does not wait for SMTP).
  3. The user clicks the link, the account becomes `active`, and only then can log in.
- Email uniqueness is checked against the registered accounts **and** 1,000,000 seeded fake emails, loaded once into RAM at server start (O(1) lookup per check).
- No database server, no ORM, no Express. Data lives in CSV files; secrets live in `.env`.

## 2. Technology stack

| Layer | Technology | Notes |
|---|---|---|
| HTTP server | `node:http` | Static file serving + API routing, no framework |
| File system | `node:fs`, `node:path` | CSV storage, static assets, path traversal protection |
| Crypto | `node:crypto` | `scrypt` password hashing, `timingSafeEqual`, secure random tokens/IDs |
| JWT | `jsonwebtoken` | Signed tokens, `sub` = user id, expiry from `.env` |
| Email | `nodemailer` | Gmail SMTP, App Password, async delivery |
| CSV | `csv-parse`, `csv-stringify` | RFC 4180 parsing/serialising (commas, quotes, Unicode, newlines) |
| Env loading | `process.loadEnvFile` (Node >= 20.12) | No dotenv dependency needed |
| Frontend | HTML, CSS, vanilla JavaScript | `fetch()` + `localStorage`, no framework |

## 3. Folder structure

```text
todo-list/
├── frontend/
│   ├── page/            login.html, signup.html, assign-task.html
│   ├── script/          login.js, signup.js, assign-task.js
│   └── style/           login.css, signup.css, assign-task.css
├── backend/
│   ├── src/
│   │   ├── routes/      authRoutes.js, taskRoutes.js
│   │   ├── controllers/ authController.js, taskController.js
│   │   ├── services/    authService.js, taskService.js, emailService.js, seedEmailService.js
│   │   ├── middleware/  authMiddleware.js
│   │   ├── utils/       csvUtils.js, httpUtils.js, idUtils.js, jwtUtils.js,
│   │   │                passwordUtils.js, responseUtils.js, tokenUtils.js, validationUtils.js
│   │   └── server.js
│   ├── db/              users.csv, tasks.csv, seed_users.csv (auto-created; git-ignored)
│   └── scripts/         seedUsers.js, checkSmoke.js, testCsvRoundTrip.js, testUtils.js,
│                        testSignupFlow.js, testLoginFlow.js, testTaskFlow.js,
│                        testFrontendAssets.js, testSeedEmailCheck.js
├── .env                 (git-ignored, holds real secrets)
├── .env.example         (placeholders for submission)
├── .gitignore
├── package.json
└── README.md
```

## 4. Node.js version requirement

- **Node.js >= 20.12.0** is required (uses `process.loadEnvFile`).
- Developed and tested on **Node.js v24.21.0** (Windows).
- Check your version: `node -v`

## 5. Installation

```bat
git clone <your-repository-url>
cd todo-list
npm install
copy .env.example .env      :: Windows  (on macOS/Linux: cp .env.example .env)
npm run seed                :: generates backend/db/seed_users.csv with 1,000,000 fake emails
```

## 6. Environment variable setup

| Variable | Example | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | long random string | JWT signing key. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_DAYS` | `3` | Token lifetime in days (default 3). Only affects newly issued tokens |
| `SMTP_HOST` | `smtp.gmail.com` | Gmail SMTP host |
| `SMTP_PORT` | `465` | `465` = implicit TLS, `587` = STARTTLS |
| `SMTP_USER` | `you@gmail.com` | Gmail account that sends verification emails |
| `SMTP_APP_PASSWORD` | 16-char App Password | **Never the normal Gmail password** |
| `APP_BASE_URL` | `http://localhost:3000` | Used to build the verification link inside emails |

`.env` is excluded by `.gitignore`. Never commit real values; `.env.example` contains placeholders only.

## 7. Gmail App Password setup

1. Open https://myaccount.google.com and sign in with the sending account.
2. Go to **Security** → enable **2-Step Verification** (required before App Passwords appear).
3. Return to **Security** → **App passwords**.
4. Create an app password named e.g. `todo-list`.
5. Copy the generated **16-character** password (spaces optional).
6. Paste it into `.env` as `SMTP_APP_PASSWORD=...` and set `SMTP_USER` to that Gmail address.
7. Restart the server. Only emails confirmed by Nodemailer are logged as sent; failures are logged and the account stays `pending`.

## 8. How to start the server

```bat
npm run seed     :: once, generates the 1M seed file
npm start        :: production-style start
npm run dev      :: development start with auto-reload (--watch)
```

Expected startup logs:

```text
[storage] Đã chuẩn bị file CSV: backend/db/users.csv, backend/db/tasks.csv
[seed] Đã nạp 1,000,000 email seed vào RAM trong ... ms (... MB, RAM tăng ~... MB).
==========================================================
[server] Todo list đang chạy tại : http://localhost:3000
[server] Trang Login            : http://localhost:3000/page/login.html
[server] Kiểm tra API           : http://localhost:3000/api/health
==========================================================
```

## 9. Local URL

- Entry point: **http://localhost:3000** (redirects to the Login page).
- Pages: `/page/login.html`, `/page/signup.html`, `/page/assign-task.html` (requires login).

## 10. API endpoint reference

All API responses use:

```json
{ "status": "OK",    "message": "...", "data": { } }
{ "status": "ERROR", "message": "..." }
```

Status codes: `200` ok · `201` created · `400` invalid input · `401` missing/invalid token · `403` account not verified · `404` not found · `405` wrong method · `409` duplicate email · `413` body too large · `429` rate limit · `500` server/storage error.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/signup` | public | Create pending account, send verification email async |
| GET | `/api/verify-email?token=...` | public | Activate account, returns an HTML result page |
| POST | `/api/resend-verification` | public | Resend verification email (60 s cooldown), generic response |
| POST | `/api/login` | public | Verify credentials, returns JWT. Pending account → `403` |
| GET | `/api/me` | Bearer | Current user `{ id, name, email }` |
| POST | `/api/logout` | Bearer | Client-side logout acknowledgement (see §15 limitation) |
| GET | `/api/users` | Bearer | Active users for assignment `{ id, name, email }` |
| GET | `/api/tasks` | Bearer | Shared task list, each item joined with `assignedToName` |
| POST | `/api/tasks` | Bearer | Create task `{ "content": "..." }`; `createdBy` comes from the JWT |
| PATCH | `/api/tasks/:id` | Bearer | Partial update of `content` / `assignedTo` / `completed` |
| DELETE | `/api/tasks/:id` | Bearer | Delete a task |

Examples:

```json
// POST /api/login  ->  200
{ "status": "OK", "message": "Login successful",
  "data": { "token": "<jwt>", "user": { "id": "user_...", "name": "Alex", "email": "alex@example.com" } } }

// PATCH /api/tasks/task_123  body: { "content": "Practice Node.js", "assignedTo": "user_456", "completed": true }
{ "status": "OK", "message": "Task updated successfully",
  "data": { "id": "task_123", "content": "Practice Node.js", "assignedTo": "user_456",
            "assignedToName": "other-user", "completed": true, "createdAt": "...", "updatedAt": "..." } }
```

Unassign a task with `"assignedTo": ""`. Send the JWT as `Authorization: Bearer <token>`.

## 11. CSV schemas

`backend/db/users.csv` — exact column order:

```text
id,email,passwordSalt,passwordHash,name,status,verificationTokenHash,verificationExpiresAt,verificationSentAt,createdAt
```

| Column | Meaning |
|---|---|
| `id` | Unique, random (`user_<hex>`), independent of row numbers |
| `email` | Trimmed, lowercased, unique (case-insensitive) |
| `passwordSalt` / `passwordHash` | scrypt salt + hash. Plain passwords are never stored |
| `name` | Display name |
| `status` | `pending` or `active`; only `active` can log in |
| `verificationTokenHash` | SHA-256 hash of the verification token (token itself is never stored), empty after activation |
| `verificationExpiresAt` / `verificationSentAt` | ISO 8601 timestamps |
| `createdAt` | ISO 8601 |

`backend/db/tasks.csv` — exact column order:

```text
id,content,createdBy,assignedTo,completed,createdAt,updatedAt
```

`content` ≤ 100 chars, `createdBy` (from JWT) and `createdAt` are immutable; `assignedTo` references an active user or is empty; `completed` is `true`/`false`.

`backend/db/seed_users.csv` — generated by `npm run seed`:

```text
id,email
seed_user_0000001,seeduser0000001@example.com
...
seed_user_1000000,seeduser1000000@example.com
```

Storage guarantees: files are auto-created with correct headers; every write goes through a per-file serialised queue (no lost updates inside this single process) and is written to a temp file then atomically renamed; a read/parse error is never treated as an empty dataset. CSV provides no transactions across files and no multi-process safety.

## 12. Email verification workflow

1. Sign-up validates input, normalises the email, and rejects duplicates (registered accounts **and** the 1M seed list).
2. The password is hashed with a unique salt (`crypto.scrypt`); a 256-bit verification token is generated; **only its SHA-256 hash** is stored with a 15-minute expiry; the account is saved with `status=pending`.
3. The API responds immediately; the verification email is sent afterwards, asynchronously. The response never claims the email was delivered — delivery is confirmed in the server log only after Nodemailer reports success.
4. The user opens the link (`/api/verify-email?token=...`). The server hashes the token, compares with the stored hash, validates expiry and state, sets `status=active`, and clears the token hash/expiry. Tokens are single-use.
5. `POST /api/resend-verification` issues a new token (invalidating the old one) with a 60 s cooldown (`429` otherwise) and always returns the same generic message so account existence is not leaked.

## 13. JWT configuration and expiration behaviour

- `JWT_EXPIRES_DAYS` in `.env` controls newly issued token lifetimes (default 3 days) — change the number and restart; **no code changes needed**.
- Tokens carry the user id in the standard `sub` claim and are signed with `JWT_SECRET`.
- Every protected request: signature + expiry are verified, then the account must still exist and be `active` (otherwise `401`).
- The frontend stores the token in `localStorage`, sends it as `Authorization: Bearer`, checks it with `GET /api/me` after reload, and removes + redirects to Login when it is invalid/expired.
- Changing the configured lifetime affects only tokens issued after the change; existing tokens keep their original `exp`.

## 14. Testing instructions

### 14.1 Automated test scripts

All scripts print Vietnamese-labelled `✅ PASS / ❌ FAIL` lines and clean up the test data they create.

| Command | Covers | Server required? |
|---|---|---|
| `npm run test:csv` | CSV round-trip (commas, quotes, Unicode, newlines), write queue, broken-file errors, ID uniqueness | No |
| `npm run test:utils` | Validation rules, scrypt hashing, JWT create/verify/expire, token hashing, response format | No |
| `npm run test:signup` | Signup → pending account, duplicate email 409, verify once, reused/expired token rejected, resend cooldown 429, SMTP-failure never reports success | Partly (part B) |
| `npm run test:login` | Login success/wrong/unknown/pending, JWT middleware (missing/tampered/expired/inactive), `/api/me`, logout limitation, **login timing** | Partly (part B) |
| `npm run test:tasks` | Task defaults, content limits, assignment validation, completion toggle, field whitelisting, 404s, delete isolation, shared permissions | Partly (part B) |
| `npm run test:frontend` | All 9 static files + content types, HTML/JS id wiring, XSS-safe rendering checks, no secrets in frontend, path traversal | Yes |
| `npm run test:seed` | Seed file integrity (1,000,000 rows), O(1) lookups, 409 for seeded email, 201 for new email, **performance numbers** | Partly (part B) |
| `npm run check` | Smoke check: env, CSVs, seed, SMTP login, health, static files, 401/400/409 guards, traversal | Partly (part B) |
| `npm run test:all` | Runs every test in sequence (start the server first) | Yes |

### 14.2 One-command pre-demo check

```bat
npm start          :: terminal 1
npm run check      :: terminal 2  -> expect 16 PASS / 0 WARN / 0 FAIL
```

### 14.3 Performance results

Requirement: server-side sign-up ≤ **0.5 s**, including the duplicate-email check against 1,000,000 seeded emails. Results measured with the scripts above on the development machine (Windows, Node.js v24.21.0):

| Measurement | Measured by | Result | Budget |
|---|---|---|---|
| Lookup inside the 1M email set | `npm run test:seed` (A3) | **0.95 µs per lookup** (1,000,000 lookups totalled 949.8 ms) | — |
| Sign-up, email already in seed | `npm run test:seed` (B1) | median **2.3 ms**, slowest **8.1 ms** | 500 ms ✅ |
| Sign-up, new email (includes scrypt hashing) | `npm run test:seed` (B2) | median **74.0 ms** | 500 ms ✅ |
| Login, server-side | `npm run test:login` (B7) | median: _fill in from your run_ | 500 ms |

Notes: the totals above are per-request times except the 1M-lookup row, which intentionally measures throughput of one million consecutive lookups. Server-side processing is measured separately from network latency and browser rendering. Verification-email delivery is asynchronous and is **not** part of the sign-up response time.

### 14.4 Manual test checklist — browser

- [ ] `http://localhost:3000` redirects to Login; title `Todo list`; **Login button is framed**, `Sign Up` link below is not.
- [ ] Empty Login submission shows field errors under each input.
- [ ] Sign Up rejects: short/long password, missing uppercase/lowercase/special character (message shows the exact rule).
- [ ] Sign up with a real Gmail address → success message; account appears in `users.csv` as `pending`.
- [ ] Logging in while pending → clear "not verified" message + working "Resend verification email" button (429 if clicked again within 60 s).
- [ ] Email arrives; link opens the "Email verified" page; `users.csv` row becomes `active` with token columns cleared.
- [ ] Clicking the same link again → "already been used" page.
- [ ] Login succeeds → redirected to Task list; reload keeps the session; logout clears `localStorage`.
- [ ] Add task with Vietnamese text, commas and quotes → displays correctly and persists after reload.
- [ ] Tick completion → strikethrough persists; untick works.
- [ ] Edit → Save (empty content rejected); second user can edit/delete the first user's task.
- [ ] Assign → dropdown lists active users only; picking one shows `(name)`; `Reassign` replaces it; `Unassigned` clears it.
- [ ] Delete asks for confirmation; Cancel keeps the task; OK removes it after the server confirms.
- [ ] Manually corrupt the token in devtools → any action redirects to Login.

### 14.5 Manual test checklist — Postman

- [ ] `GET /api/tasks` without token → `401`.
- [ ] `POST /api/login` with wrong password and with unknown email → both `401` with the **same** message.
- [ ] `POST /api/login` correct → `200`, token returned, **Time < 500 ms** in Postman.
- [ ] `GET /api/me` with Bearer token → `200`; with a tampered token → `401`.
- [ ] `POST /api/signup` with `seeduser000004242@example.com` → `409` within a few ms (1M-email check).
- [ ] `POST /api/tasks` with `{"content":"..."}` → `201`, `createdBy` = your user id; sending `createdBy` in the body → `400`.
- [ ] `PATCH /api/tasks/:id` assign → `200` with `assignedToName`; unknown field → `400`; fake id → `404`.
- [ ] `DELETE /api/tasks/:id` twice → `200` then `404`.
- [ ] `GET /..%2F.env` → `403 Forbidden`.

## 15. Known limitations

- **CSV single-process only**: the write queue serialises writes inside one Node.js process. Running multiple server processes on the same CSV files can lose updates, and CSV gives no transactions. The files are also fully read per request — fine at this scale, not suitable for large user tables (that is why the 1M seed data lives in a separate file loaded once into RAM).
- **Stateless JWT logout**: `POST /api/logout` only tells the client to delete its token. The server cannot revoke an already-issued token — a copied token stays valid until it expires. Proper revocation would require server-side token storage (out of scope).
- **localStorage tokens** are readable by any script on the page; an XSS vulnerability would expose them. Mitigation in this project: all dynamic content is rendered with `textContent`, no third-party scripts. Production should use HTTPS; httpOnly cookies are a possible future improvement.
- The 1M seed list occupies roughly 90–130 MB of RAM in the server process.
- There is no login rate limiting (only the resend endpoint is rate-limited, as required).
- Sign-up email delivery is asynchronous: a `201` means "account saved", not "email delivered" — confirm delivery via server logs.
- Performance figures are local development measurements; numbers vary by machine.

## 16. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid login: 535-5.7.8 Username and Password not accepted` | Wrong/expired App Password, or 2-Step Verification is off. Re-enable 2FA, create a new App Password, paste it without spaces. |
| Verification email never arrives | Check the log: `[email] Đã gửi email xác thực tới ...` means Gmail accepted it — check the Spam folder. `[email] ... thất bại ...` means SMTP rejected it (bad credentials or address). |
| `EADDRINUSE: address already in use :::3000` | Another process uses the port: `netstat -ano | findstr :3000` then `taskkill /PID <pid> /F`, or change `PORT` in `.env`. |
| `npm.ps1 cannot be loaded because running scripts is disabled` (Windows) | Use a Command Prompt terminal in VS Code, or run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`. |
| `[seed] Chưa có backend/db/seed_users.csv` | Run `npm run seed`, then **restart** the server so the list is loaded into RAM. |
| Sign-up with a `seeduser...@example.com` address returns `201` instead of `409` | The server was started before the seed file existed. Restart the server. |
| `Header of users.csv không đúng schema` | The CSV was edited by hand. Restore the exact header from §11 (back up the file first) or delete it to be re-created empty. |
| `JWT_SECRET is missing` | Fill `JWT_SECRET` in `.env` (see §6 for the generator command). |
| Frontend shows "Cannot reach the server" | The server is not running: start it with `npm start`. |