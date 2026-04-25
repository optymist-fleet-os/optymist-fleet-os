import { db } from '../supabase.js';
import {
  calculateDriverSettlementTotals,
  calculatePercentAmount,
  normalizePercentRate
} from '../finance-engine.js';
import { archiveSettlementImportReports } from '../google-drive.js';
import {
  getInitialSettlementImportState,
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
    const rawCommissionRatePercent =
      findSettingNumber(['driver_settlement_commission_rate', 'company_commission_rate', 'default_commission_rate']) ??
      findCommissionRuleNumber(['driver', 'default']) ??
      8;

    const weeklySettlementFee =
      findSettingNumber(['driver_weekly_settlement_fee', 'weekly_settlement_fee']) ??
      50;

    return {
      commissionRatePercent: normalizePercentRate(rawCommissionRatePercent, 8),
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
      company_commission: safe(formData.get('company_commission')),
      weekly_settlement_fee: safe(formData.get('weekly_settlement_fee')),
      rent_total: safe(formData.get('rent_total')),
      fuel_total: safe(formData.get('fuel_total')) || '0',
      penalties_total: safe(formData.get('penalties_total')) || '0',
      adjustments_total: safe(formData.get('adjustments_total')) || '0',
      carry_forward_balance: safe(formData.get('carry_forward_balance')),
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
    const commissionRatePercent = normalizePercentRate(
      safe(draft.commission_rate_snapshot)
        ? draft.commission_rate_snapshot
        : config.commissionRatePercent,
      config.commissionRatePercent
    );
    const effectivePlatformNetIncome = safe(draft.platform_net_income)
      ? num(draft.platform_net_income)
      : num(draft.gross_platform_income);
    const effectiveCompanyCommission = safe(draft.company_commission)
      ? num(draft.company_commission)
      : calculatePercentAmount(effectivePlatformNetIncome, commissionRatePercent);
    const effectiveWeeklySettlementFee = safe(draft.weekly_settlement_fee)
      ? num(draft.weekly_settlement_fee)
      : num(config.weeklySettlementFee);
    const effectiveRentTotal = safe(draft.rent_total) ? num(draft.rent_total) : inferredRentTotal;
    const effectiveCarryForwardBalance = safe(draft.carry_forward_balance)
      ? num(draft.carry_forward_balance)
      : defaultCarryForwardValue(previousSettlement);

    const settlementTotals = calculateDriverSettlementTotals({
      platform_net_income: effectivePlatformNetIncome,
      bonuses: draft.bonuses,
      cash_collected: draft.cash_collected,
      company_commission: effectiveCompanyCommission,
      commission_rate_snapshot: commissionRatePercent,
      weekly_settlement_fee: effectiveWeeklySettlementFee,
      rent_total: effectiveRentTotal,
      fuel_total: draft.fuel_total,
      penalties_total: draft.penalties_total,
      adjustments_total: draft.adjustments_total,
      carry_forward_balance: effectiveCarryForwardBalance
    });
    const calculatedPayout = settlementTotals.payout_to_driver;

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

  function normalizeLookupText(value) {
    return safe(value)
      .replace(/\u00a0/g, ' ')
      .replace(/[łŁ]/g, 'l')
      .replace(/[ß]/g, 'ss')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[|:()[\]"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function parseAmount(value) {
    let clean = safe(value)
      .replace(/\u00a0/g, '')
      .replace(/\s+/g, '')
      .replace(/"/g, '');

    if (!clean) return 0;

    if (clean.includes(',') && clean.includes('.')) {
      if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
        clean = clean.replace(/\./g, '').replace(',', '.');
      } else {
        clean = clean.replace(/,/g, '');
      }
    } else if (clean.includes(',')) {
      clean = clean.replace(',', '.');
    }

    const parsed = Number(clean);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseCsvText(text) {
    const rows = [];
    const source = safe(text).replace(/^\ufeff/, '');
    let current = '';
    let row = [];
    let inQuotes = false;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        row.push(current);
        current = '';
        continue;
      }

      if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && next === '\n') {
          index += 1;
        }

        row.push(current);
        current = '';

        if (row.some(cell => safe(cell))) {
          rows.push(row);
        }

        row = [];
        continue;
      }

      current += char;
    }

    if (current.length || row.length) {
      row.push(current);
      if (row.some(cell => safe(cell))) {
        rows.push(row);
      }
    }

    const headers = rows.shift() || [];
    return {
      headers,
      rows: rows.map(columns => {
        const record = {};
        headers.forEach((header, columnIndex) => {
          record[header] = columns[columnIndex] ?? '';
        });
        return record;
      })
    };
  }

  function getRowValue(row, candidates = []) {
    const entries = Object.entries(row || {});

    for (const candidate of candidates) {
      const normalizedCandidate = normalizeLookupText(candidate);
      const exactMatch = entries.find(([key]) => normalizeLookupText(key) === normalizedCandidate);
      if (exactMatch && safe(exactMatch[1])) return exactMatch[1];
    }

    for (const candidate of candidates) {
      const normalizedCandidate = normalizeLookupText(candidate);
      const fuzzyMatch = entries.find(([key]) => normalizeLookupText(key).includes(normalizedCandidate));
      if (fuzzyMatch && safe(fuzzyMatch[1])) return fuzzyMatch[1];
    }

    return '';
  }

  function getRowNumber(row, candidates = []) {
    return parseAmount(getRowValue(row, candidates));
  }

  function getRowAbsNumber(row, candidates = []) {
    return Math.abs(getRowNumber(row, candidates));
  }

  function detectReportKind(headers, fileName) {
    const headerText = headers.map(header => normalizeLookupText(header)).join(' | ');
    const fileText = normalizeLookupText(fileName);
    const haystack = `${headerText} ${fileText}`;

    if (haystack.includes('identyfikator uuid kierowcy') && haystack.includes('wyplacono ci')) {
      return 'uber';
    }
    if (haystack.includes('zarobki brutto ogolem') && haystack.includes('przewidywana wyplata')) {
      return 'bolt';
    }
    if (fileText.includes('freenow') || haystack.includes('free now') || haystack.includes('freenow')) {
      return 'freenow';
    }
    if (
      fileText.includes('fuel') ||
      fileText.includes('paliw') ||
      fileText.includes('tank') ||
      haystack.includes('fuel') ||
      haystack.includes('paliw')
    ) {
      return 'fuel';
    }

    return 'unknown';
  }

  function buildImportedDriverDescriptor(row, fallbacks = {}) {
    const firstName = safe(getRowValue(row, ['imie kierowcy', 'imie', 'first name'])) || safe(fallbacks.first_name);
    const lastName = safe(getRowValue(row, ['nazwisko kierowcy', 'nazwisko', 'last name'])) || safe(fallbacks.last_name);
    const fullNameValue = safe(
      getRowValue(row, ['kierowca', 'driver', 'driver name', 'pelne imie i nazwisko', 'full name']) ||
      [firstName, lastName].filter(Boolean).join(' ') ||
      fallbacks.full_name
    );

    return {
      imported_name: fullNameValue,
      imported_email: safe(getRowValue(row, ['adres e mail', 'email', 'e mail', 'mail']) || fallbacks.email),
      imported_phone: safe(getRowValue(row, ['numer telefonu', 'telefon', 'phone']) || fallbacks.phone),
      imported_external_id: safe(
        getRowValue(row, [
          'identyfikator uuid kierowcy',
          'identyfikator kierowcy',
          'id kierowcy',
          'driver id',
          'uuid'
        ]) || fallbacks.external_id
      )
    };
  }

  function matchImportedDriver(importRow) {
    const importedName = normalizeLookupText(importRow.imported_name);
    const importedEmail = normalizeLookupText(importRow.imported_email);
    const importedPhoneDigits = safe(importRow.imported_phone).replace(/\D/g, '');

    let bestMatch = null;
    let bestScore = 0;

    for (const driver of settlementDrivers()) {
      let score = 0;
      const driverName = normalizeLookupText(fullName(driver));
      const driverEmail = normalizeLookupText(driver.email);
      const driverPhoneDigits = safe(driver.phone).replace(/\D/g, '');

      if (importedEmail && driverEmail && importedEmail === driverEmail) score += 6;
      if (importedName && driverName && importedName === driverName) score += 5;
      if (importedName && driverName && (driverName.includes(importedName) || importedName.includes(driverName))) score += 3;
      if (importedPhoneDigits && driverPhoneDigits && importedPhoneDigits.slice(-7) === driverPhoneDigits.slice(-7)) score += 2;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = driver;
      }
    }

    return bestScore >= 4 ? bestMatch : null;
  }

  function buildImportNote(provider, noteParts = []) {
    return [`Imported from ${provider}`, ...noteParts.filter(Boolean)].join('. ');
  }

  function parseUberRows(rows, fileName) {
    return rows.map(row => {
      const descriptor = buildImportedDriverDescriptor(row);
      const tips = getRowNumber(row, ['twoj przychod napiwek']);
      const promotions = getRowNumber(row, ['promocja tryb korzysci']);
      const providerNoteParts = [];

      if (tips) providerNoteParts.push(`tips included in net: ${money(tips)}`);
      if (promotions) providerNoteParts.push(`promotions included in net: ${money(promotions)}`);

      return {
        ...descriptor,
        provider: 'uber',
        source_file: fileName,
        gross_platform_income: getRowNumber(row, [
          'wypłacono ci : twój przychód : opłata',
          'wyplacono ci twoj przychod oplata'
        ]),
        platform_net_income: getRowNumber(row, ['wypłacono ci : twój przychód', 'wyplacono ci twoj przychod']),
        cash_collected: getRowAbsNumber(row, [
          'odebrana gotowka',
          'wypłaty odebrana gotówka'
        ]),
        bonuses: 0,
        fuel_total: 0,
        reported_driver_payout: getRowNumber(row, ['wypłacono ci', 'wyplacono ci']),
        import_note: buildImportNote('Uber', providerNoteParts)
      };
    }).filter(row => row.imported_name && (row.gross_platform_income || row.platform_net_income || row.reported_driver_payout));
  }

  function parseBoltRows(rows, fileName) {
    return rows.map(row => {
      const descriptor = buildImportedDriverDescriptor(row);
      const tips = getRowNumber(row, ['napiwki od pasazerow']);
      const campaigns = getRowNumber(row, ['zarobki z kampanii']);
      const providerNoteParts = [];

      if (tips) providerNoteParts.push(`tips included in net: ${money(tips)}`);
      if (campaigns) providerNoteParts.push(`campaign earnings included in net: ${money(campaigns)}`);

      return {
        ...descriptor,
        provider: 'bolt',
        source_file: fileName,
        gross_platform_income: getRowNumber(row, ['zarobki brutto ogolem']),
        platform_net_income: getRowNumber(row, ['zarobki netto']),
        cash_collected: getRowAbsNumber(row, ['pobrana gotowka', 'zarobki brutto platnosci gotowkowe']),
        bonuses: 0,
        fuel_total: 0,
        reported_driver_payout: getRowNumber(row, ['przewidywana wyplata']),
        import_note: buildImportNote('Bolt', providerNoteParts)
      };
    }).filter(row => row.imported_name && (row.gross_platform_income || row.platform_net_income || row.reported_driver_payout));
  }

  function parseFreeNowRows(rows, fileName) {
    return rows.map(row => {
      const descriptor = buildImportedDriverDescriptor(row);
      return {
        ...descriptor,
        provider: 'freenow',
        source_file: fileName,
        gross_platform_income: getRowNumber(row, ['gross earnings', 'gross income', 'brutto', 'gross']),
        platform_net_income: getRowNumber(row, ['net earnings', 'net income', 'zarobki netto', 'net']),
        cash_collected: getRowAbsNumber(row, ['cash collected', 'cash', 'gotowka', 'gotowk']),
        bonuses: 0,
        fuel_total: 0,
        reported_driver_payout: getRowNumber(row, ['payout', 'payment', 'wyplata']),
        import_note: buildImportNote('FreeNow')
      };
    }).filter(row => row.imported_name && (row.gross_platform_income || row.platform_net_income || row.reported_driver_payout));
  }

  function parseFuelRows(rows, fileName) {
    return rows.map(row => {
      const descriptor = buildImportedDriverDescriptor(row);
      return {
        ...descriptor,
        provider: 'fuel',
        source_file: fileName,
        gross_platform_income: 0,
        platform_net_income: 0,
        cash_collected: 0,
        bonuses: 0,
        fuel_total: getRowAbsNumber(row, ['fuel total', 'fuel amount', 'paliwo', 'kwota', 'amount', 'wartosc', 'wartość', 'suma', 'total']),
        reported_driver_payout: 0,
        import_note: buildImportNote('Fuel')
      };
    }).filter(row => row.imported_name && row.fuel_total);
  }

  function parseRowsByKind(kind, rows, fileName) {
    if (kind === 'uber') return parseUberRows(rows, fileName);
    if (kind === 'bolt') return parseBoltRows(rows, fileName);
    if (kind === 'freenow') return parseFreeNowRows(rows, fileName);
    if (kind === 'fuel') return parseFuelRows(rows, fileName);
    return [];
  }

  function buildImportPreviewRow(group, periodId) {
    const existingSettlement = group.matched_driver_id
      ? findExistingSettlement(periodId, group.matched_driver_id)
      : null;

    const prefilledDraft = group.matched_driver_id
      ? applySettlementDraftDefaults(getInitialSettlementDraft({
        settlement_id: safe(existingSettlement?.id),
        period_id: periodId,
        driver_id: group.matched_driver_id,
        gross_platform_income: decimalInputValue(group.gross_platform_income, '0'),
        platform_net_income: decimalInputValue(group.platform_net_income, '0'),
        bonuses: decimalInputValue(group.bonuses, '0'),
        cash_collected: decimalInputValue(group.cash_collected, '0'),
        fuel_total: decimalInputValue(group.fuel_total, '0'),
        calculation_notes: group.import_notes.join('\n')
      }))
      : null;

    const context = prefilledDraft ? buildDriverSettlementContext(prefilledDraft) : null;

    return {
      ...group,
      existing_settlement_id: safe(existingSettlement?.id),
      existing_settlement_status: safe(existingSettlement?.status),
      inferred_vehicle_id: safe(context?.inferredVehicleId),
      inferred_vehicle: context?.vehicle || null,
      estimated_payout_to_driver: num(context?.calculatedPayout),
      prefilled_draft: prefilledDraft
    };
  }

  function rebuildSettlementImportRows(periodId, sourceReports = state.settlementImport.source_reports || []) {
    const groups = {};
    const warnings = [];

    sourceReports.forEach(report => {
      if (report.kind === 'unknown') {
        warnings.push(`Unsupported CSV format: ${report.file_name}`);
        return;
      }

      report.rows.forEach(importRow => {
        const matchedDriver = matchImportedDriver(importRow);
        const groupKey = matchedDriver
          ? `driver:${matchedDriver.id}`
          : `unmatched:${normalizeLookupText(importRow.imported_name || importRow.imported_email || importRow.imported_phone || importRow.imported_external_id || report.file_name)}`;

        if (!groups[groupKey]) {
          groups[groupKey] = {
            key: groupKey,
            period_id: periodId,
            matched_driver_id: matchedDriver ? String(matchedDriver.id) : '',
            matched_driver_name: matchedDriver ? fullName(matchedDriver) : '',
            imported_name: importRow.imported_name,
            imported_email: importRow.imported_email,
            imported_phone: importRow.imported_phone,
            gross_platform_income: 0,
            platform_net_income: 0,
            cash_collected: 0,
            bonuses: 0,
            fuel_total: 0,
            reported_driver_payout: 0,
            source_files: [],
            providers: [],
            import_notes: [],
            unmatched_reason: matchedDriver ? '' : 'No CRM driver match'
          };
        }

        const group = groups[groupKey];
        group.imported_name = group.imported_name || importRow.imported_name;
        group.imported_email = group.imported_email || importRow.imported_email;
        group.imported_phone = group.imported_phone || importRow.imported_phone;
        group.gross_platform_income += num(importRow.gross_platform_income);
        group.platform_net_income += num(importRow.platform_net_income);
        group.cash_collected += num(importRow.cash_collected);
        group.bonuses += num(importRow.bonuses);
        group.fuel_total += num(importRow.fuel_total);
        group.reported_driver_payout += num(importRow.reported_driver_payout);

        if (!group.source_files.includes(importRow.source_file)) group.source_files.push(importRow.source_file);
        if (!group.providers.includes(importRow.provider)) group.providers.push(importRow.provider);
        if (safe(importRow.import_note)) group.import_notes.push(importRow.import_note);
      });
    });

    const previewRows = Object.values(groups)
      .map(group => buildImportPreviewRow(group, periodId))
      .sort((left, right) => {
        if (safe(left.matched_driver_name) && safe(right.matched_driver_name)) {
          return safe(left.matched_driver_name).localeCompare(safe(right.matched_driver_name), 'uk');
        }
        return safe(left.imported_name).localeCompare(safe(right.imported_name), 'uk');
      });

    return {
      rows: previewRows,
      unmatched_rows: previewRows.filter(row => !row.matched_driver_id),
      warnings
    };
  }

  async function parseSettlementImportSources(files, periodId) {
    const sourceReports = [];
    const warnings = [];

    for (const file of files) {
      const text = typeof file.text === 'function' ? await file.text() : safe(file.text);
      const parsed = parseCsvText(text);
      const kind = detectReportKind(parsed.headers, file.name);
      const rows = parseRowsByKind(kind, parsed.rows, file.name);

      sourceReports.push({
        file_name: file.name,
        kind,
        row_count: rows.length,
        rows
      });

      if (kind === 'unknown') {
        warnings.push(`Unsupported CSV format: ${file.name}`);
      }
      if (kind !== 'unknown' && !rows.length) {
        warnings.push(`No usable rows found in ${file.name}`);
      }
    }

    const rebuilt = rebuildSettlementImportRows(periodId, sourceReports);

    return {
      period_id: periodId,
      source_files: files.map(file => file.name),
      source_reports: sourceReports,
      rows: rebuilt.rows,
      unmatched_rows: rebuilt.unmatched_rows,
      warnings: [...warnings, ...rebuilt.warnings],
      last_error: '',
      last_imported_at: isoNow()
    };
  }

  function importDocumentTypeForKind(kind) {
    return safe(kind) === 'fuel'
      ? 'fuel_report'
      : ['uber', 'bolt', 'freenow'].includes(safe(kind))
        ? 'platform_report'
        : 'other';
  }

  async function upsertImportedReportDocumentMetadata(period, archiveResult) {
    const archivedFiles = archiveResult?.files || [];
    const metadataErrors = [];

    for (const file of archivedFiles) {
      const title = safe(file.original_name) || safe(file.name);
      const archiveNote = `Archived from weekly settlement import (${humanize(file.kind || 'report')}) on ${safe(archiveResult.archived_at || isoNow()).slice(0, 16).replace('T', ' ')}`;
      const payload = {
        entity_type: 'period',
        entity_id: safe(period.id),
        document_type: importDocumentTypeForKind(file.kind),
        title,
        status: 'archived',
        storage_provider: 'google_drive',
        drive_file_id: nullIfBlank(file.id),
        drive_folder_id: nullIfBlank(file.folder_id || archiveResult.archive_folder_id),
        file_url: nullIfBlank(file.web_view_link),
        folder_url: nullIfBlank(file.folder_url || archiveResult.archive_folder_url),
        mime_type: nullIfBlank(file.mime_type || 'text/csv'),
        notes: nullIfBlank(archiveNote),
        updated_at: isoNow()
      };

      const existingDocument = state.documents.find(document =>
        safe(document.entity_type) === 'period' &&
        String(document.entity_id) === String(period.id) &&
        safe(document.document_type) === payload.document_type &&
        safe(document.title) === title
      );

      const saveWithPayload = async savePayload => {
        if (existingDocument) {
          return db
            .from('documents')
            .update(savePayload)
            .eq('id', existingDocument.id);
        }

        return db.from('documents').insert([savePayload]);
      };

      let { error } = await saveWithPayload(payload);

      if (error && safe(error.message).includes("Could not find the 'notes' column")) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.notes;
        const retry = await saveWithPayload(fallbackPayload);
        error = retry.error;
      }

      if (error && safe(error.message).includes('entity_id') && safe(error.message).includes('uuid')) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.entity_type;
        delete fallbackPayload.entity_id;
        const retry = await saveWithPayload(fallbackPayload);
        error = retry.error;
      }

      if (error) metadataErrors.push(`${title}: ${error.message || 'metadata save failed'}`);
    }

    return metadataErrors;
  }

  async function archiveImportedReportsToDrive(periodId, files, sourceReports) {
    const period = state.periods.find(item => String(item.id) === String(periodId));
    if (!period) {
      throw new Error('Settlement period not found for Google Drive archive.');
    }

    const archiveResult = await archiveSettlementImportReports({
      period,
      files,
      sourceReports
    });

    const metadataErrors = await upsertImportedReportDocumentMetadata(period, archiveResult);

    return {
      ...archiveResult,
      metadata_errors: metadataErrors
    };
  }

  function clearSettlementImport(keepPeriod = true) {
    state.settlementImport = getInitialSettlementImportState({
      period_id: keepPeriod ? safe(state.settlementImport.period_id) : ''
    });
    renderAll();
  }

  function buildDraftFromImportedRow(importRow, existingSettlement = null) {
    const baseDraft = existingSettlement ? settlementToDraft(existingSettlement) : getInitialSettlementDraft();
    const mergedNotes = [
      safe(baseDraft.calculation_notes),
      ...importRow.import_notes,
      importRow.reported_driver_payout ? `Platform reported payout: ${money(importRow.reported_driver_payout)}` : ''
    ].filter(Boolean).join('\n');

    return applySettlementDraftDefaults(getInitialSettlementDraft({
      ...baseDraft,
      settlement_id: safe(existingSettlement?.id),
      period_id: importRow.period_id,
      driver_id: importRow.matched_driver_id,
      vehicle_id: safe(baseDraft.vehicle_id) || safe(importRow.inferred_vehicle_id),
      gross_platform_income: decimalInputValue(importRow.gross_platform_income, safe(baseDraft.gross_platform_income) || '0'),
      platform_net_income: decimalInputValue(importRow.platform_net_income, safe(baseDraft.platform_net_income) || '0'),
      bonuses: decimalInputValue(importRow.bonuses || baseDraft.bonuses, '0'),
      cash_collected: decimalInputValue(importRow.cash_collected, safe(baseDraft.cash_collected) || '0'),
      fuel_total: decimalInputValue(importRow.fuel_total || baseDraft.fuel_total, '0'),
      calculation_notes: mergedNotes
    }));
  }

  function openImportedSettlementDraft(importKey) {
    const importRow = state.settlementImport.rows.find(row => row.key === importKey);
    if (!importRow || !importRow.matched_driver_id) return;

    const existingSettlement = importRow.existing_settlement_id
      ? state.settlements.find(item => String(item.id) === String(importRow.existing_settlement_id))
      : null;

    closeAllForms();
    state.forms.settlement = true;
    state.settlementDraft = buildDraftFromImportedRow(importRow, existingSettlement);
    setPage('settlements');
    renderAll();
  }

  async function upsertImportedSettlements(importKey = '') {
    clearMsg(el.appMsg);

    const candidates = (importKey
      ? state.settlementImport.rows.filter(row => row.key === importKey)
      : state.settlementImport.rows
    ).filter(row => row.matched_driver_id);

    if (!candidates.length) {
      showMsg(el.appMsg, 'No matched imported rows to save.');
      return;
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const blockedStatuses = ['approved', 'sent', 'paid', 'disputed'];

    try {
      for (const candidate of candidates) {
        const existingSettlement = candidate.existing_settlement_id
          ? state.settlements.find(item => String(item.id) === String(candidate.existing_settlement_id))
          : null;

        if (blockedStatuses.includes(safe(existingSettlement?.status).toLowerCase())) {
          skipped += 1;
          continue;
        }

        const draft = buildDraftFromImportedRow(candidate, existingSettlement);
        const context = buildDriverSettlementContext(draft);

        if (!context.vehicle) {
          skipped += 1;
          continue;
        }

        const nextStatus = existingSettlement
          ? (safe(existingSettlement.status) || 'calculated')
          : 'calculated';

        const payload = settlementPayloadFromDraft(
          draft,
          nextStatus === 'draft' ? 'calculated' : nextStatus
        );

        if (existingSettlement) {
          await updateSettlement(existingSettlement.id, payload);
          updated += 1;
        } else {
          await createSettlement(payload);
          created += 1;
        }
      }

      showMsg(
        el.appMsg,
        `Import applied. Created: ${created}, updated: ${updated}, skipped: ${skipped}.`,
        'success'
      );
      await loadAllData();
      if (safe(state.settlementImport.period_id) && state.settlementImport.source_reports.length) {
        const rebuilt = rebuildSettlementImportRows(state.settlementImport.period_id, state.settlementImport.source_reports);
        state.settlementImport = {
          ...state.settlementImport,
          rows: rebuilt.rows,
          unmatched_rows: rebuilt.unmatched_rows,
          warnings: rebuilt.warnings,
          last_error: ''
        };
        renderAll();
      }
    } catch (error) {
      showMsg(el.appMsg, error.message || 'Failed to apply imported settlements.');
    }
  }

  function renderSettlementImportCard() {
    const importState = state.settlementImport || getInitialSettlementImportState();
    const matchedRows = importState.rows.filter(row => row.matched_driver_id);
    const driveState = state.googleDrive || {};

    return `
      <div class="form-card">
        <h3 class="form-title">Auto-calc imports</h3>

        <div class="form-grid-wide">
          <div class="form-field">
            <label>Settlement period *</label>
            <select id="settlementImportPeriod">
              <option value="">Select period</option>
              ${state.periods.map(period => `
                <option value="${escapeHtml(period.id)}" ${String(period.id) === String(importState.period_id) ? 'selected' : ''}>
                  ${escapeHtml(periodLabel(period))}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="form-field form-field-span-2">
            <label>Upload weekly CSV reports</label>
            <input id="settlementImportFiles" type="file" accept=".csv,text/csv" multiple />
          </div>

          <div class="form-field">
            <label>Actions</label>
            <div class="button-cluster">
              <button type="button" class="secondary" id="clearSettlementImportBtn">Clear import</button>
              <button type="button" id="bulkApplySettlementImportBtn" ${matchedRows.length ? '' : 'disabled'}>Create / update matched</button>
            </div>
          </div>
        </div>

        <div class="helper-text">
          CSV files are parsed in the browser. When Google Drive is connected, the original reports are also archived through a server-side Vercel API into your Drive root folder.
        </div>

        ${importState.last_imported_at ? `
          <div class="helper-grid">
            <div class="helper-card">
              <div class="helper-label">Google Drive</div>
              <div class="helper-value">${escapeHtml(
                driveState.connected
                  ? 'Connected'
                  : driveState.configured
                    ? 'Configured, access failed'
                    : 'Not configured'
              )}</div>
              <div class="helper-note">${escapeHtml(
                driveState.connected
                  ? safe(driveState.root_folder_name) || 'Drive root verified'
                  : safe(driveState.error) || (Array.isArray(driveState.missing) && driveState.missing.length
                    ? `Missing: ${driveState.missing.join(', ')}`
                    : 'Set Google Drive OAuth env vars on Vercel.')
              )}</div>
            </div>
            <div class="helper-card">
              <div class="helper-label">Imported files</div>
              <div class="helper-value">${importState.source_reports.length}</div>
              <div class="helper-note">${escapeHtml(importState.source_files.join(', ') || '-')}</div>
            </div>
            <div class="helper-card">
              <div class="helper-label">Matched drivers</div>
              <div class="helper-value">${matchedRows.length}</div>
              <div class="helper-note">${importState.unmatched_rows.length} unmatched</div>
            </div>
            <div class="helper-card">
              <div class="helper-label">Gross imported</div>
              <div class="helper-value">${money(importState.rows.reduce((sum, row) => sum + num(row.gross_platform_income), 0))}</div>
              <div class="helper-note">Across all matched rows</div>
            </div>
            <div class="helper-card">
              <div class="helper-label">Imported at</div>
              <div class="helper-value">${escapeHtml(importState.last_imported_at.slice(0, 16).replace('T', ' '))}</div>
              <div class="helper-note">Client-side parse</div>
            </div>
            <div class="helper-card">
              <div class="helper-label">Drive archive</div>
              <div class="helper-value">${escapeHtml(humanize(importState.drive_archive_status || 'idle'))}</div>
              <div class="helper-note">${importState.drive_archive_folder_url
                ? `<a href="${escapeHtml(importState.drive_archive_folder_url)}" target="_blank" rel="noreferrer">Open archive folder</a>`
                : escapeHtml(importState.drive_archive_error || (driveState.connected ? 'Archive runs automatically after import.' : 'Waiting for Google Drive connection'))
              }</div>
            </div>
          </div>
        ` : ''}

        ${importState.warnings.length ? `
          <div class="summary-breakdown">
            ${importState.warnings.map(warning => `
              <div class="summary-breakdown-row">
                <span class="danger-text">${escapeHtml(warning)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${matchedRows.length ? `
          <div class="card import-preview-card">
            <h4 class="card-title">Matched import preview</h4>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Imported driver / CRM match</th>
                    <th>Sources</th>
                    <th>Imported totals</th>
                    <th>Estimated settlement</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${matchedRows.map(row => `
                    <tr>
                      <td>
                        <strong>${escapeHtml(row.matched_driver_name)}</strong>
                        <div class="details-subvalue">${escapeHtml(row.imported_name || '-')}</div>
                        <div class="details-subvalue">${escapeHtml(row.imported_email || row.imported_phone || '-')}</div>
                      </td>
                      <td>
                        <div>${escapeHtml(row.providers.join(', '))}</div>
                        <div class="details-subvalue">${escapeHtml(row.source_files.join(', '))}</div>
                        <div class="details-subvalue">${row.existing_settlement_id ? `Existing: ${escapeHtml(humanize(row.existing_settlement_status || 'draft'))}` : 'New settlement'}</div>
                      </td>
                      <td>
                        <div class="table-stack">
                          <div class="table-stack-row"><span>Gross</span><strong>${money(row.gross_platform_income)}</strong></div>
                          <div class="table-stack-row"><span>Net</span><strong>${money(row.platform_net_income)}</strong></div>
                          <div class="table-stack-row"><span>Cash</span><strong>${money(row.cash_collected)}</strong></div>
                          <div class="table-stack-row"><span>Fuel</span><strong>${money(row.fuel_total)}</strong></div>
                        </div>
                      </td>
                      <td>
                        <div class="${payoutToneClass(row.estimated_payout_to_driver)}"><strong>${money(row.estimated_payout_to_driver)}</strong></div>
                        <div class="details-subvalue">${escapeHtml(row.inferred_vehicle ? vehicleLabel(row.inferred_vehicle) : 'No inferred vehicle')}</div>
                        <div class="details-subvalue">${row.reported_driver_payout ? `Platform payout: ${money(row.reported_driver_payout)}` : 'No platform payout column'}</div>
                      </td>
                      <td>
                        <div class="button-cluster">
                          <button type="button" class="secondary" data-import-open="${escapeHtml(row.key)}">Open draft</button>
                          <button type="button" data-import-apply="${escapeHtml(row.key)}">Apply</button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        ${importState.unmatched_rows.length ? `
          <div class="card import-preview-card">
            <h4 class="card-title">Unmatched import rows</h4>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Imported driver</th>
                    <th>Sources</th>
                    <th>Totals</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  ${importState.unmatched_rows.map(row => `
                    <tr>
                      <td>
                        <strong>${escapeHtml(row.imported_name || '-')}</strong>
                        <div class="details-subvalue">${escapeHtml(row.imported_email || row.imported_phone || '-')}</div>
                      </td>
                      <td>${escapeHtml(row.providers.join(', '))}</td>
                      <td>${money(row.platform_net_income || row.gross_platform_income || row.fuel_total)}</td>
                      <td>${escapeHtml(row.unmatched_reason || 'No CRM match')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
      </div>
    `;
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

  async function onSettlementImportFilesSelected(event) {
    clearMsg(el.appMsg);

    const periodId = safe(qs('settlementImportPeriod')?.value || state.settlementImport.period_id);
    const files = Array.from(event.target.files || []);

    if (!periodId) {
      showMsg(el.appMsg, 'Select settlement period before importing CSV reports.');
      event.target.value = '';
      return;
    }

    if (!files.length) return;

    try {
      state.settlementImport = await parseSettlementImportSources(files, periodId);

      if (state.googleDrive?.connected) {
        try {
          const archiveResult = await archiveImportedReportsToDrive(
            periodId,
            files,
            state.settlementImport.source_reports
          );

          state.settlementImport = {
            ...state.settlementImport,
            drive_archive_status: 'archived',
            drive_archive_folder_id: safe(archiveResult.archive_folder_id),
            drive_archive_folder_url: safe(archiveResult.archive_folder_url),
            drive_archived_files: archiveResult.files || [],
            drive_archive_error: (archiveResult.metadata_errors || []).join('; '),
            drive_archive_last_at: safe(archiveResult.archived_at)
          };

          await loadAllData();
          if (archiveResult.metadata_errors?.length) {
            showMsg(
              el.appMsg,
              `Imported ${files.length} CSV file(s) and archived ${archiveResult.files?.length || 0} report(s) to Google Drive. Metadata link needs schema fix: ${archiveResult.metadata_errors[0]}`,
              'success'
            );
          } else {
            showMsg(
              el.appMsg,
              `Imported ${files.length} CSV file(s) and archived ${archiveResult.files?.length || 0} report(s) to Google Drive.`,
              'success'
            );
          }
        } catch (archiveError) {
          state.settlementImport = {
            ...state.settlementImport,
            drive_archive_status: 'failed',
            drive_archive_error: archiveError.message || 'Google Drive archive failed.',
            drive_archive_last_at: isoNow()
          };
          showMsg(
            el.appMsg,
            `Imported ${files.length} CSV file(s), but Drive archive failed: ${archiveError.message || 'Unknown error.'}`,
            'error'
          );
        }
      } else {
        state.settlementImport = {
          ...state.settlementImport,
          drive_archive_status: 'skipped',
          drive_archive_error: safe(state.googleDrive?.error) || 'Google Drive is not configured yet.'
        };
        showMsg(
          el.appMsg,
          `Imported ${files.length} CSV file(s). Google Drive archive is not connected yet.`,
          'success'
        );
      }

      renderAll();
    } catch (error) {
      state.settlementImport = {
        ...getInitialSettlementImportState({ period_id: periodId }),
        last_error: error.message || 'Failed to parse imported files.'
      };
      renderAll();
      showMsg(el.appMsg, error.message || 'Failed to parse imported files.');
    } finally {
      event.target.value = '';
    }
  }

  function bindSettlementImportEvents() {
    qs('settlementImportPeriod')?.addEventListener('change', event => {
      const nextPeriodId = event.target.value;
      state.settlementImport.period_id = nextPeriodId;

      if (state.settlementImport.source_reports.length) {
        const rebuilt = rebuildSettlementImportRows(nextPeriodId, state.settlementImport.source_reports);
        state.settlementImport = {
          ...state.settlementImport,
          period_id: nextPeriodId,
          rows: rebuilt.rows,
          unmatched_rows: rebuilt.unmatched_rows,
          warnings: rebuilt.warnings
        };
      }

      renderSettlementsPage();
    });

    qs('settlementImportFiles')?.addEventListener('change', onSettlementImportFilesSelected);
    qs('clearSettlementImportBtn')?.addEventListener('click', () => clearSettlementImport());
    qs('bulkApplySettlementImportBtn')?.addEventListener('click', () => upsertImportedSettlements());

    document.querySelectorAll('[data-import-open]').forEach(node => {
      node.addEventListener('click', () => openImportedSettlementDraft(node.getAttribute('data-import-open')));
    });

    document.querySelectorAll('[data-import-apply]').forEach(node => {
      node.addEventListener('click', () => upsertImportedSettlements(node.getAttribute('data-import-apply')));
    });
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

      ${renderSettlementImportCard()}

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
    bindSettlementImportEvents();
  }

  return {
    buildDriverSettlementContext,
    closeSettlementForm,
    clearSettlementImport,
    getDriverOutstandingBalance,
    getOutstandingBalanceTotal,
    getSettlementConfig,
    getSettlementDocumentMetadata,
    isSettlementExcludedDriver,
    openImportedSettlementDraft,
    openNewSettlementForm,
    openSettlementEditor,
    parseSettlementImportSources,
    recalculateSettlement,
    renderSettlementsPage,
    settlementDrivers,
    settlementToDraft,
    upsertImportedSettlements,
    updateSettlementStatus
  };
}
