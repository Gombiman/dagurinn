/* Dagurinn – skipulag dagsins fyrir fjölskylduna.
   Gögnin eru dulkóðuð (AES-GCM, lykill leiddur af fjölskyldulykilorði með PBKDF2)
   og geymd í data/dagurinn.enc.json í GitHub repoinu. */
'use strict';

const DATA_PATH = 'data/dagurinn.enc.json';
const ITER = 250000;
const DAYS = ['sunnudagur', 'mánudagur', 'þriðjudagur', 'miðvikudagur', 'fimmtudagur', 'föstudagur', 'laugardagur'];
const DAYS_ISO_SHORT = ['', 'mán', 'þri', 'mið', 'fim', 'fös', 'lau', 'sun'];
const MONTHS = ['janúar', 'febrúar', 'mars', 'apríl', 'maí', 'júní', 'júlí', 'ágúst', 'september', 'október', 'nóvember', 'desember'];
const KINDS = { skoli: ['Skóli', '🏫'], aefing: ['Æfing', '🏅'], tomstund: ['Tómstund', '🎨'], annad: ['Annað', '📌'] };
const COLORS = { teal: '#0f8a7e', blue: '#2f6fe0', coral: '#d4562a', purple: '#7a4fd6', pink: '#cf3f7c', green: '#3f8f22', amber: '#c27a0a', gray: '#7b7870' };
const COLOR_NAMES = { teal: 'Grænblár', blue: 'Blár', coral: 'Appelsínugulur', purple: 'Fjólublár', pink: 'Bleikur', green: 'Grænn', amber: 'Gulur', gray: 'Grár' };

/* ---------- smáhjálp ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);
const store = {
  get(k) { try { return localStorage.getItem('dg_' + k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem('dg_' + k) : localStorage.setItem('dg_' + k, v); } catch { /* geymsla ekki í boði */ } },
};
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isoDow = (d) => (d.getDay() === 0 ? 7 : d.getDay());
const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = (m) => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 60) + 60) % 60)}`;
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const dateLabel = (d) => `${DAYS[d.getDay()]} ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const inMins = (m) => (m < 60 ? `${m} mín` : `${Math.floor(m / 60)} klst${m % 60 ? ' ' + (m % 60) + ' mín' : ''}`);
const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

/* ---------- dulkóðun ---------- */
const te = new TextEncoder();
const td = new TextDecoder();
function b64(buf) { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
const keyCache = new Map();
async function deriveKey(pw, saltB64, iter) {
  const ck = saltB64 + '|' + iter + '|' + pw;
  if (keyCache.has(ck)) return keyCache.get(ck);
  const base = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  keyCache.set(ck, key);
  return key;
}
async function encryptData(obj, pw, saltB64) {
  const salt = saltB64 || b64(crypto.getRandomValues(new Uint8Array(16)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pw, salt, ITER);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
  return { v: 1, app: 'dagurinn', kdf: 'PBKDF2-SHA256', iter: ITER, salt, iv: b64(iv), ct: b64(ct) };
}
async function decryptData(file, pw) {
  const key = await deriveKey(pw, file.salt, file.iter || ITER);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) }, key, unb64(file.ct));
  return JSON.parse(td.decode(pt));
}

/* ---------- ástand ---------- */
const state = {
  data: null,
  demo: false,
  pw: store.get('pw'),
  salt: null,
  sha: null,
  ops: [],
  saving: false,
  status: '',
  view: new Date().getHours() >= 19 ? 'tomorrow' : 'today',
  person: store.get('person') || 'all',
  weather: null,
};

function emptyData() {
  return {
    version: 1,
    settings: { weather: { lat: 64.135, lon: -21.895, name: 'Reykjavík' } },
    people: [], places: [], weekly: [], events: [], changes: [], offDays: [],
  };
}
function normalize(d) {
  const e = emptyData();
  for (const k of Object.keys(e)) if (d[k] == null) d[k] = e[k];
  d.settings = { ...e.settings, ...d.settings };
  return d;
}

function repoInfo() {
  const o = store.get('owner'), r = store.get('repo');
  if (o && r) return { owner: o, repo: r };
  const h = location.hostname;
  if (h.endsWith('.github.io')) {
    const owner = h.split('.')[0];
    const first = location.pathname.split('/').filter(Boolean)[0];
    return { owner, repo: first && !first.includes('.') ? first : h };
  }
  return null;
}
const canSave = () => !!(store.get('token') && repoInfo());
const canEdit = () => state.demo || canSave();

