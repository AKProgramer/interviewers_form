const { CONFIG, loadMainItem, withRejection } = require('./_monday');

// Vercel serverless request bodies are capped at ~4.5 MB; base64 adds ~33%.
const MAX_TOTAL_FILE_BYTES = 3 * 1024 * 1024;

function str(v, max = 5000) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }

  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) return res.status(500).json({ error: 'WEBHOOK_URL is not configured.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON.' }); }
  }
  body = body || {};

  const itemId = String(body.itemId || '').trim();
  if (!/^\d+$/.test(itemId)) return res.status(400).json({ error: 'Missing item id.' });

  const c = CONFIG.columns;
  const status = str(body.status, 200);
  const recommendation = str(body.recommendation, 200);
  const garin = str(body.garin, 200);
  for (const [value, col] of [[status, c.status], [recommendation, c.recommendation], [garin, c.garin]]) {
    if (value && !col.options.includes(value)) {
      return res.status(400).json({ error: `"${value}" is not a valid ${col.title} value.` });
    }
  }

  const rejected = body.rejected === 'Yes' ? 'Yes' : 'No';
  const pickedReasons = rejected === 'Yes' && Array.isArray(body.rejectionReasons) ? body.rejectionReasons : [];
  const unknownReason = pickedReasons.find((r) => !CONFIG.rejectionReasons.includes(r));
  if (unknownReason !== undefined) {
    return res.status(400).json({ error: `"${unknownReason}" is not a valid rejection reason.` });
  }
  const rejectionReasons = CONFIG.rejectionReasons.filter((r) => pickedReasons.includes(r));
  if (rejected === 'Yes' && !rejectionReasons.length) {
    return res.status(400).json({ error: 'Choose at least one rejection reason.' });
  }

  const newFiles = Array.isArray(body.newFiles) ? body.newFiles : [];
  if (newFiles.length > 1) return res.status(400).json({ error: 'Upload one summary file only.' });
  let total = 0;
  const cleanFiles = [];
  for (const f of newFiles) {
    if (!f || typeof f.data !== 'string' || !f.name) continue;
    const bytes = Math.floor((f.data.length * 3) / 4);
    total += bytes;
    cleanFiles.push({
      name: str(f.name, 255),
      mimeType: str(f.type, 200) || 'application/octet-stream',
      size: bytes,
      base64: f.data,
    });
  }
  if (total > MAX_TOTAL_FILE_BYTES) {
    return res.status(413).json({ error: 'Files are too large. Keep the total under 3 MB.' });
  }

  try {
    // Re-read the item so the webhook gets trustworthy previous values.
    const item = await loadMainItem(itemId);
    if (!item) return res.status(404).json({ error: 'Item not found on the Main Volunteers Board.' });
    const prev = item.fields;

    const next = {
      // long text column, not capped at 2000 like text columns; the picked rejection reasons are appended
      interviewerNotes: withRejection(str(body.interviewerNotes, 20000), rejectionReasons),
      status,
      recommendation,
      garin,
    };

    const entry = (key, title, id) => ({
      columnId: id,
      title,
      value: next[key],
      previous: prev[key],
      changed: next[key] !== prev[key],
    });

    const columns = {
      [c.interviewerNotes.id]: entry('interviewerNotes', c.interviewerNotes.title, c.interviewerNotes.id),
      [c.status.id]: entry('status', c.status.title, c.status.id),
      [c.recommendation.id]: entry('recommendation', c.recommendation.title, c.recommendation.id),
      [c.garin.id]: entry('garin', c.garin.title, c.garin.id),
      [c.meetingSummary.id]: {
        columnId: c.meetingSummary.id,
        title: c.meetingSummary.title,
        newFiles: cleanFiles,
        changed: cleanFiles.length > 0,
      },
    };

    // Ready to drop into monday's change_multiple_column_values (files must be uploaded separately).
    const mondayColumnValues = JSON.stringify({
      [c.interviewerNotes.id]: { text: next.interviewerNotes },
      [c.status.id]: next.status ? { label: next.status } : null,
      [c.recommendation.id]: next.recommendation ? { label: next.recommendation } : null,
      [c.garin.id]: next.garin ? { label: next.garin } : null,
    });

    const payload = {
      event: 'interviewer_form_submitted',
      submittedAt: new Date().toISOString(),
      item: { id: item.id, name: item.name, boardId: item.boardId },
      values: {
        interviewerNotes: next.interviewerNotes,
        rejected,
        rejectionReasons,
        status: next.status,
        recommendationStatus: next.recommendation,
        garin: next.garin,
        meetingSummaryNewFiles: cleanFiles, // 0 or 1 file: only the summary uploaded in this submission
      },
      columns,
      mondayColumnValues,
    };

    const hook = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!hook.ok) {
      const text = await hook.text().catch(() => '');
      console.error('Webhook error', hook.status, text);
      return res.status(502).json({ error: `The webhook rejected the submission (HTTP ${hook.status}).` });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Submission failed: ' + err.message });
  }
};
