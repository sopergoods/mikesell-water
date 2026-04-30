import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue, set, remove, push, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ── STATE ────────────────────────────────────────────────────
let db = null;
let connections = {};
let editId = null;
let readingId = null;
let currentReceiptData = null;
let monthlyFilterMonth = '';

// ── FIREBASE ─────────────────────────────────────────────────
function getStoredUrl() { return localStorage.getItem('mikesell_firebase_url') || ''; }

window.saveFirebaseUrl = function () {
  const url = document.getElementById('firebase-url-input').value.trim();
  if (!url.startsWith('https://')) { showToast('Please enter a valid Firebase URL'); return; }
  localStorage.setItem('mikesell_firebase_url', url);
  initFirebase(url);
};

function initFirebase(url) {
  try {
    const app = initializeApp({ databaseURL: url }, 'mikesell-' + Date.now());
    db = getDatabase(app);
    setSyncStatus('syncing', 'Connecting...');
    document.getElementById('setup-banner').style.display = 'none';
    onValue(ref(db, 'connections'), (snap) => {
      connections = snap.val() || {};
      setSyncStatus('live', 'Live sync');
      renderAll();
    }, (err) => {
      setSyncStatus('error', 'Error');
      showToast('Firebase error: ' + err.message);
    });
  } catch (e) {
    showToast('Connection failed: ' + e.message);
    setSyncStatus('error', 'Failed');
  }
}

function setSyncStatus(state, label) {
  document.getElementById('sync-dot').className = 'sync-dot ' + state;
  document.getElementById('sync-label').textContent = label;
}

// ── HELPERS ──────────────────────────────────────────────────
function today() { return new Date().toISOString().split('T')[0]; }

function fmt(n) {
  return '₱' + parseFloat(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function consumption(c) { return Math.max(0, (c.present || 0) - (c.prev || 0)); }

function lockedAmount(c) {
  return c.billedAmount !== undefined ? c.billedAmount : consumption(c) * (c.rate || 25);
}

// ── STATUS LOGIC (PAYMENT-AWARE) ─────────────────────────────
function computeStatus(billedAmount, paidAmount) {
  const billed = parseFloat(billedAmount) || 0;
  const paid = parseFloat(paidAmount) || 0;
  if (paid <= 0) return 'due';
  if (paid >= billed) return 'paid';
  return 'partial';
}

function getRecordStatus(record) {
  const billed = record.billedAmount || lockedAmount(record);
  const paid = record.paidAmount || 0;
  return computeStatus(billed, paid);
}

function badge(status) {
  const s = status || 'due';
  const labels = { due: 'Due', partial: 'Partial', paid: 'Paid', overdue: 'Overdue' };
  return `<span class="badge badge-${s}">${labels[s] || s}</span>`;
}

window.showToast = function (msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
};

// ── PERIOD SORT KEY ───────────────────────────────────────────
function periodKey(periodStr) {
  if (!periodStr) return '0000-00';
  const d = new Date(periodStr + ' 1');
  if (isNaN(d)) return periodStr;
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ── BUILD ALL MONTHLY RECORDS ─────────────────────────────────
// Returns a flat list of billing records from all connections (current + history)
// Each record has: connectionId, name, month, prev, present, used, rate,
//   billedAmount, paidAmount, remaining, status, due, isCurrent, historyIndex
function buildAllMonthlyRecords() {
  const records = [];
  Object.entries(connections).forEach(([id, c]) => {
    const billed = lockedAmount(c);
    const paid = c.paidAmount || 0;
    const status = computeStatus(billed, paid);

    records.push({
      month: c.billingPeriod || 'Unknown',
      sortKey: periodKey(c.billingPeriod),
      connectionId: id,
      name: c.name,
      prev: c.prev || 0,
      present: c.present || 0,
      used: consumption(c),
      rate: c.rate || 25,
      billedAmount: billed,
      paidAmount: paid,
      remaining: Math.max(0, billed - paid),
      status,
      due: c.due,
      isCurrent: true,
      historyIndex: null
    });

    (c.history || []).forEach((h, idx) => {
      const hBilled = h.billedAmount || 0;
      const hPaid = h.paidAmount || 0;
      const hStatus = computeStatus(hBilled, hPaid);
      records.push({
        month: h.period || 'Unknown',
        sortKey: periodKey(h.period),
        connectionId: id,
        name: c.name,
        prev: h.prev,
        present: h.present,
        used: h.used,
        rate: h.rate,
        billedAmount: hBilled,
        paidAmount: hPaid,
        remaining: Math.max(0, hBilled - hPaid),
        status: hStatus,
        due: h.due,
        isCurrent: false,
        historyIndex: idx
      });
    });
  });
  return records;
}

function getAllMonths() {
  const records = buildAllMonthlyRecords();
  const months = [...new Set(records.map(r => r.month))];
  return months.sort((a, b) => periodKey(b).localeCompare(periodKey(a)));
}

// ── RENDER ALL ────────────────────────────────────────────────
function renderAll() {
  renderDashboard();
  renderConnections();
  renderBillingGrid();
  renderDueGrid();
  renderMonthly();
}

// ── DASHBOARD ─────────────────────────────────────────────────
function renderDashboard() {
  const list = Object.values(connections);
  const total = list.length;

  // Count by computed payment status
  const dueCount = list.filter(c => computeStatus(lockedAmount(c), c.paidAmount || 0) !== 'paid').length;
  const totalOutstanding = list.reduce((s, c) => {
    const remaining = Math.max(0, lockedAmount(c) - (c.paidAmount || 0));
    return s + remaining;
  }, 0);
  const avg = total ? list.reduce((s, c) => s + consumption(c), 0) / total : 0;

  document.getElementById('s-total').textContent = total;
  document.getElementById('s-due').textContent = dueCount;
  document.getElementById('s-revenue').textContent = fmt(totalOutstanding);
  document.getElementById('s-avg').textContent = avg.toFixed(1);

  const recent = Object.entries(connections)
    .sort(([, a], [, b]) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 5);

  const wrap = document.getElementById('dashboard-table-wrap');
  if (recent.length === 0) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">💧</div><div class="empty-title">No connections yet</div><div class="empty-sub">Add your first water meter connection</div></div>`;
    return;
  }
  wrap.innerHTML = buildConnectionsTable(recent, true);
}

// ── CONNECTIONS ───────────────────────────────────────────────
window.renderConnections = function () {
  const q = (document.getElementById('search-input')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('status-filter')?.value || '';
  const filtered = Object.entries(connections)
    .filter(([, c]) => c.name && c.name.toLowerCase().includes(q))
    .filter(([, c]) => {
      if (!statusFilter) return true;
      const status = computeStatus(lockedAmount(c), c.paidAmount || 0);
      return status === statusFilter;
    })
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));

  const wrap = document.getElementById('connections-wrap');
  if (filtered.length === 0) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">No results</div><div class="empty-sub">Try a different search or filter</div></div>`;
    return;
  }
  wrap.innerHTML = buildConnectionsTable(filtered, false);
};

