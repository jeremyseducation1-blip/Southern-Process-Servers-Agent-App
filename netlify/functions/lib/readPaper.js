// Reads scanned legal papers (any layout) with Claude's vision and returns
// one record per person to be served. Used only from the logged-in app.
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const COURT_TYPES = ['General Sessions', 'Circuit', 'Chancery', 'Juvenile', 'Other'];
const DOC_TYPES = ['Detainer', 'Letter', 'Summons', 'Civil Warrant', 'Subpoena', 'Other'];

const TOOL = {
  name: 'record_papers',
  description: 'Record every paper that needs to be served, one entry per person to be served.',
  input_schema: {
    type: 'object',
    properties: {
      papers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            caseNo: { type: 'string', description: 'Docket / case number exactly as printed, e.g. 26GC21432. Empty if not visible.' },
            courtType: { type: 'string', enum: COURT_TYPES },
            county: { type: 'string', description: 'County name only, e.g. Davidson' },
            documentType: { type: 'string', enum: DOC_TYPES, description: 'Civil Warrant, Summons, Detainer, Subpoena, Letter, or Other' },
            plaintiff: { type: 'string' },
            defendant: { type: 'string', description: 'The ONE person/entity to be served by this entry.' },
            serviceAddress: { type: 'string', description: 'Full street address where this defendant is to be served: street, city, state ZIP.' },
            phoneNumbers: { type: 'string', description: 'Printed phone numbers for this defendant, one per line. Not the process server\'s number.' },
            courtDate: { type: 'string', description: 'Court/hearing date as YYYY-MM-DD, from the warrant or summons. Empty if none printed.' },
            courtTime: { type: 'string', description: 'Hearing time like 9:00 AM. Empty if none.' },
            issueDate: { type: 'string', description: 'Date the summons/warrant was issued, YYYY-MM-DD. Empty if not printed.' },
            attorney: { type: 'string', description: 'Plaintiff\'s attorney (name, or firm if no name). Empty if not printed.' },
            notes: { type: 'string', description: 'Anything a process server should not forget (employer/place of employment, gate code, special instructions). Short.' },
            uncertain: { type: 'array', items: { type: 'string' }, description: 'Names of fields you are NOT sure you read correctly (blurry, cut off, ambiguous).' }
          },
          required: ['caseNo', 'defendant', 'plaintiff']
        }
      }
    },
    required: ['papers']
  }
};

const SYSTEM =
  'You read scanned legal papers for a process server so he does not have to type them in. ' +
  'The pages may be a Return of Service cover sheet followed by the actual civil warrant, summons, detainer or subpoena, in any layout, from any court. ' +
  'Combine pages that belong to the same case. Produce ONE entry per person to be served (a case with two defendants at different addresses is two entries). ' +
  'Take the case number, court date/time and issue date from the printed court paper. Ignore the process server\'s own handwriting, signature, stamp and service dates. ' +
  'Copy numbers and spellings exactly as printed. If a field is not on the pages, return an empty string. Never guess; instead list any field you are unsure of in "uncertain". ' +
  'Dates must be YYYY-MM-DD. Always answer by calling record_papers.';

function parseDataUrl(u) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(u || '');
  return m ? { media_type: m[1], data: m[2] } : null;
}

const cleanDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');

function normalize(p) {
  const court = COURT_TYPES.includes(p.courtType) && p.courtType !== 'Other' ? p.courtType : '';
  const courtType = { 'General Sessions': 'General Sessions', Circuit: 'Circuit', Chancery: 'Chancery', Juvenile: 'Juvenile' }[court] || '';
  const docType = DOC_TYPES.includes(p.documentType) && p.documentType !== 'Other' ? p.documentType : '';
  const notes = [p.notes, p.courtTime ? `Court time: ${p.courtTime}` : ''].filter(Boolean).join(' — ');
  return {
    caseNo: String(p.caseNo || '').trim(),
    courtType,
    county: String(p.county || '').replace(/\s*county\s*$/i, '').trim(),
    caseType: docType,
    plaintiff: String(p.plaintiff || '').trim(),
    defendant: String(p.defendant || '').trim(),
    serviceAddress: String(p.serviceAddress || '').trim(),
    phoneNumbers: String(p.phoneNumbers || '').trim(),
    courtDate: cleanDate(p.courtDate),
    issueDate: cleanDate(p.issueDate),
    attorney: String(p.attorney || '').trim(),
    notes,
    uncertain: Array.isArray(p.uncertain) ? p.uncertain.map(String) : []
  };
}

// images: array of data URLs. Returns [{...normalized paper}].
async function readPapers(images, fetchImpl) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('AI_NOT_CONFIGURED');
  const content = [];
  images.forEach((u, i) => {
    const img = parseDataUrl(u);
    if (!img) throw new Error('Page ' + (i + 1) + ' is not a usable image.');
    content.push({ type: 'text', text: `Page ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
  });
  content.push({ type: 'text', text: 'Read these pages and call record_papers.' });

  const res = await (fetchImpl || fetch)('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL(),
      max_tokens: 3000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'record_papers' },
      messages: [{ role: 'user', content }]
    })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('The reader service said: ' + res.status + ' ' + t.slice(0, 200));
  }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'tool_use' && b.name === 'record_papers');
  if (!block || !block.input || !Array.isArray(block.input.papers)) throw new Error('The reader returned nothing usable.');
  return block.input.papers.map(normalize);
}

module.exports = { readPapers, normalize, TOOL };
