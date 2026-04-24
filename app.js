const SUPABASE_URL = 'https://tegravrxaqcuktwjanzm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FWerGr6XL94LiVQs2Lel-A_2M3sTKIu';

const { createClient } = supabase;

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

const state = {
  session: null,
  profile: null,
  roles: [],
  currentPage: 'dashboard',
  drivers: [],
  vehicles: [],
  owners: [],
  periods: [],
  settlements: [],
  documents: [],
  assignments: [],
  selectedDetails: null,
  filters: {
    driverSearch: '',
    vehicleSearch: '',
    ownerSearch: '',
    settlementSearch: '',
    settlementPeriod: 'all',
    settlementStatus: 'all'
  },
  forms: {
    driver: false,
    vehicle: false,
    owner: false,
    period: false
  }
};

const el = {};
let authSubscription = null;
let isLoadingData = false;

const AUTH_STORAGE_KEY = 'sb-tegravrxaqcuktwjanzm-auth-token';
let authHydrating = false;

function safe(v) {
  return v == null ? '' : String(v).trim();
}

function num(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function money(v) {
  return num(v).toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' zł';
}

function escapeHtml(text) {
  return safe(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showMsg(target, text, type = 'error') {
  if (!target) return;
  target.innerHTML = `<div class="msg ${type}">${escapeHtml(text)}</div>`;
}

function clearMsg(target) {
  if (!target) return;
  target.innerHTML = '';
}

function isAuthStorageBroken() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !parsed || typeof parsed !== 'object';
  } catch {
    return true;
  }
}

async function resetBrokenSession(reason = '') {
  try {
    await db.auth.signOut({ scope: 'local' });
  } catch (_) {}

  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (_) {}

  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (_) {}

  state.session = null;
  state.profile = null;
  state.roles = [];
  state.selectedDetails = null;

  renderAppShell(false);

  if (reason) {
    showMsg(el.msg, `Сесію очищено. Увійди ще раз. ${reason}`, 'error');
  }
}

async function applySession(session) {
  state.session = session || null;

  if (!session) {
    state.profile = null;
    state.roles = [];
    renderAppShell(false);
    return;
  }

  await loadProfileAndRoles(session.user.id);

  if (!isStaff()) {
    await resetBrokenSession('У цього акаунта немає ролі admin/operator');
    return;
  }

  renderAppShell(true);

  if (el.userEmail) {
    el.userEmail.textContent = state.profile?.email || session.user?.email || '';
  }

  await loadAllData();
}

function qs(id) {
  return document.getElementById(id);
}

function mapById(list) {
  const m = {};
  (list || []).forEach(item => {
    m[String(item.id)] = item;
  });
  return m;
}

function shortId(id) {
  return escapeHtml(String(id || '').slice(0, 8));
}

function fullName(driver) {
  if (!driver) return '-';
  return (
    safe(driver.full_name) ||
    [safe(driver.first_name), safe(driver.last_name)].filter(Boolean).join(' ') ||
    safe(driver.email) ||
    `Driver #${driver.id}`
  );
}

function ownerLabel(owner) {
  if (!owner) return '-';
  return (
    safe(owner.company_name) ||
    safe(owner.full_name) ||
    `Owner #${owner.id}`
  );
}

function vehicleLabel(vehicle) {
  if (!vehicle) return '-';
  return (
    safe(vehicle.plate_number) ||
    [safe(vehicle.brand), safe(vehicle.model), safe(vehicle.year)].filter(Boolean).join(' ') ||
    `Vehicle #${vehicle.id}`
  );
}

function badgeClass(status) {
  const s = safe(status).toLowerCase();
  if (['active', 'ready', 'approved', 'calculated', 'paid', 'sent', 'signed'].includes(s)) return 'active';
  if (['closed', 'archived', 'inactive'].includes(s)) return 'closed';
  if (['open', 'draft', 'pending', 'missing'].includes(s)) return 'ready';
  return '';
}

function periodLabel(period) {
  if (!period) return '-';
  return `${safe(period.date_from)} → ${safe(period.date_to)}`;
}

function settlementPeriodLabel(settlement, periodsMap) {
  const period = periodsMap[String(settlement.period_id)];
  return periodLabel(period);
}

function isStaff() {
  return state.roles.includes('admin') || state.roles.includes('operator');
}

function getCurrentAssignmentForDriver(driverId) {
  return state.assignments.find(
    a =>
      String(a.driver_id) === String(driverId) &&
      (!a.assigned_to || a.assigned_to >= new Date().toISOString().slice(0, 10))
  ) || null;
}

function getCurrentAssignmentForVehicle(vehicleId) {
  return state.assignments.find(
    a =>
      String(a.vehicle_id) === String(vehicleId) &&
      (!a.assigned_to || a.assigned_to >= new Date().toISOString().slice(0, 10))
  ) || null;
}

function nullIfBlank(v) {
  const s = safe(v);
  return s ? s : null;
}

function splitName(full) {
  const clean = safe(full);
  const parts = clean.split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || null,
    last_name: parts.slice(1).join(' ') || null
  };
}

function closeAllForms() {
  state.forms = {
    driver: false,
    vehicle: false,
    owner: false,
    period: false
  };
}

function toggleForm(formKey) {
  const next = !state.forms[formKey];
  closeAllForms();
  state.forms[formKey] = next;
  renderAll();
}

async function createDriver(payload) {
  const { error } = await db.from('drivers').insert([payload]);
  if (error) throw error;
}

async function createOwner(payload) {
  const { error } = await db.from('vehicle_owners').insert([payload]);
  if (error) throw error;
}

async function createVehicle(payload) {
  const { error } = await db.from('vehicles').insert([payload]);
  if (error) throw error;
}

async function createPeriod(payload) {
  const { error } = await db.from('settlement_periods').insert([payload]);
  if (error) throw error;
}

async function onCreateDriverSubmit(event) {
  event.preventDefault();
  clearMsg(el.appMsg);

  const fd = new FormData(event.target);
  const full_name = safe(fd.get('full_name'));

  if (!full_name) {
    showMsg(el.appMsg, 'Для водія потрібне ім’я');
    return;
  }

  const names = splitName(full_name);

  const payload = {
    full_name,
    first_name: names.first_name,
    last_name: names.last_name,
    email: nullIfBlank(fd.get('email')),
    phone: nullIfBlank(fd.get('phone')),
    passport_number: nullIfBlank(fd.get('passport_number')),
    driver_license_number: nullIfBlank(fd.get('driver_license_number')),
    status: safe(fd.get('status')) || 'active',
    contract_status: safe(fd.get('contract_status')) || 'missing',
    onboarding_stage: safe(fd.get('onboarding_stage')) || 'new',
    joined_at: nullIfBlank(fd.get('joined_at')),
    notes: nullIfBlank(fd.get('notes'))
  };

  try {
    await createDriver(payload);
    showMsg(el.appMsg, 'Водія створено', 'success');
    closeAllForms();
    await loadAllData();
  } catch (e) {
    showMsg(el.appMsg, e.message || 'Не вдалося створити водія');
  }
}

