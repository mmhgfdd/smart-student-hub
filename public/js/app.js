'use strict';
/* Smart Student Hub - single-page frontend (hash routing, no build step). */

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const todayKey = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const initials = n => (n || '?').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const pad = n => String(n).padStart(2, '0');
const fmtTime = sec => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
const round2 = n => Math.round(n * 100) / 100;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TYPE_LABELS = { notes: 'Notes', 'past-paper': 'Past paper', mcq: 'MCQs', 'short-questions': 'Short questions', 'long-questions': 'Long questions', book: 'Book' };
const NAV = [['', 'Home'], ['materials', 'Materials'], ['quizzes', 'Quizzes'], ['learn', 'Learn'], ['tools', 'Tools']];
const TOOLS = [['calc', '🧮 Calculator'], ['pct', '％ Percentage'], ['gpa', '🎓 GPA'], ['pomo', '⏱ Pomodoro'], ['exam', '⏳ Exam countdown'], ['todo', '✅ To-do'], ['notes', '🗒 Notes'], ['timetable', '🗓 Timetable'], ['planner', '📈 Planner']];
const ADMIN_TABS = [['overview', '📊 Overview'], ['materials', '📚 Materials'], ['quizzes', '❓ Quizzes'], ['news', '📢 Announcements'], ['courses', '🎥 Courses'], ['catalog', '🏷 Subjects & classes'], ['users', '👥 Students']];

const state = { user: null, data: null, meta: null, courses: [], timers: [] };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const readFile = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Could not read the file.'));
  r.readAsDataURL(file);
});

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3000);
  setTimeout(() => el.remove(), 3500);
}
const empty = (icon, title, text = '') =>
  `<div class="empty fade-in"><div class="empty-icon">${icon}</div><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
const skeleton = (n = 3) => `<div class="grid cards-3">${'<div class="card skel"></div>'.repeat(n)}</div>`;
const avatarHTML = (u, size = 40) => u.avatar
  ? `<img class="avatar-img" src="${esc(u.avatar)}" alt="" width="${size}" height="${size}">`
  : `<span class="avatar-init" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px">${esc(initials(u.name))}</span>`;
const opts = (list, sel = '') => list.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');

function openModal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
  requestAnimationFrame(() => $('#modal').classList.add('show'));
}
function closeModal() {
  $('#modal').classList.remove('show');
  setTimeout(() => $('#modal').classList.add('hidden'), 200);
}
function clearTimers() {
  state.timers.forEach(clearInterval);
  state.timers = [];
}
const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('ssh-theme', t);
  const b = $('#theme-btn');
  if (b) b.textContent = t === 'dark' ? '☀️' : '🌙';
}

/* ================= session & data ================= */
async function loadSession() {
  const r = await api('/auth/me');
  state.user = r.user;
  state.data = null;
}
async function getData() {
  if (!state.user) return null;
  if (!state.data) state.data = (await api('/me/data')).data;
  return state.data;
}
async function saveData(patch) {
  if (!state.user) { toast('Please log in to save your changes.', 'err'); return null; }
  const r = await api('/me/data', { method: 'PUT', body: patch });
  state.data = r.data;
  return r.data;
}
async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  state.user = null;
  state.data = null;
  renderChrome();
  go('#/');
  toast('You have been logged out.');
}

/* ================= shared components ================= */
const materialCard = m => `<article class="card material fade-in">
  <div class="card-top"><span class="chip">${esc(TYPE_LABELS[m.type] || m.type)}</span><span class="muted small">${esc(m.classLevel)}</span></div>
  <h3>${esc(m.title)}</h3>
  <p class="muted small">${esc(m.subject)}${m.description ? ' · ' + esc(m.description) : ''}</p>
  <div class="row gap">
    <button class="btn ghost sm" data-view="${esc(m.id)}">👁 View</button>
    ${m.hasFile ? `<button class="btn primary sm" data-download="${esc(m.id)}">⬇ PDF</button>` : ''}
  </div>
</article>`;

const courseCard = c => `<article class="card course fade-in">
  <div class="card-top"><span class="chip">${esc(c.category)}</span><span class="muted small">⏱ ${esc(c.duration)}</span></div>
  <h3>${esc(c.title)}</h3>
  <p class="muted small">${esc(c.description)}</p>
  <p class="small">By <b>${esc(c.instructor)}</b></p>
  <a class="btn primary sm" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" data-open="${esc(c.id)}">▶ Open lesson</a>
</article>`;

const newsItem = a => `<div class="news-item fade-in">
  <span class="news-icon">${{ exam: '📅', news: '📰', announcement: '📢' }[a.type] || '📢'}</span>
  <div>
    <div class="row gap"><b>${esc(a.title)}</b><span class="chip small">${esc(a.type)}</span></div>
    <p class="muted small">${esc(a.body)}</p>
    <span class="muted tiny">${new Date(a.createdAt).toLocaleDateString()}</span>
  </div>
</div>`;

async function viewMaterial(id) {
  openModal(`<div class="loader"></div>`);
  try {
    const { material: m } = await api('/materials/' + id);
    const body = m.content
      ? `<pre class="content-box">${esc(m.content)}</pre>`
      : `<p class="muted">${m.hasFile ? 'This resource is available as a downloadable PDF.' : 'Content for this resource will be added soon.'}</p>`;
    const action = m.hasFile
      ? (state.user ? `<a class="btn primary" href="/api/materials/${esc(m.id)}/file">⬇ Download PDF</a>` : `<a class="btn primary" href="#/login">Log in to download</a>`)
      : '';
    openModal(`<div class="modal-head">
        <div><span class="chip">${esc(TYPE_LABELS[m.type] || m.type)}</span><h2>${esc(m.title)}</h2><p class="muted small">${esc(m.subject)} · ${esc(m.classLevel)}</p></div>
        <button class="icon-btn" data-close aria-label="Close">✕</button>
      </div>
      ${m.description ? `<p>${esc(m.description)}</p>` : ''}
      ${body}
      <div class="row gap end" style="margin-top:16px">${action}<button class="btn ghost" data-close>Close</button></div>`);
  } catch (err) {
    closeModal();
    toast(err.message, 'err');
  }
}

/* Global delegated actions (work on every page) */
document.addEventListener('click', e => {
  const v = e.target.closest('[data-view]');
  if (v) return viewMaterial(v.dataset.view);
  const d = e.target.closest('[data-download]');
  if (d) {
    if (!state.user) return toast('Please log in to download PDFs.', 'err');
    location.href = `/api/materials/${d.dataset.download}/file`;
    return;
  }
  const o = e.target.closest('[data-open]');
  if (o && state.user) {
    const id = o.dataset.open;
    const list = [{ id, at: Date.now() }, ...((state.data && state.data.recentLessons) || []).filter(x => x.id !== id)].slice(0, 8);
    saveData({ recentLessons: list }).catch(() => {});
  }
  const rl = e.target.closest('[data-reload]');
  if (rl) location.reload();
});

/* ================= chrome (top bar + sidebar) ================= */
function renderChrome() {
  const u = state.user;
  const nav = u ? [...NAV, ['dashboard', 'Dashboard']] : NAV;
  $('#app').innerHTML = `
  <header class="topbar">
    <div class="wrap bar">
      <a href="#/" class="logo"><span class="logo-mark" aria-hidden="true">🎓</span><span>Smart<b>Student</b>Hub</span></a>
      <nav class="menu" id="menu" aria-label="Main">
        ${nav.map(([h, l]) => `<a href="#/${h}" data-nav="${h}">${l}</a>`).join('')}
      </nav>
      <div class="bar-right">
        <button class="icon-btn" id="theme-btn" aria-label="Toggle dark mode" title="Toggle dark mode"></button>
        ${u
          ? `<a class="avatar-sm" href="#/profile" title="${esc(u.name)}">${avatarHTML(u, 36)}</a>
             <button class="btn ghost sm" id="logout-btn">Log out</button>`
          : `<a class="btn ghost sm" href="#/login">Log in</a><a class="btn primary sm" href="#/register">Sign up</a>`}
        <button class="icon-btn burger" id="burger" aria-label="Open menu" aria-expanded="false">☰</button>
      </div>
    </div>
  </header>
  <div class="layout">
    <aside class="sidebar" id="sidebar" aria-label="Student menu"></aside>
    <section class="content" id="main"></section>
  </div>
  <footer class="footer"><div class="wrap">© ${new Date().getFullYear()} Smart Student Hub · Learn. Practise. Succeed.</div></footer>`;
  $('#burger').onclick = () => {
    const open = $('#menu').classList.toggle('open');
    $('#burger').setAttribute('aria-expanded', String(open));
  };
  $('#menu').onclick = e => { if (e.target.closest('a')) $('#menu').classList.remove('open'); };
  $('#theme-btn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  const lo = $('#logout-btn');
  if (lo) lo.onclick = logout;
  applyTheme(document.documentElement.dataset.theme || 'light');
}

function renderSidebar(active) {
  const u = state.user;
  if (!u) { $('#sidebar').innerHTML = ''; return; }
  const items = [
    ['dashboard', '🏠', 'Overview'], ['assignments', '📝', 'Assignments'], ['tools', '🧰', 'Study tools'],
    ['learn', '🎥', 'My learning'], ['materials', '📚', 'Materials'], ['quizzes', '❓', 'Quizzes'], ['profile', '👤', 'My profile'],
    ...(u.role === 'admin' ? [['admin', '🛠', 'Admin panel']] : [])
  ];
  $('#sidebar').innerHTML = `
    <div class="side-user">${avatarHTML(u, 44)}<div><b>${esc(u.name)}</b><div class="muted tiny">${esc(u.role === 'admin' ? 'Administrator' : u.className)}</div></div></div>
    <nav>${items.map(([h, i, l]) => `<a href="#/${h}" class="${h === active ? 'on' : ''}"><span>${i}</span>${l}</a>`).join('')}</nav>`;
}

/* ================= router ================= */
const PAGES = {
  '': { fn: pageHome },
  materials: { fn: pageMaterials },
  quizzes: { fn: pageQuizzes },
  quiz: { fn: pageQuiz, auth: true },
  learn: { fn: pageLearn },
  tools: { fn: pageTools },
  assignments: { fn: pageAssignments, auth: true, portal: true },
  dashboard: { fn: pageDashboard, auth: true, portal: true },
  profile: { fn: pageProfile, auth: true, portal: true },
  admin: { fn: pageAdmin, auth: true, admin: true, portal: true },
  login: { fn: pageLogin, guest: true },
  register: { fn: pageRegister, guest: true },
  forgot: { fn: pageForgot, guest: true },
  reset: { fn: pageReset, guest: true }
};

async function route() {
  clearTimers();
  closeModal();
  const [pathPart, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [name = '', ...args] = pathPart.split('/');
  const page = PAGES[name];
  const main = $('#main');
  if (!main) return;
  main.onclick = main.onchange = main.oninput = main.onsubmit = null;

  if (!page) {
    renderSidebar('');
    main.innerHTML = empty('🔍', 'Page not found', 'The page you are looking for does not exist.') +
      `<div class="center" style="margin-top:14px"><a class="btn primary" href="#/">Go home</a></div>`;
    return;
  }
  if (page.auth && !state.user) {
    return go(`#/login?next=${encodeURIComponent(pathPart + (query ? '?' + query : ''))}`);
  }
  if (page.guest && state.user) return go('#/dashboard');
  if (page.admin && state.user.role !== 'admin') {
    renderSidebar(name);
    main.innerHTML = empty('🔒', 'Admins only', 'You need an administrator account to open this page.');
    return;
  }

  document.body.classList.toggle('has-sidebar', Boolean(page.portal));
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === name));
  renderSidebar(name);
  main.innerHTML = skeleton(3);
  try {
    await page.fn(main, { name, args, params: new URLSearchParams(query) });
  } catch (err) {
    main.innerHTML = empty('⚠️', 'Something went wrong', err.message) +
      `<div class="center" style="margin-top:14px"><button class="btn ghost" data-reload>Reload page</button></div>`;
  }
}

