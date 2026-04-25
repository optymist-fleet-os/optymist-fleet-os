export function getInitialFormsState() {
  return {
    driver: false,
    vehicle: false,
    owner: false,
    period: false,
    assignment: false,
    settlement: false,
    document: false
  };
}

export function getInitialAssignmentDraft(overrides = {}) {
  return {
    driver_id: '',
    vehicle_id: '',
    assigned_from: '',
    assigned_to: '',
    driver_weekly_rent: '',
    notes: '',
    ...overrides
  };
}

export function getInitialSettlementDraft(overrides = {}) {
  return {
    settlement_id: '',
    period_id: '',
    driver_id: '',
    vehicle_id: '',
    gross_platform_income: '',
    platform_net_income: '',
    bonuses: '0',
    cash_collected: '0',
    commission_rate_snapshot: '',
    company_commission: '',
    weekly_settlement_fee: '',
    rent_total: '',
    fuel_total: '0',
    penalties_total: '0',
    adjustments_total: '0',
    carry_forward_balance: '',
    status: 'draft',
    calculation_notes: '',
    pdf_status: 'not_generated',
    pdf_url: '',
    drive_file_id: '',
    drive_folder_id: '',
    ...overrides
  };
}

export function getInitialSettlementImportState(overrides = {}) {
  return {
    period_id: '',
    source_files: [],
    source_reports: [],
    rows: [],
    unmatched_rows: [],
    company_rows: [],
    warnings: [],
    last_error: '',
    last_imported_at: '',
    drive_archive_status: 'idle',
    drive_archive_folder_id: '',
    drive_archive_folder_url: '',
    drive_archived_files: [],
    drive_archive_error: '',
    drive_archive_last_at: '',
    ...overrides
  };
}

export function getInitialGoogleDriveState(overrides = {}) {
  return {
    configured: false,
    connected: false,
    auth_mode: '',
    service_account_email: '',
    root_folder_id: '',
    root_folder_name: '',
    root_folder_url: '',
    missing: [],
    error: '',
    checked_at: '',
    ...overrides
  };
}

export function getInitialDocumentDraft(overrides = {}) {
  return {
    document_id: '',
    entity_type: '',
    entity_id: '',
    document_type: 'other',
    title: '',
    status: 'draft',
    storage_provider: 'google_drive',
    drive_file_id: '',
    drive_folder_id: '',
    file_url: '',
    folder_url: '',
    mime_type: '',
    notes: '',
    ...overrides
  };
}

export const pageMeta = {
  dashboard: {
    title: 'Dashboard',
    subtitle: 'Fleet finance, operations and document overview'
  },
  drivers: {
    title: 'Drivers',
    subtitle: 'Drivers, assignments and balances'
  },
  vehicles: {
    title: 'Vehicles',
    subtitle: 'Fleet, ownership and compliance view'
  },
  owners: {
    title: 'Owners',
    subtitle: 'Owner directory and payout visibility'
  },
  'owner-settlements': {
    title: 'Owner settlements',
    subtitle: 'Owner payouts grouped by period and vehicle'
  },
  settlements: {
    title: 'Driver settlements',
    subtitle: 'Weekly calculations, approvals and payout flow'
  },
  documents: {
    title: 'Documents center',
    subtitle: 'Metadata layer ready for future Google Drive storage'
  }
};

export const state = {
  session: null,
  profile: null,
  roles: [],
  currentPage: 'dashboard',
  drivers: [],
  vehicles: [],
  owners: [],
  periods: [],
  settlements: [],
  ownerVehicleSettlements: [],
  documents: [],
  assignments: [],
  appSettings: [],
  commissionRules: [],
  driverBalances: [],
  tasksAlerts: [],
  selectedDetails: null,
  filters: {
    driverSearch: '',
    driverStatus: 'all',
    driverAssignmentScope: 'all',
    vehicleSearch: '',
    vehicleStatus: 'all',
    vehicleAssignmentScope: 'all',
    ownerSearch: '',
    settlementSearch: '',
    settlementPeriod: 'all',
    settlementDriver: 'all',
    settlementStatus: 'all',
    ownerSettlementSearch: '',
    ownerSettlementPeriod: 'all',
    ownerSettlementOwner: 'all',
    ownerSettlementStatus: 'all',
    documentSearch: '',
    documentEntity: 'all',
    documentType: 'all',
    documentStatus: 'all'
  },
  forms: getInitialFormsState(),
  assignmentDraft: getInitialAssignmentDraft(),
  settlementDraft: getInitialSettlementDraft(),
  settlementImport: getInitialSettlementImportState(),
  documentDraft: getInitialDocumentDraft(),
  googleDrive: getInitialGoogleDriveState()
};

export const el = {};

export function resetForms() {
  state.forms = getInitialFormsState();
}

export function closeAllForms() {
  resetForms();
  state.assignmentDraft = getInitialAssignmentDraft();
  state.settlementDraft = getInitialSettlementDraft();
  state.documentDraft = getInitialDocumentDraft();
}

export function setSelectedDetails(type = '', id = '') {
  state.selectedDetails = type && id ? { type, id: String(id) } : null;
}