/* ---------- GitHub ---------- */
function ghHeaders() {
  return { Authorization: 'Bearer ' + store.get('token'), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}
function apiUrl() { const r = repoInfo(); return `https://api.github.com/repos/${r.owner}/${r.repo}/contents/${DATA_PATH}`; }

async function fetchRemote() {
  if (canSave()) {
    const res = await fetch(apiUrl() + '?t=' + Date.now(), { headers: ghHeaders(), cache: 'no-store' });
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw new Error('auth');
    if (!res.ok) throw new Error('net');
    const j = await res.json();
    return { file: JSON.parse(atob(j.content.replace(/\s/g, ''))), sha: j.sha };
  }
  const res = await fetch(DATA_PATH + '?t=' + Date.now(), { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('net');
  return { file: await res.json(), sha: null };
}
async function putRemote(file, sha, message) {
  const body = { message: message || 'Uppfæri dagskrá', content: btoa(JSON.stringify(file, null, 1)) };
  if (sha) body.sha = sha;
  return fetch(apiUrl(), { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/* ---------- breytingar og vistun ---------- */
function applyOp(d, op) {
  if (op.col === 'settings') { d.settings = { ...d.settings, ...op.value }; return; }
  const arr = d[op.col] || (d[op.col] = []);
  const i = arr.findIndex((x) => x.id === op.id);
  if (op.op === 'del') { if (i >= 0) arr.splice(i, 1); } else if (i >= 0) arr[i] = op.value; else arr.push(op.value);
}
function mutate(col, id, value) {
  const op = col === 'settings' ? { col, op: 'put', value } : { col, id, op: value ? 'put' : 'del', value };
  applyOp(state.data, op);
  state.ops = state.ops.filter((o) => !(o.col === col && o.id === id && col !== 'settings'));
  state.ops.push(op);
  render();
  if (state.demo) { setStatus('Sýnishorn – breytingar vistast ekki'); return; }
  setStatus('Óvistaðar breytingar…');
  scheduleSave();
}
function prune(d) {
  const cutoff = ymd(addDays(new Date(), -45));
  d.events = d.events.filter((e) => (e.date || '') >= cutoff);
  d.changes = d.changes.filter((c) => (c.date || '') >= cutoff);
  d.offDays = d.offDays.filter((o) => (o.to || o.date || '') >= cutoff);
}
let saveTimer = null;
function scheduleSave(ms = 700) { clearTimeout(saveTimer); saveTimer = setTimeout(save, ms); }

async function save(force = false) {
  if (state.demo || state.saving || (!state.ops.length && !force) || !canSave()) return;
  state.saving = true;
  setStatus('Vista…');
  const ops = state.ops.slice();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await fetchRemote();
      let base;
      if (remote && !force) base = normalize(await decryptData(remote.file, state.pw));
      else if (force) base = JSON.parse(JSON.stringify(state.data));
      else base = emptyData();
      if (!force) ops.forEach((o) => applyOp(base, o));
      prune(base);
      base.updatedAt = new Date().toISOString();
      const salt = force ? null : (remote ? remote.file.salt : state.salt);
      const file = await encryptData(base, state.pw, salt);
      const res = await putRemote(file, remote && remote.sha);
      if ((res.status === 409 || res.status === 422) && attempt < 2) continue;
      if (res.status === 401 || res.status === 403) throw new Error('auth');
      if (!res.ok) throw new Error('net ' + res.status);
      const j = await res.json();
      state.sha = j.content.sha;
      state.salt = file.salt;
      state.ops = state.ops.filter((o) => !ops.includes(o));
      state.data = base;
      state.ops.forEach((o) => applyOp(state.data, o));
      store.set('file', JSON.stringify(file));
      setStatus('Vistað ' + fromMin(nowMin()) + ' ✓');
      render();
      break;
    }
  } catch (e) {
    setStatus(e.message === 'auth' ? 'Aðgangslykill virkar ekki – sjá Stillingar' : 'Gat ekki vistað – reyni aftur');
    if (e.message !== 'auth') scheduleSave(10000);
  } finally {
    state.saving = false;
    if (state.ops.length && !saveTimer) scheduleSave();
  }
}
function setStatus(s) { state.status = s; const el = $('#status'); if (el) el.textContent = s; }

/* ---------- dagskrá dagsins ---------- */
const personOf = (id) => state.data.people.find((p) => p.id === id);
const placeOf = (id) => state.data.places.find((p) => p.id === id);
const matchPerson = (itemPerson, sel) => sel === 'all' || itemPerson === 'all' || itemPerson === sel;

function itemsFor(dateStr, sel = state.person) {
  const d = state.data;
  const dow = isoDow(parseYmd(dateStr));
  const offs = d.offDays.filter((o) => dateStr >= o.date && dateStr <= (o.to || o.date));
  const out = [];
  for (const w of d.weekly) {
    if (!matchPerson(w.person, sel)) continue;
    if (!(w.days || []).includes(dow)) continue;
    if (w.from && dateStr < w.from) continue;
    if (w.to && dateStr > w.to) continue;
    const it = { ...w, src: 'weekly', date: dateStr, bring: [...(w.bring || [])] };
    const off = offs.find((o) => !(o.kinds && o.kinds.length) || o.kinds.includes(w.kind || 'annad'));
    if (off) { it.cancelled = true; it.reason = off.title; }
    const ch = d.changes.find((c) => c.weeklyId === w.id && c.date === dateStr);
    if (ch) {
      it.change = ch;
      if (ch.cancelled) { it.cancelled = true; it.reason = ch.note || 'Fellur niður'; }
      if (ch.start && ch.start !== w.start) { it.oldStart = w.start; it.start = ch.start; it.timeChanged = true; }
      if (ch.end && ch.end !== w.end) { it.end = ch.end; it.timeChanged = true; }
      if (ch.pickup) it.pickup = ch.pickup;
      if (ch.bring && ch.bring.length) it.bring.push(...ch.bring);
      if (ch.note && !ch.cancelled) it.dayNote = ch.note;
    }
    out.push(it);
  }
  for (const e of d.events) {
    if (e.date !== dateStr || !matchPerson(e.person, sel)) continue;
    out.push({ ...e, src: 'event', bring: [...(e.bring || [])] });
  }
  out.sort((a, b) => (toMin(a.start) ?? 0) - (toMin(b.start) ?? 0));
  return out;
}
function leaveMin(it) {
  const p = placeOf(it.place);
  if (!p || !p.minutes || !it.start) return null;
  return toMin(it.start) - Number(p.minutes) - 3;
}
const iconOf = (it) => it.icon || (KINDS[it.kind] || KINDS.annad)[1];

/* ---------- veður ---------- */
async function loadWeather() {
  const w = (state.data && state.data.settings.weather) || { lat: 64.135, lon: -21.895 };
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m&wind_speed_unit=ms&timezone=auto&forecast_days=2`;
    const res = await fetch(url);
    if (!res.ok) return;
    state.weather = await res.json();
    render();
  } catch { /* veður er aukaatriði */ }
}
function wxIcon(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  if (code >= 51) return '🌧️';
  return '🌡️';
}
function wxFor(dateStr, hour) {
  const W = state.weather;
  if (!W) return null;
  if (dateStr === ymd(new Date()) && hour == null && W.current) {
    const c = W.current;
    return { t: c.temperature_2m, feels: c.apparent_temperature, p: c.precipitation, code: c.weather_code, wind: c.wind_speed_10m };
  }
  const key = `${dateStr}T${pad(hour ?? 8)}:00`;
  const i = W.hourly.time.indexOf(key);
  if (i < 0) return null;
  return { t: W.hourly.temperature_2m[i], p: W.hourly.precipitation[i], code: W.hourly.weather_code[i], wind: W.hourly.wind_speed_10m[i] };
}
function wxHint(w) {
  if (!w) return '';
  const tips = [];
  const snow = (w.code >= 71 && w.code <= 77) || w.code === 85 || w.code === 86;
  if ((w.feels ?? w.t) <= 1) tips.push('húfa og vettlingar');
  if (snow) tips.push('góðir skór');
  else if (w.p >= 0.2 || (w.code >= 51 && w.code <= 82)) tips.push('regnjakki');
  if (w.wind >= 12) tips.push('hvasst – klæddu þig vel');
  return tips.length ? cap(tips.join(', ')) : '';
}

/* ---------- birting ---------- */
function render() {
  const app = $('#app');
  if (!state.data) return;
  const today = new Date();
  const todayStr = ymd(today);
  const viewDate = state.view === 'tomorrow' ? addDays(today, 1) : today;
  const viewStr = ymd(viewDate);
  const people = state.data.people;
  if (state.person !== 'all' && !personOf(state.person)) state.person = 'all';

  const wNow = wxFor(viewStr, state.view === 'tomorrow' ? 8 : null);
  let html = '';
  if (state.demo) html += `<div class="demo-flag">Sýnishorn með tilbúnum gögnum – <button class="link" data-act="leave-demo" style="padding:0;font-size:13px">hætta</button></div>`;
  html += `<header class="top">
    <div><div class="date">${esc(cap(state.view === 'week' ? dateLabel(today) : dateLabel(viewDate)))}</div>
      <h1>${state.view === 'tomorrow' ? 'Á morgun' : state.view === 'week' ? 'Vikan' : 'Í dag'}</h1></div>
    <div style="display:flex;gap:8px;align-items:center">
      ${wNow ? `<span class="wx">${wxIcon(wNow.code)} ${Math.round(wNow.t)}°${wNow.wind >= 8 ? ` · ${Math.round(wNow.wind)} m/s` : ''}</span>` : ''}
      <button class="iconbtn" data-act="settings" aria-label="Stillingar">⚙︎</button>
    </div></header>`;

  if (people.length > 1) {
    html += `<div class="chips" role="tablist">
      <button class="chip ${state.person === 'all' ? 'on' : ''}" data-person="all">Allir</button>
      ${people.map((p) => `<button class="chip ${state.person === p.id ? 'on' : ''}" data-person="${esc(p.id)}" style="--p:${COLORS[p.color] || COLORS.gray}"><span class="dot"></span>${esc(p.name)}</button>`).join('')}
    </div>`;
  }
  html += `<nav class="tabs">
    <button class="${state.view === 'today' ? 'on' : ''}" data-view="today">Í dag</button>
    <button class="${state.view === 'tomorrow' ? 'on' : ''}" data-view="tomorrow">Á morgun</button>
    <button class="${state.view === 'week' ? 'on' : ''}" data-view="week">Vikan</button>
  </nav>`;

  if (state.view === 'week') html += renderWeek(today);
  else html += renderDay(viewStr, viewStr === todayStr, wNow);

  app.innerHTML = html;
  renderDock();
}

function renderDay(dateStr, isToday, wNow) {
  const items = itemsFor(dateStr);
  let html = '';
  if (isToday) {
    if (state.person === 'all' && state.data.people.length > 1) {
      for (const p of state.data.people) html += renderNext(items.filter((i) => i.person === p.id || i.person === 'all'), dateStr, p);
    } else html += renderNext(items, dateStr);
  }

  for (const it of items) {
    if (it.cancelled) html += `<div class="banner bad">✕ <div><b>${esc(it.title)}</b> fellur niður${it.reason && it.reason !== 'Fellur niður' ? ' – ' + esc(it.reason) : ''}</div></div>`;
    else if (it.timeChanged) html += `<div class="banner warn">⚠︎ <div><b>${esc(it.title)}</b> er kl. ${esc(it.start)}${it.end ? '–' + esc(it.end) : ''} (vanalega ${esc(it.oldStart || '')})${it.dayNote ? ' – ' + esc(it.dayNote) : ''}</div></div>`;
  }
  const hint = wxHint(wNow);
  if (hint && items.some((i) => !i.cancelled)) html += `<div class="hint">${wxIcon(wNow.code)} ${esc(hint)}</div>`;

  if (!items.length) {
    html += `<div class="list"><div class="empty"><div class="e">🌿</div>Ekkert á dagskrá${canEdit() ? '<br><small>Ýttu á + til að bæta við</small>' : ''}</div></div>`;
  } else {
    html += `<div class="list">${items.map((it) => rowHTML(it, isToday)).join('')}</div>`;
  }

  if (isToday) {
    const tStr = ymd(addDays(parseYmd(dateStr), 1));
    const tItems = itemsFor(tStr).filter((i) => !i.cancelled);
    const bring = [...new Set(tItems.flatMap((i) => i.bring || []))];
    const tCancelled = itemsFor(tStr).filter((i) => i.cancelled);
    if (tItems.length || tCancelled.length) {
      html += `<button class="card" data-view="tomorrow" style="width:100%;text-align:left;display:block">
        <div style="font-size:14px;color:var(--ink-2)">Á morgun · ${esc(DAYS[parseYmd(tStr).getDay()])}</div>
        ${tItems.length ? `<div style="font-weight:600;margin-top:2px">Fyrst: ${esc(tItems[0].start || '')} ${esc(tItems[0].title)}</div>` : ''}
        ${bring.length ? `<div style="margin-top:4px">🎒 Mundu: ${esc(bring.join(', '))}</div>` : ''}
        ${tCancelled.length ? `<div style="margin-top:4px;color:var(--bad)">✕ ${tCancelled.map((i) => esc(i.title)).join(', ')} fellur niður</div>` : ''}
      </button>`;
    }
  }
  return html;
}

function renderNext(items, dateStr, forPerson) {
  const now = nowMin();
  const live = items.filter((i) => !i.cancelled && i.start);
  const current = live.find((i) => toMin(i.start) <= now && toMin(i.end || i.start) > now);
  const upcoming = live.find((i) => toMin(i.start) > now);
  const who = () => (forPerson ? ` · ${esc(forPerson.name)}` : '');
  let html = '';
  if (current && (!upcoming || leaveMin(upcoming) == null || leaveMin(upcoming) > now)) {
    html += `<div class="card next now"><div class="lbl">Núna${who(current)}</div><div class="big">${iconOf(current)} ${esc(current.title)}</div>
      <div class="sub">til kl. ${esc(current.end)}${upcoming ? ` · næst ${esc(upcoming.title)} kl. ${esc(upcoming.start)}` : ''}</div></div>`;
    return html;
  }
  if (upcoming) {
    const lv = leaveMin(upcoming);
    const p = placeOf(upcoming.place);
    const travel = p && p.minutes ? `${p.note ? esc(p.note) + ' · ' : ''}${esc(p.minutes)} mín á leiðinni` : '';
    if (lv != null && now < lv) {
      html += `<div class="card next"><div class="lbl">Næst${who(upcoming)} · ${esc(upcoming.title)} kl. ${esc(upcoming.start)}</div>
        <div class="big">Farðu út kl. ${fromMin(lv)}</div><div class="sub">${travel}${lv - now <= 240 ? ` · eftir ${inMins(lv - now)}` : ''}</div></div>`;
    } else if (lv != null) {
      html += `<div class="card next late"><div class="lbl">Næst${who(upcoming)} · ${esc(upcoming.title)} kl. ${esc(upcoming.start)}</div>
        <div class="big">Tími til að fara!</div><div class="sub">${travel}</div></div>`;
    } else {
      html += `<div class="card next"><div class="lbl">Næst${who(upcoming)} · eftir ${inMins(toMin(upcoming.start) - now)}</div>
        <div class="big">${iconOf(upcoming)} ${esc(upcoming.title)} kl. ${esc(upcoming.start)}</div>
        ${upcoming.pickup ? `<div class="sub">🚗 ${esc(upcoming.pickup)}</div>` : ''}</div>`;
    }
  } else if (live.length) {
    html += `<div class="card next now">${forPerson ? `<div class="lbl">${esc(forPerson.name)}</div>` : ''}<div class="big">Dagskránni er lokið 🎉</div></div>`;
  }
  return html;
}

function rowHTML(it, isToday) {
  const now = nowMin();
  const s = toMin(it.start), e = toMin(it.end || it.start);
  const past = isToday && e != null && e <= now && !it.cancelled;
  const isNow = isToday && s != null && s <= now && e > now && !it.cancelled;
  const person = personOf(it.person);
  const color = person ? COLORS[person.color] || COLORS.gray : 'transparent';
  const p = placeOf(it.place);
  const lv = leaveMin(it);
  const meta = [];
  if (p) meta.push(`📍 ${esc(p.name)}${p.minutes && !it.cancelled ? ` · ${p.note ? esc(p.note) + ', ' : ''}farðu út ${fromMin(lv)}` : ''}`);
  if (it.pickup && !it.cancelled) meta.push(`🚗 ${esc(it.pickup)}`);
  if (it.bring && it.bring.length && !it.cancelled) meta.push(`🎒 ${esc(it.bring.join(', '))}`);
  if (it.note) meta.push(`💬 ${esc(it.note)}`);
  if (it.dayNote) meta.push(`💬 ${esc(it.dayNote)}`);
  const badges = [];
  if (it.cancelled) badges.push(`<span class="badge bad">Fellur niður</span>`);
  else if (it.timeChanged) badges.push(`<span class="badge warn">Breyttur tími</span>`);
  if (state.person === 'all' && state.data.people.length > 1) {
    badges.push(person ? `<span class="badge who" style="--p:${color}">${esc(person.name)}</span>` : `<span class="badge who" style="--p:#888">Öll</span>`);
  }
  return `<button class="row ${past ? 'past' : ''} ${isNow ? 'now' : ''} ${it.cancelled ? 'cancel' : ''}" style="--p:${color}"
      data-item="${esc(it.src)}:${esc(it.id)}:${esc(it.date)}">
    <span class="bar"></span>
    <div class="t">${esc(it.start || '')}${it.end ? `<small>${esc(it.end)}</small>` : ''}</div>
    <div><div class="ti">${iconOf(it)} <span class="name">${esc(it.title)}</span> ${badges.join(' ')}</div>
      ${meta.length ? `<div class="meta">${meta.map((m) => `<span>${m}</span>`).join('')}</div>` : ''}</div>
  </button>`;
}

function renderWeek(today) {
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const ds = ymd(d);
    const items = itemsFor(ds);
    const label = i === 0 ? 'Í dag' : i === 1 ? 'Á morgun' : cap(DAYS[d.getDay()]);
    html += `<section class="day"><h3 class="${i === 0 ? 'today' : ''}">${label} · ${d.getDate()}. ${MONTHS[d.getMonth()]}</h3>`;
    html += items.length ? `<div class="list">${items.map((it) => rowHTML(it, i === 0)).join('')}</div>` : `<div class="list"><div class="empty" style="padding:12px">Ekkert á dagskrá</div></div>`;
    html += '</section>';
  }
  return html;
}

function renderDock() {
  let dock = $('#dock');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'dock';
    dock.className = 'dock';
    document.body.appendChild(dock);
  }
  dock.innerHTML = `<div class="in">
    <div class="status" id="status">${esc(state.status || (state.data.updatedAt ? (() => { const u = new Date(state.data.updatedAt); return `Uppfært ${u.getDate()}. ${MONTHS[u.getMonth()].slice(0, 3)} kl. ${pad(u.getHours())}:${pad(u.getMinutes())}`; })() : ''))}</div>
    <button class="btn" data-act="refresh" aria-label="Sækja nýjustu">↻</button>
    ${canEdit() ? '<button class="btn primary" data-act="add">+ Bæta við</button>' : ''}
  </div>`;
}

/* ---------- blöð (sheets) og form ---------- */
function openSheet(inner, onMount) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="scrim"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${inner}</div></div>`;
  const scrim = $('.scrim', root);
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  if (onMount) onMount($('.sheet', root), close);
  return close;
}

function fieldHTML(f, v) {
  if (f.type === 'pair') return `<div class="two">${f.fields.map((x) => fieldHTML(x, v[x.key])).join('')}</div>`;
  const id = 'f_' + f.key;
  const help = f.help ? `<div class="help">${esc(f.help)}</div>` : '';
  let input;
  switch (f.type) {
    case 'select':
      input = `<select id="${id}" name="${f.key}">${f.options.map(([val, lab]) => `<option value="${esc(val)}" ${String(v ?? f.default ?? '') === String(val) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
      break;
    case 'days':
      input = `<div class="days">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<label><input type="checkbox" name="${f.key}" value="${n}" ${(v || []).includes(n) ? 'checked' : ''}><span>${DAYS_ISO_SHORT[n]}</span></label>`).join('')}</div>`;
      break;
    case 'checks':
      input = `<div class="checks">${f.options.map(([val, lab]) => `<label><input type="checkbox" name="${f.key}" value="${esc(val)}" ${(v || []).includes(val) ? 'checked' : ''}><span>${esc(lab)}</span></label>`).join('')}</div>`;
      break;
    case 'toggle':
      return `<label class="toggle"><span>${esc(f.label)}</span><input type="checkbox" name="${f.key}" ${v ? 'checked' : ''}></label>`;
    case 'textarea':
      input = `<textarea id="${id}" name="${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(v || '')}</textarea>`;
      break;
    case 'list':
      input = `<input type="text" id="${id}" name="${f.key}" value="${esc((v || []).join(', '))}" placeholder="${esc(f.placeholder || '')}">`;
      break;
    default:
      input = `<input type="${f.type || 'text'}" id="${id}" name="${f.key}" value="${esc(v ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.type === 'number' ? 'inputmode="numeric"' : ''} autocomplete="off">`;
  }
  return `<label class="field"><span>${esc(f.label)}</span>${input}${help}</label>`;
}
function flatFields(fields) { return fields.flatMap((f) => (f.type === 'pair' ? f.fields : [f])); }
function readForm(el, fields) {
  const out = {};
  for (const f of flatFields(fields)) {
    if (f.type === 'days') out[f.key] = $$(`input[name="${f.key}"]:checked`, el).map((i) => Number(i.value));
    else if (f.type === 'checks') out[f.key] = $$(`input[name="${f.key}"]:checked`, el).map((i) => i.value);
    else if (f.type === 'toggle') out[f.key] = $(`input[name="${f.key}"]`, el).checked;
    else if (f.type === 'list') out[f.key] = splitList($(`[name="${f.key}"]`, el).value);
    else if (f.type === 'number') { const x = $(`[name="${f.key}"]`, el).value; out[f.key] = x === '' ? null : Number(x); }
    else out[f.key] = $(`[name="${f.key}"]`, el).value.trim();
  }
  return out;
}
function openForm({ title, desc, fields, values = {}, onSave, onDelete, validate, saveLabel = 'Vista' }) {
  openSheet(`<h2>${esc(title)}</h2>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}
    <form novalidate>${fields.map((f) => fieldHTML(f, f.type === 'pair' ? values : values[f.key])).join('')}
    <div class="err" id="ferr"></div>
    <div class="actions">${onDelete ? '<button type="button" class="btn danger" data-del>Eyða</button>' : ''}<button type="submit" class="btn primary">${esc(saveLabel)}</button></div></form>`,
  (sheet, close) => {
    const form = $('form', sheet);
    form.addEventListener('input', () => { $('#ferr', sheet).textContent = ''; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = readForm(form, fields);
      const err = validate ? validate(v) : null;
      if (err) { $('#ferr', sheet).textContent = err; return; }
      const r = await onSave(v);
      if (r !== false) close();
    });
    const del = $('[data-del]', sheet);
    if (del) del.addEventListener('click', () => { if (confirm('Eyða þessu?')) { onDelete(); close(); } });
  });
}

/* ---------- skilgreiningar á formum ---------- */
const personOptions = (withAll = true) => [...(withAll ? [['all', 'Öll fjölskyldan']] : []), ...state.data.people.map((p) => [p.id, p.name])];
const placeOptions = () => [['', '– enginn staður –'], ...state.data.places.map((p) => [p.id, p.name])];
const kindOptions = () => Object.entries(KINDS).map(([k, [l, i]]) => [k, `${i} ${l}`]);
const defaultPerson = () => (state.person !== 'all' ? state.person : state.data.people[0]?.id || 'all');
const needTitle = (v) => (!v.title ? 'Vantar heiti' : null);

function weeklyFields() {
  return [
    { key: 'title', label: 'Heiti', placeholder: 'Fótboltaæfing' },
    { type: 'pair', fields: [{ key: 'person', label: 'Hver', type: 'select', options: personOptions() }, { key: 'kind', label: 'Tegund', type: 'select', options: kindOptions() }] },
    { key: 'days', label: 'Dagar', type: 'days' },
    { type: 'pair', fields: [{ key: 'start', label: 'Byrjar', type: 'time' }, { key: 'end', label: 'Endar', type: 'time' }] },
    { key: 'place', label: 'Staður', type: 'select', options: placeOptions(), help: 'Staðir og ferðatími eru stilltir í Stillingum' },
    { key: 'bring', label: 'Taka með', type: 'list', placeholder: 'Takkaskór, vatnsbrúsi' },
    { key: 'pickup', label: 'Hver keyrir / sækir', placeholder: 'Pabbi sækir' },
    { key: 'note', label: 'Athugasemd', placeholder: '' },
    { type: 'pair', fields: [{ key: 'from', label: 'Gildir frá', type: 'date' }, { key: 'to', label: 'Gildir til', type: 'date' }] },
    { key: 'icon', label: 'Tákn (valfrjálst)', placeholder: '⚽' },
  ];
}
function eventFields() {
  return [
    { key: 'title', label: 'Heiti', placeholder: 'Tannlæknir' },
    { key: 'person', label: 'Hver', type: 'select', options: personOptions() },
    { key: 'date', label: 'Dagsetning', type: 'date' },
    { type: 'pair', fields: [{ key: 'start', label: 'Byrjar', type: 'time' }, { key: 'end', label: 'Endar', type: 'time' }] },
    { key: 'place', label: 'Staður', type: 'select', options: placeOptions() },
    { key: 'bring', label: 'Taka með', type: 'list' },
    { key: 'pickup', label: 'Hver keyrir / sækir' },
    { key: 'note', label: 'Athugasemd' },
    { key: 'icon', label: 'Tákn (valfrjálst)', placeholder: '🦷' },
  ];
}
const offFields = () => [
  { key: 'title', label: 'Heiti', placeholder: 'Starfsdagur' },
  { type: 'pair', fields: [{ key: 'date', label: 'Frá', type: 'date' }, { key: 'to', label: 'Til (ef fleiri dagar)', type: 'date' }] },
  { key: 'kinds', label: 'Hvað fellur niður', type: 'checks', options: Object.entries(KINDS).map(([k, [l]]) => [k, l]) },
];
const placeFields = () => [
  { key: 'name', label: 'Heiti', placeholder: 'Egilshöll' },
  { key: 'minutes', label: 'Ferðatími í mínútum', type: 'number', help: 'Notað til að reikna „Farðu út kl.“ (3 mín aukalega bætast við)' },
  { key: 'note', label: 'Hvernig er farið', placeholder: 'Strætó leið 6 frá Spönginni' },
];
const personFields = () => [
  { key: 'name', label: 'Nafn' },
  { key: 'color', label: 'Litur', type: 'select', options: Object.keys(COLORS).map((c) => [c, COLOR_NAMES[c]]) },
];

function upsert(col, existing, v, prefix) {
  const id = existing ? existing.id : uid(prefix);
  const val = { ...(existing || {}), ...v, id };
  for (const k of Object.keys(val)) if (val[k] === '' || val[k] == null) delete val[k];
  mutate(col, id, val);
}

function editWeeklyItem(w) {
  openForm({
    title: w ? 'Fast atriði' : 'Nýtt fast atriði', desc: 'Endurtekur sig í hverri viku', fields: weeklyFields(),
    values: w || { person: defaultPerson(), kind: 'aefing', days: [] },
    validate: (v) => needTitle(v) || (!v.days.length ? 'Veldu a.m.k. einn dag' : !v.start ? 'Vantar tíma' : null),
    onSave: (v) => upsert('weekly', w, v, 'w'),
    onDelete: w ? () => mutate('weekly', w.id, null) : null,
  });
}
function editEvent(e, dateStr) {
  openForm({
    title: e ? 'Viðburður' : 'Nýr stakur viðburður', fields: eventFields(),
    values: e || { person: defaultPerson(), date: dateStr || ymd(state.view === 'tomorrow' ? addDays(new Date(), 1) : new Date()) },
    validate: (v) => needTitle(v) || (!v.date ? 'Vantar dagsetningu' : null),
    onSave: (v) => upsert('events', e, v, 'e'),
    onDelete: e ? () => mutate('events', e.id, null) : null,
  });
}
function editOff(o) {
  openForm({
    title: o ? 'Frídagur' : 'Nýr frídagur / starfsdagur', fields: offFields(),
    values: o || { kinds: ['skoli'] },
    validate: (v) => needTitle(v) || (!v.date ? 'Vantar dagsetningu' : null),
    onSave: (v) => upsert('offDays', o, v, 'o'),
    onDelete: o ? () => mutate('offDays', o.id, null) : null,
  });
}
function editPlace(p) {
  openForm({
    title: p ? 'Staður' : 'Nýr staður', fields: placeFields(), values: p || {},
    validate: (v) => (!v.name ? 'Vantar heiti' : null),
    onSave: (v) => upsert('places', p, v, 'p'),
    onDelete: p ? () => mutate('places', p.id, null) : null,
  });
}
function editPerson(p) {
  openForm({
    title: p ? 'Manneskja' : 'Bæta við manneskju', fields: personFields(), values: p || { color: Object.keys(COLORS)[state.data.people.length % 8] },
    validate: (v) => (!v.name ? 'Vantar nafn' : null),
    onSave: (v) => upsert('people', p, v, 'u'),
    onDelete: p ? () => mutate('people', p.id, null) : null,
  });
}
function editChange(w, dateStr, existing) {
  const d = parseYmd(dateStr);
  openForm({
    title: `${w.title} – ${DAYS[d.getDay()]} ${d.getDate()}. ${MONTHS[d.getMonth()]}`,
    desc: 'Breytingin gildir bara þennan dag',
    fields: [
      { key: 'cancelled', label: 'Fellur niður', type: 'toggle' },
      { type: 'pair', fields: [{ key: 'start', label: 'Byrjar', type: 'time' }, { key: 'end', label: 'Endar', type: 'time' }] },
      { key: 'pickup', label: 'Hver keyrir / sækir', placeholder: w.pickup || '' },
      { key: 'bring', label: 'Taka með aukalega', type: 'list' },
      { key: 'note', label: 'Athugasemd', placeholder: 'Færð vegna leiks' },
    ],
    values: existing || { start: w.start, end: w.end },
    onSave: (v) => {
      const val = { ...v, id: `${w.id}@${dateStr}`, weeklyId: w.id, date: dateStr };
      if (val.start === w.start) delete val.start;
      if (val.end === w.end) delete val.end;
      mutate('changes', val.id, val);
    },
    onDelete: existing ? () => mutate('changes', existing.id, null) : null,
  });
}

function openItem(key) {
  const [src, id, dateStr] = key.split(':');
  const it = itemsFor(dateStr, 'all').find((x) => x.src === src && x.id === id);
  if (!it) return;
  const d = parseYmd(dateStr);
  const p = placeOf(it.place);
  const person = personOf(it.person);
  const lines = [];
  lines.push(`🕒 ${esc(it.start || '')}${it.end ? '–' + esc(it.end) : ''}${it.timeChanged ? ` <span class="badge warn">vanalega ${esc(it.oldStart)}</span>` : ''}`);
  lines.push(`👤 ${person ? esc(person.name) : 'Öll fjölskyldan'}`);
  if (p) lines.push(`📍 ${esc(p.name)}${p.minutes ? ` · ${esc(p.minutes)} mín${p.note ? ' · ' + esc(p.note) : ''} · farðu út ${fromMin(leaveMin(it))}` : ''}`);
  if (it.pickup) lines.push(`🚗 ${esc(it.pickup)}`);
  if (it.bring && it.bring.length) lines.push(`🎒 ${esc(it.bring.join(', '))}`);
  if (it.note) lines.push(`💬 ${esc(it.note)}`);
  if (it.dayNote) lines.push(`💬 ${esc(it.dayNote)}`);
  if (it.cancelled) lines.push(`<span class="badge bad">Fellur niður${it.reason && it.reason !== 'Fellur niður' ? ' – ' + esc(it.reason) : ''}</span>`);

  let actions = '';
  if (canEdit()) {
    if (src === 'weekly') {
      const w = state.data.weekly.find((x) => x.id === id);
      actions = `<div class="sec">Bara ${esc(DAYS[d.getDay()])} ${d.getDate()}. ${MONTHS[d.getMonth()]}</div><div class="menu">
        ${it.change && it.change.cancelled ? '' : '<button data-a="cancel">Fellur niður þennan dag <span class="chev">✕</span></button>'}
        <button data-a="change">Breyta tíma, skutli eða athugasemd <span class="chev">›</span></button>
        ${it.change ? '<button data-a="undo">Afturkalla breytingu dagsins <span class="chev">↺</span></button>' : ''}
      </div><div class="sec">Alltaf</div><div class="menu"><button data-a="weekly">Breyta föstu atriði <span class="chev">›</span></button></div>`;
      openSheet(`<h2>${iconOf(it)} ${esc(it.title)}</h2><div class="desc">${lines.join('<br>')}</div>${actions}`, (sheet, close) => {
        sheet.addEventListener('click', (e) => {
          const a = e.target.closest('[data-a]');
          if (!a) return;
          close();
          if (a.dataset.a === 'cancel') mutate('changes', `${id}@${dateStr}`, { ...(it.change || {}), id: `${id}@${dateStr}`, weeklyId: id, date: dateStr, cancelled: true });
          if (a.dataset.a === 'change') editChange(w, dateStr, it.change);
          if (a.dataset.a === 'undo') mutate('changes', it.change.id, null);
          if (a.dataset.a === 'weekly') editWeeklyItem(w);
        });
      });
      return;
    }
    const ev = state.data.events.find((x) => x.id === id);
    actions = `<div class="menu"><button data-a="edit">Breyta <span class="chev">›</span></button><button data-a="del" style="color:var(--bad)">Eyða</button></div>`;
    openSheet(`<h2>${iconOf(it)} ${esc(it.title)}</h2><div class="desc">${lines.join('<br>')}</div>${actions}`, (sheet, close) => {
      sheet.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]');
        if (!a) return;
        close();
        if (a.dataset.a === 'edit') editEvent(ev);
        if (a.dataset.a === 'del' && confirm('Eyða þessum viðburði?')) mutate('events', id, null);
      });
    });
    return;
  }
  openSheet(`<h2>${iconOf(it)} ${esc(it.title)}</h2><div class="desc">${lines.join('<br>')}</div>
    <p class="desc" style="font-size:13px">Til að breyta þarf að tengja þetta tæki við GitHub (Stillingar).</p>`);
}