async function onCreateOwnerSubmit(event) {
  event.preventDefault();
  clearMsg(el.appMsg);

  const fd = new FormData(event.target);
  const owner_type = safe(fd.get('owner_type')) || 'company';
  const company_name = nullIfBlank(fd.get('company_name'));
  const full_name = nullIfBlank(fd.get('full_name'));

  if (owner_type === 'company' && !company_name) {
    showMsg(el.appMsg, 'Для company потрібно заповнити company name');
    return;
  }

  if (owner_type === 'person' && !full_name) {
    showMsg(el.appMsg, 'Для person потрібно заповнити full name');
    return;
  }

  const payload = {
    owner_type,
    company_name,
    full_name,
    email: nullIfBlank(fd.get('email')),
    phone: nullIfBlank(fd.get('phone')),
    bank_account: nullIfBlank(fd.get('bank_account')),
    settlement_terms: nullIfBlank(fd.get('settlement_terms')),
    notes: nullIfBlank(fd.get('notes'))
  };

  try {
    await createOwner(payload);
    showMsg(el.appMsg, 'Власника створено', 'success');
    closeAllForms();
    await loadAllData();
  } catch (e) {
    showMsg(el.appMsg, e.message || 'Не вдалося створити власника');
  }
}

async function onCreateVehicleSubmit(event) {
  event.preventDefault();
  clearMsg(el.appMsg);

  const fd = new FormData(event.target);
  const owner_id = safe(fd.get('owner_id'));
  const plate_number = safe(fd.get('plate_number'));

  if (!owner_id) {
    showMsg(el.appMsg, 'Для авто потрібно вибрати власника');
    return;
  }

  if (!plate_number) {
    showMsg(el.appMsg, 'Для авто потрібен номер');
    return;
  }

  const payload = {
    owner_id,
    plate_number,
    vin: nullIfBlank(fd.get('vin')),
    brand: nullIfBlank(fd.get('brand')),
    model: nullIfBlank(fd.get('model')),
    year: nullIfBlank(fd.get('year')) ? Number(fd.get('year')) : null,
    fuel_type: safe(fd.get('fuel_type')) || 'hybrid',
    ownership_type: safe(fd.get('ownership_type')) || 'owner_external',
    insurance_expiry: nullIfBlank(fd.get('insurance_expiry')),
    inspection_expiry: nullIfBlank(fd.get('inspection_expiry')),
    status: safe(fd.get('status')) || 'active',
    notes: nullIfBlank(fd.get('notes'))
  };

  try {
    await createVehicle(payload);
    showMsg(el.appMsg, 'Авто створено', 'success');
    closeAllForms();
    await loadAllData();
  } catch (e) {
    showMsg(el.appMsg, e.message || 'Не вдалося створити авто');
  }
}

async function onCreatePeriodSubmit(event) {
  event.preventDefault();
  clearMsg(el.appMsg);

  const fd = new FormData(event.target);
  const date_from = safe(fd.get('date_from'));
  const date_to = safe(fd.get('date_to'));

  if (!date_from || !date_to) {
    showMsg(el.appMsg, 'Для періоду потрібні date_from і date_to');
    return;
  }

  const payload = {
    period_type: safe(fd.get('period_type')) || 'weekly',
    date_from,
    date_to,
    status: safe(fd.get('status')) || 'draft',
    notes: nullIfBlank(fd.get('notes'))
  };

  try {
    await createPeriod(payload);
    showMsg(el.appMsg, 'Період створено', 'success');
    closeAllForms();
    await loadAllData();
  } catch (e) {
    showMsg(el.appMsg, e.message || 'Не вдалося створити період');
  }
}

function collectElements() {
  el.authView = qs('authView');
  el.appView = qs('appView');
  el.msg = qs('msg');
  el.appMsg = qs('appMsg');
  el.email = qs('email');
  el.password = qs('password');
  el.signInBtn = qs('signInBtn');
  el.signUpBtn = qs('signUpBtn');
  el.logoutBtn = qs('logoutBtn');
  el.refreshBtn = qs('refreshBtn');
  el.userEmail = qs('userEmail');
  el.pageTitle = qs('pageTitle');
  el.pageSubtitle = qs('pageSubtitle');
  el.dashboardPage = qs('page-dashboard');
  el.driversPage = qs('page-drivers');
  el.vehiclesPage = qs('page-vehicles');
  el.ownersPage = qs('page-owners');
  el.settlementsPage = qs('page-settlements');
  el.detailsPanel = qs('detailsPanel');
  el.detailsKicker = qs('detailsKicker');
  el.detailsTitle = qs('detailsTitle');
  el.detailsBody = qs('detailsBody');
  el.closeDetailsBtn = qs('closeDetailsBtn');
}

function menuButtons() {
  return Array.from(document.querySelectorAll('.menu-btn'));
}

function renderAppShell(loggedIn) {
  if (!el.authView || !el.appView) return;

  if (loggedIn) {
    el.authView.classList.add('hidden');
    el.appView.classList.remove('hidden');
  } else {
    el.appView.classList.add('hidden');
    el.authView.classList.remove('hidden');
  }
}

function setPage(page) {
  state.currentPage = page;

  const pages = {
    dashboard: el.dashboardPage,
    drivers: el.driversPage,
    vehicles: el.vehiclesPage,
    owners: el.ownersPage,
    settlements: el.settlementsPage
  };

  Object.entries(pages).forEach(([key, node]) => {
    if (!node) return;
    if (key === page) node.classList.remove('hidden');
    else node.classList.add('hidden');
  });

  menuButtons().forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  if (el.pageTitle && el.pageSubtitle) {
    if (page === 'dashboard') {
      el.pageTitle.textContent = 'Dashboard';
      el.pageSubtitle.textContent = 'Settlement-first back office';
    }
    if (page === 'drivers') {
      el.pageTitle.textContent = 'Водії';
      el.pageSubtitle.textContent = 'Список водіїв';
    }
    if (page === 'vehicles') {
      el.pageTitle.textContent = 'Авто';
      el.pageSubtitle.textContent = 'Список авто та власників';
    }
    if (page === 'owners') {
      el.pageTitle.textContent = 'Власники';
      el.pageSubtitle.textContent = 'Список власників авто';
    }
    if (page === 'settlements') {
      el.pageTitle.textContent = 'Розрахунки';
      el.pageSubtitle.textContent = 'Driver settlements по періодах';
    }
  }
}

function setAuthButtonsDisabled(disabled) {
  if (el.signInBtn) el.signInBtn.disabled = disabled;
  if (el.signUpBtn) el.signUpBtn.disabled = disabled;
}

