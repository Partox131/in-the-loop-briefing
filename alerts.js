// Breaking news alerts: <itl-alerts></itl-alerts>, a bell button that opens a
// small panel where a reader picks what they want alerts for and turns push
// notifications on or off. Our server sends them (scripts/push.js); the plan
// is docs/research/push-notifications.md.
//
// Phase 1 (26 Nov 2026): the bell only shows after visiting the site once with
// ?alerts=1 (remembered in this browser; ?alerts=0 hides it again), or when
// the site is opened from the home screen, while Amir tries it. It never shows in demo mode or clip recordings.
//
// Rules: permission is asked only when the reader presses "Turn on alerts".
// On iPhone and iPad, web pages can only get alerts once added to the home
// screen, so there the panel explains how instead.
(() => {
  if (window.customElements?.get('itl-alerts')) return;
  const API = 'https://api.inthelooplive.com/push';
  const KEY = 'itl-alerts';          // saved choices: {on, topics, max, quiet}
  const BETA = 'itl-alerts-beta';    // phase 1 switch
  const q = new URLSearchParams(window.itlSearch ?? location.search);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} },
  };
  if (q.get('alerts') === '1') store.set(BETA, '1');
  if (q.get('alerts') === '0') store.set(BETA, null);

  const TOPICS = [
    ['geopolitics', 'Geopolitics', 'All regions'],
    ['middle-east', 'Middle East', ''],
    ['eastern-europe', 'Eastern Europe', 'Ukraine, Russia, NATO\'s eastern flank'],
    ['east-asia', 'East Asia', 'China and Taiwan'],
    ['us-politics', 'US politics', ''],
    ['ca-politics', 'Canadian politics', ''],
  ];
  const REGIONS = ['middle-east', 'eastern-europe', 'east-asia'];
  const saved = () => { try { return JSON.parse(store.get(KEY) || 'null'); } catch { return null; } };
  const defaults = () => {
    const seg = q.get('segment');
    const view = q.get('view');
    const topic = seg === 'us' ? 'us-politics' : seg === 'ca' ? 'ca-politics' : REGIONS.includes(view) ? view : 'geopolitics';
    return { on: false, topics: [topic], max: 3, quiet: true };
  };

  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  // Phase 1: shown with ?alerts=1, and always in the site installed on a home
  // screen (it has its own storage on iPhone, so it can't remember ?alerts=1).
  const off = q.has('demo') || q.has('clip') || (store.get(BETA) !== '1' && !standalone);
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const css = `
itl-alerts{display:inline-flex}
itl-alerts[hidden]{display:none}
.prow itl-alerts{margin-left:auto}
.itl-bell{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--line,#e2e5ef);background:var(--raise,#fff);color:var(--ink,#1d2147);font:600 14px/1 var(--body,system-ui,sans-serif);cursor:pointer}
.itl-bell svg{width:16px;height:16px}
.itl-bell.on{border-color:var(--loop,#3047d6);color:var(--loop,#3047d6)}
.itl-al{border:1px solid var(--line,#e2e5ef);border-radius:16px;padding:18px 20px;max-width:min(420px,calc(100vw - 32px));background:var(--raise,#fff);color:var(--ink,#1d2147);font:15px/1.45 var(--body,system-ui,sans-serif)}
.itl-al::backdrop{background:rgba(10,12,30,.35)}
.itl-al h3{margin:0 0 4px;font:700 19px/1.25 var(--display,var(--body,system-ui,sans-serif))}
.itl-al p{margin:0 0 12px;color:var(--muted,#5b6080)}
.itl-al fieldset{border:0;margin:0 0 12px;padding:0}
.itl-al legend{font-weight:700;margin-bottom:6px;padding:0}
.itl-al label{display:flex;gap:8px;align-items:flex-start;padding:4px 0;cursor:pointer}
.itl-al label.sub{padding-left:24px}
.itl-al label small{display:block;color:var(--muted,#5b6080);font-size:13px}
.itl-al input{accent-color:var(--loop,#3047d6);margin-top:3px}
.itl-al select{font:inherit;padding:4px 8px;border-radius:8px;border:1px solid var(--line,#e2e5ef);background:var(--bg,#f5f6f8);color:inherit}
.itl-al .row{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.itl-al button{min-height:40px;padding:0 16px;border-radius:999px;border:0;font:inherit;font-weight:700;cursor:pointer;background:var(--loop,#3047d6);color:var(--on-loop,#fff)}
.itl-al button.plain{background:none;color:inherit;border:1px solid var(--line,#e2e5ef)}
.itl-al button[disabled]{opacity:.6;cursor:default}
.itl-al .msg{margin:10px 0 0;font-weight:600}
.itl-al .msg.err{color:var(--disputed,#9b2c74)}
.itl-al ol{margin:0 0 12px;padding-left:20px}`;
  const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const all = new Set();
  let dialog = null;
  const ui = { busy: false, msg: '', err: false };

  const b64ToBytes = (s) => {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  };
  const post = (path, body) => fetch(`${API}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`server ${r.status}`))));
  const reg = () => navigator.serviceWorker.register('/sw.js');

  function choicesFrom(form) {
    const topics = TOPICS.map(([id]) => id).filter((id) => form.elements[id]?.checked);
    // Geopolitics covers its regions.
    const clean = topics.includes('geopolitics') ? topics.filter((t) => !REGIONS.includes(t)) : topics;
    return { topics: clean, max: Number(form.elements.max.value), quiet: form.elements.quiet.checked, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }

  async function turnOn(form) {
    const c = choicesFrom(form);
    if (!c.topics.length) { ui.msg = 'Pick at least one topic.'; ui.err = true; return draw(); }
    ui.busy = true; ui.msg = ''; draw();
    try {
      // Ask first, straight from the button press (Safari needs that).
      const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (perm !== 'granted') throw new Error(perm === 'denied' ? 'denied' : 'dismissed');
      const r = await reg();
      await navigator.serviceWorker.ready;
      let sub = await r.pushManager.getSubscription();
      if (!sub) {
        const { key } = await fetch(`${API}/key`).then((x) => x.json());
        sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      }
      await post('subscribe', { subscription: sub.toJSON(), ...c });
      const was = saved()?.on;
      store.set(KEY, JSON.stringify({ on: true, topics: c.topics, max: c.max, quiet: c.quiet }));
      ui.msg = was ? 'Saved.' : 'Alerts are on. A first notification is on its way so you can see it works.'; ui.err = false;
    } catch (e) {
      ui.err = true;
      ui.msg = e.message === 'denied' ? 'Notifications are blocked for this site. You can allow them in your browser\'s site settings.'
        : e.message === 'dismissed' ? 'No problem. Press the button again whenever you want alerts.'
          : 'That didn\'t work. Please try again in a minute.';
    }
    ui.busy = false; draw();
  }

  async function turnOff() {
    ui.busy = true; draw();
    try {
      const r = await navigator.serviceWorker.getRegistration('/');
      const sub = await r?.pushManager.getSubscription();
      if (sub) { await post('unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
      store.set(KEY, JSON.stringify({ ...(saved() || defaults()), on: false }));
      ui.msg = 'Alerts are off.'; ui.err = false;
    } catch { ui.msg = 'That didn\'t work. Please try again.'; ui.err = true; }
    ui.busy = false; draw();
  }

  function panel() {
    const s = saved() || defaults();
    if (!supported && ios && !standalone) {
      return `<h3>Alerts on iPhone and iPad</h3><p>Apple only lets websites send alerts once they're on your home screen. It takes a few seconds:</p>
<ol><li>Tap the <b>Share</b> button in Safari.</li><li>Tap <b>Add to Home Screen</b>.</li><li>Open In the Loop from your home screen and tap the bell again.</li></ol>
<div class="row"><button class="plain" data-close>Close</button></div>`;
    }
    if (!supported) return `<h3>Breaking news alerts</h3><p>This browser can't show alerts from websites. Chrome, Edge, Firefox and Safari can.</p><div class="row"><button class="plain" data-close>Close</button></div>`;
    const geo = s.topics.includes('geopolitics');
    const box = ([id, label, hint]) => `<label class="${REGIONS.includes(id) ? 'sub' : ''}"><input type="checkbox" name="${id}"${s.topics.includes(id) || (geo && REGIONS.includes(id)) ? ' checked' : ''}${geo && REGIONS.includes(id) ? ' disabled' : ''}><span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span></label>`;
    return `<h3>Breaking news alerts</h3>
<p>We'll tell you when at least 3 independent outlets report something new within 90 minutes. A side's own claims never trigger an alert.</p>
<form>
<fieldset><legend>Alert me about</legend>${TOPICS.map(box).join('')}</fieldset>
<fieldset><legend>How many</legend>
<label>At most <select name="max">${[1, 3, 5].map((n) => `<option${n === s.max ? ' selected' : ''}>${n}</option>`).join('')}</select> a day, at least an hour apart</label>
<label><input type="checkbox" name="quiet"${s.quiet ? ' checked' : ''}><span>Quiet at night<small>Nothing between 11 PM and 7 AM; one morning alert for what broke overnight</small></span></label>
</fieldset>
<div class="row"><button type="submit"${ui.busy ? ' disabled' : ''}>${s.on ? 'Save' : 'Turn on alerts'}</button>${s.on ? `<button type="button" class="plain" data-off${ui.busy ? ' disabled' : ''}>Turn off alerts</button>` : ''}<button type="button" class="plain" data-close>Close</button></div>
${ui.msg ? `<p class="msg${ui.err ? ' err' : ''}" role="status">${esc(ui.msg)}</p>` : ''}
</form>`;
  }

  function draw() {
    for (const el of all) el.draw();
    if (!dialog?.open) return;
    dialog.innerHTML = panel();
    const form = dialog.querySelector('form');
    dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
    dialog.querySelector('[data-off]')?.addEventListener('click', turnOff);
    if (!form) return;
    form.addEventListener('submit', (e) => { e.preventDefault(); turnOn(form); });
    form.elements.geopolitics.addEventListener('change', (e) => {
      for (const r of REGIONS) { form.elements[r].checked = e.target.checked || form.elements[r].checked; form.elements[r].disabled = e.target.checked; }
    });
  }

  function open() {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'itl-al';
      dialog.setAttribute('aria-label', 'Breaking news alerts');
      document.body.appendChild(dialog);
      dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    }
    ui.msg = ''; ui.err = false;
    if (supported) reg().catch(() => {}); // early, so turning on is quick
    dialog.showModal();
    draw();
  }

  let styled = false;
  class Alerts extends HTMLElement {
    connectedCallback() {
      all.add(this);
      if (!styled) { styled = true; const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }
      this.draw();
    }
    disconnectedCallback() { all.delete(this); }
    draw() {
      if (off) { this.hidden = true; this.innerHTML = ''; return; }
      this.hidden = false;
      const on = saved()?.on;
      this.innerHTML = `<button type="button" class="itl-bell${on ? ' on' : ''}" aria-haspopup="dialog">${BELL}<span>${on ? 'Alerts on' : 'Alerts'}</span></button>`;
      this.firstChild.addEventListener('click', open);
    }
  }
  customElements.define('itl-alerts', Alerts);
})();
