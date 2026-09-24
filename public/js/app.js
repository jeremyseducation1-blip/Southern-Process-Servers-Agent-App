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

  // ---------- Collapsible sections ----------
  // Every card with an <h2> becomes click-to-expand/collapse -- generic,
  // not wired per-section, so new cards get this for free. Case and
  // Intake start open (the two things used every single time); everything
  // else starts collapsed to cut down on the clutter of scrolling past
  // sections that aren't needed right now.
  const OPEN_BY_DEFAULT = ['Case', 'Intake'];
  document.querySelectorAll('.card').forEach((card) => {
    const heading = card.querySelector('h2');
    if (!heading) return;
    if (!OPEN_BY_DEFAULT.includes(heading.textContent.trim())) {
      card.classList.add('collapsed');
    }
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
    $('#sigSetupCard').querySelector('h2').scrollIntoView({ behavior: 'smooth' });
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
  function mondayOfWeek(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
    const diff = day === 0 ? -6 : 1 - day; // shift back to Monday
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

  // ---------- Monthly open-case report ----------
  const loadMonthReportBtn = $('#loadMonthReportBtn');
  const monthReportList = $('#monthReportList');

  function formatMonthLabel(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  loadMonthReportBtn.addEventListener('click', async () => {
    loadMonthReportBtn.disabled = true;
    monthReportList.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const res = await fetch('/.netlify/functions/list-cases');
      if (!res.ok) throw new Error(await res.text());
      const { cases } = await res.json();
      const openCases = (cases || []).filter((c) => c.status !== 'closed');

      if (!openCases.length) {
        monthReportList.innerHTML = '<p class="hint">Nothing open right now.</p>';
        return;
      }

      // Group by intake month, most recent first.
      const groups = new Map(); // key: YYYY-MM, value: { label, count }
      openCases.forEach((c) => {
        if (!c.intakeDate) return;
        const key = c.intakeDate.slice(0, 7);
        if (!groups.has(key)) {
          groups.set(key, { label: formatMonthLabel(key), count: 0 });
        }
        groups.get(key).count += 1;
      });

      const sortedKeys = Array.from(groups.keys()).sort((a, b) => (a < b ? 1 : -1));

      const html = sortedKeys
        .map((key) => {
          const group = groups.get(key);
          const caseWord = group.count === 1 ? 'case' : 'cases';
          return (
            `<button type="button" class="week-btn" data-month="${key}">` +
            `<span class="week-btn-label">${group.label}</span>` +
            `<span class="week-btn-count">${group.count} still open ${caseWord} &rsaquo;</span>` +
            `</button>`
          );
        })
        .join('');

      monthReportList.innerHTML = html;

      monthReportList.querySelectorAll('.week-btn').forEach((btn) => {
        btn.addEventListener('click', () => openMonthPdf(btn.dataset.month, btn));
      });
    } catch (err) {
      monthReportList.innerHTML = `<p class="status err">Failed to load report. (${err.message})</p>`;
    } finally {
      loadMonthReportBtn.disabled = false;
    }
  });

  async function openMonthPdf(monthKey, btn) {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="week-btn-label">Opening…</span>';
    try {
      const res = await fetch(`/.netlify/functions/month-report-pdf?month=${monthKey}`);
      if (!res.ok) throw new Error(await res.text());
      const { pdfBase64 } = await res.json();
      const byteChars = atob(pdfBase64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      alert('Failed to open monthly report — try again. (' + err.message + ')');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
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
      const returned = (cases || []).filter((c) => c.returnDate);

      if (!returned.length) {
        weekInvoiceList.innerHTML = '<p class="hint">Nothing returned yet.</p>';
        return;
      }

      const groups = new Map(); // key: monday ISO date, value: { label, count }
      returned.forEach((c) => {
        const monday = mondayOfWeek(c.returnDate);
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

  // ---------- My Invoices -- persisted history of every generated invoice ----------
  const loadInvoicesBtn = $('#loadInvoicesBtn');
  const invoicesList = $('#invoicesList');

  loadInvoicesBtn.addEventListener('click', async () => {
    loadInvoicesBtn.disabled = true;
    invoicesList.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const res = await fetch('/.netlify/functions/list-invoices');
      if (!res.ok) throw new Error(await res.text());
      const { invoices } = await res.json();

      if (!invoices.length) {
        invoicesList.innerHTML = '<p class="hint">No invoices generated yet.</p>';
        return;
      }

      invoicesList.innerHTML = invoices
        .map((inv) => {
          const generated = inv.generated_at ? new Date(inv.generated_at).toLocaleString('en-US') : '';
          const total = Number(inv.total || 0).toFixed(2);
          return (
            `<div class="case-row">` +
            `<div class="case-style">${inv.week_label || inv.week_key}</div>` +
            `<div class="case-meta">${inv.billable_count} case${inv.billable_count === 1 ? '' : 's'} — $${total} total</div>` +
            `<div class="case-meta">Generated ${generated}</div>` +
            `<button type="button" class="btn secondary view-invoice-btn" data-week="${inv.week_key}" style="margin-top:.4rem;">View PDF</button>` +
            `</div>`
          );
        })
        .join('');

      invoicesList.querySelectorAll('.view-invoice-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const weekKey = btn.dataset.week;
          const original = btn.textContent;
          btn.disabled = true;
          btn.textContent = 'Opening…';
          try {
            const res = await fetch(`/.netlify/functions/get-invoice-pdf?week=${weekKey}`);
            if (!res.ok) throw new Error(await res.text());
            const { url } = await res.json();
            window.open(url, '_blank');
          } catch (err) {
            alert('Failed to open invoice — try again. (' + err.message + ')');
          } finally {
            btn.disabled = false;
            btn.textContent = original;
          }
        });
      });
    } catch (err) {
      invoicesList.innerHTML = `<p class="status err">Failed to load invoices. (${err.message})</p>`;
    } finally {
      loadInvoicesBtn.disabled = false;
    }
  });

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
      caseSearchResults.innerHTML = `<p class="hint">No matches for "${query}".</p>`;
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
            ? `<button type="button" class="btn secondary mark-returned-btn" data-id="${c.id}" style="margin-top:.4rem;">Mark returned (no email — already handled outside the app)</button>`
            : '';
        const viewReturnBtn = c.returnPdfPath
          ? `<button type="button" class="btn secondary view-pdf-btn" data-id="${c.id}" data-kind="return" style="margin-top:.4rem;">View return PDF</button>`
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
                return `<div class="attempt-history-line">#${a.n} — ${a.date || 'no date'}: ${noteText}${photoTs}</div>`;
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
        const editBtn = `<button type="button" class="btn secondary edit-case-btn" data-id="${c.id}" style="margin-top:.4rem;">Edit</button>`;
        const nextAttemptN = Math.min(3, sortedAttempts.length + 1);
        const logAttemptBtn = sortedAttempts.length >= 3
          ? ''
          : `<button type="button" class="btn secondary log-attempt-btn" data-id="${c.id}" style="margin-top:.4rem;">+ Log attempt ${nextAttemptN}</button>`;
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
        return (
          `<div class="case-row" data-case-row="${c.id}">` +
          `<div class="case-style">${style}</div>` +
          `<div class="case-meta">Case No. ${c.caseNo || 'N/A'} — ${c.attorney || ''}${c.caseType ? ' — ' + c.caseType : ''}</div>` +
          `<div class="case-meta">${c.serviceAddress || ''}</div>` +
          `<div class="case-meta">Logged ${intake}${c.returnDate ? ' · Returned ' + c.returnDate : ''}${c.closedDate ? ' · Closed ' + new Date(c.closedDate).toLocaleDateString('en-US') : ''}</div>` +
          `<span class="${statusPillClass}">${statusLabel}</span>` +
          missingReturnNote +
          notesBlock +
          phoneBlock +
          defendantBreakdown +
          attemptHistory +
          `<div>${viewReturnBtn}${viewAffidavitBtn}${attemptPhotoBtns}${markBtn}${logAttemptBtn}${editBtn}</div>` +
          `<div class="attempt-log-form" data-attempt-form="${c.id}" hidden></div>` +
          `<div class="edit-case-form" data-edit-form="${c.id}" hidden></div>` +
          `</div>`
        );
      })
      .join('');

    caseSearchResults.querySelectorAll('.log-attempt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const c = cases.find((x) => x.id === id);
        const formEl = caseSearchResults.querySelector(`.attempt-log-form[data-attempt-form="${CSS.escape(id)}"]`);
        if (!formEl || !c) return;

        if (!formEl.hidden) {
          formEl.hidden = true;
          return;
        }

        const existingN = (c.attempts || []).map((a) => a.n);
        const n = [1, 2, 3].find((num) => !existingN.includes(num));
        if (!n) {
          alert('This case already has all 3 attempts logged.');
          return;
        }

        formEl.innerHTML = `
          <label>Attempt ${n} date <input type="date" class="attempt-log-date"></label>
          <label>Note (required) <textarea class="attempt-log-note" rows="2" placeholder="What happened on this attempt"></textarea></label>
          <label class="file-drop">
            <input type="file" class="attempt-log-photo" accept="image/*" capture="environment">
            <span class="attempt-log-photo-label">Photo of notice (optional evidence)</span>
          </label>
          <div class="sig-actions">
            <button type="button" class="btn primary attempt-log-save-btn">Save attempt ${n}</button>
            <button type="button" class="btn secondary attempt-log-cancel-btn">Cancel</button>
          </div>
          <p class="status attempt-log-status"></p>
        `;
        formEl.hidden = false;

        formEl.querySelector('.attempt-log-cancel-btn').addEventListener('click', () => {
          formEl.hidden = true;
        });

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
              statusEl.textContent = `Saved — attempt ${n} logged.`;
              statusEl.className = 'status ok';
              allCasesCache = null;
              setTimeout(() => caseSearchInput.dispatchEvent(new Event('input')), 600);
            } catch (err) {
              statusEl.textContent = 'Failed to save — try again. (' + err.message + ')';
              statusEl.className = 'status err';
              saveBtn.disabled = false;
            }
          };

          const file = photoInput.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = () => finishSave(reader.result);
            reader.readAsDataURL(file);
          } else {
            finishSave(null);
          }
        });
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

    caseSearchResults.querySelectorAll('.mark-returned-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const c = cases.find((x) => x.id === id);
        const outstanding = (c?.defendants || []).filter((d) => !d.served).map((d) => d.name);

        let servedDefendants = null;
        if (outstanding.length > 1) {
          const typed = prompt(
            `This case has multiple defendants still open:\n${outstanding.join(', ')}\n\n` +
              `Type which one(s) this return covers (comma-separated), or leave blank for all of them.`
          );
          if (typed === null) return; // cancelled
          servedDefendants = typed.trim() ? typed.split(',').map((s) => s.trim()).filter(Boolean) : outstanding;
        }

        const returnDate = prompt('Return date for this case (YYYY-MM-DD)?', new Date().toISOString().slice(0, 10));
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
    const query = caseSearchInput.value.trim().toLowerCase();
    clearTimeout(searchDebounce);
    if (!query) {
      caseSearchResults.innerHTML = '';
      return;
    }
    searchDebounce = setTimeout(async () => {
      caseSearchResults.innerHTML = '<p class="hint">Searching…</p>';
      try {
        const cases = await ensureAllCasesLoaded();
        const matches = cases.filter((c) => {
          const haystack = [c.defendant, c.plaintiff, c.caseNo, c.caseType, c.serviceAddress, c.notes, c.returnNotes, c.phoneNumbers, ...(c.defendants || []).map((d) => d.name)]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(query);
        });
        renderSearchResults(matches, caseSearchInput.value.trim());
      } catch (err) {
        caseSearchResults.innerHTML = `<p class="status err">Search failed. (${err.message})</p>`;
      }
    }, 250);
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
    $('#attorney').value = 'Scott Weiss';
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
      const validAttempts = [1, 2, 3].every((n) => {
        const a = attempts.find((x) => x.n === n);
        return a && a.date && a.note && a.date <= today;
      });
      const futureDateFound = attempts.some((a) => a.date && a.date > today);

      checkedCaseAttempts = attempts;
      invalidatePreview();

      if (futureDateFound) {
        statusSelect.disabled = true;
        statusSelect.value = '';
        attemptsCheckStatus.textContent = 'One of the logged attempt dates is in the future — fix it in Search Cases (Edit) before a status can be selected.';
        attemptsCheckStatus.className = 'status warn';
        sigBlock.hidden = true;
        previewAffidavitBtn.disabled = true;
      } else if (validAttempts) {
        statusSelect.disabled = false;
        attemptsCheckStatus.textContent = `All 3 attempts found for ${caseNo}. Pick a status below.`;
        attemptsCheckStatus.className = 'status ok';
      } else {
        const loggedCount = [1, 2, 3].filter((n) => attempts.find((x) => x.n === n && x.date && x.note)).length;
        statusSelect.disabled = true;
        statusSelect.value = '';
        sigBlock.hidden = true;
        previewAffidavitBtn.disabled = true;
        attemptsCheckStatus.textContent = `${loggedCount} of 3 attempts logged for ${caseNo} so far — log the rest from Search Cases, then check again.`;
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
      attorney: $('#attorney').value.trim() || 'Scott Weiss',
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
          serverInfo
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
})();
