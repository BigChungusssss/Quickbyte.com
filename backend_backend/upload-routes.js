// upload-routes.js
// npm install multer p-limit
// (exceljs is no longer needed — parsing was dropped in favor of storing the raw file)

const express = require('express');
const multer = require('multer');
const pLimit = require('p-limit').default || require('p-limit');
const { supabaseAdmin, logSecurityEvent } = require('./auth-and-security');
const { requireProfile, requireRole } = require('./roles');
const { tryAssignBox } = require('./box-logic');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — BOM templates with 5 sheets can be bigger than a flat list
});

// Caps concurrent Storage uploads/DB writes so 20-100 simultaneous submits
// don't all hit Supabase at once — no CPU-heavy parsing anymore, but this
// still protects against a burst of concurrent requests overwhelming things.
const jobLimit = pLimit(10);

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

  if (uploadErr) return res.status(502).json({ error: 'Failed to store file' });

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

  res.status(202).json({ jobId: job.id, status: 'queued' });

  jobLimit(() => processUploadJob(job.id, req.user, req.file.originalname, storagePath)).catch(err => {
    console.error('Upload job failed:', job.id, err);
  });
});

// GET /uploads/:id/status  (student polls this to know when the job finished)
router.get('/uploads/:id/status', requireProfile, requireRole('student'), async (req, res) => {
  const { data: job, error } = await supabaseAdmin
    .from('upload_jobs')
    .select('id, status, error_message, resulting_order_id')
    .eq('id', req.params.id)
    .eq('student_id', req.user.id)
    .maybeSingle();

  if (error || !job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

async function processUploadJob(jobId, user, originalFilename, storagePath) {
  await supabaseAdmin.from('upload_jobs').update({ status: 'processing' }).eq('id', jobId);

  try {
    // Re-upload handling: if this student already has an open order, treat
    // this as an edit — bump the version and replace the file, rather than
    // creating a second order. Otherwise, create a new order.
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
      await supabaseAdmin.from('orders').update({
        source_filename: originalFilename,
        file_storage_path: storagePath,
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
      }).eq('id', orderId);
    } else {
      const { data: newOrder, error: orderErr } = await supabaseAdmin
        .from('orders')
        .insert({
          student_id: user.id,
          class_leader_id: user.class_leader_id,
          source_filename: originalFilename,
          file_storage_path: storagePath,
        })
        .select()
        .single();
      if (orderErr) throw orderErr;
      orderId = newOrder.id;
    }

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

module.exports = router;