/* ================= HOME ================= */
const QUICK = [
  ['📝', 'Exams', 'quizzes', 'Practice quizzes and timed tests'],
  ['📊', 'Results', 'dashboard', 'Scores and your performance report'],
  ['✅', 'Assignments', 'assignments', 'Track deadlines and pending work'],
  ['📚', 'Resources', 'materials', 'Notes, past papers and MCQs']
];

async function pageHome(main) {
  const [news, courses, mats] = await Promise.all([api('/announcements'), api('/courses'), api('/materials')]);
  state.courses = courses.courses;
  const u = state.user;
  main.innerHTML = `
  <section class="hero fade-in">
    <div class="hero-text">
      <span class="pill">🎓 Learn smarter · Score higher</span>
      <h1>${u ? `Welcome back, <span class="grad">${esc(u.name.split(' ')[0])}</span>!` : `Welcome, students, to <span class="grad">Smart Student Hub</span>`}</h1>
      <p>Notes, past papers, MCQs, timed quizzes, video lessons and study tools for every class, all in one place.</p>
      <form class="search" id="home-search" role="search">
        <input type="search" name="q" placeholder="Search notes, subjects, books…" aria-label="Search study materials">
        <button class="btn primary" type="submit">Search</button>
      </form>
    </div>
    <div class="hero-art" aria-hidden="true">
      <div class="blob"></div>
      <div class="float-card">📘 Physics notes<small>Class 9 · New</small></div>
      <div class="float-card alt">🏆 Quiz score<small>92% · Excellent</small></div>
    </div>
  </section>

  <section class="quick-grid">
    ${QUICK.map(([i, t, h, d]) => `<a class="card quick fade-in" href="#/${h}"><span class="quick-icon">${i}</span><h3>${t}</h3><p class="muted small">${d}</p></a>`).join('')}
  </section>

  <section>
    <div class="section-head"><h2>Featured courses</h2><a href="#/learn">View all →</a></div>
    <div class="grid cards-3">${courses.courses.slice(0, 3).map(courseCard).join('') || empty('🎥', 'No courses yet')}</div>
  </section>

  <section>
    <div class="section-head"><h2>Recently uploaded notes</h2><a href="#/materials">Browse all →</a></div>
    <div class="grid cards-4">${mats.materials.slice(0, 4).map(materialCard).join('') || empty('📚', 'No materials yet')}</div>
  </section>

  <section class="two-col">
    <div>
      <div class="section-head" style="margin-top:0"><h2>Latest news & announcements</h2></div>
      <div class="list">${news.announcements.slice(0, 5).map(newsItem).join('') || empty('📢', 'No announcements')}</div>
    </div>
    <div class="card cta">
      <h3>Ready for a challenge?</h3>
      <p>Take a timed quiz and get an instant performance report.</p>
      <a class="btn" href="#/quizzes">Start a quiz</a>
    </div>
  </section>`;

  main.onsubmit = e => {
    if (e.target.id !== 'home-search') return;
    e.preventDefault();
    const q = new FormData(e.target).get('q').trim();
    go('#/materials?q=' + encodeURIComponent(q));
  };
}

/* ================= MATERIALS ================= */
async function pageMaterials(main, route) {
  const q0 = route.params.get('q') || '';
  const m = state.meta;
  main.innerHTML = `
  <div class="page-head fade-in"><div><h1>Study materials</h1><p class="muted">Class-wise and subject-wise notes, past papers, MCQs and books.</p></div></div>
  <div class="toolbar">
    <input type="search" id="f-q" placeholder="Search title, subject, topic…" value="${esc(q0)}" aria-label="Search materials">
    <select id="f-subject" aria-label="Filter by subject"><option value="">All subjects</option>${opts(m.subjects)}</select>
    <select id="f-class" aria-label="Filter by class"><option value="">All classes</option>${opts(m.classes)}</select>
    <select id="f-type" aria-label="Filter by type"><option value="">All types</option>${Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
  </div>
  <p class="muted small" id="count"></p>
  <div class="grid cards-3" id="mat-list"></div>`;

  const load = async () => {
    const p = new URLSearchParams();
    const q = $('#f-q').value.trim();
    if (q) p.set('q', q);
    if ($('#f-subject').value) p.set('subject', $('#f-subject').value);
    if ($('#f-class').value) p.set('classLevel', $('#f-class').value);
    if ($('#f-type').value) p.set('type', $('#f-type').value);
    const list = $('#mat-list');
    list.innerHTML = skeleton(6);
    try {
      const { materials, total } = await api('/materials?' + p);
      $('#count').textContent = `${total} resource${total === 1 ? '' : 's'} found`;
      list.innerHTML = materials.length
        ? materials.map(materialCard).join('')
        : empty('🔎', 'No materials match your filters', 'Try another keyword or clear the filters.');
    } catch (err) {
      list.innerHTML = empty('⚠️', 'Could not load materials', err.message);
    }
  };
  let timer;
  main.oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  main.onchange = load;
  await load();
}

/* ================= QUIZZES ================= */
async function pageQuizzes(main) {
  const { quizzes } = await api('/quizzes');
  main.innerHTML = `
  <div class="page-head fade-in"><div><h1>Online quizzes</h1><p class="muted">Timed multiple-choice tests with instant scoring and a performance report.</p></div></div>
  <div class="grid cards-3">
    ${quizzes.map(q => `<article class="card fade-in">
      <div class="card-top"><span class="chip">${esc(q.subject)}</span><span class="muted small">${esc(q.classLevel)}</span></div>
      <h3>${esc(q.title)}</h3>
      <p class="muted small">${q.count} questions · ⏱ ${q.timeLimitMin} min · 4 options each</p>
      <a class="btn primary sm" href="#/quiz/${esc(q.id)}">Start quiz →</a>
    </article>`).join('') || empty('❓', 'No quizzes yet', 'Check back soon.')}
  </div>`;
}

async function pageQuiz(main, ctx) {
  const id = ctx.args[0];
  const quiz = await api('/quizzes/' + id);
  const n = quiz.questions.length;
  const st = { i: 0, answers: Array(n).fill(null), left: quiz.timeLimitMin * 60, done: false };

  main.innerHTML = `
  <div class="quiz-wrap fade-in">
    <div class="quiz-head">
      <div>
        <a href="#/quizzes" class="muted small">← All quizzes</a>
        <h1>${esc(quiz.title)}</h1>
        <p class="muted small">${esc(quiz.subject)} · ${esc(quiz.classLevel)} · ${n} questions</p>
      </div>
      <div class="timer" id="timer" aria-live="off">--:--</div>
    </div>
    <div class="progress"><div id="qbar" style="width:0"></div></div>
    <div class="card quiz-card" id="qcard"></div>
    <div class="quiz-nav">
      <button class="btn ghost" id="prev">← Previous</button>
      <button class="btn ghost" id="next">Next →</button>
      <button class="btn primary" id="submit">Submit quiz</button>
    </div>
    <div class="palette" id="palette" aria-label="Question navigator"></div>
  </div>`;

  const draw = () => {
    const q = quiz.questions[st.i];
    $('#qcard').innerHTML = `
      <p class="muted small">Question ${st.i + 1} of ${n}</p>
      <h2 class="qtext">${esc(q.q)}</h2>
      <div class="options">${q.options.map((o, k) => `
        <button class="opt ${st.answers[st.i] === k ? 'selected' : ''}" data-opt="${k}">
          <span class="opt-letter">${'ABCD'[k]}</span><span>${esc(o)}</span>
        </button>`).join('')}
      </div>`;
    $('#qbar').style.width = ((st.i + 1) / n * 100) + '%';
    $('#palette').innerHTML = quiz.questions.map((_, k) =>
      `<button class="pal ${k === st.i ? 'current' : ''} ${st.answers[k] !== null ? 'answered' : ''}" data-go="${k}" aria-label="Question ${k + 1}">${k + 1}</button>`).join('');
    $('#prev').disabled = st.i === 0;
    $('#next').disabled = st.i === n - 1;
  };
  const show = () => {
    const t = $('#timer');
    if (!t) return;
    t.textContent = fmtTime(Math.max(0, st.left));
    t.classList.toggle('danger', st.left < 60);
  };

  const finish = async auto => {
    if (st.done) return;
    st.done = true;
    clearTimers();
    try {
      const r = await api(`/quizzes/${id}/submit`, {
        method: 'POST',
        body: { answers: st.answers, timeUsedSec: quiz.timeLimitMin * 60 - Math.max(0, st.left) }
      });
      main.onclick = e => { if (e.target.closest('[data-retry]')) route(); };
      main.innerHTML = renderResult(quiz, r, auto);
      state.data = null;
    } catch (err) {
      st.done = false;
      toast(err.message, 'err');
    }
  };

  main.onclick = e => {
    if (st.done) return;
    const opt = e.target.closest('[data-opt]');
    if (opt) { st.answers[st.i] = Number(opt.dataset.opt); return draw(); }
    const go2 = e.target.closest('[data-go]');
    if (go2) { st.i = Number(go2.dataset.go); return draw(); }
    if (e.target.closest('#prev') && st.i > 0) { st.i--; return draw(); }
    if (e.target.closest('#next') && st.i < n - 1) { st.i++; return draw(); }
    if (e.target.closest('#submit')) {
      const unanswered = st.answers.filter(a => a === null).length;
      if (unanswered && !confirm(`${unanswered} question(s) are unanswered. Submit anyway?`)) return;
      finish(false);
    }
  };

  draw();
  show();
  state.timers.push(setInterval(() => {
    if (st.done) return;
    st.left--;
    show();
    if (st.left <= 0) finish(true);
  }, 1000));
}

