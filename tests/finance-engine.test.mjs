import assert from 'node:assert/strict';

import {
  calculateDriverSettlementTotals,
  calculatePercentAmount,
  normalizePercentRate
} from '../js/finance-engine.js';

assert.equal(normalizePercentRate(8), 8);
assert.equal(normalizePercentRate(0.08), 8);
assert.equal(normalizePercentRate(800), 8);
assert.equal(calculatePercentAmount(982.38, 8), 78.59);

const totals = calculateDriverSettlementTotals({
  platform_net_income: 982.38,
  bonuses: 0,
  cash_collected: 51.95,
  commission_rate_snapshot: 8,
  weekly_settlement_fee: 50,
  rent_total: 600,
  fuel_total: 0,
  penalties_total: 0,
  adjustments_total: 0,
  carry_forward_balance: 0
});

assert.equal(totals.company_commission, 78.59);
assert.equal(totals.payout_to_driver, 201.84);

console.log('finance-engine tests passed');
