const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { listAllCases } = require('./lib/caseStore');

// Same Monday-of-week grouping logic as the front end -- kept in sync
// deliberately since this has to bucket cases the same way the list view
// on the page does.
function mondayOfWeek(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatWeekLabel(monday) {
  const opts = { month: 'long', day: 'numeric', year: 'numeric' };
  return `Week of ${monday.toLocaleDateString('en-US', opts)}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const weekKey = event.queryStringParameters?.week; // YYYY-MM-DD, the Monday
    if (!weekKey) {
      return { statusCode: 400, body: 'Missing "week" query parameter (YYYY-MM-DD).' };
    }

    const allCases = await listAllCases();
    const casesThisWeek = allCases.filter((c) => {
      if (!c.intakeDate) return false;
      return mondayOfWeek(c.intakeDate).toISOString().slice(0, 10) === weekKey;
    });
    casesThisWeek.sort((a, b) => new Date(a.intakeDate) - new Date(b.intakeDate));

    const monday = new Date(weekKey + 'T00:00:00');
    const label = formatWeekLabel(monday);

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
    const left = 60;
    const top = 730;
    const bottom = 60; // once y drops below this, start a new page

    let page = doc.addPage([612, 792]);
    let y = top;
    page.drawText(label, { x: left, y, size: 16, font: bold });
    y -= 30;

    if (!casesThisWeek.length) {
      page.drawText('No cases logged this week.', { x: left, y, size: 11, font });
    }

    const entryHeight = 16 + 14 + 22; // matches the three drawText calls + gap below

    casesThisWeek.forEach((c, i) => {
      // Start a fresh page if this entry won't fully fit -- no case gets
      // silently dropped just because the page ran out of room.
      if (y - entryHeight < bottom) {
        page = doc.addPage([612, 792]);
        y = top;
      }

      const style = `${c.plaintiff || 'Unknown Plaintiff'} v. ${c.defendant || 'Unknown Defendant'}`;
      const statusLabel = c.status === 'closed' ? (c.returnOutcome || 'Closed') : c.returnSent ? 'Returned — affidavit pending' : 'Open';

      page.drawText(`${i + 1}. ${style}`, { x: left, y, size: 12, font: bold });
      y -= 16;
      page.drawText(`Case No. ${c.caseNo || 'N/A'}   Attorney: ${c.attorney || ''}${c.caseType ? '   Type: ' + c.caseType : ''}`, { x: left + 14, y, size: 10, font });
      y -= 14;
      page.drawText(`Status: ${statusLabel}${c.returnDate ? '   Returned: ' + c.returnDate : ''}`, {
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
    return { statusCode: 500, body: err.message || 'Failed to build week log PDF' };
  }
};
