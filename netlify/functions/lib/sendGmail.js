// Sends an email with attachments via the Gmail API, using a service
// account or OAuth refresh token stored in Netlify environment variables.
//
// Required env vars (set in Netlify UI, not committed):
//   GMAIL_CLIENT_ID
//   GMAIL_CLIENT_SECRET
//   GMAIL_REFRESH_TOKEN
//   GMAIL_SENDER_EMAIL      -- the mailbox sending on your behalf
//
// Kevin's address is passed in per-call so it's not hardcoded twice,
// but you can also default it here via KEVIN_EMAIL.

const { google } = require('googleapis');

function buildRawMessage({ to, subject, text, attachments }) {
  const boundary = 'affidavit_boundary_' + Date.now();
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`
  ].join('\r\n');

  let body = `\r\n--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${text}\r\n`;

  for (const att of attachments) {
    body +=
      `--${boundary}\r\n` +
      `Content-Type: ${att.mimeType}\r\n` +
      `Content-Disposition: attachment; filename="${att.filename}"\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      att.base64.match(/.{1,76}/g).join('\r\n') +
      '\r\n';
  }
  body += `--${boundary}--`;

  const raw = headers + '\r\n' + body;
  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendGmail({ to, subject, text, attachments }) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const raw = buildRawMessage({ to, subject, text, attachments });

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw }
  });
}

module.exports = { sendGmail };
