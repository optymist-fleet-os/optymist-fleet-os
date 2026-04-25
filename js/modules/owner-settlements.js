import { state } from '../state.js';
import {
  badgeClass,
  escapeHtml,
  fullName,
  humanize,
  mapById,
  money,
  num,
  ownerLabel,
  ownerSettlementDocKey,
  periodLabel,
  qs,
  safe,
  summarizeStatuses,
  vehicleLabel
} from '../utils.js';

export function createOwnerSettlementsModule({ assignments, documents, el, renderAll }) {
  function snapshotKey(periodId, vehicleId) {
    return `${safe(periodId)}:${safe(vehicleId)}`;
  }

  function latestOwnerSnapshotMap() {
    const map = {};

    (state.ownerVehicleSettlements || []).forEach(snapshot => {
      const key = snapshotKey(snapshot.period_id, snapshot.vehicle_id);
      if (!safe(key)) return;

      if (!map[key] || safe(snapshot.updated_at || snapshot.created_at) > safe(map[key].updated_at || map[key].created_at)) {
        map[key] = snapshot;
      }
    });

    return map;
  }

  function buildOwnerSettlementRows() {
    const periodsMap = mapById(state.periods);
    const driversMap = mapById(state.drivers);
    const vehiclesMap = mapById(state.vehicles);
    const ownersMap = mapById(state.owners);
    const snapshots = latestOwnerSnapshotMap();
    const vehicleGroups = {};
    let unresolvedCount = 0;

    state.settlements.forEach(settlement => {
      const period = periodsMap[String(settlement.period_id)];
      const driver = driversMap[String(settlement.driver_id)] || null;
      const vehicleContext = assignments.resolveSettlementVehicleContext(settlement, period);
      const vehicle = vehicleContext.vehicle;

      if (!period || !vehicle || !safe(vehicle.owner_id)) {
        unresolvedCount += 1;
        return;
      }

      const owner = ownersMap[String(vehicle.owner_id)] || null;
      if (!owner) {
        unresolvedCount += 1;
        return;
      }

      const key = snapshotKey(period.id, vehicle.id);
      if (!vehicleGroups[key]) {
        vehicleGroups[key] = {
          id: key,
          key,
          owner_id: String(owner.id),
          owner,
          vehicle_id: String(vehicle.id),
          vehicle,
          period_id: String(period.id),
          period,
          owner_payout_base: 0,
          adjustments_total: 0,
          payout_to_owner: 0,
          status_list: [],
          notes: '',
          settlement_ids: [],
          source_rows: [],
          driver_names: new Set(),
          driver_ids: new Set(),
          assignment_resolved_count: 0,
          document_key: '',
          drive_file_id: '',
          drive_folder_id: '',
          file_url: '',
          folder_url: ''
        };
      }

      const line = vehicleGroups[key];
      const baseAmount = num(settlement.rent_total);
      line.owner_payout_base += baseAmount;
      line.settlement_ids.push(String(settlement.id));
      line.status_list.push(safe(settlement.status) || 'draft');
      if (vehicleContext.source === 'assignment') line.assignment_resolved_count += 1;

      if (driver) {
        line.driver_names.add(fullName(driver));
        line.driver_ids.add(String(driver.id));
      }

      line.source_rows.push({
        settlement_id: String(settlement.id),
        driver_id: String(settlement.driver_id),
        driver_name: fullName(driver),
        driver_settlement_status: safe(settlement.status) || 'draft',
        vehicle_source: vehicleContext.source,
        rent_total: num(settlement.rent_total),
        payout_to_driver: num(settlement.payout_to_driver)
      });
    });

    const vehicleRows = Object.values(vehicleGroups)
      .map(line => {
        const snapshot = snapshots[line.key] || null;
        const adjustmentsTotal = snapshot
          ? num(snapshot.adjustments_total ?? snapshot.adjustment_total ?? snapshot.manual_adjustments_total)
          : 0;
        const payoutToOwner = snapshot && snapshot.payout_to_owner != null
          ? num(snapshot.payout_to_owner)
          : line.owner_payout_base + adjustmentsTotal;
        const doc = documents.getOwnerSettlementDocument(line);

        return {
          ...line,
          adjustments_total: adjustmentsTotal,
          payout_to_owner: payoutToOwner,
          status: safe(snapshot?.status) || summarizeStatuses(line.status_list, safe(line.period?.status) || 'draft'),
          notes: safe(snapshot?.notes),
          document_key: doc.documentKey,
          drive_file_id: safe(snapshot?.drive_file_id) || doc.driveFileId,
          drive_folder_id: safe(snapshot?.drive_folder_id) || doc.driveFolderId,
          file_url: safe(snapshot?.pdf_url) || doc.fileUrl,
          folder_url: safe(snapshot?.folder_url) || doc.folderUrl,
          snapshot
        };
      })
      .sort((left, right) => {
        const periodDiff = safe(right.period?.date_from).localeCompare(safe(left.period?.date_from));
        if (periodDiff) return periodDiff;
        return ownerLabel(left.owner).localeCompare(ownerLabel(right.owner), 'uk');
      });

    const grouped = {};
    vehicleRows.forEach(line => {
      const groupKey = `${line.period_id}:${line.owner_id}`;
      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          id: groupKey,
          owner_id: line.owner_id,
          owner: line.owner,
          period_id: line.period_id,
          period: line.period,
          owner_payout_base: 0,
          adjustments_total: 0,
          payout_to_owner: 0,
          settlement_count: 0,
          vehicle_count: 0,
          assignment_resolved_count: 0,
          driver_ids: new Set(),
          status_list: [],
          notes_list: [],
          vehicles: []
        };
      }

      const group = grouped[groupKey];
      group.owner_payout_base += num(line.owner_payout_base);
      group.adjustments_total += num(line.adjustments_total);
      group.payout_to_owner += num(line.payout_to_owner);
      group.settlement_count += line.settlement_ids.length;
      group.vehicle_count += 1;
      group.assignment_resolved_count += line.assignment_resolved_count;
      group.status_list.push(safe(line.status));
      if (safe(line.notes)) group.notes_list.push(safe(line.notes));
      line.driver_ids.forEach(id => group.driver_ids.add(id));
      group.vehicles.push({
        ...line,
        driver_names: Array.from(line.driver_names).sort((left, right) => left.localeCompare(right, 'uk'))
      });
    });

    const rows = Object.values(grouped)
      .map(group => {
        const documentKey = ownerSettlementDocKey(group);
        const doc = documents.getEntityDocuments('owner_settlement', documentKey)[0] || null;

        return {
          ...group,
          driver_count: group.driver_ids.size,
          notes: group.notes_list.join('\n'),
          status: summarizeStatuses(group.status_list, safe(group.period?.status) || 'draft'),
          document_key: documentKey,
          drive_file_id: safe(doc?.drive_file_id),
          drive_folder_id: safe(doc?.drive_folder_id),
          file_url: safe(doc?.file_url),
          folder_url: safe(doc?.folder_url)
        };
      })
      .sort((left, right) => {
        const periodDiff = safe(right.period?.date_from).localeCompare(safe(left.period?.date_from));
        if (periodDiff) return periodDiff;
        return ownerLabel(left.owner).localeCompare(ownerLabel(right.owner), 'uk');
      });

    return { rows, unresolvedCount };
  }

  function findOwnerSettlementById(ownerSettlementId) {
    return buildOwnerSettlementRows().rows.find(row => String(row.id) === String(ownerSettlementId)) || null;
  }

  function renderOwnerSettlementsPage() {
    if (!el.ownerSettlementsPage) return;

    const { rows, unresolvedCount } = buildOwnerSettlementRows();

    const filteredRows = rows.filter(row => {
      if (safe(state.filters.ownerSettlementPeriod) !== 'all' && String(row.period_id) !== String(state.filters.ownerSettlementPeriod)) {
        return false;
      }
      if (safe(state.filters.ownerSettlementOwner) !== 'all' && String(row.owner_id) !== String(state.filters.ownerSettlementOwner)) {
        return false;
      }
      if (safe(state.filters.ownerSettlementStatus) !== 'all' && safe(row.status) !== safe(state.filters.ownerSettlementStatus)) {
        return false;
      }

      const search = safe(state.filters.ownerSettlementSearch).toLowerCase();
      if (!search) return true;

      const haystack = [
        ownerLabel(row.owner),
        periodLabel(row.period),
        row.vehicles.map(vehicleRow => vehicleLabel(vehicleRow.vehicle)).join(' '),
        row.vehicles.flatMap(vehicleRow => vehicleRow.driver_names).join(' '),
        safe(row.notes)
      ].join(' ').toLowerCase();

      return haystack.includes(search);
    });

    const totalBase = filteredRows.reduce((sum, row) => sum + num(row.owner_payout_base), 0);
    const totalAdjustments = filteredRows.reduce((sum, row) => sum + num(row.adjustments_total), 0);
    const totalPayout = filteredRows.reduce((sum, row) => sum + num(row.payout_to_owner), 0);
    const linkedDocuments = filteredRows.filter(row => row.file_url || row.drive_file_id).length;

    el.ownerSettlementsPage.innerHTML = `
      <div class="cards cards-compact">
        <div class="card"><div class="metric-label">Owner settlements</div><div class="metric-value">${filteredRows.length}</div></div>
        <div class="card"><div class="metric-label">Payout base</div><div class="metric-value">${money(totalBase)}</div></div>
        <div class="card"><div class="metric-label">Adjustments</div><div class="metric-value">${money(totalAdjustments)}</div></div>
        <div class="card"><div class="metric-label">Payout total</div><div class="metric-value">${money(totalPayout)}</div></div>
        <div class="card"><div class="metric-label">Resolved by assignment history</div><div class="metric-value">${filteredRows.reduce((sum, row) => sum + row.assignment_resolved_count, 0)}</div></div>
        <div class="card"><div class="metric-label">Unresolved source rows</div><div class="metric-value">${unresolvedCount}</div></div>
        <div class="card"><div class="metric-label">Document links</div><div class="metric-value">${linkedDocuments}</div></div>
      </div>

      <div class="action-bar">
        <div class="filters filters-4">
          <input id="ownerSettlementSearchInput" placeholder="Search owner settlement" value="${escapeHtml(state.filters.ownerSettlementSearch)}" />
          <select id="ownerSettlementPeriodFilter">
            <option value="all">All periods</option>
            ${state.periods.map(period => `
              <option value="${escapeHtml(period.id)}" ${String(period.id) === String(state.filters.ownerSettlementPeriod) ? 'selected' : ''}>
                ${escapeHtml(periodLabel(period))}
              </option>
            `).join('')}
          </select>
          <select id="ownerSettlementOwnerFilter">
            <option value="all">All owners</option>
            ${state.owners.map(owner => `
              <option value="${escapeHtml(owner.id)}" ${String(owner.id) === String(state.filters.ownerSettlementOwner) ? 'selected' : ''}>
                ${escapeHtml(ownerLabel(owner))}
              </option>
            `).join('')}
          </select>
          <select id="ownerSettlementStatusFilter">
            <option value="all">All statuses</option>
            ${['draft', 'calculated', 'approved', 'sent', 'paid', 'disputed'].map(status => `
              <option value="${status}" ${status === safe(state.filters.ownerSettlementStatus) ? 'selected' : ''}>${humanize(status)}</option>
            `).join('')}
          </select>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Owner payout list</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Owner</th>
                <th>Period</th>
                <th>Vehicle breakdown</th>
                <th>Totals</th>
                <th>Status</th>
                <th>Document</th>
              </tr>
            </thead>
            <tbody>
              ${filteredRows.length ? filteredRows.map(row => {
                const selected = state.selectedDetails?.type === 'owner-settlement' && String(state.selectedDetails.id) === String(row.id);
                return `
                  <tr
                    class="table-row-clickable ${selected ? 'selected' : ''}"
                    data-detail-type="owner-settlement"
                    data-detail-id="${escapeHtml(row.id)}"
                  >
                    <td>
                      <strong>${escapeHtml(ownerLabel(row.owner))}</strong>
                      <div class="details-subvalue">${row.vehicle_count} vehicle(s), ${row.driver_count} driver(s)</div>
                    </td>
                    <td>${escapeHtml(periodLabel(row.period))}</td>
                    <td>
                      <div class="table-stack">
                        ${row.vehicles.map(vehicleRow => `
                          <div class="table-stack-item">
                            <div class="table-stack-row">
                              <span>${escapeHtml(vehicleLabel(vehicleRow.vehicle))}</span>
                              <strong>${money(vehicleRow.payout_to_owner)}</strong>
                            </div>
                            <div class="details-subvalue">${escapeHtml(vehicleRow.driver_names.join(', ') || 'No linked driver')}</div>
                          </div>
                        `).join('')}
                      </div>
                    </td>
                    <td>
                      <div class="table-stack">
                        <div class="table-stack-row"><span>Base</span><strong>${money(row.owner_payout_base)}</strong></div>
                        <div class="table-stack-row"><span>Adjustments</span><strong>${money(row.adjustments_total)}</strong></div>
                        <div class="table-stack-row"><span>Payout</span><strong>${money(row.payout_to_owner)}</strong></div>
                      </div>
                    </td>
                    <td><span class="badge ${badgeClass(row.status)}">${escapeHtml(humanize(row.status))}</span></td>
                    <td>
                      <div>${row.drive_file_id ? 'Drive linked' : 'Metadata only'}</div>
                      <div class="details-subvalue">${row.document_key}</div>
                    </td>
                  </tr>
                `;
              }).join('') : `
                <tr><td colspan="6"><div class="empty">No owner settlements yet.</div></td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;

    qs('ownerSettlementSearchInput')?.addEventListener('input', event => {
      state.filters.ownerSettlementSearch = event.target.value;
      renderOwnerSettlementsPage();
    });
    qs('ownerSettlementPeriodFilter')?.addEventListener('change', event => {
      state.filters.ownerSettlementPeriod = event.target.value;
      renderOwnerSettlementsPage();
    });
    qs('ownerSettlementOwnerFilter')?.addEventListener('change', event => {
      state.filters.ownerSettlementOwner = event.target.value;
      renderOwnerSettlementsPage();
    });
    qs('ownerSettlementStatusFilter')?.addEventListener('change', event => {
      state.filters.ownerSettlementStatus = event.target.value;
      renderOwnerSettlementsPage();
    });

    document.querySelectorAll('[data-detail-type="owner-settlement"][data-detail-id]').forEach(node => {
      node.addEventListener('click', () => {
        state.selectedDetails = {
          type: 'owner-settlement',
          id: node.getAttribute('data-detail-id')
        };
        renderAll();
      });
    });
  }

  return {
    buildOwnerSettlementRows,
    findOwnerSettlementById,
    renderOwnerSettlementsPage
  };
}