function openAdd() {
  openSheet(`<h2>Bæta við</h2><div class="menu">
    <button data-a="event"><span>📅 Stakur viðburður<br><small>T.d. tannlæknir, afmæli, leikur</small></span><span class="chev">›</span></button>
    <button data-a="weekly"><span>🔁 Fast atriði í hverri viku<br><small>Skóli, æfingar, fermingarfræðsla</small></span><span class="chev">›</span></button>
    <button data-a="off"><span>🏖️ Frídagur eða starfsdagur<br><small>Skóli eða æfingar falla niður</small></span><span class="chev">›</span></button>
  </div><p class="desc" style="margin-top:12px;font-size:14px">Til að breyta einhverju sem er þegar á dagskrá (t.d. æfing færð eða felld niður) ýtirðu á það í listanum.</p>`,
  (sheet, close) => sheet.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    close();
    ({ event: () => editEvent(null), weekly: () => editWeeklyItem(null), off: () => editOff(null) })[a.dataset.a]();
  }));
}

/* ---------- stillingar ---------- */
function openSettings() {
  const d = state.data;
  const ri = repoInfo();
  const list = (items, label, act) => items.map((x) => `<button data-a="${act}" data-id="${esc(x.id)}"><span>${label(x)}</span><span class="chev">›</span></button>`).join('');
  const upcomingEvents = d.events.filter((e) => e.date >= ymd(new Date())).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const weekly = [...d.weekly].sort((a, b) => (a.person + a.start).localeCompare(b.person + b.start));
  openSheet(`<h2>Stillingar</h2>
    <div class="sec">Fólk</div><div class="menu">${list(d.people, (p) => `<span style="color:${COLORS[p.color]}">●</span> ${esc(p.name)}`, 'person')}<button data-a="person-new">+ Bæta við manneskju</button></div>
    <div class="sec">Föst dagskrá</div><div class="menu">${list(weekly, (w) => `${iconOf(w)} ${esc(w.title)}<br><small>${esc(personOf(w.person)?.name || 'Öll')} · ${(w.days || []).map((n) => DAYS_ISO_SHORT[n]).join(', ')} · ${esc(w.start || '')}${w.end ? '–' + esc(w.end) : ''}</small>`, 'weekly')}<button data-a="weekly-new">+ Nýtt fast atriði</button></div>
    <div class="sec">Staðir og ferðatími</div><div class="menu">${list(d.places, (p) => `📍 ${esc(p.name)}<br><small>${p.minutes ? esc(p.minutes) + ' mín' : 'enginn ferðatími'}${p.note ? ' · ' + esc(p.note) : ''}</small>`, 'place')}<button data-a="place-new">+ Nýr staður</button></div>
    <div class="sec">Stakir viðburðir framundan</div><div class="menu">${list(upcomingEvents, (e) => `${iconOf(e)} ${esc(e.title)}<br><small>${esc(e.date)} ${esc(e.start || '')}</small>`, 'event')}<button data-a="event-new">+ Nýr viðburður</button></div>
    <div class="sec">Frídagar og starfsdagar</div><div class="menu">${list([...d.offDays].sort((a, b) => a.date.localeCompare(b.date)), (o) => `🏖️ ${esc(o.title)}<br><small>${esc(o.date)}${o.to ? ' – ' + esc(o.to) : ''}</small>`, 'off')}<button data-a="off-new">+ Nýr frídagur</button></div>
    <div class="sec">Þetta tæki</div><div class="menu">
      <button data-a="github"><span>GitHub tenging<br><small>${canSave() ? `Getur breytt · ${esc(ri.owner)}/${esc(ri.repo)}` : 'Bara skoðun – ýttu til að tengja'}</small></span><span class="chev">›</span></button>
      <button data-a="import"><span>Flytja inn gögn<br><small>Líma inn texta (JSON) t.d. frá Claude</small></span><span class="chev">›</span></button>
      ${canSave() ? '<button data-a="password"><span>Skipta um fjölskyldulykilorð</span><span class="chev">›</span></button>' : ''}
      <button data-a="lock" style="color:var(--bad)"><span>Læsa síðunni á þessu tæki<br><small>Gleymir lykilorði og aðgangslykli</small></span></button>
    </div>`,
  (sheet, close) => sheet.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    const id = a.dataset.id;
    close();
    const find = (col) => state.data[col].find((x) => x.id === id);
    const acts = {
      person: () => editPerson(find('people')), 'person-new': () => editPerson(null),
      weekly: () => editWeeklyItem(find('weekly')), 'weekly-new': () => editWeeklyItem(null),
      place: () => editPlace(find('places')), 'place-new': () => editPlace(null),
      event: () => editEvent(find('events')), 'event-new': () => editEvent(null),
      off: () => editOff(find('offDays')), 'off-new': () => editOff(null),
      github: openGithub, import: openImport, password: openPassword,
      lock: () => { if (confirm('Læsa síðunni á þessu tæki?')) { ['pw', 'token', 'owner', 'repo', 'file'].forEach((k) => store.set(k, null)); location.reload(); } },
    };
    acts[a.dataset.a] && acts[a.dataset.a]();
  }));
}

