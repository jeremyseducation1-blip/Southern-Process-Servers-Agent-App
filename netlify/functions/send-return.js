const { sendGmail } = require('./lib/sendGmail');
const { getCase, putCase } = require('./lib/caseStore');
const { uploadReturnPdf } = require('./lib/returnStorage');
const { todayCentral } = require('./lib/billingDate');

const KEVIN_EMAIL = process.env.KEVIN_EMAIL || 'kevin@example.com';

function attorneyLastName(attorney) {
  const parts = (attorney || '').trim().split(/\s+/);
  return parts[parts.length - 1] || '';
}

// Subject, every time: "<all defendants, first + last> / <attorney last name>"
function buildSubject(c) {
  const names = Array.isArray(c.defendants) && c.defendants.length
    ? c.defendants.map((d) => d.name).filter(Boolean)
    : [c.defendant].filter(Boolean);
  const last = attorneyLastName(c.attorney);
  return `${names.join(', ')}${last ? ' / ' + last : ''}`;
}

// Emails the scanned return to Kevin, and ONLY IF that send succeeds,
// attaches it to the case and marks it returned. The email goes first on
// purpose: if Gmail fails (expired token, etc.) nothing gets marked, so a
// case can never show "returned" without Kevin actually having the paper.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { id, returnPdfBase64, returnDate, servedDefendants, returnOutcome, returnNotes } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: 'id is required.' };
    if (!returnPdfBase64) return { statusCode: 400, body: 'Missing return PDF.' };

    const existing = await getCase(id);
    if (!existing) return { statusCode: 404, body: 'No case found with that id.' };

    const effectiveReturnDate = returnDate || new Date().toISOString().slice(0, 10);
    const outcome = returnOutcome || 'Served';
    const subject = buildSubject(existing);
    const notes = (returnNotes || '').trim();

    // Anything other than a plain "Served" return (e.g. not found) has to
    // carry the server's notes -- Kevin needs them in the email.
    if (outcome !== 'Served' && !notes) {
      return { statusCode: 400, body: 'Notes are required for a ' + outcome + ' return.' };
    }

    // 1) Send to Kevin. Throws on failure -> caught below, nothing marked.
    try {
      await sendGmail({
        to: KEVIN_EMAIL,
        subject,
        text:
          `Return attached for ${existing.caseNo || 'this case'}.\n\n` +
          `Outcome: ${outcome}\n` +
          `Return date: ${effectiveReturnDate}\n` +
          (notes ? `\nNotes:\n${notes}\n` : ''),
        attachments: [
          {
            filename: `return-${(existing.caseNo || 'case').replace(/[^a-z0-9_-]/gi, '_')}.pdf`,
            mimeType: 'application/pdf',
            base64: returnPdfBase64
          }
        ]
      });
    } catch (mailErr) {
      console.error('Gmail send failed:', mailErr);
      return { statusCode: 502, body: 'EMAIL_FAILED: ' + (mailErr.message || 'Gmail send failed') };
    }

    // 2) Email is out -- store the PDF and mark returned.
    let returnPdfPath = null;
    try {
      returnPdfPath = await uploadReturnPdf(id, Buffer.from(returnPdfBase64, 'base64'));
    } catch (storageErr) {
      // Email already went to Kevin; don't fail the whole thing over the
      // archive copy -- still mark returned, just without a stored PDF.
      console.error('Failed to store return PDF (email already sent):', storageErr);
    }

    const coveredNames = Array.isArray(servedDefendants) && servedDefendants.length
      ? servedDefendants
      : (existing.defendants || []).map((d) => d.name);

    if (Array.isArray(existing.defendants)) {
      existing.defendants = existing.defendants.map((d) =>
        coveredNames.includes(d.name)
          ? { ...d, served: true, returnDate: effectiveReturnDate, returnPdfPath }
          : d
      );
    }
    existing.returns = Array.isArray(existing.returns) ? existing.returns : [];
    existing.returns.push({ defendants: coveredNames, date: effectiveReturnDate, pdfPath: returnPdfPath, outcome, notes, emailedToKevin: true });

    existing.returnSent = true;
    existing.returnDate = effectiveReturnDate;
    existing.completedDate = todayCentral(); // day entered in the app -- what the invoice week is based on
    existing.returnPdfPath = returnPdfPath;
    existing.returnNotes = notes;
    existing.returnOutcome = outcome;

    const allServed =
      !Array.isArray(existing.defendants) ||
      existing.defendants.length === 0 ||
      existing.defendants.every((d) => d.served);
    if (allServed) {
      existing.status = 'closed';
      existing.closedDate = new Date().toISOString();
    }

    await putCase(existing);

    return { statusCode: 200, body: JSON.stringify({ sent: true, subject, case: existing }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to send return' };
  }
};
