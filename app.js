const SUPABASE_URL = 'https://tegravrxaqcuktwjanzm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FWerGr6XL94LiVQs2Lel-A_2M3sTKIu';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

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

const el = {
  authView: document.getElementById('authView'),
  appView: document.getElementById('appView'),
  msg: document.getElementById('msg'),
  appMsg: document.getElementById('appMsg'),
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  signInBtn: document.getElementById('signInBtn'),
  signUpBtn: document.getElementById('signUpBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  userEmail: document.getElementById('userEmail'),
  pageTitle: document.getElementById('pageTitle'),
  pageSubtitle: document.getElementById('pageSubtitle'),
  dashboardPage: document.getElementById('page-dashboard'),
  driversPage: document.getElementById('page-drivers'),
  vehiclesPage: document.getElementById('page-vehicles'),
  settlementsPage: document.getElementById('page-settlements'),
  menuButtons: () => Array.from(document.querySelectorAll('.menu-btn'))
};

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

function showMsg(target, text, type = 'error') {
  target.innerHTML = `<div class="msg ${type}">${text}</div>`;
}

function clearMsg(target) {
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
  list.forEach(item => { m[String(item.id)] = item; });
  return m;
}

function renderAppShell(loggedIn) {
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
    if (key === page) node.classList.remove('hidden');
    else node.classList.add('hidden');
  });

  el.menuButtons().forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

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

async function signUp() {
  clearMsg(el.msg);
  const email = safe(el.email.value);
  const password = safe(el.password.value);

  if (!email || !password) {
    showMsg(el.msg, 'Введи email і пароль');
    return;
  }

  const { error } = await db.auth.signUp({ email, password });

  if (error) {
    showMsg(el.msg, error.message);
    return;
  }

  showMsg(el.msg, 'Реєстрація пройшла успішно', 'success');
  await loadSessionAndData();
}

async function signIn() {
  clearMsg(el.msg);
  const email = safe(el.email.value);
  const password = safe(el.password.value);

  if (!email || !password) {
    showMsg(el.msg, 'Введи email і пароль');
    return;
  }

  const { error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    showMsg(el.msg, error.message);
    return;
  }

  showMsg(el.msg, 'Успішний вхід', 'success');
  await loadSessionAndData();
}

async function signOut() {
  await db.auth.signOut();
  state.session = null;
  renderAppShell(false);
  clearMsg(el.appMsg);
}

async function loadSessionAndData() {
  clearMsg(el.appMsg);

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
  el.userEmail.textContent = session.user.email || '';

  await loadAllData();
}

async function loadAllData() {
  clearMsg(el.appMsg);

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
                  <strong>${safe(r.week_code)}</strong> · ${fullName(driversMap[String(r.driver_id)])}<br>
                  <span class="muted">${vehicleLabel(vehiclesMap[String(r.vehicle_id)])}</span>
                </div>
                <div style="text-align:right">
                  <strong>${money(r.to_pay)}</strong><br>
                  <span class="badge ${num(r.to_pay) < 0 ? 'debt' : 'pay'}">${num(r.to_pay) < 0 ? 'debt' : 'pay'}</span>
                  <span class="badge ${badgeClass(r.status)}">${safe(r.status) || '-'}</span>
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
        <input id="driversSearch" placeholder="Пошук по імені, email, телефону..." value="${safe(state.filters.driverSearch)}" />
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
                    <td><strong>${fullName(d)}</strong></td>
                    <td>${safe(d.email) || '-'}</td>
                    <td>${safe(d.phone) || '-'}</td>
                    <td><span class="badge ${badgeClass(d.status)}">${safe(d.status) || '-'}</span></td>
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
  search.addEventListener('input', e => {
    state.filters.driverSearch = e.target.value;
    renderDriversPage();
  });
}

function renderVehiclesPage() {
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
        <input id="vehiclesSearch" placeholder="Пошук по номеру, марці, моделі..." value="${safe(state.filters.vehicleSearch)}" />
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
                    <td><strong>${safe(v.reg_number) || '-'}</strong></td>
                    <td>${[safe(v.make), safe(v.model)].filter(Boolean).join(' ') || '-'}</td>
                    <td>${safe(v.year) || '-'}</td>
                    <td>${ownerLabel(ownersMap[String(v.owner_id)])}</td>
                    <td><span class="badge ${badgeClass(v.status)}">${safe(v.status) || '-'}</span></td>
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
  search.addEventListener('input', e => {
    state.filters.vehicleSearch = e.target.value;
    renderVehiclesPage();
  });
}

function renderSettlementsPage() {
  const driversMap = mapById(state.drivers);
  const vehiclesMap = mapById(state.vehicles);

  const weeks = Array.from(new Set(state.settlements.map(r => safe(r.week_code)).filter(Boolean))).sort().reverse();

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
        <input id="settlementsSearch" placeholder="Пошук по водію, email, авто..." value="${safe(state.filters.settlementSearch)}" />

        <select id="settlementsWeek">
          <option value="all">Усі тижні</option>
          ${weeks.map(w => `
            <option value="${w}" ${w === state.filters.settlementWeek ? 'selected' : ''}>${w}</option>
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
                    <td><strong>${safe(r.week_code) || '-'}</strong></td>
                    <td>
                      <strong>${fullName(driversMap[String(r.driver_id)])}</strong><br>
                      <span class="muted">${safe(driversMap[String(r.driver_id)]?.email) || ''}</span>
                    </td>
                    <td>${vehicleLabel(vehiclesMap[String(r.vehicle_id)])}</td>
                    <td>${money(r.base_net)}</td>
                    <td>${money(r.bonus_total)}</td>
                    <td>${money(r.cash_collected)}</td>
                    <td>
                      <strong>${money(r.to_pay)}</strong><br>
                      <span class="badge ${num(r.to_pay) < 0 ? 'debt' : 'pay'}">${num(r.to_pay) < 0 ? 'debt' : 'pay'}</span>
                    </td>
                    <td><span class="badge ${badgeClass(r.status)}">${safe(r.status) || '-'}</span></td>
                  </tr>
                `).join('')
                : `<tr><td colspan="9" class="empty">Немає даних</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('settlementsSearch').addEventListener('input', e => {
    state.filters.settlementSearch = e.target.value;
    renderSettlementsPage();
  });

  document.getElementById('settlementsWeek').addEventListener('change', e => {
    state.filters.settlementWeek = e.target.value;
    renderSettlementsPage();
  });

  document.getElementById('settlementsStatus').addEventListener('change', e => {
    state.filters.settlementStatus = e.target.value;
    renderSettlementsPage();
  });
}

el.signInBtn.addEventListener('click', signIn);
el.signUpBtn.addEventListener('click', signUp);
el.logoutBtn.addEventListener('click', signOut);
el.refreshBtn.addEventListener('click', loadAllData);

document.querySelectorAll('.menu-btn').forEach(btn => {
  btn.addEventListener('click', () => setPage(btn.dataset.page));
});

db.auth.onAuthStateChange(async () => {
  await loadSessionAndData();
});

setPage('dashboard');
loadSessionAndData();
