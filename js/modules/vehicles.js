import { db } from '../supabase.js';
import { closeAllForms, state } from '../state.js';
import {
  badgeClass,
  clearMsg,
  daysUntil,
  escapeHtml,
  humanize,
  nullIfBlank,
  ownerLabel,
  qs,
  safe,
  showMsg,
  vehicleLabel
} from '../utils.js';

export function createVehiclesModule({
  assignments,
  documents,
  el,
  loadAllData,
  renderAll
}) {
  function openVehicleForm() {
    closeAllForms();
    state.forms.vehicle = true;
    renderAll();
  }

  async function createVehicle(payload) {
    const { error } = await db.from('vehicles').insert([payload]);
    if (error) throw error;
  }

  async function onCreateVehicleSubmit(event) {
    event.preventDefault();
    clearMsg(el.appMsg);

    const formData = new FormData(event.target);
    const ownerId = safe(formData.get('owner_id'));
    const plateNumber = safe(formData.get('plate_number'));

    if (!ownerId || !plateNumber) {
      showMsg(el.appMsg, 'Owner and plate number are required.');
      return;
    }

    try {
      await createVehicle({
        owner_id: ownerId,
        plate_number: plateNumber,
        vin: nullIfBlank(formData.get('vin')),
        brand: nullIfBlank(formData.get('brand')),
        model: nullIfBlank(formData.get('model')),
        year: nullIfBlank(formData.get('year')) ? Number(formData.get('year')) : null,
        fuel_type: safe(formData.get('fuel_type')) || 'hybrid',
        ownership_type: safe(formData.get('ownership_type')) || 'owner_external',
        insurance_expiry: nullIfBlank(formData.get('insurance_expiry')),
        inspection_expiry: nullIfBlank(formData.get('inspection_expiry')),
        status: safe(formData.get('status')) || 'active',
        notes: nullIfBlank(formData.get('notes'))
      });

      showMsg(el.appMsg, 'Vehicle created.', 'success');
      closeAllForms();
      await loadAllData();
    } catch (error) {
      showMsg(el.appMsg, error.message || 'Failed to create vehicle.');
    }
  }

  function renderVehicleFormCard() {
    return `
      <div class="form-card">
        <h3 class="form-title">New vehicle</h3>
        <form id="vehicleForm">
          <div class="form-grid-wide">
            <div class="form-field">
              <label>Owner *</label>
              <select name="owner_id" required>
                <option value="">Select owner</option>
                ${state.owners.map(owner => `
                  <option value="${escapeHtml(owner.id)}">${escapeHtml(ownerLabel(owner))}</option>
                `).join('')}
              </select>
            </div>

            <div class="form-field">
              <label>Plate number *</label>
              <input name="plate_number" required />
            </div>

            <div class="form-field">
              <label>VIN</label>
              <input name="vin" />
            </div>

            <div class="form-field">
              <label>Status</label>
              <select name="status">
                <option value="active">Active</option>
                <option value="maintenance">Maintenance</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div class="form-field">
              <label>Brand</label>
              <input name="brand" />
            </div>

            <div class="form-field">
              <label>Model</label>
              <input name="model" />
            </div>

            <div class="form-field">
              <label>Year</label>
              <input name="year" type="number" step="1" />
            </div>

            <div class="form-field">
              <label>Fuel type</label>
              <select name="fuel_type">
                <option value="hybrid">Hybrid</option>
                <option value="petrol">Petrol</option>
                <option value="diesel">Diesel</option>
                <option value="electric">Electric</option>
              </select>
            </div>

            <div class="form-field">
              <label>Ownership type</label>
              <select name="ownership_type">
                <option value="owner_external">Owner external</option>
                <option value="fleet_owned">Fleet owned</option>
                <option value="leased">Leased</option>
              </select>
            </div>

            <div class="form-field">
              <label>Insurance expiry</label>
              <input name="insurance_expiry" type="date" />
            </div>

            <div class="form-field">
              <label>Inspection expiry</label>
              <input name="inspection_expiry" type="date" />
            </div>

            <div class="form-field form-field-span-2">
              <label>Notes</label>
              <textarea name="notes" rows="3"></textarea>
            </div>
          </div>

          <div class="form-actions">
            <button type="submit">Create vehicle</button>
            <button type="button" class="secondary" id="cancelVehicleFormBtn">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  function bindVehicleFormEvents() {
    const form = qs('vehicleForm');
    if (!form) return;

    form.addEventListener('submit', onCreateVehicleSubmit);
    qs('cancelVehicleFormBtn')?.addEventListener('click', () => {
      state.forms.vehicle = false;
      renderAll();
    });
  }

  function expiryText(dateValue) {
    const days = daysUntil(dateValue);
    if (days == null) return '-';
    if (days < 0) return `Expired ${Math.abs(days)}d ago`;
    return `${days}d left`;
  }

  function renderVehiclesPage() {
    if (!el.vehiclesPage) return;

    const filteredVehicles = state.vehicles
      .filter(vehicle => {
        if (safe(state.filters.vehicleStatus) !== 'all' && safe(vehicle.status) !== safe(state.filters.vehicleStatus)) {
          return false;
        }

        const currentAssignment = assignments.getCurrentAssignmentForVehicle(vehicle.id);
        const scope = safe(state.filters.vehicleAssignmentScope);
        if (scope === 'active' && !currentAssignment) return false;
        if (scope === 'unassigned' && currentAssignment) return false;
        if (scope === 'history' && !assignments.getAssignmentHistoryForVehicle(vehicle.id).length) return false;

        const search = safe(state.filters.vehicleSearch).toLowerCase();
        if (!search) return true;

        const owner = state.owners.find(item => String(item.id) === String(vehicle.owner_id));
        const haystack = [
          vehicleLabel(vehicle),
          ownerLabel(owner),
          safe(vehicle.vin),
          safe(vehicle.notes)
        ].join(' ').toLowerCase();

        return haystack.includes(search);
      })
      .sort((left, right) => vehicleLabel(left).localeCompare(vehicleLabel(right), 'uk'));

    el.vehiclesPage.innerHTML = `
      <div class="action-bar">
        <div class="filters filters-4">
          <input id="vehicleSearchInput" placeholder="Search vehicles" value="${escapeHtml(state.filters.vehicleSearch)}" />
          <select id="vehicleStatusFilter">
            <option value="all">All statuses</option>
            ${['active', 'maintenance', 'inactive'].map(status => `
              <option value="${status}" ${status === safe(state.filters.vehicleStatus) ? 'selected' : ''}>${humanize(status)}</option>
            `).join('')}
          </select>
          <select id="vehicleAssignmentScopeFilter">
            <option value="all">All assignment scopes</option>
            <option value="active" ${safe(state.filters.vehicleAssignmentScope) === 'active' ? 'selected' : ''}>Active assignment</option>
            <option value="unassigned" ${safe(state.filters.vehicleAssignmentScope) === 'unassigned' ? 'selected' : ''}>Unassigned</option>
            <option value="history" ${safe(state.filters.vehicleAssignmentScope) === 'history' ? 'selected' : ''}>Has history</option>
          </select>
        </div>

        <div class="button-cluster">
          <button type="button" id="newVehicleBtn">New vehicle</button>
          <button type="button" class="secondary" id="newAssignmentFromVehiclesBtn">Assign driver</button>
          <button type="button" class="secondary" id="newVehicleDocumentBtn">Add document metadata</button>
        </div>
      </div>

      ${state.forms.vehicle ? renderVehicleFormCard() : ''}
      ${state.forms.assignment ? assignments.renderAssignmentFormCard() : ''}

      <div class="card">
        <h3 class="card-title">Vehicles</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Owner / current driver</th>
                <th>Compliance</th>
                <th>Status</th>
                <th>Documents</th>
              </tr>
            </thead>
            <tbody>
              ${filteredVehicles.length ? filteredVehicles.map(vehicle => {
                const owner = state.owners.find(item => String(item.id) === String(vehicle.owner_id));
                const currentAssignment = assignments.getCurrentAssignmentForVehicle(vehicle.id);
                const currentDriver = currentAssignment
                  ? state.drivers.find(item => String(item.id) === String(currentAssignment.driver_id))
                  : null;
                const docStats = documents.getEntityDocumentStats('vehicle', vehicle.id);
                const selected = state.selectedDetails?.type === 'vehicle' && String(state.selectedDetails.id) === String(vehicle.id);

                return `
                  <tr
                    class="table-row-clickable ${selected ? 'selected' : ''}"
                    data-detail-type="vehicle"
                    data-detail-id="${escapeHtml(vehicle.id)}"
                  >
                    <td>
                      <strong>${escapeHtml(vehicleLabel(vehicle))}</strong>
                      <div class="details-subvalue">${escapeHtml(safe(vehicle.vin) || '-')}</div>
                    </td>
                    <td>
                      <div>${escapeHtml(ownerLabel(owner))}</div>
                      <div class="details-subvalue">${escapeHtml(currentDriver ? `Driver: ${currentDriver.full_name || currentDriver.email}` : 'No active driver')}</div>
                    </td>
                    <td>
                      <div>Insurance: ${escapeHtml(safe(vehicle.insurance_expiry) || '-')}</div>
                      <div class="details-subvalue">${expiryText(vehicle.insurance_expiry)}</div>
                      <div>Inspection: ${escapeHtml(safe(vehicle.inspection_expiry) || '-')}</div>
                      <div class="details-subvalue">${expiryText(vehicle.inspection_expiry)}</div>
                    </td>
                    <td><span class="badge ${badgeClass(vehicle.status)}">${escapeHtml(humanize(vehicle.status))}</span></td>
                    <td>${docStats.total} doc(s)<div class="details-subvalue">${docStats.googleDriveLinked} Drive-linked</div></td>
                  </tr>
                `;
              }).join('') : `
                <tr><td colspan="5"><div class="empty">No vehicles found.</div></td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;

    qs('newVehicleBtn')?.addEventListener('click', openVehicleForm);
    qs('newAssignmentFromVehiclesBtn')?.addEventListener('click', () => assignments.openAssignmentForm());
    qs('newVehicleDocumentBtn')?.addEventListener('click', () => documents.openNewDocumentForm({ entity_type: 'vehicle' }));
    qs('vehicleSearchInput')?.addEventListener('input', event => {
      state.filters.vehicleSearch = event.target.value;
      renderVehiclesPage();
    });
    qs('vehicleStatusFilter')?.addEventListener('change', event => {
      state.filters.vehicleStatus = event.target.value;
      renderVehiclesPage();
    });
    qs('vehicleAssignmentScopeFilter')?.addEventListener('change', event => {
      state.filters.vehicleAssignmentScope = event.target.value;
      renderVehiclesPage();
    });

    document.querySelectorAll('[data-detail-type="vehicle"][data-detail-id]').forEach(node => {
      node.addEventListener('click', () => {
        state.selectedDetails = {
          type: 'vehicle',
          id: node.getAttribute('data-detail-id')
        };
        renderAll();
      });
    });

    bindVehicleFormEvents();
    assignments.bindAssignmentFormEvents();
  }

  return {
    renderVehiclesPage
  };
}
