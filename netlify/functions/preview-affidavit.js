const { buildAffidavitPdf } = require('./lib/buildAffidavitPdf');

// Same validation as complete-affidavit -- a preview should only be
// buildable once the form is actually in a valid, completable state.
function validate({ attempts, status, signatureDataUrl, fewerAttemptsOverride }) {
  if (!Array.isArray(attempts)) {
    return 'Attempts data is missing.';
  }
  // Normally all 3 are required (that is what makes an Affidavit of
  // Non-Service valid). Jeremy can override this when he already has
  // enough information to know service won'''t happen -- e.g. he learns
  // immediately the address is invalid -- rather than forcing 3 separate
  // logged attempts first. Whatever attempts DO exist still have to be
  // valid; the override only relaxes the count, not the data quality.
  if (!fewerAttemptsOverride && attempts.length !== 3) {
    return 'All three attempts are required (or check the override if you already have enough information to proceed with fewer).';
  }
  if (fewerAttemptsOverride && attempts.length === 0) {
    return 'At least one attempt is required, even with the override.';
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
    const { caseInfo, attempts, status, signatureDataUrl, serverInfo, fewerAttemptsOverride } = JSON.parse(event.body);

    const validationError = validate({ attempts, status, signatureDataUrl, fewerAttemptsOverride });
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
