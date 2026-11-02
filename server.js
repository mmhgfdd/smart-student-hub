'use strict';
/*
  Smart Student Hub - Express API + static frontend.
  Storage: a JSON file in ./data (no native modules needed).
  For production scale, move the same data shapes to PostgreSQL/SQLite.
*/
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = path.join(__dirname, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_MS = 30 * 60 * 1000;
const MAX_PHOTO_CHARS = 520000;

fs.mkdirSync(FILES_DIR, { recursive: true });

/* ---------- helpers ---------- */
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (res, code, error) => res.status(code).json({ error });
const emailOk = e => e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const passOk = p => typeof p === 'string' && p.length >= 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  const test = crypto.scryptSync(String(pw), salt, 64);
  const ref = Buffer.from(hash || '', 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(test, ref);
}

const SUBJECTS = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'English', 'Computer Science', 'Urdu', 'Islamic Studies', 'Economics'];
const CLASSES = ['Class 9', 'Class 10', 'Class 11', 'Class 12'];
const MATERIAL_TYPES = ['notes', 'past-paper', 'mcq', 'short-questions', 'long-questions', 'book'];
const NEWS_TYPES = ['announcement', 'news', 'exam'];
const DATA_KEYS = ['timetable', 'todos', 'notes', 'bookmarks', 'recentLessons', 'examDates', 'progress', 'studyLog', 'dailyGoal'];

function freshData() {
  return { timetable: [], todos: [], notes: '', bookmarks: [], recentLessons: [], examDates: [], progress: {}, studyLog: {}, dailyGoal: 60, assignments: [], quizResults: [] };
}

