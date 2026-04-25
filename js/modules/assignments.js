import { db } from '../supabase.js';
import {
  getInitialAssignmentDraft,
  state
} from '../state.js';
import {
  clearMsg,
  dateRangeOverlaps,
  dayBeforeIso,
  escapeHtml,
  fullName,
  money,
  nullIfBlank,
  num,
  periodLabel,
  qs,
  rangeOverlapDays,
  safe,
  showMsg,
  todayIso,
  vehicleLabel
} from '../utils.js';

export function createAssignmentsModule({ el, closeAllForms, loadAllData, renderAll, setPage }) {
  function isAssignmentActiveOn(assignment, date = todayIso()) {
    const from = safe(assignment?.assigned_from);
    const to = safe(assignment?.assigned_to) || '9999-12-31';
    return Boolean(from) && from <= safe(date) && safe(date) <= to;
  }

  function getCurrentAssignmentForDriver(driverId, date = todayIso()) {
    return (
      state.assignments
        .filter(item => String(item.driver_id) === String(driverId) && isAssignmentActiveOn(item, date))
        .sort((left, right) => safe(right.assigned_from).localeCompare(safe(left.assigned_from)))[0] || null
    );
  }

  function getCurrentAssignmentForVehicle(vehicleId, date = todayIso()) {
    return (
      state.assignments
        .filter(item => String(item.vehicle_id) === String(vehicleId) && isAssignmentActiveOn(item, date))
        .sort((left, right) => safe(right.assigned_from).localeCompare(safe(left.assigned_from)))[0] || null
    );
  }

  function getAssignmentHistoryForDriver(driverId) {
    return state.assignments
      .filter(item => String(item.driver_id) === String(driverId))
      .sort((left, right) => safe(right.assigned_from).localeCompare(safe(left.assigned_from)));
  }

  function getAssignmentHistoryForVehicle(vehicleId) {
    return state.assignments
      .filter(item => String(item.vehicle_id) === String(vehicleId))
      .sort((left, right) => safe(right.assigned_from).localeCompare(safe(left.assigned_from)));
  }

  function findBestAssignmentForSettlement(settlement, period = null) {
    if (!settlement) return null;
    const periodFrom = safe(period?.date_from);
    const periodTo = safe(period?.date_to);

    const candidates = state.assignments
      .filter(item => String(item.driver_id) === String(settlement.driver_id))
      .filter(item => {
        if (!periodFrom || !periodTo) return true;
        return dateRangeOverlaps(item.assigned_from, item.assigned_to, periodFrom, periodTo);
      })
      .map(item => ({
        assignment: item,
        overlap_days: periodFrom && periodTo
          ? rangeOverlapDays(item.assigned_from, item.assigned_to, periodFrom, periodTo)
          : 0
      }));

    if (safe(settlement.vehicle_id)) {
      const exact = candidates.find(item => String(item.assignment.vehicle_id) === String(settlement.vehicle_id));
      if (exact) return exact.assignment;
    }

    return (
      candidates
        .sort((left, right) => {
          const overlapDiff = right.overlap_days - left.overlap_days;
          if (overlapDiff) return overlapDiff;
          return safe(right.assignment.assigned_from).localeCompare(safe(left.assignment.assigned_from));
        })[0]?.assignment || null
    );
  }

  function resolveSettlementVehicleContext(settlement, period = null) {
    const directVehicle = state.vehicles.find(item => String(item.id) === String(settlement?.vehicle_id)) || null;
    if (directVehicle) {
      return {
        vehicle: directVehicle,
        assignment: findBestAssignmentForSettlement(settlement, period),
        source: 'settlement'
      };
    }

    const assignment = findBestAssignmentForSettlement(settlement, period);
    const fallbackVehicle = state.vehicles.find(item => String(item.id) === String(assignment?.vehicle_id)) || null;

    return {
      vehicle: fallbackVehicle,
      assignment,
      source: fallbackVehicle ? 'assignment' : 'unresolved'
    };
  }

  async function updateAssignmentRecord(assignmentId, payload) {
    const { error } = await db
      .from('driver_vehicle_assignments')
      .update(payload)
      .eq('id', assignmentId);

    if (error) throw error;
  }

  async function createAssignmentRecord(payload) {
    const { error } = await db.from('driver_vehicle_assignments').insert([payload]);
    if (error) throw error;
  }

  function openAssignmentForm(prefill = {}) {
    closeAllForms();

    const selectionPrefill = {};
    if (!safe(prefill.driver_id) && state.selectedDetails?.type === 'driver') {
      selectionPrefill.driver_id = safe(state.selectedDetails.id);
    }
    if (!safe(prefill.vehicle_id) && state.selectedDetails?.type === 'vehicle') {
      selectionPrefill.vehicle_id = safe(state.selectedDetails.id);
    }

    state.forms.assignment = true;
    state.assignmentDraft = getInitialAssignmentDraft({
      assigned_from: todayIso(),
      ...selectionPrefill,
      ...prefill
    });

    setPage('drivers');
    renderAll();
  }

  function closeAssignmentForm() {
    state.forms.assignment = false;
    state.assignmentDraft = getInitialAssignmentDraft();
    renderAll();
  }

  function renderAssignmentFormCard() {
    const draft = {
      ...getInitialAssignmentDraft({ assigned_from: todayIso() }),
      ...(state.assignmentDraft || {})
    };

    const selectedDriverId = safe(draft.driver_id);
    const selectedVehicleId = safe(draft.vehicle_id);
    const selectedDriverAssignment = selectedDriverId ? getCurrentAssignmentForDriver(selectedDriverId) : null;
    const selectedVehicleAssignment = selectedVehicleId ? getCurrentAssignmentForVehicle(selectedVehicleId) : null;
    const selectedRent = safe(draft.driver_weekly_rent) ||
      safe(selectedDriverAssignment?.driver_weekly_rent) ||
      safe(selectedVehicleAssignment?.driver_weekly_rent);

    return `
      <div class="form-card">
        <h3 class="form-title">Assignment</h3>
        <form id="assignmentForm">
          <div class="form-grid">
            <div class="form-field">
              <label>Driver *</label>
              <select name="driver_id" required>
                <option value="">Select driver</option>
                ${state.drivers.map(driver => {
                  const currentAssignment = getCurrentAssignmentForDriver(driver.id);
                  const currentVehicle = currentAssignment
                    ? state.vehicles.find(item => String(item.id) === String(currentAssignment.vehicle_id))
                    : null;

                  return `
                    <option value="${escapeHtml(driver.id)}" ${String(driver.id) === selectedDriverId ? 'selected' : ''}>
                      ${escapeHtml(fullName(driver))}${currentVehicle ? ` - ${escapeHtml(vehicleLabel(currentVehicle))}` : ''}
                    </option>
                  `;
                }).join('')}
              </select>
            </div>

            <div class="form-field">
              <label>Vehicle *</label>
              <select name="vehicle_id" required>
                <option value="">Select vehicle</option>
                ${state.vehicles.map(vehicle => {
                  const currentAssignment = getCurrentAssignmentForVehicle(vehicle.id);
                  const currentDriver = currentAssignment
                    ? state.drivers.find(item => String(item.id) === String(currentAssignment.driver_id))
                    : null;

                  return `
                    <option value="${escapeHtml(vehicle.id)}" ${String(vehicle.id) === selectedVehicleId ? 'selected' : ''}>
                      ${escapeHtml(vehicleLabel(vehicle))}${currentDriver ? ` - ${escapeHtml(fullName(currentDriver))}` : ''}
                    </option>
                  `;
                }).join('')}
              </select>
            </div>

            <div class="form-field">
              <label>Assigned from *</label>
              <input name="assigned_from" type="date" required value="${escapeHtml(safe(draft.assigned_from) || todayIso())}" />
            </div>

            <div class="form-field">
              <label>Assigned to</label>
              <input name="assigned_to" type="date" value="${escapeHtml(draft.assigned_to)}" />
            </div>

            <div class="form-field">
              <label>Weekly rent snapshot</label>
              <input name="driver_weekly_rent" type="number" step="0.01" value="${escapeHtml(selectedRent)}" />
            </div>

            <div class="form-field">
              <label>Notes</label>
              <input name="notes" value="${escapeHtml(draft.notes)}" />
            </div>
          </div>

          <div class="helper-text">
            If the driver or vehicle already has an active assignment, the current assignment will be auto-closed one day before the new start date.
          </div>

          <div class="form-actions">
            <button type="submit">Save assignment</button>
            <button type="button" class="secondary" id="cancelAssignmentFormBtn">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  async function onCreateAssignmentSubmit(event) {
    event.preventDefault();
    clearMsg(el.appMsg);

    const formData = new FormData(event.target);
    const driverId = safe(formData.get('driver_id'));
    const vehicleId = safe(formData.get('vehicle_id'));
    const assignedFrom = safe(formData.get('assigned_from'));
    const assignedTo = nullIfBlank(formData.get('assigned_to'));
    const driverWeeklyRent = nullIfBlank(formData.get('driver_weekly_rent'));
    const notes = nullIfBlank(formData.get('notes'));

    if (!driverId || !vehicleId || !assignedFrom) {
      showMsg(el.appMsg, 'Driver, vehicle and assigned-from date are required.');
      return;
    }

    const conflicts = state.assignments.filter(item =>
      isAssignmentActiveOn(item, assignedFrom) &&
      (String(item.driver_id) === String(driverId) || String(item.vehicle_id) === String(vehicleId))
    );

    const closeDate = dayBeforeIso(assignedFrom);

    try {
      if (conflicts.length && closeDate) {
        for (const conflict of conflicts) {
          await updateAssignmentRecord(conflict.id, { assigned_to: closeDate });
        }
      }

      await createAssignmentRecord({
        driver_id: driverId,
        vehicle_id: vehicleId,
        assigned_from: assignedFrom,
        assigned_to: assignedTo,
        driver_weekly_rent: driverWeeklyRent ? num(driverWeeklyRent) : null,
        notes
      });

      showMsg(
        el.appMsg,
        conflicts.length
          ? `Assignment saved. Closed active conflicts: ${conflicts.length}.`
          : 'Assignment saved.',
        'success'
      );

      closeAllForms();
      await loadAllData();
    } catch (error) {
      showMsg(el.appMsg, error.message || 'Failed to save assignment.');
    }
  }

  async function endAssignmentToday(assignmentId) {
    clearMsg(el.appMsg);

    try {
      await updateAssignmentRecord(assignmentId, { assigned_to: todayIso() });
      showMsg(el.appMsg, 'Assignment closed.', 'success');
      await loadAllData();
    } catch (error) {
      showMsg(el.appMsg, error.message || 'Failed to close assignment.');
    }
  }

  function bindAssignmentFormEvents() {
    const form = qs('assignmentForm');
    if (!form) return;

    form.addEventListener('submit', onCreateAssignmentSubmit);
    qs('cancelAssignmentFormBtn')?.addEventListener('click', closeAssignmentForm);

    ['driver_id', 'vehicle_id', 'assigned_from', 'assigned_to', 'driver_weekly_rent', 'notes'].forEach(name => {
      form.elements[name]?.addEventListener('change', () => {
        const data = new FormData(form);
        state.assignmentDraft = getInitialAssignmentDraft({
          driver_id: safe(data.get('driver_id')),
          vehicle_id: safe(data.get('vehicle_id')),
          assigned_from: safe(data.get('assigned_from')),
          assigned_to: safe(data.get('assigned_to')),
          driver_weekly_rent: safe(data.get('driver_weekly_rent')),
          notes: safe(data.get('notes'))
        });
      });
    });
  }

  function renderHistoryList(items, perspective = 'driver') {
    const driversMap = Object.fromEntries(state.drivers.map(item => [String(item.id), item]));
    const vehiclesMap = Object.fromEntries(state.vehicles.map(item => [String(item.id), item]));

    if (!items.length) {
      return '<div class="empty">No assignment history.</div>';
    }

    return `
      <div class="history-list">
        ${items.map(item => {
          const driver = driversMap[String(item.driver_id)];
          const vehicle = vehiclesMap[String(item.vehicle_id)];
          const headline = perspective === 'driver'
            ? vehicleLabel(vehicle)
            : fullName(driver);

          return `
            <div class="history-item">
              <div class="history-title">${escapeHtml(headline)}</div>
              <div class="history-subtitle">${escapeHtml(safe(item.assigned_from) || '-')} -> ${escapeHtml(safe(item.assigned_to) || 'active')}</div>
              <div class="history-subtitle">Rent snapshot: ${money(item.driver_weekly_rent)}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  return {
    bindAssignmentFormEvents,
    closeAssignmentForm,
    endAssignmentToday,
    findBestAssignmentForSettlement,
    getAssignmentHistoryForDriver,
    getAssignmentHistoryForVehicle,
    getCurrentAssignmentForDriver,
    getCurrentAssignmentForVehicle,
    isAssignmentActiveOn,
    openAssignmentForm,
    renderAssignmentFormCard,
    renderHistoryList,
    resolveSettlementVehicleContext
  };
}
