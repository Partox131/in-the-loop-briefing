// Email sign-up card: <itl-signup source="map"></itl-signup>
//
// Collects addresses for the future newsletter (docs/research/newsletter.md)
// and posts them to our server (scripts/signup.js). Nothing is emailed yet.
// It's an element, not a pop-up: it sits in the page flow (the reading panel,
// the phone sheet, the briefing, the text pages) and never covers the map.
//
// Rules: hidden in demo mode and in clip recordings; hidden while the
// analytics consent strip is still waiting (one ask at a time); hidden for
// good after a sign-up or "No thanks" (localStorage). The pages redraw with
// innerHTML, so the typed address and focus are kept across redraws.
(() => {
  if (window.customElements?.get('itl-signup')) return;
  const ENDPOINT = 'https://api.inthelooplive.com/subscribe';
  const KEY = 'itl-signup'; // 'done' | 'no'
  const q = new URLSearchParams(window.itlSearch ?? location.search);
  const off = q.has('demo') || q.has('clip');
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const save = (v) => { try { localStorage.setItem(KEY, v); } catch {} };
  const draft = { value: '', focused: false, state: 'idle', msg: '' }; // shared across redraws
  const css = `
itl-signup{display:block}
itl-signup[hidden]{display:none}
.itl-su{background:var(--raise,#fff);border:1px solid var(--line,#e2e5ef);border-radius:14px;padding:14px 16px;margin:14px 0;font:15px/1.45 var(--body,system-ui,sans-serif);color:var(--ink,#1d2147)}
.itl-su h3{margin:0 0 4px;font:700 17px/1.25 var(--display,var(--body,system-ui,sans-serif))}
.itl-su p{margin:0 0 10px;color:var(--muted,#5b6080)}
.itl-su form{display:flex;flex-wrap:wrap;gap:8px}
.itl-su input[type=email]{flex:1 1 180px;min-width:0;min-height:40px;padding:0 12px;border-radius:999px;border:1px solid var(--line,#e2e5ef);background:var(--bg,#f5f6f8);color:inherit;font:inherit}
.itl-su button{min-height:40px;padding:0 16px;border-radius:999px;border:0;font:inherit;font-weight:700;cursor:pointer;background:var(--loop,#3047d6);color:var(--on-loop,#fff)}
.itl-su button[disabled]{opacity:.6;cursor:default}
.itl-su .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.itl-su .fine{margin:8px 0 0;font-size:13px}
.itl-su .fine a{color:inherit}
.itl-su .fine button{background:none;color:inherit;padding:0;min-height:0;font-weight:400;text-decoration:underline;font-size:13px}
.itl-su .msg{margin:8px 0 0;font-weight:600}
.itl-su .msg.err{color:var(--disputed,#9b2c74)}`;
  let styled = false;
  const consentWaiting = () => !!document.querySelector('.itl-consent');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const all = new Set();

  class Signup extends HTMLElement {
    connectedCallback() {
      all.add(this);
      if (!styled) { styled = true; const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }
      this.draw();
    }
    disconnectedCallback() { all.delete(this); }
    draw() {
      const choice = read();
      // A thank-you stays visible on the card that was used, until the next redraw of the page.
      if (off || choice === 'no' || (choice === 'done' && draft.state !== 'done') || consentWaiting()) { this.hidden = true; this.innerHTML = ''; return; }
      this.hidden = false;
      if (draft.state === 'done') {
        this.innerHTML = `<div class="itl-su" role="status"><h3>You're on the list</h3><p>Thanks! We'll email you when the first brief is ready, and you can unsubscribe from any email.</p></div>`;
        return;
      }
      const busy = draft.state === 'busy';
      this.innerHTML = `<div class="itl-su"><h3>Get the loop by email</h3><p>A short brief on what moved, which stories are confirmed or disputed, and what changed. Free. Coming soon.</p>
<form novalidate><label class="hp" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>
<input type="email" name="email" required autocomplete="email" inputmode="email" placeholder="you@example.com" aria-label="Your email address" value="${esc(draft.value)}"${busy ? ' disabled' : ''}>
<button type="submit"${busy ? ' disabled' : ''}>${busy ? 'Signing up…' : 'Sign up'}</button></form>
${draft.msg ? `<p class="msg err" role="alert">${esc(draft.msg)}</p>` : ''}
<p class="fine">Unsubscribe any time. <a href="/privacy/">Privacy</a> · <button type="button" class="no">No thanks</button></p></div>`;
      const form = this.querySelector('form');
      const input = form.elements.email;
      input.addEventListener('input', () => { draft.value = input.value; });
      input.addEventListener('focus', () => { draft.focused = true; });
      input.addEventListener('blur', () => { draft.focused = false; });
      if (draft.focused && !busy) { input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length); }
      this.querySelector('.no').addEventListener('click', () => { save('no'); window.itlTrack?.('newsletter_dismiss', { place: this.source }); redrawAll(); });
      form.addEventListener('submit', (e) => { e.preventDefault(); this.submit(form); });
    }
    get source() { return (this.getAttribute('source') || 'page').replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'page'; }
    async submit(form) {
      const email = form.elements.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { draft.msg = 'That email address doesn\'t look right.'; this.draw(); return; }
      draft.value = email; draft.state = 'busy'; draft.msg = ''; this.draw();
      try {
        const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, source: this.source, website: form.elements.website.value }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || String(r.status));
        draft.state = 'done'; draft.value = ''; draft.focused = false;
        save('done');
        window.itlTrack?.('newsletter_signup', { place: this.source });
      } catch (err) {
        draft.state = 'idle';
        draft.msg = /email/.test(err.message) ? 'That email address doesn\'t look right.' : /busy|429/.test(err.message) ? 'Too many tries. Please wait a bit and try again.' : 'Something went wrong. Please try again in a minute.';
      }
      redrawAll();
    }
  }
  const redrawAll = () => all.forEach((el) => el.draw());
  customElements.define('itl-signup', Signup);
  // Hide the cards while the consent strip waits, show them once it's answered.
  let waiting = null;
  const check = () => { const w = consentWaiting(); if (w !== waiting) { waiting = w; redrawAll(); } };
  const watch = () => { new MutationObserver(check).observe(document.body, { childList: true }); check(); };
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch);
})();