/* ---------- database ---------- */
function seed() {
  const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`\n  Admin login: admin@smarthub.local / ${adminPassword}`);
    console.log('  Set ADMIN_PASSWORD before first start to choose your own.\n');
  }
  const users = [{
    id: uid(), name: 'Administrator', email: 'admin@smarthub.local', passwordHash: hashPassword(adminPassword),
    role: 'admin', className: '', rollNumber: '', studentId: 'ADM-0001', avatar: '', phone: '', attendance: 100,
    createdAt: now(), data: freshData(), resetHash: null, resetExp: 0
  }];
  if (process.env.SEED_DEMO !== 'false') {
    users.push({
      id: uid(), name: 'Demo Student', email: 'student@smarthub.local', passwordHash: hashPassword('Student@123'),
      role: 'student', className: 'Class 10', rollNumber: '17', studentId: 'SSH-2026-00017', avatar: '', phone: '',
      attendance: 92, createdAt: now(), data: freshData(), resetHash: null, resetExp: 0
    });
  }
  const mat = (title, subject, classLevel, type, description, content = '') =>
    ({ id: uid(), title, subject, classLevel, type, description, content, fileId: null, downloads: 0, createdAt: now() });
  const materials = [
    mat('Cell Structure and Functions - Short Notes', 'Biology', 'Class 10', 'notes', 'Plasma membrane, organelles and their functions.'),
    mat('Motion and Newton\'s Laws - Full Notes', 'Physics', 'Class 9', 'notes', 'Speed, velocity, acceleration and the three laws of motion.'),
    mat('Periodic Table Trends - Notes', 'Chemistry', 'Class 11', 'notes', 'Atomic radius, ionisation energy and electronegativity trends.'),
    mat('Algebra Important MCQs with Answers', 'Mathematics', 'Class 10', 'mcq', 'Quick MCQs on linear equations and quadratics.',
      'Q1. The value of x in 2x + 6 = 14 is?\nAnswer: (b) 4\n\nQ2. Which one is a quadratic equation?\nAnswer: (c) x² + 3x + 2 = 0'),
    mat('Physics Past Paper - Class 12', 'Physics', 'Class 12', 'past-paper', 'Board examination paper with marking scheme.'),
    mat('English Grammar - Short Questions', 'English', 'Class 9', 'short-questions', 'Tenses, articles and sentence transformation.'),
    mat('Computer Science - Long Questions', 'Computer Science', 'Class 11', 'long-questions', 'Data structures, algorithms and programming basics.'),
    mat('Introduction to Economics - Chapter Summary', 'Economics', 'Class 12', 'book', 'Demand, supply and market structures summarised chapter by chapter.')
  ];
  const q = (text, options, answer) => ({ q: text, options, answer });
  const quizzes = [
    { id: uid(), title: 'Cell Biology Quiz', subject: 'Biology', classLevel: 'Class 10', timeLimitMin: 5, createdAt: now(), questions: [
      q('Which organelle is known as the powerhouse of the cell?', ['Nucleus', 'Mitochondrion', 'Ribosome', 'Golgi body'], 1),
      q('Which structure controls what enters and leaves the cell?', ['Cell wall', 'Cytoplasm', 'Plasma membrane', 'Vacuole'], 2),
      q('Ribosomes are the sites of which process?', ['Respiration', 'Protein synthesis', 'Photosynthesis', 'Digestion'], 1),
      q('Which organelle is found only in plant cells?', ['Mitochondrion', 'Chloroplast', 'Centrosome', 'Lysosome'], 1),
      q('Who proposed the cell theory together with Schwann?', ['Robert Hooke', 'Louis Pasteur', 'Matthias Schleiden', 'Gregor Mendel'], 2)
    ]},
    { id: uid(), title: 'Motion and Forces Quiz', subject: 'Physics', classLevel: 'Class 9', timeLimitMin: 4, createdAt: now(), questions: [
      q('The SI unit of acceleration is:', ['m/s', 'm/s²', 'm²/s', 'm/s³'], 1),
      q('Newton\'s first law is also called the law of:', ['Inertia', 'Acceleration', 'Gravitation', 'Momentum'], 0),
      q('Speed is calculated as:', ['Time ÷ distance', 'Distance ÷ time', 'Distance × time', 'Time × speed'], 1),
      q('The unit of force is:', ['Joule', 'Watt', 'Newton', 'Pascal'], 2),
      q('Velocity is a ___ quantity.', ['Scalar', 'Vector', 'Constant', 'Rate'], 1)
    ]}
  ];
  const courses = [
    { id: uid(), title: 'Biology Fundamentals', category: 'Biology', instructor: 'Khan Academy', duration: '6 h', url: 'https://www.khanacademy.org/science/biology', description: 'Cells, genetics and ecology explained step by step.' },
    { id: uid(), title: 'Physics Essentials', category: 'Physics', instructor: 'Khan Academy', duration: '8 h', url: 'https://www.khanacademy.org/science/physics', description: 'Motion, forces, energy and waves with worked examples.' },
    { id: uid(), title: 'Algebra Foundations', category: 'Mathematics', instructor: 'Khan Academy', duration: '5 h', url: 'https://www.khanacademy.org/math/algebra', description: 'Equations, functions and graphing for school exams.' },
    { id: uid(), title: 'Intro to Computer Science', category: 'Computer Science', instructor: 'Khan Academy', duration: '4 h', url: 'https://www.khanacademy.org/computing/computer-science', description: 'Algorithms, data and how programs work.' }
  ];
  const announcements = [
    { id: uid(), title: 'Mid-term examination schedule published', type: 'exam', body: 'Mid-term exams begin next month. Check your timetable for subject-wise dates.', createdAt: now() },
    { id: uid(), title: 'New Physics past papers uploaded', type: 'news', body: 'Board past papers for Physics (Class 12) are now available in Study Materials.', createdAt: now() },
    { id: uid(), title: 'Library hours extended', type: 'announcement', body: 'The library stays open until 6 PM during the examination period.', createdAt: now() }
  ];
  return { users, subjects: [...SUBJECTS], classes: [...CLASSES], materials, quizzes, announcements, courses, sessions: {} };
}

let db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : null;
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
if (!db) { db = seed(); saveDb(); }

