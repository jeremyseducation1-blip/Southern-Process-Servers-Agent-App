const { getSupabaseClient } = require('./caseStore');

const BUCKET = 'invoices';
let bucketEnsured = false;

async function ensureBucket(sb) {
  if (bucketEnsured) return;
  const { data: buckets, error: listError } = await sb.storage.listBuckets();
  if (listError) throw new Error(listError.message);
  if (!buckets.some((b) => b.name === BUCKET)) {
    const { error: createError } = await sb.storage.createBucket(BUCKET, { public: false });
    if (createError && !/already exists/i.test(createError.message || '')) {
      throw new Error(createError.message);
    }
  }
  bucketEnsured = true;
}

// Uploads the invoice PDF and upserts its metadata row (week_key,
// billable_count, total, generated_at) so both Jeremy's "My Invoices"
// view and Kevin's share-link view can list and open past invoices.
async function saveInvoiceRecord({ weekKey, weekLabel, billableCount, total, pdfBuffer }) {
  const sb = getSupabaseClient();
  await ensureBucket(sb);

  const path = `${weekKey}.pdf`;
  const { error: uploadError } = await sb.storage.from(BUCKET).upload(path, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true // regenerating the same week's invoice replaces the earlier file
  });
  if (uploadError) throw new Error(uploadError.message);

  const { error: dbError } = await sb.from('invoices').upsert({
    week_key: weekKey,
    week_label: weekLabel,
    billable_count: billableCount,
    total,
    pdf_path: path,
    generated_at: new Date().toISOString()
  });
  if (dbError) throw new Error(dbError.message);

  return path;
}

async function listInvoices() {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('invoices')
    .select('week_key, week_label, billable_count, total, generated_at')
    .order('week_key', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function getInvoicePdfUrl(weekKey) {
  const sb = getSupabaseClient();
  const path = `${weekKey}.pdf`;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 60 * 10); // 10 minutes
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

module.exports = { saveInvoiceRecord, listInvoices, getInvoicePdfUrl };
