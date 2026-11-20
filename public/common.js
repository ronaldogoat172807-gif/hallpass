// Shared browser helpers: API calls, live updates, time formatting, the chime.

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(json?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// Where the landing page should send this browser. One browser can be signed in as the
// teacher AND joined as the classroom iPad at once (two tabs on one computer), so the
// answer has to be decided once, in a fixed order: the teacher board wins unless the
// address says otherwise (/?as=ipad or /?as=teacher). null means stay on the landing page.
export function landingTarget({ teacher, kiosk, as }) {
  if (as === 'ipad') return kiosk ? '/kiosk.html' : null;
  if (as === 'teacher') return teacher ? '/teacher.html' : null;
  if (teacher) return '/teacher.html';
  if (kiosk) return '/kiosk.html';
  return null;
}

// Call onChange now, whenever the server says something changed, and every 5s as a fallback
// (when the site is hosted there is no live stream, so the timer is what keeps screens fresh).
export function live(onChange) {
  const es = new EventSource('/api/events');
  es.addEventListener('changed', onChange);
  setInterval(onChange, 5000);
  onChange();
  return es;
}

// True when the server's answer differs from the last one seen under this name (ignoring its
// clock). Screens use it to skip redrawing, so a routine re-check never wipes a half-typed
// box or a half-made choice.
const lastSeen = new Map();
export function changed(name, state) {
  const sig = JSON.stringify({ ...state, now: 0 });
  if (lastSeen.get(name) === sig) return false;
  lastSeen.set(name, sig);
  return true;
}

// Minutes a trip may take: the limit of the place it went to (5 if that place was removed).
export function limitFor(trip, places) {
  return places.find((p) => p.id === trip.placeId)?.minutes ?? 5;
}

export function pad(n) { return String(n).padStart(2, '0'); }

export function elapsed(fromMs, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - fromMs) / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export function minutes(fromMs, toMs = Date.now()) {
  return Math.max(0, Math.round((toMs - fromMs) / 60000));
}

export function clock(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function tickClock(el) {
  const update = () => { el.textContent = clock(); };
  update();
  setInterval(update, 1000);
}

// Small element builder: h('div', {class:'x', onclick}, 'text', child, ...)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'hidden') el.hidden = Boolean(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function replace(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
}

let toastTimer;
export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast', class: 'toast' }); document.body.append(el); }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// A two-note chime made with the Web Audio API, so there is no sound file to load.
// Browsers only let audio start after the user has touched the page, so call unlock() on a click.
let ctx = null;
export const chime = {
  unlock() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  },
  play() {
    this.unlock();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const [freq, start] of [[880, 0], [1174.66, 0.18]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + start);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + 1);
    }
  },
};
