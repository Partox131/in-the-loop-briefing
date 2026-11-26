// Visitor analytics: Google Analytics 4 with Google Consent Mode v2.
//
// Loaded by both pages of the static site (the build adds it). It does
// nothing until GA_ID holds the property's Measurement ID, nothing in demo
// mode (?demo=1) and nothing on localhost.
//
// Consent: analytics cookies start off ("denied") for visitors in the EEA,
// the UK, Switzerland and Quebec (Law 25), and on elsewhere. A slim strip
// above the page header (in the page flow, so it never covers the map) asks
// once; the answer is kept in localStorage. "No thanks" turns cookies off
// everywhere. While denied, Google gets cookieless pings only (Consent Mode
// "advanced"); set ADVANCED = false to send nothing at all until "OK".
// Ads storage and signals are always off: we run no ads.
//
// The pages report their own events with window.itlTrack(name, params):
// segment_switch, map_zoom, story_preview, time_window, tour_start,
// tour_skip, tour_end, briefing_filter, newsletter_signup,
// newsletter_dismiss, alerts_open, alerts_on, alerts_update, alerts_off,
// alerts_error. This file adds app_installed,
// source_click (a link out to an outlet or post), story_open and
// briefing_open (links into the briefing page).
(() => {
  const GA_ID = 'G-Q772FJ2XNV'; // Amir's GA4 property (In the Loop)
  const ADVANCED = true;
  const KEY = 'itl-consent'; // 'granted' | 'denied'
  // EEA, UK, Switzerland and Quebec: ask before any analytics cookie.
  const ASK_FIRST = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH', 'CA-QC'];

  window.itlTrack = () => {};
  const q = new URLSearchParams(window.itlSearch ?? location.search);
  if (!/^G-[A-Z0-9]+$/.test(GA_ID) || q.has('demo') || /^(localhost|127\.|\[::1\])/.test(location.hostname)) return;

  const appMode = () => { try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'app' : 'browser'; } catch { return 'browser'; } };
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const save = (v) => { try { localStorage.setItem(KEY, v); } catch {} };
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  const off = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
  gtag('consent', 'default', { ...off, analytics_storage: 'granted', wait_for_update: 500 });
  gtag('consent', 'default', { ...off, analytics_storage: 'denied', region: ASK_FIRST });
  gtag('set', 'ads_data_redaction', true);
  gtag('set', 'url_passthrough', false);
  const choice = read();
  if (choice) gtag('consent', 'update', { analytics_storage: choice });

  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    gtag('js', new Date());
    // app_mode: "app" when opened from the home-screen icon (installed), "browser" otherwise.
    gtag('config', GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false, app_mode: appMode() });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
  };
  if (ADVANCED || choice === 'granted') load();

  // The segment on screen: ?segment= on the map, or the page's own path
  // (/us-politics/, /canadian-politics/) on the region and segment pages.
  const segment = () => {
    const s = new URLSearchParams(location.search).get('segment');
    if (s) return s;
    if (/^\/us-politics\//.test(location.pathname)) return 'us';
    if (/^\/canadian-politics\//.test(location.pathname)) return 'ca';
    return 'geopolitics';
  };
  window.itlTrack = (name, params = {}) => { if (loaded) gtag('event', name, { segment: segment(), ...params }); };
  window.addEventListener('appinstalled', () => window.itlTrack('app_installed'));

  // Links out and into the briefing, from anywhere on either page.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    if (u.origin !== location.origin) {
      if (/^https?:$/.test(u.protocol)) window.itlTrack('source_click', { source_host: u.hostname.replace(/^www\./, ''), link_url: u.href.slice(0, 300) });
    } else if (/briefing\.html$/.test(u.pathname)) {
      window.itlTrack(a.classList.contains('brieflink') ? 'briefing_open' : 'story_open', { node: u.searchParams.get('node') || '' });
    }
  }, true);

  // The consent strip: once, only while there is no stored answer.
  if (choice) return;
  // The pages' own colour tokens (--raise, --ink, --muted, --line), with fallbacks.
  const css = `
.itl-consent{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;justify-content:center;padding:6px 16px;font:13px/1.4 var(--body,system-ui,sans-serif);background:var(--raise,#fff);color:var(--muted,#5b6080);border-bottom:1px solid var(--line,#e2e5ef)}
.itl-consent p{margin:0}
.itl-consent a{color:inherit}
@media (max-width:640px){.itl-consent .more{display:none}}
.itl-consent button{font:inherit;min-height:28px;padding:0 12px;border-radius:999px;border:1px solid var(--line,#e2e5ef);background:transparent;color:var(--ink,#1d2147);cursor:pointer}
.itl-consent button.ok{background:var(--ink,#1d2147);color:var(--bg,#f5f6f8);border-color:transparent;font-weight:600}`;
  const show = () => {
    if (document.querySelector('.itl-consent')) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const bar = document.createElement('div');
    bar.className = 'itl-consent';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Analytics choice');
    bar.innerHTML = '<p>We count visits with Google Analytics<span class="more"> to learn which parts of the map people use</span>. No ads, nothing sold. <a href="/privacy/">Privacy</a></p><span><button type="button" class="ok">OK</button> <button type="button" class="no">No thanks</button></span>';
    const answer = (v) => {
      save(v);
      gtag('consent', 'update', { analytics_storage: v });
      if (v === 'granted') load();
      bar.remove();
    };
    bar.querySelector('.ok').addEventListener('click', () => answer('granted'));
    bar.querySelector('.no').addEventListener('click', () => answer('denied'));
    document.body.prepend(bar);
  };
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
