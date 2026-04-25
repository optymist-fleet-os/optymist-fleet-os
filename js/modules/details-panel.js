import { state } from '../state.js';
import {
  escapeHtml,
  fullName,
  humanize,
  mapById,
  money,
  num,
  ownerLabel,
  periodLabel,
  safe,
  vehicleLabel
} from '../utils.js';

export function createDetailsPanelModule({
  assignments,
  documents,
  driverSettlements,
  el,
  ownerSettlements,
  renderAll
}) {
  function renderItem(label, value, subvalue = '') {
    return `
      <div class="details-item">
        <div class="details-label">${escapeHtml(label)}</div>
        <div class="details-value">
          ${value}
          ${subvalue ? `<div class="details-subvalue">${subvalue}</div>` : ''}
        </div>
      </div>
    `;
  }

  function renderSection(title, body) {
    return `
      <div class="details-section">
        <h4>${escapeHtml(title)}</h4>
        <div class="details-list">${body}</div>
      </div>
    `;
  }

  function renderDetailsPanel() {
    if (!el.detailsPanel || !el.detailsBody || !el.detailsKicker || !el.detailsTitle) return;

    if (!state.selectedDetails) {
      el.detailsPanel.classList.add('hidden');
      return;
    }

    const driversMap = mapById(state.drivers);
    const vehiclesMap = mapById(state.vehicles);
    const ownersMap = mapById(state.owners);
    const periodsMap = mapById(state.periods);
    const selection = state.selectedDetails;

    el.detailsPanel.classList.remove('hidden');

    if (selection.type === 'driver') {
      const driver = driversMap[String(selection.id)];
      if (!driver) {
        el.detailsPanel.classList.add('hidden');
        return;
      }

      const currentAssignment = assignments.getCurrentAssignmentForDriver(driver.id);
      const currentVehicle = currentAssignment ? vehiclesMap[String(currentAssignment.vehicle_id)] : null;
      const history = assignments.getAssignmentHistoryForDriver(driver.id);
      const settlements = state.settlements.filter(item => String(item.driver_id) === String(driver.id));
      const outstanding = driverSettlements.getDriverOutstandingBalance(driver.id);
      const docStats = documents.getEntityDocumentStats('driver', driver.id);

      el.detailsKicker.textContent = 'Driver';
      el.detailsTitle.textContent = fullName(driver);
      el.detailsBody.innerHTML = `
        ${renderSection('Profile', [
          renderItem('Email', escapeHtml(safe(driver.email) || '-')),
          renderItem('Phone', escapeHtml(safe(driver.phone) || '-')),
          renderItem('Status', escapeHtml(humanize(driver.status))),
          renderItem('Contract', escapeHtml(humanize(driver.contract_status))),
          renderItem('Onboarding', escapeHtml(humanize(driver.onboarding_stage))),
          renderItem('Passport', escapeHtml(safe(driver.passport_number) || '-')),
          renderItem('Driver license', escapeHtml(safe(driver.driver_license_number) || '-'))
        ].join(''))}

        ${renderSection('Current assignment', [
          renderItem('Vehicle', escapeHtml(vehicleLabel(currentVehicle))),
          renderItem('Assigned from', escapeHtml(safe(currentAssignment?.assigned_from) || '-')),
          renderItem('Weekly rent', escapeHtml(currentAssignment ? money(currentAssignment.driver_weekly_rent) : '-'))
        ].join(''))}

        ${renderSection('Finance', [
          renderItem('Settlements', escapeHtml(String(settlements.length))),
          renderItem('Outstanding balance', `<span class="${outstanding > 0 ? 'money-positive' : outstanding < 0 ? 'money-negative' : 'money-zero'}">${escapeHtml(money(outstanding))}</span>`),
          renderItem('Documents', escapeHtml(`${docStats.total} metadata row(s)`), escapeHtml(`${docStats.googleDriveLinked} Google Drive linked`))
        ].join(''))}

        <div class="details-section">
          <h4>Assignment history</h4>
          ${assignments.renderHistoryList(history, 'driver')}
        </div>

        <div class="form-actions">
          <button type="button" class="secondary" id="driverSettlementCreateBtn">New settlement</button>
          <button type="button" class="secondary" id="driverDocumentCreateBtn">Add document</button>
          ${currentAssignment ? '<button type="button" class="secondary" id="driverEndAssignmentBtn">End assignment today</button>' : ''}
        </div>
      `;

      document.getElementById('driverSettlementCreateBtn')?.addEventListener('click', () => {
        driverSettlements.openNewSettlementForm({
          driver_id: String(driver.id),
          vehicle_id: safe(currentVehicle?.id)
        });
      });
      document.getElementById('driverDocumentCreateBtn')?.addEventListener('click', () => {
        documents.openNewDocumentForm({
          entity_type: 'driver',
          entity_id: String(driver.id),
          title: `${fullName(driver)} document`
        });
      });
      document.getElementById('driverEndAssignmentBtn')?.addEventListener('click', () => {
        assignments.endAssignmentToday(currentAssignment.id);
      });
      return;
    }

    if (selection.type === 'vehicle') {
      const vehicle = vehiclesMap[String(selection.id)];
      if (!vehicle) {
        el.detailsPanel.classList.add('hidden');
        return;
      }

      const owner = ownersMap[String(vehicle.owner_id)];
      const currentAssignment = assignments.getCurrentAssignmentForVehicle(vehicle.id);
      const currentDriver = currentAssignment ? driversMap[String(currentAssignment.driver_id)] : null;
      const history = assignments.getAssignmentHistoryForVehicle(vehicle.id);
      const docStats = documents.getEntityDocumentStats('vehicle', vehicle.id);

      el.detailsKicker.textContent = 'Vehicle';
      el.detailsTitle.textContent = vehicleLabel(vehicle);
      el.detailsBody.innerHTML = `
        ${renderSection('Vehicle', [
          renderItem('Brand / model', escapeHtml([safe(vehicle.brand), safe(vehicle.model)].filter(Boolean).join(' ') || '-')),
          renderItem('Year', escapeHtml(safe(vehicle.year) || '-')),
          renderItem('VIN', escapeHtml(safe(vehicle.vin) || '-')),
          renderItem('Fuel type', escapeHtml(humanize(vehicle.fuel_type))),
          renderItem('Status', escapeHtml(humanize(vehicle.status)))
        ].join(''))}

        ${renderSection('Ownership and compliance', [
          renderItem('Owner', escapeHtml(ownerLabel(owner))),
          renderItem('Current driver', escapeHtml(fullName(currentDriver))),
          renderItem('Insurance expiry', escapeHtml(safe(vehicle.insurance_expiry) || '-')),
          renderItem('Inspection expiry', escapeHtml(safe(vehicle.inspection_expiry) || '-')),
          renderItem('Documents', escapeHtml(`${docStats.total} metadata row(s)`), escapeHtml(`${docStats.googleDriveLinked} Google Drive linked`))
        ].join(''))}

        <div class="details-section">
          <h4>Assignment history</h4>
          ${assignments.renderHistoryList(history, 'vehicle')}
        </div>

        <div class="form-actions">
          <button type="button" class="secondary" id="vehicleDocumentCreateBtn">Add document</button>
          ${currentAssignment ? '<button type="button" class="secondary" id="vehicleEndAssignmentBtn">End assignment today</button>' : ''}
        </div>
      `;

      document.getElementById('vehicleDocumentCreateBtn')?.addEventListener('click', () => {
        documents.openNewDocumentForm({
          entity_type: 'vehicle',
          entity_id: String(vehicle.id),
          title: `${vehicleLabel(vehicle)} document`
        });
      });
      document.getElementById('vehicleEndAssignmentBtn')?.addEventListener('click', () => {
        assignments.endAssignmentToday(currentAssignment.id);
      });
      return;
    }

    if (selection.type === 'owner') {
      const owner = ownersMap[String(selection.id)];
      if (!owner) {
        el.detailsPanel.classList.add('hidden');
        return;
      }

      const vehicles = state.vehicles.filter(item => String(item.owner_id) === String(owner.id));
      const settlements = ownerSettlements.buildOwnerSettlementRows().rows.filter(item => String(item.owner_id) === String(owner.id));
      const totalPayout = settlements.reduce((sum, item) => sum + num(item.payout_to_owner), 0);
      const docStats = documents.getEntityDocumentStats('owner', owner.id);

      el.detailsKicker.textContent = 'Owner';
      el.detailsTitle.textContent = ownerLabel(owner);
      el.detailsBody.innerHTML = `
        ${renderSection('Owner', [
          renderItem('Type', escapeHtml(humanize(owner.owner_type))),
          renderItem('Email', escapeHtml(safe(owner.email) || '-')),
          renderItem('Phone', escapeHtml(safe(owner.phone) || '-')),
          renderItem('Bank account', escapeHtml(safe(owner.bank_account) || '-')),
          renderItem('Settlement terms', escapeHtml(safe(owner.settlement_terms) || '-'))
        ].join(''))}

        ${renderSection('Portfolio', [
          renderItem('Vehicles', escapeHtml(String(vehicles.length)), escapeHtml(vehicles.map(vehicle => vehicle.plate_number).slice(0, 4).join(', ') || 'No vehicles')),
          renderItem('Owner settlements', escapeHtml(String(settlements.length)), escapeHtml(money(totalPayout))),
          renderItem('Documents', escapeHtml(`${docStats.total} metadata row(s)`), escapeHtml(`${docStats.googleDriveLinked} Google Drive linked`))
        ].join(''))}

        <div class="form-actions">
          <button type="button" class="secondary" id="ownerDocumentCreateBtn">Add document</button>
        </div>
      `;

      document.getElementById('ownerDocumentCreateBtn')?.addEventListener('click', () => {
        documents.openNewDocumentForm({
          entity_type: 'owner',
          entity_id: String(owner.id),
          title: `${ownerLabel(owner)} document`
        });
      });
      return;
    }

    if (selection.type === 'settlement') {
      const settlement = state.settlements.find(item => String(item.id) === String(selection.id));
      if (!settlement) {
        el.detailsPanel.classList.add('hidden');
        return;
      }

      const driver = driversMap[String(settlement.driver_id)];
      const vehicle = vehiclesMap[String(settlement.vehicle_id)];
      const period = periodsMap[String(settlement.period_id)];
      const docMeta = driverSettlements.getSettlementDocumentMetadata(settlement);

      el.detailsKicker.textContent = 'Driver settlement';
      el.detailsTitle.textContent = `${fullName(driver)} - ${periodLabel(period)}`;
      el.detailsBody.innerHTML = `
        ${renderSection('Context', [
          renderItem('Driver', escapeHtml(fullName(driver))),
          renderItem('Vehicle', escapeHtml(vehicleLabel(vehicle))),
          renderItem('Period', escapeHtml(periodLabel(period))),
          renderItem('Status', escapeHtml(humanize(settlement.status)))
        ].join(''))}

        ${renderSection('Snapshot breakdown', [
          renderItem('Gross platform income', escapeHtml(money(settlement.gross_platform_income))),
          renderItem('Platform net income', escapeHtml(money(settlement.platform_net_income))),
          renderItem('Bonuses', escapeHtml(money(settlement.bonuses))),
          renderItem('Cash collected', escapeHtml(money(settlement.cash_collected))),
          renderItem('Company commission', escapeHtml(`${money(settlement.company_commission)} (${num(settlement.commission_rate_snapshot)}%)`)),
          renderItem('Weekly settlement fee', escapeHtml(money(settlement.weekly_settlement_fee))),
          renderItem('Rent total', escapeHtml(money(settlement.rent_total))),
          renderItem('Fuel total', escapeHtml(money(settlement.fuel_total))),
          renderItem('Penalties total', escapeHtml(money(settlement.penalties_total))),
          renderItem('Manual adjustments', escapeHtml(money(settlement.adjustments_total))),
          renderItem('Carry forward', escapeHtml(money(settlement.carry_forward_balance))),
          renderItem('Final payout', `<span class="${num(settlement.payout_to_driver) > 0 ? 'money-positive' : num(settlement.payout_to_driver) < 0 ? 'money-negative' : 'money-zero'}">${escapeHtml(money(settlement.payout_to_driver))}</span>`)
        ].join(''))}

        ${renderSection('Documents', [
          renderItem('PDF status', escapeHtml(humanize(docMeta.pdfStatus))),
          renderItem('Drive file id', escapeHtml(docMeta.driveFileId || '-')),
          renderItem('Drive folder id', escapeHtml(docMeta.driveFolderId || '-')),
          renderItem('File URL', escapeHtml(docMeta.url || '-')),
          renderItem('Notes', escapeHtml(safe(settlement.calculation_notes) || '-'))
        ].join(''))}

        <div class="status-actions">
          <button type="button" class="secondary" id="settlementEditBtn">Edit</button>
          <button type="button" class="secondary" id="settlementRecalculateBtn">Recalculate</button>
          <button type="button" class="secondary" id="settlementApproveBtn">Approve</button>
          <button type="button" class="secondary" id="settlementSendBtn">Sent</button>
          <button type="button" class="secondary" id="settlementPaidBtn">Paid</button>
          <button type="button" class="secondary" id="settlementDisputedBtn">Disputed</button>
          <button type="button" class="secondary" id="settlementDocumentCreateBtn">Add document</button>
        </div>
      `;

      document.getElementById('settlementEditBtn')?.addEventListener('click', () => {
        driverSettlements.openSettlementEditor(settlement.id);
      });
      document.getElementById('settlementRecalculateBtn')?.addEventListener('click', () => {
        driverSettlements.recalculateSettlement(settlement.id);
      });
      document.getElementById('settlementApproveBtn')?.addEventListener('click', () => {
        driverSettlements.updateSettlementStatus(settlement.id, 'approved');
      });
      document.getElementById('settlementSendBtn')?.addEventListener('click', () => {
        driverSettlements.updateSettlementStatus(settlement.id, 'sent');
      });
      document.getElementById('settlementPaidBtn')?.addEventListener('click', () => {
        driverSettlements.updateSettlementStatus(settlement.id, 'paid');
      });
      document.getElementById('settlementDisputedBtn')?.addEventListener('click', () => {
        driverSettlements.updateSettlementStatus(settlement.id, 'disputed');
      });
      document.getElementById('settlementDocumentCreateBtn')?.addEventListener('click', () => {
        documents.openNewDocumentForm({
          entity_type: 'settlement',
          entity_id: String(settlement.id),
          document_type: 'settlement_pdf',
          title: `${fullName(driver)} settlement PDF`
        });
      });
      return;
    }

    if (selection.type === 'owner-settlement') {
      const ownerSettlement = ownerSettlements.findOwnerSettlementById(selection.id);
      if (!ownerSettlement) {
        el.detailsPanel.classList.add('hidden');
        return;
      }

      el.detailsKicker.textContent = 'Owner settlement';
      el.detailsTitle.textContent = `${ownerLabel(ownerSettlement.owner)} - ${periodLabel(ownerSettlement.period)}`;
      el.detailsBody.innerHTML = `
        ${renderSection('Summary', [
          renderItem('Owner', escapeHtml(ownerLabel(ownerSettlement.owner))),
          renderItem('Period', escapeHtml(periodLabel(ownerSettlement.period))),
          renderItem('Payout base', escapeHtml(money(ownerSettlement.owner_payout_base))),
          renderItem('Adjustments', escapeHtml(money(ownerSettlement.adjustments_total))),
          renderItem('Payout to owner', escapeHtml(money(ownerSettlement.payout_to_owner))),
          renderItem('Status', escapeHtml(humanize(ownerSettlement.status)))
        ].join(''))}

        <div class="details-section">
          <h4>Vehicle breakdown</h4>
          <div class="details-list">
            ${ownerSettlement.vehicles.map(vehicleRow => renderItem(
              vehicleLabel(vehicleRow.vehicle),
              escapeHtml(money(vehicleRow.payout_to_owner)),
              escapeHtml(`${vehicleRow.driver_names.join(', ') || 'No linked driver'} | base ${money(vehicleRow.owner_payout_base)} | adj. ${money(vehicleRow.adjustments_total)}`)
            )).join('')}
          </div>
        </div>

        <div class="details-section">
          <h4>Source settlements</h4>
          <div class="details-list">
            ${ownerSettlement.vehicles.flatMap(vehicleRow =>
              vehicleRow.source_rows.map(sourceRow => renderItem(
                `${vehicleLabel(vehicleRow.vehicle)} / ${sourceRow.driver_name}`,
                escapeHtml(money(sourceRow.rent_total)),
                escapeHtml(`Settlement ${sourceRow.settlement_id.slice(0, 8)} | ${humanize(sourceRow.driver_settlement_status)} | source ${sourceRow.vehicle_source}`)
              ))
            ).join('')}
          </div>
        </div>

        ${renderSection('Document metadata', [
          renderItem('Document key', escapeHtml(ownerSettlement.document_key)),
          renderItem('Drive file id', escapeHtml(ownerSettlement.drive_file_id || '-')),
          renderItem('Drive folder id', escapeHtml(ownerSettlement.drive_folder_id || '-')),
          renderItem('File URL', escapeHtml(ownerSettlement.file_url || '-')),
          renderItem('Folder URL', escapeHtml(ownerSettlement.folder_url || '-'))
        ].join(''))}

        <div class="form-actions">
          <button type="button" class="secondary" id="ownerSettlementDocumentCreateBtn">Add document</button>
        </div>
      `;

      document.getElementById('ownerSettlementDocumentCreateBtn')?.addEventListener('click', () => {
        documents.openNewDocumentForm({
          entity_type: 'owner_settlement',
          entity_id: ownerSettlement.document_key,
          document_type: 'owner_settlement_pdf',
          title: `${ownerLabel(ownerSettlement.owner)} owner settlement PDF`
        });
      });
      return;
    }

    if (selection.type === 'document') {
      const documentRecord = state.documents.find(item => String(item.id) === String(selection.id));
      if (!documentRecord) {
        el.detailsPanel.classList.add('hidden');
        return;
      }

      el.detailsKicker.textContent = 'Document';
      el.detailsTitle.textContent = safe(documentRecord.title) || humanize(documentRecord.document_type);
      el.detailsBody.innerHTML = `
        ${renderSection('Document metadata', [
          renderItem('Entity type', escapeHtml(humanize(documentRecord.entity_type))),
          renderItem('Entity id', escapeHtml(safe(documentRecord.entity_id) || '-')),
          renderItem('Document type', escapeHtml(humanize(documentRecord.document_type))),
          renderItem('Status', escapeHtml(humanize(documentRecord.status))),
          renderItem('Storage provider', escapeHtml(humanize(documentRecord.storage_provider || 'pending')))
        ].join(''))}

        ${renderSection('Google Drive readiness', [
          renderItem('Drive file id', escapeHtml(safe(documentRecord.drive_file_id) || '-')),
          renderItem('Drive folder id', escapeHtml(safe(documentRecord.drive_folder_id) || '-')),
          renderItem('File URL', escapeHtml(safe(documentRecord.file_url) || '-')),
          renderItem('Folder URL', escapeHtml(safe(documentRecord.folder_url) || '-')),
          renderItem('MIME type', escapeHtml(safe(documentRecord.mime_type) || '-')),
          renderItem('Notes', escapeHtml(safe(documentRecord.notes) || '-'))
        ].join(''))}

        <div class="form-actions">
          <button type="button" class="secondary" id="documentEditBtn">Edit metadata</button>
        </div>
      `;

      document.getElementById('documentEditBtn')?.addEventListener('click', () => {
        documents.openDocumentEditor(documentRecord.id);
      });
      return;
    }

    el.detailsPanel.classList.add('hidden');
  }

  return {
    renderDetailsPanel
  };
}