function openGithub() {
  const ri = repoInfo() || {};
  openForm({
    title: 'GitHub tenging',
    desc: 'Með aðgangslykli (fine-grained token) getur þetta tæki vistað breytingar. Lykillinn er bara geymdur í þessum síma.',
    fields: [
      { type: 'pair', fields: [{ key: 'owner', label: 'Notandi / org', placeholder: 'gretar' }, { key: 'repo', label: 'Repo', placeholder: 'dagurinn' }] },
      { key: 'token', label: 'Aðgangslykill', type: 'password', placeholder: 'github_pat_…', help: 'Contents: Read and write, bara fyrir þetta eina repo. Sjá leiðbeiningar í README.' },
    ],
    values: { owner: ri.owner || '', repo: ri.repo || '', token: store.get('token') || '' },
    validate: (v) => (!v.owner || !v.repo ? 'Vantar notanda og repo' : null),
    onSave: async (v) => {
      store.set('owner', v.owner); store.set('repo', v.repo); store.set('token', v.token || null);
      if (!v.token) { render(); return; }
      setStatus('Prófa tengingu…');
      try { await fetchRemote(); setStatus('Tengt ✓'); } catch (e) { setStatus(e.message === 'auth' ? 'Lykillinn virkar ekki' : 'Náði ekki sambandi við GitHub'); }
      render();
    },
  });
}

