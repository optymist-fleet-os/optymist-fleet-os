import { db } from '../supabase.js';
import {
  getInitialSettlementDraft,
  state
} from '../state.js';
import {
  badgeClass,
  clearMsg,
  decimalInputValue,
  escapeHtml,
  firstNumericValue,
  fullName,
  humanize,
  isoNow,
  mapById,
  money,
  nullIfBlank,
  num,
  payoutToneClass,
  percentValue,
  periodLabel,
  qs,
  rangeOverlapDays,
  safe,
  settlementPeriodLabel,
  showMsg,
  sortByDateDesc,
  vehicleLabel
} from '../utils.js';

const SETTLEMENT_STATUSES = ['draft', 'calculated', 'approved', 'sent', 'paid', 'disputed'];

export function createDriverSettlementsModule({
  assignments,
  closeAllForms,
  el,
  loadAllData,
  renderAll,
  setPage
}) {
  function settingKey(row) {
    return safe(
      row?.key ||
      row?.setting_key ||
      row?.code ||
      row?.name ||
      row?.slug
    ).toLowerCase();
  }

  function settingNumber(row) {
    return firstNumericValue(row, [
      'value_number',
      'number_value',
      'numeric_value',
      'decimal_value',
      'value',
      'setting_value',
      'text_value'
    ]);
  }

  function commissionRuleKey(row) {
    return safe(
      row?.rule_key ||
      row?.code ||
      row?.name ||
      row?.slug ||
      row?.rule_type ||
      row?.applies_to ||
      row?.target
    ).toLowerCase();
  }

  function commissionRuleNumber(row) {
    return firstNumericValue(row, [
      'percent_value',
      'percentage',
      'rate_percent',
      'rate',
      'value_number',
      'value'
    ]);
  }

  function findSettingNumber(keys) {
    const normalizedKeys = (keys || []).map(key => safe(key).toLowerCase()).filter(Boolean);

    for (const row of state.appSettings || []) {
      const key = settingKey(row);
      if (!key) continue;
      if (!normalizedKeys.some(candidate => key.includes(candidate))) continue;
      const value = settingNumber(row);
      if (value != null) return value;
    }

    return null;
  }

  function findCommissionRuleNumber(keys) {
    const normalizedKeys = (keys || []).map(key => safe(key).toLowerCase()).filter(Boolean);

    for (const row of state.commissionRules || []) {
      const key = commissionRuleKey(row);
      if (!key) continue;
      if (!normalizedKeys.some(candidate => key.includes(candidate))) continue;
      const value = commissionRuleNumber(row);
      if (value != null) return value;
    }

    return null;
  }

  function getSettlementConfig() {
    const commissionRatePercent =
      findSettingNumber(['driver_settlement_commission_rate', 'company_commission_rate', 'default_commission_rate']) ??
      findCommissionRuleNumber(['driver', 'default']) ??
      8;

    const weeklySettlementFee =
      findSettingNumber(['driver_weekly_settlement_fee', 'weekly_settlement_fee']) ??
      50;

    return {
      commissionRatePercent,
      weeklySettlementFee
    };
  }

  function isSettlementExcludedDriver(driver) {
    if (!driver) return true;

    if (driver.exclude_from_settlements === true) return true;

    const driverType = safe(driver.driver_type).toLowerCase();
    if (['service', 'admin', 'office', 'support', 'system'].includes(driverType)) return true;
    if (driver.is_service_profile === true) return true;

    const haystack = [
      safe(driver.full_name),
      safe(driver.first_name),
      safe(driver.last_name),
      safe(driver.email),
      safe(driver.notes)
    ].join(' ').toLowerCase();

    return /\b(admin|biuro|office|service|support|system)\b/.test(haystack);
  }

  function settlementDrivers() {
    return [...state.drivers]
      .filter(driver => !isSettlementExcludedDriver(driver))
      .sort((left, right) => fullName(left).localeCompare(fullName(right), 'uk'));
  }

  function settlementToDraft(settlement) {
    if (!settlement) return getInitialSettlementDraft();

    return getInitialSettlementDraft({
      settlement_id: safe(settlement.id),
      period_id: safe(settlement.period_id),
      driver_id: safe(settlement.driver_id),
      vehicle_id: safe(settlement.vehicle_id),
      gross_platform_income: decimalInputValue(settlement.gross_platform_income),
      platform_net_income: decimalInputValue(settlement.platform_net_income),
      bonuses: decimalInputValue(settlement.bonuses, '0'),
      cash_collected: decimalInputValue(settlement.cash_collected, '0'),
      commission_rate_snapshot: percentValue(settlement.commission_rate_snapshot, '8'),
      company_commission: decimalInputValue(settlement.company_commission, '0'),
      weekly_settlement_fee: decimalInputValue(settlement.weekly_settlement_fee, '0'),
      rent_total: decimalInputValue(settlement.rent_total),
      fuel_total: decimalInputValue(settlement.fuel_total, '0'),
      penalties_total: decimalInputValue(settlement.penalties_total, '0'),
      adjustments_total: decimalInputValue(settlement.adjustments_total, '0'),
      carry_forward_balance: decimalInputValue(settlement.carry_forward_balance, '0'),
      status: safe(settlement.status) || 'draft',
      calculation_notes: safe(settlement.calculation_notes),
      pdf_status: safe(settlement.pdf_status) || 'not_generated',
      pdf_url: safe(settlement.pdf_url),
      drive_file_id: safe(settlement.drive_file_id),
      drive_folder_id: safe(settlement.drive_folder_id)
    });
  }

  function readSettlementDraftFromForm(form) {
    const formData = new FormData(form);

    return getInitialSettlementDraft({
      settlement_id: safe(formData.get('settlement_id')),
      period_id: safe(formData.get('period_id')),
      driver_id: safe(formData.get('driver_id')),
      vehicle_id: safe(formData.get('vehicle_id')),
      gross_platform_income: safe(formData.get('gross_platform_income')),
      platform_net_income: safe(formData.get('platform_net_income')),
      bonuses: safe(formData.get('bonuses')) || '0',
      cash_collected: safe(formData.get('cash_collected')) || '0',
      commission_rate_snapshot: safe(formData.get('commission_rate_snapshot')),
      company_commission: safe(formData.get('company_commission')) || '0',
      weekly_settlement_fee: safe(formData.get('weekly_settlement_fee')) || '0',
      rent_total: safe(formData.get('rent_total')),
      fuel_total: safe(formData.get('fuel_total')) || '0',
      penalties_total: safe(formData.get('penalties_total')) || '0',
      adjustments_total: safe(formData.get('adjustments_total')) || '0',
      carry_forward_balance: safe(formData.get('carry_forward_balance')) || '0',
      status: safe(formData.get('status')) || 'draft',
      calculation_notes: safe(formData.get('calculation_notes')),
      pdf_status: safe(formData.get('pdf_status')) || 'not_generated',
      pdf_url: safe(formData.get('pdf_url')),
      drive_file_id: safe(formData.get('drive_file_id')),
      drive_folder_id: safe(formData.get('drive_folder_id'))
    });
  }

  function findExistingSettlement(periodId, driverId, excludeId = '') {
    return (
      state.settlements.find(item =>
        String(item.period_id) === String(periodId) &&
        String(item.driver_id) === String(driverId) &&
        String(item.id) !== String(excludeId || '')
      ) || null
    );
  }

  function previousSettlementForDriver(driverId, period) {
    if (!driverId || !period) return null;
    const periodsMap = mapById(state.periods);

    return (
      state.settlements
        .filter(item => {
          if (String(item.driver_id) !== String(driverId)) return false;
          const settlementPeriod = periodsMap[String(item.period_id)];
          return settlementPeriod && safe(settlementPeriod.date_from) < safe(period.date_from);
        })
        .sort((left, right) => {
          const leftPeriod = periodsMap[String(left.period_id)];
          const rightPeriod = periodsMap[String(right.period_id)];
          return safe(rightPeriod?.date_from).localeCompare(safe(leftPeriod?.date_from));
        })[0] || null
    );
  }

  function defaultCarryForwardValue(previousSettlement) {
    if (!previousSettlement) return 0;
    if (safe(previousSettlement.status).toLowerCase() === 'paid') return 0;
    return num(previousSettlement.payout_to_driver);
  }

  function getAssignmentsForDriverPeriod(driverId, period) {
    if (!driverId || !period) return [];

    return state.assignments
      .filter(item =>
        String(item.driver_id) === String(driverId) &&
        safe(item.assigned_from) <= safe(period.date_to) &&
        (safe(item.assigned_to) || '9999-12-31') >= safe(period.date_from)
      )
      .map(item => {
        const boundedDays = rangeOverlapDays(
          item.assigned_from,
          item.assigned_to,
          period.date_from,
          period.date_to
        );
        return {
          ...item,
          overlap_days: boundedDays,
          prorated_rent_total: num(item.driver_weekly_rent) * (boundedDays / 7)
        };
      })
      .sort((left, right) => {
        const overlapDiff = num(right.overlap_days) - num(left.overlap_days);
        if (overlapDiff) return overlapDiff;
        return safe(right.assigned_from).localeCompare(safe(left.assigned_from));
      });
  }

  function buildDriverSettlementContext(draft = state.settlementDraft) {
    const periodsMap = mapById(state.periods);
    const vehiclesMap = mapById(state.vehicles);
    const config = getSettlementConfig();

    const period = periodsMap[String(draft.period_id)];
    const driver = settlementDrivers().find(item => String(item.id) === String(draft.driver_id)) || null;
    const assignmentsForPeriod = getAssignmentsForDriverPeriod(draft.driver_id, period);
    const previousSettlement = previousSettlementForDriver(draft.driver_id, period);

    let selectedAssignment = null;
    if (safe(draft.vehicle_id)) {
      selectedAssignment = assignmentsForPeriod.find(item => String(item.vehicle_id) === String(draft.vehicle_id)) || null;
    }
    if (!selectedAssignment) selectedAssignment = assignmentsForPeriod[0] || null;

    const inferredVehicleId = safe(draft.vehicle_id) || safe(selectedAssignment?.vehicle_id);
    const vehicle = vehiclesMap[String(inferredVehicleId)] || null;
    const inferredRentTotal = assignmentsForPeriod.reduce((sum, item) => sum + num(item.prorated_rent_total), 0);
    const commissionRatePercent = safe(draft.commission_rate_snapshot)
      ? num(draft.commission_rate_snapshot)
      : num(config.commissionRatePercent);
    const effectivePlatformNetIncome = safe(draft.platform_net_income)
      ? num(draft.platform_net_income)
      : num(draft.gross_platform_income);
    const effectiveCompanyCommission = safe(draft.company_commission)
      ? num(draft.company_commission)
      : effectivePlatformNetIncome * (commissionRatePercent / 100);
    const effectiveWeeklySettlementFee = safe(draft.weekly_settlement_fee)
      ? num(draft.weekly_settlement_fee)
      : num(config.weeklySettlementFee);
    const effectiveRentTotal = safe(draft.rent_total) ? num(draft.rent_total) : inferredRentTotal;
    const effectiveCarryForwardBalance = safe(draft.carry_forward_balance)
      ? num(draft.carry_forward_balance)
      : defaultCarryForwardValue(previousSettlement);

    const calculatedPayout =
      effectivePlatformNetIncome +
      num(draft.bonuses) -
      num(draft.cash_collected) -
      effectiveCompanyCommission -
      effectiveWeeklySettlementFee -
      effectiveRentTotal -
      num(draft.fuel_total) -
      num(draft.penalties_total) +
      num(draft.adjustments_total) +
      effectiveCarryForwardBalance;

    const existingSettlement =
      (safe(draft.settlement_id) &&
        state.settlements.find(item => String(item.id) === String(draft.settlement_id))) ||
      findExistingSettlement(draft.period_id, draft.driver_id, draft.settlement_id);

    return {
      assignmentsForPeriod,
      commissionRatePercent,
      config,
      calculatedPayout,
      driver,
      effectiveCarryForwardBalance,
      effectiveCompanyCommission,
      effectivePlatformNetIncome,
      effectiveRentTotal,
      effectiveWeeklySettlementFee,
      existingSettlement,
      inferredRentTotal,
      inferredVehicleId,
      period,
      previousSettlement,
      selectedAssignment,
      vehicle
    };
  }

  function applySettlementDraftDefaults(draft, options = {}) {
    const context = buildDriverSettlementContext(draft);
    const forceDerived = options.forceDerived === true;

    return getInitialSettlementDraft({
      ...draft,
      vehicle_id: safe(draft.vehicle_id) || safe(context.inferredVehicleId),
      platform_net_income:
        safe(draft.platform_net_income) && !forceDerived
          ? draft.platform_net_income
          : decimalInputValue(context.effectivePlatformNetIncome, '0'),
      commission_rate_snapshot:
        safe(draft.commission_rate_snapshot) && !forceDerived
          ? draft.commission_rate_snapshot
          : percentValue(context.commissionRatePercent, '8'),
      company_commission:
        safe(draft.company_commission) && !forceDerived
          ? draft.company_commission
          : decimalInputValue(context.effectiveCompanyCommission, '0'),
      weekly_settlement_fee:
        safe(draft.weekly_settlement_fee) && !forceDerived
          ? draft.weekly_settlement_fee
          : decimalInputValue(context.effectiveWeeklySettlementFee, '0'),
      rent_total:
        safe(draft.rent_total) && !forceDerived
          ? draft.rent_total
          : decimalInputValue(context.effectiveRentTotal, '0'),
      carry_forward_balance:
        safe(draft.carry_forward_balance) && !forceDerived
          ? draft.carry_forward_balance
          : decimalInputValue(context.effectiveCarryForwardBalance, '0'),
      pdf_status: safe(draft.pdf_status) || 'not_generated',
      status: options.nextStatus || draft.status || 'draft'
    });
  }

  function settlementPayloadFromDraft(draft, statusOverride = '') {
    const normalizedDraft = applySettlementDraftDefaults(draft, { forceDerived: true });
    const context = buildDriverSettlementContext(normalizedDraft);

    return {
      period_id: normalizedDraft.period_id,
      driver_id: normalizedDraft.driver_id,
      vehicle_id: safe(normalizedDraft.vehicle_id) || safe(context.inferredVehicleId) || null,
      gross_platform_income: num(normalizedDraft.gross_platform_income),
      platform_net_income: context.effectivePlatformNetIncome,
      bonuses: num(normalizedDraft.bonuses),
      cash_collected: num(normalizedDraft.cash_collected),
      company_commission: context.effectiveCompanyCommission,
      commission_rate_snapshot: context.commissionRatePercent,
      weekly_settlement_fee: context.effectiveWeeklySettlementFee,
      rent_total: context.effectiveRentTotal,
      fuel_total: num(normalizedDraft.fuel_total),
      penalties_total: num(normalizedDraft.penalties_total),
      adjustments_total: num(normalizedDraft.adjustments_total),
      carry_forward_balance: context.effectiveCarryForwardBalance,
      payout_to_driver: context.calculatedPayout,
      status: statusOverride || normalizedDraft.status || 'draft',
      calculation_notes: nullIfBlank(normalizedDraft.calculation_notes),
      pdf_status: safe(normalizedDraft.pdf_status) || 'not_generated',
      pdf_url: nullIfBlank(normalizedDraft.pdf_url),
      drive_file_id: nullIfBlank(normalizedDraft.drive_file_id),
      drive_folder_id: nullIfBlank(normalizedDraft.drive_folder_id),
      updated_at: isoNow()
    };
  }

  async function createSettlement(payload) {
    const { error } = await db.from('driver_settlements').insert([payload]);
    if (error) throw error;
  }

  async function updateSettlement(settlementId, payload) {
    const { error } = await db.from('driver_settlements').update(payload).eq('id', settlementId);
    if (error) throw error;
  }

  async function createPeriod(payload) {
    const { error } = await db.from('settlement_periods').insert([payload]);
    if (error) throw error;
  }

  async function updateSettlementStatus(settlementId, status) {
    clearMsg(el.appMsg);

    try {
      await updateSettlement(settlementId, {
        status,
        updated_at: isoNow()
      });
      showMsg(el.appMsg, `Settlement status updated: ${status}.`, 'success');
      await loadAllData();
    } catch (error) {
      showMsg(el.appMsg, error.message || 'Failed to update settlement status.');
    }
  }

  async function recalculateSettlement(settlementId) {
    clearMsg(el.appMsg);

    const settlement = state.settlements.find(item => String(item.id) === String(settlementId));
    if (!settlement) {
      showMsg(el.appMsg, 'Settlement not found.');
      return;
    }

    try {
      const draft = settlementToDraft(settlement);
      const nextStatus = safe(settlement.status) === 'draft' ? 'calculated' : safe(settlement.status) || 'calculated';
      await updateSettlement(settlementId, settlementPayloadFromDraft(draft, nextStatus));
      showMsg(el.appMsg, 'Settlement recalculated.', 'success');
      await loadAllData();
    } catch (error) {
      showMsg(el.appMsg, error.message || 'Failed to recalculate settlement.');
    }
  }

  function openPeriodForm() {
    closeAllForms();
    state.forms.period = true;
    setPage('settlements');
    renderAll();
  }

  function closePeriodForm() {
    state.forms.period = false;
    renderAll();
  }

  async function onCreatePeriodSubmit(event) {
    event.preventDefault();
    clearMsg(el.appMsg);

    const formData = new FormData(event.target);
    const dateFrom = safe(formData.get('date_from'));
    const dateTo = safe(formData.get('date_to'));

    if (!dateFrom || !dateTo) {
      showMsg(el.appMsg, 'Both period dates are required.');
      return;
    }

    try {
      await createPeriod({
        period_type: safe(formData.get('period_type')) || 'weekly',
        date_from: dateFrom,
        date_to: dateTo,
        status: safe(formData.get('status')) || 'draft',
        notes: nullIfBlank(formData.get('notes'))
      });
      showMsg(el.appMsg, 'Settlement period created.', 'success');
      closeAllForms();
      await loadAllData();
    } catch (error) {
      showMsg(el.appMsg, error.message || 'Failed to create settlement period.');
    }
  }

  function openNewSettlementForm(prefill = {}) {
    closeAllForms();
    state.forms.settlement = true;

    const selectionPrefill = {};
    if (!safe(prefill.driver_id) && state.selectedDetails?.type === 'driver') {
      selectionPrefill.driver_id = safe(state.selectedDetails.id);
    }
    if (!safe(prefill.vehicle_id) && state.selectedDetails?.type === 'vehicle') {
      selectionPrefill.vehicle_id = safe(state.selectedDetails.id);
    }

    state.settlementDraft = applySettlementDraftDefaults(getInitialSettlementDraft({
      ...selectionPrefill,
      ...prefill
    }));

    setPage('settlements');
    renderAll();
  }

  function closeSettlementForm() {
    state.forms.settlement = false;
    state.settlementDraft = getInitialSettlementDraft();
    renderAll();
  }

  function openSettlementEditor(settlementId) {
    const settlement = state.settlements.find(item => String(item.id) === String(settlementId));
    if (!settlement) return;

    closeAllForms();
    state.forms.settlement = true;
    state.settlementDraft = settlementToDraft(settlement);
    setPage('settlements');
    renderAll();
  }

  function getDriverOutstandingBalance(driverId) {
    const driver = state.drivers.find(item => String(item.id) === String(driverId)) || null;
    const balanceRecord = state.driverBalances.find(item =>
      String(item.driver_id || item.id) === String(driverId) ||
      safe(item.driver_name).toLowerCase() === fullName(driver).toLowerCase()
    );

    const balanceFromView = firstNumericValue(balanceRecord, [
      'balance',
      'balance_amount',
      'outstanding_balance',
      'current_balance',
      'amount'
    ]);

    if (balanceFromView != null) return balanceFromView;

    return state.settlements
      .filter(item => String(item.driver_id) === String(driverId) && safe(item.status).toLowerCase() !== 'paid')
      .reduce((sum, item) => sum + num(item.payout_to_driver), 0);
  }

  function getOutstandingBalanceTotal() {
    return settlementDrivers().reduce((sum, driver) => sum + getDriverOutstandingBalance(driver.id), 0);
  }

  function getSettlementDocumentMetadata(settlement) {
    const doc = state.documents.find(item =>
      (
        (safe(item.entity_type).toLowerCase() === 'settlement' && String(item.entity_id) === String(settlement.id)) ||
        String(item.entity_id) === String(settlement.id)
      ) &&
      safe(item.document_type || 'settlement_pdf').toLowerCase() === 'settlement_pdf'
    );

    return {
      doc,
      pdfStatus: safe(doc?.status) || safe(settlement.pdf_status) || 'not_generated',
      url: safe(doc?.file_url) || safe(settlement.pdf_url),
      driveFileId: safe(doc?.drive_file_id) || safe(settlement.drive_file_id),
      driveFolderId: safe(doc?.drive_folder_id) || safe(settlement.drive_folder_id)
    };
  }

  function renderPeriodFormCard() {
    return `
      <div class="form-card">
        <h3 class="form-title">Settlement period</h3>
        <form id="periodForm">
          <div class="form-grid-2">
            <div class="form-field">
              <label>Period type</label>
              <select name="period_type">
                <option value="weekly">Weekly</option>
                <option value="manual">Manual</option>
              </select>
            </div>

            <div class="form-field">
              <label>Status</label>
              <select name="status">
                <option value="draft">Draft</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div class="form-field">
              <label>Date from *</label>
              <input name="date_from" type="date" required />
            </div>

            <div class="form-field">
              <label>Date to *</label>
              <input name="date_to" type="date" required />
            </div>

            <div class="form-field form-field-span-2">
              <label>Notes</label>
              <input name="notes" />
            </div>
          </div>

          <div class="form-actions">
            <button type="submit">Create period</button>
            <button type="button" class="secondary" id="cancelPeriodFormBtn">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderSettlementFormCard() {
    const draft = state.settlementDraft || getInitialSettlementDraft();
    const displayDraft = applySettlementDraftDefaults(draft);
    const context = buildDriverSettlementContext(displayDraft);
    const selectedVehicleId = safe(displayDraft.vehicle_id) || safe(context.inferredVehicleId);
    const eligibleDrivers = settlementDrivers();
    const previousPeriod = context.previousSettlement
      ? state.periods.find(item => String(item.id) === String(context.previousSettlement.period_id))
      : null;

    const previewRows = [
      ['Net income', context.effectivePlatformNetIncome],
      ['Bonuses', num(displayDraft.bonuses)],
      ['Cash collected', -num(displayDraft.cash_collected)],
      ['Company commission', -context.effectiveCompanyCommission],
      ['Weekly fee', -context.effectiveWeeklySettlementFee],
      ['Rent total', -context.effectiveRentTotal],
      ['Fuel total', -num(displayDraft.fuel_total)],
      ['Penalties', -num(displayDraft.penalties_total)],
      ['Manual adjustments', num(displayDraft.adjustments_total)],
      ['Carry forward', context.effectiveCarryForwardBalance]
    ];

    return `
      <div class="form-card">
        <h3 class="form-title">${safe(displayDraft.settlement_id) ? 'Edit driver settlement' : 'Driver settlement'}</h3>
        <form id="driverSettlementForm">
          <input type="hidden" name="settlement_id" value="${escapeHtml(displayDraft.settlement_id)}" />
          <input type="hidden" name="pdf_status" value="${escapeHtml(displayDraft.pdf_status)}" />
          <input type="hidden" name="pdf_url" value="${escapeHtml(displayDraft.pdf_url)}" />
          <input type="hidden" name="drive_file_id" value="${escapeHtml(displayDraft.drive_file_id)}" />
          <input type="hidden" name="drive_folder_id" value="${escapeHtml(displayDraft.drive_folder_id)}" />

          <div class="form-grid-wide">
            <div class="form-field">
              <label>Period *</label>
              <select name="period_id" required>
                <option value="">Select period</option>
                ${state.periods.map(period => `
                  <option value="${escapeHtml(period.id)}" ${String(period.id) === String(displayDraft.period_id) ? 'selected' : ''}>
                    ${escapeHtml(periodLabel(period))}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="form-field">
              <label>Driver *</label>
              <select name="driver_id" required>
                <option value="">Select driver</option>
                ${eligibleDrivers.map(driver => `
                  <option value="${escapeHtml(driver.id)}" ${String(driver.id) === String(displayDraft.driver_id) ? 'selected' : ''}>
                    ${escapeHtml(fullName(driver))}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="form-field">
              <label>Vehicle *</label>
              <select name="vehicle_id" required>
                <option value="">Select vehicle</option>
                ${state.vehicles.map(vehicle => `
                  <option value="${escapeHtml(vehicle.id)}" ${String(vehicle.id) === String(selectedVehicleId) ? 'selected' : ''}>
                    ${escapeHtml(vehicleLabel(vehicle))}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="form-field">
              <label>Status</label>
              <select name="status">
                ${SETTLEMENT_STATUSES.map(status => `
                  <option value="${status}" ${status === safe(displayDraft.status) ? 'selected' : ''}>${humanize(status)}</option>
                `).join('')}
              </select>
            </div>

            <div class="form-field">
              <label>Gross platform income</label>
              <input name="gross_platform_income" type="number" step="0.01" value="${escapeHtml(displayDraft.gross_platform_income)}" />
            </div>

            <div class="form-field">
              <label>Platform net income</label>
              <input name="platform_net_income" type="number" step="0.01" value="${escapeHtml(displayDraft.platform_net_income)}" />
            </div>

            <div class="form-field">
              <label>Bonuses</label>
              <input name="bonuses" type="number" step="0.01" value="${escapeHtml(displayDraft.bonuses)}" />
            </div>

            <div class="form-field">
              <label>Cash collected</label>
              <input name="cash_collected" type="number" step="0.01" value="${escapeHtml(displayDraft.cash_collected)}" />
            </div>

            <div class="form-field">
              <label>Commission rate %</label>
              <input name="commission_rate_snapshot" type="number" step="0.01" value="${escapeHtml(displayDraft.commission_rate_snapshot)}" />
            </div>

            <div class="form-field">
              <label>Company commission</label>
              <input name="company_commission" type="number" step="0.01" value="${escapeHtml(displayDraft.company_commission)}" />
            </div>

            <div class="form-field">
              <label>Weekly settlement fee</label>
              <input name="weekly_settlement_fee" type="number" step="0.01" value="${escapeHtml(displayDraft.weekly_settlement_fee)}" />
            </div>

            <div class="form-field">
              <label>Rent total</label>
              <input name="rent_total" type="number" step="0.01" value="${escapeHtml(displayDraft.rent_total)}" />
            </div>

            <div class="form-field">
              <label>Fuel total</label>
              <input name="fuel_total" type="number" step="0.01" value="${escapeHtml(displayDraft.fuel_total)}" />
            </div>

            <div class="form-field">
              <label>Penalties total</label>
              <input name="penalties_total" type="number" step="0.01" value="${escapeHtml(displayDraft.penalties_total)}" />
            </div>

            <div class="form-field">
              <label>Manual adjustments +/-</label>
              <input name="adjustments_total" type="number" step="0.01" value="${escapeHtml(displayDraft.adjustments_total)}" />
            </div>

            <div class="form-field">
              <label>Carry forward</label>
              <input name="carry_forward_balance" type="number" step="0.01" value="${escapeHtml(displayDraft.carry_forward_balance)}" />
            </div>

            <div class="form-field form-field-span-2">
              <label>Calculation notes</label>
              <textarea name="calculation_notes" rows="3">${escapeHtml(displayDraft.calculation_notes)}</textarea>
            </div>
          </div>

          <div class="helper-grid">
            <div class="helper-card">
              <div class="helper-label">Config defaults</div>
              <div class="helper-value">${escapeHtml(`${context.config.commissionRatePercent}% commission, ${money(context.config.weeklySettlementFee)} weekly fee`)}</div>
            </div>

            <div class="helper-card">
              <div class="helper-label">Assignment context</div>
              <div class="helper-value">${escapeHtml(context.vehicle ? vehicleLabel(context.vehicle) : 'No linked vehicle')}</div>
              <div class="helper-note">${escapeHtml(context.assignmentsForPeriod.length ? `${context.assignmentsForPeriod.length} assignment record(s) in this period` : 'No assignment overlap in selected period')}</div>
            </div>

            <div class="helper-card">
              <div class="helper-label">Previous settlement</div>
              <div class="helper-value">${context.previousSettlement ? escapeHtml(periodLabel(previousPeriod)) : 'None'}</div>
              <div class="helper-note">${context.previousSettlement ? `${money(context.previousSettlement.payout_to_driver)} carry candidate` : 'No carry forward history'}</div>
            </div>

            <div class="helper-card ${payoutToneClass(context.calculatedPayout)}">
              <div class="helper-label">Calculated payout</div>
              <div class="helper-value">${money(context.calculatedPayout)}</div>
              <div class="helper-note">${num(context.calculatedPayout) > 0 ? 'Payable to driver' : num(context.calculatedPayout) < 0 ? 'Driver owes fleet' : 'Zero settlement'}</div>
            </div>
          </div>

          <div class="summary-breakdown">
            ${previewRows.map(([label, value]) => `
              <div class="summary-breakdown-row">
                <span>${escapeHtml(label)}</span>
                <strong class="${payoutToneClass(value)}">${money(value)}</strong>
              </div>
            `).join('')}
          </div>

          ${context.existingSettlement && !safe(displayDraft.settlement_id)
            ? `<div class="helper-text danger-text">Existing settlement already found for this driver and period. Saving will be blocked.</div>`
            : ''}

          <div class="form-actions">
            <button type="button" id="calculateSettlementBtn">Calculate</button>
            <button type="submit">${safe(displayDraft.settlement_id) ? 'Update settlement' : 'Create settlement'}</button>
            <button type="button" class="secondary" id="cancelSettlementFormBtn">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  async function onSettlementFormSubmit(event) {
    event.preventDefault();
    clearMsg(el.appMsg);

    const draft = readSettlementDraftFromForm(event.target);
    const context = buildDriverSettlementContext(draft);

    if (!safe(draft.period_id) || !safe(draft.driver_id) || !safe(draft.vehicle_id)) {
      showMsg(el.appMsg, 'Period, driver and vehicle are required.');
      return;
    }

    if (!context.driver || isSettlementExcludedDriver(context.driver)) {
      showMsg(el.appMsg, 'Selected driver is excluded from settlement logic.');
      return;
    }

    if (context.existingSettlement && !safe(draft.settlement_id)) {
      showMsg(el.appMsg, 'Settlement for this driver and period already exists.');
      return;
    }

    const payload = settlementPayloadFromDraft(
      draft,
      safe(draft.status) === 'draft' && num(draft.platform_net_income || draft.gross_platform_income)
        ? safe(draft.status)
        : safe(draft.status) || 'draft'
    );

    try {
      if (safe(draft.settlement_id)) {
        await updateSettlement(draft.settlement_id, payload);
        showMsg(el.appMsg, 'Settlement updated.', 'success');
      } else {
        await createSettlement(payload);
        showMsg(el.appMsg, 'Settlement created.', 'success');
      }

      closeAllForms();
      await loadAllData();
    } catch (error) {
      showMsg(el.appMsg, error.message || 'Failed to save settlement.');
    }
  }

  function bindSettlementFormEvents() {
    const form = qs('driverSettlementForm');
    if (!form) return;

    form.addEventListener('submit', onSettlementFormSubmit);
    qs('cancelSettlementFormBtn')?.addEventListener('click', closeSettlementForm);

    ['period_id', 'driver_id', 'vehicle_id'].forEach(fieldName => {
      form.elements[fieldName]?.addEventListener('change', () => {
        state.settlementDraft = readSettlementDraftFromForm(form);
        state.settlementDraft = applySettlementDraftDefaults(state.settlementDraft);
        renderAll();
      });
    });

    qs('calculateSettlementBtn')?.addEventListener('click', () => {
      state.settlementDraft = readSettlementDraftFromForm(form);
      state.settlementDraft = applySettlementDraftDefaults(state.settlementDraft, {
        forceDerived: true,
        nextStatus: 'calculated'
      });
      renderAll();
    });
  }

  function bindPeriodFormEvents() {
    const form = qs('periodForm');
    if (!form) return;

    form.addEventListener('submit', onCreatePeriodSubmit);
    qs('cancelPeriodFormBtn')?.addEventListener('click', closePeriodForm);
  }

  function renderSettlementsPage() {
    if (!el.settlementsPage) return;

    const periodsMap = mapById(state.periods);
    const driversMap = mapById(state.drivers);
    const vehiclesMap = mapById(state.vehicles);

    const settlements = sortByDateDesc(state.settlements, 'created_at')
      .filter(settlement => {
        if (safe(state.filters.settlementPeriod) !== 'all' && String(settlement.period_id) !== String(state.filters.settlementPeriod)) {
          return false;
        }
        if (safe(state.filters.settlementDriver) !== 'all' && String(settlement.driver_id) !== String(state.filters.settlementDriver)) {
          return false;
        }
        if (safe(state.filters.settlementStatus) !== 'all' && safe(settlement.status) !== safe(state.filters.settlementStatus)) {
          return false;
        }

        const search = safe(state.filters.settlementSearch).toLowerCase();
        if (!search) return true;

        const driver = driversMap[String(settlement.driver_id)];
        const vehicle = vehiclesMap[String(settlement.vehicle_id)];
        const period = periodsMap[String(settlement.period_id)];
        const haystack = [
          fullName(driver),
          vehicleLabel(vehicle),
          periodLabel(period),
          safe(settlement.calculation_notes),
          safe(settlement.status)
        ].join(' ').toLowerCase();

        return haystack.includes(search);
      });

    const totalPayout = settlements.reduce((sum, item) => sum + num(item.payout_to_driver), 0);
    const totalCommission = settlements.reduce((sum, item) => sum + num(item.company_commission), 0);
    const totalGross = settlements.reduce((sum, item) => sum + num(item.gross_platform_income), 0);
    const unsettledBalance = settlements
      .filter(item => safe(item.status).toLowerCase() !== 'paid')
      .reduce((sum, item) => sum + num(item.payout_to_driver), 0);

    el.settlementsPage.innerHTML = `
      <div class="cards cards-compact">
        <div class="card"><div class="metric-label">Settlements</div><div class="metric-value">${settlements.length}</div></div>
        <div class="card"><div class="metric-label">Gross total</div><div class="metric-value">${money(totalGross)}</div></div>
        <div class="card"><div class="metric-label">Company commission</div><div class="metric-value">${money(totalCommission)}</div></div>
        <div class="card"><div class="metric-label">Outstanding balance</div><div class="metric-value ${payoutToneClass(unsettledBalance)}">${money(unsettledBalance)}</div></div>
      </div>

      <div class="action-bar">
        <div class="filters filters-4">
          <input id="settlementSearchInput" placeholder="Search settlement" value="${escapeHtml(state.filters.settlementSearch)}" />
          <select id="settlementPeriodFilter">
            <option value="all">All periods</option>
            ${state.periods.map(period => `
              <option value="${escapeHtml(period.id)}" ${String(period.id) === String(state.filters.settlementPeriod) ? 'selected' : ''}>
                ${escapeHtml(periodLabel(period))}
              </option>
            `).join('')}
          </select>
          <select id="settlementDriverFilter">
            <option value="all">All drivers</option>
            ${settlementDrivers().map(driver => `
              <option value="${escapeHtml(driver.id)}" ${String(driver.id) === String(state.filters.settlementDriver) ? 'selected' : ''}>
                ${escapeHtml(fullName(driver))}
              </option>
            `).join('')}
          </select>
          <select id="settlementStatusFilter">
            <option value="all">All statuses</option>
            ${SETTLEMENT_STATUSES.map(status => `
              <option value="${status}" ${status === safe(state.filters.settlementStatus) ? 'selected' : ''}>${humanize(status)}</option>
            `).join('')}
          </select>
        </div>

        <div class="button-cluster">
          <button type="button" id="newSettlementBtn">New settlement</button>
          <button type="button" class="secondary" id="newPeriodBtn">New period</button>
        </div>
      </div>

      ${state.forms.period ? renderPeriodFormCard() : ''}
      ${state.forms.settlement ? renderSettlementFormCard() : ''}

      <div class="card">
        <h3 class="card-title">Settlement list</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Driver / vehicle</th>
                <th>Period</th>
                <th>Income</th>
                <th>Costs snapshot</th>
                <th>Payout</th>
                <th>Status</th>
                <th>Doc</th>
              </tr>
            </thead>
            <tbody>
              ${settlements.length ? settlements.map(settlement => {
                const driver = driversMap[String(settlement.driver_id)];
                const vehicle = vehiclesMap[String(settlement.vehicle_id)];
                const period = periodsMap[String(settlement.period_id)];
                const docMeta = getSettlementDocumentMetadata(settlement);
                const selected = state.selectedDetails?.type === 'settlement' && String(state.selectedDetails.id) === String(settlement.id);

                return `
                  <tr
                    class="table-row-clickable ${selected ? 'selected' : ''}"
                    data-detail-type="settlement"
                    data-detail-id="${escapeHtml(settlement.id)}"
                  >
                    <td>
                      <strong>${escapeHtml(fullName(driver))}</strong>
                      <div class="details-subvalue">${escapeHtml(vehicleLabel(vehicle))}</div>
                    </td>
                    <td>${escapeHtml(periodLabel(period))}</td>
                    <td>
                      <div class="table-stack">
                        <div class="table-stack-row"><span>Gross</span><strong>${money(settlement.gross_platform_income)}</strong></div>
                        <div class="table-stack-row"><span>Net</span><strong>${money(settlement.platform_net_income)}</strong></div>
                        <div class="table-stack-row"><span>Bonus / cash</span><strong>${money(settlement.bonuses)} / ${money(settlement.cash_collected)}</strong></div>
                      </div>
                    </td>
                    <td>
                      <div class="table-stack">
                        <div class="table-stack-row"><span>Commission</span><strong>${money(settlement.company_commission)}</strong></div>
                        <div class="table-stack-row"><span>Fee + rent</span><strong>${money(num(settlement.weekly_settlement_fee) + num(settlement.rent_total))}</strong></div>
                        <div class="table-stack-row"><span>Fuel / penalties / adj.</span><strong>${money(num(settlement.fuel_total) + num(settlement.penalties_total) - num(settlement.adjustments_total))}</strong></div>
                      </div>
                    </td>
                    <td class="${payoutToneClass(settlement.payout_to_driver)}">
                      <strong>${money(settlement.payout_to_driver)}</strong>
                      <div class="details-subvalue">Carry: ${money(settlement.carry_forward_balance)}</div>
                    </td>
                    <td><span class="badge ${badgeClass(settlement.status)}">${escapeHtml(humanize(settlement.status))}</span></td>
                    <td>
                      <div>${escapeHtml(humanize(docMeta.pdfStatus, 'Not generated'))}</div>
                      <div class="details-subvalue">${docMeta.driveFileId ? 'Drive linked' : 'Metadata only'}</div>
                    </td>
                  </tr>
                `;
              }).join('') : `
                <tr><td colspan="7"><div class="empty">No settlements found.</div></td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;

    qs('newSettlementBtn')?.addEventListener('click', () => openNewSettlementForm());
    qs('newPeriodBtn')?.addEventListener('click', openPeriodForm);
    qs('settlementSearchInput')?.addEventListener('input', event => {
      state.filters.settlementSearch = event.target.value;
      renderSettlementsPage();
    });
    qs('settlementPeriodFilter')?.addEventListener('change', event => {
      state.filters.settlementPeriod = event.target.value;
      renderSettlementsPage();
    });
    qs('settlementDriverFilter')?.addEventListener('change', event => {
      state.filters.settlementDriver = event.target.value;
      renderSettlementsPage();
    });
    qs('settlementStatusFilter')?.addEventListener('change', event => {
      state.filters.settlementStatus = event.target.value;
      renderSettlementsPage();
    });

    document.querySelectorAll('[data-detail-type="settlement"][data-detail-id]').forEach(node => {
      node.addEventListener('click', () => {
        state.selectedDetails = {
          type: 'settlement',
          id: node.getAttribute('data-detail-id')
        };
        renderAll();
      });
    });

    bindSettlementFormEvents();
    bindPeriodFormEvents();
  }

  return {
    buildDriverSettlementContext,
    closeSettlementForm,
    getDriverOutstandingBalance,
    getOutstandingBalanceTotal,
    getSettlementConfig,
    getSettlementDocumentMetadata,
    isSettlementExcludedDriver,
    openNewSettlementForm,
    openSettlementEditor,
    recalculateSettlement,
    renderSettlementsPage,
    settlementDrivers,
    settlementToDraft,
    updateSettlementStatus
  };
}
