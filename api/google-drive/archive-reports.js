const {
  ensureFolder,
  getDriveConfig,
  normalizeFolderName,
  uploadFileBytes
} = require('../_lib/google-drive');
const { requireAuth } = require('../_lib/supabase-auth');

function providerFolderLabel(kind) {
  const normalized = String(kind || '').trim().toLowerCase();
  if (normalized === 'uber') return 'Uber';
  if (normalized === 'bolt') return 'Bolt';
  if (normalized === 'freenow') return 'FreeNow';
  if (normalized === 'fuel') return 'Fuel';
  return 'Other';
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    await requireAuth(req);

    const config = getDriveConfig();
    if (!config.configured) {
      res.status(503).json({
        error: `Google Drive is not configured. Missing: ${config.missing.join(', ')}`
      });
      return;
    }

    const body = await readJsonBody(req);
    const periodId = String(body.period_id || '').trim();
    const periodLabel = normalizeFolderName(body.period_label || periodId || 'unassigned-period');
    const files = Array.isArray(body.files) ? body.files : [];

    if (!periodId) {
      res.status(400).json({ error: 'period_id is required.' });
      return;
    }

    if (!files.length) {
      res.status(400).json({ error: 'No files to archive.' });
      return;
    }

    const importsFolder = await ensureFolder(config.rootFolderId, '01 Imports');
    const periodFolder = await ensureFolder(importsFolder.id, `${periodLabel} (${periodId})`);
    const rawReportsFolder = await ensureFolder(periodFolder.id, 'Raw weekly reports');

    const archivedFiles = [];

    for (const file of files) {
      const originalName = String(file.name || '').trim();
      if (!originalName || !file.content_base64) continue;

      const providerFolder = await ensureFolder(rawReportsFolder.id, providerFolderLabel(file.kind));
      const uploadResult = await uploadFileBytes({
        parentId: providerFolder.id,
        name: originalName,
        mimeType: String(file.mime_type || 'text/csv'),
        bytes: Buffer.from(String(file.content_base64), 'base64')
      });

      archivedFiles.push({
        id: uploadResult.id,
        name: uploadResult.name,
        original_name: originalName,
        kind: String(file.kind || 'unknown'),
        mime_type: String(file.mime_type || 'text/csv'),
        reused: uploadResult.reused === true,
        web_view_link: uploadResult.webViewLink,
        folder_id: providerFolder.id,
        folder_url: providerFolder.webViewLink
      });
    }

    res.status(200).json({
      archive_folder_id: periodFolder.id,
      archive_folder_url: periodFolder.webViewLink,
      archived_at: new Date().toISOString(),
      files: archivedFiles
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to archive reports to Google Drive.'
    });
  }
};