function renderResult(quiz, r, auto) {
  const perf = r.percent >= 90 ? '🌟 Outstanding: you have a strong command of this topic.'
    : r.percent >= 75 ? '🎉 Excellent work! Keep it up.'
    : r.percent >= 60 ? '👍 Good effort. Review the questions you missed.'
    : r.percent >= 40 ? '📘 Needs practice. Revise the notes and try again.'
    : '💪 Don\'t give up. Revise and retry.';
  return `
  <div class="quiz-wrap fade-in">
    ${auto ? `<div class="notice">⏰ Time is up. Your answers were submitted automatically.</div>` : ''}
    <div class="card result">
      <div class="score-ring" style="--p:${r.percent}"><span>${r.percent}%</span></div>
      <div>
        <h1>${esc(quiz.title)}: Result</h1>
        <p class="big-text"><b>${r.score} / ${r.total}</b> correct · <b>${esc(r.grade)}</b></p>
        <p>${perf}</p>
        <div class="stat-row">
          <div><b>${r.score}</b><span>Correct</span></div>
          <div><b>${r.total - r.score}</b><span>Incorrect</span></div>
          <div><b>${fmtTime(r.timeUsedSec || 0)}</b><span>Time used</span></div>
        </div>
        <div class="row gap" style="margin-top:16px">
          <button class="btn primary" data-retry>↻ Retry quiz</button>
          <a class="btn ghost" href="#/quizzes">All quizzes</a>
          <a class="btn ghost" href="#/dashboard">Performance report</a>
        </div>
      </div>
    </div>
    <h2>Answer review</h2>
    <div class="review">
      ${r.review.map((x, i) => `
        <div class="card review-item ${x.correct ? 'ok' : 'bad'}">
          <p><b>Q${i + 1}.</b> ${esc(x.q)}</p>
          <ul class="review-opts">
            ${x.options.map((o, k) => `<li class="${k === x.answer ? 'right' : ''} ${k === x.picked && !x.correct ? 'wrong' : ''}">${'ABCD'[k]}. ${esc(o)}${k === x.answer ? ' ✓' : ''}${k === x.picked && !x.correct ? ' ✗' : ''}</li>`).join('')}
          </ul>
          <p class="small muted">${x.picked === null ? 'Not answered' : x.correct ? 'Correct' : 'Incorrect'}</p>
        </div>`).join('')}
    </div>
  </div>`;
}