async function signUp() {
  clearMsg(el.msg);

  const email = safe(el.email?.value);
  const password = safe(el.password?.value);

  if (!email || !password) {
    showMsg(el.msg, 'Введи email і пароль');
    return;
  }

  setAuthButtonsDisabled(true);

  try {
    const { data, error } = await db.auth.signUp({ email, password });

    if (error) {
      showMsg(el.msg, error.message);
      return;
    }

    if (data?.session) {
      showMsg(el.msg, 'Реєстрація пройшла успішно', 'success');
      await loadSessionAndData();
    } else {
      showMsg(el.msg, 'Акаунт створено. Якщо потрібне підтвердження email — підтвердь пошту і увійди.', 'success');
    }
  } catch (e) {
    showMsg(el.msg, e.message || 'Помилка реєстрації');
  } finally {
    setAuthButtonsDisabled(false);
  }
}

async function signIn() {
  clearMsg(el.msg);

  const email = safe(el.email?.value);
  const password = safe(el.password?.value);

  if (!email || !password) {
    showMsg(el.msg, 'Введи email і пароль');
    return;
  }

  setAuthButtonsDisabled(true);

  try {
    const { error } = await db.auth.signInWithPassword({ email, password });

    if (error) {
      showMsg(el.msg, error.message);
      return;
    }

    showMsg(el.msg, 'Успішний вхід', 'success');
    await loadSessionAndData();
  } catch (e) {
    showMsg(el.msg, e.message || 'Помилка входу');
  } finally {
    setAuthButtonsDisabled(false);
  }
}

async function signOut() {
  try {
    await db.auth.signOut();
  } catch (e) {
    console.error('signOut error:', e);
  }

  state.session = null;
  state.profile = null;
  state.roles = [];
  state.selectedDetails = null;
  renderAppShell(false);
  clearMsg(el.appMsg);
}

async function loadProfileAndRoles(userId) {
  const [profileRes, rolesRes] = await Promise.all([
    db.from('profiles').select('*').eq('id', userId).maybeSingle(),
    db.from('user_roles').select('role').eq('user_id', userId)
  ]);

  if (profileRes.error) throw profileRes.error;
  if (rolesRes.error) throw rolesRes.error;

  state.profile = profileRes.data || null;
  state.roles = (rolesRes.data || []).map(r => r.role);
}

async function loadSessionAndData() {
  clearMsg(el.appMsg);

  try {
    const { data, error } = await db.auth.getSession();

    if (error) {
      showMsg(el.msg, error.message);
      return;
    }

    const session = data?.session || null;
    state.session = session;

    if (!session) {
      renderAppShell(false);
      return;
    }

    await loadProfileAndRoles(session.user.id);

    if (!isStaff()) {
      await db.auth.signOut();
      renderAppShell(false);
      showMsg(el.msg, 'У цього акаунта немає ролі admin/operator');
      return;
    }

    renderAppShell(true);

    if (el.userEmail) {
      el.userEmail.textContent = state.profile?.email || session.user?.email || '';
    }

    await loadAllData();
  } catch (e) {
    console.error(e);
    showMsg(el.appMsg || el.msg, e.message || 'Помилка завантаження сесії');
  }
}

async function loadAllData() {
  if (isLoadingData) return;
  isLoadingData = true;

  clearMsg(el.appMsg);

  try {
    const [
      driversRes,
      vehiclesRes,
      ownersRes,
      periodsRes,
      settlementsRes,
      documentsRes,
      assignmentsRes
    ] = await Promise.all([
      db.from('drivers').select('*').order('created_at', { ascending: false }),
      db.from('vehicles').select('*').order('created_at', { ascending: false }),
      db.from('vehicle_owners').select('*').order('created_at', { ascending: false }),
      db.from('settlement_periods').select('*').order('date_from', { ascending: false }),
      db.from('driver_settlements').select('*').order('created_at', { ascending: false }),
      db.from('documents').select('*').order('created_at', { ascending: false }),
      db.from('driver_vehicle_assignments').select('*').order('assigned_from', { ascending: false })
    ]);

    const err =
      driversRes.error ||
      vehiclesRes.error ||
      ownersRes.error ||
      periodsRes.error ||
      settlementsRes.error ||
      documentsRes.error ||
      assignmentsRes.error;

    if (err) {
      showMsg(el.appMsg, err.message || 'Помилка завантаження');
      return;
    }

    state.drivers = driversRes.data || [];
    state.vehicles = vehiclesRes.data || [];
    state.owners = ownersRes.data || [];
    state.periods = periodsRes.data || [];
    state.settlements = settlementsRes.data || [];
    state.documents = documentsRes.data || [];
    state.assignments = assignmentsRes.data || [];

    renderAll();
  } catch (e) {
    console.error(e);
    showMsg(el.appMsg, e.message || 'Помилка завантаження даних');
  } finally {
    isLoadingData = false;
  }
}

function renderAll() {
  try {
    renderDashboard();
    renderDriversPage();
    renderVehiclesPage();
    renderOwnersPage();
    renderSettlementsPage();
    renderDetailsPanel();
  } catch (e) {
    console.error('renderAll error:', e);
    showMsg(el.appMsg, e.message || 'Помилка рендеру сторінки');
  }
}

