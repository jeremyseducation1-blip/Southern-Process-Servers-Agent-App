const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { listAllCases } = require('./caseStore');
const { billingDate } = require('./billingDate');

// Flat rate, billed ONCE PER CASE NUMBER -- not per defendant. If a case
// has 2 or 3 defendants and each gets served separately (even across
// different weeks), that's still a single $60 charge for the case,
// triggered by whichever defendant was served FIRST. Anything served
// later on the same case number shows up as a record, not a second charge.
const RATE_PER_CASE = 60;

// Same Monday-of-week grouping used elsewhere in the app.
function mondayOfWeek(dateStr) {
  // Parse YYYY-MM-DD as LOCAL calendar date parts (not a UTC timestamp --
  // see the matching comment in public/js/app.js) so this always buckets
  // the same way the browser does, regardless of server timezone.
  const [y, m, day0] = dateStr.split('-').map(Number);
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

function formatMoney(n) {
  return `$${n.toFixed(2)}`;
}

// Attorney last name only, per Kevin's invoice format -- "Scott Weiss"
// becomes "Weiss".
function attorneyLastName(attorney) {
  const parts = (attorney || '').trim().split(/\s+/);
  return parts[parts.length - 1] || '';
}

// Builds the invoice PDF for one week. Returns { pdfBuffer, billableCount,
// total, weekLabel } so callers can both attach the PDF and log a record
// of what went out without re-deriving the numbers separately.
//
// Billable = anything COMPLETED (a return outcome recorded), regardless
// of which outcome -- Served, Return Not Found, and Return Requested per
// Plaintiff all count the same for billing. Per Kevin: everything
// completed that week gets billed, not just successful service.
async function buildWeekInvoicePdf(weekKey) {
  const allCases = await listAllCases();

  const firstCompletedDateByCase = new Map();
  allCases.forEach((c) => {
    const bd = billingDate(c);
    if (!bd || !c.caseNo) return;
    const existing = firstCompletedDateByCase.get(c.caseNo);
    if (!existing || bd < existing) {
      firstCompletedDateByCase.set(c.caseNo, bd);
    }
  });

  const returnedThisWeek = allCases.filter((c) => {
    const bd = billingDate(c);
    if (!bd) return false;
    return mondayOfWeek(bd).toISOString().slice(0, 10) === weekKey;
  });

  const seenBilledCaseNo = new Set();
  const billable = [];
  const notBillable = [];

  returnedThisWeek
    .slice()
    .sort((a, b) => new Date(billingDate(a)) - new Date(billingDate(b)))
    .forEach((c) => {
      const firstDate = firstCompletedDateByCase.get(c.caseNo);
      const isFirstForCase = firstDate === billingDate(c) && !seenBilledCaseNo.has(c.caseNo);
      if (isFirstForCase) {
        seenBilledCaseNo.add(c.caseNo);
        billable.push(c);
      } else {
        // The only thing that's ever NOT billable now: a later defendant
        // on a case number that was already billed this week or earlier.
        notBillable.push({ c, reason: 'Already billed for this case' });
      }
    });

  const total = billable.length * RATE_PER_CASE;

  const monday = new Date(weekKey + 'T00:00:00');
  const weekLabel = formatWeekLabel(monday);
  const label = `Weekly Invoice — ${weekLabel}`;

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

  function drawCaseLine(c, feeText, feeIsBold, showOutcome) {
    const style = `${c.plaintiff || 'Unknown Plaintiff'} v. ${c.defendant || 'Unknown Defendant'}`;
    ensureRoom(16 + 14 + 8);
    page.drawText(style, { x: left, y, size: 12, font: bold });
    const feeFont = feeIsBold ? bold : font;
    const feeWidth = feeFont.widthOfTextAtSize(feeText, 12);
    page.drawText(feeText, { x: right - feeWidth, y, size: 12, font: feeFont, color: feeIsBold ? rgb(0, 0, 0) : rgb(0.4, 0.4, 0.4) });
    y -= 16;
    const outcome = c.returnOutcome || 'Served';
    const outcomeSuffix = showOutcome && outcome !== 'Served' ? `   (${outcome})` : '';
    page.drawText(`Case No. ${c.caseNo || 'N/A'}   Attorney: ${attorneyLastName(c.attorney)}${outcomeSuffix}`, {
      x: left + 14, y, size: 10, font, color: rgb(0.3, 0.3, 0.3)
    });
    y -= 22;
  }

  if (!billable.length) {
    page.drawText('Nothing completed this week.', { x: left, y, size: 11, font });
    y -= 22;
  } else {
    billable.forEach((c) => drawCaseLine(c, formatMoney(RATE_PER_CASE), true, true));
  }

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

  if (notBillable.length) {
    ensureRoom(30);
    page.drawText('Not billable (for the record only):', { x: left, y, size: 11, font: bold, color: rgb(0.4, 0.4, 0.4) });
    y -= 20;
    notBillable.forEach(({ c, reason }) => drawCaseLine(c, reason, false));
  }

  const pdfBytes = await doc.save();
  return {
    pdfBuffer: Buffer.from(pdfBytes),
    billableCount: billable.length,
    total,
    weekLabel
  };
}

module.exports = { buildWeekInvoicePdf, mondayOfWeek, formatWeekLabel, formatMoney };