/* ================= LEARN ================= */
async function pageLearn(main) {
  const { courses } = await api('/courses');
  state.courses = courses;
  await getData();
  const cats = ['All', ...new Set(courses.map(c => c.category))];
  const byId = Object.fromEntries(courses.map(c => [c.id, c]));
  let active = 'All';
  const prog = () => (state.data && state.data.progress) || {};
  const marks = () => (state.data && state.data.bookmarks) || [];

  main.innerHTML = `
  <div class="page-head fade-in"><div><h1>Online learning</h1><p class="muted">Video lessons, course categories and your personal learning progress.</p></div></div>
  ${state.user ? '' : `<div class="notice">🔐 <a href="#/login">Log in</a> to track progress, bookmark lessons and see recently viewed topics.</div>`}
  <div class="card fade-in">
    <div class="row between"><b>Overall learning progress</b><span id="overall" class="muted">0%</span></div>
    <div class="progress"><div id="overall-bar" style="width:0"></div></div>
  </div>
  <div class="chips">${cats.map(c => `<button class="chip-btn ${c === active ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
  <div class="grid cards-3" id="course-grid"></div>
  <div class="two-col">
    <div><h2>Bookmarked lessons</h2><div class="list" id="bm"></div></div>
    <div><h2>Recently viewed</h2><div class="list" id="recent"></div></div>
  </div>`;

  const drawGrid = () => {
    const list = active === 'All' ? courses : courses.filter(c => c.category === active);
    const pr = prog(), mk = marks();
    $('#course-grid').innerHTML = list.map(c => `
      <article class="card course fade-in">
        <div class="card-top"><span class="chip">${esc(c.category)}</span>
          <button class="icon-btn ${mk.includes(c.id) ? 'on' : ''}" data-bm="${esc(c.id)}" aria-label="Bookmark ${esc(c.title)}" title="Bookmark">${mk.includes(c.id) ? '★' : '☆'}</button>
        </div>
        <h3>${esc(c.title)}</h3>
        <p class="muted small">${esc(c.description)}</p>
        <p class="small">${esc(c.instructor)} · ⏱ ${esc(c.duration)}</p>
        <label class="small">Your progress: <b>${pr[c.id] || 0}%</b>
          <input type="range" min="0" max="100" step="5" value="${pr[c.id] || 0}" data-progress="${esc(c.id)}" aria-label="Progress for ${esc(c.title)}">
        </label>
        <a class="btn primary sm" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" data-open="${esc(c.id)}">▶ Open lesson</a>
      </article>`).join('') || empty('🎥', 'No lessons in this category');
  };
  const drawSide = () => {
    const d = state.data || {};
    const bms = (d.bookmarks || []).map(id => byId[id]).filter(Boolean);
    $('#bm').innerHTML = bms.length
      ? bms.map(c => `<div class="list-item"><span>★ ${esc(c.title)}</span><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Open</a></div>`).join('')
      : `<p class="muted small">${state.user ? 'No bookmarks yet. Tap ☆ on a lesson to save it.' : 'Log in to bookmark lessons.'}</p>`;
    const rec = (d.recentLessons || []).map(x => byId[x.id]).filter(Boolean);
    $('#recent').innerHTML = rec.length
      ? rec.map(c => `<div class="list-item"><span>${esc(c.title)}</span><span class="muted tiny">${esc(c.category)}</span></div>`).join('')
      : `<p class="muted small">Lessons you open will appear here.</p>`;
  };
  const drawOverall = () => {
    const pr = prog();
    const avg = courses.length ? Math.round(courses.reduce((s, c) => s + (pr[c.id] || 0), 0) / courses.length) : 0;
    $('#overall').textContent = avg + '%';
    $('#overall-bar').style.width = avg + '%';
  };
  const drawAll = () => { drawGrid(); drawSide(); drawOverall(); };

  main.onclick = async e => {
    const cat = e.target.closest('[data-cat]');
    if (cat) {
      active = cat.dataset.cat;
      $$('[data-cat]', main).forEach(b => b.classList.toggle('on', b === cat));
      return drawGrid();
    }
    const bm = e.target.closest('[data-bm]');
    if (bm) {
      if (!state.user) return toast('Please log in to bookmark lessons.', 'err');
      const id = bm.dataset.bm;
      const cur = marks();
      try {
        await saveData({ bookmarks: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] });
        drawAll();
      } catch (err) { toast(err.message, 'err'); }
    }
  };
  main.onchange = async e => {
    const r = e.target.closest('[data-progress]');
    if (!r) return;
    if (!state.user) return toast('Please log in to save your progress.', 'err');
    try {
      await saveData({ progress: { ...prog(), [r.dataset.progress]: Number(r.value) } });
      drawAll();
    } catch (err) { toast(err.message, 'err'); }
  };
  drawAll();
}

/* ================= ASSIGNMENTS ================= */
async function pageAssignments(main) {
  const d = await getData();
  const today = todayKey();
  let items = d.assignments || [];
  let filter = 'pending';
  let editId = null;

  main.innerHTML = `
  <div class="page-head fade-in"><div><h1>Assignment manager</h1><p class="muted">Create tasks, set deadlines and track what is pending or done.</p></div></div>
  <div class="two-col wide-left">
    <form class="card form fade-in" id="a-form" novalidate>
      <h2 id="a-title">New assignment</h2>
      <label>Title <input name="title" required maxlength="120" placeholder="e.g. Biology lab report"></label>
      <div class="form-row">
        <label>Subject <select name="subject"><option value="">General</option>${opts(state.meta.subjects)}</select></label>
        <label>Deadline <input type="date" name="deadline"></label>
      </div>
      <label>Description <textarea name="description" rows="3" maxlength="1000" placeholder="Details, pages, questions…"></textarea></label>
      <p class="error" id="a-err"></p>
      <div class="row gap">
        <button class="btn primary" type="submit" id="a-save">Add assignment</button>
        <button class="btn ghost" type="button" id="a-cancel" hidden>Cancel</button>
      </div>
    </form>
    <div>
      <div class="tabs">
        <button class="tab on" data-f="pending">Pending <span id="c-pend"></span></button>
        <button class="tab" data-f="completed">Completed <span id="c-done"></span></button>
      </div>
      <div class="list" id="a-list"></div>
    </div>
  </div>`;

  const form = $('#a-form');
  const draw = () => {
    const pend = items.filter(a => !a.completed), done = items.filter(a => a.completed);
    $('#c-pend').textContent = `(${pend.length})`;
    $('#c-done').textContent = `(${done.length})`;
    const shown = filter === 'pending' ? pend : done;
    $('#a-list').innerHTML = shown.length ? shown.map(a => {
      const late = !a.completed && a.deadline && a.deadline < today;
      return `<div class="card task fade-in ${a.completed ? 'done' : ''}">
        <label class="check"><input type="checkbox" data-toggle="${esc(a.id)}" ${a.completed ? 'checked' : ''} aria-label="Mark complete"></label>
        <div class="task-body">
          <b>${esc(a.title)}</b>
          <div class="row gap small muted">
            ${a.subject ? `<span class="chip small">${esc(a.subject)}</span>` : ''}
            ${a.deadline ? `<span class="${late ? 'late' : ''}">📅 ${esc(a.deadline)}${late ? ' · overdue' : ''}</span>` : '<span>No deadline</span>'}
          </div>
          ${a.description ? `<p class="small">${esc(a.description)}</p>` : ''}
        </div>
        <div class="task-actions">
          <button class="icon-btn sm" data-edit="${esc(a.id)}" aria-label="Edit">✏️</button>
          <button class="icon-btn sm" data-del="${esc(a.id)}" aria-label="Delete">🗑️</button>
        </div>
      </div>`;
    }).join('') : empty(filter === 'pending' ? '🎉' : '📭', filter === 'pending' ? 'All caught up!' : 'Nothing completed yet');
  };
  const resetForm = () => {
    form.reset();
    editId = null;
    $('#a-title').textContent = 'New assignment';
    $('#a-save').textContent = 'Add assignment';
    $('#a-cancel').hidden = true;
    $('#a-err').textContent = '';
  };

  main.onclick = async e => {
    const tab = e.target.closest('[data-f]');
    if (tab) {
      filter = tab.dataset.f;
      $$('.tab', main).forEach(t => t.classList.toggle('on', t === tab));
      return draw();
    }
    if (e.target.closest('#a-cancel')) return resetForm();
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const a = items.find(x => x.id === ed.dataset.edit);
      editId = a.id;
      form.elements.title.value = a.title;
      form.elements.subject.value = a.subject || '';
      form.elements.deadline.value = a.deadline || '';
      form.elements.description.value = a.description || '';
      $('#a-title').textContent = 'Edit assignment';
      $('#a-save').textContent = 'Save changes';
      $('#a-cancel').hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return form.elements.title.focus();
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!confirm('Delete this assignment?')) return;
      try {
        await api('/assignments/' + del.dataset.del, { method: 'DELETE' });
        items = items.filter(x => x.id !== del.dataset.del);
        if (editId === del.dataset.del) resetForm();
        draw();
        toast('Assignment deleted.');
      } catch (err) { toast(err.message, 'err'); }
    }
  };

  main.onchange = async e => {
    const cb = e.target.closest('[data-toggle]');
    if (!cb) return;
    try {
      const { assignment } = await api('/assignments/' + cb.dataset.toggle, { method: 'PUT', body: { completed: cb.checked } });
      items = items.map(x => (x.id === assignment.id ? assignment : x));
      state.data = null;
      draw();
    } catch (err) { toast(err.message, 'err'); cb.checked = !cb.checked; }
  };

  main.onsubmit = async e => {
    if (e.target !== form) return;
    e.preventDefault();
    const err = $('#a-err');
    err.textContent = '';
    const body = Object.fromEntries(new FormData(form));
    if (body.title.trim().length < 2) { err.textContent = 'Please enter a title (at least 2 characters).'; return; }
    try {
      if (editId) {
        const { assignment } = await api('/assignments/' + editId, { method: 'PUT', body });
        items = items.map(x => (x.id === editId ? assignment : x));
        toast('Assignment updated.');
      } else {
        const { assignment } = await api('/assignments', { method: 'POST', body });
        items = [assignment, ...items];
        toast('Assignment added.');
      }
      state.data = null;
      resetForm();
      draw();
    } catch (ex) { err.textContent = ex.message; }
  };

  draw();
}

/* ================= TOOLS ================= */
const TOOL_RUN = {
  calc: toolCalc, pct: toolPct, gpa: toolGpa, pomo: toolPomo, exam: toolExam,
  todo: toolTodo, notes: toolNotes, timetable: toolTimetable, planner: toolPlanner
};

async function pageTools(main, route) {
  const tab = TOOL_RUN[route.args[0]] ? route.args[0] : 'calc';
  main.innerHTML = `
  <div class="page-head fade-in"><div><h1>Student tools</h1><p class="muted">Calculators, timers, planners and organisers to help you study smarter.</p></div></div>
  <nav class="tool-tabs">${TOOLS.map(([k, l]) => `<a href="#/tools/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
  <div class="card tool fade-in" id="tool"></div>`;
  await TOOL_RUN[tab]($('#tool'));
}

/* Scientific calculator */
const FN_NAMES = ['sin', 'cos', 'tan', 'sqrt', 'log', 'ln', 'pi'];
function evaluateExpr(raw) {
  let s = raw.replace(/×/g, '*').replace(/÷/g, '/').replace(/π/g, 'pi').replace(/\^/g, '**').replace(/√/g, 'sqrt');
  s = s.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
  if (!/^[0-9A-Za-z+\-*/().\s]*$/.test(s)) throw new Error('Invalid input');
  if ((s.match(/[A-Za-z]+/g) || []).some(w => !FN_NAMES.includes(w))) throw new Error('Unknown function');
  const fns = {
    sin: x => Math.sin(x * Math.PI / 180), cos: x => Math.cos(x * Math.PI / 180), tan: x => Math.tan(x * Math.PI / 180),
    sqrt: Math.sqrt, log: Math.log10, ln: Math.log, pi: Math.PI
  };
  const names = Object.keys(fns);
  const v = new Function(...names, `return (${s});`)(...names.map(n => fns[n]));
  if (typeof v !== 'number' || !isFinite(v)) throw new Error('Result is not a number');
  return +v.toPrecision(12);
}
function toolCalc(box) {
  const KEYS = ['sin(', 'cos(', 'tan(', '√(', 'ln(', 'log(', 'π', '^', '(', ')', 'C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '='];
  let expr = '', res = '0';
  box.innerHTML = `<h2>Scientific calculator</h2>
    <div class="calc">
      <div class="calc-display"><div class="calc-expr" id="cexpr"></div><div class="calc-res" id="cres">0</div></div>
      <div class="calc-keys">${KEYS.map(k => {
        const cls = k === '=' ? 'key eq' : /^[0-9.]$/.test(k) ? 'key' : 'key op';
        return `<button class="${cls}" data-k="${esc(k)}">${esc(k)}</button>`;
      }).join('')}</div>
    </div>
    <p class="muted tiny center" style="margin-top:10px">Trig functions use degrees. Use ^ for powers and % for percentages.</p>`;
  const paint = () => { $('#cexpr').textContent = expr; $('#cres').textContent = res; };
  box.onclick = e => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'C') { expr = ''; res = '0'; }
    else if (k === '⌫') expr = expr.slice(0, -1);
    else if (k === '=') {
      try { res = String(evaluateExpr(expr || '0')); expr = res; }
      catch { res = 'Error'; }
    } else expr += k;
    paint();
  };
}

/* Percentage */
function toolPct(box) {
  box.innerHTML = `<h2>Percentage calculator</h2>
    <div class="form-row">
      <label>Mode <select id="pm">
        <option value="of">X% of Y</option>
        <option value="is">X is what % of Y</option>
        <option value="chg">% change from X to Y</option>
      </select></label>
    </div>
    <div class="form-row">
      <label>X <input id="px" type="number" step="any"></label>
      <label>Y <input id="py" type="number" step="any"></label>
    </div>
    <button class="btn primary" id="pgo">Calculate</button>
    <p class="result-line" id="pres"></p>`;
  box.onclick = e => {
    if (!e.target.closest('#pgo')) return;
    const m = $('#pm').value, x = parseFloat($('#px').value), y = parseFloat($('#py').value);
    if (isNaN(x) || isNaN(y)) return toast('Please enter both numbers.', 'err');
    let out;
    if (m === 'of') out = `${x}% of ${y} = ${round2(x / 100 * y)}`;
    else if (m === 'is') out = y === 0 ? 'Y cannot be zero.' : `${x} is ${round2(x / y * 100)}% of ${y}`;
    else out = x === 0 ? 'X cannot be zero.' : `Change: ${round2((y - x) / x * 100)}% (${y > x ? 'increase' : 'decrease'})`;
    $('#pres').textContent = out;
  };
}

/* GPA */
const GRADES = { 'A': 4, 'A-': 3.7, 'B+': 3.3, 'B': 3, 'B-': 2.7, 'C+': 2.3, 'C': 2, 'C-': 1.7, 'D+': 1.3, 'D': 1, 'F': 0 };
function toolGpa(box) {
  let rows = [{ s: 'Mathematics', g: 'A', c: 4 }, { s: 'Physics', g: 'B+', c: 3 }, { s: 'English', g: 'B', c: 3 }];
  const totalCr = () => rows.reduce((s, r) => s + (Number(r.c) || 0), 0);
  const gpa = () => {
    const c = totalCr();
    return c ? rows.reduce((s, r) => s + GRADES[r.g] * (Number(r.c) || 0), 0) / c : 0;
  };
  const update = () => {
    const g = $('#gpa');
    if (!g) return;
    g.textContent = gpa().toFixed(2);
    $('#gcr').textContent = totalCr();
  };
  const draw = () => {
    box.innerHTML = `<h2>GPA calculator</h2>
      <p class="muted small">Standard 4.0 scale. Enter each course with its grade and credit hours.</p>
      <div class="gpa-rows">${rows.map((r, i) => `
        <div class="gpa-row">
          <input placeholder="Subject" value="${esc(r.s)}" data-i="${i}" data-f="s" aria-label="Subject">
          <select data-i="${i}" data-f="g" aria-label="Grade">${Object.keys(GRADES).map(k => `<option ${k === r.g ? 'selected' : ''}>${k}</option>`).join('')}</select>
          <input type="number" min="1" max="10" step="1" value="${esc(r.c)}" data-i="${i}" data-f="c" aria-label="Credit hours">
          <button class="icon-btn sm" data-rm="${i}" aria-label="Remove course">✕</button>
        </div>`).join('')}
      </div>
      <div class="row gap" style="margin-top:12px"><button class="btn ghost sm" id="gadd">+ Add course</button></div>
      <div class="stat-row"><div><b id="gpa">0.00</b><span>GPA</span></div><div><b id="gcr">0</b><span>Credit hours</span></div></div>`;
    update();
  };
  box.oninput = e => {
    const f = e.target.dataset.f;
    if (!f || f === 'g') return;
    rows[Number(e.target.dataset.i)][f] = e.target.value;
    update();
  };
  box.onchange = e => {
    if (e.target.dataset.f === 'g') { rows[Number(e.target.dataset.i)].g = e.target.value; update(); }
  };
  box.onclick = e => {
    if (e.target.closest('#gadd')) { rows.push({ s: '', g: 'A', c: 3 }); return draw(); }
    const rm = e.target.closest('[data-rm]');
    if (rm) { rows.splice(Number(rm.dataset.rm), 1); draw(); }
  };
  draw();
}

/* Pomodoro */
function toolPomo(box) {
  const FOCUS = 25 * 60, BREAK = 5 * 60;
  let mode = 'focus', left = FOCUS, running = false, cycles = 0, iv = null;
  box.innerHTML = `<h2>Pomodoro study timer</h2>
    <p class="muted small">25 minutes of focus, then a 5-minute break. Completed focus sessions are logged to your study planner.</p>
    <div class="pomo">
      <div class="pomo-ring" id="pring"><div class="inner"><div><span id="pt">25:00</span><small id="pmode">Focus</small></div></div></div>
    </div>
    <div class="row gap center">
      <button class="btn primary" id="pstart">▶ Start</button>
      <button class="btn ghost" id="preset">↺ Reset</button>
      <button class="btn ghost" id="pskip">Skip phase</button>
    </div>
    <p class="muted small center" style="margin-top:14px">Focus sessions completed this visit: <b id="pcyc">0</b></p>`;
  const paint = () => {
    const total = mode === 'focus' ? FOCUS : BREAK;
    $('#pt').textContent = fmtTime(left);
    $('#pmode').textContent = mode === 'focus' ? 'Focus' : 'Break';
    $('#pring').style.setProperty('--p', ((total - left) / total * 100).toFixed(2));
    $('#pstart').textContent = running ? '❚❚ Pause' : '▶ Start';
  };
  const stop = () => { clearInterval(iv); iv = null; running = false; };
  const switchPhase = () => { mode = mode === 'focus' ? 'break' : 'focus'; left = mode === 'focus' ? FOCUS : BREAK; };
  const finishPhase = async () => {
    stop();
    if (mode === 'focus') {
      cycles++;
      $('#pcyc').textContent = cycles;
      toast('🎉 Focus session complete. Take a break!');
      if (state.user) {
        try {
          const d = await getData();
          const k = todayKey();
          await saveData({ studyLog: { ...d.studyLog, [k]: (d.studyLog[k] || 0) + 25 } });
        } catch { /* logging is best-effort */ }
      }
    } else toast('Break is over. Back to focus!');
    switchPhase();
    paint();
  };
  const tick = () => {
    left--;
    if (left <= 0) { left = 0; paint(); return finishPhase(); }
    paint();
  };
  box.onclick = e => {
    if (e.target.closest('#pstart')) {
      if (running) stop();
      else { running = true; iv = setInterval(tick, 1000); state.timers.push(iv); }
      return paint();
    }
    if (e.target.closest('#preset')) { stop(); mode = 'focus'; left = FOCUS; return paint(); }
    if (e.target.closest('#pskip')) { stop(); switchPhase(); return paint(); }
  };
  paint();
}

/* Exam countdown */
async function toolExam(box) {
  const d = await getData();
  let exams = (d && d.examDates) || [];
  const daysUntil = date => Math.ceil((new Date(date + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
  const draw = () => {
    const sorted = [...exams].sort((a, b) => a.date.localeCompare(b.date));
    box.innerHTML = `<h2>Countdown to exams</h2>
      ${state.user ? '' : '<p class="notice">Log in to save your exam dates.</p>'}
      <form class="form-row" id="ex-form">
        <input name="name" placeholder="Exam name, e.g. Physics mid-term" required maxlength="80">
        <input type="date" name="date" required>
        <button class="btn primary" type="submit">Add exam</button>
      </form>
      <div class="list" style="margin-top:16px">${sorted.length ? sorted.map(x => {
        const days = daysUntil(x.date);
        return `<div class="list-item">
          <div><b>${esc(x.name)}</b><div class="muted small">${esc(x.date)}</div></div>
          <div class="countdown">${days > 0 ? `<b>${days}</b> day${days === 1 ? '' : 's'} left` : days === 0 ? 'Today!' : 'Done ✔'}</div>
          <button class="icon-btn sm" data-xdel="${esc(x.id)}" aria-label="Remove exam">🗑️</button>
        </div>`;
      }).join('') : empty('⏳', 'No exams added yet')}</div>`;
  };
  draw();
  box.onsubmit = async e => {
    if (e.target.id !== 'ex-form') return;
    e.preventDefault();
    if (!state.user) return toast('Please log in to save exam dates.', 'err');
    const f = e.target.elements;
    exams = [...exams, { id: rid(), name: f.name.value.trim(), date: f.date.value }];
    try { await saveData({ examDates: exams }); draw(); toast('Exam added.'); }
    catch (err) { toast(err.message, 'err'); }
  };
  box.onclick = async e => {
    const del = e.target.closest('[data-xdel]');
    if (!del) return;
    exams = exams.filter(x => x.id !== del.dataset.xdel);
    try { await saveData({ examDates: exams }); draw(); }
    catch (err) { toast(err.message, 'err'); }
  };
}

/* To-do list */
async function toolTodo(box) {
  const d = await getData();
  let items = (d && d.todos) || [];
  const persist = async () => { try { await saveData({ todos: items }); } catch (err) { toast(err.message, 'err'); } };
  const draw = () => {
    box.innerHTML = `<h2>To-do list</h2>
      ${state.user ? '' : '<p class="notice">Log in to keep your to-do list saved.</p>'}
      <form class="form-row" id="td-form"><input name="t" placeholder="Add a task…" maxlength="160" required><button class="btn primary" type="submit">Add</button></form>
      <div class="list" style="margin-top:16px">${items.length ? items.map(t => `
        <div class="list-item todo ${t.done ? 'done' : ''}">
          <span><input type="checkbox" data-done="${esc(t.id)}" ${t.done ? 'checked' : ''} aria-label="Done"> ${esc(t.text)}</span>
          <button class="icon-btn sm" data-tdel="${esc(t.id)}" aria-label="Delete task">🗑️</button>
        </div>`).join('') : empty('🗒️', 'Nothing to do. Add a task above.')}</div>`;
  };
  draw();
  box.onsubmit = async e => {
    if (e.target.id !== 'td-form') return;
    e.preventDefault();
    if (!state.user) return toast('Please log in to save tasks.', 'err');
    const text = e.target.elements.t.value.trim();
    if (!text) return;
    items = [...items, { id: rid(), text, done: false }];
    await persist(); draw();
  };
  box.onchange = async e => {
    const cb = e.target.closest('[data-done]');
    if (!cb) return;
    items = items.map(t => (t.id === cb.dataset.done ? { ...t, done: cb.checked } : t));
    await persist(); draw();
  };
  box.onclick = async e => {
    const del = e.target.closest('[data-tdel]');
    if (!del) return;
    items = items.filter(t => t.id !== del.dataset.tdel);
    await persist(); draw();
  };
}

/* Notes */
async function toolNotes(box) {
  const d = await getData();
  box.innerHTML = `<h2>Notes</h2>
    <p class="muted small">Jot down key points, formulas and reminders.</p>
    <textarea id="nt" rows="14" maxlength="20000" placeholder="Start typing your notes…"></textarea>
    <div class="row between" style="margin-top:10px">
      <span class="muted small">${state.user ? 'Saved to your account when you press Save.' : 'Log in to save your notes.'}</span>
      <button class="btn primary sm" id="nsave">Save notes</button>
    </div>`;
  $('#nt').value = (d && d.notes) || '';
  box.onclick = async e => {
    if (!e.target.closest('#nsave')) return;
    if (!state.user) return toast('Please log in to save notes.', 'err');
    try { await saveData({ notes: $('#nt').value }); toast('Notes saved ✔'); }
    catch (err) { toast(err.message, 'err'); }
  };
}

/* Digital timetable */
async function toolTimetable(box) {
  const d = await getData();
  let items = (d && d.timetable) || [];
  const draw = () => {
    box.innerHTML = `<h2>Digital timetable</h2>
      ${state.user ? '' : '<p class="notice">Log in to save your timetable.</p>'}
      <form class="form-row wrap-row" id="tt-form">
        <select name="day" aria-label="Day">${DAYS.map(x => `<option>${x}</option>`).join('')}</select>
        <input type="time" name="start" required aria-label="Start time">
        <input type="time" name="end" required aria-label="End time">
        <input name="subject" placeholder="Subject or activity" required maxlength="60">
        <button class="btn primary" type="submit">Add</button>
      </form>
      <div class="tt-grid">${DAYS.map(day => {
        const rows = items.filter(i => i.day === day).sort((a, b) => a.start.localeCompare(b.start));
        return `<div class="tt-day"><h3>${day}</h3>${rows.length ? rows.map(r => `
          <div class="tt-slot"><span>${esc(r.start)}–${esc(r.end)}</span><b>${esc(r.subject)}</b>
          <button class="icon-btn sm" data-ttdel="${esc(r.id)}" aria-label="Remove">✕</button></div>`).join('') : '<p class="muted small">Free day</p>'}
        </div>`;
      }).join('')}</div>`;
  };
  draw();
  box.onsubmit = async e => {
    if (e.target.id !== 'tt-form') return;
    e.preventDefault();
    if (!state.user) return toast('Please log in to save your timetable.', 'err');
    const f = e.target.elements;
    if (f.start.value >= f.end.value) return toast('End time must be after start time.', 'err');
    items = [...items, { id: rid(), day: f.day.value, start: f.start.value, end: f.end.value, subject: f.subject.value.trim() }];
    try { await saveData({ timetable: items }); draw(); }
    catch (err) { toast(err.message, 'err'); }
  };
  box.onclick = async e => {
    const del = e.target.closest('[data-ttdel]');
    if (!del) return;
    items = items.filter(i => i.id !== del.dataset.ttdel);
    try { await saveData({ timetable: items }); draw(); }
    catch (err) { toast(err.message, 'err'); }
  };
}

/* Study planner */
async function toolPlanner(box) {
  const d = await getData();
  const goal = (d && d.dailyGoal) || 60;
  const log = (d && d.studyLog) || {};
  const days = [...Array(7)].map((_, i) => {
    const dt = new Date();
    dt.setDate(dt.getDate() - (6 - i));
    const k = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    return { k, label: dt.toLocaleDateString(undefined, { weekday: 'short' }), min: log[k] || 0 };
  });
  const today = days[6];
  const pct = Math.min(100, Math.round(today.min / goal * 100));
  box.innerHTML = `<h2>Study planner</h2>
    ${state.user ? '' : '<p class="notice">Log in to track your study time.</p>'}
    <div class="planner-today">
      <div><b>${today.min} / ${goal} min</b> <span class="muted small">studied today</span></div>
      <div class="progress"><div style="width:${pct}%"></div></div>
    </div>
    <div class="two-col" style="margin-top:0">
      <form class="form-row" id="goal-form">
        <label>Daily goal (minutes) <input type="number" name="goal" min="10" max="600" value="${goal}"></label>
        <button class="btn ghost" type="submit">Update goal</button>
      </form>
      <form class="form-row" id="log-form">
        <label>Log study time (minutes) <input type="number" name="min" min="1" max="600" required></label>
        <button class="btn primary" type="submit">Log time</button>
      </form>
    </div>
    <h3 style="margin-top:20px">Last 7 days</h3>
    <div class="bars">${days.map(x => `<div class="bar-col">
      <small>${x.min}m</small>
      <div class="bar" style="height:${Math.max(4, Math.min(100, x.min / Math.max(goal, 1) * 100))}%"></div>
      <span>${esc(x.label)}</span></div>`).join('')}</div>`;

  box.onsubmit = async e => {
    e.preventDefault();
    if (!state.user) return toast('Please log in to save your study data.', 'err');
    try {
      if (e.target.id === 'goal-form') {
        const g = Number(e.target.elements.goal.value);
        if (!(g >= 10 && g <= 600)) return toast('Goal must be between 10 and 600 minutes.', 'err');
        await saveData({ dailyGoal: g });
      } else if (e.target.id === 'log-form') {
        const m = Number(e.target.elements.min.value);
        if (!(m >= 1 && m <= 600)) return toast('Enter between 1 and 600 minutes.', 'err');
        const cur = (await getData()).studyLog;
        const k = todayKey();
        await saveData({ studyLog: { ...cur, [k]: (cur[k] || 0) + m } });
      }
      toolPlanner(box);
    } catch (err) { toast(err.message, 'err'); }
  };
}

/* ================= DASHBOARD ================= */
async function pageDashboard(main) {
  const d = await getData();
  const u = state.user;
  if (!state.courses.length) state.courses = (await api('/courses')).courses;
  const byId = Object.fromEntries(state.courses.map(c => [c.id, c]));
  const k = todayKey();
  const todayMin = (d.studyLog || {})[k] || 0;
  const goal = d.dailyGoal || 60;
  const studyPct = Math.min(100, Math.round(todayMin / goal * 100));
  const assignments = d.assignments || [];
  const done = assignments.filter(a => a.completed).length;
  const pending = assignments.filter(a => !a.completed);
  const upcoming = pending.filter(a => a.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 4);
  const exams = (d.examDates || []).filter(e => e.date >= k).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  const results = d.quizResults || [];
  const avg = results.length ? Math.round(results.reduce((s, r) => s + r.percent, 0) / results.length) : 0;
  const todayName = DAYS[(new Date().getDay() + 6) % 7];
  const todays = (d.timetable || []).filter(t => t.day === todayName).sort((a, b) => a.start.localeCompare(b.start));
  const activity = [
    ...results.map(r => ({ t: r.date, icon: '❓', text: `Scored ${r.percent}% on “${r.title}”` })),
    ...(d.recentLessons || []).map(x => ({ t: new Date(x.at).toISOString(), icon: '🎥', text: `Opened “${(byId[x.id] || {}).title || 'a lesson'}”` })),
    ...assignments.map(a => ({ t: a.createdAt, icon: a.completed ? '✅' : '📝', text: `${a.completed ? 'Completed' : 'Added'} “${a.title}”` }))
  ].sort((a, b) => b.t.localeCompare(a.t)).slice(0, 6);

  main.innerHTML = `
  <div class="card dash-top fade-in">
    ${avatarHTML(u, 72)}
    <div>
      <h2>${esc(u.name)}</h2>
      <p class="muted small">${esc(u.className || '')} · Roll no. ${esc(u.rollNumber || '-')} · ID ${esc(u.studentId)}</p>
    </div>
    <a class="btn ghost sm" href="#/profile">Edit profile</a>
  </div>

  <div class="dash-cards">
    <div class="card fade-in"><span class="muted small">Daily study progress</span>
      <div class="ring" style="--p:${studyPct}"><span>${studyPct}%</span></div>
      <p class="small center">${todayMin} of ${goal} min today</p></div>
    <div class="card fade-in"><span class="muted small">Assignments</span>
      <b>${done} done · ${pending.length} pending</b>
      <div class="progress"><div style="width:${assignments.length ? Math.round(done / assignments.length * 100) : 0}%"></div></div>
      <a class="small" href="#/assignments">Manage assignments →</a></div>
    <div class="card fade-in"><span class="muted small">Attendance</span>
      <div class="ring" style="--p:${u.attendance || 0}"><span>${u.attendance || 0}%</span></div></div>
    <div class="card fade-in"><span class="muted small">Quiz average</span>
      <b>${results.length ? avg + '%' : 'No attempts yet'}</b>
      <p class="small muted">${results.length} attempt${results.length === 1 ? '' : 's'} recorded</p>
      <a class="small" href="#/quizzes">Take a quiz →</a></div>
  </div>

  <div class="two-col">
    <div class="card fade-in">
      <h2>Upcoming examinations</h2>
      <div class="list">${exams.length ? exams.map(x => {
        const days = Math.ceil((new Date(x.date + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
        return `<div class="list-item"><div><b>${esc(x.name)}</b><div class="muted small">${esc(x.date)}</div></div><span class="countdown">${days === 0 ? 'Today' : days + ' days'}</span></div>`;
      }).join('') : `<p class="muted small">No exams saved. Add them in <a href="#/tools/exam">Exam countdown</a>.</p>`}</div>
    </div>
    <div class="card fade-in">
      <h2>Today's timetable <span class="muted small">· ${todayName}</span></h2>
      <div class="list">${todays.length ? todays.map(t => `<div class="list-item"><span>${esc(t.start)}–${esc(t.end)}</span><b>${esc(t.subject)}</b></div>`).join('')
        : `<p class="muted small">Nothing scheduled. Build your week in <a href="#/tools/timetable">Timetable</a>.</p>`}</div>
    </div>
  </div>

  <div class="two-col">
    <div class="card fade-in">
      <h2>Pending assignments</h2>
      <div class="list">${upcoming.length ? upcoming.map(a => `<div class="list-item"><div><b>${esc(a.title)}</b><div class="muted small">${esc(a.subject || 'General')}</div></div><span class="small ${a.deadline < k ? 'late' : 'muted'}">${esc(a.deadline)}</span></div>`).join('')
        : `<p class="muted small">No pending deadlines. Nice work!</p>`}</div>
    </div>
    <div class="card fade-in">
      <h2>Recent activities</h2>
      <div class="list">${activity.length ? activity.map(a => `<div class="list-item"><span>${a.icon} ${esc(a.text)}</span><span class="muted tiny">${new Date(a.t).toLocaleDateString()}</span></div>`).join('')
        : `<p class="muted small">Your quiz results, lessons and assignments will appear here.</p>`}</div>
    </div>
  </div>`;
}

/* ================= PROFILE ================= */
async function pageProfile(main) {
  const u = state.user;
  let pendingPhoto = null;
  main.innerHTML = `
  <div class="page-head fade-in"><div><h1>My profile</h1><p class="muted">Keep your details up to date.</p></div></div>
  <div class="two-col">
    <form class="card form fade-in" id="pf-form" novalidate>
      <h2>Personal details</h2>
      <div class="row gap">
        <div id="pf-avatar">${avatarHTML(u, 88)}</div>
        <div>
          <label class="btn ghost sm file-btn">Change photo<input type="file" id="pf-photo" accept="image/png,image/jpeg,image/webp"></label>
          <p class="muted tiny">PNG, JPG or WEBP, under 350 KB.</p>
        </div>
      </div>
      <label>Full name <input name="name" value="${esc(u.name)}" required maxlength="80" autocomplete="name"></label>
      <div class="form-row">
        <label>Class <select name="className">${opts(state.meta.classes, u.className)}</select></label>
        <label>Roll number <input name="rollNumber" value="${esc(u.rollNumber)}" maxlength="20"></label>
      </div>
      <label>Phone (optional) <input name="phone" value="${esc(u.phone || '')}" maxlength="20" autocomplete="tel"></label>
      <p class="muted small">Email: ${esc(u.email)} · Student ID: <b>${esc(u.studentId)}</b></p>
      <p class="error" id="pf-err"></p>
      <button class="btn primary" type="submit">Save profile</button>
    </form>

    <div class="card form fade-in">
      <form id="pw-form" novalidate class="form">
        <h2>Change password</h2>
        <label>Current password <input type="password" name="currentPassword" required autocomplete="current-password"></label>
        <label>New password <input type="password" name="newPassword" required minlength="8" autocomplete="new-password"></label>
        <p class="muted tiny">At least 8 characters, with letters and numbers.</p>
        <p class="error" id="pw-err"></p>
        <button class="btn primary" type="submit">Update password</button>
      </form>
      <hr>
      <button class="btn danger" id="pf-logout" type="button">Log out of this device</button>
    </div>
  </div>`;

  main.onchange = async e => {
    if (e.target.id !== 'pf-photo') return;
    const file = e.target.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast('Please choose a PNG, JPG or WEBP image.', 'err');
    if (file.size > 350 * 1024) return toast('Image must be under 350 KB.', 'err');
    pendingPhoto = await readFile(file);
    $('#pf-avatar').innerHTML = `<img class="avatar-img" src="${esc(pendingPhoto)}" alt="New profile photo preview" width="88" height="88">`;
    toast('Photo selected. Press Save profile to apply it.');
  };

  main.onclick = e => { if (e.target.closest('#pf-logout')) logout(); };

  main.onsubmit = async e => {
    e.preventDefault();
    if (e.target.id === 'pf-form') {
      const f = e.target.elements;
      const body = { name: f.name.value.trim(), className: f.className.value, rollNumber: f.rollNumber.value.trim(), phone: f.phone.value.trim() };
      if (pendingPhoto) body.avatar = pendingPhoto;
      if (body.name.length < 2) return ($('#pf-err').textContent = 'Please enter your full name.');
      try {
        const r = await api('/profile', { method: 'PUT', body });
        state.user = r.user;
        renderChrome();
        toast('Profile updated ✔');
        route();
      } catch (err) { $('#pf-err').textContent = err.message; }
    }
    if (e.target.id === 'pw-form') {
      const f = e.target.elements;
      try {
        const r = await api('/profile/password', { method: 'POST', body: { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value } });
        toast(r.message);
        e.target.reset();
        $('#pw-err').textContent = '';
      } catch (err) { $('#pw-err').textContent = err.message; }
    }
  };
}

/* ================= AUTH PAGES ================= */
const authShell = inner => `<div class="auth fade-in"><div class="card auth-card">${inner}</div></div>`;

function pageLogin(main, route) {
  const target = '#/' + (route.params.get('next') || 'dashboard');
  main.innerHTML = authShell(`
    <h1>Welcome back 👋</h1>
    <p class="muted">Log in to open your dashboard, assignments and saved progress.</p>
    <form class="form" id="login-form" novalidate>
      <label>Email <input type="email" name="email" required autocomplete="email"></label>
      <label>Password <input type="password" name="password" required autocomplete="current-password"></label>
      <p class="error" id="l-err"></p>
      <button class="btn primary block" type="submit">Log in</button>
    </form>
    <p class="small center"><a href="#/forgot">Forgot password?</a></p>
    <p class="small center">New student? <a href="#/register">Create an account</a></p>`);

  main.onsubmit = async e => {
    if (e.target.id !== 'login-form') return;
    e.preventDefault();
    const f = e.target.elements;
    const email = f.email.value.trim(), password = f.password.value;
    if (!isEmail(email)) return ($('#l-err').textContent = 'Please enter a valid email address.');
    if (!password) return ($('#l-err').textContent = 'Please enter your password.');
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email, password } });
      state.user = r.user;
      state.data = null;
      renderChrome();
      toast(`Welcome, ${r.user.name.split(' ')[0]}!`);
      go(target);
    } catch (err) { $('#l-err').textContent = err.message; }
  };
}

