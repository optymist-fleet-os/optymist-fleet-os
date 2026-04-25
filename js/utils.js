export function safe(value) {
  return value == null ? '' : String(value).trim();
}

export function num(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function money(value) {
  return `${num(value).toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} PLN`;
}

export function escapeHtml(text) {
  return safe(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function decimalInputValue(value, fallback = '') {
  const stringValue = safe(value);
  if (!stringValue) return fallback;
  const parsed = Number(stringValue);
  return Number.isFinite(parsed) ? String(Math.round(parsed * 100) / 100) : stringValue;
}

export function percentValue(value, fallback = '') {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${Math.round(parsed * 10000) / 100}` : fallback;
}

export function isoNow() {
  return new Date().toISOString();
}

export function todayIso() {
  return isoNow().slice(0, 10);
}

export function dayBeforeIso(dateString) {
  const clean = safe(dateString);
  if (!clean) return '';
  const date = new Date(`${clean}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function qs(id) {
  return document.getElementById(id);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function showMsg(target, text, type = 'error') {
  if (!target) return;
  target.innerHTML = `<div class="msg ${escapeHtml(type)}">${escapeHtml(text)}</div>`;
}

export function clearMsg(target) {
  if (!target) return;
  target.innerHTML = '';
}

export function mapById(items) {
  const map = {};
  (items || []).forEach(item => {
    map[String(item.id)] = item;
  });
  return map;
}

export function shortId(id) {
  return safe(id).slice(0, 8);
}

export function fullName(driver) {
  if (!driver) return '-';
  return (
    safe(driver.full_name) ||
    [safe(driver.first_name), safe(driver.last_name)].filter(Boolean).join(' ') ||
    safe(driver.email) ||
    `Driver #${driver.id}`
  );
}

export function ownerLabel(owner) {
  if (!owner) return '-';
  return safe(owner.company_name) || safe(owner.full_name) || `Owner #${owner.id}`;
}

export function vehicleLabel(vehicle) {
  if (!vehicle) return '-';
  return (
    safe(vehicle.plate_number) ||
    [safe(vehicle.brand), safe(vehicle.model), safe(vehicle.year)].filter(Boolean).join(' ') ||
    `Vehicle #${vehicle.id}`
  );
}

export function humanize(value, fallback = '-') {
  const clean = safe(value);
  if (!clean) return fallback;
  return clean
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

export function badgeClass(status) {
  const normalized = safe(status).toLowerCase();
  if (['paid'].includes(normalized)) return 'pay';
  if (['active', 'ready', 'approved', 'calculated', 'sent', 'signed'].includes(normalized)) return 'active';
  if (['disputed', 'expired', 'overdue'].includes(normalized)) return 'debt';
  if (['closed', 'archived', 'inactive'].includes(normalized)) return 'closed';
  if (['open', 'draft', 'pending', 'missing', 'imported'].includes(normalized)) return 'ready';
  return '';
}

export function payoutToneClass(value) {
  if (num(value) > 0) return 'money-positive';
  if (num(value) < 0) return 'money-negative';
  return 'money-zero';
}

export function periodLabel(period) {
  if (!period) return '-';
  return `${safe(period.date_from)} -> ${safe(period.date_to)}`;
}

export function settlementPeriodLabel(settlement, periodsMap) {
  return periodLabel(periodsMap[String(settlement.period_id)]);
}

export function dateRangeOverlaps(startA, endA, startB, endB) {
  const fromA = safe(startA);
  const toA = safe(endA) || '9999-12-31';
  const fromB = safe(startB);
  const toB = safe(endB) || '9999-12-31';
  if (!fromA || !fromB) return false;
  return fromA <= toB && fromB <= toA;
}

export function rangeOverlapDays(startA, endA, startB, endB) {
  if (!dateRangeOverlaps(startA, endA, startB, endB)) return 0;
  const overlapFrom = safe(startA) > safe(startB) ? safe(startA) : safe(startB);
  const overlapTo = (safe(endA) || '9999-12-31') < (safe(endB) || '9999-12-31')
    ? (safe(endA) || '9999-12-31')
    : (safe(endB) || '9999-12-31');
  const startDate = new Date(`${overlapFrom}T00:00:00`);
  const endDate = new Date(`${overlapTo}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  return Math.max(0, Math.floor((endDate - startDate) / 86400000) + 1);
}

export function summarizeStatuses(statuses, fallback = 'draft') {
  const normalized = (statuses || [])
    .map(status => safe(status).toLowerCase())
    .filter(Boolean);

  if (!normalized.length) return fallback;
  if (normalized.every(status => status === 'paid')) return 'paid';
  if (normalized.every(status => ['paid', 'sent'].includes(status))) return normalized.includes('sent') ? 'sent' : 'paid';
  if (normalized.every(status => status === 'approved')) return 'approved';
  if (normalized.every(status => status === 'calculated')) return 'calculated';
  if (normalized.includes('disputed')) return 'disputed';

  const priority = ['sent', 'approved', 'calculated', 'draft', 'pending'];
  for (const status of priority) {
    if (normalized.includes(status)) return status;
  }

  return normalized[0];
}

export function ownerSettlementDocKey(ownerSettlement) {
  return `owner-settlement:${safe(ownerSettlement.period_id)}:${safe(ownerSettlement.owner_id)}`;
}

export function nullIfBlank(value) {
  const clean = safe(value);
  return clean ? clean : null;
}

export function splitName(name) {
  const parts = safe(name).split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || null,
    last_name: parts.slice(1).join(' ') || null
  };
}

export function daysUntil(dateString) {
  const clean = safe(dateString);
  if (!clean) return null;
  const today = new Date(`${todayIso()}T00:00:00`);
  const target = new Date(`${clean}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.floor((target - today) / 86400000);
}

export function sortByDateDesc(items, key) {
  return [...(items || [])].sort((left, right) => safe(right?.[key]).localeCompare(safe(left?.[key])));
}

export function firstNumericValue(record, keys = []) {
  for (const key of keys) {
    const parsed = Number(record?.[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
