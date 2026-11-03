const { findItemAsset } = require('./_monday');

// Vercel caps function responses at ~4.5 MB; bigger files are handed off to monday's own link.
const MAX_PROXY_BYTES = 4 * 1024 * 1024;

// monday's storage always sends "Content-Disposition: attachment", so files can't be shown in the page
// straight from there. Only these types are served inline; anything else (HTML, SVG, …) goes out as a
// download so uploaded content can never run on this domain.
const INLINE_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function contentDisposition(type, name) {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const itemId = String(q.itemId || '').trim();
  const assetId = String(q.assetId || '').trim();

  if (!/^\d+$/.test(itemId) || !/^\d+$/.test(assetId)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Add ?itemId=<item id>&assetId=<file id> to the link.' });
  }

  try {
    const asset = await findItemAsset(itemId, assetId);
    if (!asset || !asset.url) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: 'This file is not attached to the item.' });
    }

    if (Number(asset.size) > MAX_PROXY_BYTES) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Location', asset.url);
      return res.status(302).end();
    }

    const upstream = await fetch(asset.url);
    if (!upstream.ok) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({ error: `monday.com returned HTTP ${upstream.status} for the file.` });
    }
    const body = Buffer.from(await upstream.arrayBuffer());

    const ext = String(asset.extension || '').replace(/^\./, '').toLowerCase();
    const type = INLINE_TYPES[ext];
    const inline = type && q.download !== '1';

    res.setHeader('Content-Type', type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', asset.name || 'file'));
    res.setHeader('Content-Length', body.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).end(body);
  } catch (err) {
    console.error(err);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'Could not load the file: ' + err.message });
  }
};
