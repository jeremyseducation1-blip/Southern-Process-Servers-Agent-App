const { buildWeekInvoicePdf } = require('./lib/buildWeekInvoicePdf');
const { saveInvoiceRecord } = require('./lib/invoiceStore');

// On-demand invoice generation (the "Load weeks" -> tap a week button).
// Uses the same builder as the automatic Friday email, and logs itself
// the same way, so every invoice -- generated on demand or automatically
// -- ends up in "My Invoices" / Kevin's view either way.
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const weekKey = event.queryStringParameters?.week; // YYYY-MM-DD, the Monday
    if (!weekKey) {
      return { statusCode: 400, body: 'Missing "week" query parameter (YYYY-MM-DD).' };
    }

    const { pdfBuffer, billableCount, total, weekLabel } = await buildWeekInvoicePdf(weekKey);

    try {
      await saveInvoiceRecord({ weekKey, weekLabel, billableCount, total, pdfBuffer });
    } catch (logErr) {
      // Don't fail the download over a logging hiccup -- Jeremy still
      // gets the PDF either way, it just might not show up in "My
      // Invoices" until the next successful generation.
      console.error('Failed to log invoice record:', logErr);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ pdfBase64: pdfBuffer.toString('base64') })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to build weekly invoice' };
  }
};
