const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { listOpenCases } = require('./caseStore');
const { assess, pretty } = require('./priority');

// Monday of the week a YYYY-MM-DD date falls in (local-parts parse, same
// as the rest of the app -- see mondayOfWeek in buildWeekInvoicePdf.js).
function mondayKey(dateStr) {
  const [y, m, d0] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d0) return null;
  const d = new Date(y, m - 1, d0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function weekHeading(key) {
  if (!key) return 'Received date unknown';
  const [y, m, d] = key.split('-').map(Number);
  return 'Week of ' + new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// Builds the inventory PDF (every case still open, right now). Returns
// { pdfDoc, openCount } -- pdfDoc is left un-saved (as a PDFDocument, not
// bytes) so callers can merge its pages into a combined document if
// needed, instead of always producing a standalone file.
async function buildInventoryPdf() {
  const openCases = await listOpenCases();

  // Everything still out there, from every week -- grouped by the week it
  // was received, oldest week first (the oldest are the ones to chase),
  // so it reads as a compilation of all the weeks, not just this one.
  const byWeek = new Map();
  openCases.forEach((c) => {
    const key = c.intakeDate ? mondayKey(c.intakeDate) : null;
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push(c);
  });
  const weekKeys = Array.from(byWeek.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -1 : 1;
  });
  // Court-date / expiration urgency for every open case.
  const info = new Map(openCases.map((c) => [c.id, assess(c)]));
  const levelRank = { past: 0, high: 1, soon: 2, ok: 3 };
  const needsAttention = openCases
    .filter((c) => info.get(c.id).level !== 'ok')
    .sort((a, b) => {
      const A = info.get(a.id), B = info.get(b.id);
      return levelRank[A.level] - levelRank[B.level] || A.sortKey - B.sortKey;
    });
  const levelColor = { past: rgb(0.75, 0, 0), high: rgb(0.75, 0, 0), soon: rgb(0.8, 0.45, 0), ok: rgb(0.3, 0.3, 0.3) };
  const levelTag = { past: 'PAST DUE', high: 'HIGH', soon: 'SOON', ok: '' };
  const label = `Inventory — All Open Cases as of ${new Date().toLocaleDateString('en-US')}`;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const left = 60;
  const top = 730;
  const bottom = 60;

  let page = doc.addPage([612, 792]);
  let y = top;
  page.drawText(label, { x: left, y, size: 16, font: bold });
  y -= 30;

  if (!openCases.length) {
    page.drawText('No open cases right now.', { x: left, y, size: 11, font });
  } else {
    page.drawText(
      `${openCases.length} open case${openCases.length === 1 ? '' : 's'} across ${weekKeys.length} week${weekKeys.length === 1 ? '' : 's'}`,
      { x: left, y, size: 11, font }
    );
    y -= 24;
  }

  // ---- Priority block: what to chase first (court dates + expirations) ----
  if (needsAttention.length) {
    page.drawText(`Needs attention first — ${needsAttention.length}`, { x: left, y, size: 13, font: bold, color: rgb(0.75, 0, 0) });
    y -= 6;
    page.drawLine({ start: { x: left, y }, end: { x: 552, y }, thickness: 0.5, color: rgb(0.75, 0, 0) });
    y -= 18;
    needsAttention.forEach((c) => {
      if (y - 44 < bottom) {
        page = doc.addPage([612, 792]);
        y = top;
      }
      const a = info.get(c.id);
      const tag = `[${levelTag[a.level]}]`;
      const tagW = bold.widthOfTextAtSize(tag, 11);
      page.drawText(tag, { x: left, y, size: 11, font: bold, color: levelColor[a.level] });
      page.drawText(`${c.plaintiff || 'Unknown Plaintiff'} v. ${c.defendant || 'Unknown Defendant'}`, { x: left + tagW + 8, y, size: 11, font: bold });
      y -= 14;
      page.drawText(`Case No. ${c.caseNo || 'N/A'}   Attorney: ${c.attorney || ''}   —   ${a.reasons.join('; ')}`, {
        x: left + 14, y, size: 10, font, color: levelColor[a.level]
      });
      y -= 18;
    });
    y -= 10;
    page.drawText('All open cases, by week received', { x: left, y, size: 13, font: bold });
    y -= 22;
  }

  let n = 0;

  weekKeys.forEach((key) => {
    const group = byWeek.get(key).slice().sort((a, b) =>
      String(a.intakeDate || '').localeCompare(String(b.intakeDate || '')) ||
      String(a.caseNo || '').localeCompare(String(b.caseNo || ''))
    );

    // Keep a week heading from being stranded at the bottom of a page.
    if (y - 30 - 64 < bottom) {
      page = doc.addPage([612, 792]);
      y = top;
    }
    page.drawText(`${weekHeading(key)} — ${group.length} open`, { x: left, y, size: 13, font: bold });
    y -= 6;
    page.drawLine({ start: { x: left, y }, end: { x: 552, y }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
    y -= 18;

    group.forEach((c) => {
      const a = info.get(c.id);
      const dateBits = [];
      if (a.courtDate) dateBits.push(`Court: ${pretty(a.courtDate)}`);
      if (a.expiresOn) dateBits.push(`Expires: ${pretty(a.expiresOn)}${a.estimated ? ' (est.)' : ''}`);
      const entryHeight = 16 + 14 + 14 + (dateBits.length ? 14 : 0) + 20;
      if (y - entryHeight < bottom) {
        page = doc.addPage([612, 792]);
        y = top;
      }
      n += 1;

      const style = `${c.plaintiff || 'Unknown Plaintiff'} v. ${c.defendant || 'Unknown Defendant'}`;

      let defendantNote = '';
      if (Array.isArray(c.defendants) && c.defendants.length > 1) {
        const outstanding = c.defendants.filter((d) => !d.served).map((d) => d.name);
        if (outstanding.length) defendantNote = `Outstanding: ${outstanding.join(', ')}`;
      }
      const returnNote = c.returnSent
        ? `Return sent${c.returnDate ? ' ' + c.returnDate : ''} — affidavit still pending`
        : '';

      page.drawText(`${n}. ${style}`, { x: left, y, size: 12, font: bold });
      y -= 16;
      page.drawText(
        `Case No. ${c.caseNo || 'N/A'}   Attorney: ${c.attorney || ''}${c.caseType ? '   Type: ' + c.caseType : ''}`,
        { x: left + 14, y, size: 10, font }
      );
      y -= 14;
      if (defendantNote || returnNote) {
        page.drawText([defendantNote, returnNote].filter(Boolean).join('   |   '), {
          x: left + 14,
          y,
          size: 10,
          font,
          color: rgb(0.3, 0.3, 0.3)
        });
        y -= 14;
      }
      if (dateBits.length) {
        page.drawText(dateBits.join('   |   ') + (levelTag[a.level] ? `   —   ${levelTag[a.level]}` : ''), {
          x: left + 14, y, size: 10, font: a.level === 'ok' ? font : bold, color: levelColor[a.level]
        });
        y -= 14;
      }
      y -= 6;
    });
    y -= 8;
  });

  return { pdfDoc: doc, openCount: openCases.length };
}

module.exports = { buildInventoryPdf };
