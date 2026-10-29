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


  // ---------- Face ID / passkeys ----------
  const b64u = {
    enc: (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: (str) => { const s = str.replace(/-/g, '+').replace(/_/g, '/'); const pad = s + '==='.slice((s.length + 3) % 4); const bin = atob(pad); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out.buffer; }
  };
  const passkeysSupported = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  const jsonHeaders = { 'Content-Type': 'application/json' };

  async function faceIdSignIn() {
    const o = await nativeFetch(FN + 'passkey-login-options', { method: 'POST', headers: jsonHeaders, body: '{}' });
    if (!o.ok) throw new Error(await o.text());
    const { options, ch } = await o.json();
    const cred = await navigator.credentials.get({ publicKey: {
      challenge: b64u.dec(options.challenge), rpId: options.rpId, timeout: 60000, userVerification: 'required',
      allowCredentials: (options.allowCredentials || []).map((c) => ({ type: 'public-key', id: b64u.dec(c.id), transports: c.transports }))
    } });
    const r = cred.response;
    const res = await nativeFetch(FN + 'passkey-login-verify', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ch, response: {
      id: cred.id, rawId: b64u.enc(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      response: { authenticatorData: b64u.enc(r.authenticatorData), clientDataJSON: b64u.enc(r.clientDataJSON), signature: b64u.enc(r.signature), userHandle: r.userHandle ? b64u.enc(r.userHandle) : undefined }
    } }) });
    if (!res.ok) throw new Error(await res.text());
    const { token } = await res.json();
    put(token);
  }

  // Must be signed in (password) first. Adds Face ID on THIS phone.
  async function registerFaceId(name) {
    const t = get();
    const h = Object.assign({ Authorization: 'Bearer ' + t }, jsonHeaders);
    const o = await nativeFetch(FN + 'passkey-register-options', { method: 'POST', headers: h, body: '{}' });
    if (!o.ok) throw new Error(await o.text());
    const { options, ch } = await o.json();
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: b64u.dec(options.challenge), rp: options.rp, timeout: 60000, attestation: 'none',
      user: { id: b64u.dec(options.user.id), name: options.user.name, displayName: options.user.displayName },
      pubKeyCredParams: options.pubKeyCredParams,
      excludeCredentials: (options.excludeCredentials || []).map((c) => ({ type: 'public-key', id: b64u.dec(c.id), transports: c.transports })),
      authenticatorSelection: options.authenticatorSelection
    } });
    const r = cred.response;
    const res = await nativeFetch(FN + 'passkey-register-verify', { method: 'POST', headers: h, body: JSON.stringify({ ch, name: name || 'This phone', response: {
      id: cred.id, rawId: b64u.enc(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      response: { clientDataJSON: b64u.enc(r.clientDataJSON), attestationObject: b64u.enc(r.attestationObject), transports: r.getTransports ? r.getTransports() : [] }
    } }) });
    if (!res.ok) throw new Error(await res.text());
    try { localStorage.setItem('sps_pk', '1'); } catch (_) { /* ignore */ }
    return res.json();
  }

  let status = { required: false, ok: true, passkeys: 0 };
  window.SPSAuth = { supported: passkeysSupported, registerFaceId, status: () => status };


  // Right after a password sign-in on a phone with no Face ID set up yet.
  function offerFaceId(overlay) {
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:18px;padding:24px;max-width:360px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.35);">' +
      '<div style="font-weight:800;font-size:1.25rem;color:#0B2A5B;margin-bottom:6px;">Turn on Face ID?</div>' +
      '<div style="color:#4A5B7C;font-size:.95rem;margin-bottom:16px;">Next time you can open the app with your face instead of typing the password.</div>' +
      '<button id="spsPkYes" style="width:100%;height:50px;border:0;border-radius:12px;background:#FFC72C;color:#0B2A5B;font-weight:800;font-size:1rem;">Turn on Face ID</button>' +
      '<button id="spsPkNo" style="width:100%;height:44px;margin-top:8px;border:0;background:none;color:#4A5B7C;font-size:.95rem;">Not now</button>' +
      '<p id="spsPkMsg" style="color:#B3261E;font-size:.85rem;min-height:1.2em;margin:8px 0 0;"></p></div>';
    const m = overlay.querySelector('#spsPkMsg');
    overlay.querySelector('#spsPkNo').addEventListener('click', () => { try { localStorage.setItem('sps_pk', 'skip'); } catch (_) { /* ignore */ } location.reload(); });
    overlay.querySelector('#spsPkYes').addEventListener('click', async () => {
      m.style.color = '#4A5B7C'; m.textContent = 'Follow the Face ID prompt…';
      try { await registerFaceId('This phone'); location.reload(); }
      catch (err) { m.style.color = '#B3261E'; m.textContent = (err && err.message) || 'Face ID setup did not finish.'; }
    });
  }

  function showGate(message) {
    if (gateShown) return;
    gateShown = true;
    const o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;z-index:5000;background:#0B2A5B;display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,system-ui,sans-serif;';
    o.innerHTML =
      '<form style="background:#fff;border-radius:18px;padding:24px;max-width:360px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.35);">' +
      '<div style="font-weight:800;font-size:1.3rem;color:#0B2A5B;margin-bottom:4px;">Southern Process Servers</div>' +
      '<div style="color:#4A5B7C;font-size:.9rem;margin-bottom:16px;">Sign in to continue</div>' +
      '<div style="position:relative;"><input id="spsPw" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Password" style="width:100%;height:50px;border:2px solid #C9D5EE;border-radius:12px;padding:0 54px 0 14px;font-size:1rem;box-sizing:border-box;">' +
      '<button type="button" id="spsEye" aria-label="Show password" style="position:absolute;right:4px;top:4px;width:42px;height:42px;border:0;background:none;font-size:1.3rem;cursor:pointer;">👁️</button></div>' +
      '<p id="spsPwMsg" style="color:#B3261E;font-size:.85rem;min-height:1.2em;margin:8px 0;"></p>' +
      '<button type="submit" style="width:100%;height:50px;border:0;border-radius:12px;background:#FFC72C;color:#0B2A5B;font-weight:800;font-size:1rem;">Sign in</button>' +
      '<button type="button" id="spsFaceBtn" hidden style="width:100%;height:50px;margin-top:10px;border:2px solid #0B2A5B;border-radius:12px;background:#fff;color:#0B2A5B;font-weight:800;font-size:1rem;">Sign in with Face ID</button>' +
      '</form>';
    document.body.appendChild(o);
    const msg = o.querySelector('#spsPwMsg');
    msg.textContent = message || '';
    const input = o.querySelector('#spsPw');
    const faceBtn = o.querySelector('#spsFaceBtn');
    o.querySelector('#spsEye').addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      o.querySelector('#spsEye').textContent = showing ? '👁️' : '🙈';
      o.querySelector('#spsEye').setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      input.focus();
    });
    const tryFace = async () => {
      msg.style.color = '#4A5B7C'; msg.textContent = 'Waiting for Face ID…';
      try { await faceIdSignIn(); location.reload(); }
      catch (err) { msg.style.color = '#B3261E'; msg.textContent = /NotAllowed|cancel/i.test(String(err && (err.name || err.message))) ? 'Face ID was cancelled — use your password, or tap the button to try again.' : (err.message || 'Face ID did not work.'); }
    };
    if (status.passkeys > 0 && passkeysSupported()) {
      faceBtn.hidden = false;
      faceBtn.addEventListener('click', tryFace);
      tryFace(); // try straight away; if the phone wants a tap first, the button is right there
    } else {
      setTimeout(() => input.focus(), 50);
    }
    o.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = o.querySelector('button');
      btn.disabled = true; msg.style.color = '#4A5B7C'; msg.textContent = 'Checking…';
      try {
        const res = await nativeFetch(FN + 'login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
        if (!res.ok) throw new Error(res.status === 401 ? 'Wrong password.' : 'Could not sign in — try again.');
        const { token } = await res.json();
        put(token);
        let offered = false;
        try { offered = !!localStorage.getItem('sps_pk'); } catch (_) { /* ignore */ }
        if (passkeysSupported() && !offered) { offerFaceId(o); return; }
        location.reload();
      } catch (err) {
        msg.style.color = '#B3261E'; msg.textContent = err.message; btn.disabled = false; input.select();
      }
    });
  }

  nativeFetch(FN + 'auth-status', { headers: get() ? { Authorization: 'Bearer ' + get() } : {} })
    .then((r) => r.json())
    .then((s) => {
      status = s;
      if (s.required && !s.ok) { put(''); showGate(''); return; }
      const card = document.getElementById('securityCard');
      if (card && s.required && passkeysSupported()) {
        card.hidden = false;
        const btn = document.getElementById('faceIdSetupBtn');
        const st = document.getElementById('faceIdStatus');
        if (s.passkeys > 0 && localStorage.getItem('sps_pk') === '1') st.textContent = '✓ Face ID is on for this phone.';
        btn.addEventListener('click', async () => {
          btn.disabled = true; st.className = 'status'; st.textContent = 'Follow the Face ID prompt…';
          try { await registerFaceId('This phone'); st.className = 'status ok'; st.textContent = '✓ Face ID is on for this phone.'; }
          catch (err) { st.className = 'status err'; st.textContent = (err && err.message) || 'Face ID setup did not finish.'; }
          btn.disabled = false;
        });
      }
    })
    .catch(() => { /* offline: the app shows its usual errors */ });
})();
