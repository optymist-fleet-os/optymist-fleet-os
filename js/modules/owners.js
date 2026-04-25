import { db } from '../supabase.js';
import { closeAllForms, state } from '../state.js';
import {
  clearMsg,
  escapeHtml,
  humanize,
  money,
  nullIfBlank,
  ownerLabel,
  qs,
  safe,
  showMsg
} from '../utils.js';

export function createOwnersModule({
  documents,
  el,
  loadAllData,
  ownerSettlements,
  renderAll
}) {
  function openOwnerForm() {
    closeAllForms();
    state.forms.owner = true;
    renderAll();
  }

  async function createOwner(payload) {
    const { error } = await db.from('vehicle_owners').insert([payload]);
    if (error) throw error;
  }

  async function onCreateOwnerSubmit(event) {
    event.preventDefault();
    clearMsg(el.appMsg);

    const formData = new FormData(event.target);
    const ownerType = safe(formData.get('owner_type')) || 'company';
    const companyName = nullIfBlank(formData.get('company_name'));
    const fullName = nullIfBlank(formData.get('full_name'));

    if (ownerType === 'company' && !companyName) {
      showMsg(el.appMsg, 'Company name is required for company owner type.');
      return;
    }

    if (ownerType === 'person' && !fullName) {
      showMsg(el.appMsg, 'Full name is required for person owner type.');
      return;
    }

    try {
      await createOwner({
        owner_type: ownerType,
        company_name: companyName,
        full_name: fullName,
        email: nullIfBlank(formData.get('email')),
        phone: nullIfBlank(formData.get('phone')),
        bank_account: nullIfBlank(formData.get('bank_account')),
        settlement_terms: nullIfBlank(formData.get('settlement_terms')),
        notes: nullIfBlank(formData.get('notes'))
      });

      showMsg(el.appMsg, 'Owner created.', 'success');
      closeAllForms();
      await loadAllData();
    } catch (error) {
      showMsg(el.appMsg, error.message || 'Failed to create owner.');
    }
  }

  function renderOwnerFormCard() {
    return `
      <div class="form-card">
        <h3 class="form-title">New owner</h3>
        <form id="ownerForm">
          <div class="form-grid-wide">
            <div class="form-field">
              <label>Owner type</label>
              <select name="owner_type">
                <option value="company">Company</option>
                <option value="person">Person</option>
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
              <label>Phone</label>
              <input name="phone" />
            </div>

            <div class="form-field">
              <label>Bank account</label>
              <input name="bank_account" />
            </div>

            <div class="form-field form-field-span-2">
              <label>Settlement terms</label>
              <input name="settlement_terms" />
            </div>

            <div class="form-field form-field-span-2">
              <label>Notes</label>
              <textarea name="notes" rows="3"></textarea>
            </div>
          </div>

          <div class="form-actions">
            <button type="submit">Create owner</button>
            <button type="button" class="secondary" id="cancelOwnerFormBtn">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  function bindOwnerFormEvents() {
    const form = qs('ownerForm');
    if (!form) return;

    form.addEventListener('submit', onCreateOwnerSubmit);
    qs('cancelOwnerFormBtn')?.addEventListener('click', () => {
      state.forms.owner = false;
      renderAll();
    });
  }

  function renderOwnersPage() {
    if (!el.ownersPage) return;

    const ownerSettlementRows = ownerSettlements.buildOwnerSettlementRows().rows;

    const filteredOwners = state.owners
      .filter(owner => {
        const search = safe(state.filters.ownerSearch).toLowerCase();
        if (!search) return true;

        const haystack = [
          ownerLabel(owner),
          safe(owner.email),
          safe(owner.phone),
          safe(owner.bank_account),
          safe(owner.notes)
        ].join(' ').toLowerCase();

        return haystack.includes(search);
      })
      .sort((left, right) => ownerLabel(left).localeCompare(ownerLabel(right), 'uk'));

    el.ownersPage.innerHTML = `
      <div class="action-bar">
        <div class="filters">
          <input id="ownerSearchInput" placeholder="Search owners" value="${escapeHtml(state.filters.ownerSearch)}" />
        </div>

        <div class="button-cluster">
          <button type="button" id="newOwnerBtn">New owner</button>
          <button type="button" class="secondary" id="newOwnerDocumentBtn">Add document metadata</button>
        </div>
      </div>

      ${state.forms.owner ? renderOwnerFormCard() : ''}

      <div class="card">
        <h3 class="card-title">Owners</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Owner</th>
                <th>Vehicles</th>
                <th>Owner settlements</th>
                <th>Bank / documents</th>
              </tr>
            </thead>
            <tbody>
              ${filteredOwners.length ? filteredOwners.map(owner => {
                const vehicles = state.vehicles.filter(vehicle => String(vehicle.owner_id) === String(owner.id));
                const settlements = ownerSettlementRows.filter(row => String(row.owner_id) === String(owner.id));
                const totalPayout = settlements.reduce((sum, row) => sum + Number(row.payout_to_owner || 0), 0);
                const docStats = documents.getEntityDocumentStats('owner', owner.id);
                const selected = state.selectedDetails?.type === 'owner' && String(state.selectedDetails.id) === String(owner.id);

                return `
                  <tr
                    class="table-row-clickable ${selected ? 'selected' : ''}"
                    data-detail-type="owner"
                    data-detail-id="${escapeHtml(owner.id)}"
                  >
                    <td>
                      <strong>${escapeHtml(ownerLabel(owner))}</strong>
                      <div class="details-subvalue">${escapeHtml(humanize(owner.owner_type || 'company'))}</div>
                    </td>
                    <td>${vehicles.length}<div class="details-subvalue">${escapeHtml(vehicles.slice(0, 2).map(vehicle => vehicle.plate_number).join(', ') || 'No vehicles')}</div></td>
                    <td>${settlements.length} row(s)<div class="details-subvalue">${money(totalPayout)}</div></td>
                    <td>
                      <div>${escapeHtml(safe(owner.bank_account) || '-')}</div>
                      <div class="details-subvalue">${docStats.total} doc(s), ${docStats.googleDriveLinked} linked</div>
                    </td>
                  </tr>
                `;
              }).join('') : `
                <tr><td colspan="4"><div class="empty">No owners found.</div></td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;

    qs('newOwnerBtn')?.addEventListener('click', openOwnerForm);
    qs('newOwnerDocumentBtn')?.addEventListener('click', () => documents.openNewDocumentForm({ entity_type: 'owner' }));
    qs('ownerSearchInput')?.addEventListener('input', event => {
      state.filters.ownerSearch = event.target.value;
      renderOwnersPage();
    });

    document.querySelectorAll('[data-detail-type="owner"][data-detail-id]').forEach(node => {
      node.addEventListener('click', () => {
        state.selectedDetails = {
          type: 'owner',
          id: node.getAttribute('data-detail-id')
        };
        renderAll();
      });
    });

    bindOwnerFormEvents();
  }

  return {
    renderOwnersPage
  };
}
