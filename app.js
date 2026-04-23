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
  filters: {
    driverSearch: '',
    vehicleSearch: '',
    settlementSearch: '',
    settlementPeriod: 'all',
    settlementStatus: 'all'
  }
};

const el = {};
let authSubscription = null;
let isLoadingData = false;

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
  if (['active', 'ready', 'approved', 'calculated', 'paid', 'sent'].includes(s)) return 'active';
  if (['closed', 'archived', 'inactive'].includes(s)) return 'closed';
  if (['open', 'draft', 'pending'].includes(s)) return 'ready';
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
  el.settlementsPage = qs('page-settlements');
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
      showMsg(
        el.msg,
        'Акаунт створено. Якщо потрібне підтвердження email — підтвердь пошту і увійди.',
        'success'
      );
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
      el.userEmail.textContent =
        state.profile?.email ||
        session.user?.email ||
        '';
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
      settlementsRes
    ] = await Promise.all([
      db.from('drivers').select('*').order('created_at', { ascending: false }),
      db.from('vehicles').select('*').order('created_at', { ascending: false }),
      db.from('vehicle_owners').select('*').order('created_at', { ascending: false }),
      db.from('settlement_periods').select('*').order('date_from', { ascending: false }),
      db.from('driver_settlements').select('*').order('created_at', { ascending: false })
    ]);

    const err =
      driversRes.error ||
      vehiclesRes.error ||
      ownersRes.error ||
      periodsRes.error ||
      settlementsRes.error;

    if (err) {
      showMsg(el.appMsg, err.message || 'Помилка завантаження');
      return;
    }

    state.drivers = driversRes.data || [];
    state.vehicles = vehiclesRes.data || [];
    state.owners = ownersRes.data || [];
    state.periods = periodsRes.data || [];
    state.settlements = settlementsRes.data || [];

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
    renderSettlementsPage();
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
          <div><strong>${settlements.filter(r => safe(r.pdf_url)).length}</strong></div>
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
                  <tr>
                    <td>${escapeHtml(String(d.id).slice(0, 8))}</td>
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

  const search = document.getElementById('driversSearch');
  if (search) {
    search.addEventListener('input', e => {
      state.filters.driverSearch = e.target.value;
      renderDriversPage();
    });
  }
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
                  <tr>
                    <td>${escapeHtml(String(v.id).slice(0, 8))}</td>
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

  const search = document.getElementById('vehiclesSearch');
  if (search) {
    search.addEventListener('input', e => {
      state.filters.vehicleSearch = e.target.value;
      renderVehiclesPage();
    });
  }
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
                  <tr>
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

  const search = document.getElementById('settlementsSearch');
  const periodSelect = document.getElementById('settlementsPeriod');
  const statusSelect = document.getElementById('settlementsStatus');

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
}

function bindEvents() {
  if (el.signInBtn) el.signInBtn.addEventListener('click', signIn);
  if (el.signUpBtn) el.signUpBtn.addEventListener('click', signUp);
  if (el.logoutBtn) el.logoutBtn.addEventListener('click', signOut);
  if (el.refreshBtn) el.refreshBtn.addEventListener('click', loadAllData);

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
