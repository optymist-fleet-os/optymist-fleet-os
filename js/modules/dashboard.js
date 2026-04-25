import { state } from '../state.js';
import {
  badgeClass,
  daysUntil,
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

export function createDashboardModule({
  documents,
  driverSettlements,
  el,
  ownerSettlements
}) {
  function getOperationalAlerts() {
    const alerts = [];

    state.vehicles.forEach(vehicle => {
      const insuranceDays = daysUntil(vehicle.insurance_expiry);
      if (insuranceDays != null && insuranceDays <= 30) {
        alerts.push({
          type: 'insurance',
          severity: insuranceDays < 0 ? 'disputed' : insuranceDays <= 7 ? 'pending' : 'draft',
          title: `${vehicleLabel(vehicle)} insurance`,
          detail: insuranceDays < 0 ? `Expired ${Math.abs(insuranceDays)} day(s) ago` : `Expires in ${insuranceDays} day(s)`
        });
      }

      const inspectionDays = daysUntil(vehicle.inspection_expiry);
      if (inspectionDays != null && inspectionDays <= 30) {
        alerts.push({
          type: 'inspection',
          severity: inspectionDays < 0 ? 'disputed' : inspectionDays <= 7 ? 'pending' : 'draft',
          title: `${vehicleLabel(vehicle)} inspection`,
          detail: inspectionDays < 0 ? `Expired ${Math.abs(inspectionDays)} day(s) ago` : `Expires in ${inspectionDays} day(s)`
        });
      }
    });

    state.drivers.forEach(driver => {
      const contractDocs = documents.getEntityDocuments('driver', driver.id).filter(doc => safe(doc.document_type) === 'contract');
      if (safe(driver.contract_status) === 'missing' || (!contractDocs.length && safe(driver.contract_status) !== 'signed')) {
        alerts.push({
          type: 'driver_contract',
          severity: 'pending',
          title: fullName(driver),
          detail: contractDocs.length ? `Contract status: ${humanize(driver.contract_status)}` : 'Missing contract metadata'
        });
      }
    });

    state.tasksAlerts.forEach(task => {
      alerts.push({
        type: 'task',
        severity: safe(task.status) || 'draft',
        title: safe(task.title) || safe(task.task_name) || 'Task',
        detail: safe(task.notes) || safe(task.description) || safe(task.due_date) || '-'
      });
    });

    const severityOrder = {
      disputed: 0,
      pending: 1,
      draft: 2,
      ready: 3,
      active: 4
    };

    return alerts.sort((left, right) => {
      const leftScore = severityOrder[left.severity] ?? 99;
      const rightScore = severityOrder[right.severity] ?? 99;
      if (leftScore !== rightScore) return leftScore - rightScore;
      return left.title.localeCompare(right.title, 'uk');
    });
  }

  function renderDashboard() {
    if (!el.dashboardPage) return;

    const periodsMap = mapById(state.periods);
    const driversMap = mapById(state.drivers);
    const vehiclesMap = mapById(state.vehicles);
    const ownerSettlementRows = ownerSettlements.buildOwnerSettlementRows().rows;
    const totalGross = state.settlements.reduce((sum, item) => sum + num(item.gross_platform_income), 0);
    const totalCommission = state.settlements.reduce((sum, item) => sum + num(item.company_commission), 0);
    const totalDriverPayout = state.settlements.reduce((sum, item) => sum + num(item.payout_to_driver), 0);
    const totalOwnerPayout = ownerSettlementRows.reduce((sum, item) => sum + num(item.payout_to_owner), 0);
    const outstandingBalance = driverSettlements.getOutstandingBalanceTotal();
    const unresolvedReconciliation = state.reconciliationIssues.filter(issue =>
      ['open', 'pending_review'].includes(safe(issue.status))
    ).length;
    const alerts = getOperationalAlerts().slice(0, 8);
    const latestSettlements = [...state.settlements]
      .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))
      .slice(0, 6);
    const latestOwnerSettlements = ownerSettlementRows.slice(0, 6);

    el.dashboardPage.innerHTML = `
      <div class="cards cards-dashboard">
        <div class="card"><div class="metric-label">Drivers</div><div class="metric-value">${state.drivers.length}</div></div>
        <div class="card"><div class="metric-label">Vehicles</div><div class="metric-value">${state.vehicles.length}</div></div>
        <div class="card"><div class="metric-label">Owners</div><div class="metric-value">${state.owners.length}</div></div>
        <div class="card"><div class="metric-label">Periods</div><div class="metric-value">${state.periods.length}</div></div>
        <div class="card"><div class="metric-label">Driver settlements</div><div class="metric-value">${state.settlements.length}</div></div>
        <div class="card"><div class="metric-label">Owner settlements</div><div class="metric-value">${ownerSettlementRows.length}</div></div>
        <div class="card"><div class="metric-label">Total gross</div><div class="metric-value">${money(totalGross)}</div></div>
        <div class="card"><div class="metric-label">Company commission</div><div class="metric-value">${money(totalCommission)}</div></div>
        <div class="card"><div class="metric-label">Payout to drivers</div><div class="metric-value">${money(totalDriverPayout)}</div></div>
        <div class="card"><div class="metric-label">Payout to owners</div><div class="metric-value">${money(totalOwnerPayout)}</div></div>
        <div class="card"><div class="metric-label">Outstanding balances</div><div class="metric-value">${money(outstandingBalance)}</div></div>
        <div class="card"><div class="metric-label">Reconciliation issues</div><div class="metric-value">${unresolvedReconciliation}</div></div>
        <div class="card"><div class="metric-label">Operational alerts</div><div class="metric-value">${alerts.length}</div></div>
      </div>

      <div class="layout-3">
        <div class="card">
          <h3 class="card-title">Latest driver settlements</h3>
          ${latestSettlements.length ? latestSettlements.map(settlement => `
            <div class="row">
              <div>
                <strong>${escapeHtml(fullName(driversMap[String(settlement.driver_id)]))}</strong>
                <div class="details-subvalue">${escapeHtml(vehicleLabel(vehiclesMap[String(settlement.vehicle_id)]))}</div>
                <div class="details-subvalue">${escapeHtml(periodLabel(periodsMap[String(settlement.period_id)]))}</div>
              </div>
              <div style="text-align:right">
                <strong>${money(settlement.payout_to_driver)}</strong>
                <div><span class="badge ${badgeClass(settlement.status)}">${escapeHtml(humanize(settlement.status))}</span></div>
              </div>
            </div>
          `).join('') : '<div class="empty">No settlements yet.</div>'}
        </div>

        <div class="card">
          <h3 class="card-title">Latest owner settlements</h3>
          ${latestOwnerSettlements.length ? latestOwnerSettlements.map(row => `
            <div class="row">
              <div>
                <strong>${escapeHtml(ownerLabel(row.owner))}</strong>
                <div class="details-subvalue">${escapeHtml(periodLabel(row.period))}</div>
              </div>
              <div style="text-align:right">
                <strong>${money(row.payout_to_owner)}</strong>
                <div><span class="badge ${badgeClass(row.status)}">${escapeHtml(humanize(row.status))}</span></div>
              </div>
            </div>
          `).join('') : '<div class="empty">No owner settlements yet.</div>'}
        </div>

        <div class="card">
          <h3 class="card-title">Operations</h3>
          ${alerts.length ? alerts.map(alert => `
            <div class="row">
              <div>
                <strong>${escapeHtml(alert.title)}</strong>
                <div class="details-subvalue">${escapeHtml(alert.detail)}</div>
              </div>
              <div><span class="badge ${badgeClass(alert.severity)}">${escapeHtml(humanize(alert.type))}</span></div>
            </div>
          `).join('') : '<div class="empty">No urgent alerts.</div>'}
        </div>
      </div>
    `;
  }

  return {
    getOperationalAlerts,
    renderDashboard
  };
}
