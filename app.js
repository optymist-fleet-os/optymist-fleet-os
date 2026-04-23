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
  currentPage: 'dashboard',
  drivers: [],
  vehicles: [],
  settlements: [],
  owners: [],
  filters: {
    driverSearch: '',
    vehicleSearch: '',
    settlementSearch: '',
    settlementWeek: 'all',
    settlementStatus: 'all'
  }
};

const el = {};

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

function badgeClass(status) {
  const s = safe(status).toLowerCase();
  if (s === 'ready') return 'ready';
  if (s === 'closed') return 'closed';
  if (s === 'active') return 'active';
  if (s === 'driving') return 'driving';
  return '';
}

function fullName(driver) {
  if (!driver) return '';
  return (
    safe(driver.full_name) ||
    [safe(driver.first_name), safe(driver.last_name)].filter(Boolean).join(' ') ||
    safe(driver.email) ||
    `Driver #${driver.id}`
  );
}

function vehicleLabel(vehicle) {
  if (!vehicle) return '-';
  return (
    safe(vehicle.reg_number) ||
    [safe(vehicle.make), safe(vehicle.model), safe(vehicle.year)].filter(Boolean).join(' ') ||
    `Vehicle #${vehicle.id}`
  );
}

function ownerLabel(owner) {
  if (!owner) return '-';
  return (
    safe(owner.full_name) ||
    safe(owner.company_name) ||
    safe(owner.name) ||
    `Owner #${owner.id}`
  );
}

function mapById(list) {
  const m = {};
  (list || []).forEach(item => {
    m[String(item.id)] = item;
  });
  return m;
}

function qs(id) {
  return document.getElementById(id);
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
      el.pageSubtitle.textContent = 'Back office + settlements';
    }
    if (page === 'drivers') {
      el.pageTitle.textContent = 'Водії';
      el.pageSubtitle.textContent = 'Список водіїв та їх дані';
    }
    if (page === 'vehicles') {
      el.pageTitle.textContent = 'Авто';
      el.pageSubtitle.textContent = 'Список авто та статуси';
    }
    if (page === 'settlements') {
      el.pageTitle.textContent = 'Розрахунки';
      el.pageSubtitle.textContent = 'Тижневі розрахунки водіїв';
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
        'Акаунт створено. Якщо увімкнене підтвердження email — підтвердь пошту, потім увійди.',
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
  renderAppShell(false);
  clearMsg(el.appMsg);
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

    renderAppShell(true);

    if (el.userEmail) {
      el.userEmail.textContent = session.user?.email || '';
    }

    await loadAllData();
  } catch (e) {
    showMsg(el.appMsg, e.message || 'Помилка завантаження сесії');
  }
}

async function loadAllData() {
  clearMsg(el.appMsg);

  try {
    const [
      driversRes,
      vehiclesRes,
      settlementsRes,
      ownersRes
    ] = await Promise.all([
      db.from('drivers').select('*').order('id', { ascending: true }),
      db.from('vehicles').select('*').order('id', { ascending: true }),
      db.from('driver_settlements').select('*').order('id', { ascending: false }),
      db.from('owners').select('*').order('id', { ascending: true })
    ]);

    const err =
      driversRes.error ||
      vehiclesRes.error ||
      settlementsRes.error ||
      ownersRes.error;

    if (err) {
      showMsg(el.appMsg, err.message || 'Помилка завантаження');
      return;
    }

    state.drivers = driversRes.data || [];
    state.vehicles = vehiclesRes.data || [];
    state.settlements = settlementsRes.data || [];
    state.owners = ownersRes.data || [];

    renderAll();
  } catch (e) {
    showMsg(el.appMsg, e.message || 'Помилка завантаження даних');
  }
}

function renderAll() {
  renderDashboard();
  renderDriversPage();
  renderVehiclesPage();
  renderSettlementsPage();
}