function renderDashboard() {
  const settlements = state.settlements;
  const periodsMap = mapById(state.periods);
  const driversMap = mapById(state.drivers);
  const vehiclesMap = mapById(state.vehicles);

  const payoutTotal = settlements.reduce((sum, r) => sum + num(r.payout_to_driver), 0);
  const debtTotal = settlements.reduce((sum, r) => {
    const balance = num(r.carry_forward_balance);
    return sum + (balance < 0 ? Math.abs(balance) : 0);
  }, 0);
  const grossIncomeTotal = settlements.reduce((sum, r) => sum + num(r.gross_platform_income), 0);
  const commissionTotal = settlements.reduce((sum, r) => sum + num(r.company_commission), 0);
  const settlementDocsCount = state.documents.filter(d => safe(d.document_type) === 'settlement_pdf').length;
  const recent = settlements.slice(0, 8);

  if (!el.dashboardPage) return;

  el.dashboardPage.innerHTML = `
    <div class="cards">
      <div class="card">
        <div class="metric-label">Водії</div>
        <div class="metric-value">${state.drivers.length}</div>
      </div>
      <div class="card">
        <div class="metric-label">Авто</div>
        <div class="metric-value">${state.vehicles.length}</div>
      </div>
      <div class="card">
        <div class="metric-label">Власники</div>
        <div class="metric-value">${state.owners.length}</div>
      </div>
      <div class="card">
        <div class="metric-label">Періоди</div>
        <div class="metric-value">${state.periods.length}</div>
      </div>
      <div class="card">
        <div class="metric-label">Gross income</div>
        <div class="metric-value">${money(grossIncomeTotal)}</div>
      </div>
      <div class="card">
        <div class="metric-label">Комісія компанії</div>
        <div class="metric-value">${money(commissionTotal)}</div>
      </div>
      <div class="card">
        <div class="metric-label">До виплати водіям</div>
        <div class="metric-value">${money(payoutTotal)}</div>
      </div>
      <div class="card">
        <div class="metric-label">Борг / carry forward</div>
        <div class="metric-value">${money(debtTotal)}</div>
      </div>
    </div>

    <div class="layout-3">
      <div class="card">
        <h3 class="card-title">Останні розрахунки</h3>
        ${
          recent.length
            ? recent.map(r => `
              <div class="row">
                <div>
                  <strong>${escapeHtml(settlementPeriodLabel(r, periodsMap))}</strong><br>
                  <span class="muted">${escapeHtml(fullName(driversMap[String(r.driver_id)]))}</span><br>
                  <span class="muted">${escapeHtml(vehicleLabel(vehiclesMap[String(r.vehicle_id)]))}</span>
                </div>
                <div style="text-align:right">
                  <strong>${money(r.payout_to_driver)}</strong><br>
                  <span class="badge ${badgeClass(r.status)}">${escapeHtml(safe(r.status) || '-')}</span>
                </div>
              </div>
            `).join('')
            : `<div class="empty">Немає розрахунків</div>`
        }
      </div>

      <div class="card">
        <h3 class="card-title">Статуси</h3>
        <div class="row">
          <div>Активні водії</div>
          <div><strong>${state.drivers.filter(d => safe(d.status).toLowerCase() === 'active').length}</strong></div>
        </div>
        <div class="row">
          <div>Активні авто</div>
          <div><strong>${state.vehicles.filter(v => safe(v.status).toLowerCase() === 'active').length}</strong></div>
        </div>
        <div class="row">
          <div>Розрахунки CALCULATED</div>
          <div><strong>${settlements.filter(r => safe(r.status).toLowerCase() === 'calculated').length}</strong></div>
        </div>
        <div class="row">
          <div>Розрахунки SENT</div>
          <div><strong>${settlements.filter(r => safe(r.status).toLowerCase() === 'sent').length}</strong></div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Швидка перевірка</h3>
        <div class="row">
          <div>Документи settlement</div>
          <div><strong>${settlementDocsCount}</strong></div>
        </div>
        <div class="row">
          <div>Позитивний payout</div>
          <div><strong>${settlements.filter(r => num(r.payout_to_driver) > 0).length}</strong></div>
        </div>
        <div class="row">
          <div>Нульовий payout</div>
          <div><strong>${settlements.filter(r => num(r.payout_to_driver) === 0).length}</strong></div>
        </div>
      </div>
    </div>
  `;
}

function renderDriversPage() {
  if (!el.driversPage) return;

  const q = safe(state.filters.driverSearch).toLowerCase();

  const rows = state.drivers.filter(d => {
    const blob = [
      fullName(d),
      safe(d.email),
      safe(d.phone),
      safe(d.status),
      safe(d.contract_status),
      safe(d.onboarding_stage)
    ].join(' ').toLowerCase();

    return !q || blob.includes(q);
  });

  el.driversPage.innerHTML = `
    <div class="card">
      <div class="action-bar">
        <div class="muted">Список водіїв</div>
        <button id="toggleDriverFormBtn" type="button">${state.forms.driver ? 'Сховати форму' : 'Додати водія'}</button>
      </div>

      ${
        state.forms.driver ? `
          <div class="form-card">
            <h3 class="form-title">Новий водій</h3>
            <form id="driverCreateForm">
              <div class="form-grid">
                <div class="form-field">
                  <label>ПІБ *</label>
                  <input name="full_name" required />
                </div>
                <div class="form-field">
                  <label>Email</label>
                  <input name="email" type="email" />
                </div>
                <div class="form-field">
                  <label>Телефон</label>
                  <input name="phone" />
                </div>
                <div class="form-field">
                  <label>Паспорт</label>
                  <input name="passport_number" />
                </div>
                <div class="form-field">
                  <label>Номер прав</label>
                  <input name="driver_license_number" />
                </div>
                <div class="form-field">
                  <label>Дата старту</label>
                  <input name="joined_at" type="date" />
                </div>
                <div class="form-field">
                  <label>Статус</label>
                  <select name="status">
                    <option value="active">active</option>
                    <option value="pending">pending</option>
                    <option value="blocked">blocked</option>
                    <option value="inactive">inactive</option>
                  </select>
                </div>
                <div class="form-field">
                  <label>Контракт</label>
                  <select name="contract_status">
                    <option value="missing">missing</option>
                    <option value="draft">draft</option>
                    <option value="signed">signed</option>
                    <option value="expired">expired</option>
                    <option value="terminated">terminated</option>
                  </select>
                </div>
                <div class="form-field">
                  <label>Онбординг</label>
                  <select name="onboarding_stage">
                    <option value="new">new</option>
                    <option value="documents">documents</option>
                    <option value="platform_setup">platform_setup</option>
                    <option value="vehicle_assigned">vehicle_assigned</option>
                    <option value="ready">ready</option>
                    <option value="inactive">inactive</option>
                  </select>
                </div>
              </div>

              <div class="form-field" style="margin-top:12px;">
                <label>Нотатки</label>
                <input name="notes" />
              </div>

              <div class="form-actions">
                <button type="submit">Створити</button>
                <button type="button" class="secondary" id="cancelDriverFormBtn">Скасувати</button>
              </div>
            </form>
          </div>
        ` : ''
      }

      <div class="filters" style="grid-template-columns:1fr;">
        <input id="driversSearch" placeholder="Пошук по імені, email, телефону..." value="${escapeHtml(safe(state.filters.driverSearch))}" />
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Водій</th>
              <th>Email</th>
              <th>Телефон</th>
              <th>Статус</th>
              <th>Контракт</th>
              <th>Онбординг</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows.map(d => `
                  <tr class="table-row-clickable ${state.selectedDetails?.type === 'driver' && String(state.selectedDetails.id) === String(d.id) ? 'selected' : ''}" data-detail-type="driver" data-detail-id="${escapeHtml(d.id)}">
                    <td>${shortId(d.id)}</td>
                    <td><strong>${escapeHtml(fullName(d))}</strong></td>
                    <td>${escapeHtml(safe(d.email) || '-')}</td>
                    <td>${escapeHtml(safe(d.phone) || '-')}</td>
                    <td><span class="badge ${badgeClass(d.status)}">${escapeHtml(safe(d.status) || '-')}</span></td>
                    <td>${escapeHtml(safe(d.contract_status) || '-')}</td>
                    <td>${escapeHtml(safe(d.onboarding_stage) || '-')}</td>
                  </tr>
                `).join('')
                : `<tr><td colspan="7" class="empty">Немає даних</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  qs('toggleDriverFormBtn')?.addEventListener('click', () => toggleForm('driver'));
  qs('cancelDriverFormBtn')?.addEventListener('click', () => toggleForm('driver'));
  qs('driverCreateForm')?.addEventListener('submit', onCreateDriverSubmit);

  const search = qs('driversSearch');
  if (search) {
    search.addEventListener('input', e => {
      state.filters.driverSearch = e.target.value;
      renderDriversPage();
    });
  }

  bindDetailRowClicks();
}

