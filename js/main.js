import { createAuthModule } from './auth.js';
import { refreshGoogleDriveStatus } from './google-drive.js';
import { db } from './supabase.js';
import { closeAllForms, el, pageMeta, setSelectedDetails, state } from './state.js';
import { clearMsg, qs, safe, showMsg } from './utils.js';
import { createAssignmentsModule } from './modules/assignments.js';
import { createDashboardModule } from './modules/dashboard.js';
import { createDetailsPanelModule } from './modules/details-panel.js';
import { createDocumentsModule } from './modules/documents.js';
import { createDriverSettlementsModule } from './modules/driver-settlements.js';
import { createDriversModule } from './modules/drivers.js';
import { createOwnerSettlementsModule } from './modules/owner-settlements.js';
import { createOwnersModule } from './modules/owners.js';
import { createVehiclesModule } from './modules/vehicles.js';

let isLoadingData = false;

const authModule = createAuthModule({ loadAllData });
const assignmentsModule = createAssignmentsModule({
  closeAllForms,
  el,
  loadAllData,
  renderAll,
  setPage
});
const documentsModule = createDocumentsModule({
  closeAllForms,
  el,
  loadAllData,
  renderAll,
  setPage
});
const driverSettlementsModule = createDriverSettlementsModule({
  assignments: assignmentsModule,
  closeAllForms,
  el,
  loadAllData,
  renderAll,
  setPage
});
const ownerSettlementsModule = createOwnerSettlementsModule({
  assignments: assignmentsModule,
  documents: documentsModule,
  el,
  renderAll
});
const driversModule = createDriversModule({
  assignments: assignmentsModule,
  documents: documentsModule,
  driverSettlements: driverSettlementsModule,
  el,
  loadAllData,
  renderAll
});
const vehiclesModule = createVehiclesModule({
  assignments: assignmentsModule,
  documents: documentsModule,
  el,
  loadAllData,
  renderAll
});
const ownersModule = createOwnersModule({
  documents: documentsModule,
  el,
  loadAllData,
  ownerSettlements: ownerSettlementsModule,
  renderAll
});
const dashboardModule = createDashboardModule({
  documents: documentsModule,
  driverSettlements: driverSettlementsModule,
  el,
  ownerSettlements: ownerSettlementsModule
});
const detailsPanelModule = createDetailsPanelModule({
  assignments: assignmentsModule,
  documents: documentsModule,
  driverSettlements: driverSettlementsModule,
  el,
  ownerSettlements: ownerSettlementsModule,
  renderAll
});

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
  el.ownerSettlementsPage = qs('page-owner-settlements');
  el.settlementsPage = qs('page-settlements');
  el.documentsPage = qs('page-documents');
  el.detailsPanel = qs('detailsPanel');
  el.detailsKicker = qs('detailsKicker');
  el.detailsTitle = qs('detailsTitle');
  el.detailsBody = qs('detailsBody');
  el.closeDetailsBtn = qs('closeDetailsBtn');
}

function menuButtons() {
  return Array.from(document.querySelectorAll('.menu-btn'));
}

