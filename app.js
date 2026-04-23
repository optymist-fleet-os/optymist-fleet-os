const SUPABASE_URL = 'PASTE_YOUR_SUPABASE_URL_HERE';
const SUPABASE_KEY = 'PASTE_YOUR_PUBLISHABLE_OR_ANON_KEY_HERE';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const el = {
  msg: document.getElementById('msg'),
  authBox: document.getElementById('authBox'),
  appBox: document.getElementById('appBox'),
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  signInBtn: document.getElementById('signInBtn'),
  signUpBtn: document.getElementById('signUpBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  userEmail: document.getElementById('userEmail'),
  driversCount: document.getElementById('driversCount'),
  vehiclesCount: document.getElementById('vehiclesCount'),
  settlementsCount: document.getElementById('settlementsCount'),
  toPayTotal: document.getElementById('toPayTotal'),
  settlementsList: document.getElementById('settlementsList'),
  driversList: document.getElementById('driversList'),
  vehiclesList: document.getElementById('vehiclesList')
};

function showMsg(text, type = 'error') {
  el.msg.innerHTML = `<div class="msg ${type}">${text}</div>`;
}

function clearMsg() {
  el.msg.innerHTML = '';
}

function money(v) {
  const n = Number(v || 0);
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';
}

function fullName(driver) {
  if (!driver) return '';
  return [
    driver.full_name,
    [driver.first_name, driver.last_name].filter(Boolean).join(' ').trim(),
    driver.email
  ].find(Boolean) || '';
}

async function signUp() {
  clearMsg();
  const email = el.email.value.trim();
  const password = el.password.value.trim();

  if (!email || !password) {
    showMsg('Введи email і пароль');
    return;
  }

  const { error } = await db.auth.signUp({ email, password });

  if (error) {
    showMsg(error.message);
    return;
  }

  showMsg('Реєстрація пройшла успішно', 'success');
}

async function signIn() {
  clearMsg();
  const email = el.email.value.trim();
  const password = el.password.value.trim();

  const { error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    showMsg(error.message);
    return;
  }

  showMsg('Успішний вхід', 'success');
  await loadApp();
}

async function signOut() {
  await db.auth.signOut();
  renderLoggedOut();
}

function renderLoggedOut() {
  el.authBox.classList.remove('hidden');
  el.appBox.classList.add('hidden');
  el.logoutBtn.classList.add('hidden');
  el.userEmail.textContent = '';
}

function renderLoggedIn(email) {
  el.authBox.classList.add('hidden');
  el.appBox.classList.remove('hidden');
  el.logoutBtn.classList.remove('hidden');
  el.userEmail.textContent = email || '';
}

async function loadApp() {
  clearMsg();

  const { data: sessionData } = await db.auth.getSession();
  const session = sessionData?.session;

  if (!session) {
    renderLoggedOut();
    return;
  }

  renderLoggedIn(session.user.email);

  const [{ data: drivers, error: driversErr },
         { data: vehicles, error: vehiclesErr },
         { data: settlements, error: settlementsErr }] = await Promise.all([
    db.from('drivers').select('*').order('id', { ascending: true }),
    db.from('vehicles').select('*').order('id', { ascending: true }),
    db.from('driver_settlements').select('*').order('id', { ascending: false }).limit(20)
  ]);

  if (driversErr || vehiclesErr || settlementsErr) {
    showMsg(
      driversErr?.message ||
      vehiclesErr?.message ||
      settlementsErr?.message ||
      'Помилка завантаження'
    );
    return;
  }

  const driversMap = Object.fromEntries((drivers || []).map(r => [String(r.id), r]));
  const vehiclesMap = Object.fromEntries((vehicles || []).map(r => [String(r.id), r]));

  const totalToPay = (settlements || []).reduce((sum, r) => sum + Number(r.to_pay || 0), 0);

  el.driversCount.textContent = String((drivers || []).length);
  el.vehiclesCount.textContent = String((vehicles || []).length);
  el.settlementsCount.textContent = String((settlements || []).length);
  el.toPayTotal.textContent = money(totalToPay);

  el.driversList.innerHTML = (drivers || []).length
    ? drivers.slice(0, 15).map(d => `
        <div class="row">
          <div>
            <strong>${fullName(d)}</strong><br>
            <span class="muted">${d.email || ''}</span>
          </div>
          <div><span class="badge">${d.status || 'active'}</span></div>
        </div>
      `).join('')
    : '<div class="muted">Немає водіїв</div>';

  el.vehiclesList.innerHTML = (vehicles || []).length
    ? vehicles.slice(0, 15).map(v => `
        <div class="row">
          <div>
            <strong>${v.reg_number || '-'}</strong><br>
            <span class="muted">${[v.make, v.model, v.year].filter(Boolean).join(' ')}</span>
          </div>
          <div><span class="badge">${v.status || ''}</span></div>
        </div>
      `).join('')
    : '<div class="muted">Немає авто</div>';

  el.settlementsList.innerHTML = (settlements || []).length
    ? settlements.map(s => {
        const d = driversMap[String(s.driver_id)];
        const v = vehiclesMap[String(s.vehicle_id)];
        return `
          <div class="row">
            <div>
              <strong>${s.week_code || ''}</strong> · ${fullName(d)}<br>
              <span class="muted">${v ? (v.reg_number || '') : ''}</span>
            </div>
            <div style="text-align:right">
              <strong>${money(s.to_pay)}</strong><br>
              <span class="badge">${s.status || ''}</span>
            </div>
          </div>
        `;
      }).join('')
    : '<div class="muted">Немає розрахунків</div>';
}

el.signInBtn.addEventListener('click', signIn);
el.signUpBtn.addEventListener('click', signUp);
el.logoutBtn.addEventListener('click', signOut);

db.auth.onAuthStateChange(async () => {
  await loadApp();
});

loadApp();
