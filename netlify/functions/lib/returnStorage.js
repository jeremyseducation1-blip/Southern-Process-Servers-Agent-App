// Stores the actual return/affidavit PDFs (not just "sent" flags) so
// they're attached to the case going forward -- viewable any time from
// Search Cases, not just something that fired off in an email and is
// otherwise gone. Uses private Supabase Storage buckets, since these are
// real legal documents with people's names/addresses on them and
// shouldn't be reachable by a guessable public URL.
const { getSupabaseClient } = require('./caseStore');

const bucketsEnsured = new Set(); // avoid re-checking the same bucket every call

async function ensureBucket(sb, bucket) {
  if (bucketsEnsured.has(bucket)) return;
  const { data: buckets, error: listError } = await sb.storage.listBuckets();
  if (listError) throw new Error(listError.message);
  if (!buckets.some((b) => b.name === bucket)) {
    const { error: createError } = await sb.storage.createBucket(bucket, { public: false });
    // Ignore a harmless race if another request created it a moment earlier.
    if (createError && !/already exists/i.test(createError.message || '')) {
      throw new Error(createError.message);
    }
  }
  bucketsEnsured.add(bucket);
}

// Uploads a PDF to the given bucket and returns the storage path to save
// on the case record. `id` must be the paper's unique row id (case number
// alone isn't unique -- see makePaperId in caseStore.js), so files never
// collide across repeated case numbers.
async function uploadCasePdf(bucket, id, pdfBuffer) {
  const sb = getSupabaseClient();
  await ensureBucket(sb, bucket);
  const safeName = id.replace(/[^a-z0-9:_-]/gi, '_');
  const path = `${safeName}.pdf`;
  const { error } = await sb.storage.from(bucket).upload(path, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true // a later document for the same case replaces the earlier file
  });
  if (error) throw new Error(error.message);
  return path;
}

// Short-lived signed URL -- generated fresh each time it's viewed, never
// stored, so access always goes through the app rather than a link that
// works forever once shared.
async function getCasePdfUrl(bucket, path) {
  const sb = getSupabaseClient();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 60 * 10); // 10 minutes
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

async function uploadReturnPdf(id, pdfBuffer) {
  return uploadCasePdf('returns', id, pdfBuffer);
}
async function uploadAffidavitPdf(id, pdfBuffer) {
  return uploadCasePdf('affidavits', id, pdfBuffer);
}
async function getReturnPdfUrl(path) {
  return getCasePdfUrl('returns', path);
}
async function getAffidavitPdfUrl(path) {
  return getCasePdfUrl('affidavits', path);
}

module.exports = { uploadReturnPdf, uploadAffidavitPdf, getReturnPdfUrl, getAffidavitPdfUrl };