function pruneSessions() {
  const t = Date.now();
  for (const k of Object.keys(db.sessions)) if (db.sessions[k].exp < t) delete db.sessions[k];
}

/* ---------- sessions & auth ---------- */
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function setCookie(res, value, maxAgeSec) {
  res.setHeader('Set-Cookie', `sid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${IS_PROD ? '; Secure' : ''}`);
}
function startSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { userId: user.id, exp: Date.now() + SESSION_MS };
  setCookie(res, token, SESSION_MS / 1000);
}
function getUser(req) {
  const token = parseCookies(req).sid;
  const s = token && Object.prototype.hasOwnProperty.call(db.sessions, token) ? db.sessions[token] : null;
  if (!s || s.exp < Date.now()) return null;
  return db.users.find(u => u.id === s.userId) || null;
}
function requireAuth(req, res, next) {
  const u = getUser(req);
  if (!u) return fail(res, 401, 'Please log in to continue.');
  req.user = u;
  next();
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return fail(res, 403, 'Administrators only.');
    next();
  });
}

const attempts = new Map();
function throttled(key) {
  const r = attempts.get(key);
  if (!r) return false;
  if (Date.now() > r.reset) { attempts.delete(key); return false; }
  return r.count >= 10;
}
function recordFailure(key) {
  const r = attempts.get(key) || { count: 0, reset: Date.now() + 15 * 60 * 1000 };
  r.count++;
  attempts.set(key, r);
}

const pub = u => ({
  id: u.id, name: u.name, email: u.email, role: u.role, className: u.className, rollNumber: u.rollNumber,
  studentId: u.studentId, avatar: u.avatar || '', phone: u.phone || '', attendance: u.attendance ?? 0, createdAt: u.createdAt
});
const publicMaterial = m => {
  const { fileId, content, ...rest } = m;
  return { ...rest, hasFile: Boolean(fileId), hasContent: Boolean(content) };
};
const gradeFor = p => (p >= 90 ? 'Outstanding' : p >= 75 ? 'Excellent' : p >= 60 ? 'Good' : p >= 40 ? 'Needs practice' : 'Keep trying');

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  next();
});
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/meta', (req, res) => {
  res.json({ subjects: db.subjects, classes: db.classes, types: MATERIAL_TYPES });
});

/* ----- auth ----- */
app.post('/api/auth/register', (req, res) => {
  const name = str(req.body.name, 80), email = str(req.body.email, 120).toLowerCase();
  const className = str(req.body.className, 20), rollNumber = str(req.body.rollNumber, 20);
  const password = req.body.password;
  if (name.length < 2) return fail(res, 400, 'Please enter your full name.');
  if (!emailOk(email)) return fail(res, 400, 'Please enter a valid email address.');
  if (!passOk(password)) return fail(res, 400, 'Password must be 8+ characters with letters and numbers.');
  if (!db.classes.includes(className)) return fail(res, 400, 'Please select a valid class.');
  if (!rollNumber) return fail(res, 400, 'Roll number is required.');
  if (db.users.some(u => u.email === email)) return fail(res, 409, 'An account with this email already exists.');
  const user = {
    id: uid(), name, email, passwordHash: hashPassword(password), role: 'student', className, rollNumber,
    studentId: 'SSH-' + new Date().getFullYear() + '-' + String(10000 + crypto.randomInt(89999)),
    avatar: '', phone: '', attendance: 0, createdAt: now(), data: freshData(), resetHash: null, resetExp: 0
  };
  db.users.push(user);
  startSession(res, user);
  saveDb();
  res.status(201).json({ user: pub(user) });
});