function buildConnectionsTable(entries, compact) {
  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>Meter Name</th><th>Prev (m³)</th><th>Present (m³)</th><th>Used (m³)</th>
      <th>Rate (₱/m³)</th><th>Billed Amount</th><th>Due Date</th><th>Status</th>
      ${compact ? '' : '<th>Actions</th>'}
    </tr></thead>
    <tbody>
    ${entries.map(([id, c]) => {
      const billed = lockedAmount(c);
      const paid = c.paidAmount || 0;
      const status = computeStatus(billed, paid);
      return `<tr>
        <td class="meter-name">${c.name}</td>
        <td class="mono">${c.prev || 0}</td>
        <td class="mono">${c.present || 0}</td>
        <td class="mono">${consumption(c)}</td>
        <td class="mono">₱${c.rate || 25}</td>
        <td class="mono amount-locked">${fmt(billed)}</td>
        <td>${fmtDate(c.due)}</td>
        <td>${badge(status)}</td>
        ${compact ? '' : `<td><div class="td-actions">
          <button class="btn btn-outline btn-sm" onclick="openReadingModal('${id}')">↻ Reading</button>
          <button class="btn btn-ghost btn-sm" onclick="openEditModal('${id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="showReceiptForCurrent('${id}')">Receipt</button>
          <button class="btn btn-danger btn-sm" onclick="deleteConn('${id}')">Delete</button>
        </div></td>`}
      </tr>`;
    }).join('')}
    </tbody></table></div>`;
}

// ── BILLING GRID ──────────────────────────────────────────────
function renderBillingGrid() {
  const grid = document.getElementById('billing-grid');
  const list = Object.entries(connections).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🧾</div><div class="empty-title">No connections</div></div>`;
    return;
  }
  grid.innerHTML = list.map(([id, c]) => {
    const billed = lockedAmount(c);
    const paid = c.paidAmount || 0;
    const remaining = Math.max(0, billed - paid);
    const status = computeStatus(billed, paid);
    return `
    <div class="billing-card">
      <div class="billing-card-top">
        <div class="billing-card-name">${c.name}</div>
        <div class="billing-card-period">Billing: ${c.billingPeriod || '—'}</div>
      </div>
      <div class="billing-card-body">
        <div class="billing-card-amount">${fmt(billed)}</div>
        <div class="billing-card-meta">${consumption(c)} m³ · ₱${c.rate || 25}/m³</div>
        <div class="billing-card-meta">Due: ${fmtDate(c.due)}</div>
        ${paid > 0 ? `<div class="billing-card-meta paid-note">✅ Paid: ${fmt(paid)} · Remaining: ${fmt(remaining)}</div>` : ''}
      </div>
      <div class="billing-card-footer">
        ${badge(status)}
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="showReceiptForCurrent('${id}')">View</button>
          <button class="btn btn-primary btn-sm" onclick="printSingle('${id}')">Print</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── DUE GRID ─────────────────────────────────────────────────
function renderDueGrid() {
  const grid = document.getElementById('due-grid');
  const list = Object.entries(connections)
    .filter(([, c]) => computeStatus(lockedAmount(c), c.paidAmount || 0) !== 'paid')
    .sort(([, a], [, b]) => lockedAmount(b) - lockedAmount(a));
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">✅</div><div class="empty-title">All caught up!</div><div class="empty-sub">No outstanding balances</div></div>`;
    return;
  }
  grid.innerHTML = list.map(([id, c]) => {
    const billed = lockedAmount(c);
    const paid = c.paidAmount || 0;
    const remaining = Math.max(0, billed - paid);
    const status = computeStatus(billed, paid);
    return `
    <div class="due-card">
      <div class="due-card-name">${c.name}</div>
      <div class="due-card-amount">${fmt(remaining)}</div>
      <div class="due-card-detail">${consumption(c)} m³ · ₱${c.rate || 25}/m³</div>
      ${paid > 0 ? `<div class="due-card-detail" style="color:var(--green-600);margin-top:2px">Paid: ${fmt(paid)} of ${fmt(billed)}</div>` : ''}
      <div class="due-card-footer">
        ${badge(status)}
        <span style="font-size:12px;color:var(--slate-400)">Due ${fmtDate(c.due)}</span>
      </div>
    </div>`;
  }).join('');
}

