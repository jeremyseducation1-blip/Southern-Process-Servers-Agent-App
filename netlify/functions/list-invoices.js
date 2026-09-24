const { listInvoices } = require('./lib/invoiceStore');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const invoices = await listInvoices();
    return { statusCode: 200, body: JSON.stringify({ invoices }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to list invoices' };
  }
};
