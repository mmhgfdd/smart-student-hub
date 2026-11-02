# Smart Student Hub

A student learning platform: notes and past papers by class and subject, timed quizzes with scoring, online lessons with progress tracking, an assignment manager, study tools, a student dashboard, and a protected admin panel.

- **Frontend:** HTML5, CSS3, vanilla JavaScript (no build step)
- **Backend:** Node.js + Express (one dependency)
- **Storage:** JSON file in `data/` (see *Database* below)

---

## 1. Requirements

- Node.js 18 or newer (tested on Node 22)
- npm (ships with Node)

## 2. Run it locally

```bash
cd smart-student-hub
npm install
npm start
```

Open http://localhost:3000

On the **first start** the server creates `data/db.json` and prints an admin password to the console if you did not set one. For a fixed password, set it before the first run:

```bash
# macOS / Linux
ADMIN_PASSWORD='Choose-A-Strong-Pass1' npm start

# Windows PowerShell
$env:ADMIN_PASSWORD='Choose-A-Strong-Pass1'; npm start
```

Demo accounts created on first start (delete them before going live, or set `SEED_DEMO=false`):

| Role    | Email                     | Password        |
|---------|---------------------------|-----------------|
| Admin   | admin@smarthub.local      | `ADMIN_PASSWORD` or the printed one |
| Student | student@smarthub.local    | `Student@123`   |

For development with auto-reload: `npm run dev`.

## 3. Project structure

```
smart-student-hub/
├── server.js              # Express API: auth, sessions, roles, all data endpoints
├── package.json
├── README.md
├── data/                  # Created at runtime
│   ├── db.json            # All accounts, content, results (back this up)
│   └── files/             # Uploaded PDF notes
└── public/
    ├── index.html         # Single HTML shell
    ├── css/style.css      # Theme (blue, white, purple), light/dark, responsive layout
    └── js/app.js          # Router, pages, quiz engine, tools, admin panel
```

## 4. Feature map

| Requirement | Where |
|---|---|
| Homepage: hero, logo, nav, search, featured courses, recent notes, quick links, news | `pageHome` in `app.js` |
| Student dashboard: profile, class, roll, ID, daily progress, assignments, exams, attendance, activity, timetable | `pageDashboard` |
| Study materials: subjects, class and subject filters, PDF download, MCQs, short and long questions | `pageMaterials`, `GET /api/materials` |
| Quiz system: 4 options, prev/next, countdown, auto-scoring (server-side), indicators, result and report, retry | `pageQuiz`, `renderResult`, `POST /api/quizzes/:id/submit` |
| Online learning: video lessons, categories, progress tracker, bookmarks, recently viewed | `pageLearn` |
| Assignment manager: create, edit, delete, deadlines, complete, pending/completed tabs | `pageAssignments`, `/api/assignments` |
| Student tools: calculator, percentage, GPA, Pomodoro, exam countdown, to-do, notes, timetable, planner | `toolCalc` … `toolPlanner` |
| Admin: login, materials and PDF upload, subjects and classes, quizzes, announcements, students, stats | `pageAdmin`, `/api/admin/*` |
| Registration, login/logout, password reset, profile management, password change | `/api/auth/*`, `/api/profile*`, auth pages |
| Light and dark mode, responsive sidebar, mobile menu, loading and empty states | `style.css`, `renderChrome`, `renderSidebar`, `skeleton`, `empty` |

## 5. Security

- Passwords are hashed with **scrypt** (per-user random salt), compared in constant time.
- Sessions use random 256-bit tokens in an **HttpOnly, SameSite=Lax** cookie. The cookie is also marked `Secure` when `NODE_ENV=production`, so serve the site over HTTPS in production.
- **Authorization is enforced on the server.** Admin routes check the session and the role on every request (`requireAdmin`). Hiding a menu item in the browser is not the protection.
- Students can only read and change their own assignments and data. Admins cannot delete their own account or remove their own admin role.
- Login is rate-limited (10 failed attempts per email and IP in 15 minutes).
- Password reset tokens are stored as SHA-256 hashes, expire after 30 minutes, and are single-use. Changing a password signs out all existing sessions.
- Responses include a Content-Security-Policy, `X-Frame-Options: DENY` and `nosniff`. All user-supplied text is HTML-escaped in the frontend.
- Uploads are limited to real PDFs (magic-number check) up to 8 MB.

## 6. Backend configuration you must complete for production