// ── MONTHLY RECORDS TAB (SINGLE TABLE, UNIFIED) ───────────────
window.renderMonthly = function () {
  const wrap = document.getElementById('monthly-wrap');
  const allRecords = buildAllMonthlyRecords();

  if (allRecords.length === 0) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">📅</div><div class="empty-title">No records yet</div><div class="empty-sub">Monthly records appear after you add connections and do readings</div></div>`;
    return;
  }

  const months = getAllMonths();
  if (!monthlyFilterMonth || !months.includes(monthlyFilterMonth)) {
    monthlyFilterMonth = months[0];
  }

  // Populate selector
  const selector = document.getElementById('month-selector');
  selector.innerHTML = months.map(m =>
    `<option value="${m}" ${m === monthlyFilterMonth ? 'selected' : ''}>${m}</option>`
  ).join('');

  const selected = monthlyFilterMonth;
  const monthRecords = allRecords
    .filter(r => r.month === selected)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Stats for this month
  const totalBilled  = monthRecords.reduce((s, r) => s + r.billedAmount, 0);
  const totalPaid    = monthRecords.reduce((s, r) => s + r.paidAmount, 0);
  const totalOwed    = monthRecords.reduce((s, r) => s + r.remaining, 0);
  const paidCount    = monthRecords.filter(r => r.status === 'paid').length;
  const partialCount = monthRecords.filter(r => r.status === 'partial').length;
  const dueCount     = monthRecords.filter(r => r.status === 'due').length;

  // Connections not yet billed this month
  const billedIds = new Set(monthRecords.map(r => r.connectionId));
  const notBilled = Object.entries(connections)
    .filter(([id]) => !billedIds.has(id))
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));

  wrap.innerHTML = `
    <div class="monthly-stats">
      <div class="mstat mstat-blue">
        <div class="mstat-label">Total Billed</div>
        <div class="mstat-value">${fmt(totalBilled)}</div>
        <div class="mstat-sub">${monthRecords.length} connection${monthRecords.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="mstat mstat-green">
        <div class="mstat-label">Total Collected</div>
        <div class="mstat-value">${fmt(totalPaid)}</div>
        <div class="mstat-sub">${paidCount} fully paid · ${partialCount} partial</div>
      </div>
      <div class="mstat mstat-amber">
        <div class="mstat-label">Still Owed</div>
        <div class="mstat-value">${fmt(totalOwed)}</div>
        <div class="mstat-sub">${dueCount} due · ${partialCount} partial</div>
      </div>
      <div class="mstat mstat-slate">
        <div class="mstat-label">All Connections</div>
        <div class="mstat-value">${Object.keys(connections).length}</div>
        <div class="mstat-sub">${notBilled.length} not yet billed</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">Bills for ${selected}</span>
        <span style="font-size:12px;color:var(--slate-500)">${monthRecords.length} record${monthRecords.length !== 1 ? 's' : ''}</span>
      </div>
      ${monthRecords.length === 0
        ? `<div class="monthly-empty">No billing records for ${selected}</div>`
        : buildUnifiedMonthlyTable(monthRecords)}
    </div>

    ${notBilled.length > 0 ? `
    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <span class="card-title">Not Yet Billed in ${selected}</span>
        <span style="font-size:12px;color:var(--slate-500)">${notBilled.length} connection${notBilled.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Meter Name</th><th>Current Reading (m³)</th><th>Current Status</th><th>Action</th>
        </tr></thead>
        <tbody>
        ${notBilled.map(([id, c]) => `<tr>
          <td class="meter-name">${c.name}</td>
          <td class="mono">${c.present || 0} m³</td>
          <td>${badge(computeStatus(lockedAmount(c), c.paidAmount || 0))}</td>
          <td><button class="btn btn-outline btn-sm" onclick="openReadingModal('${id}')">↻ New Reading</button></td>
        </tr>`).join('')}
        </tbody>
      </table></div>
    </div>` : ''}
  `;
};