function pageRegister(main) {
  main.innerHTML = authShell(`
    <h1>Create your account</h1>
    <p class="muted">Free access to notes, quizzes, lessons and study tools.</p>
    <form class="form" id="reg-form" novalidate>
      <label>Full name <input name="name" required maxlength="80" autocomplete="name"></label>
      <label>Email <input type="email" name="email" required autocomplete="email"></label>
      <div class="form-row">
        <label>Class <select name="className">${opts(state.meta.classes)}</select></label>
        <label>Roll number <input name="rollNumber" required maxlength="20"></label>
      </div>
      <label>Password <input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
      <label>Confirm password <input type="password" name="confirm" required autocomplete="new-password"></label>
      <p class="muted tiny">At least 8 characters, including a letter and a number.</p>
      <p class="error" id="r-err"></p>
      <button class="btn primary block" type="submit">Create account</button>
    </form>
    <p class="small center">Already registered? <a href="#/login">Log in</a></p>`);

  main.onsubmit = async e => {
    if (e.target.id !== 'reg-form') return;
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    const name = v.name.trim(), email = v.email.trim();
    const problem =
      name.length < 2 ? 'Please enter your full name.' :
      !isEmail(email) ? 'Please enter a valid email address.' :
      !v.rollNumber.trim() ? 'Please enter your roll number.' :
      !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(v.password) ? 'Password must be at least 8 characters and include a letter and a number.' :
      v.password !== v.confirm ? 'Passwords do not match.' : '';
    if (problem) return ($('#r-err').textContent = problem);
    try {
      const r = await api('/auth/register', { method: 'POST', body: { name, email, className: v.className, rollNumber: v.rollNumber.trim(), password: v.password } });
      state.user = r.user;
      state.data = null;
      renderChrome();
      toast('Account created. Welcome to Smart Student Hub!');
      go('#/dashboard');
    } catch (err) { $('#r-err').textContent = err.message; }
  };
}