function renderVehiclesPage() {
  if (!el.vehiclesPage) return;

  const q = safe(state.filters.vehicleSearch).toLowerCase();
  const ownersMap = mapById(state.owners);

  const rows = state.vehicles.filter(v => {
    const blob = [
      vehicleLabel(v),
      safe(v.plate_number),
      safe(v.brand),
      safe(v.model),
      safe(v.status)
    ].join(' ').toLowerCase();

    return !q || blob.includes(q);
  });

  el.vehiclesPage.innerHTML = `
    <div class="card">
      <div class="action-bar">
        <div class="muted">Список авто та власників</div>
        <button id="toggleVehicleFormBtn" type="button">${state.forms.vehicle ? 'Сховати форму' : 'Додати авто'}</button>
      </div>

      ${
        state.forms.vehicle ? `
          <div class="form-card">
            <h3 class="form-title">Нове авто</h3>
            <form id="vehicleCreateForm">
              <div class="form-grid">
                <div class="form-field">
                  <label>Власник *</label>
                  <select name="owner_id" required>
                    <option value="">Вибери власника</option>
                    ${state.owners.map(o => `
                      <option value="${escapeHtml(o.id)}">${escapeHtml(ownerLabel(o))}</option>
                    `).join('')}
                  </select>
                </div>
                <div class="form-field">
                  <label>Номер *</label>
                  <input name="plate_number" required />
                </div>
                <div class="form-field">
                  <label>VIN</label>
                  <input name="vin" />
                </div>
                <div class="form-field">
                  <label>Марка</label>
                  <input name="brand" />
                </div>
                <div class="form-field">
                  <label>Модель</label>
                  <input name="model" />
                </div>
                <div class="form-field">
                  <label>Рік</label>
                  <input name="year" type="number" />
                </div>
                <div class="form-field">
                  <label>Пальне</label>
                  <select name="fuel_type">
                    <option value="hybrid">hybrid</option>
                    <option value="petrol">petrol</option>
                    <option value="diesel">diesel</option>
                    <option value="ev">ev</option>
                    <option value="lpg">lpg</option>
                    <option value="other">other</option>
                  </select>
                </div>
                <div class="form-field">
                  <label>Ownership type</label>
                  <select name="ownership_type">
                    <option value="owner_external">owner_external</option>
                    <option value="company">company</option>
                    <option value="leased">leased</option>
                    <option value="rented">rented</option>
                  </select>
                </div>
                <div class="form-field">
                  <label>Статус</label>
                  <select name="status">
                    <option value="active">active</option>
                    <option value="service">service</option>
                    <option value="repair">repair</option>
                    <option value="suspended">suspended</option>
                    <option value="archived">archived</option>
                  </select>
                </div>
              </div>

              <div class="form-grid-2" style="margin-top:12px;">
                <div class="form-field">
                  <label>Страховка до</label>
                  <input name="insurance_expiry" type="date" />
                </div>
                <div class="form-field">
                  <label>Огляд до</label>
                  <input name="inspection_expiry" type="date" />
                </div>
              </div>

              <div class="form-field" style="margin-top:12px;">
                <label>Нотатки</label>
                <input name="notes" />
              </div>

              <div class="form-actions">
                <button type="submit">Створити</button>
                <button type="button" class="secondary" id="cancelVehicleFormBtn">Скасувати</button>
              </div>
            </form>
          </div>
        ` : ''
      }

      <div class="filters" style="grid-template-columns:1fr;">
        <input id="vehiclesSearch" placeholder="Пошук по номеру, марці, моделі..." value="${escapeHtml(safe(state.filters.vehicleSearch))}" />
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Номер</th>
              <th>Марка / модель</th>
              <th>Рік</th>
              <th>Власник</th>
              <th>Статус</th>
              <th>Страховка</th>
              <th>Огляд</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows.map(v => `
                  <tr class="table-row-clickable ${state.selectedDetails?.type === 'vehicle' && String(state.selectedDetails.id) === String(v.id) ? 'selected' : ''}" data-detail-type="vehicle" data-detail-id="${escapeHtml(v.id)}">
                    <td>${shortId(v.id)}</td>
                    <td><strong>${escapeHtml(safe(v.plate_number) || '-')}</strong></td>
                    <td>${escapeHtml([safe(v.brand), safe(v.model)].filter(Boolean).join(' ') || '-')}</td>
                    <td>${escapeHtml(safe(v.year) || '-')}</td>
                    <td>${escapeHtml(ownerLabel(ownersMap[String(v.owner_id)]))}</td>
                    <td><span class="badge ${badgeClass(v.status)}">${escapeHtml(safe(v.status) || '-')}</span></td>
                    <td>${escapeHtml(safe(v.insurance_expiry) || '-')}</td>
                    <td>${escapeHtml(safe(v.inspection_expiry) || '-')}</td>
                  </tr>
                `).join('')
                : `<tr><td colspan="8" class="empty">Немає даних</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  qs('toggleVehicleFormBtn')?.addEventListener('click', () => toggleForm('vehicle'));
  qs('cancelVehicleFormBtn')?.addEventListener('click', () => toggleForm('vehicle'));
  qs('vehicleCreateForm')?.addEventListener('submit', onCreateVehicleSubmit);

  const search = qs('vehiclesSearch');
  if (search) {
    search.addEventListener('input', e => {
      state.filters.vehicleSearch = e.target.value;
      renderVehiclesPage();
    });
  }

  bindDetailRowClicks();
}

