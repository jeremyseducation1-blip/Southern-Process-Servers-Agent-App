const { schedule } = require('@netlify/functions');
const { buildWeekInvoicePdf, mondayOfWeek } = require('./lib/buildWeekInvoicePdf');
const { saveInvoiceRecord } = require('./lib/invoiceStore');
const { sendGmail } = require('./lib/sendGmail');

const KEVIN_EMAIL = process.env.KEVIN_EMAIL || 'kevin@example.com';

// Runs every Friday at 2:00 PM Central time -- Kevin does payroll ACH
// that afternoon and wants the invoice before then. Since this fires
// Friday afternoon (before the work week is technically over), whatever
// gets served later Friday evening or over the weekend naturally lands
// on the FOLLOWING week's invoice instead -- the week key is computed
// from "today" at run time, so it only ever covers what's already been
// served as of this moment.
//
// Netlify's scheduled functions use UTC cron, with no DST awareness, so
// this has to be manually flipped twice a year:
//   - CDT (roughly mid-March -- early November): use 19:00 UTC for 2pm Central
//   - CST (roughly early November -- mid-March): use 20:00 UTC for 2pm Central
// Right now (as of this deploy) it's set to 19:00 UTC, which lands at
// 2:00 PM CDT. See README for the toggle note.
const handler = async () => {
  const today = new Date().toISOString().slice(0, 10);
  const weekKey = mondayOfWeek(today).toISOString().slice(0, 10);

  const { pdfBuffer, billableCount, total, weekLabel } = await buildWeekInvoicePdf(weekKey);

  // Log it first -- even if the email send hiccups, the invoice still
  // exists and is viewable in "My Invoices" / Kevin's view.
  await saveInvoiceRecord({ weekKey, weekLabel, billableCount, total, pdfBuffer });

  const text =
    `Invoice for ${weekLabel}.\n\n` +
    `${billableCount} case${billableCount === 1 ? '' : 's'} served, total $${total.toFixed(2)}.\n\n` +
    `Note: this covers cases served through today. Anything served later ` +
    `today or over the weekend will be on next week's invoice.`;

  await sendGmail({
    to: KEVIN_EMAIL,
    subject: `Weekly Invoice — ${weekLabel}`,
    text,
    attachments: [
      {
        filename: `invoice-${weekKey}.pdf`,
        mimeType: 'application/pdf',
        base64: pdfBuffer.toString('base64')
      }
    ]
  });

  return { statusCode: 200, body: 'Invoice sent' };
};

exports.handler = schedule('0 19 * * 5', handler);