function pageForgot(main) {
  main.innerHTML = authShell(`
    <h1>Reset your password</h1>
    <p class="muted">Enter the email on your account. We will create a reset link valid for 30 minutes.</p>
    <form class="form" id="fg-form" novalidate>
      <label>Email <input type="email" name="email" required autocomplete="email"></label>
      <p class="error" id="fg-err"></p>
      <button class="btn primary block" type="submit">Send reset link</button>
    </form>
    <div id="fg-out"></div>
    <p class="small center"><a href="#/login">← Back to login</a></p>`);

  main.onsubmit = async e => {
    if (e.target.id !== 'fg-form') return;
    e.preventDefault();
    const email = e.target.elements.email.value.trim();
    if (!isEmail(email)) return ($('#fg-err').textContent = 'Please enter a valid email address.');
    try {
      const r = await api('/auth/forgot', { method: 'POST', body: { email } });
      $('#fg-err').textContent = '';
      $('#fg-out').innerHTML = `<div class="notice">${esc(r.message)}</div>` +
        (r.devResetToken ? `<div class="notice dev">Development mode: no email is sent yet. <a href="#/reset?token=${esc(r.devResetToken)}">Open the reset page</a></div>` : '');
    } catch (err) { $('#fg-err').textContent = err.message; }
  };
}

