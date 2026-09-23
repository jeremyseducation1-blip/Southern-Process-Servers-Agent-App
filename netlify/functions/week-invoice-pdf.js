const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { listAllCases } = require('./lib/caseStore');

// Flat rate, billed ONCE PER CASE NUMBER -- not per defendant. If a case
// has 2 or 3 defendants and each gets served separately (even across
// different weeks), that's still a single $60 charge for the case,
// triggered by whichever defendant was served FIRST. Anything served
// later on the same case number shows up as a record, not a second charge.
const RATE_PER_CASE = 60;

// Same Monday-of-week grouping used elsewhere in the app.
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

function formatMoney(n) {
  return `$${n.toFixed(2)}`;
}

// Attorney last name only, per Kevin's invoice format -- "Scott Weiss"
// becomes "Weiss".
function attorneyLastName(attorney) {
  const parts = (attorney || '').trim().split(/\s+/);
  return parts[parts.length - 1] || '';
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

    // Figure out, for every case number, the earliest date any defendant
    // on it was actually served -- that's the one date the $60 charge is
    // pinned to, regardless of which week we're building an invoice for.
    const firstServedDateByCase = new Map();
    allCases.forEach((c) => {
      if ((c.returnOutcome || 'Served') !== 'Served' || !c.returnDate || !c.caseNo) return;
      const existing = firstServedDateByCase.get(c.caseNo);
      if (!existing || c.returnDate < existing) {
        firstServedDateByCase.set(c.caseNo, c.returnDate);
      }
    });

    // This is about when the paper was actually returned, not when it was
    // originally received -- a case logged in August that gets served
    // this week still belongs on THIS week's invoice.
    const returnedThisWeek = allCases.filter((c) => {
      if (!c.returnDate) return false;
      return mondayOfWeek(c.returnDate).toISOString().slice(0, 10) === weekKey;
    });

    // Split into billable (first-served-this-week for that case number)
    // and everything else (not served, or a later defendant on a case
    // that was already billed earlier).
    const seenBilledCaseNo = new Set(); // guards against 2 defendants served same day on the same case
    const billable = [];
    const notBillable = [];

    returnedThisWeek
      .slice()
      .sort((a, b) => new Date(a.returnDate) - new Date(b.returnDate))
      .forEach((c) => {
        const outcome = c.returnOutcome || 'Served';
        if (outcome !== 'Served') {
          notBillable.push({ c, reason: outcome });
          return;
        }
        const firstDate = firstServedDateByCase.get(c.caseNo);
        const isFirstForCase = firstDate === c.returnDate && !seenBilledCaseNo.has(c.caseNo);
        if (isFirstForCase) {
          seenBilledCaseNo.add(c.caseNo);
          billable.push(c);
        } else {
          notBillable.push({ c, reason: 'Already billed for this case' });
        }
      });

    const total = billable.length * RATE_PER_CASE;

    const monday = new Date(weekKey + 'T00:00:00');
    const label = `Weekly Invoice — ${formatWeekLabel(monday)}`;

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
    const left = 60;
    const right = 552;
    const top = 730;
    const bottom = 60;

    let page = doc.addPage([612, 792]);
    let y = top;
    page.drawText(label, { x: left, y, size: 16, font: bold });
    y -= 26;

    function ensureRoom(height) {
      if (y - height < bottom) {
        page = doc.addPage([612, 792]);
        y = top;
      }
    }

    function drawCaseLine(c, feeText, feeIsBold) {
      const style = `${c.plaintiff || 'Unknown Plaintiff'} v. ${c.defendant || 'Unknown Defendant'}`;
      ensureRoom(16 + 14 + 8);
      page.drawText(style, { x: left, y, size: 12, font: bold });
      const feeFont = feeIsBold ? bold : font;
      const feeWidth = feeFont.widthOfTextAtSize(feeText, 12);
      page.drawText(feeText, { x: right - feeWidth, y, size: 12, font: feeFont, color: feeIsBold ? rgb(0, 0, 0) : rgb(0.4, 0.4, 0.4) });
      y -= 16;
      page.drawText(`Case No. ${c.caseNo || 'N/A'}   Attorney: ${attorneyLastName(c.attorney)}`, {
        x: left + 14, y, size: 10, font, color: rgb(0.3, 0.3, 0.3)
      });
      y -= 22;
    }

    if (!billable.length) {
      page.drawText('Nothing served this week.', { x: left, y, size: 11, font });
      y -= 22;
    } else {
      billable.forEach((c) => drawCaseLine(c, formatMoney(RATE_PER_CASE), true));
    }

    // Total, right under the billable list.
    ensureRoom(50);
    y -= 6;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: rgb(0, 0, 0) });
    y -= 20;
    const summaryText = `${billable.length} case${billable.length === 1 ? '' : 's'} @ ${formatMoney(RATE_PER_CASE)}`;
    const totalText = formatMoney(total);
    page.drawText(summaryText, { x: left, y, size: 12, font });
    const totalLabel = 'Total: ';
    const totalLabelWidth = bold.widthOfTextAtSize(totalLabel, 14);
    const totalWidth = bold.widthOfTextAtSize(totalText, 14);
    page.drawText(totalLabel, { x: right - totalLabelWidth - totalWidth, y, size: 14, font: bold });
    page.drawText(totalText, { x: right - totalWidth, y, size: 14, font: bold });
    y -= 36;

    // Not-billable items go underneath everything billable, for the
    // record only -- not mixed in with the actual invoice lines above.
    if (notBillable.length) {
      ensureRoom(30);
      page.drawText('Not billable (for the record only):', { x: left, y, size: 11, font: bold, color: rgb(0.4, 0.4, 0.4) });
      y -= 20;
      notBillable.forEach(({ c, reason }) => drawCaseLine(c, reason, false));
    }

    const pdfBytes = await doc.save();
    return {
      statusCode: 200,
      body: JSON.stringify({ pdfBase64: Buffer.from(pdfBytes).toString('base64') })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to build weekly invoice' };
  }
};