function renderOwnersPage() {
  if (!el.ownersPage) return;

  const q = safe(state.filters.ownerSearch).toLowerCase();

  const rows = state.owners.filter(o => {
    const blob = [
      ownerLabel(o),
      safe(o.email),
      safe(o.phone),
      safe(o.bank_account),
      safe(o.owner_type)
    ].join(' ').toLowerCase();

    return !q || blob.includes(q);
  });

  const vehiclesByOwner = state.vehicles.reduce((acc, vehicle) => {
    const key = String(vehicle.owner_id || '');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  el.ownersPage.innerHTML = `
    <div class="card">
      <div class="action-bar">
        <div class="muted">Список власників авто</div>
        <button id="toggleOwnerFormBtn" type="button">${state.forms.owner ? 'Сховати форму' : 'Додати власника'}</button>
      </div>

      ${
        state.forms.owner ? `
          <div class="form-card">
            <h3 class="form-title">Новий власник</h3>
            <form id="ownerCreateForm">
              <div class="form-grid">
                <div class="form-field">
                  <label>Тип</label>
                  <select name="owner_type">
                    <option value="company">company</option>
                    <option value="person">person</option>
                  </select>
                </div>
                <div class="form-field">
                  <label>Company name</label>
                  <input name="company_name" />
                </div>
                <div class="form-field">
                  <label>Full name</label>
                  <input name="full_name" />
                </div>
                <div class="form-field">
                  <label>Email</label>
                  <input name="email" type="email" />
                </div>
                <div class="form-field">
                  <label>Телефон</label>
                  <input name="phone" />
                </div>
                <div class="form-field">
                  <label>Рахунок</label>
                  <input name="bank_account" />
                </div>
              </div>

              <div class="form-grid-2" style="margin-top:12px;">
                <div class="form-field">
                  <label>Умови виплат</label>
                  <input name="settlement_terms" />
                </div>
                <div class="form-field">
                  <label>Нотатки</label>
                  <input name="notes" />
                </div>
              </div>

              <div class="helper-text">Для company заповни company name. Для person заповни full name.</div>

              <div class="form-actions">
                <button type="submit">Створити</button>
                <button type="button" class="secondary" id="cancelOwnerFormBtn">Скасувати</button>
              </div>
            </form>
          </div>
        ` : ''
      }

      <div class="filters" style="grid-template-columns:1fr;">
        <input id="ownersSearch" placeholder="Пошук по назві, email, телефону..." value="${escapeHtml(safe(state.filters.ownerSearch))}" />
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Власник</th>
              <th>Тип</th>
              <th>Email</th>
              <th>Телефон</th>
              <th>Авто</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows.map(o => `
                  <tr class="table-row-clickable ${state.selectedDetails?.type === 'owner' && String(state.selectedDetails.id) === String(o.id) ? 'selected' : ''}" data-detail-type="owner" data-detail-id="${escapeHtml(o.id)}">
                    <td>${shortId(o.id)}</td>
                    <td><strong>${escapeHtml(ownerLabel(o))}</strong></td>
                    <td>${escapeHtml(safe(o.owner_type) || '-')}</td>
                    <td>${escapeHtml(safe(o.email) || '-')}</td>
                    <td>${escapeHtml(safe(o.phone) || '-')}</td>
                    <td>${vehiclesByOwner[String(o.id)] || 0}</td>
                  </tr>
                `).join('')
                : `<tr><td colspan="6" class="empty">Немає даних</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  qs('toggleOwnerFormBtn')?.addEventListener('click', () => toggleForm('owner'));
  qs('cancelOwnerFormBtn')?.addEventListener('click', () => toggleForm('owner'));
  qs('ownerCreateForm')?.addEventListener('submit', onCreateOwnerSubmit);

  const search = qs('ownersSearch');
  if (search) {
    search.addEventListener('input', e => {
      state.filters.ownerSearch = e.target.value;
      renderOwnersPage();
    });
  }

  bindDetailRowClicks();
}

function renderSettlementsPage() {
  if (!el.settlementsPage) return;

  const driversMap = mapById(state.drivers);
  const vehiclesMap = mapById(state.vehicles);
  const periodsMap = mapById(state.periods);

  const periodOptions = state.periods.map(p => ({
    value: String(p.id),
    label: periodLabel(p)
  }));

  const q = safe(state.filters.settlementSearch).toLowerCase();
  const periodFilter = safe(state.filters.settlementPeriod);
  const statusFilter = safe(state.filters.settlementStatus).toLowerCase();

  const rows = state.settlements.filter(r => {
    const driver = driversMap[String(r.driver_id)];
    const vehicle = vehiclesMap[String(r.vehicle_id)];
    const period = periodsMap[String(r.period_id)];

    const blob = [
      settlementPeriodLabel(r, periodsMap),
      fullName(driver),
      safe(driver?.email),
      vehicleLabel(vehicle),
      safe(r.status)
    ].join(' ').toLowerCase();

    const periodOk = periodFilter === 'all' || String(r.period_id) === periodFilter;
    const statusOk = statusFilter === 'all' || safe(r.status).toLowerCase() === statusFilter;
    const searchOk = !q || blob.includes(q);

    return periodOk && statusOk && searchOk && period;
  });

  el.settlementsPage.innerHTML = `
    <div class="card">
      <div class="action-bar">
        <div class="muted">Driver settlements по періодах</div>
        <button id="togglePeriodFormBtn" type="button">${state.forms.period ? 'Сховати форму' : 'Додати період'}</button>
      </div>

      ${
        state.forms.period ? `
          <div class="form-card">
            <h3 class="form-title">Новий період</h3>
            <form id="periodCreateForm">
              <div class="form-grid">
                <div class="form-field">
                  <label>Тип</label>
                  <select name="period_type">
                    <option value="weekly">weekly</option>
                    <option value="monthly">monthly</option>
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
                <div class="form-field">
                  <label>Статус</label>
                  <select name="status">
                    <option value="draft">draft</option>
                    <option value="imported">imported</option>
                    <option value="calculated">calculated</option>
                    <option value="approved">approved</option>
                    <option value="closed">closed</option>
                    <option value="sent">sent</option>
                  </select>
                </div>
                <div class="form-field" style="grid-column: span 2;">
                  <label>Нотатки</label>
                  <input name="notes" />
                </div>
              </div>

              <div class="form-actions">
                <button type="submit">Створити</button>
                <button type="button" class="secondary" id="cancelPeriodFormBtn">Скасувати</button>
              </div>
            </form>
          </div>
        ` : ''
      }

      <div class="filters">
        <input id="settlementsSearch" placeholder="Пошук по водію, email, авто..." value="${escapeHtml(safe(state.filters.settlementSearch))}" />

        <select id="settlementsPeriod">
          <option value="all">Усі періоди</option>
          ${periodOptions.map(p => `
            <option value="${escapeHtml(p.value)}" ${p.value === state.filters.settlementPeriod ? 'selected' : ''}>
              ${escapeHtml(p.label)}
            </option>
          `).join('')}
        </select>

        <select id="settlementsStatus">
          <option value="all">Усі статуси</option>
          <option value="draft" ${state.filters.settlementStatus === 'draft' ? 'selected' : ''}>DRAFT</option>
          <option value="calculated" ${state.filters.settlementStatus === 'calculated' ? 'selected' : ''}>CALCULATED</option>
          <option value="approved" ${state.filters.settlementStatus === 'approved' ? 'selected' : ''}>APPROVED</option>
          <option value="sent" ${state.filters.settlementStatus === 'sent' ? 'selected' : ''}>SENT</option>
          <option value="paid" ${state.filters.settlementStatus === 'paid' ? 'selected' : ''}>PAID</option>
        </select>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Період</th>
              <th>Водій</th>
              <th>Авто</th>
              <th>Gross</th>
              <th>Bonus</th>
              <th>Cash</th>
              <th>Комісія</th>
              <th>Оренда</th>
              <th>Payout</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows.map(r => `
                  <tr class="table-row-clickable ${state.selectedDetails?.type === 'settlement' && String(state.selectedDetails.id) === String(r.id) ? 'selected' : ''}" data-detail-type="settlement" data-detail-id="${escapeHtml(r.id)}">
                    <td><strong>${escapeHtml(settlementPeriodLabel(r, periodsMap))}</strong></td>
                    <td>
                      <strong>${escapeHtml(fullName(driversMap[String(r.driver_id)]))}</strong><br>
                      <span class="muted">${escapeHtml(safe(driversMap[String(r.driver_id)]?.email) || '')}</span>
                    </td>
                    <td>${escapeHtml(vehicleLabel(vehiclesMap[String(r.vehicle_id)]))}</td>
                    <td>${money(r.gross_platform_income)}</td>
                    <td>${money(r.bonuses)}</td>
                    <td>${money(r.cash_collected)}</td>
                    <td>${money(r.company_commission)}</td>
                    <td>${money(r.rent_total)}</td>
                    <td><strong>${money(r.payout_to_driver)}</strong></td>
                    <td><span class="badge ${badgeClass(r.status)}">${escapeHtml(safe(r.status) || '-')}</span></td>
                  </tr>
                `).join('')
                : `<tr><td colspan="10" class="empty">Немає даних</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  qs('togglePeriodFormBtn')?.addEventListener('click', () => toggleForm('period'));
  qs('cancelPeriodFormBtn')?.addEventListener('click', () => toggleForm('period'));
  qs('periodCreateForm')?.addEventListener('submit', onCreatePeriodSubmit);

  const search = qs('settlementsSearch');
  const periodSelect = qs('settlementsPeriod');
  const statusSelect = qs('settlementsStatus');

  if (search) {
    search.addEventListener('input', e => {
      state.filters.settlementSearch = e.target.value;
      renderSettlementsPage();
    });
  }

  if (periodSelect) {
    periodSelect.addEventListener('change', e => {
      state.filters.settlementPeriod = e.target.value;
      renderSettlementsPage();
    });
  }

  if (statusSelect) {
    statusSelect.addEventListener('change', e => {
      state.filters.settlementStatus = e.target.value;
      renderSettlementsPage();
    });
  }

  bindDetailRowClicks();
}

function renderDetailsPanel() {
  if (!el.detailsPanel || !el.detailsTitle || !el.detailsBody || !el.detailsKicker) return;

  if (!state.selectedDetails) {
    el.detailsPanel.classList.add('hidden');
    return;
  }

  el.detailsPanel.classList.remove('hidden');

  const driversMap = mapById(state.drivers);
  const vehiclesMap = mapById(state.vehicles);
  const ownersMap = mapById(state.owners);
  const periodsMap = mapById(state.periods);

  if (state.selectedDetails.type === 'driver') {
    const driver = driversMap[String(state.selectedDetails.id)];
    if (!driver) {
      el.detailsPanel.classList.add('hidden');
      return;
    }

    const assignment = getCurrentAssignmentForDriver(driver.id);
    const vehicle = assignment ? vehiclesMap[String(assignment.vehicle_id)] : null;
    const settlements = state.settlements.filter(s => String(s.driver_id) === String(driver.id));
    const totalPayout = settlements.reduce((sum, s) => sum + num(s.payout_to_driver), 0);

    el.detailsKicker.textContent = 'Driver details';
    el.detailsTitle.textContent = fullName(driver);
    el.detailsBody.innerHTML = `
      <div class="details-section">
        <h4>Основне</h4>
        <div class="details-list">
          <div class="details-item"><div class="details-label">Email</div><div class="details-value">${escapeHtml(safe(driver.email) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Телефон</div><div class="details-value">${escapeHtml(safe(driver.phone) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Статус</div><div class="details-value">${escapeHtml(safe(driver.status) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Контракт</div><div class="details-value">${escapeHtml(safe(driver.contract_status) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Онбординг</div><div class="details-value">${escapeHtml(safe(driver.onboarding_stage) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Паспорт</div><div class="details-value">${escapeHtml(safe(driver.passport_number) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Права</div><div class="details-value">${escapeHtml(safe(driver.driver_license_number) || '-')}</div></div>
        </div>
      </div>

      <div class="details-section">
        <h4>Поточне авто</h4>
        <div class="details-list">
          <div class="details-item"><div class="details-label">Авто</div><div class="details-value">${escapeHtml(vehicleLabel(vehicle))}</div></div>
          <div class="details-item"><div class="details-label">Оренда</div><div class="details-value">${assignment ? money(assignment.driver_weekly_rent) : '-'}</div></div>
          <div class="details-item"><div class="details-label">Призначено</div><div class="details-value">${escapeHtml(safe(assignment?.assigned_from) || '-')}</div></div>
        </div>
      </div>

      <div class="details-section">
        <h4>Фінанси</h4>
        <div class="details-list">
          <div class="details-item"><div class="details-label">Розрахунків</div><div class="details-value">${settlements.length}</div></div>
          <div class="details-item"><div class="details-label">Разом payout</div><div class="details-value">${money(totalPayout)}</div></div>
        </div>
      </div>
    `;
    return;
  }

  if (state.selectedDetails.type === 'vehicle') {
    const vehicle = vehiclesMap[String(state.selectedDetails.id)];
    if (!vehicle) {
      el.detailsPanel.classList.add('hidden');
      return;
    }

    const owner = ownersMap[String(vehicle.owner_id)];
    const assignment = getCurrentAssignmentForVehicle(vehicle.id);
    const driver = assignment ? driversMap[String(assignment.driver_id)] : null;

    el.detailsKicker.textContent = 'Vehicle details';
    el.detailsTitle.textContent = safe(vehicle.plate_number) || 'Авто';
    el.detailsBody.innerHTML = `
      <div class="details-section">
        <h4>Основне</h4>
        <div class="details-list">
          <div class="details-item"><div class="details-label">Марка</div><div class="details-value">${escapeHtml(safe(vehicle.brand) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Модель</div><div class="details-value">${escapeHtml(safe(vehicle.model) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Рік</div><div class="details-value">${escapeHtml(safe(vehicle.year) || '-')}</div></div>
          <div class="details-item"><div class="details-label">VIN</div><div class="details-value">${escapeHtml(safe(vehicle.vin) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Статус</div><div class="details-value">${escapeHtml(safe(vehicle.status) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Пальне</div><div class="details-value">${escapeHtml(safe(vehicle.fuel_type) || '-')}</div></div>
        </div>
      </div>

      <div class="details-section">
        <h4>Документи</h4>
        <div class="details-list">
          <div class="details-item"><div class="details-label">Страховка</div><div class="details-value">${escapeHtml(safe(vehicle.insurance_expiry) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Огляд</div><div class="details-value">${escapeHtml(safe(vehicle.inspection_expiry) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Поліс</div><div class="details-value">${escapeHtml(safe(vehicle.policy_number) || '-')}</div></div>
        </div>
      </div>

      <div class="details-section">
        <h4>Зв’язки</h4>
        <div class="details-list">
          <div class="details-item"><div class="details-label">Власник</div><div class="details-value">${escapeHtml(ownerLabel(owner))}</div></div>
          <div class="details-item"><div class="details-label">Поточний водій</div><div class="details-value">${escapeHtml(fullName(driver))}</div></div>
        </div>
      </div>
    `;
    return;
  }

  if (state.selectedDetails.type === 'owner') {
    const owner = ownersMap[String(state.selectedDetails.id)];
    if (!owner) {
      el.detailsPanel.classList.add('hidden');
      return;
    }

    const vehicles = state.vehicles.filter(v => String(v.owner_id) === String(owner.id));

    el.detailsKicker.textContent = 'Owner details';
    el.detailsTitle.textContent = ownerLabel(owner);
    el.detailsBody.innerHTML = `
      <div class="details-section">
        <h4>Основне</h4>
        <div class="details-list">
          <div class="details-item"><div class="details-label">Тип</div><div class="details-value">${escapeHtml(safe(owner.owner_type) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Email</div><div class="details-value">${escapeHtml(safe(owner.email) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Телефон</div><div class="details-value">${escapeHtml(safe(owner.phone) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Рахунок</div><div class="details-value">${escapeHtml(safe(owner.bank_account) || '-')}</div></div>
          <div class="details-item"><div class="details-label">Умови</div><div class="details-value">${escapeHtml(safe(owner.settlement_terms) || '-')}</div></div>
        </div>
      </div>

      <div class="details-section">
        <h4>Авто власника</h4>
        <div class="details-list">
          ${
            vehicles.length
              ? vehicles.map(v => `
                <div class="details-item">
                  <div class="details-label">${escapeHtml(safe(v.plate_number) || '-')}</div>
                  <div class="details-value">${escapeHtml([safe(v.brand), safe(v.model), safe(v.year)].filter(Boolean).join(' ') || '-')}</div>
                </div>
              `).join('')
              : `<div class="empty">Немає авто</div>`
          }
        </div>
      </div>
    `;
    return;
  }

  if (state.selectedDetails.type === 'settlement') {
    const settlement = state.settlements.find(s => String(s.id) === String(state.selectedDetails.id));
    if (!settlement) {
      el.detailsPanel.classList.add('hidden');
      return;
    }

    const driver = driversMap[String(settlement.driver_id)];
    const vehicle = vehiclesMap[String(settlement.vehicle_id)];
    const period = periodsMap[String(settlement.period_id)];
    const doc = state.documents.find(
      d => String(d.entity_id) === String(settlement.id) && safe(d.document_type) === 'settlement_pdf'
    );

    el.detailsKicker.textContent = 'Settlement details';
    el.detailsTitle.textContent = settlementPeriodLabel(settlement, periodsMap);
    el.detailsBody.innerHTML = `
      <div class="details-section">
        <h4>Контекст</h4>
        <div class="details-list">
          <div class="details-item"><div class="details-label">Водій</div><div class="details-value">${escapeHtml(fullName(driver))}</div></div>
          <div class="details-item"><div class="details-label">Авто</div><div class="details-value">${escapeHtml(vehicleLabel(vehicle))}</div></div>
          <div class="details-item"><div class="details-label">Період</div><div class="details-value">${escapeHtml(periodLabel(period))}</div></div>
          <div class="details-item"><div class="details-label">Статус</div><div class="details-value">${escapeHtml(safe(settlement.status) || '-')}</div></div>
        </div>
      </div>

      <div class="details-section">
        <h4>Фінанси</h4>
        <div class="details-list">
          <div class="details-item"><div class="details-label">Gross</div><div class="details-value">${money(settlement.gross_platform_income)}</div></div>
          <div class="details-item"><div class="details-label">Net</div><div class="details-value">${money(settlement.platform_net_income)}</div></div>
          <div class="details-item"><div class="details-label">Bonus</div><div class="details-value">${money(settlement.bonuses)}</div></div>
          <div class="details-item"><div class="details-label">Cash</div><div class="details-value">${money(settlement.cash_collected)}</div></div>
          <div class="details-item"><div class="details-label">Комісія</div><div class="details-value">${money(settlement.company_commission)}</div></div>
          <div class="details-item"><div class="details-label">Fee</div><div class="details-value">${money(settlement.weekly_settlement_fee)}</div></div>
          <div class="details-item"><div class="details-label">Оренда</div><div class="details-value">${money(settlement.rent_total)}</div></div>
          <div class="details-item"><div class="details-label">Пальне</div><div class="details-value">${money(settlement.fuel_total)}</div></div>
          <div class="details-item"><div class="details-label">Payout</div><div class="details-value">${money(settlement.payout_to_driver)}</div></div>
        </div>
      </div>

      <div class="details-section">
        <h4>Документ</h4>
        <div class="details-list">
          <div class="details-item"><div class="details-label">Settlement PDF</div><div class="details-value">${doc ? 'є в documents' : 'немає'}</div></div>
          <div class="details-item"><div class="details-label">URL</div><div class="details-value">${escapeHtml(safe(doc?.file_url) || safe(settlement.pdf_url) || '-')}</div></div>
        </div>
      </div>
    `;
  }
}

function bindDetailRowClicks() {
  document.querySelectorAll('[data-detail-type][data-detail-id]').forEach(node => {
    node.addEventListener('click', () => {
      state.selectedDetails = {
        type: node.getAttribute('data-detail-type'),
        id: node.getAttribute('data-detail-id')
      };
      renderAll();
    });
  });
}

function bindEvents() {
  if (el.signInBtn) el.signInBtn.addEventListener('click', signIn);
  if (el.signUpBtn) el.signUpBtn.addEventListener('click', signUp);
  if (el.logoutBtn) el.logoutBtn.addEventListener('click', signOut);
  if (el.refreshBtn) el.refreshBtn.addEventListener('click', loadAllData);

  if (el.closeDetailsBtn) {
    el.closeDetailsBtn.addEventListener('click', () => {
      state.selectedDetails = null;
      renderAll();
    });
  }

  menuButtons().forEach(btn => {
    btn.addEventListener('click', () => setPage(btn.dataset.page));
  });

  if (el.password) {
    el.password.addEventListener('keydown', e => {
      if (e.key === 'Enter') signIn();
    });
  }
}

function subscribeAuth() {
  if (authSubscription) return;

  const sub = db.auth.onAuthStateChange(async (_event, session) => {
    state.session = session || null;

    if (!session) {
      renderAppShell(false);
      return;
    }

    await loadSessionAndData();
  });

  authSubscription = sub?.data?.subscription || null;
}

async function initApp() {
  collectElements();
  bindEvents();
  subscribeAuth();
  setPage('dashboard');
  renderAll();
  await loadSessionAndData();
}

window.addEventListener('error', event => {
  console.error('Global error:', event.error || event.message);
  showMsg(el.appMsg || el.msg, (event.error && event.error.message) || event.message || 'JS error');
});

window.addEventListener('unhandledrejection', event => {
  const msg = (event.reason && event.reason.message) || String(event.reason || 'Unhandled promise rejection');
  console.error('Unhandled rejection:', event.reason);
  showMsg(el.appMsg || el.msg, msg);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
  initApp();
}
