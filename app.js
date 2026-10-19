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
const TROPHY_EPOCH = '2026-10-18';
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
        bonusDays: boolMap(d.bonusDays),
        sessions: Array.isArray(d.sessions) ? d.sessions : [],
        today: d.today || null,
        ...trophyEpochFields(d),
        parenNamesMigrated: true
      };
    }
  } catch (e) { console.warn('Lecture des données impossible', e); }
  return { program: freshProgram(), weight: DEFAULT_WEIGHT, weightSet: false, weightUnit: 'kg', days: {}, bonusDays: {}, sessions: [], today: null, seenTrophies: [], trophiesStartDate: TROPHY_EPOCH, trophiesEpochApplied: true, parenNamesMigrated: true };
}
function trophyEpochFields(d) {
  const applied = d.trophiesEpochApplied === true;
  const start = typeof d.trophiesStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trophiesStartDate)
    ? d.trophiesStartDate
    : TROPHY_EPOCH;
  return {
    trophiesStartDate: start,
    seenTrophies: applied ? seenList(d.seenTrophies) : [],
    trophiesEpochApplied: true
  };
}
function trophyStart() {
  const s = state && state.trophiesStartDate;
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : TROPHY_EPOCH;
}
function seenList(raw) {
  return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
}
function boolMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const k of Object.keys(raw)) if (raw[k] === true || raw[k] === false) out[k] = raw[k];
  return out;
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
const mainSessionOn = (k) => state.sessions.find((s) => s.date === k && !s.bonus);
const bonusSessionOn = (k) => state.sessions.find((s) => s.date === k && s.bonus);
const sessionOn = mainSessionOn;
const loggedOn = (k) => state.sessions.some((s) => s.date === k);
function isDayChecked(k) {
  if (state.days[k] === true) return true;
  if (state.days[k] === false) return false;
  return !!sessionOn(k);
}
function isBonus(k) {
  const map = state.bonusDays;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    if (map[k] === true) return true;
    if (map[k] === false) return false;
  }
  return !!bonusSessionOn(k);
}
function ensureBonusMap() {
  if (!state.bonusDays || typeof state.bonusDays !== 'object' || Array.isArray(state.bonusDays)) state.bonusDays = {};
  return state.bonusDays;
}
function ensureToday() {
  const k = todayKey();
  if (!state.today || state.today.date !== k) state.today = { date: k, started: false, checked: [] };
  return state.today;
}
function weekParts(monday) {
  let main = 0, bonus = 0;
  for (let i = 0; i < 7; i++) {
    const k = dkey(addDays(monday, i));
    if (isDayChecked(k)) main++;
    if (isBonus(k)) bonus++;
  }
  return { main, bonus, total: main + bonus };
}
function weekCount(monday) { return weekParts(monday).total; }
function monthParts(y, m) {
  const dim = new Date(y, m + 1, 0).getDate();
  let main = 0, bonus = 0;
  for (let d = 1; d <= dim; d++) {
    const k = dkey(new Date(y, m, d));
    if (isDayChecked(k)) main++;
    if (isBonus(k)) bonus++;
  }
  return { main, bonus, total: main + bonus };
}
const WEEK_MOTIVATION = {
  14: 'Légendaire',
  13: 'Héroïque',
  12: 'Exceptionnel',
  11: 'Remarquable',
  10: 'Impressionnant',
  9: 'Au-dessus des attentes',
  8: 'Solide',
  7: 'Devoir accompli',
  6: 'Insuffisant',
  5: 'Décevant',
  4: 'Médiocre',
  3: 'Minable',
  2: 'Inacceptable',
  1: 'Honteux'
};
function weekMotivation(n) {
  if (n > 14) n = 14;
  if (WEEK_MOTIVATION[n]) return WEEK_MOTIVATION[n];
  return 'Aucun jour coché pour l’instant.';
}
function bonusNote(n) {
  return n > 0 ? `+${n} bonus` : '';
}

