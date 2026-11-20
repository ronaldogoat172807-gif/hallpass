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

// Call onChange now, whenever the server says something changed, and every 30s as a fallback.
export function live(onChange) {
  const es = new EventSource('/api/events');
  es.addEventListener('changed', onChange);
  setInterval(onChange, 30000);
  onChange();
  return es;
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
