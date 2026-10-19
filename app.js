/* =========================================================================
   Davai Suka — application de suivi d'entraînement (PWA, 100 % hors ligne)
   Toutes les données restent sur le téléphone (localStorage).
   ========================================================================= */
'use strict';

// ⬇️ NOM DE L'APPLICATION : changez-le ici (et aussi dans manifest.webmanifest + <title> d'index.html)
const APP_NAME = 'Davai Suka';

// Clé stable : ne pas la renommer, ni vider les données déjà enregistrées.
// Toute évolution du format doit être une migration additive.
const STORAGE_KEY = 'davaisuka.data.v1';
const DEFAULT_WEIGHT = 72.6; // kg (≈ 160 lb), modifiable dans Programme → Réglages
const KG_PER_LB = 0.45359237;

const DEFAULT_PROGRAM = [
  { kind: 'ex', name: 'Push-ups courts', type: 'reps', value: 25, note: '' },
  { kind: 'ex', name: 'Planche statique', type: 'time', value: 60, note: '' },
  { kind: 'ex', name: 'Planche avec rotation du bassin gauche-droite', type: 'time', value: 60, note: '' },
  { kind: 'ex', name: 'Mountain climbers jambe droite', type: 'reps', value: 15, note: '' },
  { kind: 'ex', name: 'Mountain climbers jambe gauche', type: 'reps', value: 15, note: '' },
  { kind: 'pause' },
  { kind: 'ex', name: 'Push-ups courts', type: 'reps', value: 20, note: '' },
  { kind: 'ex', name: 'Push-ups longs', type: 'reps', value: 5, note: 'Le dernier très lent' },
  { kind: 'ex', name: 'Hanging', type: 'time', value: 60, note: 'Avec 10 pull-ups minimum' }
];

// Noms par défaut d'avant le nettoyage. Une seule passe au chargement :
// on retire le « (… ) » final, sans toucher au reste du programme ni aux séances.
const LEGACY_PAREN_NAMES = {
  'Push-ups courts (pectoraux)': 'Push-ups courts',
  'Push-ups longs (plus difficiles)': 'Push-ups longs'
};

function migrateSavedNames(program) {
  return program.map((e) => {
    const cleaned = e && e.kind === 'ex' ? LEGACY_PAREN_NAMES[e.name] : undefined;
    return cleaned ? { ...e, name: cleaned } : e;
  });
}

const MOTTOS = [
  'Chaque répétition compte. 💪',
  'La régularité bat l’intensité.',
  'Un peu chaque jour, beaucoup chaque mois.',
  'Tu ne le regretteras jamais après.',
  'Plus fort qu’hier, c’est tout ce qui compte.',
  'Le plus dur, c’est de commencer. Go !',
  'Discipline aujourd’hui, fierté demain.'
];

const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/* ---------- Estimation des calories (MET) ----------
   kcal = MET × poids (kg) × durée (heures)
   Durée = valeur (si exercice en durée) ou répétitions × secondes par répétition. */
const MET_PROFILES = [
  { keys: ['mountain'], met: 8, spr: 1, label: 'Mountain climbers' },
  { keys: ['pull-up', 'pull up', 'pullup', 'traction', 'hanging', 'suspension', 'barre fixe'], met: 8, spr: 3, label: 'Tractions / suspension' },
  { keys: ['push-up', 'push up', 'pushup', 'pompe'], met: 8, spr: 2, label: 'Pompes / push-ups' },
  { keys: ['planche', 'plank', 'gainage'], met: 4, spr: 3, label: 'Planche / gainage' },
  { keys: ['burpee'], met: 8, spr: 4, label: 'Burpees' },
  { keys: ['jumping', 'saut', 'corde'], met: 8, spr: 1, label: 'Sauts / jumping jacks' },
  { keys: ['squat', 'fente', 'lunge'], met: 5, spr: 3, label: 'Squats / fentes' },
  { keys: ['abdo', 'crunch', 'sit-up'], met: 3.8, spr: 2, label: 'Abdos / crunchs' },
  { keys: ['dips'], met: 8, spr: 2, label: 'Dips' }
];
const MET_DEFAULT = { met: 5, spr: 3, label: 'Autre exercice (par défaut)' };

function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function profileFor(ex) {
  const n = normalize(ex.name);
  const p = MET_PROFILES.find((pr) => pr.keys.some((k) => n.includes(k))) || MET_DEFAULT;
  return {
    met: Number(ex.met) > 0 ? Number(ex.met) : p.met,
    spr: Number(ex.spr) > 0 ? Number(ex.spr) : p.spr,
    label: p.label,
    auto: p
  };
}
function exSeconds(ex) {
  if (ex.kind !== 'ex') return 0;
  const p = profileFor(ex);
  return ex.type === 'time' ? Number(ex.value) || 0 : (Number(ex.value) || 0) * p.spr;
}
function exKcal(ex, weight) {
  if (ex.kind !== 'ex') return 0;
  return profileFor(ex).met * weight * (exSeconds(ex) / 3600);
}