/* ---------- Trophées (calculés, rien à saisir) ---------- */
function pushRepsPerSession() {
  return programEstimates(state.program).push;
}
function nameHas(ex, keys) {
  const n = normalize(ex && ex.name);
  return keys.some((k) => n.includes(k));
}
function programEstimates(program) {
  const list = Array.isArray(program) ? program : [];
  let plankSec = 0, hangSec = 0, pulls = 0, push = 0;
  for (const e of list) {
    if (!e || e.kind === 'pause') continue;
    if (e.type === 'reps' && nameHas(e, ['pompe', 'push-up', 'push up', 'pushup'])) push += Number(e.value) || 0;
    if (e.type === 'time' && nameHas(e, ['planche', 'gainage'])) plankSec += Number(e.value) || 0;
    if (nameHas(e, ['suspension', 'hanging', 'barre'])) {
      if (e.type === 'time') hangSec += Number(e.value) || 0;
      if (e.type === 'reps') pulls += Number(e.value) || 0;
      else {
        const m = String(e.note || '').match(/(\d+)/);
        if (m) pulls += Number(m[1]);
      }
    } else if (e.type === 'reps' && nameHas(e, ['traction', 'pull-up', 'pull up', 'pullup'])) {
      pulls += Number(e.value) || 0;
    }
  }
  return { plankMin: plankSec / 60, hangMin: hangSec / 60, pulls, push };
}
function trophyBounds() {
  let min = null;
  const max = todayKey();
  const consider = (k) => {
    if (!k || k > max) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
    if (!min || k < min) min = k;
  };
  for (const k of Object.keys(state.days || {})) consider(k);
  for (const k of Object.keys(state.bonusDays || {})) consider(k);
  for (const s of state.sessions) consider(s.date);
  return { min: min || max, max };
}
function eachDayKey(min, max, fn) {
  let d = parseKey(min);
  const end = parseKey(max);
  while (d <= end) {
    fn(dkey(d));
    d = addDays(d, 1);
  }
}
function weekPartsSince(monday) {
  const start = trophyStart();
  let main = 0, bonus = 0;
  for (let i = 0; i < 7; i++) {
    const k = dkey(addDays(monday, i));
    if (k < start) continue;
    if (isDayChecked(k)) main++;
    if (isBonus(k)) bonus++;
  }
  return { main, bonus };
}
function trophyFacts() {
  const { max } = trophyBounds();
  const start = trophyStart();
  const now = new Date();
  let streak = 0, bestStreak = 0;
  const streakAt = {};
  const bonusDates = [];
  const sessionHits = [];
  if (start <= max) {
    eachDayKey(start, max, (k) => {
      if (isDayChecked(k)) {
        streak++;
        if (streak > bestStreak) bestStreak = streak;
        for (const t of [7, 30, 100, 365]) if (streak === t && !streakAt[t]) streakAt[t] = k;
        sessionHits.push(k);
      } else streak = 0;
      if (isBonus(k)) {
        bonusDates.push(k);
        sessionHits.push(k);
      }
    });
  }
  let bestWeekMain = 0, bestWeekSum = 0, perfectWeek = null, doubleWeek = null;
  if (start <= max) {
    let monday = mondayOf(parseKey(start));
    const lastMonday = mondayOf(parseKey(max));
    while (monday <= lastMonday) {
      const p = weekPartsSince(monday);
      if (p.main > bestWeekMain) bestWeekMain = p.main;
      if (p.main + p.bonus > bestWeekSum) bestWeekSum = p.main + p.bonus;
      const sunday = dkey(addDays(monday, 6));
      if (sunday >= start && p.main === 7 && !perfectWeek) perfectWeek = sunday;
      if (sunday >= start && p.main === 7 && p.bonus === 7 && !doubleWeek) doubleWeek = sunday;
      monday = addDays(monday, 7);
    }
  }
  let bestMonth = { checked: 0, dim: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() };
  const completeMonths = [];
  if (start <= max) {
    const startDate = parseKey(start);
    let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const endM = parseKey(max);
    while (cursor.getFullYear() < endM.getFullYear() || (cursor.getFullYear() === endM.getFullYear() && cursor.getMonth() <= endM.getMonth())) {
      const y = cursor.getFullYear(), m = cursor.getMonth();
      const dim = new Date(y, m + 1, 0).getDate();
      let checked = 0;
      for (let day = 1; day <= dim; day++) {
        const k = dkey(new Date(y, m, day));
        if (k >= start && isDayChecked(k)) checked++;
      }
      const monthEnd = dkey(new Date(y, m, dim));
      const monthStart = dkey(new Date(y, m, 1));
      if (monthStart >= start && checked === dim && monthEnd <= max) completeMonths.push(monthEnd);
      if (checked / dim > bestMonth.checked / bestMonth.dim) bestMonth = { checked, dim };
      cursor = new Date(y, m + 1, 1);
    }
  }
  const est = programEstimates(state.program);
  const n = sessionHits.length;
  return {
    bestStreak, streakAt, bestWeekMain, bestWeekSum, perfectWeek, doubleWeek,
    bestMonth, completeMonths, bonusDates, sessionHits,
    reps: est.push, plankMin: est.plankMin, hangMin: est.hangMin, pullsPer: est.pulls,
    pompes: n * est.push,
    plank: n * est.plankMin,
    hang: n * est.hangMin,
    pulls: n * est.pulls
  };
}
function fmtTrophyDate(k) {
  return parseKey(k).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtInt(n) { return Math.round(n).toLocaleString('fr-FR'); }
function trophyBoard() {
  const f = trophyFacts();
  const hit = (list, n) => (list.length >= n ? list[n - 1] : null);
  const amountDate = (per, target) => (per > 0 ? hit(f.sessionHits, Math.ceil(target / per)) : null);
  const qty = (n) => {
    const r = Math.round(n * 10) / 10;
    return r.toLocaleString('fr-FR');
  };
  const defs = [
    { id: 'streak-7', group: 'Régularité', name: 'Recrue', desc: '7 jours cochés d’affilée.', unlocked: f.bestStreak >= 7, date: f.streakAt[7] || null, progress: `${f.bestStreak} / 7 jours` },
    { id: 'streak-30', group: 'Régularité', name: 'Camarade discipliné', desc: '30 jours cochés d’affilée.', unlocked: f.bestStreak >= 30, date: f.streakAt[30] || null, progress: `${f.bestStreak} / 30 jours` },
    { id: 'streak-100', group: 'Régularité', name: 'Héros du Travail', desc: '100 jours cochés d’affilée.', unlocked: f.bestStreak >= 100, date: f.streakAt[100] || null, progress: `${f.bestStreak} / 100 jours` },
    { id: 'streak-365', group: 'Régularité', name: 'Ordre de Lénine', desc: '365 jours cochés d’affilée.', unlocked: f.bestStreak >= 365, date: f.streakAt[365] || null, progress: `${f.bestStreak} / 365 jours` },
    { id: 'week-perfect', group: 'Semaines', name: 'Semaine parfaite', desc: 'Les 7 jours d’une semaine cochés.', unlocked: !!f.perfectWeek, date: f.perfectWeek, progress: `${f.bestWeekMain} / 7 jours` },
    { id: 'week-double', group: 'Semaines', name: 'Semaine double', desc: '7 jours cochés et 7 bonus la même semaine.', unlocked: !!f.doubleWeek, date: f.doubleWeek, progress: `${Math.min(f.bestWeekSum, 14)} / 14` },
    { id: 'month-full', group: 'Mois', name: 'Mois complet', desc: 'Tous les jours d’un mois cochés.', unlocked: f.completeMonths.length >= 1, date: f.completeMonths[0] || null, progress: `${f.bestMonth.checked} / ${f.bestMonth.dim} jours` },
    { id: 'month-5', group: 'Mois', name: 'Plan quinquennal', desc: 'Cinq mois complets, d’affilée ou non.', unlocked: f.completeMonths.length >= 5, date: f.completeMonths[4] || null, progress: `${f.completeMonths.length} / 5 mois` },
    { id: 'bonus-1', group: 'Bonus', name: 'Premier bonus', desc: 'La première séance bonus.', unlocked: f.bonusDates.length >= 1, date: hit(f.bonusDates, 1), progress: `${f.bonusDates.length} / 1 bonus` },
    { id: 'bonus-10', group: 'Bonus', name: 'Stakhanoviste', desc: 'Dix séances bonus.', unlocked: f.bonusDates.length >= 10, date: hit(f.bonusDates, 10), progress: `${f.bonusDates.length} / 10 bonus` },
    { id: 'bonus-50', group: 'Bonus', name: 'Stakhanoviste d’or', desc: 'Cinquante séances bonus.', unlocked: f.bonusDates.length >= 50, date: hit(f.bonusDates, 50), progress: `${f.bonusDates.length} / 50 bonus` },
    { id: 'sessions-50', group: 'Séances', name: '50 séances', desc: 'Cinquante séances, bonus compris.', unlocked: f.sessionHits.length >= 50, date: hit(f.sessionHits, 50), progress: `${f.sessionHits.length} / 50 séances` },
    { id: 'sessions-100', group: 'Séances', name: '100 séances', desc: 'Cent séances au compteur.', unlocked: f.sessionHits.length >= 100, date: hit(f.sessionHits, 100), progress: `${f.sessionHits.length} / 100 séances` },
    { id: 'sessions-250', group: 'Séances', name: '250 séances', desc: 'Deux cent cinquante séances.', unlocked: f.sessionHits.length >= 250, date: hit(f.sessionHits, 250), progress: `${f.sessionHits.length} / 250 séances` },
    { id: 'sessions-500', group: 'Séances', name: '500 séances', desc: 'Cinq cents séances.', unlocked: f.sessionHits.length >= 500, date: hit(f.sessionHits, 500), progress: `${f.sessionHits.length} / 500 séances` },
    { id: 'push-1000', group: 'Pompes', name: '1 000 pompes', desc: 'Estimation : séances × pompes du programme.', unlocked: f.pompes >= 1000, date: amountDate(f.reps, 1000), progress: `${fmtInt(f.pompes)} / ${fmtInt(1000)} (estimation)` },
    { id: 'push-10000', group: 'Pompes', name: '10 000 pompes', desc: 'Estimation d’après le programme actuel.', unlocked: f.pompes >= 10000, date: amountDate(f.reps, 10000), progress: `${fmtInt(f.pompes)} / ${fmtInt(10000)} (estimation)` },
    { id: 'push-50000', group: 'Pompes', name: '50 000 pompes', desc: 'Estimation. Le programme actuel sert de base.', unlocked: f.pompes >= 50000, date: amountDate(f.reps, 50000), progress: `${fmtInt(f.pompes)} / ${fmtInt(50000)} (estimation)` },
    { id: 'plank-10', group: 'Planche', name: 'Sentinelle', desc: '10 minutes de planche. Estimation.', unlocked: f.plank >= 10, date: amountDate(f.plankMin, 10), progress: `${qty(f.plank)} / 10 min (estimation)` },
    { id: 'plank-60', group: 'Planche', name: 'Colonne d’acier', desc: '60 minutes de planche. Estimation.', unlocked: f.plank >= 60, date: amountDate(f.plankMin, 60), progress: `${qty(f.plank)} / 60 min (estimation)` },
    { id: 'plank-300', group: 'Planche', name: 'Mur du Kremlin', desc: '300 minutes de planche. Estimation.', unlocked: f.plank >= 300, date: amountDate(f.plankMin, 300), progress: `${qty(f.plank)} / 300 min (estimation)` },
    { id: 'plank-1000', group: 'Planche', name: 'Fondation d’acier', desc: '1 000 minutes de planche. Estimation.', unlocked: f.plank >= 1000, date: amountDate(f.plankMin, 1000), progress: `${qty(f.plank)} / ${fmtInt(1000)} min (estimation)` },
    { id: 'hang-10', group: 'Suspension', name: 'Première prise', desc: '10 minutes de suspension. Estimation.', unlocked: f.hang >= 10, date: amountDate(f.hangMin, 10), progress: `${qty(f.hang)} / 10 min (estimation)` },
    { id: 'hang-60', group: 'Suspension', name: 'Barre d’acier', desc: '60 minutes de suspension. Estimation.', unlocked: f.hang >= 60, date: amountDate(f.hangMin, 60), progress: `${qty(f.hang)} / 60 min (estimation)` },
    { id: 'hang-300', group: 'Suspension', name: 'Vigie rouge', desc: '300 minutes de suspension. Estimation.', unlocked: f.hang >= 300, date: amountDate(f.hangMin, 300), progress: `${qty(f.hang)} / 300 min (estimation)` },
    { id: 'pull-100', group: 'Tractions', name: 'Cent tractions', desc: '100 tractions. Estimation.', unlocked: f.pulls >= 100, date: amountDate(f.pullsPer, 100), progress: `${fmtInt(f.pulls)} / 100 (estimation)` },
    { id: 'pull-1000', group: 'Tractions', name: 'Millier de la barre', desc: '1 000 tractions. Estimation.', unlocked: f.pulls >= 1000, date: amountDate(f.pullsPer, 1000), progress: `${fmtInt(f.pulls)} / ${fmtInt(1000)} (estimation)` },
    { id: 'pull-5000', group: 'Tractions', name: 'Légende de la barre', desc: '5 000 tractions. Estimation.', unlocked: f.pulls >= 5000, date: amountDate(f.pullsPer, 5000), progress: `${fmtInt(f.pulls)} / ${fmtInt(5000)} (estimation)` }
  ];
  return defs;
}
function unseenTrophies() {
  const seen = new Set(seenList(state.seenTrophies));
  return trophyBoard().filter((t) => t.unlocked && !seen.has(t.id));
}
function maybeShowTrophyOverlay() {
  const el = document.getElementById('trophy-overlay');
  if (!el || !el.classList.contains('hidden')) return;
  const fresh = unseenTrophies();
  if (!fresh.length) return;
  const many = fresh.length > 1;
  const title = many ? 'Nouveaux trophées' : fresh[0].name;
  const body = many
    ? `<ul>${fresh.map((t) => `<li>${esc(t.name)}</li>`).join('')}</ul>`
    : `<p class="muted">${esc(fresh[0].desc)}</p>`;
  el.innerHTML = `<div class="trophy-pop">
    <img src="images/etoile-kremlin.png" alt="" width="140" height="140">
    <h2>${esc(title)}</h2>
    ${body}
    <button class="btn primary" type="button" data-action="close-trophies">Continuer</button>
  </div>`;
  el.dataset.ids = fresh.map((t) => t.id).join(',');
  el.classList.remove('hidden');
  el.setAttribute('aria-label', title);
  const btn = el.querySelector('button');
  if (btn) btn.focus();
}
function dismissTrophyOverlay() {
  const el = document.getElementById('trophy-overlay');
  if (!el || el.classList.contains('hidden')) return;
  const ids = (el.dataset.ids || '').split(',').filter(Boolean);
  const seen = seenList(state.seenTrophies);
  for (const id of ids) if (!seen.includes(id)) seen.push(id);
  state.seenTrophies = seen;
  el.classList.add('hidden');
  el.innerHTML = '';
  delete el.dataset.ids;
  save();
}

/* =========================================================================
   Écrans
   ========================================================================= */
const TABS = ['accueil', 'semaine', 'calories', 'programme', 'trophees'];
function currentTab() { const h = location.hash.replace('#', ''); return TABS.includes(h) ? h : 'accueil'; }

function render() {
  const tab = currentTab();
  document.body.classList.remove('home', 'semaine', 'calories', 'programme', 'trophees');
  document.body.classList.add(tab === 'accueil' ? 'home' : tab);
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const app = document.getElementById('app');
  app.innerHTML = ({ accueil: viewHome, semaine: viewWeek, calories: viewCalories, programme: viewProgram, trophees: viewTrophees })[tab]();
  maybeShowTrophyOverlay();
  musicPaint();
}

/* ----- 1. Accueil ----- */
function viewHome() {
  const now = new Date();
  const t = ensureToday();
  const k = todayKey();
  const done = sessionOn(k);
  const bonusDone = bonusSessionOn(k);
  const exs = exercises();
  const motto = "T'as pas l'temps parce que t'es un lâche";
  const week = weekParts(mondayOf(now));

  let h = `<section class="hero">
    <h1 class="app-name" aria-label="${esc(APP_NAME)}">ДАVАЙ SUКА</h1>
    <p class="motto">${esc(motto)}</p>
    <span class="date-pill">📅 ${esc(fmtLong(now))}</span>
  </section>
  <div class="stats" style="margin-top:16px">
    <div class="stat"><div class="v">${week.total}<span class="muted" style="font-size:18px"> / 7</span></div><div class="l">Cette semaine${week.bonus ? ` · ${esc(bonusNote(week.bonus))}` : ''}</div></div>
    <div class="stat"><div class="v o">${state.sessions.length}</div><div class="l">Séances au total</div></div>
  </div>`;

  if (done) {
    h += `<div class="done-banner">
      <div class="big">✅ Séance du jour terminée !</div>
      <div class="muted" style="margin-top:6px">${done.exDone}/${done.exTotal} exercices · ≈ ${fmtKcal(done.kcal)} kcal <span class="badge">Estimation</span></div>
      <div style="margin-top:6px">Bravo, à demain 🔥</div>
    </div>`;
    if (bonusDone) {
      h += `<div class="done-banner bonus-banner">
        <div class="big">★ Séance bonus enregistrée</div>
        <div class="muted" style="margin-top:6px">${bonusDone.exDone}/${bonusDone.exTotal} exercices · ≈ ${fmtKcal(bonusDone.kcal)} kcal <span class="badge">Estimation</span></div>
      </div>
      <button class="btn ghost" data-action="undo-bonus">Annuler la séance bonus</button>`;
    } else if (t.bonus && t.bonus.started) {
      const checked = Array.isArray(t.bonus.checked) ? t.bonus.checked : [];
      const nDone = exs.filter((e) => checked.includes(e.id)).length;
      const pct = exs.length ? Math.round((nDone / exs.length) * 100) : 0;
      h += `<div class="card">
        <div class="row"><h3 style="margin:0">Séance bonus</h3><div class="spacer"></div><strong id="count">${nDone} / ${exs.length}</strong></div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        ${exerciseChecklist(checked, 'toggle-bonus-ex')}
      </div>
      <button class="btn orange" data-action="finish-bonus">Séance bonus terminée</button>
      <p class="muted small" style="text-align:center">Même programme que la séance du jour. Les calories sont calculées de la même façon.</p>`;
    } else {
      h += `<button class="btn orange" data-action="start-bonus">Séance bonus</button>`;
    }
    h += `${musicPanelHtml()}<button class="btn ghost" data-action="undo-session">Annuler la séance du jour</button>`;
    return h;
  }

  if (!t.started) {
    h += `<div class="card">
      <h3>Séance du jour</h3>
      <button class="btn primary" data-action="start">▶ Commencer la séance du jour</button>
      ${musicPanelHtml()}
    </div>`;
    return h;
  }

  const nDone = exs.filter((e) => t.checked.includes(e.id)).length;
  const pct = exs.length ? Math.round((nDone / exs.length) * 100) : 0;
  const allOn = exs.length > 0 && nDone === exs.length;
  h += `<div class="card">
    <div class="row"><h3 style="margin:0">Séance du jour</h3><div class="spacer"></div><strong id="count">${nDone} / ${exs.length}</strong></div>
    <button type="button" class="btn check-all" data-action="${allOn ? 'uncheck-all' : 'check-all'}">${allOn ? 'Tout décocher' : 'Tout cocher'}</button>
    <div class="progress"><div style="width:${pct}%"></div></div>
    ${exerciseChecklist(t.checked, 'toggle-ex')}
  </div>
  ${musicPanelHtml()}
  <button class="btn primary" data-action="finish">🏁 Séance terminée</button>`;
  return h;
}
function exerciseChecklist(checked, action) {
  let html = `<ul class="ex-list">`;
  for (const e of state.program) {
    if (e.kind === 'pause') { html += `<li class="pause-sep">Pause</li>`; continue; }
    const on = checked.includes(e.id);
    html += `<li class="ex-item ${on ? 'done' : ''}" data-action="${action}" data-id="${e.id}" role="checkbox" aria-checked="${on}" tabindex="0">
      <span class="check">✓</span>
      <div class="ex-copy"><div class="ex-name">${esc(e.name)}</div>${e.note ? `<div class="ex-meta">${esc(e.note)}</div>` : ''}</div>
      ${timerExButton(e)}
      <span class="ex-val">${esc(fmtVal(e))}</span>
    </li>`;
  }
  return html + `</ul>`;
}

/* ----- 2. Calendrier ----- */
function viewWeek() {
  const mode = ui.calMode === 'month' ? 'month' : 'week';
  let h = `<h2 class="screen-title">Calendrier</h2>
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
  const parts = weekParts(monday);
  const n = parts.total;
  let h = `<div class="week-nav">
    <button class="icon-btn" data-action="week-prev" aria-label="Semaine précédente">‹</button>
    <div class="lbl">${title}<div class="muted small">${esc(fmtShort(monday))} – ${esc(fmtShort(sunday))}</div></div>
    <button class="icon-btn" data-action="week-next" aria-label="Semaine suivante" ${off >= 0 ? 'disabled' : ''}>›</button>
  </div>
  <div class="card"><div class="week">`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i), k = dkey(d);
    const on = isDayChecked(k), bonus = isBonus(k), future = k > tk;
    h += `<div class="day-col">
      <button class="day ${k === tk ? 'today' : ''}" data-action="toggle-day" data-date="${k}" ${future ? 'disabled' : ''} aria-pressed="${on}" aria-label="${DAY_SHORT[i]} ${d.getDate()}">
        <span class="dn">${DAY_SHORT[i]}</span><span class="dd">${d.getDate()}</span>
        <span class="check ${on ? 'on' : ''}">✓</span>
        <span class="fire">${loggedOn(k) ? '🔥' : ''}</span>
      </button>
      <button type="button" class="bonus-btn${bonus ? ' on' : ''}" data-action="toggle-bonus" data-date="${k}" ${future ? 'disabled' : ''} aria-pressed="${bonus}" aria-label="Bonus ${DAY_SHORT[i]} ${d.getDate()}">
        <span class="star" aria-hidden="true">★</span><span class="bonus-lbl">Bonus</span>
      </button>
    </div>`;
  }
  h += `</div>
  <div class="week-total"><div class="n" id="week-total">${n}<span> / 7</span></div>
  ${parts.bonus ? `<div class="bonus-note" id="bonus-note">${esc(bonusNote(parts.bonus))}</div>` : ''}
  <div class="dots">${Array.from({ length: 7 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>
  <div class="muted" id="week-motivation" style="margin-top:10px">${esc(weekMotivation(n))}</div></div>
  </div>
  <div class="cal-legends">
    <p class="cal-legend"><span class="check on sym" aria-hidden="true">✓</span><span>= séance complétée précédemment</span></p>
    <p class="cal-legend"><span class="sym" aria-hidden="true">🔥</span><span>= séance enregistrée ce jour-là</span></p>
  </div>`;
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
  const parts = monthParts(y, m);
  const checked = parts.total;
  const atMin = monthIndex(y, m) <= monthIndex(EARLIEST_MONTH.y, EARLIEST_MONTH.m);
  const atMax = monthIndex(y, m) >= monthIndex(now.getFullYear(), now.getMonth());
  const years = [];
  for (let yy = EARLIEST_MONTH.y; yy <= now.getFullYear(); yy++) years.push(yy);
  let h = `<div class="week-nav">
    <button class="icon-btn" data-action="month-prev" aria-label="Mois précédent" ${atMin ? 'disabled' : ''}>‹</button>
    <div class="lbl">${esc(capMonth(m))} ${y}<div class="muted small">${checked} séance${checked > 1 ? 's' : ''}${parts.bonus ? ` · ${esc(bonusNote(parts.bonus))}` : ''}</div></div>
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
    const bonus = isBonus(k);
    const future = k > tk;
    h += `<div class="cal-cell">
      <button type="button" class="cal-day${on ? ' on' : ''}${k === tk ? ' today' : ''}" data-action="toggle-day" data-date="${k}" ${future ? 'disabled' : ''} aria-pressed="${on}" aria-label="${d} ${esc(MONTH_FR[m])} ${y}${on ? ', coché' : ''}">${d}${on ? '<span class="mark" aria-hidden="true">✓</span>' : ''}</button>
      <button type="button" class="cal-bonus${bonus ? ' on' : ''}" data-action="toggle-bonus" data-date="${k}" ${future ? 'disabled' : ''} aria-pressed="${bonus}" aria-label="Bonus ${d} ${esc(MONTH_FR[m])} ${y}">★</button>
    </div>`;
  }
  h += `</div>
  <div class="week-total"><div class="n" id="month-total">${checked}<span> séance${checked > 1 ? 's' : ''}</span></div>
  ${parts.bonus ? `<div class="bonus-note">${esc(bonusNote(parts.bonus))}</div>` : ''}
  <div class="muted" style="margin-top:8px">Présences du mois, bonus compris. Un jour coché compte dans les totaux, sans calories.</div></div>
  </div>
  <p class="cal-legend">Les jours à venir sont verrouillés.</p>`;
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
      h += `<li><div><div class="ex-name" style="text-transform:capitalize">${esc(parseKey(s.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}${s.bonus ? ' · bonus' : ''}</div>
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
  let h = `<h2 class="screen-title">Programme</h2>${musicPanelHtml()}<div class="card"><h3>Ma séance</h3>`;
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

/* ----- 5. Trophées ----- */
function viewTrophees() {
  const items = trophyBoard();
  const got = items.filter((t) => t.unlocked).length;
  let h = `<h2 class="screen-title">Trophées</h2>
  <p class="trophy-score">${got} / ${items.length}</p>
  <p class="muted small trophy-since">Comptés depuis le 18 octobre 2026</p>`;
  let group = '';
  for (const t of items) {
    if (t.group !== group) {
      if (group) h += `</div>`;
      group = t.group;
      h += `<h3 class="trophy-group">${esc(group)}</h3><div class="trophy-grid">`;
    }
    const when = t.unlocked && t.date ? `Obtenu le ${fmtTrophyDate(t.date)}` : (t.unlocked ? 'Obtenu' : t.progress);
    h += `<article class="trophy ${t.unlocked ? 'unlocked' : 'locked'}">
      <img src="images/etoile-kremlin.png" alt="" width="72" height="72" class="${t.unlocked ? 'on' : 'off'}">
      <div class="trophy-name">${esc(t.name)}</div>
      <p class="trophy-desc">${esc(t.desc)}</p>
      <div class="trophy-progress">${esc(when)}</div>
    </article>`;
  }
  if (group) h += `</div>`;
  h += `<p class="muted small" style="text-align:center">Depuis le 18 octobre 2026. Les jours d’avant restent dans Calendrier et Calories. Planche, suspension, tractions et pompes sont une estimation.</p>`;
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
   Minuteur Planche / Hanging
   Réglages et course : uniquement davaisuka.timer.v1.
   N’écrit jamais dans les séances, les jours, ni les trophées.
   ========================================================================= */
const TIMER_KEY = 'davaisuka.timer.v1';
const TIMER_COUNTDOWN_MS = 3000;
const TIMER_MIN_SEC = 15;
const TIMER_MAX_SEC = 3600;
const TIMER_LABEL = { planche: 'Planche', hanging: 'Hanging' };
const TIMER_DONE_TEXT = 'Terminé ! Devoir accompli, camarade.';
const TIMER_READY_TEXT = 'Prêt… Davai !';

let timer = null;
let timerScreenOn = false;
let timerAudioCtx = null;
let timerUiKey = '';
let timerAlarming = false;

function timerBlank() {
  return {
    durations: { planche: 120, hanging: 60 },
    selected: 'planche',
    phase: 'idle',
    endAt: null,
    remainingMs: null,
    pausedFrom: null,
    alarmed: false
  };
}
function clampTimerSec(sec, fallback) {
  const n = Math.round(Number(sec));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(TIMER_MAX_SEC, Math.max(TIMER_MIN_SEC, n));
}
function loadTimer() {
  const t = timerBlank();
  try {
    const raw = localStorage.getItem(TIMER_KEY);
    if (!raw) return t;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || Array.isArray(d)) return t;
    if (d.durations && typeof d.durations === 'object') {
      t.durations.planche = clampTimerSec(d.durations.planche, 120);
      t.durations.hanging = clampTimerSec(d.durations.hanging, 60);
    }
    if (d.selected === 'hanging') t.selected = 'hanging';
    if (['idle', 'countdown', 'running', 'paused', 'done'].includes(d.phase)) t.phase = d.phase;
    if (Number.isFinite(d.endAt)) t.endAt = d.endAt;
    if (Number.isFinite(d.remainingMs)) t.remainingMs = d.remainingMs;
    if (d.pausedFrom === 'countdown' || d.pausedFrom === 'running') t.pausedFrom = d.pausedFrom;
    t.alarmed = d.alarmed === true;
  } catch (e) { return timerBlank(); }
  if ((t.phase === 'countdown' || t.phase === 'running') && !Number.isFinite(t.endAt)) t.phase = 'idle';
  if (t.phase === 'paused' && !Number.isFinite(t.remainingMs)) t.phase = 'idle';
  return t;
}
function saveTimer() {
  try { localStorage.setItem(TIMER_KEY, JSON.stringify(timer)); }
  catch (e) { /* le minuteur reste utilisable même si le stockage refuse */ }
}
function timerKindFor(ex) {
  if (!ex || ex.kind === 'pause') return null;
  const n = normalize(ex.name);
  if (n.includes('planche') || n.includes('plank') || n.includes('gainage')) return 'planche';
  if (n.includes('hanging') || n.includes('suspension') || n.includes('barre')) return 'hanging';
  return null;
}
function timerExButton(ex) {
  const kind = timerKindFor(ex);
  if (!kind) return '';
  return `<button type="button" class="timer-ex" data-action="timer-open" data-kind="${kind}" aria-label="Minuteur ${TIMER_LABEL[kind]}">⏱</button>`;
}
function timerBusy() {
  return timer.phase === 'countdown' || timer.phase === 'running' || timer.phase === 'paused';
}
function timerDisplayMs() {
  const now = Date.now();
  if ((timer.phase === 'countdown' || timer.phase === 'running') && Number.isFinite(timer.endAt)) {
    return Math.max(0, timer.endAt - now);
  }
  if (timer.phase === 'paused') return Math.max(0, timer.remainingMs || 0);
  if (timer.phase === 'done') return 0;
  return (timer.durations[timer.selected] || 0) * 1000;
}
function formatTimer(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}
function timerScreenClock() {
  if (timer.phase === 'countdown') return String(Math.max(1, Math.ceil(timerDisplayMs() / 1000)));
  return formatTimer(timerDisplayMs());
}
function timerUnlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!timerAudioCtx) timerAudioCtx = new Ctx();
    if (timerAudioCtx.state === 'suspended') timerAudioCtx.resume();
  } catch (e) {}
}
function timerBeep(ctx) {
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.06, now + i * 0.16 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.15);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(now + i * 0.16);
    o.stop(now + i * 0.16 + 0.16);
  });
}
function timerAlarm() {
  if (!timer || timer.alarmed || timerAlarming) return;
  timerAlarming = true;
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]); } catch (e) {}
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { timer.alarmed = true; timerAlarming = false; saveTimer(); return; }
    if (!timerAudioCtx) timerAudioCtx = new Ctx();
    const go = () => {
      try { timerBeep(timerAudioCtx); } catch (e) {}
      timer.alarmed = true;
      timerAlarming = false;
      saveTimer();
    };
    if (timerAudioCtx.state === 'suspended') {
      timerAudioCtx.resume().then(go).catch(() => { timerAlarming = false; });
      return;
    }
    go();
  } catch (e) { timerAlarming = false; }
}
let timerWakeSentinel = null;
function timerWake(active) {
  try {
    if (!navigator.wakeLock) return;
    if (!active) {
      if (timerWakeSentinel) {
        const s = timerWakeSentinel;
        timerWakeSentinel = null;
        s.release().catch(() => {});
      }
      return;
    }
    if (timerWakeSentinel) return;
    navigator.wakeLock.request('screen').then((sentinel) => {
      timerWakeSentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (timerWakeSentinel === sentinel) timerWakeSentinel = null;
      });
    }).catch(() => {});
  } catch (e) {}
}
function timerCatchUp() {
  if (!timer) return;
  const now = Date.now();
  if (timer.phase === 'countdown' && Number.isFinite(timer.endAt) && now >= timer.endAt) {
    timer.phase = 'running';
    timer.endAt = timer.endAt + (timer.durations[timer.selected] || 0) * 1000;
    timer.pausedFrom = null;
    saveTimer();
  }
  if (timer.phase === 'running' && Number.isFinite(timer.endAt) && now >= timer.endAt) {
    timer.phase = 'done';
    timer.endAt = null;
    timer.remainingMs = 0;
    timer.pausedFrom = null;
    saveTimer();
    timerWake(false);
    timerAlarm();
  }
}
function timerStart() {
  timer.phase = 'countdown';
  timer.endAt = Date.now() + TIMER_COUNTDOWN_MS;
  timer.remainingMs = null;
  timer.pausedFrom = null;
  timer.alarmed = false;
  saveTimer();
  timerUnlockAudio();
  timerWake(true);
  timerPaint(true);
}
function timerPause() {
  if (timer.phase !== 'countdown' && timer.phase !== 'running') return;
  timer.pausedFrom = timer.phase;
  timer.remainingMs = Math.max(0, (timer.endAt || Date.now()) - Date.now());
  timer.phase = 'paused';
  timer.endAt = null;
  saveTimer();
  timerWake(false);
  timerPaint(true);
}
function timerResume() {
  if (timer.phase !== 'paused') return;
  timer.phase = timer.pausedFrom === 'countdown' ? 'countdown' : 'running';
  timer.endAt = Date.now() + Math.max(0, timer.remainingMs || 0);
  timer.remainingMs = null;
  saveTimer();
  timerWake(true);
  timerCatchUp();
  timerPaint(true);
}
function timerReset() {
  timer.phase = 'idle';
  timer.endAt = null;
  timer.remainingMs = null;
  timer.pausedFrom = null;
  timer.alarmed = false;
  saveTimer();
  timerWake(false);
  timerPaint(true);
}
function timerPick(kind) {
  if (kind !== 'planche' && kind !== 'hanging') return;
  if (timerBusy()) return;
  if (timer.phase === 'done') {
    timer.phase = 'idle';
    timer.alarmed = false;
    timer.endAt = null;
    timer.remainingMs = null;
  }
  timer.selected = kind;
  saveTimer();
  timerPaint(true);
}
function timerStep(delta) {
  if (timerBusy()) return;
  if (timer.phase === 'done') {
    timer.phase = 'idle';
    timer.alarmed = false;
  }
  timer.durations[timer.selected] = clampTimerSec((timer.durations[timer.selected] || 0) + delta, timer.durations[timer.selected]);
  saveTimer();
  timerPaint(true);
}
function timerCommitDuration() {
  if (!timer || timerBusy()) return;
  const minEl = document.getElementById('timer-min');
  const secEl = document.getElementById('timer-sec');
  if (!minEl || !secEl) return;
  if (timer.phase === 'done') {
    timer.phase = 'idle';
    timer.alarmed = false;
  }
  timer.durations[timer.selected] = clampTimerSec((Number(minEl.value) || 0) * 60 + (Number(secEl.value) || 0), timer.durations[timer.selected]);
  saveTimer();
  timerPaint(true);
}
function timerOpenScreen(kind) {
  if (kind === 'planche' || kind === 'hanging') {
    if (!timerBusy()) {
      if (timer.phase === 'done' && kind !== timer.selected) {
        timer.phase = 'idle';
        timer.alarmed = false;
        timer.endAt = null;
        timer.remainingMs = null;
      }
      timer.selected = kind;
      saveTimer();
    }
  }
  timerScreenOn = true;
  timerPaint(true);
}
function timerMount() {
  const layer = document.getElementById('timer-layer');
  if (!layer || layer.childElementCount) return;
  layer.innerHTML = `
    <button type="button" id="timer-fab" class="timer-fab" data-action="timer-open">Minuteur</button>
    <div id="timer-bar" class="timer-bar hidden">
      <button type="button" class="timer-bar-main" data-action="timer-open">
        <span id="timer-bar-name"></span>
        <span id="timer-bar-time"></span>
      </button>
      <button type="button" class="timer-bar-btn" id="timer-bar-toggle" data-action="timer-pause">Pause</button>
    </div>
    <audio id="music-audio" preload="none" playsinline>
      <source src="audio/playlist.ogg" type="audio/ogg">
      <source src="audio/playlist.mp3" type="audio/mpeg">
    </audio>
    <div id="music-float" class="music-float hidden">
      <span class="music-float-name">Musique</span>
      <button type="button" id="music-float-btn" class="music-float-btn" data-action="music-pause">Pause</button>
    </div>
    <section id="timer-screen" class="timer-screen hidden" aria-label="Minuteur">
      <button type="button" class="timer-close" data-action="timer-close">Fermer</button>
      <h2>Minuteur</h2>
      <div class="timer-picks">
        <button type="button" id="timer-pick-planche" data-action="timer-pick" data-kind="planche">Planche</button>
        <button type="button" id="timer-pick-hanging" data-action="timer-pick" data-kind="hanging">Hanging</button>
      </div>
      <p id="timer-phrase" class="timer-phrase hidden" aria-live="polite"></p>
      <div id="timer-clock" class="timer-clock">2:00</div>
      <p id="timer-done" class="timer-done hidden" aria-live="polite">${TIMER_DONE_TEXT}</p>
      <div id="timer-dur" class="timer-dur">
        <span class="timer-dur-label">Durée</span>
        <button type="button" data-action="timer-step" data-d="-15" aria-label="Retirer 15 secondes">−15 s</button>
        <input id="timer-min" type="number" inputmode="numeric" min="0" max="60" aria-label="Minutes" autocomplete="off">
        <span class="timer-colon" aria-hidden="true">:</span>
        <input id="timer-sec" type="number" inputmode="numeric" min="0" max="59" aria-label="Secondes" autocomplete="off">
        <button type="button" data-action="timer-step" data-d="15" aria-label="Ajouter 15 secondes">+15 s</button>
      </div>
      <button type="button" id="timer-start" class="btn timer-go" data-action="timer-start">Démarrer</button>
      <button type="button" id="timer-pause" class="btn timer-go" data-action="timer-pause">Pause</button>
      <button type="button" id="timer-resume" class="btn timer-go" data-action="timer-resume">Reprendre</button>
      <button type="button" id="timer-reset" class="btn timer-stop" data-action="timer-reset">Réinitialiser</button>
      ${musicPanelHtml()}
      <p class="timer-note">Ce minuteur n’enregistre aucune séance.</p>
    </section>`;
}
function timerSyncInputs() {
  const minEl = document.getElementById('timer-min');
  const secEl = document.getElementById('timer-sec');
  if (!minEl || !secEl) return;
  if (document.activeElement === minEl || document.activeElement === secEl) return;
  const total = timer.durations[timer.selected] || 0;
  minEl.value = String(Math.floor(total / 60));
  secEl.value = String(total % 60);
}
function timerPaint(full) {
  if (!timer) return;
  timerCatchUp();
  const bar = document.getElementById('timer-bar');
  const fab = document.getElementById('timer-fab');
  const screen = document.getElementById('timer-screen');
  if (!bar || !fab || !screen) return;
  const live = timer.phase === 'countdown' || timer.phase === 'running' || timer.phase === 'paused' || timer.phase === 'done';
  bar.classList.toggle('hidden', !live || timerScreenOn);
  fab.classList.add('hidden');
  screen.classList.toggle('hidden', !timerScreenOn);
  document.body.classList.toggle('timer-live', live && !timerScreenOn);

  const clock = document.getElementById('timer-clock');
  if (clock) {
    clock.textContent = timerScreenClock();
    clock.classList.toggle('countdown', timer.phase === 'countdown');
  }
  const phrase = document.getElementById('timer-phrase');
  if (phrase) {
    const show = timer.phase === 'countdown';
    phrase.textContent = show ? TIMER_READY_TEXT : '';
    phrase.classList.toggle('hidden', !show);
  }
  const done = document.getElementById('timer-done');
  if (done) done.classList.toggle('hidden', timer.phase !== 'done');

  const barName = document.getElementById('timer-bar-name');
  const barTime = document.getElementById('timer-bar-time');
  if (timer.phase === 'done') {
    if (barName) barName.textContent = TIMER_DONE_TEXT;
    if (barTime) barTime.textContent = '';
  } else {
    if (barName) barName.textContent = TIMER_LABEL[timer.selected] || '';
    if (barTime) barTime.textContent = formatTimer(timerDisplayMs());
  }
  const barMain = document.querySelector('.timer-bar-main');
  if (barMain) {
    if (currentTab() === 'accueil') barMain.dataset.action = 'timer-open';
    else delete barMain.dataset.action;
  }
  const toggle = document.getElementById('timer-bar-toggle');
  if (toggle) {
    if (timer.phase === 'paused') {
      toggle.classList.remove('hidden');
      toggle.dataset.action = 'timer-resume';
      toggle.textContent = 'Reprendre';
    } else if (timer.phase === 'countdown' || timer.phase === 'running') {
      toggle.classList.remove('hidden');
      toggle.dataset.action = 'timer-pause';
      toggle.textContent = 'Pause';
    } else {
      toggle.classList.add('hidden');
    }
  }

  const key = timer.phase + '|' + timer.selected + '|' + (timerScreenOn ? '1' : '0') + '|' + timer.durations.planche + '|' + timer.durations.hanging;
  if (!full && key === timerUiKey) return;
  timerUiKey = key;
  const locked = timerBusy();
  const plancheBtn = document.getElementById('timer-pick-planche');
  const hangingBtn = document.getElementById('timer-pick-hanging');
  if (plancheBtn) {
    plancheBtn.classList.toggle('on', timer.selected === 'planche');
    plancheBtn.disabled = locked;
    plancheBtn.setAttribute('aria-pressed', timer.selected === 'planche' ? 'true' : 'false');
  }
  if (hangingBtn) {
    hangingBtn.classList.toggle('on', timer.selected === 'hanging');
    hangingBtn.disabled = locked;
    hangingBtn.setAttribute('aria-pressed', timer.selected === 'hanging' ? 'true' : 'false');
  }
  const dur = document.getElementById('timer-dur');
  if (dur) dur.querySelectorAll('button, input').forEach((el) => { el.disabled = locked; });
  timerSyncInputs();
  const show = (id, on) => {
    const node = document.getElementById(id);
    if (node) node.classList.toggle('hidden', !on);
  };
  show('timer-start', timer.phase === 'idle' || timer.phase === 'done');
  show('timer-pause', timer.phase === 'countdown' || timer.phase === 'running');
  show('timer-resume', timer.phase === 'paused');
  show('timer-reset', timer.phase !== 'idle');
  musicPaint();
}
function onTimerAction(el) {
  const action = el.dataset.action;
  if (action === 'timer-open') {
    if (el.classList.contains('timer-bar-main') && currentTab() !== 'accueil') return;
    timerOpenScreen(el.dataset.kind || '');
  }
  else if (action === 'timer-close') { timerScreenOn = false; timerPaint(true); }
  else if (action === 'timer-pick') timerPick(el.dataset.kind);
  else if (action === 'timer-step') timerStep(Number(el.dataset.d) || 0);
  else if (action === 'timer-start') timerStart();
  else if (action === 'timer-pause') timerPause();
  else if (action === 'timer-resume') timerResume();
  else if (action === 'timer-reset') timerReset();
}
function timerInit() {
  timer = loadTimer();
  timerMount();
  musicBind();
  timerCatchUp();
  if (timer.phase === 'done' && !timer.alarmed) timerAlarm();
  timerWake(timer.phase === 'countdown' || timer.phase === 'running');
  timerPaint(true);
  setInterval(() => timerPaint(false), 200);
}
/* =========================================================================
   Musique de séance
   Lecteur indépendant du minuteur. N’écrit rien dans les séances ni les trophées.
   ========================================================================= */
let musicEnded = false;

function musicState() {
  const a = document.getElementById('music-audio');
  if (!a || musicEnded) return 'idle';
  if (!a.paused) return 'playing';
  if (a.currentTime > 0.2) return 'paused';
  return 'idle';
}
function musicPanelHtml() {
  const st = musicState();
  return `<div class="music-box">
    <h3>Musique</h3>
    <p class="music-hint">Deux morceaux enchaînés, hors ligne.</p>
    <div class="music-actions">
      <button type="button" class="btn music-go music-play${st === 'idle' ? '' : ' hidden'}" data-action="music-play">Musique</button>
      <button type="button" class="btn music-go music-pause${st === 'playing' ? '' : ' hidden'}" data-action="music-pause">Pause</button>
      <button type="button" class="btn music-go music-resume${st === 'paused' ? '' : ' hidden'}" data-action="music-resume">Reprendre</button>
      <button type="button" class="btn music-stop-btn music-stop${st === 'idle' ? ' hidden' : ''}" data-action="music-stop">Arrêter</button>
    </div>
  </div>`;
}
function musicPaint() {
  const st = musicState();
  const hide = (sel, off) => document.querySelectorAll(sel).forEach((el) => el.classList.toggle('hidden', off));
  hide('.music-play', st !== 'idle');
  hide('.music-pause', st !== 'playing');
  hide('.music-resume', st !== 'paused');
  hide('.music-stop', st === 'idle');
  const float = document.getElementById('music-float');
  if (!float) return;
  const show = st !== 'idle' && !timerScreenOn;
  float.classList.toggle('hidden', !show);
  document.body.classList.toggle('music-live', show);
  const btn = document.getElementById('music-float-btn');
  if (btn) {
    const playing = st === 'playing';
    btn.textContent = playing ? 'Pause' : 'Reprendre';
    btn.dataset.action = playing ? 'music-pause' : 'music-resume';
  }
}
function musicPlay() {
  const a = document.getElementById('music-audio');
  if (!a) return;
  if (musicEnded || a.ended) {
    try { a.currentTime = 0; } catch (e) {}
  }
  musicEnded = false;
  const pending = a.play();
  if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  musicPaint();
}
function musicPause() {
  const a = document.getElementById('music-audio');
  if (a) a.pause();
  musicPaint();
}
function musicStop() {
  const a = document.getElementById('music-audio');
  if (!a) return;
  a.pause();
  musicEnded = false;
  try { a.currentTime = 0; } catch (e) {}
  musicPaint();
}
function musicBind() {
  const a = document.getElementById('music-audio');
  if (!a || a.dataset.bound) return;
  a.dataset.bound = '1';
  a.addEventListener('play', () => { musicEnded = false; musicPaint(); });
  a.addEventListener('pause', () => musicPaint());
  a.addEventListener('ended', () => { musicEnded = true; musicPaint(); });
}
function onMusicAction(el) {
  const action = el.dataset.action;
  if (action === 'music-play' || action === 'music-resume') musicPlay();
  else if (action === 'music-pause') musicPause();
  else if (action === 'music-stop') musicStop();
}

function timerOnVisible() {
  if (!timer) return;
  timerCatchUp();
  if (timer.phase === 'countdown' || timer.phase === 'running') timerWake(true);
  if (timer.phase === 'done' && !timer.alarmed) timerAlarm();
  timerPaint(true);
}

/* =========================================================================
   Actions
   ========================================================================= */
function moveItem(id, dir) {
  const i = state.program.findIndex((e) => e.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= state.program.length) return;
  [state.program[i], state.program[j]] = [state.program[j], state.program[i]];
  save(); render();
}

function recordSession(k, doneList, exs, bonus) {
  const kcal = doneList.reduce((a, e) => a + exKcal(e, state.weight), 0);
  state.sessions = state.sessions.filter((s) => !(s.date === k && !!s.bonus === !!bonus));
  const entry = {
    id: uid(), date: k, at: new Date().toISOString(),
    kcal: Math.round(kcal * 10) / 10, weight: state.weight,
    exDone: doneList.length, exTotal: exs.length,
    seconds: doneList.reduce((a, e) => a + exSeconds(e), 0)
  };
  if (bonus) entry.bonus = true;
  state.sessions.push(entry);
  return entry.kcal;
}
function checkAllExercises() {
  const t = ensureToday();
  const checked = Array.isArray(t.checked) ? t.checked.slice() : [];
  for (const e of exercises()) {
    if (!checked.includes(e.id)) checked.push(e.id);
  }
  t.checked = checked;
  save();
  render();
}
function uncheckAllExercises() {
  const t = ensureToday();
  const ids = new Set(exercises().map((e) => e.id));
  t.checked = (Array.isArray(t.checked) ? t.checked : []).filter((id) => !ids.has(id));
  save();
  render();
}
function finishSession() {
  const t = ensureToday();
  const exs = exercises();
  let doneList = exs.filter((e) => t.checked.includes(e.id));
  if (!doneList.length) { doneList = exs; t.checked = exs.map((e) => e.id); }
  const k = todayKey();
  const kcal = recordSession(k, doneList, exs, false);
  state.days[k] = true;
  save(); render();
  toast(`Bravo ! ≈ ${fmtKcal(kcal)} kcal brûlées 🔥`);
}
function finishBonus() {
  const t = ensureToday();
  if (!mainSessionOn(todayKey())) return;
  if (!t.bonus) t.bonus = { started: true, checked: [] };
  const exs = exercises();
  const checked = Array.isArray(t.bonus.checked) ? t.bonus.checked : [];
  let doneList = exs.filter((e) => checked.includes(e.id));
  if (!doneList.length) { doneList = exs; t.bonus.checked = exs.map((e) => e.id); }
  const k = todayKey();
  const kcal = recordSession(k, doneList, exs, true);
  ensureBonusMap()[k] = true;
  t.bonus.started = false;
  save(); render();
  toast(`Séance bonus enregistrée · ≈ ${fmtKcal(kcal)} kcal`);
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
  if (ev.target.id === 'trophy-overlay') { dismissTrophyOverlay(); return; }
  const tabBtn = ev.target.closest('.tab');
  if (tabBtn) { location.hash = tabBtn.dataset.tab; window.scrollTo(0, 0); return; }
  const sheet = document.getElementById('sheet');
  if (ev.target === sheet) { closeSheet(); return; }
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  if (el.dataset.action.startsWith('timer-')) { onTimerAction(el); return; }
  if (el.dataset.action.startsWith('music-')) { onMusicAction(el); return; }
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'close-trophies': dismissTrophyOverlay(); break;
    case 'start': ensureToday().started = true; save(); render(); break;
    case 'toggle-ex': {
      const t = ensureToday();
      t.checked = t.checked.includes(id) ? t.checked.filter((x) => x !== id) : [...t.checked, id];
      save(); render(); break;
    }
    case 'check-all': checkAllExercises(); break;
    case 'uncheck-all': uncheckAllExercises(); break;
    case 'finish': finishSession(); break;
    case 'start-bonus': {
      if (!mainSessionOn(todayKey())) return;
      const t = ensureToday();
      t.bonus = { started: true, checked: [] };
      save(); render(); break;
    }
    case 'toggle-bonus-ex': {
      const t = ensureToday();
      if (!t.bonus) t.bonus = { started: true, checked: [] };
      const checked = Array.isArray(t.bonus.checked) ? t.bonus.checked : [];
      t.bonus.checked = checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id];
      save(); render(); break;
    }
    case 'finish-bonus': finishBonus(); break;
    case 'undo-session': {
      if (!confirm('Annuler la séance d’aujourd’hui ? Ses calories seront retirées.')) return;
      const k = todayKey();
      state.sessions = state.sessions.filter((s) => !(s.date === k && !s.bonus));
      delete state.days[k];
      ensureToday().started = true;
      save(); render(); break;
    }
    case 'undo-bonus': {
      if (!confirm('Annuler la séance bonus ? Ses calories seront retirées.')) return;
      const k = todayKey();
      state.sessions = state.sessions.filter((s) => !(s.date === k && s.bonus));
      ensureBonusMap()[k] = false;
      const t = ensureToday();
      t.bonus = { started: false, checked: [] };
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
    case 'toggle-bonus': {
      const k = el.dataset.date;
      if (!k || k > todayKey()) return;
      ensureBonusMap()[k] = !isBonus(k);
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
  if (ev.key === 'Escape' && draft) { closeSheet(); return; }
  if (ev.key === 'Escape' && timerScreenOn) { timerScreenOn = false; timerPaint(true); return; }
  if (ev.key === 'Escape') dismissTrophyOverlay();
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
  if (ev.target.id === 'timer-min' || ev.target.id === 'timer-sec') timerCommitDuration();
  if (ev.target.id === 'jump-month' || ev.target.id === 'jump-year') {
    const y = Number(document.getElementById('jump-year').value);
    const m = Number(document.getElementById('jump-month').value);
    ui.monthCursor = clampMonth(y, m);
    ui.calMode = 'month';
    render();
  }
});
window.addEventListener('hashchange', () => {
  closeSheet();
  timerScreenOn = false;
  render();
  timerPaint(true);
});
// Rafraîchir quand on revient sur l'appli (ex. passage à un nouveau jour)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  timerOnVisible();
  if (!draft) render();
});

document.title = APP_NAME;
save();
render();
timerInit();

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
