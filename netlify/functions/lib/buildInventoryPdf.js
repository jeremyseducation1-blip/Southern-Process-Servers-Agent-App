const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { listOpenCases } = require('./caseStore');

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

  const entryHeight = 16 + 14 + 14 + 20;
  let n = 0;

  weekKeys.forEach((key) => {
    const group = byWeek.get(key).slice().sort((a, b) =>
      String(a.intakeDate || '').localeCompare(String(b.intakeDate || '')) ||
      String(a.caseNo || '').localeCompare(String(b.caseNo || ''))
    );

    // Keep a week heading from being stranded at the bottom of a page.
    if (y - 30 - entryHeight < bottom) {
      page = doc.addPage([612, 792]);
      y = top;
    }
    page.drawText(`${weekHeading(key)} — ${group.length} open`, { x: left, y, size: 13, font: bold });
    y -= 6;
    page.drawLine({ start: { x: left, y }, end: { x: 552, y }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
    y -= 18;

    group.forEach((c) => {
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
      y -= 6;
    });
    y -= 8;
  });

  return { pdfDoc: doc, openCount: openCases.length };
}

module.exports = { buildInventoryPdf };