// ── UNIFIED MONTHLY TABLE (Single Table, All Statuses) ───────
function buildUnifiedMonthlyTable(records) {
  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>Meter Name</th>
      <th>Billing Month</th>
      <th>Prev (m³)</th>
      <th>Present (m³)</th>
      <th>Consumption</th>
      <th>Rate</th>
      <th>Total Amount</th>
      <th>Paid Amount</th>
      <th>Remaining</th>
      <th>Status</th>
      <th>Actions</th>
    </tr></thead>
    <tbody>
    ${records.map(r => `<tr class="row-status-${r.status}">
      <td class="meter-name">${r.name}</td>
      <td style="white-space:nowrap;font-size:12px;color:var(--slate-600)">${r.month}</td>
      <td class="mono">${r.prev}</td>
      <td class="mono">${r.present}</td>
      <td class="mono"><strong>${r.used} m³</strong></td>
      <td class="mono">₱${r.rate}/m³</td>
      <td class="mono amount-locked">${fmt(r.billedAmount)}</td>
      <td class="mono" style="color:var(--green-600);font-weight:600">${r.paidAmount > 0 ? fmt(r.paidAmount) : '—'}</td>
      <td class="mono ${r.remaining > 0 ? 'remaining-balance' : 'paid-full'}">${r.remaining > 0 ? fmt(r.remaining) : '✓ Paid'}</td>
      <td>${badge(r.status)}</td>
      <td>
        <div class="td-actions">
          <button class="btn btn-ghost btn-sm" onclick="showReceiptForRecord('${r.connectionId}', ${r.isCurrent ? 'null' : r.historyIndex})">
            🧾 Receipt
          </button>
          ${r.status !== 'paid' ? `<button class="btn btn-pay btn-sm" onclick="openPayModal('${r.connectionId}', ${r.isCurrent ? 'null' : r.historyIndex}, '${r.month}', ${r.billedAmount}, ${r.paidAmount})">
            💸 Pay
          </button>` : ''}
        </div>
      </td>
    </tr>`).join('')}
    </tbody></table></div>`;
}

window.setMonthFilter = function (val) {
  monthlyFilterMonth = val;
  renderMonthly();
};

// ── PAY MODAL ─────────────────────────────────────────────────
window.openPayModal = function (connectionId, historyIndex, month, billedAmount, paidAmount) {
  const remaining = Math.max(0, billedAmount - paidAmount);
  const c = connections[connectionId];

  document.getElementById('pay-meter-name').textContent = c.name;
  document.getElementById('pay-month').textContent = month;
  document.getElementById('pay-total').textContent = fmt(billedAmount);
  document.getElementById('pay-already-paid').textContent = paidAmount > 0 ? fmt(paidAmount) : '₱0.00';
  document.getElementById('pay-remaining').textContent = fmt(remaining);
  document.getElementById('pay-amount-input').value = '';
  document.getElementById('pay-amount-input').max = remaining;
  document.getElementById('pay-amount-input').placeholder = `Max: ${fmt(remaining)}`;

  // Store context for save
  document.getElementById('modal-pay').dataset.connectionId = connectionId;
  document.getElementById('modal-pay').dataset.historyIndex = historyIndex;
  document.getElementById('modal-pay').dataset.billedAmount = billedAmount;
  document.getElementById('modal-pay').dataset.paidAmount = paidAmount;

  document.getElementById('modal-pay').classList.add('open');
  setTimeout(() => document.getElementById('pay-amount-input').focus(), 100);
};

window.savePayment = async function () {
  if (!db) { showToast('Not connected to Firebase'); return; }

  const modal = document.getElementById('modal-pay');
  const connectionId = modal.dataset.connectionId;
  const historyIndex = modal.dataset.historyIndex === 'null' ? null : parseInt(modal.dataset.historyIndex);
  const billedAmount = parseFloat(modal.dataset.billedAmount);
  const previousPaid = parseFloat(modal.dataset.paidAmount) || 0;

  const payInput = parseFloat(document.getElementById('pay-amount-input').value);
  if (!payInput || payInput <= 0) { showToast('Enter a valid payment amount'); return; }

  const remaining = billedAmount - previousPaid;
  const actualPay = Math.min(payInput, remaining);
  const newPaidAmount = previousPaid + actualPay;
  const newStatus = computeStatus(billedAmount, newPaidAmount);

  const btn = document.getElementById('pay-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const c = connections[connectionId];

    if (historyIndex === null) {
      // Update current bill
      await update(ref(db, 'connections/' + connectionId), {
        paidAmount: newPaidAmount,
        status: newStatus,
        updatedAt: new Date().toISOString()
      });
    } else {
      // Update history bill
      const history = [...(c.history || [])];
      history[historyIndex] = {
        ...history[historyIndex],
        paidAmount: newPaidAmount,
        status: newStatus
      };
      await update(ref(db, 'connections/' + connectionId), {
        history,
        updatedAt: new Date().toISOString()
      });
    }

    closeModal('modal-pay');
    showToast(`Payment of ${fmt(actualPay)} recorded! Status: ${newStatus} ✅`);
  } catch (e) {
    showToast('Error saving payment: ' + e.message);
  }

  btn.disabled = false;
  btn.textContent = 'Confirm Payment';
};

// ── RECEIPT SYSTEM ────────────────────────────────────────────
// Show receipt for current active bill of a connection
window.showReceiptForCurrent = function (id) {
  const c = connections[id];
  const billed = lockedAmount(c);
  const paid = c.paidAmount || 0;
  const data = {
    name: c.name,
    month: c.billingPeriod || '—',
    prev: c.prev || 0,
    present: c.present || 0,
    used: consumption(c),
    rate: c.rate || 25,
    billedAmount: billed,
    paidAmount: paid,
    remaining: Math.max(0, billed - paid),
    status: computeStatus(billed, paid),
    due: c.due
  };
  showReceiptModal(data);
};

// Show receipt for any specific record (current or history)
window.showReceiptForRecord = function (connectionId, historyIndex) {
  const c = connections[connectionId];
  let data;

  if (historyIndex === null || historyIndex === 'null') {
    const billed = lockedAmount(c);
    const paid = c.paidAmount || 0;
    data = {
      name: c.name,
      month: c.billingPeriod || '—',
      prev: c.prev || 0,
      present: c.present || 0,
      used: consumption(c),
      rate: c.rate || 25,
      billedAmount: billed,
      paidAmount: paid,
      remaining: Math.max(0, billed - paid),
      status: computeStatus(billed, paid),
      due: c.due
    };
  } else {
    const h = (c.history || [])[parseInt(historyIndex)];
    if (!h) { showToast('Record not found'); return; }
    const billed = h.billedAmount || 0;
    const paid = h.paidAmount || 0;
    data = {
      name: c.name,
      month: h.period || '—',
      prev: h.prev,
      present: h.present,
      used: h.used,
      rate: h.rate,
      billedAmount: billed,
      paidAmount: paid,
      remaining: Math.max(0, billed - paid),
      status: computeStatus(billed, paid),
      due: h.due
    };
  }
  showReceiptModal(data);
};

function showReceiptModal(data) {
  currentReceiptData = data;
  document.getElementById('receipt-content').innerHTML = buildReceiptHTML(data);
  document.getElementById('modal-receipt').classList.add('open');
}

function buildReceiptHTML(data) {
  const { name, month, prev, present, used, rate, billedAmount, paidAmount, remaining, status, due } = data;
  const qrData = `GCASH PAYMENT|Mikesell Water Supply|${name}|${fmt(billedAmount)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(qrData)}&color=1E3A8A`;

  return `<div class="receipt">
    <div class="receipt-header">
      <div class="receipt-logo">💧 MIKESELL WATER SUPPLY</div>
      <div class="receipt-tagline">Official Water Bill Receipt</div>
    </div>
    <div class="receipt-body">
      <div class="receipt-row"><span class="r-label">Meter Name</span><span><strong>${name}</strong></span></div>
      <div class="receipt-row"><span class="r-label">Billing Period</span><span>${month}</span></div>
      <div class="receipt-row"><span class="r-label">Due Date</span><span>${fmtDate(due)}</span></div>
      <hr class="receipt-divider">
      <div class="receipt-row"><span class="r-label">Previous Reading</span><span>${prev} m³</span></div>
      <div class="receipt-row"><span class="r-label">Present Reading</span><span>${present} m³</span></div>
      <div class="receipt-row"><span class="r-label">Consumption</span><span><strong>${used} m³</strong></span></div>
      <div class="receipt-row"><span class="r-label">Rate per m³</span><span>₱${rate}.00</span></div>
      <hr class="receipt-divider">
      <div class="receipt-total"><span>Total Billed</span><span>${fmt(billedAmount)}</span></div>
      ${paidAmount > 0 ? `
      <div class="receipt-row receipt-paid-row"><span class="r-label">Amount Paid</span><span style="color:var(--green-600);font-weight:700">${fmt(paidAmount)}</span></div>
      <div class="receipt-row receipt-remaining-row"><span class="r-label">Remaining Balance</span><span style="color:${remaining > 0 ? 'var(--red-600)' : 'var(--green-600)'};font-weight:700">${remaining > 0 ? fmt(remaining) : '✓ Fully Paid'}</span></div>
      ` : ''}
      <div class="receipt-status-row">${badge(status)}</div>
    </div>
    <div class="qr-section">
  <div class="qr-img">
    <img src="img/gcash-qr.jpg" width="130" height="130" alt="GCash QR" />
  </div>
  <div class="qr-label">Scan to pay via GCash · AN*****A M.</div>
  <div class="qr-label" style="margin-top:2px;font-size:10px">0999 447 ····</div>
</div>
  </div>`;
}

window.printCurrentReceipt = function () {
  if (currentReceiptData) openPrint(buildReceiptHTML(currentReceiptData));
};

window.printSingle = function (id) {
  const c = connections[id];
  const billed = lockedAmount(c);
  const paid = c.paidAmount || 0;
  openPrint(buildReceiptHTML({
    name: c.name, month: c.billingPeriod || '—',
    prev: c.prev || 0, present: c.present || 0,
    used: consumption(c), rate: c.rate || 25,
    billedAmount: billed, paidAmount: paid,
    remaining: Math.max(0, billed - paid),
    status: computeStatus(billed, paid), due: c.due
  }));
};

window.printAll = function () {
  const all = Object.keys(connections).map(id => {
    const c = connections[id];
    const billed = lockedAmount(c);
    const paid = c.paidAmount || 0;
    return buildReceiptHTML({
      name: c.name, month: c.billingPeriod || '—',
      prev: c.prev || 0, present: c.present || 0,
      used: consumption(c), rate: c.rate || 25,
      billedAmount: billed, paidAmount: paid,
      remaining: Math.max(0, billed - paid),
      status: computeStatus(billed, paid), due: c.due
    });
  }).join('<div style="page-break-after:always;margin:30px 0;border-top:1px dashed #ccc"></div>');
  openPrint(all);
};

function openPrint(html) {
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Mikesell Water Supply — Bill</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}body{font-family:'Plus Jakarta Sans',sans-serif;background:white;padding:20px;color:#1e293b}
    .receipt{max-width:360px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
    .receipt-header{background:linear-gradient(135deg,#1D4ED8,#1E3A8A);padding:22px;text-align:center;color:white}
    .receipt-logo{font-size:16px;font-weight:800}.receipt-tagline{font-size:11px;opacity:.65;margin-top:3px}
    .receipt-body{padding:20px}.receipt-row{display:flex;justify-content:space-between;font-size:13px;padding:5px 0}
    .r-label{color:#64748b}.receipt-divider{border:none;border-top:1px dashed #e2e8f0;margin:12px 0}
    .receipt-total{display:flex;justify-content:space-between;font-size:17px;font-weight:800;padding:12px 0 0;border-top:2px solid #1D4ED8;margin-top:8px;color:#1E40AF;font-family:'JetBrains Mono',monospace}
    .receipt-paid-row,.receipt-remaining-row{display:flex;justify-content:space-between;font-size:13px;padding:5px 0;margin-top:4px}
    .receipt-status-row{margin-top:10px;text-align:center}
    .badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:100px;font-size:11px;font-weight:700}
    .badge::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}
    .badge-paid{background:#DCFCE7;color:#15803D}.badge-due{background:#FEF3C7;color:#D97706}.badge-partial{background:#E0F2FE;color:#0369A1}
    .qr-section{text-align:center;padding:18px;border-top:1px solid #f1f5f9;background:#f8fafc}
    .qr-img{display:inline-block;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:white}
    .qr-label{font-size:11px;color:#94a3b8;margin-top:8px;font-weight:500}
  </style></head><body>${html}<script>window.onload=()=>window.print()<\/script></body></html>`);
  win.document.close();
}

