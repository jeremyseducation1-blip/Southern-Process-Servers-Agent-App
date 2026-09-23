const { getCase } = require('./lib/caseStore');
const { getAttemptPhotoUrl } = require('./lib/returnStorage');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const id = event.queryStringParameters?.id;
    const attemptNumber = parseInt(event.queryStringParameters?.attempt, 10);
    if (!id) return { statusCode: 400, body: 'id is required.' };
    if (![1, 2, 3].includes(attemptNumber)) return { statusCode: 400, body: 'attempt must be 1, 2, or 3.' };

    const caseRecord = await getCase(id);
    if (!caseRecord) return { statusCode: 404, body: 'No case found with that id.' };

    const attempt = (caseRecord.attempts || []).find((a) => a.n === attemptNumber);
    if (!attempt || !attempt.photoPath) {
      return { statusCode: 404, body: 'No photo on file for that attempt.' };
    }

    const url = await getAttemptPhotoUrl(attempt.photoPath);

    return { statusCode: 200, body: JSON.stringify({ url, timestamp: attempt.photoTimestamp }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message || 'Failed to get photo' };
  }
};
