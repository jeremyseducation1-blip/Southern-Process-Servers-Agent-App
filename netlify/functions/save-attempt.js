const { getCase, putCase, makePaperId, getActivePaperByCaseAndDefendant } = require('./lib/caseStore');
const { uploadAttemptPhoto } = require('./lib/returnStorage');

// Persists one attempt to the case record -- this is real evidence
// (a photo of the yellow notice, with a timestamp), not just text typed
// into a form right before generating the affidavit. Saved immediately
// when the photo's taken, so it's on record even if the case never gets
// as far as a completed affidavit.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { caseInfo, attemptNumber, date, note, photoDataUrl } = JSON.parse(event.body || '{}');

    if (!caseInfo?.caseNo) return { statusCode: 400, body: 'Missing case number.' };
    if (![1, 2, 3].includes(attemptNumber)) return { statusCode: 400, body: 'attemptNumber must be 1, 2, or 3.' };

    const activeCase = await getActivePaperByCaseAndDefendant(caseInfo.caseNo, caseInfo.defendant);
    const id = activeCase ? activeCase.id : makePaperId(caseInfo.caseNo, caseInfo.defendant);
    const existing = activeCase || (await getCase(id));
    if (!existing) return { statusCode: 404, body: 'Log intake for this case first.' };

    let photoPath = null;
    let photoTimestamp = null;
    if (photoDataUrl) {
      const match = photoDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) return { statusCode: 400, body: 'Malformed photo data.' };
      const [, mimeType, base64] = match;
      // Server-stamped timestamp, not just whatever the phone's clock
      // says -- this is the actual point of the photo: independent proof
      // of when the attempt happened, not just Jeremy's word for it.
      photoTimestamp = new Date().toISOString();
      photoPath = await uploadAttemptPhoto(id, attemptNumber, Buffer.from(base64, 'base64'), mimeType);
    }

    existing.attempts = Array.isArray(existing.attempts) ? existing.attempts : [];
    const idx = existing.attempts.findIndex((a) => a.n === attemptNumber);
    const entry = {
      n: attemptNumber,
      date: date || (idx >= 0 ? existing.attempts[idx].date : null),
      note: note || (idx >= 0 ? existing.attempts[idx].note : ''),
      photoPath: photoPath || (idx >= 0 ? existing.attempts[idx].photoPath : null),
      photoTimestamp: photoTimestamp || (idx >= 0 ? existing.attempts[idx].photoTimestamp : null)
    };
    if (idx >= 0) {
      existing.attempts[idx] = entry;
    } else {
      existing.attempts.push(entry);
    }

    await putCase(existing);

    return { statusCode: 200, body: JSON.stringify({ saved: true, attempt: entry }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to save attempt' };
  }
};