// ── TABS ──────────────────────────────────────────────────────
window.switchTab = function (tab) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab)?.classList.add('active');
  document.getElementById('nav-' + tab)?.classList.add('active');
  if (tab === 'billing') renderBillingGrid();
  if (tab === 'due') renderDueGrid();
  if (tab === 'connections') renderConnections();
  if (tab === 'monthly') renderMonthly();
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
};

window.closeModal = function (id) { document.getElementById(id)?.classList.remove('open'); };
window.toggleSidebar = function () {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sidebar-overlay')?.classList.toggle('open');
};

// ── CRUD ──────────────────────────────────────────────────────
window.openAddModal = function () {
  editId = null;
  document.getElementById('modal-title').textContent = 'Add Connection';
  document.getElementById('f-name').value = '';
  document.getElementById('f-prev').value = '';
  document.getElementById('f-present').value = '';
  document.getElementById('f-rate').value = '25';
  document.getElementById('f-due').value = today();
  document.getElementById('modal-add').classList.add('open');
};

window.openEditModal = function (id) {
  editId = id;
  const c = connections[id];
  document.getElementById('modal-title').textContent = 'Edit Connection';
  document.getElementById('f-name').value = c.name;
  document.getElementById('f-prev').value = c.prev || 0;
  document.getElementById('f-present').value = c.present || 0;
  document.getElementById('f-rate').value = c.rate || 25;
  document.getElementById('f-due').value = c.due || today();
  document.getElementById('modal-add').classList.add('open');
};