function openImport() {
  openForm({
    title: 'Flytja inn gögn',
    desc: 'Límdu inn JSON með people, places, weekly, events eða offDays. Atriði með sama id eru uppfærð, annað bætist við.',
    fields: [{ key: 'json', label: 'JSON', type: 'textarea', placeholder: '{ "weekly": [ … ] }' }],
    saveLabel: 'Flytja inn',
    validate: (v) => { try { const j = JSON.parse(v.json); return typeof j === 'object' ? null : 'Ógilt JSON'; } catch (e) { return 'Ógilt JSON: ' + e.message; } },
    onSave: (v) => {
      const j = JSON.parse(v.json);
      let n = 0;
      for (const col of ['people', 'places', 'weekly', 'events', 'changes', 'offDays']) {
        for (const x of j[col] || []) { const id = x.id || uid(col[0]); mutate(col, id, { ...x, id }); n++; }
      }
      if (j.settings) mutate('settings', null, j.settings);
      setStatus(`${n} atriði flutt inn`);
    },
  });
}

function openPassword() {
  openForm({
    title: 'Nýtt fjölskyldulykilorð',
    desc: 'Öll tæki þurfa síðan að slá inn nýja lykilorðið.',
    fields: [{ key: 'pw', label: 'Nýtt lykilorð', type: 'password' }, { key: 'pw2', label: 'Aftur', type: 'password' }],
    validate: (v) => (v.pw.length < 6 ? 'Minnst 6 stafir' : v.pw !== v.pw2 ? 'Lykilorðin eru ekki eins' : null),
    onSave: async (v) => {
      if (state.ops.length) { await save(); }
      state.pw = v.pw; store.set('pw', v.pw);
      await save(true);
    },
  });
}