/* ---------- Données ---------- */
let state = load();
let ui = { weekOffset: 0, calMode: 'week', monthCursor: null };

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function freshProgram() { return DEFAULT_PROGRAM.map((e) => ({ ...e, id: uid() })); }

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('format');
      const program = Array.isArray(d.program) ? d.program : freshProgram();
      const days = d.days && typeof d.days === 'object' && !Array.isArray(d.days) ? d.days : {};
      return {
        ...d,
        program: d.parenNamesMigrated ? program : migrateSavedNames(program),
        weight: d.weightSet && Number(d.weight) > 0 ? Number(d.weight) : DEFAULT_WEIGHT,
        weightSet: !!d.weightSet,
        weightUnit: d.weightUnit === 'lb' ? 'lb' : 'kg',
        days,
        sessions: Array.isArray(d.sessions) ? d.sessions : [],
        today: d.today || null,
        parenNamesMigrated: true
      };
    }
  } catch (e) { console.warn('Lecture des données impossible', e); }
  return { program: freshProgram(), weight: DEFAULT_WEIGHT, weightSet: false, weightUnit: 'kg', days: {}, sessions: [], today: null, parenNamesMigrated: true };
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { toast('⚠️ Impossible d’enregistrer (stockage plein ?)'); }
}

/* ---------- Dates (heure locale) ---------- */
function dkey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function todayKey() { return dkey(new Date()); }
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
const fmtLong = (d) => { const t = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
const fmtShort = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const fmtDM = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
const MONTH_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const EARLIEST_MONTH = { y: 2025, m: 9 }; // octobre 2025
const monthIndex = (y, m) => y * 12 + m;
function capMonth(m) { const s = MONTH_FR[m]; return s.charAt(0).toUpperCase() + s.slice(1); }
function ensureMonthCursor() {
  if (!ui.monthCursor) {
    const n = new Date();
    ui.monthCursor = { y: n.getFullYear(), m: n.getMonth() };
  }
  return ui.monthCursor;
}
function clampMonth(y, m) {
  const now = new Date();
  let idx = monthIndex(y, m);
  const min = monthIndex(EARLIEST_MONTH.y, EARLIEST_MONTH.m);
  const max = monthIndex(now.getFullYear(), now.getMonth());
  if (idx < min) return { y: EARLIEST_MONTH.y, m: EARLIEST_MONTH.m };
  if (idx > max) return { y: now.getFullYear(), m: now.getMonth() };
  return { y, m };
}
function monthsInYear(y) {
  const now = new Date();
  let start = y === EARLIEST_MONTH.y ? EARLIEST_MONTH.m : 0;
  let end = y === now.getFullYear() ? now.getMonth() : 11;
  const out = [];
  for (let m = start; m <= end; m++) out.push(m);
  return out;
}

/* ---------- Utilitaires ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtVal(ex) {
  if (ex.type === 'reps') return ex.value + ' rép.';
  const s = Number(ex.value) || 0;
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} min ${String(r).padStart(2, '0')} s` : `${m} min`;
}
const r1 = (n) => Math.round(n * 10) / 10;
const kgToLb = (kg) => r1(kg / KG_PER_LB);
const fmtNum = (n) => r1(n).toLocaleString('fr-FR');
const fmtWeight = (kg) => `${fmtNum(kg)} kg (≈ ${fmtNum(kgToLb(kg))} lb)`;
const fmtKcal = (k) => (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10).toLocaleString('fr-FR');
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}
const exercises = () => state.program.filter((e) => e.kind === 'ex');
const sessionOn = (k) => state.sessions.find((s) => s.date === k);
function isDayChecked(k) {
  if (state.days[k] === true) return true;
  if (state.days[k] === false) return false;
  return !!sessionOn(k);
}
function ensureToday() {
  const k = todayKey();
  if (!state.today || state.today.date !== k) state.today = { date: k, started: false, checked: [] };
  return state.today;
}
function weekCount(monday) {
  let n = 0;
  for (let i = 0; i < 7; i++) if (isDayChecked(dkey(addDays(monday, i)))) n++;
  return n;
}
const WEEK_MOTIVATION = {
  7: 'Bien',
  6: 'Insuffisant',
  5: 'Bare minimum',
  4: 'Décevant',
  3: 'Minable',
  2: 'Inacceptable',
  1: 'Autant pas le faire'
};
function weekMotivation(n) {
  if (WEEK_MOTIVATION[n]) return WEEK_MOTIVATION[n];
  return 'Aucun jour coché pour l’instant.';
}

/* =========================================================================
   Écrans
   ========================================================================= */
const TABS = ['accueil', 'semaine', 'calories', 'programme'];
function currentTab() { const h = location.hash.replace('#', ''); return TABS.includes(h) ? h : 'accueil'; }

function render() {
  const tab = currentTab();
  document.body.classList.remove('home', 'semaine', 'calories', 'programme');
  document.body.classList.add(tab === 'accueil' ? 'home' : tab);
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const app = document.getElementById('app');
  app.innerHTML = ({ accueil: viewHome, semaine: viewWeek, calories: viewCalories, programme: viewProgram })[tab]();
}

/* ----- 1. Accueil ----- */
function viewHome() {
  const now = new Date();
  const t = ensureToday();
  const k = todayKey();
  const done = sessionOn(k);
  const exs = exercises();
  const planKcal = exs.reduce((a, e) => a + exKcal(e, state.weight), 0);
  const planMin = Math.max(1, Math.round(exs.reduce((a, e) => a + exSeconds(e), 0) / 60));
  const motto = "T'as pas l'temps parce que t'es un lâche";

  let h = `<section class="hero">
    <h1 class="app-name" aria-label="${esc(APP_NAME)}">ДАVАЙ SUКА</h1>
    <p class="motto">${esc(motto)}</p>
    <span class="date-pill">📅 ${esc(fmtLong(now))}</span>
  </section>
  <div class="stats" style="margin-top:16px">
    <div class="stat"><div class="v">${weekCount(mondayOf(now))}<span class="muted" style="font-size:18px"> / 7</span></div><div class="l">Cette semaine</div></div>
    <div class="stat"><div class="v o">${state.sessions.length}</div><div class="l">Séances au total</div></div>
  </div>`;

  if (done) {
    h += `<div class="done-banner">
      <div class="big">✅ Séance du jour terminée !</div>
      <div class="muted" style="margin-top:6px">${done.exDone}/${done.exTotal} exercices · ≈ ${fmtKcal(done.kcal)} kcal <span class="badge">Estimation</span></div>
      <div style="margin-top:6px">Bravo, à demain 🔥</div>
    </div>
    <button class="btn ghost" data-action="undo-session">Annuler la séance du jour</button>`;
    return h;
  }

  if (!t.started) {
    h += `<div class="card">
      <h3>Séance du jour</h3>
      <div class="muted">${exs.length} exercices · ≈ ${planMin} min d’effort · ≈ ${fmtKcal(planKcal)} kcal <span class="badge">Estimation</span></div>
      <div style="height:14px"></div>
      <button class="btn primary" data-action="start">▶ Commencer la séance du jour</button>
    </div>`;
    return h;
  }

  const nDone = exs.filter((e) => t.checked.includes(e.id)).length;
  const pct = exs.length ? Math.round((nDone / exs.length) * 100) : 0;
  h += `<div class="card">
    <div class="row"><h3 style="margin:0">Séance du jour</h3><div class="spacer"></div><strong id="count">${nDone} / ${exs.length}</strong></div>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <ul class="ex-list">`;
  for (const e of state.program) {
    if (e.kind === 'pause') { h += `<li class="pause-sep">Pause</li>`; continue; }
    const on = t.checked.includes(e.id);
    h += `<li class="ex-item ${on ? 'done' : ''}" data-action="toggle-ex" data-id="${e.id}" role="checkbox" aria-checked="${on}" tabindex="0">
      <span class="check">✓</span>
      <div><div class="ex-name">${esc(e.name)}</div>${e.note ? `<div class="ex-meta">${esc(e.note)}</div>` : ''}</div>
      <span class="ex-val">${esc(fmtVal(e))}</span>
    </li>`;
  }
  h += `</ul></div>
  <button class="btn primary" data-action="finish">🏁 Séance terminée</button>
  <p class="muted small" style="text-align:center">Les calories sont calculées sur les exercices cochés (tous si aucun n’est coché).</p>`;
  return h;
}

/* ----- 2. Semaine ----- */
function viewWeek() {
  const mode = ui.calMode === 'month' ? 'month' : 'week';
  let h = `<h2 class="screen-title">Semaine</h2>
  <div class="seg cal-toggle" role="group" aria-label="Affichage du calendrier">
    <button type="button" data-action="cal-mode" data-mode="week" class="${mode === 'week' ? 'on' : ''}" aria-pressed="${mode === 'week'}">Semaine</button>
    <button type="button" data-action="cal-mode" data-mode="month" class="${mode === 'month' ? 'on' : ''}" aria-pressed="${mode === 'month'}">Mois</button>
  </div>`;
  return h + (mode === 'month' ? viewMonth() : viewWeekGrid());
}
function viewWeekGrid() {
  const monday = addDays(mondayOf(new Date()), ui.weekOffset * 7);
  const sunday = addDays(monday, 6);
  const tk = todayKey();
  const off = ui.weekOffset;
  const title = off === 0 ? 'Cette semaine' : off === -1 ? 'Semaine dernière' : `Il y a ${-off} semaines`;
  const n = weekCount(monday);
  let h = `<div class="week-nav">
    <button class="icon-btn" data-action="week-prev" aria-label="Semaine précédente">‹</button>
    <div class="lbl">${title}<div class="muted small">${esc(fmtShort(monday))} – ${esc(fmtShort(sunday))}</div></div>
    <button class="icon-btn" data-action="week-next" aria-label="Semaine suivante" ${off >= 0 ? 'disabled' : ''}>›</button>
  </div>
  <div class="card"><div class="week">`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i), k = dkey(d);
    const on = isDayChecked(k), future = k > tk;
    h += `<button class="day ${k === tk ? 'today' : ''}" data-action="toggle-day" data-date="${k}" ${future ? 'disabled' : ''} aria-pressed="${on}" aria-label="${DAY_SHORT[i]} ${d.getDate()}">
      <span class="dn">${DAY_SHORT[i]}</span><span class="dd">${d.getDate()}</span>
      <span class="check ${on ? 'on' : ''}">✓</span>
      <span class="fire">${sessionOn(k) ? '🔥' : ''}</span>
    </button>`;
  }
  h += `</div>
  <div class="week-total"><div class="n" id="week-total">${n}<span> / 7</span></div>
  <div class="dots">${Array.from({ length: 7 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>
  <div class="muted week-motivation" style="margin-top:10px">${esc(weekMotivation(n))}</div></div>
  </div>
  <p class="muted small" style="text-align:center">Touchez un jour pour le cocher / décocher. 🔥 = séance enregistrée ce jour-là.</p>`;
  return h;
}
function viewMonth() {
  const c = ensureMonthCursor();
  const y = c.y, m = c.m;
  const tk = todayKey();
  const now = new Date();
  const first = new Date(y, m, 1);
  const pad = (first.getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  let checked = 0;
  for (let d = 1; d <= dim; d++) if (isDayChecked(dkey(new Date(y, m, d)))) checked++;
  const atMin = monthIndex(y, m) <= monthIndex(EARLIEST_MONTH.y, EARLIEST_MONTH.m);
  const atMax = monthIndex(y, m) >= monthIndex(now.getFullYear(), now.getMonth());
  const years = [];
  for (let yy = EARLIEST_MONTH.y; yy <= now.getFullYear(); yy++) years.push(yy);
  let h = `<div class="week-nav">
    <button class="icon-btn" data-action="month-prev" aria-label="Mois précédent" ${atMin ? 'disabled' : ''}>‹</button>
    <div class="lbl">${esc(capMonth(m))} ${y}<div class="muted small">${checked} jour${checked > 1 ? 's' : ''}</div></div>
    <button class="icon-btn" data-action="month-next" aria-label="Mois suivant" ${atMax ? 'disabled' : ''}>›</button>
  </div>
  <div class="month-jump">
    <select id="jump-month" aria-label="Choisir le mois">${monthsInYear(y).map((mm) => `<option value="${mm}" ${mm === m ? 'selected' : ''}>${esc(capMonth(mm))}</option>`).join('')}</select>
    <select id="jump-year" aria-label="Choisir l'année">${years.map((yy) => `<option value="${yy}" ${yy === y ? 'selected' : ''}>${yy}</option>`).join('')}</select>
  </div>
  <div class="card">
  <div class="cal-head">${DAY_SHORT.map((dn) => `<span>${dn}</span>`).join('')}</div>
  <div class="cal" role="grid" aria-label="Calendrier ${esc(capMonth(m))} ${y}">`;
  for (let i = 0; i < pad; i++) h += `<span class="cal-empty"></span>`;
  for (let d = 1; d <= dim; d++) {
    const k = dkey(new Date(y, m, d));
    const on = isDayChecked(k);
    const future = k > tk;
    h += `<button type="button" class="cal-day${on ? ' on' : ''}${k === tk ? ' today' : ''}" data-action="toggle-day" data-date="${k}" ${future ? 'disabled' : ''} aria-pressed="${on}" aria-label="${d} ${esc(MONTH_FR[m])} ${y}${on ? ', coché' : ''}">${d}${on ? '<span class="mark" aria-hidden="true">✓</span>' : ''}</button>`;
  }
  h += `</div>
  <div class="week-total"><div class="n">${checked}<span> jour${checked > 1 ? 's' : ''}</span></div>
  <div class="muted" style="margin-top:8px">Présences du mois. Un jour coché compte dans les totaux, sans calories.</div></div>
  </div>
  <p class="muted small" style="text-align:center">Touchez un jour passé pour le cocher. Les jours à venir sont verrouillés.</p>`;
  return h;
}

/* ----- 3. Calories ----- */
function viewCalories() {
  const sess = [...state.sessions].sort((a, b) => (a.date + a.at < b.date + b.at ? -1 : 1));
  const total = sess.reduce((a, s) => a + s.kcal, 0);
  const avg = sess.length ? total / sess.length : 0;
  const planKcal = exercises().reduce((a, e) => a + exKcal(e, state.weight), 0);
  let h = `<h2 class="screen-title">Calories <span class="badge" style="vertical-align:middle">Estimation</span></h2>
  <div class="stats">
    <div class="stat"><div class="v o" id="kcal-total">${fmtKcal(total)}</div><div class="l">kcal cumulées</div></div>
    <div class="stat"><div class="v">${sess.length}</div><div class="l">Séances</div></div>
    <div class="stat"><div class="v">${sess.length ? fmtKcal(sess[sess.length - 1].kcal) : '–'}</div><div class="l">Dernière séance (kcal)</div></div>
    <div class="stat"><div class="v">${sess.length ? fmtKcal(avg) : '–'}</div><div class="l">Moyenne / séance</div></div>
  </div>
  <div class="card"><h3>Évolution</h3>`;
  if (!sess.length) {
    h += `<div class="empty"><div class="e">📊</div>Terminez votre première séance pour voir le graphique.</div>`;
  } else {
    h += `<div class="chart-wrap">${chartSVG(sess)}</div>
    <div class="legend"><span><i style="background:var(--orange)"></i>kcal par séance</span><span><i style="background:var(--accent)"></i>Cumul</span></div>`;
  }
  h += `</div>
  <div class="card">
    <h3>Comment c’est calculé ?</h3>
    <div class="formula"><strong>kcal = MET × poids (kg) × durée (h)</strong><br>
    Poids utilisé : <strong>${fmtWeight(state.weight)}</strong>${state.weightSet ? '' : ' (valeur par défaut — modifiable dans Programme ⚙️)'}<br>
    Durée estimée par exercice (≈ 2 s par pompe, 1 s par mountain climber, 3 s par traction…).
    MET : pompes / mountain climbers / tractions ≈ 8, planche ≈ 4.<br>
    Séance actuelle ≈ <strong>${fmtKcal(planKcal)} kcal</strong>. Les calories de chaque séance sont figées au moment où elle est terminée.</div>
  </div>
  <div class="card"><h3>Historique</h3>`;
  if (!sess.length) h += `<div class="muted">Aucune séance enregistrée.</div>`;
  else {
    h += `<ul class="sess-list">`;
    for (const s of [...sess].reverse().slice(0, 60)) {
      h += `<li><div><div class="ex-name" style="text-transform:capitalize">${esc(parseKey(s.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</div>
      <div class="ex-meta">${s.exDone}/${s.exTotal} exercices · ${fmtKcal(s.weight)} kg</div></div><span class="k">${fmtKcal(s.kcal)} kcal</span></li>`;
    }
    h += `</ul>`;
  }
  h += `</div>`;
  return h;
}

function chartSVG(all) {
  const sess = all.slice(-20); // 20 dernières séances
  let cum = all.slice(0, all.length - sess.length).reduce((a, s) => a + s.kcal, 0);
  const pts = sess.map((s) => { cum += s.kcal; return { s, cum }; });
  const W = 360, H = 230, pl = 34, pr = 40, pt = 14, pb = 30;
  const iw = W - pl - pr, ih = H - pt - pb;
  const nice = (v) => { const raw = v / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))); const m = [1, 2, 2.5, 5, 10].find((k) => k * mag >= raw); return m * mag * 4; };
  const maxBar = nice(Math.max(...sess.map((s) => s.kcal), 1) * 1.05);
  const maxCum = nice(Math.max(pts[pts.length - 1].cum, 1));
  const slot = iw / sess.length, bw = Math.min(26, slot * 0.6);
  const x = (i) => pl + slot * i + slot / 2;
  const yb = (v) => pt + ih - (v / maxBar) * ih;
  const yc = (v) => pt + ih - (v / maxCum) * ih;
  let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Graphique des calories">`;
  for (let i = 0; i <= 4; i++) {
    const y = pt + (ih * i) / 4;
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="#2a3240" stroke-width="1"/>`;
    g += `<text x="${pl - 6}" y="${y + 4}" fill="#ff8a3d" font-size="10" text-anchor="end">${Math.round(maxBar * (1 - i / 4))}</text>`;
    g += `<text x="${W - pr + 6}" y="${y + 4}" fill="#c6ff3d" font-size="10">${Math.round(maxCum * (1 - i / 4))}</text>`;
  }
  const every = Math.ceil(sess.length / 7);
  sess.forEach((s, i) => {
    g += `<rect x="${x(i) - bw / 2}" y="${yb(s.kcal)}" width="${bw}" height="${pt + ih - yb(s.kcal)}" rx="4" fill="#ff8a3d" opacity=".9"/>`;
    const last = sess.length - 1, lastLab = last - (last % every);
    if (i % every === 0 || (i === last && last - lastLab >= every * 0.7))
      g += `<text x="${x(i)}" y="${H - 10}" fill="#8b96a8" font-size="10" text-anchor="middle">${fmtDM(parseKey(s.date))}</text>`;
  });
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yc(p.cum).toFixed(1)}`).join(' ');
  g += `<path d="${path}" fill="none" stroke="#c6ff3d" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
  pts.forEach((p, i) => { g += `<circle cx="${x(i)}" cy="${yc(p.cum)}" r="3.5" fill="#0f1218" stroke="#c6ff3d" stroke-width="2"/>`; });
  return g + `</svg>`;
}

/* ----- 4. Programme ----- */
function viewProgram() {
  const list = state.program;
  let h = `<h2 class="screen-title">Programme</h2><div class="card"><h3>Ma séance</h3>`;
  if (!list.length) h += `<div class="muted" style="margin-bottom:10px">Programme vide — ajoutez un exercice.</div>`;
  list.forEach((e, i) => {
    const pause = e.kind === 'pause';
    h += `<div class="prog-item ${pause ? 'pause' : ''}" data-id="${e.id}">
      <div class="updown">
        <button class="icon-btn" data-action="up" data-id="${e.id}" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="icon-btn" data-action="down" data-id="${e.id}" aria-label="Descendre" ${i === list.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
      <div class="info" ${pause ? '' : `data-action="edit" data-id="${e.id}"`}>
        <div class="ex-name">${pause ? '— Pause —' : esc(e.name)}</div>
        ${pause ? '' : `<div class="ex-val">${esc(fmtVal(e))}</div>${e.note ? `<div class="ex-meta">${esc(e.note)}</div>` : ''}`}
      </div>
      ${pause ? '' : `<button class="icon-btn" data-action="edit" data-id="${e.id}" aria-label="Modifier">✎</button>`}
      <button class="icon-btn del" data-action="delete" data-id="${e.id}" aria-label="Supprimer">✕</button>
    </div>`;
  });
  h += `<div class="btn-row" style="margin-top:12px">
      <button class="btn primary" data-action="add">＋ Exercice</button>
      <button class="btn orange" data-action="add-pause">＋ Pause</button>
    </div>
  </div>
  <div class="card">
    <h3>⚙️ Réglages</h3>
    <label class="f" for="weight">Poids du corps — sert au calcul des calories</label>
    <div class="seg" style="margin-bottom:8px">
      <button data-action="wunit" data-unit="kg" class="${state.weightUnit === 'kg' ? 'on' : ''}">kg</button>
      <button data-action="wunit" data-unit="lb" class="${state.weightUnit === 'lb' ? 'on' : ''}">lb</button>
    </div>
    <div class="weight-row">
      <input id="weight" type="number" inputmode="decimal" step="0.1" value="${state.weightUnit === 'lb' ? kgToLb(state.weight) : state.weight}" aria-label="Poids en ${state.weightUnit}">
      <span class="unit">${state.weightUnit}</span>
      <button class="btn primary" data-action="save-weight">Enregistrer</button>
    </div>
    <p class="muted small"><strong id="weight-show">${fmtWeight(state.weight)}</strong>${state.weightSet ? '' : ' — valeur par défaut'}. Les séances déjà faites gardent leurs calories.</p>
  </div>
  <div class="card">
    <h3>💾 Mes données</h3>
    <p class="muted small" style="margin-top:0">Tout est stocké uniquement sur ce téléphone. Faites une sauvegarde de temps en temps.</p>
    <div class="btn-row">
      <button class="btn ghost" data-action="export">Exporter</button>
      <button class="btn ghost" data-action="import">Importer</button>
    </div>
    <input id="import-file" type="file" accept="application/json,.json" class="hidden">
    <div style="height:10px"></div>
    <button class="btn ghost" data-action="reset-program">Remettre le programme par défaut</button>
    <button class="btn danger" data-action="wipe">Effacer toutes les données</button>
  </div>
  <p class="muted small" style="text-align:center">${esc(APP_NAME)} · v1</p>`;
  return h;
}

/* ----- Feuille d'édition d'un exercice ----- */
let draft = null;
function openEditor(id) {
  const src = id ? state.program.find((e) => e.id === id) : null;
  draft = src ? { ...src } : { id: null, kind: 'ex', name: '', type: 'reps', value: 10, note: '' };
  renderEditor();
}
function renderEditor() {
  const s = document.getElementById('sheet');
  const p = profileFor(draft);
  s.innerHTML = `<div class="panel">
    <div class="grab"></div>
    <h3>${draft.id ? 'Modifier l’exercice' : 'Nouvel exercice'}</h3>
    <label class="f" for="f-name">Nom</label>
    <input id="f-name" type="text" value="${esc(draft.name)}" placeholder="Ex. : Squats" maxlength="80">
    <label class="f">Type</label>
    <div class="seg">
      <button data-action="type" data-type="reps" class="${draft.type === 'reps' ? 'on' : ''}">Répétitions</button>
      <button data-action="type" data-type="time" class="${draft.type === 'time' ? 'on' : ''}">Durée</button>
    </div>
    <label class="f" for="f-value">${draft.type === 'reps' ? 'Nombre de répétitions' : 'Durée en secondes'}</label>
    <div class="stepper">
      <button class="icon-btn" data-action="step" data-d="-1" aria-label="Moins">−</button>
      <input id="f-value" type="number" inputmode="numeric" min="1" value="${draft.value}">
      <button class="icon-btn" data-action="step" data-d="1" aria-label="Plus">+</button>
      <span class="unit">${draft.type === 'reps' ? 'rép.' : 's'}</span>
    </div>
    ${draft.type === 'time' ? `<p class="muted small" id="f-human">= ${esc(fmtVal(draft))}</p>` : ''}
    <label class="f" for="f-note">Note (facultatif)</label>
    <textarea id="f-note" placeholder="Ex. : le dernier très lent" maxlength="200">${esc(draft.note || '')}</textarea>
    <details style="margin-top:12px">
      <summary class="muted small">Avancé : calcul des calories</summary>
      <p class="muted small">Détecté : ${esc(p.auto.label)} (MET ${p.auto.met}${draft.type === 'reps' ? `, ${p.auto.spr} s/rép.` : ''}). Laissez vide pour la valeur automatique.</p>
      <div class="btn-row">
        <div><label class="f" for="f-met">MET</label><input id="f-met" type="number" step="0.1" min="1" max="20" placeholder="${p.auto.met}" value="${draft.met || ''}"></div>
        <div><label class="f" for="f-spr">Secondes / rép.</label><input id="f-spr" type="number" step="0.5" min="0.5" max="30" placeholder="${p.auto.spr}" value="${draft.spr || ''}"></div>
      </div>
    </details>
    <div style="height:16px"></div>
    <button class="btn primary" data-action="save-ex">Enregistrer</button>
    <button class="btn ghost" data-action="close-sheet">Annuler</button>
  </div>`;
  s.classList.remove('hidden');
}
function readDraftInputs() {
  if (!draft) return;
  const g = (id) => document.getElementById(id);
  draft.name = g('f-name').value;
  draft.value = Math.max(1, Math.round(Number(g('f-value').value) || 1));
  draft.note = g('f-note').value;
  draft.met = Number(g('f-met').value) > 0 ? Number(g('f-met').value) : undefined;
  draft.spr = Number(g('f-spr').value) > 0 ? Number(g('f-spr').value) : undefined;
}
function closeSheet() { draft = null; const s = document.getElementById('sheet'); s.classList.add('hidden'); s.innerHTML = ''; }

/* =========================================================================
   Actions
   ========================================================================= */
function moveItem(id, dir) {
  const i = state.program.findIndex((e) => e.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= state.program.length) return;
  [state.program[i], state.program[j]] = [state.program[j], state.program[i]];
  save(); render();
}

function finishSession() {
  const t = ensureToday();
  const exs = exercises();
  let doneList = exs.filter((e) => t.checked.includes(e.id));
  if (!doneList.length) { doneList = exs; t.checked = exs.map((e) => e.id); }
  const kcal = doneList.reduce((a, e) => a + exKcal(e, state.weight), 0);
  const k = todayKey();
  state.sessions = state.sessions.filter((s) => s.date !== k);
  state.sessions.push({
    id: uid(), date: k, at: new Date().toISOString(),
    kcal: Math.round(kcal * 10) / 10, weight: state.weight,
    exDone: doneList.length, exTotal: exs.length,
    seconds: doneList.reduce((a, e) => a + exSeconds(e), 0)
  });
  state.days[k] = true;
  save(); render();
  toast(`Bravo ! ≈ ${fmtKcal(kcal)} kcal brûlées 🔥`);
}

function exportData() {
  const blob = new Blob([JSON.stringify({ app: APP_NAME, exportedAt: new Date().toISOString(), data: state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sauvegarde-${normalize(APP_NAME).replace(/[^a-z0-9]+/g, '-')}-${todayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      const data = d.data || d;
      if (!Array.isArray(data.program) || !Array.isArray(data.sessions)) throw new Error('format');
      if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      state = load(); render(); toast('Sauvegarde importée ✅');
    } catch (e) { toast('Fichier invalide'); }
  };
  r.readAsText(file);
}

document.addEventListener('click', (ev) => {
  const tabBtn = ev.target.closest('.tab');
  if (tabBtn) { location.hash = tabBtn.dataset.tab; window.scrollTo(0, 0); return; }
  const sheet = document.getElementById('sheet');
  if (ev.target === sheet) { closeSheet(); return; }
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'start': ensureToday().started = true; save(); render(); break;
    case 'toggle-ex': {
      const t = ensureToday();
      t.checked = t.checked.includes(id) ? t.checked.filter((x) => x !== id) : [...t.checked, id];
      save(); render(); break;
    }
    case 'finish': finishSession(); break;
    case 'undo-session': {
      if (!confirm('Annuler la séance d’aujourd’hui ? Ses calories seront retirées.')) return;
      const k = todayKey();
      state.sessions = state.sessions.filter((s) => s.date !== k);
      delete state.days[k];
      ensureToday().started = true;
      save(); render(); break;
    }
    case 'week-prev': ui.weekOffset--; render(); break;
    case 'week-next': if (ui.weekOffset < 0) ui.weekOffset++; render(); break;
    case 'cal-mode': ui.calMode = el.dataset.mode === 'month' ? 'month' : 'week'; render(); break;
    case 'month-prev':
    case 'month-next': {
      const c = ensureMonthCursor();
      const dir = el.dataset.action === 'month-prev' ? -1 : 1;
      const shifted = new Date(c.y, c.m + dir, 1);
      ui.monthCursor = clampMonth(shifted.getFullYear(), shifted.getMonth());
      render();
      break;
    }
    case 'toggle-day': {
      const k = el.dataset.date;
      if (!k || k > todayKey()) return;
      state.days[k] = !isDayChecked(k);
      save();
      render();
      break;
    }
    case 'up': moveItem(id, -1); break;
    case 'down': moveItem(id, 1); break;
    case 'edit': openEditor(id); break;
    case 'add': openEditor(null); break;
    case 'add-pause': state.program.push({ id: uid(), kind: 'pause' }); save(); render(); toast('Pause ajoutée en fin de programme'); break;
    case 'delete': {
      const e = state.program.find((x) => x.id === id);
      if (!e) return;
      if (!confirm(e.kind === 'pause' ? 'Supprimer cette pause ?' : `Supprimer « ${e.name} » ?`)) return;
      state.program = state.program.filter((x) => x.id !== id);
      save(); render(); break;
    }
    case 'type': readDraftInputs(); draft.type = el.dataset.type; renderEditor(); break;
    case 'step': {
      readDraftInputs();
      const step = draft.type === 'time' ? 5 : 1;
      draft.value = Math.max(1, draft.value + Number(el.dataset.d) * step);
      document.getElementById('f-value').value = draft.value;
      const hm = document.getElementById('f-human'); if (hm) hm.textContent = '= ' + fmtVal(draft);
      break;
    }
    case 'save-ex': {
      readDraftInputs();
      draft.name = draft.name.trim();
      if (!draft.name) { toast('Donnez un nom à l’exercice'); document.getElementById('f-name').focus(); return; }
      draft.note = draft.note.trim();
      if (draft.id) {
        const i = state.program.findIndex((e) => e.id === draft.id);
        if (i >= 0) state.program[i] = { ...draft };
      } else {
        state.program.push({ ...draft, id: uid() });
      }
      const isNew = !draft.id;
      closeSheet(); save(); render(); toast(isNew ? 'Exercice ajouté ✅' : 'Modifié ✅'); break;
    }
    case 'close-sheet': closeSheet(); break;
    case 'save-weight': {
      const v = Number(String(document.getElementById('weight').value).replace(',', '.'));
      const w = state.weightUnit === 'lb' ? v * KG_PER_LB : v;
      if (!(w >= 30 && w <= 250)) { toast(state.weightUnit === 'lb' ? 'Poids invalide (66 à 550 lb)' : 'Poids invalide (30 à 250 kg)'); return; }
      state.weight = r1(w); state.weightSet = true;
      save(); render(); toast(`Poids enregistré : ${fmtWeight(state.weight)}`); break;
    }
    case 'wunit': {
      state.weightUnit = el.dataset.unit === 'lb' ? 'lb' : 'kg';
      save(); render(); break;
    }
    case 'export': exportData(); break;
    case 'import': document.getElementById('import-file').click(); break;
    case 'reset-program':
      if (!confirm('Remplacer votre programme par le programme par défaut ?')) return;
      state.program = freshProgram(); if (state.today) state.today.checked = [];
      save(); render(); toast('Programme par défaut restauré'); break;
    case 'wipe':
      if (!confirm('Effacer TOUTES les données (séances, semaine, programme, poids) ? Action irréversible.')) return;
      localStorage.removeItem(STORAGE_KEY); state = load(); save(); render(); toast('Données effacées'); break;
  }
});

document.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[role=checkbox]')) { ev.preventDefault(); ev.target.click(); }
  if (ev.key === 'Escape' && draft) closeSheet();
});
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'weight') {
    const v = Number(String(ev.target.value).replace(',', '.'));
    const kg = state.weightUnit === 'lb' ? v * KG_PER_LB : v;
    const el = document.getElementById('weight-show');
    if (el && kg > 0) el.textContent = fmtWeight(kg);
  }
  if (ev.target.id === 'f-value' && draft && draft.type === 'time') {
    const hm = document.getElementById('f-human');
    if (hm) hm.textContent = '= ' + fmtVal({ type: 'time', value: Math.max(1, Math.round(Number(ev.target.value) || 1)) });
  }
});
document.addEventListener('change', (ev) => {
  if (ev.target.id === 'import-file' && ev.target.files[0]) importData(ev.target.files[0]);
  if (ev.target.id === 'jump-month' || ev.target.id === 'jump-year') {
    const y = Number(document.getElementById('jump-year').value);
    const m = Number(document.getElementById('jump-month').value);
    ui.monthCursor = clampMonth(y, m);
    ui.calMode = 'month';
    render();
  }
});
window.addEventListener('hashchange', () => { closeSheet(); render(); });
// Rafraîchir quand on revient sur l'appli (ex. passage à un nouveau jour)
document.addEventListener('visibilitychange', () => { if (!document.hidden && !draft) render(); });

document.title = APP_NAME;
save();
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // Un seul rechargement quand le nouveau worker prend la main (évite une boucle).
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch((e) => console.warn('SW', e));
  });
}
