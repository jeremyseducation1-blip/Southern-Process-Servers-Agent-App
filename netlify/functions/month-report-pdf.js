const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { listAllCases } = require('./lib/caseStore');

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const monthKey = event.queryStringParameters?.month; // YYYY-MM
    if (!monthKey) {
      return { statusCode: 400, body: 'Missing "month" query parameter (YYYY-MM).' };
    }

    const allCases = await listAllCases();
    const openThisMonth = allCases
      .filter((c) => c.status !== 'closed')
      .filter((c) => c.intakeDate && c.intakeDate.slice(0, 7) === monthKey)
      .sort((a, b) => new Date(a.intakeDate) - new Date(b.intakeDate));

    const label = `Still Open — ${formatMonthLabel(monthKey)}`;

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

    if (!openThisMonth.length) {
      page.drawText('Nothing still open from this month.', { x: left, y, size: 11, font });
    }

    const entryHeight = 16 + 14 + 22;

    openThisMonth.forEach((c, i) => {
      if (y - entryHeight < bottom) {
        page = doc.addPage([612, 792]);
        y = top;
      }

      const style = `${c.plaintiff || 'Unknown Plaintiff'} v. ${c.defendant || 'Unknown Defendant'}`;
      const statusLabel = c.returnSent ? 'Returned — affidavit pending' : 'Open';
      const intake = c.intakeDate ? new Date(c.intakeDate).toLocaleDateString('en-US') : '';

      page.drawText(`${i + 1}. ${style}`, { x: left, y, size: 12, font: bold });
      y -= 16;
      page.drawText(
        `Case No. ${c.caseNo || 'N/A'}   Attorney: ${c.attorney || ''}${c.caseType ? '   Type: ' + c.caseType : ''}`,
        { x: left + 14, y, size: 10, font }
      );
      y -= 14;
      page.drawText(`Status: ${statusLabel}   Logged: ${intake}`, {
        x: left + 14,
        y,
        size: 10,
        font,
        color: rgb(0.3, 0.3, 0.3)
      });
      y -= 22;
    });

    const pdfBytes = await doc.save();
    return {
      statusCode: 200,
      body: JSON.stringify({ pdfBase64: Buffer.from(pdfBytes).toString('base64') })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to build monthly report' };
  }
};