/* ---------- læsing og fyrsta uppsetning ---------- */
function renderLock(msg = '', noData = false) {
  $('#dock') && $('#dock').remove();
  const app = $('#app');
  app.innerHTML = `<div class="lock">
    <div class="logo">🗓️</div><h1>Dagurinn</h1>
    <p>${noData ? 'Engin dagskrá hefur verið búin til ennþá.' : 'Sláðu inn lykilorð fjölskyldunnar.'}</p>
    ${noData ? '' : `<form id="lockf"><label class="field"><span>Lykilorð</span><input type="password" name="pw" autocomplete="current-password" autofocus></label>
      <div class="err">${esc(msg)}</div><button class="btn primary block" type="submit">Opna</button></form>`}
    ${noData ? '<button class="btn primary block" data-act="setup">Setja upp dagskrá</button>' : ''}
    <button class="link" data-act="demo">Skoða sýnishorn</button>
  </div>`;
  const f = $('#lockf');
  if (f) f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('input', f).value;
    if (!pw) return;
    $('.err', f).textContent = 'Opna…';
    state.pw = pw;
    await boot(true);
  });
}

function openSetup() {
  const ri = repoInfo() || {};
  openForm({
    title: 'Setja upp dagskrá',
    desc: 'Þetta býr til dulkóðaða gagnaskrá í repoinu. Lykilorðið þurfa allir í fjölskyldunni að fá. Aðgangslykillinn er bara fyrir þá sem eiga að geta breytt.',
    fields: [
      { key: 'name', label: 'Fyrsta manneskjan (nafn)', placeholder: 'Nafn' },
      { type: 'pair', fields: [{ key: 'owner', label: 'Notandi / org' }, { key: 'repo', label: 'Repo' }] },
      { key: 'token', label: 'GitHub aðgangslykill', type: 'password', placeholder: 'github_pat_…' },
      { key: 'pw', label: 'Fjölskyldulykilorð', type: 'password', help: 'Minnst 6 stafir' },
      { key: 'pw2', label: 'Lykilorð aftur', type: 'password' },
    ],
    values: { owner: ri.owner || '', repo: ri.repo || '' },
    saveLabel: 'Búa til',
    validate: (v) => (!v.name ? 'Vantar nafn' : !v.owner || !v.repo || !v.token ? 'Vantar GitHub upplýsingar' : v.pw.length < 6 ? 'Lykilorð þarf minnst 6 stafi' : v.pw !== v.pw2 ? 'Lykilorðin eru ekki eins' : null),
    onSave: async (v) => {
      store.set('owner', v.owner); store.set('repo', v.repo); store.set('token', v.token);
      state.pw = v.pw;
      const d = emptyData();
      d.people.push({ id: uid('u'), name: v.name, color: 'teal' });
      d.places.push({ id: uid('p'), name: 'Skólinn', minutes: 10, note: 'Ganga' });
      d.updatedAt = new Date().toISOString();
      try {
        const remote = await fetchRemote();
        if (remote) { alert('Það er þegar til dagskrá í repoinu. Notaðu lykilorðið til að opna hana.'); return false; }
        const file = await encryptData(d, v.pw);
        const res = await putRemote(file, null, 'Bý til dagskrá');
        if (!res.ok) throw new Error(res.status === 401 || res.status === 403 || res.status === 404 ? 'auth' : 'net');
        store.set('pw', v.pw);
        state.data = d; state.salt = file.salt; state.sha = (await res.json()).content.sha;
        store.set('file', JSON.stringify(file));
        setStatus('Dagskrá búin til ✓');
        render();
        openSettings();
      } catch (e) {
        alert(e.message === 'auth' ? 'GitHub hafnaði aðgangslyklinum. Athugaðu notanda, repo og réttindi lykilsins.' : 'Náði ekki sambandi við GitHub.');
        return false;
      }
    },
  });
}