function pageReset(main, route) {
  const token = route.params.get('token') || '';
  main.innerHTML = authShell(`
    <h1>Choose a new password</h1>
    ${token ? '' : '<div class="notice">This link is missing its token. Please request a new reset link.</div>'}
    <form class="form" id="rs-form" novalidate>
      <label>New password <input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
      <label>Confirm password <input type="password" name="confirm" required autocomplete="new-password"></label>
      <p class="error" id="rs-err"></p>
      <button class="btn primary block" type="submit" ${token ? '' : 'disabled'}>Update password</button>
    </form>
    <p class="small center"><a href="#/login">Back to login</a></p>`);

  main.onsubmit = async e => {
    if (e.target.id !== 'rs-form') return;
    e.preventDefault();
    const f = e.target.elements;
    if (f.password.value !== f.confirm.value) return ($('#rs-err').textContent = 'Passwords do not match.');
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(f.password.value)) return ($('#rs-err').textContent = 'Password must be at least 8 characters with a letter and a number.');
    try {
      const r = await api('/auth/reset', { method: 'POST', body: { token, password: f.password.value } });
      toast(r.message);
      go('#/login');
    } catch (err) { $('#rs-err').textContent = err.message; }
  };
}

/* ================= ADMIN ================= */
async function pageAdmin(main, route) {
  const tab = ADMIN_TABS.some(([k]) => k === route.args[0]) ? route.args[0] : 'overview';
  main.innerHTML = `
  <div class="page-head fade-in"><div><h1>Admin dashboard</h1><p class="muted">Manage content, quizzes, announcements and student accounts.</p></div></div>
  <nav class="tool-tabs">${ADMIN_TABS.map(([k, l]) => `<a href="#/admin/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
  <div id="adm"></div>`;
  await ADMIN_RUN[tab]($('#adm'));
}

const ADMIN_RUN = {
  overview: admOverview, materials: admMaterials, quizzes: admQuizzes, news: admNews,
  courses: admCourses, catalog: admCatalog, users: admUsers
};

async function admOverview(box) {
  const s = await api('/admin/stats');
  const cards = [['👩‍🎓', 'Students', s.students], ['📚', 'Materials', s.materials], ['❓', 'Quizzes', s.quizzes],
    ['📝', 'Quiz attempts', s.quizAttempts], ['📈', 'Average quiz score', s.avgQuizPercent + '%'], ['⬇️', 'PDF downloads', s.downloads]];
  box.innerHTML = `
    <div class="stats-grid">${cards.map(([i, l, v]) => `<div class="card stat fade-in"><span>${i}</span><b>${v}</b><small class="muted">${l}</small></div>`).join('')}</div>
    <h2>Materials by subject</h2>
    <div class="list">${s.bySubject.map(x => `<div class="list-item"><span>${esc(x.subject)}</span><span class="chip">${x.materials}</span></div>`).join('')}</div>`;
}

async function admMaterials(box) {
  const items = (await api('/materials')).materials;
  const typeOpts = Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  box.innerHTML = `
  <div class="two-col wide-left">
    <form class="card form" id="m-form" novalidate>
      <h2 id="m-title">Upload study material</h2>
      <label>Title <input name="title" required minlength="3" maxlength="150"></label>
      <div class="form-row">
        <label>Subject <select name="subject">${opts(state.meta.subjects)}</select></label>
        <label>Class <select name="classLevel">${opts(state.meta.classes)}</select></label>
      </div>
      <div class="form-row">
        <label>Type <select name="type">${typeOpts}</select></label>
        <label>PDF file <input type="file" id="m-file" accept="application/pdf"></label>
      </div>
      <label>Short description <input name="description" maxlength="500"></label>
      <label>Inline content: MCQs, questions and answers <textarea name="content" rows="6" maxlength="20000"></textarea></label>
      <p class="error" id="m-err"></p>
      <div class="row gap">
        <button class="btn primary" type="submit">Save material</button>
        <button class="btn ghost" type="button" id="m-cancel" hidden>Cancel edit</button>
      </div>
    </form>
    <div class="list">${items.map(m => `
      <div class="list-item">
        <div><b>${esc(m.title)}</b>
          <div class="muted tiny">${esc(m.subject)} · ${esc(m.classLevel)} · ${esc(TYPE_LABELS[m.type] || m.type)} · ⬇ ${m.downloads}${m.hasFile ? ' · 📎 PDF' : ''}</div></div>
        <div class="row gap">
          <button class="icon-btn sm" data-medit="${esc(m.id)}" aria-label="Edit">✏️</button>
          <button class="icon-btn sm" data-mdel="${esc(m.id)}" aria-label="Delete">🗑️</button>
        </div>
      </div>`).join('') || empty('📚', 'No materials yet')}</div>
  </div>`;

  let editId = null;
  const form = $('#m-form');
  box.onclick = async e => {
    const ed = e.target.closest('[data-medit]');
    if (ed) {
      try {
        const { material: m } = await api('/materials/' + ed.dataset.medit);
        editId = m.id;
        form.elements.title.value = m.title;
        form.elements.subject.value = m.subject;
        form.elements.classLevel.value = m.classLevel;
        form.elements.type.value = m.type;
        form.elements.description.value = m.description || '';
        form.elements.content.value = m.content || '';
        $('#m-title').textContent = 'Edit material';
        $('#m-cancel').hidden = false;
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) { toast(err.message, 'err'); }
      return;
    }
    if (e.target.closest('#m-cancel')) return admMaterials(box);
    const del = e.target.closest('[data-mdel]');
    if (del) {
      if (!confirm('Delete this material and its PDF?')) return;
      try {
        await api('/admin/materials/' + del.dataset.mdel, { method: 'DELETE' });
        toast('Material deleted.');
        admMaterials(box);
      } catch (err) { toast(err.message, 'err'); }
    }
  };

  box.onsubmit = async e => {
    if (e.target.id !== 'm-form') return;
    e.preventDefault();
    const err = $('#m-err');
    err.textContent = '';
    const f = e.target.elements;
    const body = {
      title: f.title.value.trim(), subject: f.subject.value, classLevel: f.classLevel.value,
      type: f.type.value, description: f.description.value.trim(), content: f.content.value
    };
    const file = $('#m-file').files[0];
    try {
      if (file) {
        if (file.type !== 'application/pdf') throw new Error('Only PDF files can be uploaded.');
        if (file.size > 8 * 1024 * 1024) throw new Error('PDF must be under 8 MB.');
        body.file = { name: file.name, dataUrl: await readFile(file) };
      }
      if (editId) await api('/admin/materials/' + editId, { method: 'PUT', body });
      else await api('/admin/materials', { method: 'POST', body });
      toast('Material saved ✔');
      admMaterials(box);
    } catch (ex) { err.textContent = ex.message; }
  };
}

async function admQuizzes(box) {
  const { quizzes } = await api('/quizzes');
  const SAMPLE = JSON.stringify([
    { q: 'What is 2 + 2?', options: ['3', '4', '5', '6'], answer: 1 },
    { q: 'Which gas do plants absorb for photosynthesis?', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'], answer: 2 }
  ], null, 2);
  box.innerHTML = `
  <div class="two-col wide-left">
    <form class="card form" id="qz-form" novalidate>
      <h2>Create a quiz</h2>
      <label>Title <input name="title" required minlength="3" maxlength="120"></label>
      <div class="form-row">
        <label>Subject <select name="subject">${opts(state.meta.subjects)}</select></label>
        <label>Class <select name="classLevel">${opts(state.meta.classes)}</select></label>
      </div>
      <label>Time limit (minutes) <input type="number" name="timeLimitMin" min="1" max="120" value="10"></label>
      <label>Questions (JSON array)
        <textarea name="questions" rows="12" class="mono" required>${esc(SAMPLE)}</textarea>
      </label>
      <p class="muted tiny">Each question needs <code>q</code> (text), <code>options</code> (exactly 4 strings) and <code>answer</code> (index 0 to 3 of the correct option).</p>
      <p class="error" id="qz-err"></p>
      <button class="btn primary" type="submit">Create quiz</button>
    </form>
    <div class="list">${quizzes.map(q => `
      <div class="list-item">
        <div><b>${esc(q.title)}</b><div class="muted tiny">${esc(q.subject)} · ${esc(q.classLevel)} · ${q.count} questions · ${q.timeLimitMin} min</div></div>
        <button class="icon-btn sm" data-qdel="${esc(q.id)}" aria-label="Delete quiz">🗑️</button>
      </div>`).join('') || empty('❓', 'No quizzes yet')}</div>
  </div>`;

  box.onsubmit = async e => {
    if (e.target.id !== 'qz-form') return;
    e.preventDefault();
    const err = $('#qz-err');
    err.textContent = '';
    const f = e.target.elements;
    let questions;
    try { questions = JSON.parse(f.questions.value); }
    catch { return (err.textContent = 'Questions must be valid JSON. Check commas, quotes and brackets.'); }
    try {
      await api('/admin/quizzes', {
        method: 'POST',
        body: { title: f.title.value.trim(), subject: f.subject.value, classLevel: f.classLevel.value, timeLimitMin: f.timeLimitMin.value, questions }
      });
      toast('Quiz created ✔');
      admQuizzes(box);
    } catch (ex) { err.textContent = ex.message; }
  };
  box.onclick = async e => {
    const del = e.target.closest('[data-qdel]');
    if (!del) return;
    if (!confirm('Delete this quiz? Student results will be kept.')) return;
    try { await api('/admin/quizzes/' + del.dataset.qdel, { method: 'DELETE' }); toast('Quiz deleted.'); admQuizzes(box); }
    catch (err) { toast(err.message, 'err'); }
  };
}

async function admNews(box) {
  const { announcements } = await api('/announcements');
  box.innerHTML = `
  <div class="two-col wide-left">
    <form class="card form" id="n-form" novalidate>
      <h2>Post an announcement</h2>
      <label>Title <input name="title" required minlength="3" maxlength="140"></label>
      <label>Type <select name="type">
        <option value="announcement">Announcement</option>
        <option value="news">Education news</option>
        <option value="exam">Exam notice</option>
      </select></label>
      <label>Message <textarea name="body" rows="4" required maxlength="1000"></textarea></label>
      <p class="error" id="n-err"></p>
      <button class="btn primary" type="submit">Publish</button>
    </form>
    <div class="list">${announcements.map(a => `
      <div class="list-item">
        <div><b>${esc(a.title)}</b><div class="muted tiny">${esc(a.type)} · ${new Date(a.createdAt).toLocaleDateString()}</div></div>
        <button class="icon-btn sm" data-ndel="${esc(a.id)}" aria-label="Delete">🗑️</button>
      </div>`).join('') || empty('📢', 'No announcements yet')}</div>
  </div>`;

  box.onsubmit = async e => {
    if (e.target.id !== 'n-form') return;
    e.preventDefault();
    const f = e.target.elements;
    try {
      await api('/admin/announcements', { method: 'POST', body: { title: f.title.value.trim(), type: f.type.value, body: f.body.value.trim() } });
      toast('Announcement published ✔');
      admNews(box);
    } catch (err) { $('#n-err').textContent = err.message; }
  };
  box.onclick = async e => {
    const del = e.target.closest('[data-ndel]');
    if (!del) return;
    try { await api('/admin/announcements/' + del.dataset.ndel, { method: 'DELETE' }); toast('Removed.'); admNews(box); }
    catch (err) { toast(err.message, 'err'); }
  };
}

async function admCourses(box) {
  const { courses } = await api('/courses');
  box.innerHTML = `
  <div class="two-col wide-left">
    <form class="card form" id="c-form" novalidate>
      <h2>Add a video lesson</h2>
      <label>Title <input name="title" required minlength="3" maxlength="120"></label>
      <div class="form-row">
        <label>Category <select name="category">${opts(state.meta.subjects)}</select></label>
        <label>Duration <input name="duration" placeholder="e.g. 4 h" maxlength="30"></label>
      </div>
      <label>Instructor / source <input name="instructor" maxlength="80"></label>
      <label>Lesson link (https://) <input name="url" type="url" required placeholder="https://…"></label>
      <label>Description <textarea name="description" rows="3" maxlength="400"></textarea></label>
      <p class="error" id="c-err"></p>
      <button class="btn primary" type="submit">Add lesson</button>
    </form>
    <div class="list">${courses.map(c => `
      <div class="list-item">
        <div><b>${esc(c.title)}</b><div class="muted tiny">${esc(c.category)} · ${esc(c.duration)}</div></div>
        <button class="icon-btn sm" data-cdel="${esc(c.id)}" aria-label="Delete lesson">🗑️</button>
      </div>`).join('') || empty('🎥', 'No lessons yet')}</div>
  </div>`;

  box.onsubmit = async e => {
    if (e.target.id !== 'c-form') return;
    e.preventDefault();
    const f = e.target.elements;
    try {
      await api('/admin/courses', { method: 'POST', body: {
        title: f.title.value.trim(), category: f.category.value, duration: f.duration.value.trim(),
        instructor: f.instructor.value.trim(), url: f.url.value.trim(), description: f.description.value.trim()
      } });
      toast('Lesson added ✔');
      state.courses = [];
      admCourses(box);
    } catch (err) { $('#c-err').textContent = err.message; }
  };
  box.onclick = async e => {
    const del = e.target.closest('[data-cdel]');
    if (!del) return;
    try { await api('/admin/courses/' + del.dataset.cdel, { method: 'DELETE' }); toast('Lesson removed.'); state.courses = []; admCourses(box); }
    catch (err) { toast(err.message, 'err'); }
  };
}

async function admCatalog(box) {
  state.meta = await api('/meta');
  const m = state.meta;
  const chips = (list, key) => list.map(x => `<span class="tag">${esc(x)}
      <button data-ckey="${key}" data-cname="${esc(x)}" aria-label="Remove ${esc(x)}">✕</button></span>`).join('');
  box.innerHTML = `
  <div class="two-col">
    <div class="card">
      <h2>Subjects</h2>
      <form class="form-row" data-cadd="subjects"><input name="name" placeholder="New subject" maxlength="60" required><button class="btn primary sm" type="submit">Add</button></form>
      <div class="tags">${chips(m.subjects, 'subjects')}</div>
    </div>
    <div class="card">
      <h2>Classes</h2>
      <form class="form-row" data-cadd="classes"><input name="name" placeholder="e.g. Class 8" maxlength="60" required><button class="btn primary sm" type="submit">Add</button></form>
      <div class="tags">${chips(m.classes, 'classes')}</div>
    </div>
  </div>
  <p class="muted small" style="margin-top:14px">A subject or class that is still used by materials, quizzes or students cannot be removed.</p>`;

  box.onsubmit = async e => {
    const key = e.target.dataset.cadd;
    if (!key) return;
    e.preventDefault();
    try {
      await api(`/admin/${key}`, { method: 'POST', body: { name: e.target.elements.name.value.trim() } });
      toast('Added ✔');
      admCatalog(box);
    } catch (err) { toast(err.message, 'err'); }
  };
  box.onclick = async e => {
    const b = e.target.closest('[data-ckey]');
    if (!b) return;
    try {
      await api(`/admin/${b.dataset.ckey}/${encodeURIComponent(b.dataset.cname)}`, { method: 'DELETE' });
      toast('Removed.');
      admCatalog(box);
    } catch (err) { toast(err.message, 'err'); }
  };
}

async function admUsers(box) {
  const draw = async (q = '') => {
    const { users } = await api('/admin/users?q=' + encodeURIComponent(q));
    box.innerHTML = `
    <div class="toolbar" style="grid-template-columns:1fr">
      <input type="search" id="u-q" placeholder="Search name, email, roll number or student ID" value="${esc(q)}" aria-label="Search students">
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Student</th><th>Class</th><th>Roll</th><th>Role</th><th>Attendance %</th><th></th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td><b>${esc(u.name)}</b><div class="muted tiny">${esc(u.email)} · ${esc(u.studentId)}</div></td>
        <td><select data-uclass="${esc(u.id)}" aria-label="Class">
          <option value="">—</option>${state.meta.classes.map(c => `<option ${c === u.className ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select></td>
        <td>${esc(u.rollNumber || '-')}</td>
        <td><select data-urole="${esc(u.id)}" aria-label="Role">
          <option value="student" ${u.role === 'student' ? 'selected' : ''}>Student</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select></td>
        <td><input type="number" min="0" max="100" class="mini" value="${u.attendance}" data-uatt="${esc(u.id)}" aria-label="Attendance percentage"></td>
        <td><button class="icon-btn sm" data-udel="${esc(u.id)}" aria-label="Delete account">🗑️</button></td>
      </tr>`).join('') || `<tr><td colspan="6">${empty('👥', 'No students match this search')}</td></tr>`}</tbody>
    </table></div>`;
  };
  await draw();

  box.onchange = async e => {
    const t = e.target;
    if (t.id === 'u-q') return draw(t.value.trim());
    const patch = t.dataset.urole ? { id: t.dataset.urole, body: { role: t.value } }
      : t.dataset.uclass ? { id: t.dataset.uclass, body: { className: t.value } }
      : t.dataset.uatt ? { id: t.dataset.uatt, body: { attendance: t.value } }
      : null;
    if (!patch) return;
    try {
      await api('/admin/users/' + patch.id, { method: 'PATCH', body: patch.body });
      toast('Student updated ✔');
    } catch (err) {
      toast(err.message, 'err');
      draw($('#u-q') ? $('#u-q').value : '');
    }
  };
  box.onclick = async e => {
    const del = e.target.closest('[data-udel]');
    if (!del) return;
    if (!confirm('Permanently delete this student account and its data?')) return;
    try {
      await api('/admin/users/' + del.dataset.udel, { method: 'DELETE' });
      toast('Account deleted.');
      draw($('#u-q') ? $('#u-q').value : '');
    } catch (err) { toast(err.message, 'err'); }
  };
}

/* ================= boot ================= */
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

async function init() {
  applyTheme(localStorage.getItem('ssh-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  try {
    await loadSession();
    state.meta = await api('/meta');
  } catch (err) {
    $('#app').innerHTML = `<div class="wrap" style="padding-top:60px">${empty('⚠️', 'Cannot reach the server', 'Start the backend with "npm start", then reload this page.')}</div>`;
    return;
  }
  renderChrome();
  $('#modal').onclick = e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); };
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/';
  else route();
}

init();
