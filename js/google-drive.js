import { db } from './supabase.js';
import { getInitialGoogleDriveState, state } from './state.js';
import { safe } from './utils.js';

async function getAuthHeaders() {
  const {
    data: { session }
  } = await db.auth.getSession();

  const headers = {
    'Content-Type': 'application/json'
  };

  const token = safe(session?.access_token);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function parseApiResponse(response) {
  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = {
        error: text
      };
    }
  }

  if (!response.ok) {
    throw new Error(safe(payload.error) || safe(payload.message) || `Request failed (${response.status}).`);
  }

  return payload;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

function normalizeDriveState(payload = {}) {
  return getInitialGoogleDriveState({
    configured: payload.configured === true,
    connected: payload.connected === true,
    auth_mode: safe(payload.auth_mode),
    service_account_email: safe(payload.service_account_email),
    root_folder_id: safe(payload.root_folder_id),
    root_folder_name: safe(payload.root_folder_name),
    root_folder_url: safe(payload.root_folder_url),
    missing: Array.isArray(payload.missing) ? payload.missing : [],
    error: safe(payload.error),
    checked_at: safe(payload.checked_at)
  });
}

export async function refreshGoogleDriveStatus() {
  try {
    const response = await fetch('/api/google-drive/status', {
      method: 'GET',
      headers: await getAuthHeaders()
    });
    const payload = await parseApiResponse(response);
    state.googleDrive = normalizeDriveState(payload);
  } catch (error) {
    state.googleDrive = getInitialGoogleDriveState({
      configured: false,
      connected: false,
      error: error.message || 'Failed to load Google Drive status.'
    });
  }

  return state.googleDrive;
}

export async function archiveSettlementImportReports({ period, files, sourceReports = [] }) {
  const filePayloads = [];

  for (const file of files || []) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const report = sourceReports.find(item => safe(item.file_name) === safe(file.name));

    filePayloads.push({
      name: safe(file.name),
      kind: safe(report?.kind) || 'unknown',
      mime_type: safe(file.type) || 'text/csv',
      content_base64: bytesToBase64(bytes)
    });
  }

  const response = await fetch('/api/google-drive/archive-reports', {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({
      period_id: safe(period?.id),
      period_label: `${safe(period?.date_from)}__${safe(period?.date_to)}`,
      files: filePayloads
    })
  });

  return parseApiResponse(response);
}
