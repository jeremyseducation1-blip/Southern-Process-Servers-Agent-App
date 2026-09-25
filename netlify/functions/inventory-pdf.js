const { buildInventoryPdf } = require('./lib/buildInventoryPdf');

// On-demand twin of weekly-inventory.js's automatic Sunday email -- same
// builder, generated as a downloadable PDF right now, whenever it's
// tapped, no email involved.
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { pdfDoc } = await buildInventoryPdf();
    const pdfBytes = await pdfDoc.save();
    return {
      statusCode: 200,
      body: JSON.stringify({ pdfBase64: Buffer.from(pdfBytes).toString('base64') })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to build inventory' };
  }
};
