const { getInvoicePdfUrl } = require('./lib/invoiceStore');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const weekKey = event.queryStringParameters?.week;
    if (!weekKey) return { statusCode: 400, body: 'week is required.' };

    const url = await getInvoicePdfUrl(weekKey);
    return { statusCode: 200, body: JSON.stringify({ url }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to get invoice PDF' };
  }
};