window.saveConnection = async function () {
  if (!db) { showToast('Not connected to Firebase'); return; }

  const name = document.getElementById('f-name').value.trim();
  if (!name) { showToast('Enter a meter name'); return; }

  const prev = +document.getElementById('f-prev').value || 0;
  const present = +document.getElementById('f-present').value || 0;
  const rate = +document.getElementById('f-rate').value || 25;
  const billedAmount = Math.max(0, present - prev) * rate;

  const data = {
    name,
    prev,
    present,
    rate,
    billedAmount,
    paidAmount: 0,
    billingPeriod: new Date().toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }),
    due: document.getElementById('f-due').value || today(),
    status: 'due',
    updatedAt: new Date().toISOString()
  };

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    if (editId) {
      const existing = connections[editId];
      // Preserve history when editing
      data.history = existing.history || [];
      await set(ref(db, 'connections/' + editId), data);
    } else {
      await push(ref(db, 'connections'), data);
    }
    closeModal('modal-add');
    showToast('Saved successfully ✅');
  } catch (err) {
    showToast('Error: ' + err.message);
  }

  btn.disabled = false;
  btn.textContent = 'Save';
};

window.deleteConn = async function (id) {
  if (!confirm(`Delete "${connections[id]?.name}"? This cannot be undone.`)) return;
  if (!db) { showToast('Not connected'); return; }
  try { await remove(ref(db, 'connections/' + id)); showToast('Deleted.'); }
  catch (e) { showToast('Error: ' + e.message); }
};