app.post('/api/auth/login', (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const key = req.ip + ':' + email;
  if (throttled(key)) return fail(res, 429, 'Too many attempts. Please try again in 15 minutes.');
  const user = db.users.find(u => u.email === email);
  if (!user || !checkPassword(password, user.passwordHash)) {
    recordFailure(key);
    return fail(res, 401, 'Incorrect email or password.');
  }
  attempts.delete(key);
  pruneSessions();
  startSession(res, user);
  saveDb();
  res.json({ user: pub(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req).sid;
  if (token) { delete db.sessions[token]; saveDb(); }
  setCookie(res, '', 0);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const u = getUser(req);
  res.json({ user: u ? pub(u) : null });
});

app.post('/api/auth/forgot', (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const user = db.users.find(u => u.email === email);
  const payload = { message: 'If an account exists for that email, a password reset link has been created.' };
  if (user) {
    const token = crypto.randomBytes(24).toString('hex');
    user.resetHash = sha(token);
    user.resetExp = Date.now() + RESET_MS;
    saveDb();
    // Production: email the link to the user here (e.g. nodemailer + SMTP).
    if (!IS_PROD) payload.devResetToken = token;
  }
  res.json(payload);
});

app.post('/api/auth/reset', (req, res) => {
  const token = str(req.body.token, 200);
  const password = req.body.password;
  if (!passOk(password)) return fail(res, 400, 'Password must be 8+ characters with letters and numbers.');
  const user = db.users.find(u => u.resetHash && u.resetHash === sha(token) && u.resetExp > Date.now());
  if (!user) return fail(res, 400, 'This reset link is invalid or has expired.');
  user.passwordHash = hashPassword(password);
  user.resetHash = null;
  user.resetExp = 0;
  for (const [t, s] of Object.entries(db.sessions)) if (s.userId === user.id) delete db.sessions[t];
  saveDb();
  res.json({ message: 'Password updated. Please log in with your new password.' });
});

/* ----- profile ----- */
app.put('/api/profile', requireAuth, (req, res) => {
  const u = req.user, b = req.body;
  if (b.name !== undefined) {
    const n = str(b.name, 80);
    if (n.length < 2) return fail(res, 400, 'Please enter your full name.');
    u.name = n;
  }
  if (b.className !== undefined) {
    if (!db.classes.includes(b.className)) return fail(res, 400, 'Please select a valid class.');
    u.className = b.className;
  }
  if (b.rollNumber !== undefined) u.rollNumber = str(b.rollNumber, 20);
  if (b.phone !== undefined) u.phone = str(b.phone, 20);
  if (b.avatar !== undefined) {
    if (b.avatar !== '' && !(/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(b.avatar) && b.avatar.length <= MAX_PHOTO_CHARS)) {
      return fail(res, 400, 'Profile picture must be a PNG, JPG or WEBP under 350 KB.');
    }
    u.avatar = b.avatar;
  }
  saveDb();
  res.json({ user: pub(u) });
});

app.post('/api/profile/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!checkPassword(String(currentPassword || ''), req.user.passwordHash)) return fail(res, 400, 'Current password is incorrect.');
  if (!passOk(newPassword)) return fail(res, 400, 'New password must be 8+ characters with letters and numbers.');
  req.user.passwordHash = hashPassword(newPassword);
  saveDb();
  res.json({ message: 'Password changed successfully.' });
});

/* ----- per-student data (timetable, notes, to-dos, progress, study log) ----- */
app.get('/api/me/data', requireAuth, (req, res) => res.json({ data: req.user.data }));

app.put('/api/me/data', requireAuth, (req, res) => {
  for (const k of Object.keys(req.body || {})) {
    if (!DATA_KEYS.includes(k)) continue;
    const v = req.body[k];
    if (JSON.stringify(v).length > 50000) return fail(res, 413, `Too much data in ${k}.`);
    req.user.data[k] = v;
  }
  saveDb();
  res.json({ data: req.user.data });
});

/* ----- assignments (owned by the student) ----- */
function cleanAssignment(b) {
  const title = str(b.title, 120), description = str(b.description, 1000);
  const subject = str(b.subject, 60), deadline = str(b.deadline, 30);
  if (title.length < 2) return { error: 'Please enter an assignment title.' };
  if (deadline && isNaN(Date.parse(deadline))) return { error: 'Deadline is not a valid date.' };
  return { value: { title, description, subject, deadline } };
}
app.get('/api/assignments', requireAuth, (req, res) => res.json({ assignments: req.user.data.assignments }));

app.post('/api/assignments', requireAuth, (req, res) => {
  const c = cleanAssignment(req.body);
  if (c.error) return fail(res, 400, c.error);
  const a = { id: uid(), ...c.value, completed: false, createdAt: now() };
  req.user.data.assignments.push(a);
  saveDb();
  res.status(201).json({ assignment: a });
});

app.put('/api/assignments/:id', requireAuth, (req, res) => {
  const a = req.user.data.assignments.find(x => x.id === req.params.id);
  if (!a) return fail(res, 404, 'Assignment not found.');
  const c = cleanAssignment({ ...a, ...req.body });
  if (c.error) return fail(res, 400, c.error);
  Object.assign(a, c.value);
  if (req.body.completed !== undefined) a.completed = Boolean(req.body.completed);
  saveDb();
  res.json({ assignment: a });
});

app.delete('/api/assignments/:id', requireAuth, (req, res) => {
  const before = req.user.data.assignments.length;
  req.user.data.assignments = req.user.data.assignments.filter(x => x.id !== req.params.id);
  if (req.user.data.assignments.length === before) return fail(res, 404, 'Assignment not found.');
  saveDb();
  res.json({ ok: true });
});

/* ----- materials ----- */
function removeFile(fileId) {
  if (fileId) fs.rm(path.join(FILES_DIR, path.basename(fileId)), { force: true }, () => {});
}
function cleanMaterial(b) {
  const title = str(b.title, 150), subject = str(b.subject, 60), classLevel = str(b.classLevel, 20);
  const type = str(b.type, 30), description = str(b.description, 500), content = str(b.content, 20000);
  if (title.length < 3) return { error: 'Title must be at least 3 characters.' };
  if (!db.subjects.includes(subject)) return { error: 'Please choose a valid subject.' };
  if (!db.classes.includes(classLevel)) return { error: 'Please choose a valid class.' };
  if (!MATERIAL_TYPES.includes(type)) return { error: 'Please choose a valid material type.' };
  return { value: { title, subject, classLevel, type, description, content } };
}
function savePdf(file) {
  if (!file || !file.dataUrl) return { id: null };
  const m = /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/.exec(file.dataUrl);
  if (!m) return { error: 'Only PDF files can be uploaded.' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 8 * 1024 * 1024) return { error: 'PDF must be under 8 MB.' };
  if (buf.slice(0, 4).toString() !== '%PDF') return { error: 'The file does not look like a valid PDF.' };
  const id = uid() + '.pdf';
  fs.writeFileSync(path.join(FILES_DIR, id), buf);
  return { id };
}

app.get('/api/materials', (req, res) => {
  const q = str(req.query.q, 100).toLowerCase();
  const subject = str(req.query.subject, 60), classLevel = str(req.query.classLevel, 20), type = str(req.query.type, 30);
  const list = db.materials
    .filter(m => (!subject || m.subject === subject) && (!classLevel || m.classLevel === classLevel) &&
      (!type || m.type === type) && (!q || `${m.title} ${m.subject} ${m.description}`.toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ materials: list.map(publicMaterial), total: list.length });
});

app.get('/api/materials/:id', (req, res) => {
  const m = db.materials.find(x => x.id === req.params.id);
  if (!m) return fail(res, 404, 'Material not found.');
  res.json({ material: { ...publicMaterial(m), content: m.content } });
});

app.get('/api/materials/:id/file', requireAuth, (req, res) => {
  const m = db.materials.find(x => x.id === req.params.id);
  if (!m || !m.fileId) return fail(res, 404, 'No PDF is attached to this material.');
  const file = path.join(FILES_DIR, path.basename(m.fileId));
  if (!fs.existsSync(file)) return fail(res, 404, 'The PDF file is missing from storage.');
  m.downloads++;
  saveDb();
  res.download(file, m.title.replace(/[^\w\- ]+/g, '').trim() + '.pdf');
});

app.post('/api/admin/materials', requireAdmin, (req, res) => {
  const c = cleanMaterial(req.body);
  if (c.error) return fail(res, 400, c.error);
  const f = savePdf(req.body.file);
  if (f.error) return fail(res, 400, f.error);
  const m = { id: uid(), ...c.value, fileId: f.id, downloads: 0, createdAt: now() };
  db.materials.push(m);
  saveDb();
  res.status(201).json({ material: publicMaterial(m) });
});

app.put('/api/admin/materials/:id', requireAdmin, (req, res) => {
  const m = db.materials.find(x => x.id === req.params.id);
  if (!m) return fail(res, 404, 'Material not found.');
  const c = cleanMaterial({ ...m, ...req.body });
  if (c.error) return fail(res, 400, c.error);
  let newFile = null;
  if (req.body.file) {
    newFile = savePdf(req.body.file);
    if (newFile.error) return fail(res, 400, newFile.error);
  }
  Object.assign(m, c.value);
  if (newFile) { removeFile(m.fileId); m.fileId = newFile.id; }
  saveDb();
  res.json({ material: publicMaterial(m) });
});

app.delete('/api/admin/materials/:id', requireAdmin, (req, res) => {
  const m = db.materials.find(x => x.id === req.params.id);
  if (!m) return fail(res, 404, 'Material not found.');
  removeFile(m.fileId);
  db.materials = db.materials.filter(x => x.id !== m.id);
  saveDb();
  res.json({ ok: true });
});

/* ----- quizzes ----- */
function cleanQuiz(b) {
  const title = str(b.title, 120), subject = str(b.subject, 60), classLevel = str(b.classLevel, 20);
  const timeLimitMin = Math.min(120, Math.max(1, parseInt(b.timeLimitMin, 10) || 10));
  const questions = Array.isArray(b.questions) ? b.questions : [];
  if (title.length < 3) return { error: 'Quiz title must be at least 3 characters.' };
  if (!db.subjects.includes(subject)) return { error: 'Please choose a valid subject.' };
  if (!db.classes.includes(classLevel)) return { error: 'Please choose a valid class.' };
  if (questions.length < 1 || questions.length > 100) return { error: 'A quiz needs between 1 and 100 questions.' };
  const qs = [];
  for (let i = 0; i < questions.length; i++) {
    const x = questions[i] || {};
    const text = str(x.q, 300);
    const options = Array.isArray(x.options) ? x.options.map(o => str(o, 200)) : [];
    const answer = Number(x.answer);
    if (!text) return { error: `Question ${i + 1} is empty.` };
    if (options.length !== 4 || options.some(o => !o)) return { error: `Question ${i + 1} needs exactly 4 non-empty options.` };
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) return { error: `Question ${i + 1} needs a correct answer index from 0 to 3.` };
    qs.push({ q: text, options, answer });
  }
  return { value: { title, subject, classLevel, timeLimitMin, questions: qs } };
}