/* ---------- sýnishorn ---------- */
function makeDemo() {
  const d = emptyData();
  const t = new Date();
  const D = (n) => ymd(addDays(t, n));
  const nextDow = (dow) => { for (let i = 1; i <= 7; i++) if (isoDow(addDays(t, i)) === dow) return D(i); return D(1); };
  d.people = [{ id: 'jon', name: 'Jón', color: 'teal' }, { id: 'soley', name: 'Sóley', color: 'coral' }];
  d.places = [
    { id: 'skoli', name: 'Skólinn', minutes: 12, note: 'Ganga' },
    { id: 'holl', name: 'Egilshöll', minutes: 25, note: 'Strætó leið 6' },
    { id: 'kirkja', name: 'Kirkjan', minutes: 10, note: 'Hjóla' },
    { id: 'fimleikar', name: 'Fimleikahúsið', minutes: 15, note: 'Bíll' },
  ];
  d.weekly = [
    { id: 'j1', person: 'jon', kind: 'skoli', title: 'Skóli', days: [1, 2, 3, 4], start: '08:10', end: '14:40', place: 'skoli' },
    { id: 'j2', person: 'jon', kind: 'skoli', title: 'Skóli', days: [5], start: '08:10', end: '13:20', place: 'skoli', bring: ['Sundföt'] },
    { id: 'j3', person: 'jon', kind: 'aefing', icon: '⚽', title: 'Fótboltaæfing', days: [2, 4], start: '17:00', end: '18:30', place: 'holl', bring: ['Takkaskór', 'Vatnsbrúsi'] },
    { id: 'j4', person: 'jon', kind: 'annad', icon: '⛪', title: 'Fermingarfræðsla', days: [3], start: '15:30', end: '16:30', place: 'kirkja' },
    { id: 's1', person: 'soley', kind: 'skoli', title: 'Skóli', days: [1, 2, 3, 4, 5], start: '08:30', end: '13:40', place: 'skoli' },
    { id: 's2', person: 'soley', kind: 'tomstund', title: 'Frístund', days: [1, 2, 3, 4, 5], start: '13:40', end: '16:30', pickup: 'Mamma sækir 16:30' },
    { id: 's3', person: 'soley', kind: 'aefing', icon: '🤸', title: 'Fimleikar', days: [1, 3], start: '17:00', end: '18:00', place: 'fimleikar', pickup: 'Pabbi keyrir', bring: ['Fimleikaföt'] },
  ];
  const tue = isoDow(t) === 2 ? D(0) : nextDow(2);
  d.changes = [{ id: `j3@${tue}`, weeklyId: 'j3', date: tue, start: '17:30', end: '19:00', note: 'Færð vegna leiks á vellinum', pickup: 'Pabbi sækir' }];
  d.events = [
    { id: 'e1', person: 'jon', title: 'Tannlæknir', icon: '🦷', date: D(2), start: '14:50', end: '15:20', pickup: 'Mamma sækir í skólann' },
    { id: 'e2', person: 'all', title: 'Matarboð hjá ömmu', icon: '🍲', date: D(4), start: '18:30' },
  ];
  d.offDays = [{ id: 'o1', title: 'Starfsdagur', date: nextDow(1), kinds: ['skoli'] }];
  d.updatedAt = new Date().toISOString();
  return d;
}

