const { getDriveConfig, getFileMetadata } = require('../_lib/google-drive');
const { requireAuth } = require('../_lib/supabase-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    await requireAuth(req);

    const config = getDriveConfig();
    if (!config.configured) {
      res.status(200).json({
        configured: false,
        connected: false,
        missing: config.missing,
        root_folder_id: config.rootFolderId,
        checked_at: new Date().toISOString()
      });
      return;
    }

    const rootFolder = await getFileMetadata(config.rootFolderId);

    res.status(200).json({
      configured: true,
      connected: true,
      service_account_email: config.serviceAccountEmail,
      root_folder_id: rootFolder.id,
      root_folder_name: rootFolder.name,
      root_folder_url: rootFolder.webViewLink,
      checked_at: new Date().toISOString()
    });
  } catch (error) {
    const config = getDriveConfig();
    res.status(error.statusCode === 401 ? 401 : 200).json({
      configured: config.configured,
      connected: false,
      missing: config.missing,
      service_account_email: config.serviceAccountEmail,
      root_folder_id: config.rootFolderId,
      error: error.message || 'Failed to load Google Drive status.',
      checked_at: new Date().toISOString()
    });
  }
};