app.get('/api/quizzes', (req, res) => {
  res.json({
    quizzes: db.quizzes.map(q => ({ id: q.id, title: q.title, subject: q.subject, classLevel: q.classLevel, timeLimitMin: q.timeLimitMin, count: q.questions.length }))
  });
});

app.get('/api/quizzes/:id', requireAuth, (req, res) => {
  const quiz = db.quizzes.find(q => q.id === req.params.id);
  if (!quiz) return fail(res, 404, 'Quiz not found.');
  res.json({
    id: quiz.id, title: quiz.title, subject: quiz.subject, classLevel: quiz.classLevel, timeLimitMin: quiz.timeLimitMin,
    questions: quiz.questions.map(x => ({ q: x.q, options: x.options }))
  });
});

app.post('/api/quizzes/:id/submit', requireAuth, (req, res) => {
  const quiz = db.quizzes.find(q => q.id === req.params.id);
  if (!quiz) return fail(res, 404, 'Quiz not found.');
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  let correct = 0;
  const review = quiz.questions.map((x, i) => {
    const picked = Number.isInteger(answers[i]) && answers[i] >= 0 && answers[i] <= 3 ? answers[i] : null;
    const ok = picked === x.answer;
    if (ok) correct++;
    return { q: x.q, options: x.options, picked, answer: x.answer, correct: ok };
  });
  const total = quiz.questions.length;
  const percent = Math.round((correct / total) * 100);
  const timeUsedSec = Math.max(0, Math.min(Number(req.body.timeUsedSec) || 0, quiz.timeLimitMin * 60));
  req.user.data.quizResults.push({ id: uid(), quizId: quiz.id, title: quiz.title, subject: quiz.subject, score: correct, total, percent, timeUsedSec, date: now() });
  req.user.data.quizResults = req.user.data.quizResults.slice(-200);
  saveDb();
  res.json({ score: correct, total, percent, grade: gradeFor(percent), review, timeUsedSec });
});

