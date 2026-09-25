const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { listOpenCases } = require('./caseStore');

// Builds the inventory PDF (every case still open, right now). Returns
// { pdfDoc, openCount } -- pdfDoc is left un-saved (as a PDFDocument, not
// bytes) so callers can merge its pages into a combined document if
// needed, instead of always producing a standalone file.
async function buildInventoryPdf() {
  const openCases = await listOpenCases();
  const label = `Inventory — Open Cases as of ${new Date().toLocaleDateString('en-US')}`;

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
  }

  const entryHeight = 16 + 14 + 14 + 20;

  openCases.forEach((c, i) => {
    if (y - entryHeight < bottom) {
      page = doc.addPage([612, 792]);
      y = top;
    }

    const style = `${c.plaintiff || 'Unknown Plaintiff'} v. ${c.defendant || 'Unknown Defendant'}`;

    let defendantNote = '';
    if (Array.isArray(c.defendants) && c.defendants.length > 1) {
      const outstanding = c.defendants.filter((d) => !d.served).map((d) => d.name);
      if (outstanding.length) defendantNote = `Outstanding: ${outstanding.join(', ')}`;
    }
    const returnNote = c.returnSent
      ? `Return sent${c.returnDate ? ' ' + c.returnDate : ''} — affidavit still pending`
      : '';

    page.drawText(`${i + 1}. ${style}`, { x: left, y, size: 12, font: bold });
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

  return { pdfDoc: doc, openCount: openCases.length };
}

module.exports = { buildInventoryPdf };
