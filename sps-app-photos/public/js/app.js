// Return & Affidavit Log — client logic
// Trigger rules encoded here (per Jeremy, Sept 2026):
//   1. Return photo upload is independent — fires to Kevin any time, any case.
//   2. Alias affidavit only applies once ALL 3 attempt dates + notes are filled.
//      Only then does the status dropdown unlock.
//   3. Selecting a status is the completion event. It stamps the saved
//      signature onto the affidavit, generates the PDF, and sends it to
//      Kevin — bundled with the return photo if one has already been
//      uploaded for this case.
//   4. Attempt dates cannot be in the future (data-entry safety, not a
//      formal legal check).

(function () {
  const $ = (sel) => document.querySelector(sel);

  // Populates the Case section with a case's info, expands the
  // Affidavit card, and runs "Check attempts" for it -- the same jump
  // used both by the mark-returned prompt and the "Affidavit" button in
  // Search Cases. Defined early (function declarations hoist) since it's
  // used from code defined further down the file.
  function jumpToAffidavit(c) {
    $('#caseNo').value = c.caseNo || '';
    $('#courtType').value = c.courtType || '';
    $('#county').value = c.county || '';
    $('#plaintiff').value = c.plaintiff || '';
    $('#defendant').value = c.defendant || '';
    $('#extraDefendants').value = (c.defendants || [])
      .map((d) => d.name)
      .filter((name) => name && name !== c.defendant)
      .join(', ');
    $('#serviceAddress').value = c.serviceAddress || '';
    $('#attorney').value = c.attorney || '';
    $('#caseType').value = c.caseType || '';
    $('#isAlias').checked = true;

    showView('paperwork');
    const card = $('#attemptsCard');
    card.classList.remove('collapsed');
    card.querySelector('h2').scrollIntoView({ behavior: 'smooth' });
    $('#checkAttemptsBtn').click();
  }

  // ---------- Collapsible sections ----------
  // Only the Paperwork tab's cards collapse (they're the hub rows there);
  // everything else lives on its own tab and is always open.
  document.querySelectorAll('#view-paperwork .card').forEach((card) => {
    const heading = card.querySelector('h2');
    if (!heading) return;
    card.classList.add('collapsed');
    heading.addEventListener('click', () => {
      card.classList.toggle('collapsed');
    });
  });

  const state = {
    returnSent: false,
    signature: JSON.parse(localStorage.getItem('serverSignature') || 'null')
  };

  // ---------- Signature setup ----------
  const sigCanvas = $('#sigPad');
  const pad = window.SignaturePad(sigCanvas);

  function loadSavedServerInfo() {
    const saved = JSON.parse(localStorage.getItem('serverInfo') || '{}');
    if (saved.name) $('#serverName').value = saved.name;
    if (saved.phone) $('#serverPhone').value = saved.phone;
    if (saved.box) $('#serverBox').value = saved.box;
    if (saved.cityState) $('#serverCityState').value = saved.cityState;
  }
  loadSavedServerInfo();

  function refreshSigPreview() {
    const img = $('#savedSigPreview');
    const note = $('#noSigNote');
    if (state.signature && state.signature.dataUrl) {
      img.src = state.signature.dataUrl;
      img.hidden = false;
      note.hidden = true;
    } else {
      img.hidden = true;
      note.hidden = false;
    }
  }
  refreshSigPreview();

  $('#clearSig').addEventListener('click', () => pad.clear());

  $('#saveSig').addEventListener('click', () => {
    if (pad.isEmpty()) {
      alert('Draw a signature first.');
      return;
    }
    const info = {
      name: $('#serverName').value.trim(),
      phone: $('#serverPhone').value.trim(),
      box: $('#serverBox').value.trim(),
      cityState: $('#serverCityState').value.trim()
    };
    localStorage.setItem('serverInfo', JSON.stringify(info));
    state.signature = { dataUrl: pad.toDataURL() };
    localStorage.setItem('serverSignature', JSON.stringify(state.signature));
    refreshSigPreview();
    $('#sigSetupCard').querySelector('h3').scrollIntoView({ behavior: 'smooth' });
  });

  $('#goSetupSig')?.addEventListener('click', (e) => {
    e.preventDefault();
    $('#sigSetupCard').scrollIntoView({ behavior: 'smooth' });
  });

  // ---------- Weekly log (Jeremy's own view, grouped by week received) ----------
  const loadLogBtn = $('#loadLogBtn');
  const weeklyLogEl = $('#weeklyLog');

  // Returns the Monday of the week a given date falls in, formatted like
  // "Week of September 7". Papers come in Mondays, so weeks are Mon-Sun.
  // Accepts "YYYY-MM-DD" OR a full ISO timestamp (a case's intakeDate is a
  // timestamp like 2026-10-21T15:30:12.345Z). Timestamps become the CENTRAL
  // calendar day they happened on, so a case logged at 8pm Central doesn't
  // land on "tomorrow" (UTC). Returns null if it isn't a date at all.
  function calendarDay(s) {
    const str = String(s || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const t = new Date(str);
    if (isNaN(t.getTime())) return null;
    return t.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  }

  function mondayOfWeek(dateStr) {
    // Parse the YYYY-MM-DD string as LOCAL calendar date parts, not as a
    // UTC timestamp. `new Date("2026-10-05")` is parsed by JS as UTC
    // midnight, which in a US timezone (e.g. Central) is still the
    // *previous* evening locally -- so getDay()/getDate() (which are
    // local-time methods) would report the wrong weekday and silently
    // bucket a Monday return into the week before it. Building the Date
    // from explicit y/m/d avoids that UTC/local mismatch entirely.
    const day = calendarDay(dateStr);
    if (!day) return new Date(NaN);
    const [y, m, day0] = day.split('-').map(Number);
    const d = new Date(y, m - 1, day0);
    const dow = d.getDay(); // 0 = Sunday, 1 = Monday, ...
    const diff = dow === 0 ? -6 : 1 - dow; // shift back to Monday
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  function formatWeekLabel(monday) {
    const opts = { month: 'long', day: 'numeric' };
    return `Week of ${monday.toLocaleDateString('en-US', opts)}`;
  }

  loadLogBtn.addEventListener('click', async () => {
    loadLogBtn.disabled = true;
    weeklyLogEl.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const res = await fetch('/.netlify/functions/list-cases');
      if (!res.ok) throw new Error(await res.text());
      const { cases } = await res.json();

      if (!cases || !cases.length) {
        weeklyLogEl.innerHTML = '<p class="hint">No cases logged yet.</p>';
        return;
      }

      // Group by Monday-of-week, most recent week first. Only the count
      // and week label show here -- tap a week to open a PDF with every
      // case logged that week.
      const groups = new Map(); // key: monday ISO date, value: { label, count }
      cases.forEach((c) => {
        if (!c.intakeDate) return;
        const monday = mondayOfWeek(c.intakeDate);
        if (isNaN(monday.getTime())) return; // unreadable date -- skip rather than break the whole log
        const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
        if (!groups.has(key)) {
          groups.set(key, { label: formatWeekLabel(monday), count: 0 });
        }
        groups.get(key).count += 1;
      });

      const sortedKeys = Array.from(groups.keys()).sort((a, b) => (a < b ? 1 : -1));

      const html = sortedKeys
        .map((key) => {
          const group = groups.get(key);
          const caseWord = group.count === 1 ? 'case' : 'cases';
          return (
            `<button type="button" class="week-btn" data-week="${key}">` +
            `<span class="week-btn-label">${group.label}</span>` +
            `<span class="week-btn-count">${group.count} ${caseWord} &rsaquo;</span>` +
            `</button>`
          );
        })
        .join('');

      weeklyLogEl.innerHTML = html;

      weeklyLogEl.querySelectorAll('.week-btn').forEach((btn) => {
        btn.addEventListener('click', () => openWeekPdf(btn.dataset.week, btn));
      });
    } catch (err) {
      weeklyLogEl.innerHTML = `<p class="status err">Failed to load log. (${err.message})</p>`;
    } finally {
      loadLogBtn.disabled = false;
    }
  });

  // Fetches and opens the PDF for a given week (its Monday, as a
  // YYYY-MM-DD key) in a new tab -- built fresh each time, so it always
  // includes whatever's been logged for that week up to this moment.
  async function openWeekPdf(weekKey, btn) {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="week-btn-label">Opening…</span>';
    try {
      const res = await fetch(`/.netlify/functions/week-log-pdf?week=${weekKey}`);
      if (!res.ok) throw new Error(await res.text());
      const { pdfBase64 } = await res.json();
      const byteChars = atob(pdfBase64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      alert('Failed to open week log — try again. (' + err.message + ')');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  // ---------- "I'm here" (GPS-stamped arrival) + route ----------
  const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const centralTime = (iso) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });

  function locateNow() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('This phone/browser does not support location.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        (err) => {
          if (err.code === 1) reject(new Error('Location is blocked. Allow location for this site in your phone/browser settings, then try again.'));
          else if (err.code === 3) reject(new Error('Could not get a location fix in time. Step outside / wait a few seconds and try again.'));
          else reject(new Error('Could not get your location. Try again.'));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  // One tap: grab GPS, send it; the server stamps the time. Then offers a
  // quick note (saved separately, so the stamp isn't delayed by typing).
  // Returns the server result, or null if it failed/was cancelled.
  //
  // opts.promptNote (default true): ask for the note with confirm/prompt
  //   dialogs afterward. The case-row "Log attempt" button passes false and
  //   opens its own attempt form instead.
  // opts.onError(err): called instead of the default alert when the
  //   location/recording fails (lets the caller offer a fallback).
  async function recordArrival(c, btn, opts) {
    const promptNote = !opts || opts.promptNote !== false;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Getting location…';
    try {
      const pos = await locateNow();
      btn.textContent = 'Recording…';
      const res = await fetch('/.netlify/functions/log-arrival', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy })
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      allCasesCache = null;

      if (out.duplicate) {
        alert(`Already recorded at ${centralTime(out.visit.at)} — that was the same stop.`);
        return out;
      }
      const when = centralTime(out.visit.at);
      const acc = out.visit.accuracy != null ? ` (location accurate to about ${out.visit.accuracy} m)` : '';
      if (!promptNote) return out;
      if (out.attempt) {
        const wantNote = confirm(
          `Recorded: attempt ${out.attempt.n} at ${when}${acc}.\n\n` +
          `Add a quick note about this stop now? (Needed before the affidavit.)`
        );
        if (wantNote) {
          const note = prompt('What happened at this stop? (e.g. Left yellow notice on door)');
          if (note && note.trim()) {
            const r2 = await fetch('/.netlify/functions/save-attempt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                caseInfo: { caseNo: c.caseNo, defendant: c.defendant },
                attemptNumber: out.attempt.n,
                date: out.attempt.date,
                note: note.trim()
              })
            });
            if (!r2.ok) alert('Stop was recorded, but the note did not save — add it with Edit on the attempt.');
          }
        }
      } else {
        alert(`Recorded at ${when}${acc}. This case already has 3 attempts, so it was saved as an extra visit.`);
      }
      return out;
    } catch (err) {
      if (opts && typeof opts.onError === 'function') opts.onError(err);
      else alert('Not recorded — ' + err.message);
      return null;
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  // Builds the attempt form (date, REQUIRED note, optional photo) inside
  // formEl and wires Save/Cancel. Shared by the Search Cases rows and the
  // Route card, so notes work the same everywhere. onSaved(savedAttempt)
  // runs after a successful save.
  //
  // The form is a POP-UP over the page (not tucked under the case's button
  // list, where it could open below the visible screen and go unnoticed),
  // with the cursor already in the note box.
  function buildAttemptForm({ formEl, c, n, existingAttempt, justRecorded, onSaved }) {
      const old = document.querySelector('.attempt-modal');
      if (old) old.remove();
      const overlay = document.createElement('div');
      overlay.className = 'attempt-modal';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;overflow:auto;padding:1rem;';
      const panel = document.createElement('div');
      panel.style.cssText = 'background:var(--panel,#fff);max-width:30rem;margin:0 auto;padding:1rem;border-radius:6px;';
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      const closeModal = () => overlay.remove();
      formEl = panel; // everything below builds inside the pop-up

      const isEdit = !!existingAttempt && !justRecorded;
      const existingDate = existingAttempt?.date || '';
      const existingNote = existingAttempt?.note || '';

      const stampBanner = justRecorded && existingAttempt && existingAttempt.visitAt
        ? `<p class="hint">📍 Attempt ${n} recorded at ${centralTime(existingAttempt.visitAt)}` +
          `${existingAttempt.accuracy != null ? ' (location accurate to about ' + existingAttempt.accuracy + ' m)' : ''}. ` +
          `Type what happened (e.g. left yellow notice on door) and save. Cancel keeps the attempt; add the note later with Edit.</p>`
        : '';
      formEl.innerHTML = `<h3 style="margin-top:0;">${esc(c.defendant || 'Case')} — attempt ${n}</h3>` + stampBanner + `
        <label>Attempt ${n} date <input type="date" class="attempt-log-date" value="${existingDate}"></label>
        <label>Note (required) <textarea class="attempt-log-note" rows="2" placeholder="What happened on this attempt">${existingNote.replace(/</g, '&lt;')}</textarea></label>
        <div class="photo-pick">
          <div class="hint" style="margin:0 0 .4rem;">Photo of notice (optional evidence)${isEdit ? ' — leave blank to keep the existing photo' : ''}</div>
          <div class="photo-btns">
            <label class="btn secondary photo-btn">📷 Take photo<input type="file" class="attempt-log-photo" accept="image/*" capture="environment" hidden></label>
            <label class="btn secondary photo-btn">🖼️ Choose from photos<input type="file" class="attempt-log-photo-lib" accept="image/*" hidden></label>
          </div>
          <p class="hint attempt-log-photo-label" style="margin:.4rem 0 0;"></p>
        </div>
        <div class="sig-actions">
          <button type="button" class="btn primary attempt-log-save-btn">${isEdit ? `Save changes to attempt ${n}` : `Save attempt ${n}`}</button>
          <button type="button" class="btn secondary attempt-log-cancel-btn">Cancel</button>
        </div>
        <p class="status attempt-log-status"></p>
      `;
      formEl.querySelector('.attempt-log-cancel-btn').addEventListener('click', () => {
        closeModal();
        // A just-stamped attempt stays recorded -- refresh so it shows.
        if (justRecorded && typeof onSaved === 'function') onSaved(null);
      });
      // Camera OR photo library -- picking one clears the other.
      (function wirePhotoPickers() {
        const cam = formEl.querySelector('.attempt-log-photo');
        const lib = formEl.querySelector('.attempt-log-photo-lib');
        const label = formEl.querySelector('.attempt-log-photo-label');
        const changed = (picked, other) => () => {
          if (picked.files[0]) { other.value = ''; label.textContent = '✓ ' + (picked.files[0].name || 'Photo selected'); }
          else label.textContent = '';
        };
        cam.addEventListener('change', changed(cam, lib));
        lib.addEventListener('change', changed(lib, cam));
      })();
      setTimeout(() => { const t = formEl.querySelector('.attempt-log-note'); if (t) t.focus(); }, 50);

      formEl.querySelector('.attempt-log-save-btn').addEventListener('click', async () => {
        const saveBtn = formEl.querySelector('.attempt-log-save-btn');
        const statusEl = formEl.querySelector('.attempt-log-status');
        const dateInput = formEl.querySelector('.attempt-log-date');
        const noteInput = formEl.querySelector('.attempt-log-note');
        const photoInput = formEl.querySelector('.attempt-log-photo');

        if (!dateInput.value) {
          statusEl.textContent = 'A date is required.';
          statusEl.className = 'status err';
          return;
        }
        if (!noteInput.value.trim()) {
          statusEl.textContent = 'A note is required.';
          statusEl.className = 'status err';
          return;
        }

        const finishSave = async (photoDataUrl) => {
          saveBtn.disabled = true;
          statusEl.textContent = 'Saving…';
          statusEl.className = 'status';
          try {
            const res = await fetch('/.netlify/functions/save-attempt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                caseInfo: { caseNo: c.caseNo, defendant: c.defendant },
                attemptNumber: n,
                date: dateInput.value,
                note: noteInput.value.trim(),
                photoDataUrl: photoDataUrl || null
              })
            });
            if (!res.ok) throw new Error(await res.text());
            const saved = await res.json().catch(() => null);
            statusEl.textContent = isEdit ? `Saved — attempt ${n} updated.` : `Saved — attempt ${n} logged.`;
            statusEl.className = 'status ok';
            allCasesCache = null;
            setTimeout(closeModal, 600);
            if (typeof onSaved === 'function') onSaved(saved && saved.attempt);
          } catch (err) {
            statusEl.textContent = 'Failed to save — try again. (' + err.message + ')';
            statusEl.className = 'status err';
            saveBtn.disabled = false;
          }
        };

        const file = photoInput.files[0] || (formEl.querySelector('.attempt-log-photo-lib') || {}).files?.[0];
        if (file) {
          imageFileToDataUrl(file).then(finishSave).catch(() => {
            statusEl.textContent = 'Could not read that photo — try a different one.';
            statusEl.className = 'status err';
          });
        } else {
          // Editing without picking a new photo keeps whatever photo (or
          // lack of one) was already on file -- passing null here just
          // means "no new photo," not "erase the existing one" (the
          // backend only overwrites photoPath when a new one is given).
          finishSave(null);
        }
      });
  }

  // Photos from the library (or camera) can be many MB; the server request
  // limit is ~6 MB. Shrink to at most 1600px on the long side as JPEG, which
  // is plenty to read a notice. Falls back to the original bytes if the
  // browser can't decode it (then the server limit applies as before).
  function imageFileToDataUrl(file) {
    const raw = () => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    if (!window.createImageBitmap) return raw();
    return createImageBitmap(file)
      .then((bmp) => {
        const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(bmp.width * scale);
        cv.height = Math.round(bmp.height * scale);
        const ctx = cv.getContext('2d');
        if (!ctx) return raw();
        ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
        const out = cv.toDataURL('image/jpeg', 0.82);
        return /^data:image\/jpeg/.test(out) ? out : raw();
      })
      .catch(() => raw());
  }

  // ---------- Route ----------
  const loadRouteBtn = $('#loadRouteBtn');
  const routeList = $('#routeList');
  const routeActions = $('#routeActions');
  const routeCount = $('#routeCount');
  let routeCases = [];
  let routeOrder = []; // case ids, in the order tapped
  try {
    const saved = JSON.parse(localStorage.getItem('sps_routeOrder') || '[]');
    if (Array.isArray(saved)) routeOrder = saved;
  } catch (_) { /* storage unavailable -- order just won't survive a reload */ }
  function saveRouteOrder() {
    try { localStorage.setItem('sps_routeOrder', JSON.stringify(routeOrder)); } catch (_) { /* ignore */ }
  }

  function renderRoute() {
    routeList.innerHTML = routeCases
      .map((c) => {
        const pos = routeOrder.indexOf(c.id);
        const n = (c.attempts || []).length;
        const badge = pos >= 0
          ? `<span class="status-pill status-pill-open" style="margin-right:.4rem;">Stop ${pos + 1}</span>`
          : '';
        return (
          `<div class="case-row" data-route-id="${esc(c.id)}">` +
          `<div class="case-style">${badge}${esc(c.defendant || 'Unknown Defendant')}</div>` +
          `<div class="case-meta">${esc(c.serviceAddress)}</div>` +
          `<div class="case-meta">Case No. ${esc(c.caseNo)} — attempts logged: ${n}/3</div>` +
          `<button type="button" class="btn secondary route-pick-btn" style="margin-top:.4rem;">${pos >= 0 ? 'Remove from route' : 'Add to route'}</button> ` +
          `<a class="btn secondary" style="margin-top:.4rem;display:inline-block;" target="_blank" rel="noopener" ` +
          `href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.serviceAddress)}&travelmode=driving">Navigate</a> ` +
          `<button type="button" class="btn primary route-here-btn" style="margin-top:.4rem;">📍 Log attempt (I'm here)</button>` +
          `<div class="attempt-log-form" hidden></div>` +
          `</div>`
        );
      })
      .join('');
    routeCount.textContent = routeOrder.length
      ? `${routeOrder.length} stop${routeOrder.length === 1 ? '' : 's'} in your route.`
      : 'Tap "Add to route" on the cases you will drive to, in order.';

    routeList.querySelectorAll('.case-row').forEach((row) => {
      const c = routeCases.find((x) => x.id === row.dataset.routeId);
      row.querySelector('.route-pick-btn').addEventListener('click', () => {
        const i = routeOrder.indexOf(c.id);
        if (i >= 0) routeOrder.splice(i, 1);
        else routeOrder.push(c.id);
        saveRouteOrder();
        renderRoute();
      });
      row.querySelector('.route-here-btn').addEventListener('click', async (e) => {
        const formEl = row.querySelector('.attempt-log-form');
        const existingN = (c.attempts || []).map((a) => a.n);
        const n = [1, 2, 3].find((num) => !existingN.includes(num));
        if (!n) {
          alert('This case already has all 3 attempts logged.');
          return;
        }
        // After the note saves, show the saved text and refresh the row.
        const afterSave = (saved) => {
          if (saved) c.attempts = (c.attempts || []).filter((a) => a.n !== saved.n).concat([saved]);
          setTimeout(renderRoute, 700);
        };

        let failure = null;
        const out = await recordArrival(c, e.currentTarget, { promptNote: false, onError: (err) => { failure = err; } });
        if (failure) {
          if (confirm(`Couldn't get your location (${failure.message})\n\nLog attempt ${n} WITHOUT a GPS stamp?`)) {
            buildAttemptForm({ formEl, c, n, existingAttempt: null, justRecorded: false, onSaved: afterSave });
          }
          return;
        }
        if (!out || out.duplicate || !out.attempt) return;
        c.attempts = (c.attempts || []).concat([out.attempt]);
        // Same form as everywhere else: note (required) + optional photo,
        // attached to THIS attempt so nothing gets logged twice.
        buildAttemptForm({ formEl, c, n: out.attempt.n, existingAttempt: out.attempt, justRecorded: true, onSaved: afterSave });
      });
    });
  }

  loadRouteBtn.addEventListener('click', async () => {
    loadRouteBtn.disabled = true;
    routeList.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const res = await fetch('/.netlify/functions/list-cases');
      if (!res.ok) throw new Error(await res.text());
      const { cases } = await res.json();
      routeCases = (cases || []).filter((c) => c.status !== 'closed' && c.serviceAddress);
      routeOrder = routeOrder.filter((id) => routeCases.some((c) => c.id === id));
      if (!routeCases.length) {
        routeList.innerHTML = '<p class="hint">No open cases with an address.</p>';
        routeActions.hidden = true;
        return;
      }
      routeActions.hidden = false;
      renderRoute();
    } catch (err) {
      routeList.innerHTML = `<p class="status err">Failed to load. (${esc(err.message)})</p>`;
    } finally {
      loadRouteBtn.disabled = false;
    }
  });

  $('#clearRouteBtn').addEventListener('click', () => {
    routeOrder = [];
    saveRouteOrder();
    renderRoute();
  });

  // Multi-stop link in Google Maps' path form: .../maps/dir//A/B/C
  // (the empty first slot = "your location" as the start; the stops follow
  // in the order tapped). This form is what the Maps app draws as a full
  // route; the older ?api=1&waypoints= form sometimes dropped the app onto
  // its stop-editing screen without ever drawing the route.
  function buildMapsUrl(addrs) {
    return 'https://www.google.com/maps/dir//' + addrs.map((a) => encodeURIComponent(a)).join('/');
  }

  function routeAddresses() {
    return routeOrder
      .map((id) => routeCases.find((c) => c.id === id))
      .filter(Boolean);
  }

  $('#openRouteBtn').addEventListener('click', () => {
    if (!routeOrder.length) {
      alert('Add at least one case to the route first.');
      return;
    }
    if (routeOrder.length > 10) {
      alert('Google Maps only takes 10 stops at a time. Remove a few and open the rest as a second route.');
      return;
    }
    window.open(buildMapsUrl(routeAddresses().map((c) => c.serviceAddress)), '_blank');
  });

  // Backup that always works: directions to ONE stop -- the first stop in
  // your order that has no attempt logged yet. Tap it again after each stop.
  $('#nextStopBtn').addEventListener('click', () => {
    const ordered = routeAddresses();
    if (!ordered.length) {
      alert('Add at least one case to the route first.');
      return;
    }
    const next = ordered.find((c) => !(c.attempts || []).some((a) => a.date === new Date().toLocaleDateString('en-CA'))) || ordered[0];
    window.open(
      `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(next.serviceAddress)}`,
      '_blank'
    );
  });

  // Form shown after picking the return PDF. Resolves with
  // { returnDate, returnOutcome, returnNotes, servedDefendants } or null
  // if cancelled. Notes are required unless the outcome is "Served".
  function openReturnForm({ caseNo, fileName, outstanding }) {
    return new Promise((resolve) => {
      const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;overflow:auto;padding:1rem;';
      overlay.innerHTML =
        `<div style="background:var(--panel,#fff);max-width:30rem;margin:0 auto;padding:1rem;border-radius:6px;">` +
        `<h3 style="margin-top:0;">Send return to Kevin</h3>` +
        `<p class="hint">${esc(caseNo || 'Case')} &mdash; ${esc(fileName)}</p>` +
        (outstanding.length > 1
          ? `<p class="hint" style="margin-bottom:.2rem;">Which defendant(s) does this return cover?</p>` +
            outstanding.map((n, i) => `<label class="check-row"><input type="checkbox" class="rf-def" value="${esc(n)}" checked> ${esc(n)}</label>`).join('')
          : '') +
        `<label>Return date <input type="date" id="rfDate" value="${today}"></label>` +
        `<label>Outcome <select id="rfOutcome">` +
        `<option value="Served">Served</option>` +
        `<option value="Return Not Found">Return Not Found</option>` +
        `<option value="Return Requested per Plaintiff">Return Requested per Plaintiff</option>` +
        `</select></label>` +
        `<label><span id="rfNotesLabel">Notes for Kevin (optional)</span>` +
        `<textarea id="rfNotes" rows="5" placeholder="Goes in the email to Kevin and is saved on the case."></textarea></label>` +
        `<p class="status err" id="rfError"></p>` +
        `<button type="button" class="btn primary" id="rfSend">Send to Kevin &amp; mark returned</button> ` +
        `<button type="button" class="btn secondary" id="rfCancel">Cancel</button>` +
        `</div>`;
      document.body.appendChild(overlay);

      const q = (sel) => overlay.querySelector(sel);
      const notesLabel = q('#rfNotesLabel');
      const syncLabel = () => {
        notesLabel.textContent = q('#rfOutcome').value === 'Served'
          ? 'Notes for Kevin (optional)'
          : 'Notes for Kevin (REQUIRED — what you found / why it was not served)';
      };
      q('#rfOutcome').addEventListener('change', syncLabel);

      const done = (val) => { overlay.remove(); resolve(val); };
      q('#rfCancel').addEventListener('click', () => done(null));
      q('#rfSend').addEventListener('click', () => {
        const returnDate = q('#rfDate').value;
        const returnOutcome = q('#rfOutcome').value;
        const returnNotes = q('#rfNotes').value.trim();
        const err = q('#rfError');
        if (!returnDate) { err.textContent = 'Pick the return date.'; return; }
        if (returnOutcome !== 'Served' && !returnNotes) {
          err.textContent = 'Add your notes — they go in the email to Kevin.';
          q('#rfNotes').focus();
          return;
        }
        let servedDefendants = null;
        if (outstanding.length > 1) {
          servedDefendants = Array.from(overlay.querySelectorAll('.rf-def:checked')).map((el) => el.value);
          if (!servedDefendants.length) { err.textContent = 'Check at least one defendant.'; return; }
        }
        done({ returnDate, returnOutcome, returnNotes, servedDefendants });
      });
    });
  }

  // Shared helper: turn a base64 PDF into an actual downloaded file
  // (not just opened in a tab) -- saves to the device's Downloads/Files
  // instead of just displaying it.
  function downloadPdfBase64(pdfBase64, filename) {
    const byteChars = atob(pdfBase64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- Weekly invoice -- weeks keyed by RETURN date, not intake date ----------
  const loadWeekInvoiceBtn = $('#loadWeekInvoiceBtn');
  const weekInvoiceList = $('#weekInvoiceList');

  loadWeekInvoiceBtn.addEventListener('click', async () => {
    loadWeekInvoiceBtn.disabled = true;
    weekInvoiceList.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const res = await fetch('/.netlify/functions/list-cases');
      if (!res.ok) throw new Error(await res.text());
      const { cases } = await res.json();
      // Invoice week follows the day it was entered in the app
      // (completedDate), not a backdated return date.
      const billDate = (c) => c.completedDate || c.returnDate;
      const returned = (cases || []).filter((c) => billDate(c));

      if (!returned.length) {
        weekInvoiceList.innerHTML = '<p class="hint">Nothing returned yet.</p>';
        return;
      }

      // Counts every completed return that actually appears on that
      // week's PDF -- billable AND the "already billed for this case"
      // duplicates -- since the PDF lists all of them, not just the
      // billable subset. Billing itself still dedupes by case number
      // (see buildWeekInvoicePdf.js) -- this count is "how many returns
      // happened," not "how many dollars," so it should match the total
      // line count on the page, not just the $ total.
      const groups = new Map(); // key: monday ISO date, value: { label, count }
      returned.forEach((c) => {
        const monday = mondayOfWeek(billDate(c));
        const key = monday.toISOString().slice(0, 10);
        if (!groups.has(key)) {
          groups.set(key, { label: formatWeekLabel(monday), count: 0 });
        }
        groups.get(key).count += 1;
      });

      const sortedKeys = Array.from(groups.keys()).sort((a, b) => (a < b ? 1 : -1));

      const html = sortedKeys
        .map((key) => {
          const group = groups.get(key);
          const caseWord = group.count === 1 ? 'return' : 'returns';
          return (
            `<button type="button" class="week-btn" data-week="${key}">` +
            `<span class="week-btn-label">${group.label}</span>` +
            `<span class="week-btn-count">${group.count} ${caseWord} &rsaquo;</span>` +
            `</button>`
          );
        })
        .join('');

      weekInvoiceList.innerHTML = html;

      weekInvoiceList.querySelectorAll('.week-btn').forEach((btn) => {
        btn.addEventListener('click', () => openWeekInvoicePdf(btn.dataset.week, btn));
      });
    } catch (err) {
      weekInvoiceList.innerHTML = `<p class="status err">Failed to load. (${err.message})</p>`;
    } finally {
      loadWeekInvoiceBtn.disabled = false;
    }
  });

  async function openWeekInvoicePdf(weekKey, btn) {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="week-btn-label">Downloading…</span>';
    try {
      const res = await fetch(`/.netlify/functions/week-invoice-pdf?week=${weekKey}`);
      if (!res.ok) throw new Error(await res.text());
      const { pdfBase64 } = await res.json();
      downloadPdfBase64(pdfBase64, `weekly-invoice-${weekKey}.pdf`);
    } catch (err) {
      alert('Failed to download weekly invoice — try again. (' + err.message + ')');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  // ---------- On-demand inventory PDF ----------
  const generateInventoryBtn = $('#generateInventoryBtn');
  generateInventoryBtn.addEventListener('click', async () => {
    const original = generateInventoryBtn.textContent;
    generateInventoryBtn.disabled = true;
    generateInventoryBtn.textContent = 'Generating…';
    try {
      const res = await fetch('/.netlify/functions/inventory-pdf');
      if (!res.ok) throw new Error(await res.text());
      const { pdfBase64 } = await res.json();
      downloadPdfBase64(pdfBase64, `inventory-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      alert('Failed to download inventory — try again. (' + err.message + ')');
    } finally {
      generateInventoryBtn.disabled = false;
      generateInventoryBtn.textContent = original;
    }
  });

  // ---------- Case search -- find any case fast, no digging through photos ----------
  const caseSearchInput = $('#caseSearchInput');
  const caseSearchResults = $('#caseSearchResults');
  let allCasesCache = null; // fetched once, reused per keystroke
  let searchDebounce = null;

  async function ensureAllCasesLoaded() {
    if (allCasesCache) return allCasesCache;
    const res = await fetch('/.netlify/functions/list-cases');
    if (!res.ok) throw new Error(await res.text());
    const { cases } = await res.json();
    allCasesCache = cases || [];
    return allCasesCache;
  }

  function renderSearchResults(cases, query) {
    if (!cases.length) {
      caseSearchResults.innerHTML = query
        ? `<p class="hint">No matches for "${esc(query)}".</p>`
        : `<p class="hint">Nothing here.</p>`;
      return;
    }
    caseSearchResults.innerHTML = cases
      .map((c) => {
        const style = `${c.plaintiff || 'Unknown Plaintiff'} v. ${c.defendant || 'Unknown Defendant'}`;
        let statusLabel;
        if (c.status === 'closed') statusLabel = c.returnOutcome || 'Closed';
        else if (c.returnSent) statusLabel = 'Returned — affidavit pending';
        else statusLabel = 'Open';
        const intake = c.intakeDate ? new Date(c.intakeDate).toLocaleDateString('en-US') : '';
        const markBtn =
          c.status !== 'closed'
            ? `<button type="button" class="btn primary send-return-btn" data-id="${c.id}" style="margin-top:.4rem;">Upload return &amp; send to Kevin</button>` +
              `<button type="button" class="btn secondary mark-returned-btn" data-id="${c.id}" style="margin-top:.4rem;">Mark returned (no email — already handled outside the app)</button>`
            : '';
        const viewReturnBtn = c.returnPdfPath
          ? `<button type="button" class="btn secondary view-pdf-btn" data-id="${c.id}" data-kind="return" style="margin-top:.4rem;">View return PDF</button>`
          : '';
        // Fix a mistake on an already-marked return -- wrong date, wrong
        // outcome, a note that needs updating -- without re-touching
        // defendant-served status or reopening/reclosing the case.
        const editReturnBtn = c.returnSent
          ? `<button type="button" class="btn secondary edit-return-btn" data-id="${c.id}" style="margin-top:.4rem;">Edit return</button>`
          : '';
        const viewAffidavitBtn = c.affidavitPdfPath
          ? `<button type="button" class="btn secondary view-pdf-btn" data-id="${c.id}" data-kind="affidavit" style="margin-top:.4rem;">View affidavit PDF</button>`
          : '';
        const attemptPhotoBtns = (c.attempts || [])
          .filter((a) => a.photoPath)
          .map(
            (a) =>
              `<button type="button" class="btn secondary view-attempt-photo-btn" data-id="${c.id}" data-attempt="${a.n}" style="margin-top:.4rem;">View attempt ${a.n} photo</button>`
          )
          .join('');
        // Attempt history -- separate from and unrelated to the affidavit.
        // Some cases never need an affidavit at all (served on the first
        // try, just a return); others take several attempts before an
        // affidavit ever comes into it. Either way, every attempt that's
        // been logged shows up here.
        const sortedAttempts = (c.attempts || []).slice().sort((a, b) => a.n - b.n);
        const attemptHistory = sortedAttempts.length
          ? `<div class="attempt-history">` +
            `<div class="attempt-history-title">Attempts logged (${sortedAttempts.length}):</div>` +
            sortedAttempts
              .map((a) => {
                const photoTs = a.photoTimestamp
                  ? ` · photo timestamped ${new Date(a.photoTimestamp).toLocaleString('en-US')}`
                  : '';
                const noteText = a.note ? `${a.note.replace(/</g, '&lt;')}` : '(no note)';
                const gps = a.visitAt
                  ? ` · 📍 GPS-verified ${new Date(a.visitAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}` +
                    `${a.accuracy != null ? ' (±' + a.accuracy + ' m)' : ''} ` +
                    `<a href="https://www.google.com/maps?q=${a.lat},${a.lng}" target="_blank" rel="noopener">map</a>`
                  : '';
                return (
                  `<div class="attempt-history-line">#${a.n} — ${a.date || 'no date'}: ${noteText}${photoTs}${gps} ` +
                  `<a href="#" class="edit-attempt-link" data-id="${c.id}" data-n="${a.n}">Edit</a> · ` +
                  `<a href="#" class="remove-attempt-link" data-id="${c.id}" data-n="${a.n}">Remove</a></div>`
                );
              })
              .join('') +
            `</div>`
          : '';
        // A case that's still open with no return on file yet -- the
        // thing Jeremy specifically wants surfaced, not buried in a status word.
        const missingReturnNote =
          c.status !== 'closed' && !c.returnPdfPath
            ? `<div class="missing-return-note">No return on file — still open</div>`
            : '';
        // We track papers, not just cases -- for multi-defendant cases,
        // show each defendant's own status instead of one case-wide word.
        const defendantBreakdown =
          Array.isArray(c.defendants) && c.defendants.length > 1
            ? `<div class="defendant-breakdown">` +
              c.defendants
                .map(
                  (d) =>
                    `<div class="defendant-line">${d.served ? '✓' : '○'} ${d.name}${d.served && d.returnDate ? ' — returned ' + d.returnDate : d.served ? ' — returned' : ' — still open'}</div>`
                )
                .join('') +
              `</div>`
            : '';
        // Court date + expiration (60 days General Sessions, 90 otherwise),
        // colored by how close they are. Open cases only.
        let deadlineLine = '';
        if (c.status !== 'closed' && window.SPSPriority) {
          const pr = window.SPSPriority.assess(c);
          const bits = [];
          if (pr.courtDate) bits.push(`Court ${window.SPSPriority.pretty(pr.courtDate)}`);
          if (pr.expiresOn) bits.push(`Expires ${window.SPSPriority.pretty(pr.expiresOn)}${pr.estimated ? ' (est.)' : ''}`);
          if (bits.length) {
            const color = pr.level === 'past' || pr.level === 'high' ? '#b00020' : pr.level === 'soon' ? '#b45f00' : 'inherit';
            const badge = pr.level === 'ok' ? '' : ` — <strong>${{ past: 'PAST DUE', high: 'HIGH PRIORITY', soon: 'SOON' }[pr.level]}</strong>: ${pr.reasons.map(esc).join('; ')}`;
            deadlineLine = `<div class="case-meta" style="color:${color};">📅 ${bits.join(' · ')}${badge}</div>`;
          }
        }
        // Next scheduled meeting on this case + a button to add one.
        const nextMeeting = (c.appointments || [])
          .filter((a) => a.status === 'scheduled')
          .sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time))[0];
        const meetingLine = c.status !== 'closed' && nextMeeting
          ? `<div class="case-meta">📅 Meeting: ${esc(meetingDateLabel(nextMeeting.date, centralNow().date))}, ${fmtMeetingTime(nextMeeting.time)}${nextMeeting.note ? ' — ' + esc(nextMeeting.note) : ''}</div>`
          : '';
        const scheduleBtn = c.status !== 'closed'
          ? `<button type="button" class="btn secondary schedule-btn" data-id="${c.id}" style="margin-top:.4rem;">📅 Schedule meeting</button>`
          : '';
        const editBtn = `<button type="button" class="btn secondary edit-case-btn" data-id="${c.id}" style="margin-top:.4rem;">Edit</button>`;
        const nextAttemptN = Math.min(3, sortedAttempts.length + 1);
        const logAttemptBtn = sortedAttempts.length >= 3
          ? ''
          : `<button type="button" class="btn primary log-attempt-btn" data-id="${c.id}" style="margin-top:.4rem;">📍 Log attempt ${nextAttemptN} (I'm here)</button>`;
        // Alias cases can jump straight to the Affidavit section, with
        // the Case fields auto-filled and attempts already checked --
        // no need to retype the case number/defendant up there manually.
        const affidavitBtn = c.isAlias
          ? `<button type="button" class="btn secondary affidavit-btn" data-id="${c.id}" style="margin-top:.4rem;">Affidavit</button>`
          : '';
        // For a case whose affidavit already went out some other way
        // (sent manually, or sent before the PDF generator was fixed) --
        // acknowledges that and closes the case, no PDF/email generated.
        const markAffidavitSentBtn = c.isAlias && c.status !== 'closed' && !c.affidavitSent
          ? `<button type="button" class="btn secondary mark-affidavit-sent-btn" data-id="${c.id}" style="margin-top:.4rem;">Affidavit already sent (close case)</button>`
          : '';
        // Red for open, green for anything returned/closed -- regardless
        // of the specific outcome (served, not found, requested per
        // plaintiff all read the same at a glance: it's done).
        const statusPillClass = c.status === 'closed' ? 'status-pill status-pill-closed' : 'status-pill status-pill-open';
        const notesBlock = (c.notes || c.returnNotes)
          ? `<div class="case-notes">` +
            (c.notes ? `📝 ${c.notes.replace(/</g, '&lt;')}` : '') +
            (c.notes && c.returnNotes ? '<br>' : '') +
            (c.returnNotes ? `📦 Return note: ${c.returnNotes.replace(/</g, '&lt;')}` : '') +
            `</div>`
          : '';
        const phoneBlock = c.phoneNumbers
          ? `<div class="case-notes">📞 ${c.phoneNumbers.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`
          : '';
        const pr = window.SPSPriority && c.status !== 'closed' ? window.SPSPriority.assess(c) : null;
        const dotClass = !pr ? '' : pr.level === 'past' || pr.level === 'high' ? 'red' : pr.level === 'soon' ? 'yellow' : '';
        let flag = '';
        if (c.status === 'closed') flag = `<div class="flag green">${esc(statusLabel)}</div>`;
        else if (pr && pr.level !== 'ok' && pr.reasons.length) flag = `<div class="flag ${dotClass}">${esc(pr.reasons[0])}</div>`;
        else if (nextMeeting) flag = `<div class="flag blue">Meeting ${esc(meetingDateLabel(nextMeeting.date, centralNow().date))} ${fmtMeetingTime(nextMeeting.time)}</div>`;
        const bars = [1, 2, 3].map((n) => `<i class="${n <= sortedAttempts.length ? 'on' : ''}"></i>`).join('');
        const addr = c.serviceAddress || '';
        const goLink = addr
          ? `<a class="go-btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}&travelmode=driving">Go</a>`
          : '';
        const phoneTap = c.phoneNumbers
          ? `<div class="info-card"><div class="k">PHONE</div><div class="v">${linkifyPhones(c.phoneNumbers).replace(/\n/g, '<br>')}</div></div>`
          : '';
        const notesCard = (c.notes || c.returnNotes)
          ? `<div class="info-card"><div class="k">NOTES</div><div class="v" style="font-weight:500;white-space:pre-wrap;">` +
            (c.notes ? esc(c.notes) : '') +
            (c.notes && c.returnNotes ? '<br>' : '') +
            (c.returnNotes ? 'Return note: ' + esc(c.returnNotes) : '') +
            `</div></div>`
          : '';
        const caseCard =
          `<div class="info-card"><div class="k">CASE</div>` +
          `<div class="kv"><span>Case No.</span><span>${esc(c.caseNo || 'N/A')}</span></div>` +
          `<div class="kv"><span>Plaintiff</span><span>${esc(c.plaintiff || '')}</span></div>` +
          (c.attorney ? `<div class="kv"><span>Attorney</span><span>${esc(c.attorney)}</span></div>` : '') +
          (c.caseType ? `<div class="kv"><span>Type</span><span>${esc(c.caseType)}</span></div>` : '') +
          `<div class="kv"><span>Logged</span><span>${intake}${c.returnDate ? ' · Returned ' + c.returnDate : ''}${c.closedDate ? ' · Closed ' + new Date(c.closedDate).toLocaleDateString('en-US') : ''}</span></div>` +
          `</div>`;
        const noPapers = !viewAffidavitBtn && !affidavitBtn && !markAffidavitSentBtn
          ? `<p class="hint">No affidavit on this case. (Affidavits are for alias summons.)</p>` : '';
        const noAttempts = !sortedAttempts.length ? `<p class="hint">No attempts logged yet. Tap the yellow button above when you're at the door.</p>` : '';
        const pill = `<span class="${statusPillClass}">${esc(statusLabel)}</span>`;
        return (
          `<div class="case-row" data-case-row="${c.id}">` +
          `<div class="case-summary" role="button" tabindex="0" data-open-case="${c.id}">` +
          `<span class="dot ${dotClass}"></span>` +
          `<div class="main"><div class="name">${esc(c.defendant || 'Unknown Defendant')}</div>` +
          `<div class="addr">${esc(addr)}</div>${flag}</div>` +
          `<div><div class="bars">${bars}</div><div class="bars-count">${sortedAttempts.length} of 3</div></div>` +
          `</div>` +
          `<div class="case-sheet" data-tab="info">` +
          `<div class="sheet-head">` +
          `<div class="sheet-top"><button type="button" class="sheet-back" aria-label="Back to cases">‹</button>` +
          `<div class="sheet-title"><div class="t1">${esc(c.defendant || 'Unknown Defendant')}</div>` +
          `<div class="t2">Case ${esc(c.caseNo || 'N/A')} · ${esc(c.plaintiff || '')}</div></div>${pill}</div>` +
          `${logAttemptBtn}` +
          `</div>` +
          `<div class="sheet-tabs">` +
          `<button type="button" class="sheet-tab" data-tab="info">Info</button>` +
          `<button type="button" class="sheet-tab" data-tab="attempts">Attempts</button>` +
          `<button type="button" class="sheet-tab" data-tab="return">Return</button>` +
          `<button type="button" class="sheet-tab" data-tab="papers">Papers</button>` +
          `</div>` +
          `<div class="sheet-body">` +
          `<div class="sheet-pane" data-pane="info">` +
          `<div class="info-card"><div class="info-row"><div class="grow"><div class="k">SERVICE ADDRESS</div><div class="v">${esc(addr || 'No address')}</div></div>${goLink}</div></div>` +
          deadlineLine.replace('class="case-meta"', 'class="info-card"') +
          meetingLine.replace('class="case-meta"', 'class="info-card"') +
          scheduleBtn +
          phoneTap + notesCard + caseCard + defendantBreakdown +
          editBtn +
          `<div class="edit-case-form" data-edit-form="${c.id}" hidden></div>` +
          `</div>` +
          `<div class="sheet-pane" data-pane="attempts">` +
          noAttempts + attemptHistory + attemptPhotoBtns +
          `<div class="attempt-log-form" data-attempt-form="${c.id}" hidden></div>` +
          `</div>` +
          `<div class="sheet-pane" data-pane="return">` +
          pill + missingReturnNote + markBtn + viewReturnBtn + editReturnBtn +
          `<div class="edit-return-form" data-edit-return-form="${c.id}" hidden></div>` +
          `</div>` +
          `<div class="sheet-pane" data-pane="papers">` +
          noPapers + viewAffidavitBtn + affidavitBtn + markAffidavitSentBtn +
          `</div>` +
          `</div>` +
          `</div>` +
          `</div>`
        );
      })
      .join('');

    wireCaseSheets();

    caseSearchResults.querySelectorAll('.mark-affidavit-sent-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const c = cases.find((x) => x.id === id);
        if (!c) return;

        const sure = confirm(
          `Confirm the affidavit for ${c.caseNo} (${c.defendant}) has already been sent to Kevin, ` +
          `handled outside this app.\n\nThis closes the case out -- no PDF gets generated, no email gets sent. ` +
          `Continue?`
        );
        if (!sure) return;

        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Updating…';
        try {
          const res = await fetch('/.netlify/functions/mark-affidavit-sent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
          });
          if (!res.ok) throw new Error(await res.text());
          allCasesCache = null;
          caseSearchInput.dispatchEvent(new Event('input'));
        } catch (err) {
          alert('Failed to update — try again. (' + err.message + ')');
          btn.disabled = false;
          btn.textContent = original;
        }
      });
    });

    caseSearchResults.querySelectorAll('.edit-return-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const c = cases.find((x) => x.id === id);
        const formEl = caseSearchResults.querySelector(`.edit-return-form[data-edit-return-form="${CSS.escape(id)}"]`);
        if (!formEl || !c) return;

        if (!formEl.hidden) {
          formEl.hidden = true;
          return;
        }

        const outcome = c.returnOutcome || 'Served';
        const notes = (c.returnNotes || '').replace(/</g, '&lt;');
        formEl.innerHTML = `
          <label>Return date <input type="date" class="edit-return-date" value="${c.returnDate || ''}"></label>
          <label>Return outcome
            <select class="edit-return-outcome">
              <option value="Served" ${outcome === 'Served' ? 'selected' : ''}>Served</option>
              <option value="Return Not Found" ${outcome === 'Return Not Found' ? 'selected' : ''}>Return Not Found</option>
              <option value="Return Requested per Plaintiff" ${outcome === 'Return Requested per Plaintiff' ? 'selected' : ''}>Return Requested per Plaintiff</option>
            </select>
          </label>
          <label>Return notes <textarea class="edit-return-notes" rows="2">${notes}</textarea></label>
          <label class="check-row"><input type="checkbox" class="edit-return-bill"> Put this on this week's invoice (billed today). Keeps the return date above.</label>
          <div class="sig-actions">
            <button type="button" class="btn primary edit-return-save-btn">Save changes</button>
            <button type="button" class="btn secondary edit-return-cancel-btn">Cancel</button>
          </div>
          <p class="status edit-return-status"></p>
        `;
        formEl.hidden = false;

        formEl.querySelector('.edit-return-cancel-btn').addEventListener('click', () => {
          formEl.hidden = true;
        });

        formEl.querySelector('.edit-return-save-btn').addEventListener('click', async () => {
          const saveBtn = formEl.querySelector('.edit-return-save-btn');
          const statusEl = formEl.querySelector('.edit-return-status');
          const dateInput = formEl.querySelector('.edit-return-date');
          const outcomeSelect = formEl.querySelector('.edit-return-outcome');
          const notesInput = formEl.querySelector('.edit-return-notes');

          if (!dateInput.value) {
            statusEl.textContent = 'A return date is required.';
            statusEl.className = 'status err';
            return;
          }

          saveBtn.disabled = true;
          statusEl.textContent = 'Saving…';
          statusEl.className = 'status';
          try {
            const res = await fetch('/.netlify/functions/edit-return', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: c.id,
                returnDate: dateInput.value,
                returnOutcome: outcomeSelect.value,
                returnNotes: notesInput.value.trim(),
                billThisWeek: formEl.querySelector('.edit-return-bill').checked
              })
            });
            if (!res.ok) throw new Error(await res.text());
            statusEl.textContent = 'Saved.';
            statusEl.className = 'status ok';
            allCasesCache = null;
            setTimeout(() => caseSearchInput.dispatchEvent(new Event('input')), 600);
          } catch (err) {
            statusEl.textContent = 'Failed to save — try again. (' + err.message + ')';
            statusEl.className = 'status err';
            saveBtn.disabled = false;
          }
        });
      });
    });

    caseSearchResults.querySelectorAll('.affidavit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const c = cases.find((x) => x.id === id);
        if (!c) return;
        jumpToAffidavit(c);
      });
    });

    // Builds and wires the attempt form inside a case's .attempt-log-form
    // container -- shared by both "+ Log attempt" (existingAttempt is
    // null, n is the next open slot) and "Edit" on an already-logged
    // attempt (existingAttempt pre-fills the fields, n is that same
    // attempt number so saving overwrites it rather than adding a new one).
    function openAttemptForm(c, n, existingAttempt, justRecorded) {
      const formEl = caseSearchResults.querySelector(`.attempt-log-form[data-attempt-form="${CSS.escape(c.id)}"]`);
      if (!formEl) return;

      buildAttemptForm({
        formEl, c, n, existingAttempt, justRecorded,
        onSaved: () => setTimeout(() => caseSearchInput.dispatchEvent(new Event('input')), 600)
      });
    }

    // ONE button: stamps the visit (GPS + server time) AND creates the
    // attempt, then opens the form so the note goes on that same attempt.
    // If the phone can't give a location, offers to log it without a stamp.
    caseSearchResults.querySelectorAll('.log-attempt-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const c = cases.find((x) => x.id === id);
        if (!c) return;

        const existingN = (c.attempts || []).map((a) => a.n);
        const n = [1, 2, 3].find((num) => !existingN.includes(num));
        if (!n) {
          alert('This case already has all 3 attempts logged.');
          return;
        }

        let failure = null;
        const out = await recordArrival(c, btn, { promptNote: false, onError: (err) => { failure = err; } });
        if (failure) {
          if (confirm(`Couldn't get your location (${failure.message})\n\nLog attempt ${n} WITHOUT a GPS stamp?`)) {
            openAttemptForm(c, n, null);
          }
          return;
        }
        if (!out || out.duplicate || !out.attempt) return;
        allCasesCache = null;
        c.attempts = (c.attempts || []).concat([out.attempt]);
        openAttemptForm(c, out.attempt.n, out.attempt, true);
      });
    });

    caseSearchResults.querySelectorAll('.remove-attempt-link').forEach((link) => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const n = parseInt(link.dataset.n, 10);
        const c = cases.find((x) => x.id === link.dataset.id);
        if (!c) return;
        if (!confirm(`Remove attempt ${n} from ${c.defendant || 'this case'}?\n\nIt will no longer show on the case or the affidavit.`)) return;
        try {
          const res = await fetch('/.netlify/functions/remove-attempt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: c.id, attemptNumber: n })
          });
          if (!res.ok) throw new Error(await res.text());
          allCasesCache = null;
          caseSearchInput.dispatchEvent(new Event('input'));
        } catch (err) {
          alert('Failed to remove — try again. (' + err.message + ')');
        }
      });
    });

    caseSearchResults.querySelectorAll('.edit-attempt-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const id = link.dataset.id;
        const n = parseInt(link.dataset.n, 10);
        const c = cases.find((x) => x.id === id);
        if (!c) return;
        const existingAttempt = (c.attempts || []).find((a) => a.n === n);
        openAttemptForm(c, n, existingAttempt || null);
      });
    });

    caseSearchResults.querySelectorAll('.edit-case-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const c = cases.find((x) => x.id === id);
        const formEl = caseSearchResults.querySelector(`.edit-case-form[data-edit-form="${CSS.escape(id)}"]`);
        if (!formEl || !c) return;

        if (!formEl.hidden) {
          formEl.hidden = true;
          return;
        }

        const extraDefendants = (c.defendants || [])
          .map((d) => d.name)
          .filter((name) => name && name !== c.defendant)
          .join(', ');

        formEl.innerHTML = `
          <label>Court type <input type="text" class="edit-courtType" value="${c.courtType || ''}"></label>
          <label>County <input type="text" class="edit-county" value="${c.county || ''}"></label>
          <label>State <input type="text" class="edit-state" value="${c.state || ''}"></label>
          <label>Document type
            <select class="edit-caseType">
              <option value="" ${!c.caseType ? 'selected' : ''}>Select type</option>
              <option value="Detainer" ${c.caseType === 'Detainer' ? 'selected' : ''}>Detainer</option>
              <option value="Letter" ${c.caseType === 'Letter' ? 'selected' : ''}>Letter</option>
              <option value="Summons" ${c.caseType === 'Summons' ? 'selected' : ''}>Summons</option>
              <option value="Civil Warrant" ${c.caseType === 'Civil Warrant' ? 'selected' : ''}>Civil Warrant</option>
              <option value="Subpoena" ${c.caseType === 'Subpoena' ? 'selected' : ''}>Subpoena</option>
            </select>
          </label>
          <label>Plaintiff <input type="text" class="edit-plaintiff" value="${c.plaintiff || ''}"></label>
          <label>Defendant <input type="text" class="edit-defendant" value="${c.defendant || ''}"></label>
          <label>Additional defendants (comma-separated) <input type="text" class="edit-extraDefendants" value="${extraDefendants}"></label>
          <label>Court date (change it here if the court moves it) <input type="date" class="edit-courtDate" value="${c.courtDate || ''}"></label>
          <label>Issued on (date on the summons/warrant) <input type="date" class="edit-issueDate" value="${c.issueDate || ''}"></label>
          <label>Service address <input type="text" class="edit-serviceAddress" value="${c.serviceAddress || ''}"></label>
          <label>Attorney <input type="text" class="edit-attorney" value="${c.attorney || ''}"></label>
          <label>Special notes <textarea class="edit-notes" rows="3">${c.notes || ''}</textarea></label>
          <label>Phone numbers <textarea class="edit-phoneNumbers" rows="2">${c.phoneNumbers || ''}</textarea></label>
          <label><input type="checkbox" class="edit-isAlias" ${c.isAlias ? 'checked' : ''}> This is an alias summons</label>
          <div class="sig-actions">
            <button type="button" class="btn primary save-edit-btn">Save changes</button>
            <button type="button" class="btn secondary cancel-edit-btn">Cancel</button>
          </div>
          <p class="status edit-status"></p>
        `;
        formEl.hidden = false;

        formEl.querySelector('.cancel-edit-btn').addEventListener('click', () => {
          formEl.hidden = true;
        });

        formEl.querySelector('.save-edit-btn').addEventListener('click', async () => {
          const saveBtn = formEl.querySelector('.save-edit-btn');
          const statusEl = formEl.querySelector('.edit-status');
          const primaryDefendant = formEl.querySelector('.edit-defendant').value.trim();
          const extra = formEl
            .querySelector('.edit-extraDefendants')
            .value.split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const defendants = [primaryDefendant, ...extra].filter(Boolean).map((name) => ({ name, served: false }));

          const fields = {
            courtType: formEl.querySelector('.edit-courtType').value.trim(),
            county: formEl.querySelector('.edit-county').value.trim(),
            state: formEl.querySelector('.edit-state').value.trim(),
            caseType: formEl.querySelector('.edit-caseType').value,
            plaintiff: formEl.querySelector('.edit-plaintiff').value.trim(),
            defendant: primaryDefendant,
            defendants,
            serviceAddress: formEl.querySelector('.edit-serviceAddress').value.trim(),
            courtDate: formEl.querySelector('.edit-courtDate').value || '',
            issueDate: formEl.querySelector('.edit-issueDate').value || '',
            attorney: formEl.querySelector('.edit-attorney').value.trim(),
            notes: formEl.querySelector('.edit-notes').value.trim(),
            phoneNumbers: formEl.querySelector('.edit-phoneNumbers').value.trim(),
            isAlias: formEl.querySelector('.edit-isAlias').checked
          };

          saveBtn.disabled = true;
          statusEl.textContent = 'Saving…';
          statusEl.className = 'status edit-status';
          try {
            const res = await fetch('/.netlify/functions/update-case', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, fields })
            });
            if (!res.ok) throw new Error(await res.text());
            allCasesCache = null;
            caseSearchInput.dispatchEvent(new Event('input'));
          } catch (err) {
            statusEl.textContent = 'Failed to save — try again. (' + err.message + ')';
            statusEl.className = 'status edit-status err';
            saveBtn.disabled = false;
          }
        });
      });
    });

    caseSearchResults.querySelectorAll('.schedule-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const c = cases.find((x) => x.id === btn.dataset.id);
        if (!c) return;
        if (await openMeetingForm({ c })) refreshSchedule();
      });
    });

    caseSearchResults.querySelectorAll('.view-pdf-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const kind = btn.dataset.kind;
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Opening…';
        try {
          const res = await fetch(`/.netlify/functions/get-case-pdf?id=${encodeURIComponent(id)}&kind=${kind}`);
          if (!res.ok) throw new Error(await res.text());
          const { url } = await res.json();
          window.open(url, '_blank');
        } catch (err) {
          alert('Failed to open PDF — try again. (' + err.message + ')');
        } finally {
          btn.disabled = false;
          btn.textContent = original;
        }
      });
    });

    caseSearchResults.querySelectorAll('.view-attempt-photo-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const attempt = btn.dataset.attempt;
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Opening…';
        try {
          const res = await fetch(`/.netlify/functions/get-attempt-photo?id=${encodeURIComponent(id)}&attempt=${attempt}`);
          if (!res.ok) throw new Error(await res.text());
          const { url } = await res.json();
          window.open(url, '_blank');
        } catch (err) {
          alert('Failed to open photo — try again. (' + err.message + ')');
        } finally {
          btn.disabled = false;
          btn.textContent = original;
        }
      });
    });

    // Upload the Genius Scan PDF -> emails it to Kevin -> marks returned,
    // all in one step. The server emails FIRST; if that fails nothing is
    // marked, so "returned" always means Kevin has it.
    caseSearchResults.querySelectorAll('.send-return-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const c = cases.find((x) => x.id === id);
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = 'application/pdf';
        picker.addEventListener('change', async () => {
          const file = picker.files[0];
          if (!file) return;
          if (file.size > 4 * 1024 * 1024) {
            alert('That PDF is over 4 MB, which is too big to send from the app. Re-export it smaller from Genius Scan (lower quality / fewer pages) and try again.');
            return;
          }

          const outstanding = (c?.defendants || []).filter((d) => !d.served).map((d) => d.name);

          // One form for everything (date, outcome, which defendants, and
          // the notes that go into Kevin's email) instead of a chain of
          // pop-up prompts. Notes are REQUIRED for anything but "Served"
          // -- a not-found return needs its notes on it.
          const form = await openReturnForm({ caseNo: c?.caseNo, fileName: file.name, outstanding });
          if (!form) return;
          const { returnDate, returnOutcome, returnNotes, servedDefendants } = form;

          const original = btn.innerHTML;
          btn.disabled = true;
          btn.textContent = 'Sending to Kevin…';
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const match = /^data:application\/pdf;base64,(.+)$/.exec(reader.result);
              if (!match) throw new Error('That file does not look like a PDF.');
              const res = await fetch('/.netlify/functions/send-return', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, returnPdfBase64: match[1], returnDate, servedDefendants, returnOutcome, returnNotes })
              });
              if (!res.ok) {
                const msg = await res.text();
                if (msg.startsWith('EMAIL_FAILED')) {
                  alert('EMAIL DID NOT SEND — Kevin does NOT have this return, and the case was NOT marked returned.\n\n' + msg.replace('EMAIL_FAILED: ', ''));
                } else {
                  alert('Failed — try again. (' + msg + ')');
                }
                btn.disabled = false;
                btn.innerHTML = original;
                return;
              }
              allCasesCache = null;
              alert('Sent to Kevin and marked returned.');
              caseSearchInput.dispatchEvent(new Event('input'));
            } catch (err) {
              alert('Failed — try again. (' + err.message + ')');
              btn.disabled = false;
              btn.innerHTML = original;
            }
          };
          reader.readAsDataURL(file);
        });
        picker.click();
      });
    });

    caseSearchResults.querySelectorAll('.mark-returned-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const c = cases.find((x) => x.id === id);
        const outstanding = (c?.defendants || []).filter((d) => !d.served).map((d) => d.name);

        // A return isn't actually complete until the scanned return has
        // been emailed to Kevin, so make that an explicit checkpoint
        // BEFORE anything gets marked. Cancel = nothing happens.
        const emailed = confirm(
          `STOP -- before marking ${c?.caseNo || 'this case'} as returned:\n\n` +
            `Did you already scan the return and email it to Kevin?\n\n` +
            `OK = yes, I sent it to Kevin\nCancel = not yet (go send it first)`
        );
        if (!emailed) return;

        let servedDefendants = null;
        if (outstanding.length > 1) {
          const typed = prompt(
            `This case has multiple defendants still open:\n${outstanding.join(', ')}\n\n` +
              `Type which one(s) this return covers (comma-separated), or leave blank for all of them.`
          );
          if (typed === null) return; // cancelled
          servedDefendants = typed.trim() ? typed.split(',').map((s) => s.trim()).filter(Boolean) : outstanding;
        }

        const returnDate = prompt('Return date for this case (YYYY-MM-DD)?', new Date().toLocaleDateString('en-CA'));
        if (!returnDate) return;

        const outcome = prompt(
          'Return outcome? Type one of:\n1 = Served\n2 = Return Not Found\n3 = Return Requested per Plaintiff',
          '1'
        );
        if (outcome === null) return;
        const outcomeMap = { '1': 'Served', '2': 'Return Not Found', '3': 'Return Requested per Plaintiff' };
        const returnOutcome = outcomeMap[outcome.trim()] || 'Served';

        btn.disabled = true;
        btn.textContent = 'Updating…';
        try {
          const res = await fetch('/.netlify/functions/mark-returned', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, returnDate, servedDefendants, returnOutcome })
          });
          if (!res.ok) throw new Error(await res.text());
          allCasesCache = null;

          // Alias + Scott Weiss cases still need the affidavit, even
          // once returned. If all 3 attempts are already logged, offer
          // to jump straight to finishing it -- nothing sends without an
          // explicit yes here, this just saves the retyping.
          const isAliasWeiss = c?.isAlias && (c.attorney || '').trim().toLowerCase() === 'scott weiss';
          if (isAliasWeiss && attemptsAreComplete(c.attempts)) {
            const goNow = confirm(
              `${c.caseNo} is an alias case for Scott Weiss with all 3 attempts already logged.\n\n` +
              `Open the Affidavit section now to pick a status and send it to Kevin?`
            );
            if (goNow) {
              jumpToAffidavit(c);
              return; // skip the re-search refresh below -- we're navigating away from this result
            }
          }

          caseSearchInput.dispatchEvent(new Event('input'));
        } catch (err) {
          alert('Failed to update — try again. (' + err.message + ')');
          btn.disabled = false;
          btn.textContent = 'Mark returned (no email — already handled outside the app)';
        }
      });
    });
  }

  caseSearchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    if (!caseSearchInput.value.trim()) {
      refreshCases();
      return;
    }
    searchDebounce = setTimeout(refreshCases, 250);
  });

  // ---------- Share links (Kevin / law firm read-only views) ----------
  const shareScopeInput = $('#shareScope');
  const shareLabelInput = $('#shareLabel');
  const createShareLinkBtn = $('#createShareLinkBtn');
  const shareLinkStatus = $('#shareLinkStatus');
  const loadShareLinksBtn = $('#loadShareLinksBtn');
  const shareLinksList = $('#shareLinksList');

  createShareLinkBtn.addEventListener('click', async () => {
    const scope = shareScopeInput.value.trim();
    if (!scope) {
      shareLinkStatus.textContent = 'Enter a scope first — "ALL" for Kevin, or an attorney name for a firm.';
      shareLinkStatus.className = 'status err';
      return;
    }
    createShareLinkBtn.disabled = true;
    shareLinkStatus.textContent = 'Creating link…';
    shareLinkStatus.className = 'status';
    try {
      const res = await fetch('/.netlify/functions/create-share-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, label: shareLabelInput.value.trim() || scope })
      });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();
      shareLinkStatus.innerHTML = `Link created: <a href="${url}" target="_blank">${url}</a>`;
      shareLinkStatus.className = 'status ok';
      shareScopeInput.value = '';
      shareLabelInput.value = '';
    } catch (err) {
      shareLinkStatus.textContent = 'Failed to create link — try again. (' + err.message + ')';
      shareLinkStatus.className = 'status err';
    } finally {
      createShareLinkBtn.disabled = false;
    }
  });

  loadShareLinksBtn.addEventListener('click', async () => {
    loadShareLinksBtn.disabled = true;
    shareLinksList.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const res = await fetch('/.netlify/functions/list-share-links');
      if (!res.ok) throw new Error(await res.text());
      const { links } = await res.json();
      if (!links.length) {
        shareLinksList.innerHTML = '<p class="hint">No links created yet.</p>';
        return;
      }
      shareLinksList.innerHTML = links
        .map(
          (l) =>
            `<div class="case-row">` +
            `<div class="case-style">${l.label || l.scope}</div>` +
            `<div class="case-meta"><a href="${l.url}" target="_blank">${l.url}</a></div>` +
            `<button type="button" class="btn secondary revoke-link-btn" data-token="${l.token}" style="margin-top:.4rem;">Revoke</button>` +
            `</div>`
        )
        .join('');
      shareLinksList.querySelectorAll('.revoke-link-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Revoke this link? Anyone with it will lose access immediately.')) return;
          btn.disabled = true;
          try {
            const res = await fetch('/.netlify/functions/delete-share-link', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: btn.dataset.token })
            });
            if (!res.ok) throw new Error(await res.text());
            loadShareLinksBtn.click();
          } catch (err) {
            alert('Failed to revoke — try again. (' + err.message + ')');
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      shareLinksList.innerHTML = `<p class="status err">Failed to load links. (${err.message})</p>`;
    } finally {
      loadShareLinksBtn.disabled = false;
    }
  });

  // ---------- Intake (manual entry, no photo) ----------
  const sendIntakeBtn = $('#sendIntakeBtn');
  const intakeStatus = $('#intakeStatus');

  // Attorney is blank by default now. When "Scott Weiss" is typed in, ask
  // whether this is an alias summons (that's what turns on the affidavit
  // tracking) instead of assuming. Asked once per typed value.
  let aliasAskedFor = null;
  function askAliasIfWeiss() {
    const atty = $('#attorney').value.trim().toLowerCase();
    if (atty !== 'scott weiss' || $('#isAlias').checked || aliasAskedFor === atty) return;
    aliasAskedFor = atty;
    if (confirm('Scott Weiss is the attorney.\n\nIs this an ALIAS summons?\n\nOK = yes, alias\nCancel = no, regular summons')) {
      $('#isAlias').checked = true;
      $('#isAlias').dispatchEvent(new Event('change'));
    }
  }
  $('#attorney').addEventListener('change', () => {
    if ($('#attorney').value.trim().toLowerCase() !== 'scott weiss') aliasAskedFor = null;
    askAliasIfWeiss();
  });

  // Clears the case-info fields after a successful intake log so the form
  // is ready for the next paper, instead of leaving the last case's info
  // sitting there to accidentally get logged twice.
  function clearIntakeFields() {
    $('#caseNo').value = '';
    $('#caseType').value = '';
    $('#plaintiff').value = '';
    $('#defendant').value = '';
    $('#extraDefendants').value = '';
    $('#serviceAddress').value = '';
    $('#courtDate').value = '';
    $('#issueDate').value = '';
    $('#attorney').value = '';
    aliasAskedFor = null;
    $('#caseNotes').value = '';
    $('#casePhoneNumbers').value = '';
    $('#isAlias').checked = false;
    $('#isAlias').dispatchEvent(new Event('change'));
    // Court/county/state are left alone -- those tend to stay the same
    // paper to paper, so re-typing them every time would be a hassle.
  }

  sendIntakeBtn.addEventListener('click', async () => {
    sendIntakeBtn.disabled = true;
    intakeStatus.textContent = 'Logging intake…';
    intakeStatus.className = 'status';
    try {
      askAliasIfWeiss(); // covers typing the name and tapping Log intake without leaving the field
      const caseInfo = collectCaseInfo();
      if (!caseInfo.caseNo) throw new Error('Enter a case number first.');
      const res = await fetch('/.netlify/functions/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseInfo })
      });
      if (!res.ok) throw new Error(await res.text());
      intakeStatus.textContent = 'Case logged.';
      intakeStatus.className = 'status ok';
      allCasesCache = null; // new case exists now -- next search should see it
      clearIntakeFields();
    } catch (err) {
      intakeStatus.textContent = 'Failed to log intake — try again. (' + err.message + ')';
      intakeStatus.className = 'status err';
    } finally {
      sendIntakeBtn.disabled = false;
    }
  });

  // ---------- Alias toggle ----------
  // The Attempts card (and its required photos) is always visible now --
  // Jeremy takes attempt photos on any case, not just alias ones. The
  // alias checkbox only controls whether a completed set of attempts can
  // turn into an affidavit (that part is still alias/Scott-Weiss-only).
  const attemptsCard = $('#attemptsCard');
  // (No listener needed here anymore -- the alias checkbox no longer
  // toggles any live gating; "Check attempts" handles that on demand.)

  // ---------- Return PDF: uploaded from Genius Scan, attaches to the case immediately -- no email ----------
  const returnPdfInput = $('#returnPdfInput');
  const returnPdfLabel = $('#returnPdfLabel');
  const returnStatus = $('#returnStatus');
  const returnPreviewStage = $('#returnPreviewStage');
  const returnPreviewFrame = $('#returnPreviewFrame');
  const returnDefendantsPicker = $('#returnDefendantsPicker');
  const returnDefendantsList = $('#returnDefendantsList');
  let returnPdfBase64 = null; // the uploaded PDF's raw base64 -- kept around so it can still be bundled into an affidavit send
  let returnPreviewObjectUrl = null;
  let knownCaseDefendants = null; // fetched from Supabase when the case has >1 defendant

  // We track papers, not cases -- a multi-defendant case can have one
  // defendant served and another still outstanding. Whenever the case
  // number changes, look up the actual stored defendant list (not just
  // what's typed in the form right now, which may be stale/incomplete)
  // and show a checklist so Jeremy can say exactly who this return covers.
  async function refreshDefendantPicker() {
    const caseNo = $('#caseNo').value.trim();
    const defendant = $('#defendant').value.trim();
    knownCaseDefendants = null;
    returnDefendantsPicker.hidden = true;
    returnDefendantsList.innerHTML = '';
    if (!caseNo) return;

    try {
      const qs = new URLSearchParams({ caseNo });
      if (defendant) qs.set('defendant', defendant);
      const res = await fetch(`/.netlify/functions/get-case?${qs.toString()}`);
      if (!res.ok) return; // case not logged yet, or a typo -- fine, just no picker
      const { case: caseRecord } = await res.json();
      const defendants = caseRecord.defendants || [];
      knownCaseDefendants = defendants;

      if (defendants.length > 1) {
        returnDefendantsList.innerHTML = defendants
          .map(
            (d, i) =>
              `<label class="check-row"><input type="checkbox" class="return-defendant-check" value="${d.name}" ${d.served ? 'disabled checked' : 'checked'}> ${d.name}${d.served ? ' (already returned)' : ''}</label>`
          )
          .join('');
        returnDefendantsPicker.hidden = false;
      }
    } catch (err) {
      // Silently ignore -- this is a convenience lookup, not required to attach a return.
    }
  }

  $('#caseNo').addEventListener('change', refreshDefendantPicker);
  $('#defendant').addEventListener('change', refreshDefendantPicker);

  // Which defendant(s) does this specific return cover? If the picker's
  // showing (multi-defendant case), use whatever's checked. Otherwise
  // fall back to the single defendant typed in the Case section.
  function getServedDefendants() {
    if (!returnDefendantsPicker.hidden) {
      return Array.from(returnDefendantsList.querySelectorAll('.return-defendant-check:checked:not(:disabled)')).map(
        (cb) => cb.value
      );
    }
    const primary = $('#defendant').value.trim();
    return primary ? [primary] : [];
  }

  returnPdfInput.addEventListener('change', () => {
    const file = returnPdfInput.files[0];
    if (!file) return;
    returnPdfLabel.textContent = file.name;
    returnStatus.textContent = '';
    state.returnSent = false;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const match = dataUrl.match(/^data:application\/pdf;base64,(.+)$/);
      if (!match) {
        returnStatus.textContent = 'That file doesn\'t look like a PDF — export from Genius Scan as PDF and try again.';
        returnStatus.className = 'status err';
        return;
      }
      returnPdfBase64 = match[1];

      // Preview immediately -- no server round-trip needed for this part.
      if (returnPreviewObjectUrl) URL.revokeObjectURL(returnPreviewObjectUrl);
      const blob = new Blob([file], { type: 'application/pdf' });
      returnPreviewObjectUrl = URL.createObjectURL(blob);
      returnPreviewFrame.src = returnPreviewObjectUrl;
      returnPreviewStage.hidden = false;

      // Attach to the case right away -- storage + status update only,
      // no email. For an alias/Scott Weiss case, this return still gets
      // bundled in automatically when the affidavit itself gets sent
      // (that's the only place email fires from now).
      const caseInfo = collectCaseInfo();
      const returnDate = new Date().toISOString().slice(0, 10);
      const servedDefendants = getServedDefendants();
      const returnOutcome = $('#returnOutcome').value;
      const returnNotes = $('#returnNotes').value.trim();

      returnStatus.textContent = 'Attaching to case…';
      returnStatus.className = 'status';
      try {
        const res = await fetch('/.netlify/functions/attach-return', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseInfo, returnPdfBase64, returnDate, servedDefendants, returnOutcome, returnNotes })
        });
        if (!res.ok) throw new Error(await res.text());
        allCasesCache = null;
        returnStatus.textContent = `Attached to case as of ${returnDate}. No email was sent.`;
        returnStatus.className = 'status ok';
        $('#caseNo').dispatchEvent(new Event('change')); // refresh the defendant picker's served/open state
      } catch (err) {
        returnStatus.textContent = 'Failed to attach — try again. (' + err.message + ')';
        returnStatus.className = 'status err';
      }
    };
    reader.readAsDataURL(file);
  });

  // ---------- Affidavit gating: reads attempts already logged from Search Cases ----------
  const statusSelect = $('#statusSelect');
  const sigBlock = $('#signatureBlock');
  const previewAffidavitBtn = $('#previewAffidavitBtn');
  const affidavitPreviewStage = $('#affidavitPreviewStage');
  const affidavitPreviewFrame = $('#affidavitPreviewFrame');
  const completeBtn = $('#completeAffidavitBtn');
  const affidavitStatus = $('#affidavitStatus');
  const checkAttemptsBtn = $('#checkAttemptsBtn');
  const attemptsCheckStatus = $('#attemptsCheckStatus');
  let previewedPdfBase64 = null; // gates sending -- must match what's currently in the iframe
  let previewObjectUrl = null;
  let checkedCaseAttempts = null; // the attempts array as of the last "Check attempts" click

  // Anything that changes what would go into the PDF invalidates the
  // current preview -- Jeremy should never be able to send a preview
  // that doesn't match the form as it stands now.
  function invalidatePreview() {
    previewedPdfBase64 = null;
    completeBtn.disabled = true;
    affidavitPreviewStage.hidden = true;
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
  }

  function todayStr() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  // Shared validation: all 3 attempts present, each with a date + note,
  // none in the future. Used both by "Check attempts" and by the
  // mark-returned prompt (to know whether to offer jumping to the
  // affidavit right then).
  function attemptsAreComplete(attempts) {
    const today = todayStr();
    const futureDateFound = (attempts || []).some((a) => a.date && a.date > today);
    if (futureDateFound) return false;
    return [1, 2, 3].every((n) => {
      const a = (attempts || []).find((x) => x.n === n);
      return a && a.date && a.note && a.date <= today;
    });
  }

  // Pulls the current case's logged attempts from the server (whatever's
  // been saved via Search Cases) and unlocks the status dropdown once
  // there are 3 valid ones (date + note, no future dates). Attempts
  // themselves are no longer typed here -- this just reads what's
  // already on record for the case currently typed in the Case section.
  checkAttemptsBtn.addEventListener('click', async () => {
    const caseNo = $('#caseNo').value.trim();
    const defendant = $('#defendant').value.trim();
    if (!caseNo || !defendant) {
      attemptsCheckStatus.textContent = 'Type the case number and defendant in the Case section above first.';
      attemptsCheckStatus.className = 'status err';
      return;
    }

    checkAttemptsBtn.disabled = true;
    attemptsCheckStatus.textContent = 'Checking…';
    attemptsCheckStatus.className = 'status';
    try {
      const qs = new URLSearchParams({ caseNo, defendant });
      const res = await fetch(`/.netlify/functions/get-case?${qs.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const { case: caseRecord } = await res.json();
      const attempts = (caseRecord.attempts || []).slice().sort((a, b) => a.n - b.n);

      const today = todayStr();
      const validLoggedAttempts = attempts.filter((a) => a.date && a.note && a.date <= today);
      const validAttempts = [1, 2, 3].every((n) => {
        const a = attempts.find((x) => x.n === n);
        return a && a.date && a.note && a.date <= today;
      });
      const futureDateFound = attempts.some((a) => a.date && a.date > today);
      const overrideChecked = $('#fewerAttemptsOverride').checked;

      invalidatePreview();

      if (futureDateFound) {
        checkedCaseAttempts = [];
        statusSelect.disabled = true;
        statusSelect.value = '';
        attemptsCheckStatus.textContent = 'One of the logged attempt dates is in the future — fix it in Search Cases (Edit) before a status can be selected.';
        attemptsCheckStatus.className = 'status warn';
        sigBlock.hidden = true;
        previewAffidavitBtn.disabled = true;
      } else if (validAttempts) {
        checkedCaseAttempts = attempts;
        statusSelect.disabled = false;
        attemptsCheckStatus.textContent = `All 3 attempts found for ${caseNo}. Pick a status below.`;
        attemptsCheckStatus.className = 'status ok';
      } else if (overrideChecked && validLoggedAttempts.length >= 1) {
        // Override: Jeremy already has enough information to know
        // service won't happen, so he's proceeding without all 3 --
        // uses whatever valid attempts ARE logged, not a full set of 3.
        checkedCaseAttempts = validLoggedAttempts;
        statusSelect.disabled = false;
        attemptsCheckStatus.textContent = `Proceeding with ${validLoggedAttempts.length} of 3 attempts for ${caseNo} (override checked). Pick a status below.`;
        attemptsCheckStatus.className = 'status ok';
      } else {
        checkedCaseAttempts = [];
        const loggedCount = [1, 2, 3].filter((n) => attempts.find((x) => x.n === n && x.date && x.note)).length;
        statusSelect.disabled = true;
        statusSelect.value = '';
        sigBlock.hidden = true;
        previewAffidavitBtn.disabled = true;
        attemptsCheckStatus.textContent = overrideChecked
          ? `No valid attempts logged yet for ${caseNo} — at least one is needed even with the override.`
          : `${loggedCount} of 3 attempts logged for ${caseNo} so far — log the rest from Search Cases, check the override above, or check again once done.`;
        attemptsCheckStatus.className = 'status warn';
      }
    } catch (err) {
      attemptsCheckStatus.textContent = 'Failed to check — try again. (' + err.message + ')';
      attemptsCheckStatus.className = 'status err';
    } finally {
      checkAttemptsBtn.disabled = false;
    }
  });

  statusSelect.addEventListener('change', () => {
    invalidatePreview();
    if (statusSelect.value) {
      sigBlock.hidden = false;
      refreshSigPreview();
      previewAffidavitBtn.disabled = !(state.signature && state.signature.dataUrl);
      if (!state.signature) {
        affidavitStatus.textContent = 'Set up your signature below before completing.';
        affidavitStatus.className = 'status warn';
      } else {
        affidavitStatus.textContent = '';
        affidavitStatus.className = 'status';
      }
    } else {
      sigBlock.hidden = true;
      previewAffidavitBtn.disabled = true;
    }
  });

  // ---------- Complete affidavit: THE trigger ----------
  function collectCaseInfo() {
    const primaryDefendant = $('#defendant').value.trim();
    const extra = $('#extraDefendants').value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const defendants = [primaryDefendant, ...extra]
      .filter(Boolean)
      .map((name) => ({ name, served: false }));

    return {
      courtType: $('#courtType').value.trim(),
      county: $('#county').value.trim(),
      state: $('#state').value.trim(),
      caseNo: $('#caseNo').value.trim(),
      caseType: $('#caseType').value,
      plaintiff: $('#plaintiff').value.trim(),
      defendant: primaryDefendant,
      defendants,
      serviceAddress: $('#serviceAddress').value.trim(),
      courtDate: $('#courtDate').value || null,
      issueDate: $('#issueDate').value || null,
      attorney: $('#attorney').value.trim(),
      notes: $('#caseNotes').value.trim(),
      phoneNumbers: $('#casePhoneNumbers').value.trim(),
      isAlias: $('#isAlias').checked
    };
  }

  previewAffidavitBtn.addEventListener('click', async () => {
    if (!statusSelect.value) return;
    if (!state.signature || !state.signature.dataUrl) {
      affidavitStatus.textContent = 'No saved signature — set one up below first.';
      affidavitStatus.className = 'status err';
      return;
    }

    previewAffidavitBtn.disabled = true;
    affidavitStatus.textContent = 'Generating preview…';
    affidavitStatus.className = 'status';

    const attempts = (checkedCaseAttempts || []).map((a) => ({ n: a.n, date: a.date, note: a.note }));
    const serverInfo = JSON.parse(localStorage.getItem('serverInfo') || '{}');

    try {
      const res = await fetch('/.netlify/functions/preview-affidavit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseInfo: collectCaseInfo(),
          attempts,
          status: statusSelect.value,
          signatureDataUrl: state.signature.dataUrl,
          serverInfo,
          fewerAttemptsOverride: $('#fewerAttemptsOverride').checked
        })
      });
      if (!res.ok) throw new Error(await res.text());
      const { pdfBase64 } = await res.json();

      previewedPdfBase64 = pdfBase64;
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      const byteChars = atob(pdfBase64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
      previewObjectUrl = URL.createObjectURL(blob);
      affidavitPreviewFrame.src = previewObjectUrl;
      affidavitPreviewStage.hidden = false;

      completeBtn.disabled = false;
      affidavitStatus.textContent = returnPdfBase64
        ? 'Preview ready below — check it over, then send. The already-attached return will be bundled in.'
        : 'Preview ready below — check it over, then send.';
      affidavitStatus.className = 'status ok';
    } catch (err) {
      affidavitStatus.textContent = 'Failed to generate preview — try again. (' + err.message + ')';
      affidavitStatus.className = 'status err';
    } finally {
      previewAffidavitBtn.disabled = false;
    }
  });

  completeBtn.addEventListener('click', async () => {
    if (!statusSelect.value || !previewedPdfBase64) return;
    if (!state.signature || !state.signature.dataUrl) {
      affidavitStatus.textContent = 'No saved signature — set one up below first.';
      affidavitStatus.className = 'status err';
      return;
    }

    completeBtn.disabled = true;
    affidavitStatus.textContent = 'Sending to Kevin…';
    affidavitStatus.className = 'status';

    const attempts = (checkedCaseAttempts || []).map((a) => ({ n: a.n, date: a.date, note: a.note }));

    const serverInfo = JSON.parse(localStorage.getItem('serverInfo') || '{}');

    const payload = {
      caseInfo: collectCaseInfo(),
      attempts,
      status: statusSelect.value,
      signatureDataUrl: state.signature.dataUrl,
      serverInfo,
      fewerAttemptsOverride: $('#fewerAttemptsOverride').checked,
      // Bundle the return PDF automatically if one's already on hand.
      // Per the spec: both go out together in one email, no waiting.
      returnPdfBase64: returnPdfBase64 || null,
      returnDate: returnPdfBase64 ? new Date().toISOString().slice(0, 10) : null
    };

    try {
      const res = await fetch('/.netlify/functions/complete-affidavit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      allCasesCache = null;
      affidavitStatus.textContent = returnPdfBase64
        ? 'Affidavit + return sent to Kevin.'
        : 'Affidavit sent to Kevin. (No return PDF was attached — upload one above if you have it.)';
      affidavitStatus.className = 'status ok';
    } catch (err) {
      affidavitStatus.textContent = 'Failed to send — try again. (' + err.message + ')';
      affidavitStatus.className = 'status err';
      completeBtn.disabled = false;
    }
  });

  // ---------- Schedule (meetings with defendants) ----------
  // A meeting is saved ON the case (date + time + optional note), so the
  // schedule shows the case's address, phones and notes with nothing to
  // re-type. Times are Central wall-clock values.
  const SCHED_TZ = 'America/Chicago';
  function centralNow() {
    const d = new Date();
    return {
      date: d.toLocaleDateString('en-CA', { timeZone: SCHED_TZ }),
      time: d.toLocaleTimeString('en-GB', { timeZone: SCHED_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    };
  }
  function fmtMeetingTime(t) {
    const [h, m] = String(t || '00:00').split(':').map(Number);
    return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
  function plusDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  function meetingDateLabel(date, today) {
    if (date === today) return 'Today';
    if (date === plusDays(today, 1)) return 'Tomorrow';
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }
  // Phone numbers in free text become tap-to-call links.
  function linkifyPhones(text) {
    return esc(text).replace(/(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g, (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 10 ? `<a href="tel:${digits}">${m}</a>` : m;
    });
  }

  async function sendAppointment(body) {
    const res = await fetch('/.netlify/functions/appointment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // Pop-up to add (or, with appt, reschedule) a meeting for case c.
  // Resolves true if something was saved, false if cancelled.
  function openMeetingForm({ c, appt }) {
    return new Promise((resolve) => {
      const now = centralNow();
      const overlay = document.createElement('div');
      overlay.className = 'meeting-modal';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;overflow:auto;padding:1rem;';
      overlay.innerHTML =
        `<div style="background:var(--panel,#fff);max-width:30rem;margin:0 auto;padding:1rem;border-radius:6px;">` +
        `<h3 style="margin-top:0;">${appt ? 'Reschedule' : 'Schedule'} meeting — ${esc(c.defendant || 'Case')}</h3>` +
        `<p class="hint">${esc(c.serviceAddress || '')}${c.caseNo ? ' · Case No. ' + esc(c.caseNo) : ''}</p>` +
        `<label>Date <input type="date" class="meeting-date" value="${appt ? appt.date : now.date}"></label>` +
        `<label>Time <input type="time" class="meeting-time" value="${appt ? appt.time : '10:00'}"></label>` +
        `<label>Note (optional) <textarea class="meeting-note" rows="2" placeholder="e.g. Defendant called back, will be home">${esc(appt ? appt.note : '')}</textarea></label>` +
        `<div class="sig-actions">` +
        `<button type="button" class="btn primary meeting-save">${appt ? 'Save new time' : 'Add to schedule'}</button>` +
        `<button type="button" class="btn secondary meeting-cancel">Cancel</button>` +
        `</div>` +
        `<p class="status meeting-status"></p>` +
        `</div>`;
      document.body.appendChild(overlay);
      const q = (sel) => overlay.querySelector(sel);
      const done = (v) => { overlay.remove(); resolve(v); };
      q('.meeting-cancel').addEventListener('click', () => done(false));
      q('.meeting-save').addEventListener('click', async () => {
        const date = q('.meeting-date').value;
        const time = q('.meeting-time').value;
        const status = q('.meeting-status');
        if (!date || !time) {
          status.textContent = 'Pick a date and a time.';
          status.className = 'status meeting-status err';
          return;
        }
        q('.meeting-save').disabled = true;
        status.textContent = 'Saving…';
        status.className = 'status meeting-status';
        try {
          await sendAppointment(
            appt
              ? { id: c.id, action: 'update', appointmentId: appt.id, date, time, note: q('.meeting-note').value }
              : { id: c.id, action: 'add', date, time, note: q('.meeting-note').value }
          );
          done(true);
        } catch (err) {
          status.textContent = 'Failed to save — try again. (' + err.message + ')';
          status.className = 'status meeting-status err';
          q('.meeting-save').disabled = false;
        }
      });
    });
  }

  const scheduleList = $('#scheduleList');
  const scheduleBanner = $('#scheduleBanner');

  function collectMeetings(cases) {
    const out = [];
    (cases || []).forEach((c) => {
      if (c.status === 'closed') return; // returned/closed cases drop off the schedule
      (c.appointments || []).forEach((a) => {
        if (a.status === 'scheduled') out.push({ c, a });
      });
    });
    out.sort((x, y) => (x.a.date + x.a.time).localeCompare(y.a.date + y.a.time));
    return out;
  }

  function renderSchedule(cases) {
    const now = centralNow();
    const meetings = collectMeetings(cases);
    const isPast = (m) => m.a.date < now.date || (m.a.date === now.date && m.a.time < now.time);
    const needsAttention = meetings.filter(isPast);
    const upcoming = meetings.filter((m) => !isPast(m));
    const todays = upcoming.filter((m) => m.a.date === now.date);

    let banner = '';
    if (needsAttention.length) {
      banner += `<p class="status err">⚠️ ${needsAttention.length} meeting${needsAttention.length === 1 ? '' : 's'} past the scheduled time — mark ${needsAttention.length === 1 ? 'it' : 'them'} done or reschedule.</p>`;
    }
    banner += todays.length
      ? `<p class="status ok">📅 ${todays.length} meeting${todays.length === 1 ? '' : 's'} today — next at ${fmtMeetingTime(todays[0].a.time)} (${esc(todays[0].c.defendant || 'defendant')}).</p>`
      : `<p class="hint">No meetings left today.</p>`;
    scheduleBanner.innerHTML = banner;

    if (!meetings.length) {
      scheduleList.innerHTML = '<p class="hint">Nothing scheduled. On any case, tap “📅 Schedule meeting.”</p>';
      return;
    }

    const groups = [];
    if (needsAttention.length) groups.push({ title: 'Needs attention — time has passed', items: needsAttention, late: true });
    const byDate = new Map();
    upcoming.forEach((m) => {
      if (!byDate.has(m.a.date)) byDate.set(m.a.date, []);
      byDate.get(m.a.date).push(m);
    });
    byDate.forEach((items, date) => groups.push({ title: meetingDateLabel(date, now.date), items }));

    scheduleList.innerHTML = groups.map((g) =>
      `<h3 style="margin:1rem 0 .3rem;${g.late ? 'color:#b00020;' : ''}">${esc(g.title)}</h3>` +
      g.items.map(({ c, a }) => {
        const names = Array.isArray(c.defendants) && c.defendants.length
          ? c.defendants.map((d) => d.name).filter(Boolean).join(', ')
          : (c.defendant || 'Unknown Defendant');
        const dateNote = g.late ? ` <span class="hint">(${esc(meetingDateLabel(a.date, now.date))})</span>` : '';
        return (
          `<div class="case-row" data-meeting-case="${esc(c.id)}" data-meeting-id="${esc(a.id)}">` +
          `<div class="case-style"><strong>${fmtMeetingTime(a.time)}</strong>${dateNote} — ${esc(names)}</div>` +
          `<div class="case-meta">📍 ${esc(c.serviceAddress || 'No address')}</div>` +
          `<div class="case-meta">Case No. ${esc(c.caseNo || 'N/A')} — ${esc(c.plaintiff || '')}${c.attorney ? ' — ' + esc(c.attorney) : ''}</div>` +
          (a.note ? `<div class="case-notes">🗓️ ${esc(a.note)}</div>` : '') +
          (c.notes ? `<div class="case-notes">📝 ${esc(c.notes)}</div>` : '') +
          (c.phoneNumbers ? `<div class="case-notes">📞 ${linkifyPhones(c.phoneNumbers).replace(/\n/g, '<br>')}</div>` : '') +
          `<div>` +
          (c.serviceAddress
            ? `<a class="btn primary" style="margin-top:.4rem;display:inline-block;" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.serviceAddress)}&travelmode=driving">Navigate</a> `
            : '') +
          `<a class="btn secondary meeting-ics-btn" style="margin-top:.4rem;display:inline-block;" href="/.netlify/functions/meeting-ics?id=${encodeURIComponent(c.id)}&appt=${encodeURIComponent(a.id)}">Add to calendar</a> ` +
          `<button type="button" class="btn secondary meeting-done-btn" style="margin-top:.4rem;">Done</button> ` +
          `<button type="button" class="btn secondary meeting-resched-btn" style="margin-top:.4rem;">Reschedule</button> ` +
          `<button type="button" class="btn secondary meeting-cancel-btn" style="margin-top:.4rem;">Cancel meeting</button>` +
          `</div></div>`
        );
      }).join('')
    ).join('');

    scheduleList.querySelectorAll('[data-meeting-id]').forEach((row) => {
      const c = cases.find((x) => x.id === row.dataset.meetingCase);
      const a = (c.appointments || []).find((x) => x.id === row.dataset.meetingId);
      const change = async (action) => {
        try {
          await sendAppointment({ id: c.id, action, appointmentId: a.id });
          await refreshSchedule();
        } catch (err) {
          alert('Failed — try again. (' + err.message + ')');
        }
      };
      row.querySelector('.meeting-done-btn').addEventListener('click', () => change('done'));
      row.querySelector('.meeting-cancel-btn').addEventListener('click', () => {
        if (confirm(`Cancel the ${fmtMeetingTime(a.time)} meeting with ${c.defendant || 'this defendant'}?`)) change('cancel');
      });
      row.querySelector('.meeting-resched-btn').addEventListener('click', async () => {
        if (await openMeetingForm({ c, appt: a })) await refreshSchedule();
      });
    });
  }

  // Re-fetches cases and redraws the schedule (and the search results,
  // if open, so a case row's "Meeting:" line stays current).
  async function refreshSchedule() {
    allCasesCache = null;
    try {
      const cases = await ensureAllCasesLoaded();
      renderSchedule(cases);
      renderToday(cases);
      if (typeof caseSearchInput !== 'undefined' && caseSearchInput.value.trim()) {
        caseSearchInput.dispatchEvent(new Event('input'));
      }
    } catch (err) {
      scheduleList.innerHTML = `<p class="status err">Couldn't load the schedule. (${esc(err.message)})</p>`;
    }
  }
  $('#refreshScheduleBtn').addEventListener('click', refreshSchedule);
  // The first thing you see when you open the app.
  refreshSchedule();

  // ====================== App shell: tabs, Today, case page ======================
  let currentSheet = null; // { id, tab } -- the case page that's open, if any
  let soloCase = false;    // true when the Cases list was swapped for one case (opened from Today)
  let casesFilter = 'open';

  function showView(name, opts) {
    opts = opts || {};
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== 'view-' + name; });
    document.querySelectorAll('#tabbar [data-view]').forEach((t) => {
      t.classList.toggle('on', t.dataset.view === name);
    });
    if (!opts.keepSheet) closeSheet({ silent: true });
    window.scrollTo(0, 0);
    if (opts.noRefresh) return;
    if (name === 'today') refreshSchedule();
    else if (name === 'cases') refreshCases();
    else if (name === 'route' && !routeList.children.length) loadRouteBtn.click();
  }

  document.querySelectorAll('#tabbar [data-view]').forEach((t) => {
    t.addEventListener('click', () => showView(t.dataset.view));
  });

  function openSheet(id, tab) {
    const row = caseSearchResults.querySelector(`[data-case-row="${CSS.escape(id)}"]`);
    if (!row) return false;
    caseSearchResults.querySelectorAll('.case-row.open').forEach((r) => { if (r !== row) r.classList.remove('open'); });
    row.classList.add('open');
    row.querySelector('.case-sheet').dataset.tab = tab || 'info';
    currentSheet = { id, tab: tab || 'info' };
    document.body.classList.add('sheet-open');
    const body = row.querySelector('.sheet-body');
    if (body) body.scrollTop = 0;
    return true;
  }

  function closeSheet(opts) {
    caseSearchResults.querySelectorAll('.case-row.open').forEach((r) => r.classList.remove('open'));
    currentSheet = null;
    document.body.classList.remove('sheet-open');
    if (soloCase) {
      soloCase = false;
      if (!(opts && opts.silent)) refreshCases();
    }
  }

  // Called after every render of the Cases list.
  function wireCaseSheets() {
    caseSearchResults.querySelectorAll('[data-open-case]').forEach((el) => {
      const open = () => openSheet(el.dataset.openCase);
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    caseSearchResults.querySelectorAll('.sheet-back').forEach((b) => b.addEventListener('click', () => closeSheet()));
    caseSearchResults.querySelectorAll('.sheet-tab').forEach((b) => {
      b.addEventListener('click', () => {
        const sheet = b.closest('.case-sheet');
        sheet.dataset.tab = b.dataset.tab;
        if (currentSheet) currentSheet.tab = b.dataset.tab;
        const body = sheet.querySelector('.sheet-body');
        if (body) body.scrollTop = 0;
      });
    });
    // A save re-renders the list; put the person back on the same case page / tab.
    if (currentSheet && !openSheet(currentSheet.id, currentSheet.tab)) {
      currentSheet = null;
      document.body.classList.remove('sheet-open');
    }
  }

  // Open a case's page from anywhere (Today, attention list). autoLog taps
  // its Log attempt button for you.
  async function openCasePage(id, opts) {
    opts = opts || {};
    showView('cases', { keepSheet: true, noRefresh: true });
    const cases = await ensureAllCasesLoaded();
    const c = cases.find((x) => x.id === id);
    if (!c) return;
    if (!caseSearchResults.querySelector(`[data-case-row="${CSS.escape(id)}"]`)) {
      soloCase = true;
      renderSearchResults([c], '');
    }
    openSheet(id, opts.tab);
    if (opts.autoLog) {
      setTimeout(() => {
        const b = caseSearchResults.querySelector(`[data-case-row="${CSS.escape(id)}"] .log-attempt-btn`);
        if (b) b.click();
      }, 0);
    }
  }

  // ---------- Cases list: search + filter chips ----------
  function priorityRank(c) {
    return window.SPSPriority ? window.SPSPriority.assess(c).sortKey : 99999;
  }
  function listForFilter(cases) {
    const open = cases.filter((c) => c.status !== 'closed');
    if (casesFilter === 'closed') {
      return cases.filter((c) => c.status === 'closed')
        .sort((a, b) => String(b.closedDate || '').localeCompare(String(a.closedDate || ''))).slice(0, 50);
    }
    if (casesFilter === 'priority') {
      return open.filter((c) => window.SPSPriority && window.SPSPriority.assess(c).level !== 'ok')
        .sort((a, b) => priorityRank(a) - priorityRank(b));
    }
    if (casesFilter === 'meetings') {
      const next = (c) => (c.appointments || []).filter((a) => a.status === 'scheduled')
        .map((a) => a.date + a.time).sort()[0];
      return open.filter(next).sort((a, b) => next(a).localeCompare(next(b)));
    }
    return open.sort((a, b) => priorityRank(a) - priorityRank(b) || String(b.intakeDate || '').localeCompare(String(a.intakeDate || '')));
  }

  async function refreshCases() {
    const raw = caseSearchInput.value.trim();
    const query = raw.toLowerCase();
    try {
      const cases = await ensureAllCasesLoaded();
      let list;
      if (query) {
        list = cases.filter((c) => {
          const haystack = [c.defendant, c.plaintiff, c.caseNo, c.caseType, c.serviceAddress, c.notes, c.returnNotes, c.phoneNumbers, ...(c.defendants || []).map((d) => d.name)]
            .filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(query);
        });
      } else {
        list = listForFilter(cases);
      }
      $('#casesHint').textContent = query
        ? 'Searching every case you\'ve logged, open or closed.'
        : ({ open: 'Open cases, most urgent first.', priority: 'Open cases with a court date or expiration coming up.', meetings: 'Open cases with a meeting scheduled.', closed: 'Most recent closed cases. Search to find older ones.' })[casesFilter];
      renderSearchResults(list, raw);
    } catch (err) {
      caseSearchResults.innerHTML = `<p class="status err">Couldn't load cases. (${esc(err.message)})</p>`;
    }
  }

  document.querySelectorAll('#caseChips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      casesFilter = chip.dataset.filter;
      document.querySelectorAll('#caseChips .chip').forEach((c) => c.classList.toggle('on', c === chip));
      refreshCases();
    });
  });

  // ---------- Today ----------
  function renderToday(cases) {
    const now = centralNow();
    const P = window.SPSPriority;
    const open = (cases || []).filter((c) => c.status !== 'closed');
    $('#todayDate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: SCHED_TZ });

    let attemptsToday = 0;
    (cases || []).forEach((c) => (c.attempts || []).forEach((a) => { if (a.date === now.date) attemptsToday++; }));
    $('#todayAttempts').textContent = attemptsToday ? `${attemptsToday} attempt${attemptsToday === 1 ? '' : 's'} logged` : '';

    const meetingsToday = collectMeetings(cases).filter((m) => m.a.date === now.date).length;
    const attn = P
      ? open.map((c) => ({ c, pr: P.assess(c) })).filter((x) => x.pr.level !== 'ok').sort((a, b) => a.pr.sortKey - b.pr.sortKey)
      : [];
    $('#statOpen').textContent = open.length;
    $('#statMeet').textContent = meetingsToday;
    $('#statAttn').textContent = attn.length;

    // Needs attention
    $('#attentionList').innerHTML = attn.length
      ? attn.slice(0, 5).map(({ c, pr }) => {
          const red = pr.level === 'past' || pr.level === 'high';
          const label = { past: 'Past due', high: 'High', soon: 'Soon' }[pr.level];
          return `<div class="mini-row" data-attn="${esc(c.id)}"><span class="dot ${red ? 'red' : 'yellow'}"></span>` +
            `<div><div class="name">${esc(c.defendant || 'Unknown')}</div><div class="sub">${esc(pr.reasons.join('; '))}</div></div>` +
            `<span class="tag ${red ? 'red' : 'yellow'}">${label}</span></div>`;
        }).join('')
      : '<p class="hint">Nothing urgent right now.</p>';
    $('#attentionList').querySelectorAll('[data-attn]').forEach((row) => {
      row.addEventListener('click', () => openCasePage(row.dataset.attn));
    });

    // Next stop: first case in your saved route order with no attempt today.
    let order = [];
    try { order = JSON.parse(localStorage.getItem('sps_routeOrder') || '[]'); } catch (e) { order = []; }
    const stops = order.map((id) => (cases || []).find((c) => c.id === id)).filter((c) => c && c.status !== 'closed' && c.serviceAddress);
    const nextIdx = stops.findIndex((c) => !(c.attempts || []).some((a) => a.date === now.date));
    const card = $('#nextStopCard');
    if (nextIdx === -1) {
      card.innerHTML =
        `<div class="eyebrow">NEXT STOP</div>` +
        `<div class="where">${stops.length ? 'Every stop on your route has an attempt today.' : 'No route planned yet.'}</div>` +
        `<div class="row"><button type="button" class="btn secondary grow" id="planRouteBtn">${stops.length ? 'View route' : 'Plan today\'s route'}</button></div>`;
      $('#planRouteBtn').addEventListener('click', () => showView('route'));
    } else {
      const c = stops[nextIdx];
      const n = (c.attempts || []).length;
      card.innerHTML =
        `<div class="eyebrow">NEXT STOP <b>Stop ${nextIdx + 1} of ${stops.length}</b></div>` +
        `<div><div class="who">${esc(c.defendant || 'Unknown')}</div><div class="where">${esc(c.serviceAddress)}</div>` +
        `<div class="where">Attempts so far: ${n} of 3</div></div>` +
        `<div class="row">` +
        (n < 3 ? `<button type="button" class="btn log-attempt-btn grow" id="todayLogBtn">📍 Log attempt</button>` : `<button type="button" class="btn secondary grow" id="todayOpenBtn">Open case</button>`) +
        `<a class="nav-btn" aria-label="Navigate" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.serviceAddress)}&travelmode=driving">` +
        `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8z"/></svg></a>` +
        `</div>`;
      const logBtn = $('#todayLogBtn');
      if (logBtn) logBtn.addEventListener('click', () => openCasePage(c.id, { autoLog: true }));
      const openBtn = $('#todayOpenBtn');
      if (openBtn) openBtn.addEventListener('click', () => openCasePage(c.id));
    }
  }

  // ---------- New case: three short steps ----------
  const INTAKE_STEP_TITLES = ['case, plaintiff and defendant', 'court details', 'notes and phone numbers'];
  function setIntakeStep(n) {
    document.querySelectorAll('#intakeCard [data-step]').forEach((l) => { l.hidden = Number(l.dataset.step) !== n; });
    document.querySelectorAll('#view-new .progress span').forEach((sp, i) => sp.classList.toggle('on', i < n));
    $('#newStepLabel').textContent = `Step ${n} of 3: ${INTAKE_STEP_TITLES[n - 1]}`;
    $('#stepBackBtn').hidden = n === 1;
    $('#stepNextBtn').hidden = n === 3;
    $('#sendIntakeBtn').hidden = n !== 3;
    $('#intakeHint').hidden = n !== 3;
    window.scrollTo(0, 0);
    intakeStep = n;
  }
  let intakeStep = 1;
  $('#stepNextBtn').addEventListener('click', () => setIntakeStep(Math.min(3, intakeStep + 1)));
  $('#stepBackBtn').addEventListener('click', () => setIntakeStep(Math.max(1, intakeStep - 1)));
  new MutationObserver(() => {
    if ($('#intakeStatus').textContent === 'Case logged.') {
      allCasesCache = null;
      setIntakeStep(1);
    }
  }).observe($('#intakeStatus'), { childList: true, characterData: true, subtree: true });
  setIntakeStep(1);

  // Start on Today.
  showView('today', { noRefresh: true });
})();
