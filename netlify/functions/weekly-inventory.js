const { schedule } = require('@netlify/functions');
const { PDFDocument } = require('pdf-lib');
const { buildWeekInvoicePdf, mondayOfWeek } = require('./lib/buildWeekInvoicePdf');
const { buildInventoryPdf } = require('./lib/buildInventoryPdf');
const { saveInvoiceRecord } = require('./lib/invoiceStore');
const { sendGmail } = require('./lib/sendGmail');

const KEVIN_EMAIL = process.env.KEVIN_EMAIL || 'kevin@example.com';

// Runs every Sunday at 8:00 AM Central time -- one email to Kevin with
// ONE combined PDF: the invoice for the week that just finished
// (Monday through Sunday morning), followed by the current open-case
// inventory. Kevin wants these together in a single document, not two
// separate emails.
//
// Netlify's scheduled functions use UTC cron, with no DST awareness, so
// this has to be manually flipped twice a year:
//   - CDT (roughly mid-March -- early November): use 13:00 UTC for 8am Central
//   - CST (roughly early November -- mid-March): use 14:00 UTC for 8am Central
// Right now (as of this deploy) it's set to 13:00 UTC, which lands at
// 8:00 AM CDT. See README for the toggle note.
const handler = async () => {
  const today = new Date().toISOString().slice(0, 10);
  // Running Sunday morning, mondayOfWeek(today) lands on the Monday that
  // started THIS week -- so this correctly covers the week that just
  // finished, not the one about to start.
  const weekKey = mondayOfWeek(today).toISOString().slice(0, 10);

  const { pdfBuffer: invoicePdfBuffer, billableCount, total, weekLabel } = await buildWeekInvoicePdf(weekKey);

  // Log the invoice the same way the on-demand button and the old Friday
  // email did -- "My Invoices" / Kevin's invoice history stays intact.
  await saveInvoiceRecord({ weekKey, weekLabel, billableCount, total, pdfBuffer: invoicePdfBuffer });

  const { pdfDoc: inventoryDoc, openCount } = await buildInventoryPdf();

  // Merge into one combined PDF: invoice pages first, then inventory.
  const combined = await PDFDocument.create();
  const invoiceDoc = await PDFDocument.load(invoicePdfBuffer);
  const invoicePages = await combined.copyPages(invoiceDoc, invoiceDoc.getPageIndices());
  invoicePages.forEach((p) => combined.addPage(p));
  const inventoryPages = await combined.copyPages(inventoryDoc, inventoryDoc.getPageIndices());
  inventoryPages.forEach((p) => combined.addPage(p));
  const combinedBytes = await combined.save();
  const combinedBuffer = Buffer.from(combinedBytes);

  const dateLabel = new Date().toLocaleDateString('en-US');
  const text =
    `Attached: invoice for ${weekLabel}, plus the current open-case inventory.\n\n` +
    `Invoice: ${billableCount} case${billableCount === 1 ? '' : 's'} served, total $${total.toFixed(2)}.\n` +
    `Inventory: ${openCount} case${openCount === 1 ? '' : 's'} currently open.`;

  await sendGmail({
    to: KEVIN_EMAIL,
    subject: `Weekly Invoice & Inventory — ${dateLabel}`,
    text,
    attachments: [
      {
        filename: `invoice-and-inventory-${weekKey}.pdf`,
        mimeType: 'application/pdf',
        base64: combinedBuffer.toString('base64')
      }
    ]
  });

  return { statusCode: 200, body: 'Invoice + inventory sent' };
};

exports.handler = schedule('0 13 * * 0', handler);
