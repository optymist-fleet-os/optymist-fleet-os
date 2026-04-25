import { db } from '../supabase.js';
import { setSelectedDetails, state } from '../state.js';
import {
  badgeClass,
  escapeHtml,
  humanize,
  mapById,
  money,
  num,
  periodLabel,
  qs,
  safe,
} from '../utils.js';

const ISSUE_STATUSES = ['open', 'pending_review', 'resolved', 'ignored'];
const ISSUE_SEVERITIES = ['low', 'medium', 'high', 'critical'];

export function createReconciliationModule({ el, loadAllData, renderAll }) {
  function issueTitle(issue) {
    const metadata = issue.metadata || {};
    if (safe(metadata.company_name)) return safe(metadata.company_name);
    if (safe(metadata.imported_name)) return safe(metadata.imported_name);
    return humanize(issue.issue_type || 'reconciliation_issue');
  }

  function issueAmount(issue) {
    const metadata = issue.metadata || {};
    return num(metadata.company_payout_amount || metadata.amount || metadata.raw_amount);
  }

  function issueSource(issue) {
    const metadata = issue.metadata || {};
    return [
      safe(metadata.platform || metadata.provider),
      safe(metadata.file_name),
      safe(metadata.period_label)
    ].filter(Boolean).join(' | ') || '-';
  }

  function filteredIssues() {
    return state.reconciliationIssues.filter(issue => {
      if (safe(state.filters.reconciliationStatus) !== 'all' && safe(issue.status) !== safe(state.filters.reconciliationStatus)) {
        return false;
      }
      if (safe(state.filters.reconciliationSeverity) !== 'all' && safe(issue.severity) !== safe(state.filters.reconciliationSeverity)) {
        return false;
      }
      if (safe(state.filters.reconciliationType) !== 'all' && safe(issue.issue_type) !== safe(state.filters.reconciliationType)) {
        return false;
      }

      const search = safe(state.filters.reconciliationSearch).toLowerCase();
      if (!search) return true;

      const metadata = issue.metadata || {};
      const haystack = [
        safe(issue.issue_type),
        safe(issue.status),
        safe(issue.severity),
        safe(issue.resolution_note),
        safe(metadata.company_name),
        safe(metadata.imported_name),
        safe(metadata.external_id),
        safe(metadata.file_name),
        safe(metadata.platform),
        safe(metadata.period_label)
      ].join(' ').toLowerCase();

      return haystack.includes(search);
    });
  }

  async function updateIssueStatus(issueId, status, resolutionNote = '') {
    const payload = {
      status,
      resolution_note: resolutionNote || (status === 'resolved' ? 'Reviewed in back-office reconciliation queue.' : null),
      resolved_by: status === 'resolved' ? (state.session?.user?.id || null) : null,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null
    };

    const { error } = await db
      .from('reconciliation_issues')
      .update(payload)
      .eq('id', issueId);

    if (error) throw error;
    await loadAllData();
  }

  function bindEvents() {
    qs('reconciliationSearchInput')?.addEventListener('input', event => {
      state.filters.reconciliationSearch = event.target.value;
      renderReconciliationPage();
    });
    qs('reconciliationStatusFilter')?.addEventListener('change', event => {
      state.filters.reconciliationStatus = event.target.value;
      renderReconciliationPage();
    });
    qs('reconciliationSeverityFilter')?.addEventListener('change', event => {
      state.filters.reconciliationSeverity = event.target.value;
      renderReconciliationPage();
    });
    qs('reconciliationTypeFilter')?.addEventListener('change', event => {
      state.filters.reconciliationType = event.target.value;
      renderReconciliationPage();
    });

    document.querySelectorAll('[data-reconciliation-status][data-issue-id]').forEach(node => {
      node.addEventListener('click', async event => {
        event.stopPropagation();
        try {
          await updateIssueStatus(
            node.getAttribute('data-issue-id'),
            node.getAttribute('data-reconciliation-status')
          );
        } catch (error) {
          // Keep the page usable even if the new finance schema was not deployed yet.
          if (el.appMsg) {
            el.appMsg.innerHTML = `<div class="msg error">${escapeHtml(error.message || 'Failed to update reconciliation issue.')}</div>`;
          }
        }
      });
    });

    document.querySelectorAll('[data-detail-type="reconciliation"][data-detail-id]').forEach(node => {
      node.addEventListener('click', () => {
        setSelectedDetails('reconciliation', node.getAttribute('data-detail-id'));
        renderAll();
      });
    });
  }

  function renderReconciliationPage() {
    if (!el.reconciliationPage) return;

    const periodsMap = mapById(state.periods);
    const batchesMap = mapById(state.rawImportBatches);
    const transactionsMap = mapById(state.normalizedTransactions);
    const issues = filteredIssues();
    const openIssues = state.reconciliationIssues.filter(issue => ['open', 'pending_review'].includes(safe(issue.status))).length;
    const companyPayoutIssues = state.reconciliationIssues.filter(issue => safe(issue.issue_type) === 'company_platform_payout');
    const companyPayoutTotal = companyPayoutIssues.reduce((sum, issue) => sum + issueAmount(issue), 0);
    const issueTypes = [...new Set(state.reconciliationIssues.map(issue => safe(issue.issue_type)).filter(Boolean))].sort();

    el.reconciliationPage.innerHTML = `
      <div class="cards cards-compact">
        <div class="card"><div class="metric-label">Open issues</div><div class="metric-value">${openIssues}</div></div>
        <div class="card"><div class="metric-label">All issues</div><div class="metric-value">${state.reconciliationIssues.length}</div></div>
        <div class="card"><div class="metric-label">Import batches</div><div class="metric-value">${state.rawImportBatches.length}</div></div>
        <div class="card"><div class="metric-label">Company payout total</div><div class="metric-value">${money(companyPayoutTotal)}</div></div>
      </div>

      <div class="action-bar">
        <div class="filters filters-4">
          <input id="reconciliationSearchInput" placeholder="Search reconciliation queue" value="${escapeHtml(state.filters.reconciliationSearch)}" />
          <select id="reconciliationStatusFilter">
            <option value="all">All statuses</option>
            ${ISSUE_STATUSES.map(status => `
              <option value="${status}" ${status === safe(state.filters.reconciliationStatus) ? 'selected' : ''}>${humanize(status)}</option>
            `).join('')}
          </select>
          <select id="reconciliationSeverityFilter">
            <option value="all">All severities</option>
            ${ISSUE_SEVERITIES.map(severity => `
              <option value="${severity}" ${severity === safe(state.filters.reconciliationSeverity) ? 'selected' : ''}>${humanize(severity)}</option>
            `).join('')}
          </select>
          <select id="reconciliationTypeFilter">
            <option value="all">All issue types</option>
            ${issueTypes.map(type => `
              <option value="${type}" ${type === safe(state.filters.reconciliationType) ? 'selected' : ''}>${humanize(type)}</option>
            `).join('')}
          </select>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Reconciliation queue</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Issue</th>
                <th>Source</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${issues.length ? issues.map(issue => {
                const selected = state.selectedDetails?.type === 'reconciliation' && String(state.selectedDetails.id) === String(issue.id);
                const batch = batchesMap[String(issue.source_import_batch_id)];
                const transaction = transactionsMap[String(issue.related_transaction_id)];
                const period = periodsMap[String(batch?.period_id || transaction?.period_id)];
                const metadata = issue.metadata || {};

                return `
                  <tr class="table-row-clickable ${selected ? 'selected' : ''}" data-detail-type="reconciliation" data-detail-id="${escapeHtml(issue.id)}">
                    <td>
                      <strong>${escapeHtml(issueTitle(issue))}</strong>
                      <div class="details-subvalue">${escapeHtml(humanize(issue.issue_type))}</div>
                      <div class="details-subvalue">${escapeHtml(safe(metadata.external_id) || safe(metadata.company_row_key) || '-')}</div>
                    </td>
                    <td>
                      <div>${escapeHtml(issueSource(issue))}</div>
                      <div class="details-subvalue">${escapeHtml(periodLabel(period))}</div>
                    </td>
                    <td>
                      <strong>${money(issueAmount(issue))}</strong>
                      <div class="details-subvalue">${safe(metadata.raw_amount) ? `Raw sign: ${money(metadata.raw_amount)}` : '-'}</div>
                    </td>
                    <td>
                      <span class="badge ${badgeClass(issue.status)}">${escapeHtml(humanize(issue.status))}</span>
                      <div class="details-subvalue">${escapeHtml(humanize(issue.severity))}</div>
                    </td>
                    <td>
                      <div class="button-cluster">
                        ${safe(issue.status) === 'resolved'
                          ? `<button type="button" class="secondary" data-issue-id="${escapeHtml(issue.id)}" data-reconciliation-status="open">Reopen</button>`
                          : `<button type="button" class="secondary" data-issue-id="${escapeHtml(issue.id)}" data-reconciliation-status="resolved">Resolve</button>`
                        }
                      </div>
                    </td>
                  </tr>
                `;
              }).join('') : `
                <tr><td colspan="5"><div class="empty">No reconciliation issues yet.</div></td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;

    bindEvents();
  }

  return {
    issueAmount,
    issueSource,
    issueTitle,
    renderReconciliationPage,
    updateIssueStatus
  };
}
