import { db } from '../supabase.js';
import { closeAllForms, state } from '../state.js';
import {
  badgeClass,
  clearMsg,
  escapeHtml,
  fullName,
  humanize,
  money,
  nullIfBlank,
  qs,
  safe,
  showMsg,
  splitName,
  vehicleLabel
} from '../utils.js';

const DRIVER_LIFECYCLE_STATUSES = [
  'lead',
  'onboarding',
  'documents_missing',
  'verification',
  'contract_signed',
  'platform_activation',
  'active',
  'blocked',
  'terminated',
  'archived',
  'pending',
  'inactive'
];

export function createDriversModule({
  assignments,
  documents,
  driverSettlements,
  el,
  loadAllData,
  renderAll
}) {
  function openDriverForm() {
    closeAllForms();
    state.forms.driver = true;
    renderAll();
  }

  async function createDriver(payload) {
    const { error } = await db.from('drivers').insert([payload]);
    if (error) throw error;
  }

  async function onCreateDriverSubmit(event) {
    event.preventDefault();
    clearMsg(el.appMsg);

    const formData = new FormData(event.target);
    const fullNameValue = safe(formData.get('full_name'));

    if (!fullNameValue) {
      showMsg(el.appMsg, 'Driver full name is required.');
      return;
    }

    const names = splitName(fullNameValue);

    try {
      await createDriver({
        full_name: fullNameValue,
        first_name: names.first_name,
        last_name: names.last_name,
        email: nullIfBlank(formData.get('email')),
        phone: nullIfBlank(formData.get('phone')),
        passport_number: nullIfBlank(formData.get('passport_number')),
        driver_license_number: nullIfBlank(formData.get('driver_license_number')),
        status: safe(formData.get('status')) || 'active',
        contract_status: safe(formData.get('contract_status')) || 'missing',
        onboarding_stage: safe(formData.get('onboarding_stage')) || 'new',
        joined_at: nullIfBlank(formData.get('joined_at')),
        notes: nullIfBlank(formData.get('notes'))
      });

      showMsg(el.appMsg, 'Driver created.', 'success');
      closeAllForms();
      await loadAllData();
    } catch (error) {
      showMsg(el.appMsg, error.message || 'Failed to create driver.');
    }
  }

  function renderDriverFormCard() {
    return `
      <div class="form-card">
        <h3 class="form-title">New driver</h3>
        <form id="driverForm">
          <div class="form-grid-wide">
            <div class="form-field">
              <label>Full name *</label>
              <input name="full_name" required />
            </div>

            <div class="form-field">
              <label>Email</label>
              <input name="email" type="email" />
            </div>

            <div class="form-field">
              <label>Phone</label>
              <input name="phone" />
            </div>

            <div class="form-field">
              <label>Status</label>
              <select name="status">
                ${DRIVER_LIFECYCLE_STATUSES.map(status => `
                  <option value="${status}" ${status === 'active' ? 'selected' : ''}>${humanize(status)}</option>
                `).join('')}
              </select>
            </div>

            <div class="form-field">
              <label>Contract status</label>
              <select name="contract_status">
                <option value="missing">Missing</option>
                <option value="draft">Draft</option>
                <option value="signed">Signed</option>
                <option value="expired">Expired</option>
              </select>
            </div>

            <div class="form-field">
              <label>Onboarding stage</label>
              <select name="onboarding_stage">
                <option value="new">New</option>
                <option value="documents">Documents</option>
                <option value="ready">Ready</option>
                <option value="driving">Driving</option>
              </select>
            </div>

            <div class="form-field">
              <label>Joined at</label>
              <input name="joined_at" type="date" />
            </div>

            <div class="form-field">
              <label>Passport number</label>
              <input name="passport_number" />
            </div>

            <div class="form-field">
              <label>Driver license number</label>
              <input name="driver_license_number" />
            </div>

            <div class="form-field form-field-span-2">
              <label>Notes</label>
              <textarea name="notes" rows="3"></textarea>
            </div>
          </div>

          <div class="form-actions">
            <button type="submit">Create driver</button>
            <button type="button" class="secondary" id="cancelDriverFormBtn">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  function bindDriverFormEvents() {
    const form = qs('driverForm');
    if (!form) return;

    form.addEventListener('submit', onCreateDriverSubmit);
    qs('cancelDriverFormBtn')?.addEventListener('click', () => {
      state.forms.driver = false;
      renderAll();
    });
  }

  function renderDriversPage() {
    if (!el.driversPage) return;

    const filteredDrivers = state.drivers
      .filter(driver => {
        if (driverSettlements.isSettlementExcludedDriver(driver) && safe(state.filters.driverStatus) !== 'all') {
          if (safe(state.filters.driverStatus) !== safe(driver.status)) return false;
        } else if (safe(state.filters.driverStatus) !== 'all' && safe(driver.status) !== safe(state.filters.driverStatus)) {
          return false;
        }

        const currentAssignment = assignments.getCurrentAssignmentForDriver(driver.id);
        const scope = safe(state.filters.driverAssignmentScope);
        if (scope === 'active' && !currentAssignment) return false;
        if (scope === 'unassigned' && currentAssignment) return false;
        if (scope === 'history' && !assignments.getAssignmentHistoryForDriver(driver.id).length) return false;

        const search = safe(state.filters.driverSearch).toLowerCase();
        if (!search) return true;

        const haystack = [
          fullName(driver),
          safe(driver.email),
          safe(driver.phone),
          safe(driver.notes),
          safe(driver.status),
          safe(driver.contract_status)
        ].join(' ').toLowerCase();

        return haystack.includes(search);
      })
      .sort((left, right) => fullName(left).localeCompare(fullName(right), 'uk'));

    el.driversPage.innerHTML = `
      <div class="action-bar">
        <div class="filters filters-4">
          <input id="driverSearchInput" placeholder="Search drivers" value="${escapeHtml(state.filters.driverSearch)}" />
          <select id="driverStatusFilter">
            <option value="all">All statuses</option>
            ${DRIVER_LIFECYCLE_STATUSES.map(status => `
              <option value="${status}" ${status === safe(state.filters.driverStatus) ? 'selected' : ''}>${humanize(status)}</option>
            `).join('')}
          </select>
          <select id="driverAssignmentScopeFilter">
            <option value="all">All assignment scopes</option>
            <option value="active" ${safe(state.filters.driverAssignmentScope) === 'active' ? 'selected' : ''}>Active assignment</option>
            <option value="unassigned" ${safe(state.filters.driverAssignmentScope) === 'unassigned' ? 'selected' : ''}>Unassigned</option>
            <option value="history" ${safe(state.filters.driverAssignmentScope) === 'history' ? 'selected' : ''}>Has history</option>
          </select>
        </div>

        <div class="button-cluster">
          <button type="button" id="newDriverBtn">New driver</button>
          <button type="button" class="secondary" id="newAssignmentFromDriversBtn">Assign vehicle</button>
          <button type="button" class="secondary" id="newDriverDocumentBtn">Add document metadata</button>
        </div>
      </div>

      ${state.forms.driver ? renderDriverFormCard() : ''}
      ${state.forms.assignment ? assignments.renderAssignmentFormCard() : ''}

      <div class="card">
        <h3 class="card-title">Drivers</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>Current assignment</th>
                <th>Settlements</th>
                <th>Outstanding</th>
                <th>Contract / docs</th>
              </tr>
            </thead>
            <tbody>
              ${filteredDrivers.length ? filteredDrivers.map(driver => {
                const currentAssignment = assignments.getCurrentAssignmentForDriver(driver.id);
                const currentVehicle = currentAssignment
                  ? state.vehicles.find(item => String(item.id) === String(currentAssignment.vehicle_id))
                  : null;
                const driverSettlementsCount = state.settlements.filter(item => String(item.driver_id) === String(driver.id)).length;
                const outstanding = driverSettlements.getDriverOutstandingBalance(driver.id);
                const docStats = documents.getEntityDocumentStats('driver', driver.id);
                const selected = state.selectedDetails?.type === 'driver' && String(state.selectedDetails.id) === String(driver.id);

                return `
                  <tr
                    class="table-row-clickable ${selected ? 'selected' : ''}"
                    data-detail-type="driver"
                    data-detail-id="${escapeHtml(driver.id)}"
                  >
                    <td>
                      <strong>${escapeHtml(fullName(driver))}</strong>
                      <div class="details-subvalue">${escapeHtml(safe(driver.email) || safe(driver.phone) || '-')}</div>
                      <div class="details-subvalue">${driverSettlements.isSettlementExcludedDriver(driver) ? 'Excluded from settlements' : 'Settlement-active profile'}</div>
                    </td>
                    <td>
                      <div>${escapeHtml(currentVehicle ? vehicleLabel(currentVehicle) : 'No active vehicle')}</div>
                      <div class="details-subvalue">${escapeHtml(currentAssignment ? `Since ${safe(currentAssignment.assigned_from)}` : 'No active assignment')}</div>
                    </td>
                    <td>
                      <div>${driverSettlementsCount} settlement(s)</div>
                      <div class="details-subvalue">${assignments.getAssignmentHistoryForDriver(driver.id).length} assignment record(s)</div>
                    </td>
                    <td class="${outstanding > 0 ? 'money-positive' : outstanding < 0 ? 'money-negative' : 'money-zero'}">
                      <strong>${money(outstanding)}</strong>
                    </td>
                    <td>
                      <span class="badge ${badgeClass(driver.contract_status)}">${escapeHtml(humanize(driver.contract_status))}</span>
                      <div class="details-subvalue">${docStats.total} doc(s), ${docStats.googleDriveLinked} linked</div>
                    </td>
                  </tr>
                `;
              }).join('') : `
                <tr><td colspan="5"><div class="empty">No drivers found.</div></td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;

    qs('newDriverBtn')?.addEventListener('click', openDriverForm);
    qs('newAssignmentFromDriversBtn')?.addEventListener('click', () => assignments.openAssignmentForm());
    qs('newDriverDocumentBtn')?.addEventListener('click', () => documents.openNewDocumentForm({ entity_type: 'driver' }));
    qs('driverSearchInput')?.addEventListener('input', event => {
      state.filters.driverSearch = event.target.value;
      renderDriversPage();
    });
    qs('driverStatusFilter')?.addEventListener('change', event => {
      state.filters.driverStatus = event.target.value;
      renderDriversPage();
    });
    qs('driverAssignmentScopeFilter')?.addEventListener('change', event => {
      state.filters.driverAssignmentScope = event.target.value;
      renderDriversPage();
    });

    document.querySelectorAll('[data-detail-type="driver"][data-detail-id]').forEach(node => {
      node.addEventListener('click', () => {
        state.selectedDetails = {
          type: 'driver',
          id: node.getAttribute('data-detail-id')
        };
        renderAll();
      });
    });

    bindDriverFormEvents();
    assignments.bindAssignmentFormEvents();
  }

  return {
    renderDriversPage
  };
}