// ── UPDATE READING MODAL ──────────────────────────────────────
window.openReadingModal = function (id) {
  readingId = id;
  const c = connections[id];
  const billed = lockedAmount(c);
  const paid = c.paidAmount || 0;
  document.getElementById('r-name').value = c.name;
  document.getElementById('r-prev').value = c.present || 0;
  document.getElementById('r-present').value = '';
  document.getElementById('r-rate').value = c.rate || 25;
  document.getElementById('r-due').value = today();
  document.getElementById('r-current-bill').textContent =
    `Current bill: ${fmt(billed)} | Paid: ${fmt(paid)} | Remaining: ${fmt(Math.max(0, billed - paid))}`;
  document.getElementById('modal-reading').classList.add('open');
};

window.saveReading = async function () {
  if (!db) { showToast('Not connected'); return; }
  const newPresent = +document.getElementById('r-present').value;
  const newRate = +document.getElementById('r-rate').value || 25;
  const c = connections[readingId];
  if (!newPresent) { showToast('Enter the new meter reading'); return; }
  if (newPresent < (c.present || 0)) { showToast('New reading cannot be less than current'); return; }

  const newPrev = c.present || 0;
  const used = Math.max(0, newPresent - newPrev);
  const newBilledAmount = used * newRate;

  // Archive current bill into history
  const history = [...(c.history || [])];
  if (c.billedAmount !== undefined || (c.present && c.prev !== undefined)) {
    history.push({
      period: c.billingPeriod || new Date().toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }),
      prev: c.prev || 0,
      present: c.present || 0,
      used: consumption(c),
      rate: c.rate || 25,
      billedAmount: lockedAmount(c),
      paidAmount: c.paidAmount || 0,
      status: computeStatus(lockedAmount(c), c.paidAmount || 0),
      due: c.due,
      savedAt: new Date().toISOString()
    });
  }

  try {
    await set(ref(db, 'connections/' + readingId), {
      ...c,
      prev: newPrev,
      present: newPresent,
      rate: newRate,
      billedAmount: newBilledAmount,
      paidAmount: 0,
      billingPeriod: new Date().toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }),
      due: document.getElementById('r-due').value,
      status: 'due',
      history,
      updatedAt: new Date().toISOString()
    });
    closeModal('modal-reading');
    showToast(`New bill created: ${fmt(newBilledAmount)} at ₱${newRate}/m³ ✅`);
  } catch (e) { showToast('Error: ' + e.message); }
};