function setPage(page) {
  const nextPage = pageMeta[page] ? page : 'dashboard';
  state.currentPage = nextPage;

  const pages = {
    dashboard: el.dashboardPage,
    drivers: el.driversPage,
    vehicles: el.vehiclesPage,
    owners: el.ownersPage,
    'owner-settlements': el.ownerSettlementsPage,
    settlements: el.settlementsPage,
    documents: el.documentsPage
  };

  Object.entries(pages).forEach(([key, node]) => {
    if (!node) return;
    node.classList.toggle('hidden', key !== nextPage);
  });

  menuButtons().forEach(button => {
    button.classList.toggle('active', button.dataset.page === nextPage);
  });

  const meta = pageMeta[nextPage];
  if (el.pageTitle) el.pageTitle.textContent = meta?.title || 'Dashboard';
  if (el.pageSubtitle) el.pageSubtitle.textContent = meta?.subtitle || '';
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
      ownerVehicleSettlementsRes,
      documentsRes,
      assignmentsRes,
      appSettingsRes,
      commissionRulesRes,
      driverBalancesRes,
      tasksAlertsRes
    ] = await Promise.all([
      db.from('drivers').select('*').order('created_at', { ascending: false }),
      db.from('vehicles').select('*').order('created_at', { ascending: false }),
      db.from('vehicle_owners').select('*').order('created_at', { ascending: false }),
      db.from('settlement_periods').select('*').order('date_from', { ascending: false }),
      db.from('driver_settlements').select('*').order('created_at', { ascending: false }),
      db.from('owner_vehicle_settlements').select('*'),
      db.from('documents').select('*').order('created_at', { ascending: false }),
      db.from('driver_vehicle_assignments').select('*').order('assigned_from', { ascending: false }),
      db.from('app_settings').select('*'),
      db.from('commission_rules').select('*'),
      db.from('v_driver_balances').select('*'),
      db.from('tasks_alerts').select('*')
    ]);

    const hardError =
      driversRes.error ||
      vehiclesRes.error ||
      ownersRes.error ||
      periodsRes.error ||
      settlementsRes.error ||
      documentsRes.error ||
      assignmentsRes.error;

    if (hardError) {
      showMsg(el.appMsg, hardError.message || 'Failed to load data.');
      return;
    }

    state.drivers = driversRes.data || [];
    state.vehicles = vehiclesRes.data || [];
    state.owners = ownersRes.data || [];
    state.periods = periodsRes.data || [];
    state.settlements = settlementsRes.data || [];
    state.ownerVehicleSettlements = ownerVehicleSettlementsRes.error ? [] : (ownerVehicleSettlementsRes.data || []);
    state.documents = documentsRes.data || [];
    state.assignments = assignmentsRes.data || [];
    state.appSettings = appSettingsRes.error ? [] : (appSettingsRes.data || []);
    state.commissionRules = commissionRulesRes.error ? [] : (commissionRulesRes.data || []);
    state.driverBalances = driverBalancesRes.error ? [] : (driverBalancesRes.data || []);
    state.tasksAlerts = tasksAlertsRes.error ? [] : (tasksAlertsRes.data || []);
    await refreshGoogleDriveStatus();

    renderAll();
  } catch (error) {
    console.error(error);
    showMsg(el.appMsg, error.message || 'Failed to load data.');
  } finally {
    isLoadingData = false;
  }
}

function renderAll() {
  try {
    dashboardModule.renderDashboard();
    driversModule.renderDriversPage();
    vehiclesModule.renderVehiclesPage();
    ownersModule.renderOwnersPage();
    ownerSettlementsModule.renderOwnerSettlementsPage();
    driverSettlementsModule.renderSettlementsPage();
    documentsModule.renderDocumentsPage();
    detailsPanelModule.renderDetailsPanel();
    setPage(state.currentPage);
  } catch (error) {
    console.error('renderAll error:', error);
    showMsg(el.appMsg, error.message || 'Page render failed.');
  }
}

function bindGlobalEvents() {
  el.signInBtn?.addEventListener('click', authModule.signIn);
  el.signUpBtn?.addEventListener('click', authModule.signUp);
  el.logoutBtn?.addEventListener('click', authModule.signOut);
  el.refreshBtn?.addEventListener('click', loadAllData);
  el.closeDetailsBtn?.addEventListener('click', () => {
    setSelectedDetails();
    renderAll();
  });

  menuButtons().forEach(button => {
    button.addEventListener('click', () => setPage(button.dataset.page));
  });

  el.password?.addEventListener('keydown', event => {
    if (event.key === 'Enter') authModule.signIn();
  });

  db.auth.onAuthStateChange((_event, session) => {
    authModule.applySession(session).catch(error => {
      console.error(error);
      showMsg(el.appMsg || el.msg, error.message || 'Auth state update failed.');
    });
  });
}

async function initApp() {
  collectElements();
  bindGlobalEvents();
  setPage('dashboard');
  renderAll();
  await authModule.loadSessionAndData();
}

window.addEventListener('error', event => {
  console.error('Global error:', event.error || event.message);
  showMsg(el.appMsg || el.msg, (event.error && event.error.message) || event.message || 'JavaScript error');
});

window.addEventListener('unhandledrejection', event => {
  const message = (event.reason && event.reason.message) || String(event.reason || 'Unhandled promise rejection');
  console.error('Unhandled rejection:', event.reason);
  showMsg(el.appMsg || el.msg, message);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
  initApp();
}
