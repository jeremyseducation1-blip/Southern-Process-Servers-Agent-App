const { buildAffidavitPdf } = require('./lib/buildAffidavitPdf');
const { sendGmail } = require('./lib/sendGmail');
const { getCase, putCase, makePaperId, getActivePaperByCaseAndDefendant } = require('./lib/caseStore');
const { uploadReturnPdf, uploadAffidavitPdf } = require('./lib/returnStorage');

const KEVIN_EMAIL = process.env.KEVIN_EMAIL || 'kevin@example.com';

// Server-side re-check of the trigger conditions. The client already
// gates the UI on these, but a function that can be hit directly
// shouldn't trust the client alone.
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
    const {
      caseInfo,
      attempts,
      status,
      signatureDataUrl,
      serverInfo,
      returnPdfBase64,
      returnDate,
      servedDefendants
    } = JSON.parse(event.body);
    const effectiveReturnDate = returnDate || new Date().toISOString().slice(0, 10);

    const validationError = validate({ attempts, status, signatureDataUrl });
    if (validationError) {
      return { statusCode: 400, body: validationError };
    }

    const pdfBuffer = await buildAffidavitPdf({
      caseInfo,
      attempts,
      status,
      signatureDataUrl,
      serverInfo
    });

    const attorney = caseInfo?.attorney || 'Scott Weiss';
    const subject = `Affidavit — ${caseInfo?.caseNo || 'no case #'} — ${caseInfo?.defendant || 'unknown defendant'} — ${attorney}`;
    const text =
      `Affidavit of non-service completed.\n\n` +
      `Case: ${caseInfo?.caseNo || ''}\n` +
      `Defendant: ${caseInfo?.defendant || ''}\n` +
      `Attorney: ${attorney}\n` +
      `Status: ${status}\n` +
      (returnPdfBase64
        ? `Return document is attached alongside the affidavit.\n`
        : `No return document was on file yet for this case — affidavit only.\n`);

    const attachments = [
      {
        filename: `affidavit-${caseInfo?.caseNo || 'case'}.pdf`,
        mimeType: 'application/pdf',
        base64: pdfBuffer.toString('base64')
      }
    ];

    // Bundle the return with the affidavit in the same email, per spec —
    // no separate follow-up send. Already a real PDF (Genius Scan export),
    // so it's attached directly, no conversion needed.
    if (returnPdfBase64) {
      attachments.push({
        filename: `return-${caseInfo?.caseNo || 'case'}.pdf`,
        mimeType: 'application/pdf',
        base64: returnPdfBase64
      });
    }

    await sendGmail({ to: KEVIN_EMAIL, subject, text, attachments });

    // Selecting a status is the completion event -- close the case out
    // so it drops off the Sunday inventory.
    if (caseInfo?.caseNo) {
      // Case numbers repeat -- find the currently-active paper for this
      // case number + defendant (handles a reissue correctly).
      const activeCase = await getActivePaperByCaseAndDefendant(caseInfo.caseNo, caseInfo.defendant);
      const id = activeCase ? activeCase.id : makePaperId(caseInfo.caseNo, caseInfo.defendant);

      // Save the actual PDFs to storage, attached to this case -- not
      // just "sent" flags, viewable later from Search Cases.
      let affidavitPdfPath = null;
      let returnPdfPath = null;
      try {
        affidavitPdfPath = await uploadAffidavitPdf(id, pdfBuffer);
      } catch (storageErr) {
        console.error('Failed to store affidavit PDF:', storageErr);
      }
      if (returnPdfBase64) {
        try {
          returnPdfPath = await uploadReturnPdf(id, Buffer.from(returnPdfBase64, 'base64'));
        } catch (storageErr) {
          console.error('Failed to store return PDF:', storageErr);
        }
      }

      const existing = activeCase || (await getCase(id));
      if (existing) {
        existing.affidavitSent = true;
        if (affidavitPdfPath) existing.affidavitPdfPath = affidavitPdfPath;
        if (returnPdfBase64) {
          const coveredNames = Array.isArray(servedDefendants) && servedDefendants.length
            ? servedDefendants
            : [existing.defendant].filter(Boolean);
          if (Array.isArray(existing.defendants)) {
            existing.defendants = existing.defendants.map((d) =>
              coveredNames.includes(d.name)
                ? { ...d, served: true, returnDate: effectiveReturnDate, returnPdfPath: returnPdfPath || d.returnPdfPath }
                : d
            );
          }
          existing.returns = Array.isArray(existing.returns) ? existing.returns : [];
          existing.returns.push({ defendants: coveredNames, date: effectiveReturnDate, pdfPath: returnPdfPath });

          existing.returnSent = true;
          existing.returnDate = effectiveReturnDate;
          if (returnPdfPath) existing.returnPdfPath = returnPdfPath;
        }
        // Selecting a status is the explicit completion event for
        // affidavit-tracked cases -- attempts/status are case-level, not
        // per-defendant, so this always closes the whole case, same as
        // before. Per-defendant served flags above still get recorded
        // accurately if a return was bundled in.
        existing.status = 'closed';
        existing.closedDate = new Date().toISOString();
        await putCase(existing);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Send failed' };
  }
};
