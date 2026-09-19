/**
 * StoreMithra — Transfers Hub (Incoming & Outgoing Flows)
 */
const TransfersView = {
  incoming: [],
  outgoing: [],

  init() {},

  async loadTransfers() {
    try {
      const res = await fetch(`/api/transfers/${App.activeStoreId}`);
      const data = await res.json();
      if (data.success) {
        this.incoming = data.incomingRequests || [];
        this.outgoing = data.outgoingRequests || [];
        this.render();

        const badge = document.getElementById('transferCountBadge');
        const activeCount = this.incoming.filter(t => t.status === 'pending').length +
                            this.outgoing.filter(t => t.status === 'in_transit' || t.status === 'accepted').length;
        if (badge) badge.textContent = activeCount;
      }
    } catch (err) {
      console.error('Error loading transfers:', err);
    }
  },

  render() {
    this.renderIncoming();
    this.renderOutgoing();
  },

  renderIncoming() {
    const list = document.getElementById('incomingTransfersList');
    const countBadge = document.getElementById('incomingCount');
    if (!list) return;

    if (countBadge) countBadge.textContent = this.incoming.length;

    if (this.incoming.length === 0) {
      list.innerHTML = `<div class="empty-state">No incoming transfer requests right now.</div>`;
      return;
    }

    list.innerHTML = this.incoming.map(t => {
      const statusClass = `status-${t.status}`;
      const handlingProfit = +(t.quantity * 5).toFixed(2); // ~₹5/unit handling margin

      let actionButtons = '';
      if (t.status === 'pending') {
        actionButtons = `
          <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
            <button class="btn btn-success btn-sm btn-block" onclick="TransfersView.updateStatus('${t.id}', 'accepted')">
              <i class="bx bx-check"></i> Accept & Prepare
            </button>
            <button class="btn btn-ghost btn-sm" onclick="TransfersView.updateStatus('${t.id}', 'declined')">
              <i class="bx bx-x"></i> Decline
            </button>
          </div>
        `;
      } else if (t.status === 'accepted') {
        actionButtons = `
          <button class="btn btn-primary btn-sm btn-block mt-2" onclick="TransfersView.updateStatus('${t.id}', 'in_transit')">
            <i class="bx bx-cycling"></i> Hand Over to Runner (In-Transit)
          </button>
        `;
      }

      return `
        <div class="transfer-item-card">
          <div class="transfer-item-header">
            <div>
              <div class="font-semibold text-main">${t.product_name} (${t.pack_size})</div>
              <div class="text-sm text-muted">Requested by: <strong>${t.to_store_name}</strong></div>
            </div>
            <span class="status-tag ${statusClass}">${t.status.replace('_', ' ')}</span>
          </div>

          <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin: 0.4rem 0;">
            <span>Requested Quantity:</span>
            <strong>${t.quantity} units</strong>
          </div>

          <!-- Flow F: The Incentive Mechanism -->
          <div class="incentive-box">
            <i class="bx bx-wallet text-success"></i> You will earn <strong>₹${handlingProfit}</strong> handling profit on this transfer.
          </div>

          <div class="text-dim text-sm">
            Requested: ${new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>

          ${actionButtons}
        </div>
      `;
    }).join('');
  },

  renderOutgoing() {
    const list = document.getElementById('outgoingTransfersList');
    const countBadge = document.getElementById('outgoingCount');
    if (!list) return;

    if (countBadge) countBadge.textContent = this.outgoing.length;

    if (this.outgoing.length === 0) {
      list.innerHTML = `<div class="empty-state">No outgoing transfer orders active.</div>`;
      return;
    }

    list.innerHTML = this.outgoing.map(t => {
      const statusClass = `status-${t.status}`;

      let actionButtons = '';
      if (t.status === 'in_transit') {
        actionButtons = `
          <button class="btn btn-success btn-sm btn-block mt-2" onclick="TransfersView.confirmArrival('${t.id}', ${t.quantity})">
            <i class="bx bx-package"></i> Confirm Stock Received (${t.quantity} units)
          </button>
        `;
      } else if (t.status === 'completed') {
        actionButtons = `
          <div style="font-size: 0.8rem; color: #34d399; margin-top: 6px;">
            <i class="bx bx-check-circle"></i> Completed & Added to Stock. Confidence reset to 100%.
          </div>
        `;
      }

      return `
        <div class="transfer-item-card">
          <div class="transfer-item-header">
            <div>
              <div class="font-semibold text-main">${t.product_name} (${t.pack_size})</div>
              <div class="text-sm text-muted">Supplying Store: <strong>${t.from_store_name}</strong></div>
            </div>
            <span class="status-tag ${statusClass}">${t.status.replace('_', ' ')}</span>
          </div>

          <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin: 0.4rem 0;">
            <span>Units Coming:</span>
            <strong>${t.quantity} units</strong>
          </div>

          <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom: 0.4rem;">
            <span>Saved Lost Margin:</span>
            <strong class="text-success">+₹${t.expected_benefit}</strong>
          </div>

          <div class="text-dim text-sm">
            Created: ${new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>

          ${actionButtons}
        </div>
      `;
    }).join('');
  },

  async updateStatus(transferId, status) {
    try {
      const res = await fetch(`/api/transfers/${transferId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        await this.loadTransfers();
        if (window.StoreMap) StoreMap.refreshMap();
      } else {
        App.showToast(data.error || 'Status update failed', 'alert');
      }
    } catch (e) {
      App.showToast('Transfer update failed', 'alert');
    }
  },

  async confirmArrival(transferId, promisedQuantity) {
    const input = prompt(`Enter delivered quantity received from runner:`, promisedQuantity);
    if (input === null) return;
    const delivered = parseInt(input, 10) || promisedQuantity;

    try {
      const res = await fetch(`/api/transfers/${transferId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          deliveredQuantity: delivered
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`Transfer completed! Stock replenished and reputation scores verified.`, 'success');
        await this.loadTransfers();
        await App.loadActiveStoreData();
      } else {
        App.showToast(data.error || 'Completion failed', 'alert');
      }
    } catch (e) {
      App.showToast('Transfer confirmation failed', 'alert');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  TransfersView.init();
});
window.TransfersView = TransfersView;