These features are built, but a few parts depend on services only you can set up:

1. **Password reset emails.** The server creates the reset link but does not send email. In development the response includes `devResetToken` and the page shows a link. In production (`NODE_ENV=production`) that field is removed, so you must add email sending. Example with nodemailer: in `server.js`, inside `POST /api/auth/forgot`, send `https://your-domain/#/reset?token=<token>` to `user.email` where the comment "Production: email the link" appears.
2. **HTTPS and a domain.** Put the app behind HTTPS (Nginx, Caddy, or your host's TLS). The `Secure` cookie flag requires HTTPS.
3. **Database at scale.** The JSON store is fine for a single school or a few hundred students. For larger use, move the same collections to PostgreSQL or SQLite. The data shapes are simple and map directly to tables (`users`, `materials`, `quizzes`, `announcements`, `courses`, `sessions`).
4. **Backups.** Copy `data/` regularly. It contains accounts and uploaded PDFs.
5. **Video lessons.** Lesson links point to Khan Academy sample pages. Admins can add any `https://` link. Hosting your own videos needs a video host or storage service.

## 7. Deployment

### Option A: Any Linux VPS (Ubuntu example)

```bash
sudo apt update && sudo apt install -y nodejs npm nginx
sudo npm install -g pm2
cd /var/www && sudo git clone <your-repo> smart-student-hub   # or upload the folder
cd smart-student-hub && npm install --omit=dev
NODE_ENV=production ADMIN_PASSWORD='your-strong-password' SEED_DEMO=false PORT=3000 pm2 start server.js --name ssh
pm2 save && pm2 startup
```

Nginx reverse proxy (`/etc/nginx/sites-available/ssh`):

```nginx
server {
  server_name yourschool.example;
  client_max_body_size 12m;          # PDF uploads
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Then add HTTPS: `sudo certbot --nginx -d yourschool.example`.

### Option B: Render, Railway, or Fly.io

- Build command: `npm install`
- Start command: `npm start`
- Environment variables: `NODE_ENV=production`, `ADMIN_PASSWORD=...`, `SEED_DEMO=false`
- Attach a persistent disk and point the app's `data/` directory at it, or the JSON database resets on every deploy.

## 8. API reference (summary)

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Create student account |
| POST | `/api/auth/login` | Public | Log in (sets session cookie) |
| POST | `/api/auth/logout` | Any | Log out |
| GET | `/api/auth/me` | Public | Current user or `null` |
| POST | `/api/auth/forgot` | Public | Request password reset |
| POST | `/api/auth/reset` | Public | Set new password with token |
| PUT | `/api/profile` | Student | Update profile and photo |
| POST | `/api/profile/password` | Student | Change password |
| GET / PUT | `/api/me/data` | Student | Timetable, notes, to-dos, bookmarks, progress, study log, exams |
| GET / POST / PUT / DELETE | `/api/assignments[/:id]` | Student | Own assignments |
| GET | `/api/materials` | Public | Search and filter materials |
| GET | `/api/materials/:id` | Public | Material details and inline content |
| GET | `/api/materials/:id/file` | Student | Download PDF |
| GET | `/api/quizzes` | Public | Quiz list |
| GET | `/api/quizzes/:id` | Student | Quiz questions (no answers) |
| POST | `/api/quizzes/:id/submit` | Student | Grade attempt, return review |
| GET | `/api/announcements`, `/api/courses`, `/api/meta` | Public | Content and catalog |
| POST / PUT / DELETE | `/api/admin/materials[/:id]`, `/api/admin/quizzes[/:id]` | Admin | Manage content |
| POST / DELETE | `/api/admin/announcements[/:id]`, `/api/admin/courses[/:id]` | Admin | Manage content |
| POST / DELETE | `/api/admin/subjects[/:name]`, `/api/admin/classes[/:name]` | Admin | Manage catalog |
| GET | `/api/admin/stats` | Admin | Website statistics |
| GET / PATCH / DELETE | `/api/admin/users[/:id]` | Admin | Manage student accounts |

## 9. Troubleshooting

- **"Cannot reach the server" on load:** the backend is not running. Start it with `npm start`.
- **Admin sees no students after registering:** the list is filtered by the search box; clear it.
- **Lost data after redeploy:** `data/` was not persisted. See section 7.
- **PDF upload rejected:** the file must be a real PDF under 8 MB.
- **Reset link does not work:** links expire after 30 minutes and can be used once.