// ── BILLING HISTORY MODAL ─────────────────────────────────────
window.showHistory = function (id) {
  const c = connections[id];
  const history = [...(c.history || [])].reverse();
  let html = `<div class="history-header">
    <div class="history-name">📋 ${c.name}</div>
    <div class="history-sub">All past billing records</div>
  </div>`;
  if (history.length === 0) {
    html += `<div class="empty"><div class="empty-icon">📂</div><div class="empty-title">No history yet</div></div>`;
  } else {
    html += `<div class="history-list">` + history.map(h => {
      const hPaid = h.paidAmount || 0;
      const hRemaining = Math.max(0, (h.billedAmount || 0) - hPaid);
      const hStatus = computeStatus(h.billedAmount || 0, hPaid);
      return `
      <div class="history-item">
        <div class="history-item-top"><span class="history-period">${h.period}</span>${badge(hStatus)}</div>
        <div class="history-item-row"><span>Reading</span><span class="mono">${h.prev} → ${h.present} m³ (${h.used} m³)</span></div>
        <div class="history-item-row"><span>Rate</span><span class="mono">₱${h.rate}/m³</span></div>
        <div class="history-item-row history-total"><span>Billed</span><span class="mono">${fmt(h.billedAmount)}</span></div>
        ${hPaid > 0 ? `<div class="history-item-row"><span>Paid</span><span class="mono" style="color:var(--green-600)">${fmt(hPaid)}</span></div>` : ''}
        ${hRemaining > 0 ? `<div class="history-item-row"><span>Remaining</span><span class="mono" style="color:var(--red-600)">${fmt(hRemaining)}</span></div>` : ''}
        <div class="history-item-row"><span>Due Date</span><span>${fmtDate(h.due)}</span></div>
      </div>`;
    }).join('') + `</div>`;
  }
  const billed = lockedAmount(c);
  const paid = c.paidAmount || 0;
  const remaining = Math.max(0, billed - paid);
  html += `<div class="history-current">
    <div class="history-current-label">Current Bill (Active)</div>
    <div class="history-item">
      <div class="history-item-top"><span class="history-period">${c.billingPeriod || '—'}</span>${badge(computeStatus(billed, paid))}</div>
      <div class="history-item-row"><span>Reading</span><span class="mono">${c.prev || 0} → ${c.present || 0} m³ (${consumption(c)} m³)</span></div>
      <div class="history-item-row"><span>Rate</span><span class="mono">₱${c.rate || 25}/m³</span></div>
      <div class="history-item-row history-total"><span>Billed</span><span class="mono">${fmt(billed)}</span></div>
      ${paid > 0 ? `<div class="history-item-row"><span>Paid</span><span class="mono" style="color:var(--green-600)">${fmt(paid)}</span></div>` : ''}
      ${remaining > 0 ? `<div class="history-item-row"><span>Remaining</span><span class="mono" style="color:var(--red-600)">${fmt(remaining)}</span></div>` : ''}
    </div>
  </div>`;
  document.getElementById('history-content').innerHTML = html;
  document.getElementById('modal-history').classList.add('open');
};

// ── INIT ──────────────────────────────────────────────────────
document.getElementById('today-date').textContent =
  new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

const storedUrl = getStoredUrl();
if (storedUrl) {
  initFirebase(storedUrl);
} else {
  document.getElementById('setup-banner').style.display = 'block';
  document.getElementById('dashboard-table-wrap').innerHTML =
    `<div class="empty"><div class="empty-icon">🔗</div><div class="empty-title">Connect Firebase</div><div class="empty-sub">Enter your Firebase URL above to get started</div></div>`;
  setSyncStatus('error', 'Not connected');
}

// PWA Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/mikesell-water/sw.js')
      .then(() => console.log('SW registered'))
      .catch(e => console.log('SW error:', e));
  });
}