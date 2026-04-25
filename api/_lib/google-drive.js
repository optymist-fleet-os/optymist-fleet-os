const crypto = require('crypto');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

function base64UrlEncode(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function escapeDriveQueryValue(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function normalizeFolderName(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function getDriveConfig() {
  const serviceAccountEmail = String(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const privateKey = String(process.env.GOOGLE_DRIVE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  const oauthClientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
  const oauthClientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
  const oauthRefreshToken = String(process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim();
  const rootFolderId = String(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '').trim();
  const missing = [];
  const serviceAccountConfigured = Boolean(serviceAccountEmail && privateKey);
  const oauthConfigured = Boolean(oauthClientId && oauthClientSecret && oauthRefreshToken);
  const authMode = serviceAccountConfigured
    ? 'service_account'
    : oauthConfigured
      ? 'oauth_refresh_token'
      : '';

  if (!rootFolderId) missing.push('GOOGLE_DRIVE_ROOT_FOLDER_ID');
  if (!serviceAccountConfigured && !oauthConfigured) {
    missing.push('GOOGLE_DRIVE_CLIENT_ID');
    missing.push('GOOGLE_DRIVE_CLIENT_SECRET');
    missing.push('GOOGLE_DRIVE_REFRESH_TOKEN');
  }

  return {
    authMode,
    configured: Boolean(rootFolderId && (serviceAccountConfigured || oauthConfigured)),
    missing,
    oauthClientId,
    oauthClientSecret,
    oauthRefreshToken,
    serviceAccountEmail,
    privateKey,
    rootFolderId
  };
}

async function getServiceAccountAccessToken(config) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 3600;
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };
  const payload = {
    iss: config.serviceAccountEmail,
    scope: DRIVE_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    exp: expiresAt,
    iat: issuedAt
  };

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(config.privateKey);
  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const payloadJson = await response.json();

  if (!response.ok || !payloadJson.access_token) {
    const error = new Error(payloadJson.error_description || payloadJson.error || 'Failed to authorize Google Drive.');
    error.statusCode = 502;
    throw error;
  }

  return payloadJson.access_token;
}

async function getOAuthRefreshTokenAccessToken(config) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: config.oauthClientId,
      client_secret: config.oauthClientSecret,
      refresh_token: config.oauthRefreshToken,
      grant_type: 'refresh_token'
    })
  });

  const payloadJson = await response.json();

  if (!response.ok || !payloadJson.access_token) {
    const error = new Error(payloadJson.error_description || payloadJson.error || 'Failed to refresh Google Drive token.');
    error.statusCode = 502;
    throw error;
  }

  return payloadJson.access_token;
}

async function getAccessToken() {
  const config = getDriveConfig();

  if (!config.configured) {
    const error = new Error(`Google Drive is not configured. Missing: ${config.missing.join(', ')}`);
    error.statusCode = 503;
    throw error;
  }

  if (config.authMode === 'service_account') {
    return getServiceAccountAccessToken(config);
  }

  if (config.authMode === 'oauth_refresh_token') {
    return getOAuthRefreshTokenAccessToken(config);
  }

  const error = new Error('Google Drive auth mode is not configured.');
  error.statusCode = 503;
  throw error;
}

async function driveRequest(path, options = {}, upload = false) {
  const accessToken = await getAccessToken();
  const baseUrl = upload ? 'https://www.googleapis.com/upload/drive/v3' : 'https://www.googleapis.com/drive/v3';
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = {
        error: {
          message: text
        }
      };
    }
  }

  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.error_description || 'Google Drive request failed.');
    error.statusCode = response.status || 502;
    throw error;
  }

  return payload;
}

async function getFileMetadata(fileId) {
  return driveRequest(
    `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink,parents&supportsAllDrives=true`,
    { method: 'GET' }
  );
}

async function findSingleFile(query) {
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,webViewLink,parents)&pageSize=1&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=allDrives`,
    { method: 'GET' }
  );

  return result.files?.[0] || null;
}

async function ensureFolder(parentId, name) {
  const cleanName = normalizeFolderName(name);
  const existingFolder = await findSingleFile(
    `'${escapeDriveQueryValue(parentId)}' in parents and name = '${escapeDriveQueryValue(cleanName)}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`
  );

  if (existingFolder) return existingFolder;

  return driveRequest('/files?supportsAllDrives=true&fields=id,name,mimeType,webViewLink,parents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: cleanName,
      mimeType: FOLDER_MIME_TYPE,
      parents: [parentId]
    })
  });
}

async function findFileByName(parentId, name) {
  return findSingleFile(
    `'${escapeDriveQueryValue(parentId)}' in parents and name = '${escapeDriveQueryValue(name)}' and trashed = false`
  );
}

async function uploadFileBytes({ parentId, name, mimeType, bytes }) {
  const existingFile = await findFileByName(parentId, name);
  if (existingFile) {
    return {
      ...existingFile,
      reused: true
    };
  }

  const metadata = {
    name,
    parents: [parentId]
  };
  const boundary = `optymist-${Date.now().toString(16)}`;
  const metadataPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
  );
  const mediaHeader = Buffer.from(
    `--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\nContent-Transfer-Encoding: binary\r\n\r\n`
  );
  const ending = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([metadataPart, mediaHeader, bytes, ending]);

  const uploaded = await driveRequest(
    `/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,webViewLink,parents`,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    },
    true
  );

  return {
    ...uploaded,
    reused: false
  };
}

module.exports = {
  ensureFolder,
  getDriveConfig,
  getFileMetadata,
  normalizeFolderName,
  uploadFileBytes
};