function renderDashboard() {
  const settlements = state.settlements;
  const driversMap = mapById(state.drivers);
  const vehiclesMap = mapById(state.vehicles);

  const grossPay = settlements
    .filter(r => num(r.to_pay) > 0)
    .reduce((sum, r) => sum + num(r.to_pay), 0);

  const debtTotal = settlements
    .filter(r => num(r.to_pay) < 0)
    .reduce((sum, r) => sum + Math.abs(num(r.to_pay)), 0);

  const netTotal = settlements.reduce((sum, r) => sum + num(r.to_pay), 0);

  const readyCount = settlements.filter(r => safe(r.status).toLowerCase() === 'ready').length;
  const closedCount = settlements.filter(r => safe(r.status).toLowerCase() === 'closed').length;

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
        <div class="metric-label">Розрахунки</div>
        <div class="metric-value">${settlements.length}</div>
      </div>
      <div class="card">
        <div class="metric-label">До виплати водіям</div>
        <div class="metric-value">${money(grossPay)}</div>
      </div>
      <div class="card">
        <div class="metric-label">Борг водіїв</div>
        <div class="metric-value">${money(debtTotal)}</div>
      </div>
      <div class="card">
        <div class="metric-label">Чистий баланс</div>
        <div class="metric-value">${money(netTotal)}</div>
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
                  <strong>${escapeHtml(safe(r.week_code))}</strong> · ${escapeHtml(fullName(driversMap[String(r.driver_id)]))}<br>
                  <span class="muted">${escapeHtml(vehicleLabel(vehiclesMap[String(r.vehicle_id)]))}</span>
                </div>
                <div style="text-align:right">
                  <strong>${money(r.to_pay)}</strong><br>
                  <span class="badge ${num(r.to_pay) < 0 ? 'debt' : 'pay'}">${num(r.to_pay) < 0 ? 'debt' : 'pay'}</span>
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
          <div>READY</div>
          <div><strong>${readyCount}</strong></div>
        </div>
        <div class="row">
          <div>CLOSED</div>
          <div><strong>${closedCount}</strong></div>
        </div>
        <div class="row">
          <div>Активні водії</div>
          <div><strong>${state.drivers.filter(d => safe(d.status).toLowerCase() === 'active').length}</strong></div>
        </div>
        <div class="row">
          <div>Активні авто</div>
          <div><strong>${state.vehicles.filter(v => safe(v.status).toLowerCase() === 'driving').length}</strong></div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Швидка перевірка</h3>
        <div class="row">
          <div>Позитивні розрахунки</div>
          <div><strong>${settlements.filter(r => num(r.to_pay) > 0).length}</strong></div>
        </div>
        <div class="row">
          <div>Негативні розрахунки</div>
          <div><strong>${settlements.filter(r => num(r.to_pay) < 0).length}</strong></div>
        </div>
        <div class="row">
          <div>Унікальні тижні</div>
          <div><strong>${new Set(settlements.map(r => safe(r.week_code))).size}</strong></div>
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
      safe(d.status)
    ].join(' ').toLowerCase();

    return !q || blob.includes(q);
  });

  el.driversPage.innerHTML = `
    <div class="card">
      <div class="filters" style="grid-template-columns: 1fr;">
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
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows.map(d => `
                  <tr>
                    <td>${d.id}</td>
                    <td><strong>${escapeHtml(fullName(d))}</strong></td>
                    <td>${escapeHtml(safe(d.email) || '-')}</td>
                    <td>${escapeHtml(safe(d.phone) || '-')}</td>
                    <td><span class="badge ${badgeClass(d.status)}">${escapeHtml(safe(d.status) || '-')}</span></td>
                  </tr>
                `).join('')
                : `<tr><td colspan="5" class="empty">Немає даних</td></tr>`
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
      safe(v.make),
      safe(v.model),
      safe(v.year),
      safe(v.status)
    ].join(' ').toLowerCase();

    return !q || blob.includes(q);
  });

  el.vehiclesPage.innerHTML = `
    <div class="card">
      <div class="filters" style="grid-template-columns: 1fr;">
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
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows.map(v => `
                  <tr>
                    <td>${v.id}</td>
                    <td><strong>${escapeHtml(safe(v.reg_number) || '-')}</strong></td>
                    <td>${escapeHtml([safe(v.make), safe(v.model)].filter(Boolean).join(' ') || '-')}</td>
                    <td>${escapeHtml(safe(v.year) || '-')}</td>
                    <td>${escapeHtml(ownerLabel(ownersMap[String(v.owner_id)]))}</td>
                    <td><span class="badge ${badgeClass(v.status)}">${escapeHtml(safe(v.status) || '-')}</span></td>
                  </tr>
                `).join('')
                : `<tr><td colspan="6" class="empty">Немає даних</td></tr>`
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

  const weeks = Array.from(
    new Set(state.settlements.map(r => safe(r.week_code)).filter(Boolean))
  ).sort().reverse();

  const q = safe(state.filters.settlementSearch).toLowerCase();
  const week = state.filters.settlementWeek;
  const status = state.filters.settlementStatus;

  const rows = state.settlements.filter(r => {
    const driver = driversMap[String(r.driver_id)];
    const vehicle = vehiclesMap[String(r.vehicle_id)];

    const blob = [
      safe(r.week_code),
      fullName(driver),
      safe(driver?.email),
      vehicleLabel(vehicle),
      safe(r.status)
    ].join(' ').toLowerCase();

    const weekOk = week === 'all' || safe(r.week_code) === week;
    const statusOk = status === 'all' || safe(r.status).toLowerCase() === status.toLowerCase();
    const searchOk = !q || blob.includes(q);

    return weekOk && statusOk && searchOk;
  });

  el.settlementsPage.innerHTML = `
    <div class="card">
      <div class="filters">
        <input id="settlementsSearch" placeholder="Пошук по водію, email, авто..." value="${escapeHtml(safe(state.filters.settlementSearch))}" />

        <select id="settlementsWeek">
          <option value="all">Усі тижні</option>
          ${weeks.map(w => `
            <option value="${escapeHtml(w)}" ${w === state.filters.settlementWeek ? 'selected' : ''}>${escapeHtml(w)}</option>
          `).join('')}
        </select>

        <select id="settlementsStatus">
          <option value="all">Усі статуси</option>
          <option value="ready" ${state.filters.settlementStatus === 'ready' ? 'selected' : ''}>READY</option>
          <option value="closed" ${state.filters.settlementStatus === 'closed' ? 'selected' : ''}>CLOSED</option>
        </select>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Тиждень</th>
              <th>Водій</th>
              <th>Авто</th>
              <th>Base net</th>
              <th>Bonus</th>
              <th>Cash</th>
              <th>To pay</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows.map(r => `
                  <tr>
                    <td>${r.id}</td>
                    <td><strong>${escapeHtml(safe(r.week_code) || '-')}</strong></td>
                    <td>
                      <strong>${escapeHtml(fullName(driversMap[String(r.driver_id)]))}</strong><br>
                      <span class="muted">${escapeHtml(safe(driversMap[String(r.driver_id)]?.email) || '')}</span>
                    </td>
                    <td>${escapeHtml(vehicleLabel(vehiclesMap[String(r.vehicle_id)]))}</td>
                    <td>${money(r.base_net)}</td>
                    <td>${money(r.bonus_total)}</td>
                    <td>${money(r.cash_collected)}</td>
                    <td>
                      <strong>${money(r.to_pay)}</strong><br>
                      <span class="badge ${num(r.to_pay) < 0 ? 'debt' : 'pay'}">${num(r.to_pay) < 0 ? 'debt' : 'pay'}</span>
                    </td>
                    <td><span class="badge ${badgeClass(r.status)}">${escapeHtml(safe(r.status) || '-')}</span></td>
                  </tr>
                `).join('')
                : `<tr><td colspan="9" class="empty">Немає даних</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  const search = document.getElementById('settlementsSearch');
  const weekSelect = document.getElementById('settlementsWeek');
  const statusSelect = document.getElementById('settlementsStatus');

  if (search) {
    search.addEventListener('input', e => {
      state.filters.settlementSearch = e.target.value;
      renderSettlementsPage();
    });
  }

  if (weekSelect) {
    weekSelect.addEventListener('change', e => {
      state.filters.settlementWeek = e.target.value;
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
  db.auth.onAuthStateChange(async (_event, session) => {
    state.session = session || null;

    if (!session) {
      renderAppShell(false);
      return;
    }

    renderAppShell(true);

    if (el.userEmail) {
      el.userEmail.textContent = session.user?.email || '';
    }

    await loadAllData();
  });
}

async function initApp() {
  collectElements();
  bindEvents();
  subscribeAuth();
  setPage('dashboard');
  await loadSessionAndData();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
  initApp();
}