/* ---------- ræsing ---------- */
async function boot(fromLock = false) {
  if (window.DAGURINN_DEMO || new URLSearchParams(location.search).has('demo')) { startDemo(); return; }
  if (!state.pw) {
    let exists = true;
    try { exists = !!(await fetchRemote()); } catch { /* sýnum læsingu */ }
    renderLock('', !exists);
    return;
  }
  let remote = null, offline = false;
  try { remote = await fetchRemote(); } catch (e) {
    if (e.message === 'auth') setStatus('Aðgangslykill virkar ekki – sjá Stillingar');
    const cached = store.get('file');
    if (cached) { remote = { file: JSON.parse(cached), sha: null }; offline = true; }
  }
  if (!remote) { renderLock('', true); return; }
  try {
    state.data = normalize(await decryptData(remote.file, state.pw));
    state.salt = remote.file.salt;
    state.sha = remote.sha;
    store.set('pw', state.pw);
    store.set('file', JSON.stringify(remote.file));
    if (offline) setStatus('Ekkert netsamband – sýni síðustu útgáfu');
    render();
    loadWeather();
  } catch {
    store.set('pw', null);
    renderLock(fromLock ? 'Rangt lykilorð' : '');
  }
}
function startDemo() {
  state.demo = true;
  state.data = makeDemo();
  render();
  loadWeather();
}

document.addEventListener('click', (e) => {
  const v = e.target.closest('[data-view]');
  if (v) { state.view = v.dataset.view; render(); window.scrollTo(0, 0); return; }
  const p = e.target.closest('[data-person]');
  if (p) { state.person = p.dataset.person; store.set('person', state.person); render(); return; }
  const it = e.target.closest('[data-item]');
  if (it) { openItem(it.dataset.item); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'settings') openSettings();
  if (act === 'add') openAdd();
  if (act === 'demo') startDemo();
  if (act === 'setup') openSetup();
  if (act === 'leave-demo') { if (window.DAGURINN_DEMO) return; location.href = location.pathname; }
  if (act === 'refresh') { if (state.demo) { render(); return; } if (state.ops.length) save(); else boot(); loadWeather(); }
});

setInterval(() => { if (state.data && !$('#sheet-root').innerHTML) render(); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.data && !state.demo && !state.ops.length && !$('#sheet-root').innerHTML) { boot(); }
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
