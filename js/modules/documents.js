import { db } from '../supabase.js';
import {
  getInitialDocumentDraft,
  state
} from '../state.js';
import {
  badgeClass,
  clearMsg,
  escapeHtml,
  fullName,
  humanize,
  isoNow,
  money,
  nullIfBlank,
  ownerLabel,
  ownerSettlementDocKey,
  qs,
  safe,
  shortId,
  showMsg,
  vehicleLabel
} from '../utils.js';

const DOCUMENT_TYPES = [
  'contract',
  'annex',
  'settlement_pdf',
  'owner_settlement_pdf',
  'platform_report',
  'fuel_report',
  'payout_export',
  'insurance',
  'inspection',
  'passport_scan',
  'driver_license_scan',
  'invoice',
  'protocol',
  'other'
];

const DOCUMENT_STATUSES = [
  'missing',
  'uploaded',
  'pending_review',
  'approved',
  'rejected',
  'expired',
  'draft',
  'ready',
  'sent',
  'signed',
  'generated',
  'archived'
];
const ENTITY_TYPES = ['driver', 'vehicle', 'owner', 'settlement', 'owner_settlement', 'period', 'other'];
const STORAGE_PROVIDERS = ['google_drive', 'manual_link', 'pending'];

export function createDocumentsModule({ el, loadAllData, renderAll, setPage, closeAllForms }) {
  function getEntityDocuments(entityType, entityId, alternatives = []) {
    const ids = [String(entityId || ''), ...alternatives.map(item => String(item || ''))].filter(Boolean);

    return state.documents.filter(document =>
      safe(document.entity_type).toLowerCase() === safe(entityType).toLowerCase() &&
      ids.includes(String(document.entity_id))
    );
  }

  function getEntityDocumentStats(entityType, entityId, alternatives = []) {
    const documents = getEntityDocuments(entityType, entityId, alternatives);
    return {
      total: documents.length,
      missing: documents.filter(document => safe(document.status).toLowerCase() === 'missing').length,
      googleDriveLinked: documents.filter(document => safe(document.storage_provider).toLowerCase() === 'google_drive' && (safe(document.drive_file_id) || safe(document.file_url))).length
    };
  }

  function getOwnerSettlementDocument(ownerSettlementOrLine) {
    const documentKey = ownerSettlementDocKey(ownerSettlementOrLine);
    const doc = getEntityDocuments('owner_settlement', documentKey)[0] || null;

    return {
      doc,
      documentKey,
      driveFileId: safe(doc?.drive_file_id),
      driveFolderId: safe(doc?.drive_folder_id),
      fileUrl: safe(doc?.file_url),
      folderUrl: safe(doc?.folder_url)
    };
  }

  function inferDocumentPrefillFromSelection() {
    const selection = state.selectedDetails;
    if (!selection) return {};

    if (selection.type === 'driver') {
      return { entity_type: 'driver', entity_id: safe(selection.id) };
    }
    if (selection.type === 'vehicle') {
      return { entity_type: 'vehicle', entity_id: safe(selection.id) };
    }
    if (selection.type === 'owner') {
      return { entity_type: 'owner', entity_id: safe(selection.id) };
    }
    if (selection.type === 'settlement') {
      return { entity_type: 'settlement', entity_id: safe(selection.id), document_type: 'settlement_pdf' };
    }
    if (selection.type === 'owner-settlement') {
      const entityId = safe(selection.id).startsWith('owner-settlement:')
        ? safe(selection.id)
        : `owner-settlement:${safe(selection.id)}`;
      return { entity_type: 'owner_settlement', entity_id: entityId, document_type: 'owner_settlement_pdf' };
    }

    return {};
  }

  async function createDocument(payload) {
    const { error } = await db.from('documents').insert([payload]);
    if (error) throw error;
  }

  async function updateDocument(documentId, payload) {
    const { error } = await db.from('documents').update(payload).eq('id', documentId);
    if (error) throw error;
  }

  function openNewDocumentForm(prefill = {}) {
    closeAllForms();
    state.forms.document = true;
    state.documentDraft = getInitialDocumentDraft({
      storage_provider: 'google_drive',
      ...inferDocumentPrefillFromSelection(),
      ...prefill
    });
    setPage('documents');
    renderAll();
  }

  function openDocumentEditor(documentId) {
    const document = state.documents.find(item => String(item.id) === String(documentId));
    if (!document) return;

    closeAllForms();
    state.forms.document = true;
    state.documentDraft = getInitialDocumentDraft({
      document_id: safe(document.id),
      entity_type: safe(document.entity_type),
      entity_id: safe(document.entity_id),
      document_type: safe(document.document_type) || 'other',
      title: safe(document.title),
      status: safe(document.status) || 'draft',
      storage_provider: safe(document.storage_provider) || 'google_drive',
      drive_file_id: safe(document.drive_file_id),
      drive_folder_id: safe(document.drive_folder_id),
      file_url: safe(document.file_url),
      folder_url: safe(document.folder_url),
      mime_type: safe(document.mime_type),
      notes: safe(document.notes)
    });
    setPage('documents');
    renderAll();
  }

  function closeDocumentForm() {
    state.forms.document = false;
    state.documentDraft = getInitialDocumentDraft();
    renderAll();
  }

  function documentEntityLabel(document) {
    const entityType = safe(document.entity_type);
    const entityId = safe(document.entity_id);

    if (entityType === 'driver') {
      const driver = state.drivers.find(item => String(item.id) === entityId);
      return fullName(driver);
    }
    if (entityType === 'vehicle') {
      const vehicle = state.vehicles.find(item => String(item.id) === entityId);
      return vehicleLabel(vehicle);
    }
    if (entityType === 'owner') {
      const owner = state.owners.find(item => String(item.id) === entityId);
      return ownerLabel(owner);
    }
    if (entityType === 'settlement') {
      return `Settlement ${shortId(entityId)}`;
    }
    if (entityType === 'owner_settlement') {
      return entityId;
    }

    return entityId || '-';
  }

  function renderDocumentFormCard() {
    const draft = state.documentDraft || getInitialDocumentDraft();

    return `
      <div class="form-card">
        <h3 class="form-title">${safe(draft.document_id) ? 'Edit document metadata' : 'Document metadata'}</h3>
        <form id="documentForm">
          <input type="hidden" name="document_id" value="${escapeHtml(draft.document_id)}" />

          <div class="form-grid-wide">
            <div class="form-field">
              <label>Entity type</label>
              <select name="entity_type">
                ${ENTITY_TYPES.map(type => `
                  <option value="${type}" ${type === safe(draft.entity_type) ? 'selected' : ''}>${humanize(type)}</option>
                `).join('')}
              </select>
            </div>

            <div class="form-field">
              <label>Entity id</label>
              <input name="entity_id" value="${escapeHtml(draft.entity_id)}" />
            </div>

            <div class="form-field">
              <label>Document type</label>
              <select name="document_type">
                ${DOCUMENT_TYPES.map(type => `
                  <option value="${type}" ${type === safe(draft.document_type) ? 'selected' : ''}>${humanize(type)}</option>
                `).join('')}
              </select>
            </div>

            <div class="form-field">
              <label>Status</label>
              <select name="status">
                ${DOCUMENT_STATUSES.map(status => `
                  <option value="${status}" ${status === safe(draft.status) ? 'selected' : ''}>${humanize(status)}</option>
                `).join('')}
              </select>
            </div>

            <div class="form-field form-field-span-2">
              <label>Title</label>
              <input name="title" value="${escapeHtml(draft.title)}" />
            </div>

            <div class="form-field">
              <label>Storage provider</label>
              <select name="storage_provider">
                ${STORAGE_PROVIDERS.map(provider => `
                  <option value="${provider}" ${provider === safe(draft.storage_provider) ? 'selected' : ''}>${humanize(provider)}</option>
                `).join('')}
              </select>
            </div>

            <div class="form-field">
              <label>Drive file id</label>
              <input name="drive_file_id" value="${escapeHtml(draft.drive_file_id)}" />
            </div>

            <div class="form-field">
              <label>Drive folder id</label>
              <input name="drive_folder_id" value="${escapeHtml(draft.drive_folder_id)}" />
            </div>

            <div class="form-field">
              <label>File URL</label>
              <input name="file_url" value="${escapeHtml(draft.file_url)}" />
            </div>

            <div class="form-field">
              <label>Folder URL</label>
              <input name="folder_url" value="${escapeHtml(draft.folder_url)}" />
            </div>

            <div class="form-field">
              <label>MIME type</label>
              <input name="mime_type" value="${escapeHtml(draft.mime_type)}" />
            </div>

            <div class="form-field form-field-span-2">
              <label>Notes</label>
              <textarea name="notes" rows="3">${escapeHtml(draft.notes)}</textarea>
            </div>
          </div>

          <div class="helper-text">
            Files themselves are not stored in Supabase Storage. This layer keeps metadata, status, IDs and future Google Drive links.
          </div>

          <div class="form-actions">
            <button type="submit">${safe(draft.document_id) ? 'Update metadata' : 'Create metadata'}</button>
            <button type="button" class="secondary" id="cancelDocumentFormBtn">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  async function onDocumentSubmit(event) {
    event.preventDefault();
    clearMsg(el.appMsg);

    const formData = new FormData(event.target);
    const payload = {
      entity_type: safe(formData.get('entity_type')) || 'other',
      entity_id: safe(formData.get('entity_id')),
      document_type: safe(formData.get('document_type')) || 'other',
      title: nullIfBlank(formData.get('title')),
      status: safe(formData.get('status')) || 'draft',
      storage_provider: safe(formData.get('storage_provider')) || 'google_drive',
      drive_file_id: nullIfBlank(formData.get('drive_file_id')),
      drive_folder_id: nullIfBlank(formData.get('drive_folder_id')),
      file_url: nullIfBlank(formData.get('file_url')),
      folder_url: nullIfBlank(formData.get('folder_url')),
      mime_type: nullIfBlank(formData.get('mime_type')),
      notes: nullIfBlank(formData.get('notes')),
      updated_at: isoNow()
    };

    if (!payload.entity_id) {
      showMsg(el.appMsg, 'Entity id is required.');
      return;
    }

    try {
      const documentId = safe(formData.get('document_id'));

      if (documentId) {
        await updateDocument(documentId, payload);
        showMsg(el.appMsg, 'Document metadata updated.', 'success');
      } else {
        await createDocument(payload);
        showMsg(el.appMsg, 'Document metadata created.', 'success');
      }

      closeAllForms();
      await loadAllData();
    } catch (error) {
      showMsg(el.appMsg, error.message || 'Failed to save document metadata.');
    }
  }

  function bindDocumentFormEvents() {
    const form = qs('documentForm');
    if (!form) return;

    form.addEventListener('submit', onDocumentSubmit);
    qs('cancelDocumentFormBtn')?.addEventListener('click', closeDocumentForm);
  }

  function renderDocumentsPage() {
    if (!el.documentsPage) return;

    const driveState = state.googleDrive || {};
    const filteredDocuments = state.documents.filter(document => {
      if (safe(state.filters.documentEntity) !== 'all' && safe(document.entity_type) !== safe(state.filters.documentEntity)) {
        return false;
      }
      if (safe(state.filters.documentType) !== 'all' && safe(document.document_type) !== safe(state.filters.documentType)) {
        return false;
      }
      if (safe(state.filters.documentStatus) !== 'all' && safe(document.status) !== safe(state.filters.documentStatus)) {
        return false;
      }

      const search = safe(state.filters.documentSearch).toLowerCase();
      if (!search) return true;

      const haystack = [
        safe(document.title),
        safe(document.document_type),
        safe(document.entity_type),
        safe(document.entity_id),
        safe(document.notes),
        safe(document.drive_file_id),
        safe(document.drive_folder_id)
      ].join(' ').toLowerCase();

      return haystack.includes(search);
    });

    el.documentsPage.innerHTML = `
      <div class="cards cards-compact">
        <div class="card"><div class="metric-label">Documents</div><div class="metric-value">${filteredDocuments.length}</div></div>
        <div class="card"><div class="metric-label">Google Drive linked</div><div class="metric-value">${filteredDocuments.filter(item => safe(item.storage_provider) === 'google_drive' && (safe(item.drive_file_id) || safe(item.file_url))).length}</div></div>
        <div class="card"><div class="metric-label">Missing / draft</div><div class="metric-value">${filteredDocuments.filter(item => ['missing', 'draft'].includes(safe(item.status))).length}</div></div>
      </div>

      <div class="card drive-status-card">
        <h3 class="card-title">Google Drive layer</h3>
        <div class="helper-grid">
          <div class="helper-card">
            <div class="helper-label">Connection</div>
            <div class="helper-value">${escapeHtml(
              driveState.connected
                ? 'Connected'
                : driveState.configured
                  ? 'Configured, access check failed'
                  : 'Not configured yet'
            )}</div>
            <div class="helper-note">${escapeHtml(
              driveState.connected
                ? safe(driveState.service_account_email) || humanize(driveState.auth_mode || 'OAuth connected')
                : safe(driveState.error) || (Array.isArray(driveState.missing) && driveState.missing.length
                  ? `Missing: ${driveState.missing.join(', ')}`
                  : 'Set Google Drive OAuth env vars on Vercel.')
            )}</div>
          </div>

          <div class="helper-card">
            <div class="helper-label">Root folder</div>
            <div class="helper-value">${escapeHtml(safe(driveState.root_folder_name) || 'CRM root not linked')}</div>
            <div class="helper-note">${driveState.root_folder_url
              ? `<a href="${escapeHtml(driveState.root_folder_url)}" target="_blank" rel="noreferrer">Open Google Drive folder</a>`
              : escapeHtml(safe(driveState.root_folder_id) || 'Waiting for configuration')
            }</div>
          </div>

          <div class="helper-card">
            <div class="helper-label">Storage policy</div>
            <div class="helper-value">Google Drive first</div>
            <div class="helper-note">Supabase stores metadata, statuses, IDs and links. Files themselves live in Drive.</div>
          </div>
        </div>
      </div>

      <div class="action-bar">
        <div class="filters filters-4">
          <input id="documentSearchInput" placeholder="Search documents" value="${escapeHtml(state.filters.documentSearch)}" />
          <select id="documentEntityFilter">
            <option value="all">All entities</option>
            ${ENTITY_TYPES.map(type => `
              <option value="${type}" ${type === safe(state.filters.documentEntity) ? 'selected' : ''}>${humanize(type)}</option>
            `).join('')}
          </select>
          <select id="documentTypeFilter">
            <option value="all">All types</option>
            ${DOCUMENT_TYPES.map(type => `
              <option value="${type}" ${type === safe(state.filters.documentType) ? 'selected' : ''}>${humanize(type)}</option>
            `).join('')}
          </select>
          <select id="documentStatusFilter">
            <option value="all">All statuses</option>
            ${DOCUMENT_STATUSES.map(status => `
              <option value="${status}" ${status === safe(state.filters.documentStatus) ? 'selected' : ''}>${humanize(status)}</option>
            `).join('')}
          </select>
        </div>

        <div class="button-cluster">
          <button type="button" id="newDocumentBtn">New document metadata</button>
        </div>
      </div>

      ${state.forms.document ? renderDocumentFormCard() : ''}

      <div class="card">
        <h3 class="card-title">Documents center</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Entity</th>
                <th>Type</th>
                <th>Status</th>
                <th>Storage</th>
                <th>Drive / link</th>
              </tr>
            </thead>
            <tbody>
              ${filteredDocuments.length ? filteredDocuments.map(document => {
                const selected = state.selectedDetails?.type === 'document' && String(state.selectedDetails.id) === String(document.id);
                return `
                  <tr
                    class="table-row-clickable ${selected ? 'selected' : ''}"
                    data-detail-type="document"
                    data-detail-id="${escapeHtml(document.id)}"
                  >
                    <td>
                      <strong>${escapeHtml(safe(document.title) || humanize(document.document_type))}</strong>
                      <div class="details-subvalue">${escapeHtml(safe(document.mime_type) || '-')}</div>
                    </td>
                    <td>
                      <div>${escapeHtml(humanize(document.entity_type))}</div>
                      <div class="details-subvalue">${escapeHtml(documentEntityLabel(document))}</div>
                    </td>
                    <td>${escapeHtml(humanize(document.document_type))}</td>
                    <td><span class="badge ${badgeClass(document.status)}">${escapeHtml(humanize(document.status))}</span></td>
                    <td>${escapeHtml(humanize(document.storage_provider || 'pending'))}</td>
                    <td>
                      <div>${safe(document.drive_file_id) ? 'Drive file linked' : safe(document.file_url) ? 'External URL' : 'Placeholder only'}</div>
                      <div class="details-subvalue">${escapeHtml(safe(document.drive_file_id) || safe(document.file_url) || '-')}</div>
                    </td>
                  </tr>
                `;
              }).join('') : `
                <tr><td colspan="6"><div class="empty">No document metadata yet.</div></td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;

    qs('newDocumentBtn')?.addEventListener('click', () => openNewDocumentForm());
    qs('documentSearchInput')?.addEventListener('input', event => {
      state.filters.documentSearch = event.target.value;
      renderDocumentsPage();
    });
    qs('documentEntityFilter')?.addEventListener('change', event => {
      state.filters.documentEntity = event.target.value;
      renderDocumentsPage();
    });
    qs('documentTypeFilter')?.addEventListener('change', event => {
      state.filters.documentType = event.target.value;
      renderDocumentsPage();
    });
    qs('documentStatusFilter')?.addEventListener('change', event => {
      state.filters.documentStatus = event.target.value;
      renderDocumentsPage();
    });

    document.querySelectorAll('[data-detail-type="document"][data-detail-id]').forEach(node => {
      node.addEventListener('click', () => {
        state.selectedDetails = {
          type: 'document',
          id: node.getAttribute('data-detail-id')
        };
        renderAll();
      });
    });

    bindDocumentFormEvents();
  }

  return {
    closeDocumentForm,
    documentEntityLabel,
    getEntityDocumentStats,
    getEntityDocuments,
    getOwnerSettlementDocument,
    openDocumentEditor,
    openNewDocumentForm,
    renderDocumentsPage
  };
}
