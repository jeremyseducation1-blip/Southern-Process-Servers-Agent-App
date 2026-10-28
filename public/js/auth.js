// Login gate for the app (not used on the share-link page).
// - Adds the saved login to every call to our own functions.
// - If the server says a login is needed (or it expired), shows the login screen.
// - Does nothing visible when no password has been set up on the server.
(function () {
  const KEY = 'sps_auth';
  const FN = '/.netlify/functions/';
  const get = () => { try { return localStorage.getItem(KEY) || ''; } catch (_) { return ''; } };
  const put = (t) => { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (_) { /* ignore */ } };

  const nativeFetch = window.fetch.bind(window);
  let gateShown = false;

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf(FN) !== 0 || url.indexOf(FN + 'login') === 0) return nativeFetch(input, init);
    const opts = Object.assign({}, init || {});
    const headers = new Headers(opts.headers || (typeof input !== 'string' && input.headers) || {});
    const t = get();
    if (t) headers.set('Authorization', 'Bearer ' + t);
    opts.headers = headers;
    const res = await nativeFetch(input, opts);
    if (res.status === 401) {
      let body = '';
      try { body = await res.clone().text(); } catch (_) { /* ignore */ }
      if (body.indexOf('AUTH_REQUIRED') >= 0) { put(''); showGate('Please sign in again.'); }
    }
    return res;
  };

  // Downloads opened as plain links (CSV, calendar file) carry the login too.
  document.addEventListener('click', function (e) {
    const a = e.target && e.target.closest && e.target.closest('a[href*="/.netlify/functions/"]');
    const t = get();
    if (!a || !t || /[?&]auth=/.test(a.href)) return;
    a.href = a.href + (a.href.indexOf('?') >= 0 ? '&' : '?') + 'auth=' + encodeURIComponent(t);
  }, true);

  function showGate(message) {
    if (gateShown) return;
    gateShown = true;
    const o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;z-index:5000;background:#0B2A5B;display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,system-ui,sans-serif;';
    o.innerHTML =
      '<form style="background:#fff;border-radius:18px;padding:24px;max-width:360px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.35);">' +
      '<div style="font-weight:800;font-size:1.3rem;color:#0B2A5B;margin-bottom:4px;">Southern Process Servers</div>' +
      '<div style="color:#4A5B7C;font-size:.9rem;margin-bottom:16px;">Sign in to continue</div>' +
      '<input id="spsPw" type="password" autocomplete="current-password" placeholder="Password" style="width:100%;height:50px;border:2px solid #C9D5EE;border-radius:12px;padding:0 14px;font-size:1rem;box-sizing:border-box;">' +
      '<p id="spsPwMsg" style="color:#B3261E;font-size:.85rem;min-height:1.2em;margin:8px 0;"></p>' +
      '<button type="submit" style="width:100%;height:50px;border:0;border-radius:12px;background:#FFC72C;color:#0B2A5B;font-weight:800;font-size:1rem;">Sign in</button>' +
      '</form>';
    document.body.appendChild(o);
    const msg = o.querySelector('#spsPwMsg');
    msg.textContent = message || '';
    const input = o.querySelector('#spsPw');
    setTimeout(() => input.focus(), 50);
    o.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = o.querySelector('button');
      btn.disabled = true; msg.style.color = '#4A5B7C'; msg.textContent = 'Checking…';
      try {
        const res = await nativeFetch(FN + 'login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
        if (!res.ok) throw new Error(res.status === 401 ? 'Wrong password.' : 'Could not sign in — try again.');
        const { token } = await res.json();
        put(token);
        location.reload();
      } catch (err) {
        msg.style.color = '#B3261E'; msg.textContent = err.message; btn.disabled = false; input.select();
      }
    });
  }

  nativeFetch(FN + 'auth-status', { headers: get() ? { Authorization: 'Bearer ' + get() } : {} })
    .then((r) => r.json())
    .then((s) => { if (s.required && !s.ok) { put(''); showGate(''); } })
    .catch(() => { /* offline: the app shows its usual errors */ });
})();