app.post('/api/admin/quizzes', requireAdmin, (req, res) => {
  const c = cleanQuiz(req.body);
  if (c.error) return fail(res, 400, c.error);
  const quiz = { id: uid(), ...c.value, createdAt: now() };
  db.quizzes.push(quiz);
  saveDb();
  res.status(201).json({ id: quiz.id });
});

app.put('/api/admin/quizzes/:id', requireAdmin, (req, res) => {
  const quiz = db.quizzes.find(q => q.id === req.params.id);
  if (!quiz) return fail(res, 404, 'Quiz not found.');
  const c = cleanQuiz({ ...quiz, ...req.body });
  if (c.error) return fail(res, 400, c.error);
  Object.assign(quiz, c.value);
  saveDb();
  res.json({ id: quiz.id });
});

app.delete('/api/admin/quizzes/:id', requireAdmin, (req, res) => {
  const before = db.quizzes.length;
  db.quizzes = db.quizzes.filter(q => q.id !== req.params.id);
  if (db.quizzes.length === before) return fail(res, 404, 'Quiz not found.');
  saveDb();
  res.json({ ok: true });
});

/* ----- announcements & courses ----- */
app.get('/api/announcements', (req, res) => {
  res.json({ announcements: [...db.announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
});
app.post('/api/admin/announcements', requireAdmin, (req, res) => {
  const title = str(req.body.title, 140), body = str(req.body.body, 1000), type = str(req.body.type, 20);
  if (title.length < 3) return fail(res, 400, 'Title must be at least 3 characters.');
  if (!body) return fail(res, 400, 'Message is required.');
  if (!NEWS_TYPES.includes(type)) return fail(res, 400, 'Invalid announcement type.');
  const a = { id: uid(), title, body, type, createdAt: now() };
  db.announcements.push(a);
  saveDb();
  res.status(201).json({ announcement: a });
});
app.delete('/api/admin/announcements/:id', requireAdmin, (req, res) => {
  db.announcements = db.announcements.filter(a => a.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

app.get('/api/courses', (req, res) => res.json({ courses: db.courses }));
app.post('/api/admin/courses', requireAdmin, (req, res) => {
  const c = {
    title: str(req.body.title, 120), category: str(req.body.category, 60), instructor: str(req.body.instructor, 80),
    duration: str(req.body.duration, 30), url: str(req.body.url, 300), description: str(req.body.description, 400)
  };
  if (c.title.length < 3) return fail(res, 400, 'Course title must be at least 3 characters.');
  if (!db.subjects.includes(c.category)) return fail(res, 400, 'Please choose a valid category.');
  if (!/^https:\/\//.test(c.url)) return fail(res, 400, 'Lesson link must start with https://');
  const course = { id: uid(), ...c };
  db.courses.push(course);
  saveDb();
  res.status(201).json({ course });
});
app.delete('/api/admin/courses/:id', requireAdmin, (req, res) => {
  db.courses = db.courses.filter(c => c.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

/* ----- admin: students, catalog, stats ----- */
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const students = db.users.filter(u => u.role === 'student');
  const attemptsAll = students.flatMap(u => u.data.quizResults);
  const avg = attemptsAll.length ? Math.round(attemptsAll.reduce((s, a) => s + a.percent, 0) / attemptsAll.length) : 0;
  res.json({
    students: students.length,
    materials: db.materials.length,
    quizzes: db.quizzes.length,
    quizAttempts: attemptsAll.length,
    avgQuizPercent: avg,
    downloads: db.materials.reduce((s, m) => s + m.downloads, 0),
    bySubject: db.subjects.map(s => ({ subject: s, materials: db.materials.filter(m => m.subject === s).length }))
  });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const q = str(req.query.q, 80).toLowerCase();
  const users = db.users
    .filter(u => !q || `${u.name} ${u.email} ${u.rollNumber} ${u.studentId}`.toLowerCase().includes(q))
    .map(pub);
  res.json({ users });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return fail(res, 404, 'User not found.');
  if (req.body.role !== undefined) {
    if (!['student', 'admin'].includes(req.body.role)) return fail(res, 400, 'Invalid role.');
    if (u.id === req.user.id && req.body.role !== 'admin') return fail(res, 400, 'You cannot remove your own admin role.');
    u.role = req.body.role;
  }
  if (req.body.attendance !== undefined) {
    const a = Number(req.body.attendance);
    if (!(a >= 0 && a <= 100)) return fail(res, 400, 'Attendance must be between 0 and 100.');
    u.attendance = Math.round(a);
  }
  if (req.body.className !== undefined) {
    if (req.body.className !== '' && !db.classes.includes(req.body.className)) return fail(res, 400, 'Invalid class.');
    u.className = req.body.className;
  }
  saveDb();
  res.json({ user: pub(u) });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return fail(res, 404, 'User not found.');
  if (u.id === req.user.id) return fail(res, 400, 'You cannot delete your own account.');
  db.users = db.users.filter(x => x.id !== u.id);
  for (const [t, s] of Object.entries(db.sessions)) if (s.userId === u.id) delete db.sessions[t];
  saveDb();
  res.json({ ok: true });
});

for (const key of ['subjects', 'classes']) {
  app.post(`/api/admin/${key}`, requireAdmin, (req, res) => {
    const name = str(req.body.name, 60);
    if (name.length < 2) return fail(res, 400, 'Name must be at least 2 characters.');
    if (db[key].some(x => x.toLowerCase() === name.toLowerCase())) return fail(res, 409, 'That already exists.');
    db[key].push(name);
    saveDb();
    res.status(201).json({ [key]: db[key] });
  });
  app.delete(`/api/admin/${key}/:name`, requireAdmin, (req, res) => {
    const name = req.params.name;
    if (!db[key].includes(name)) return fail(res, 404, 'Not found.');
    const field = key === 'subjects' ? 'subject' : 'classLevel';
    const inUse = db.materials.some(m => m[field] === name) || db.quizzes.some(q => q[field] === name) ||
      (key === 'classes' && db.users.some(u => u.className === name));
    if (inUse) return fail(res, 409, `"${name}" is in use and cannot be removed yet.`);
    db[key] = db[key].filter(x => x !== name);
    saveDb();
    res.json({ [key]: db[key] });
  });
}

/* ----- fallbacks & errors ----- */
app.use('/api', (req, res) => fail(res, 404, 'Not found.'));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return fail(res, 413, 'Upload is too large.');
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'Malformed request body.');
  console.error(err);
  fail(res, 500, 'Something went wrong on the server.');
});

app.listen(PORT, () => {
  console.log(`Smart Student Hub running at http://localhost:${PORT}`);
});
