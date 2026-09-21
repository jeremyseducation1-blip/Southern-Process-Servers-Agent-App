const { buildAffidavitPdf } = require('./lib/buildAffidavitPdf');

// Same validation as complete-affidavit -- a preview should only be
// buildable once the form is actually in a valid, completable state.
function validate({ attempts, status, signatureDataUrl }) {
  if (!Array.isArray(attempts) || attempts.length !== 3) {
    return 'All three attempts are required.';
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const a of attempts) {
    if (!a.date || !a.note) return `Attempt ${a.n} is missing a date or note.`;
    if (a.date > today) return `Attempt ${a.n} date is in the future.`;
  }
  if (!status) return 'Status is required.';
  if (!signatureDataUrl) return 'Signature is required.';
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { caseInfo, attempts, status, signatureDataUrl, serverInfo } = JSON.parse(event.body);

    const validationError = validate({ attempts, status, signatureDataUrl });
    if (validationError) {
      return { statusCode: 400, body: validationError };
    }

    const pdfBuffer = await buildAffidavitPdf({ caseInfo, attempts, status, signatureDataUrl, serverInfo });

    return {
      statusCode: 200,
      body: JSON.stringify({ pdfBase64: pdfBuffer.toString('base64') })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Preview failed' };
  }
};
