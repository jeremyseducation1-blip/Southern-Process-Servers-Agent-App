const { requireAuth } = require('./lib/auth');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { listAllCases } = require('./lib/caseStore');
const { wrapLines } = require('./lib/pdfText');

// Same Monday-of-week grouping logic as the front end -- kept in sync
// deliberately since this has to bucket cases the same way the list view
// on the page does.
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
  // Parse YYYY-MM-DD as LOCAL calendar date parts (not a UTC timestamp --
  // see the matching comment in public/js/app.js) so this always buckets
  // the same way the browser does, regardless of server timezone.
  const day0s = calendarDay(dateStr);
  if (!day0s) return new Date(NaN);
  const [y, m, day0] = day0s.split('-').map(Number);
  const d = new Date(y, m - 1, day0);
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

exports.handler = requireAuth(async (event) => {
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
      const mon = mondayOfWeek(c.intakeDate);
      if (isNaN(mon.getTime())) return false; // unreadable date -- leave it out rather than fail the whole PDF
      return mon.toISOString().slice(0, 10) === weekKey;
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

    const entryHeight = 16 + 14 + 22 + 28; // three drawText calls + gap, + room for a wrapped name

    casesThisWeek.forEach((c, i) => {
      // Start a fresh page if this entry won't fully fit -- no case gets
      // silently dropped just because the page ran out of room.
      if (y - entryHeight < bottom) {
        page = doc.addPage([612, 792]);
        y = top;
      }

      const style = `${c.plaintiff || 'Unknown Plaintiff'} v. ${c.defendant || 'Unknown Defendant'}`;
      const statusLabel = c.status === 'closed' ? (c.returnOutcome || 'Closed') : c.returnSent ? 'Returned — affidavit pending' : 'Open';
      // Green for closed/returned (regardless of the specific outcome),
      // red for still open -- easy to scan the PDF at a glance.
      const statusColor = c.status === 'closed' ? rgb(0.12, 0.45, 0.12) : rgb(0.6, 0.12, 0.12);

      const nameLines = wrapLines(`${i + 1}. ${style}`, bold, 12, 552 - left);
      nameLines.forEach((ln, k) => {
        page.drawText(ln, { x: left, y, size: 12, font: bold });
        y -= k === nameLines.length - 1 ? 16 : 14;
      });
      page.drawText(`Case No. ${c.caseNo || 'N/A'}   Attorney: ${c.attorney || ''}${c.caseType ? '   Type: ' + c.caseType : ''}`, { x: left + 14, y, size: 10, font });
      y -= 14;
      page.drawText(`Status: ${statusLabel}${c.returnDate ? '   Returned: ' + c.returnDate : ''}`, {
        x: left + 14,
        y,
        size: 10,
        font: bold,
        color: statusColor
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
});
