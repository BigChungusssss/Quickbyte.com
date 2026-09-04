// upload-routes.js
// npm install multer exceljs p-limit

const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const pLimit = require('p-limit').default || require('p-limit');
const { supabaseAdmin, logSecurityEvent } = require('./auth-and-security');
const { requireProfile, requireRole } = require('./roles');
const { tryAssignBox } = require('./box-logic');

const router = express.Router();

// Memory storage: files are small (order sheets), no need to hit disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB cap
});

// Caps actual CPU-bound parsing to 5 concurrent jobs regardless of how many
// upload requests land at once — protects the event loop under 20-100
// simultaneous uploads without needing a separate worker/queue service.
const parseLimit = pLimit(5);

// POST /uploads  (student, multipart form field name: "file")
router.post('/uploads', requireProfile, requireRole('student'), upload.single('file'), async (req, res) => {
  if (!req.file) {
    await logSecurityEvent({ req, type: 'bad_input', detail: 'No file in upload', email: req.user.email });
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const storagePath = `${req.user.id}/${Date.now()}-${req.file.originalname}`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('order-uploads')
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });

  if (uploadErr) {
    return res.status(502).json({ error: 'Failed to store file' });
  }

  const { data: job, error: jobErr } = await supabaseAdmin
    .from('upload_jobs')
    .insert({
      student_id: req.user.id,
      original_filename: req.file.originalname,
      storage_path: storagePath,
      status: 'queued',
    })
    .select()
    .single();

  if (jobErr) return res.status(500).json({ error: 'Failed to create upload job' });

  // Respond immediately — don't make the student wait for parsing.
  res.status(202).json({ jobId: job.id, status: 'queued' });

  // Parsing happens after the response, capped by parseLimit.
  parseLimit(() => processUploadJob(job.id, req.user, req.file.buffer)).catch(err => {
    console.error('Upload job failed:', job.id, err);
  });
});

// GET /uploads/:id/status  (student polls this to know when parsing finished)
router.get('/uploads/:id/status', requireProfile, requireRole('student'), async (req, res) => {
  const { data: job, error } = await supabaseAdmin
    .from('upload_jobs')
    .select('id, status, error_message, resulting_order_id')
    .eq('id', req.params.id)
    .eq('student_id', req.user.id) // students can only check their own jobs
    .maybeSingle();

  if (error || !job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

/* ================= PARSING ================= */

async function processUploadJob(jobId, user, fileBuffer) {
  await supabaseAdmin.from('upload_jobs').update({ status: 'processing' }).eq('id', jobId);

  try {
    const items = await parseExcelBuffer(fileBuffer);
    if (items.length === 0) throw new Error('No valid rows found in spreadsheet');

    // Re-upload handling: if this student already has an open order, treat
    // this as an edit (new version, replace items) instead of a new order.
    const { data: existing } = await supabaseAdmin
      .from('orders')
      .select('id, version')
      .eq('student_id', user.id)
      .in('status', ['waiting_list', 'pending_fulfillment'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let orderId;
    if (existing) {
      orderId = existing.id;
      await supabaseAdmin.from('order_items').delete().eq('order_id', orderId);
      await supabaseAdmin.from('orders').update({
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
      }).eq('id', orderId);
    } else {
      const { data: newOrder, error: orderErr } = await supabaseAdmin
        .from('orders')
        .insert({
          student_id: user.id,
          class_leader_id: user.class_leader_id,
          source_filename: null, // set on the upload_jobs row already
        })
        .select()
        .single();
      if (orderErr) throw orderErr;
      orderId = newOrder.id;
    }

    const rows = items.map(it => ({ order_id: orderId, ...it }));
    const { error: itemsErr } = await supabaseAdmin.from('order_items').insert(rows);
    if (itemsErr) throw itemsErr;

    await tryAssignBox(orderId);

    await supabaseAdmin.from('upload_jobs').update({
      status: 'succeeded',
      resulting_order_id: orderId,
      processed_at: new Date().toISOString(),
    }).eq('id', jobId);
  } catch (err) {
    await supabaseAdmin.from('upload_jobs').update({
      status: 'failed',
      error_message: err.message,
      processed_at: new Date().toISOString(),
    }).eq('id', jobId);
  }
}

// Expected columns (header row): Category | Item | Variant | Quantity
// Adjust these column names to match whatever template you actually give students.
async function parseExcelBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Spreadsheet has no sheets');

  const items = [];
  let headerRow = null;

  sheet.eachRow((row, rowNumber) => {
    const values = row.values.slice(1); // ExcelJS pads index 0
    if (rowNumber === 1) {
      headerRow = values.map(v => String(v || '').trim().toLowerCase());
      return;
    }
    if (values.every(v => v === null || v === undefined || v === '')) return; // skip blank rows

    const get = (colName) => {
      const idx = headerRow.indexOf(colName);
      return idx === -1 ? null : values[idx];
    };

    const category = get('category');
    const itemName = get('item');
    const quantity = Number(get('quantity'));

    if (!category || !itemName || !quantity || quantity <= 0) return; // skip malformed rows

    items.push({
      category: String(category).trim(),
      item_name: String(itemName).trim(),
      variant_label: get('variant') ? String(get('variant')).trim() : null,
      quantity,
    });
  });

  return items;
}

module.exports = router;
