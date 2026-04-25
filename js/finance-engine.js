export function moneyToMinor(value) {
  const parsed = Number(String(value ?? 0).replace(',', '.'));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function minorToMoney(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed) / 100 : 0;
}

export function normalizePercentRate(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(parsed)) return fallback;
  if (Math.abs(parsed) > 100) return parsed / 100;
  if (parsed !== 0 && Math.abs(parsed) <= 1) return parsed * 100;
  return parsed;
}

export function percentToBasisPoints(value) {
  return Math.round(normalizePercentRate(value, 0) * 100);
}

export function calculatePercentAmount(amount, percentRate) {
  const amountMinor = moneyToMinor(amount);
  const basisPoints = percentToBasisPoints(percentRate);
  return minorToMoney(Math.round((amountMinor * basisPoints) / 10000));
}

export function calculateDriverSettlementTotals(input = {}) {
  const platformNetIncome = moneyToMinor(input.platform_net_income);
  const bonuses = moneyToMinor(input.bonuses);
  const cashCollected = moneyToMinor(input.cash_collected);
  const companyCommission = input.company_commission == null
    ? moneyToMinor(calculatePercentAmount(input.platform_net_income, input.commission_rate_snapshot))
    : moneyToMinor(input.company_commission);
  const weeklySettlementFee = moneyToMinor(input.weekly_settlement_fee);
  const rentTotal = moneyToMinor(input.rent_total);
  const fuelTotal = moneyToMinor(input.fuel_total);
  const penaltiesTotal = moneyToMinor(input.penalties_total);
  const adjustmentsTotal = moneyToMinor(input.adjustments_total);
  const carryForwardBalance = moneyToMinor(input.carry_forward_balance);

  const payoutToDriver =
    platformNetIncome +
    bonuses -
    cashCollected -
    companyCommission -
    weeklySettlementFee -
    rentTotal -
    fuelTotal -
    penaltiesTotal +
    adjustmentsTotal +
    carryForwardBalance;

  return {
    company_commission: minorToMoney(companyCommission),
    payout_to_driver: minorToMoney(payoutToDriver)
  };
}
