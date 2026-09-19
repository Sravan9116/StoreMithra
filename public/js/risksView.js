/**
 * StoreMithra — Today's Actions & Decision Engine View
 */
const RisksView = {
  dashboardData: null,

  init() {
    const btnRefresh = document.getElementById('btnRefreshDashboard');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => this.loadDashboard());
    }
  },

  async loadDashboard() {
    const recsContainer = document.getElementById('recommendationsList');
    if (!recsContainer) return;

    try {
      const res = await fetch(`/api/stores/${App.activeStoreId}/dashboard`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      this.dashboardData = data;
      this.renderMetrics(data.metrics);
      this.renderNudges(data.nudges);
      this.renderWasteRisks(data.wasteRisks);
      this.renderRecommendations(data.recommendations);
    } catch (err) {
      console.error('Error loading dashboard:', err);
      recsContainer.innerHTML = `<div class="empty-state">Could not load recommendations.</div>`;
    }
  },

  renderMetrics(metrics) {
    if (!metrics) return;
    const statRisk = document.getElementById('statRiskCount');
    const statSavings = document.getElementById('statSavings');
    const statTransfers = document.getElementById('statTransfers');
    const riskBadge = document.getElementById('riskCountBadge');

    if (statRisk) statRisk.textContent = metrics.atRiskCount;
    if (statSavings) statSavings.textContent = '₹' + metrics.totalPotentialSavings;
    if (statTransfers) statTransfers.textContent = metrics.activeTransfersCount;
    if (riskBadge) riskBadge.textContent = metrics.atRiskCount;
  },

  renderNudges(nudges) {
    const container = document.getElementById('dailyNudgesContainer');
    if (!container) return;

    if (!nudges || nudges.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = nudges.map(nudge => `
      <div class="nudge-card">
        <div class="nudge-content">
          <span class="nudge-icon"><i class="bx bxs-bell-ring text-warning"></i></span>
          <div class="nudge-text">
            <strong>${nudge.promptText}</strong>
            <span>Confidence dropped to ${(nudge.confidence * 100).toFixed(0)}% • Last confirmed ${new Date(nudge.lastUpdated).toLocaleDateString()}</span>
          </div>
        </div>
        <div class="nudge-actions">
          <button class="btn btn-success btn-sm" onclick="RisksView.confirmNudge('${nudge.productId}', ${nudge.quantity})">
            <i class="bx bx-check"></i> Yes, Still Have ${nudge.quantity}
          </button>
          <button class="btn btn-secondary btn-sm" onclick="RisksView.promptAdjustStock('${nudge.productId}', ${nudge.quantity})">
            <i class="bx bx-edit-alt"></i> Update Qty
          </button>
        </div>
      </div>
    `).join('');
  },

  renderWasteRisks(wasteRisks) {
    const container = document.getElementById('wasteRiskContainer');
    if (!container) return;

    if (!wasteRisks || wasteRisks.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = wasteRisks.map(w => `
      <div class="waste-card">
        <div>
          <strong style="color: #fca5a5;"><i class="bx bx-error-circle"></i> Expiry & Waste Alert:</strong>
          <span>${w.productName} (${w.currentQuantity} units) — ${w.explanation}</span>
        </div>
        <span class="badge badge-alert">Potential Loss: ₹${w.potentialLoss}</span>
      </div>
    `).join('');
  },

  renderRecommendations(recommendations) {
    const container = document.getElementById('recommendationsList');
    if (!container) return;

    if (!recommendations || recommendations.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; background: var(--bg-surface); border-radius: var(--radius-lg);">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem; color: var(--success);"><i class="bx bx-check-shield"></i></div>
          <h3>All Stock Levels Healthy!</h3>
          <p class="text-muted">No immediate stockout risks detected across monitored products.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = recommendations.map((rec, index) => {
      const winner = rec.winner;
      const comp = rec.comparison;
      const isCritical = rec.riskUrgency === 'critical';
      const isHigh = rec.riskUrgency === 'high';

      const urgencyClass = isCritical ? 'urgency-critical' : (isHigh ? 'urgency-high' : '');
      const badgeClass = isCritical ? 'badge-critical' : (isHigh ? 'badge-high' : 'badge-medium');

      // Action type badge
      let typeLabel = '<i class="bx bx-transfer-alt"></i> Neighborhood Transfer';
      if (winner.type === 'reorder') typeLabel = '<i class="bx bx-package"></i> Supplier Restock';
      if (winner.type === 'substitute') typeLabel = '<i class="bx bx-sync"></i> In-Store Substitute';
      if (winner.type === 'none') typeLabel = '<i class="bx bx-time"></i> Hold / Wait';

      // Expandable math breakdown
      let mathHtml = '';
      if (comp.transfer) {
        mathHtml = `
          <div class="math-row">
            <span>Avoided Lost Sales Margin:</span>
            <span class="text-success">+₹${comp.transfer.avoidedLostSales}</span>
          </div>
          <div class="math-row">
            <span>Transfer Logistics Fee (Runner):</span>
            <span class="text-alert">-₹${comp.transfer.transferCost}</span>
          </div>
          <div class="math-row">
            <span>Sender Keeps:</span>
            <span>${comp.transfer.donorDaysAfter} days of supply</span>
          </div>
          <div class="math-row">
            <span>Sender Shopkeeper Earns:</span>
            <span class="text-indigo font-semibold">+₹${comp.transfer.senderEarning}</span>
          </div>
          <div class="math-row highlight">
            <span>Net Protected Profit:</span>
            <span class="text-success font-semibold">₹${comp.transfer.netBenefit}</span>
          </div>
          <div style="margin-top: 8px; font-size: 0.75rem; color: #94a3b8;">
            <strong>Supplier Reorder Alternative:</strong> Takes ${comp.reorder.leadTimeDays} days, causing ₹${comp.reorder.lostSalesDuringWait} in customer lost sales while waiting.
          </div>
        `;
      } else {
        mathHtml = `
          <div class="math-row">
            <span>Expected Lost Sales:</span>
            <span class="text-alert">-₹${comp.doNothingLoss}</span>
          </div>
          <div class="math-row highlight">
            <span>Recommended Net Value:</span>
            <span>₹${winner.netBenefit}</span>
          </div>
        `;
      }

      // Action Button
      let actionBtnHtml = '';
      if (winner.type === 'transfer') {
        const transferDetails = JSON.stringify(winner.details).replace(/"/g, '&quot;');
        actionBtnHtml = `
          <button class="btn btn-primary btn-block" onclick="RisksView.openTransferModal('${rec.productId}', '${rec.productName}', ${transferDetails})">
            <i class="bx bx-send"></i> Request Transfer (Save ₹${winner.netBenefit})
          </button>
        `;
      } else if (winner.type === 'substitute') {
        actionBtnHtml = `
          <button class="btn btn-secondary btn-block" onclick="App.showToast('Suggest ${winner.details.substituteName} to customers at the counter!', 'info')">
            <i class="bx bx-conversation"></i> Suggest Substitute at Counter
          </button>
        `;
      } else {
        actionBtnHtml = `
          <button class="btn btn-secondary btn-block" onclick="App.showToast('Reorder scheduled with distributor distributor delivery cycle.', 'info')">
            <i class="bx bx-package"></i> Queue Supplier Reorder
          </button>
        `;
      }

      return `
        <div class="rec-card ${urgencyClass}">
          <div>
            <div class="rec-header">
              <div>
                <div class="rec-product-name">${rec.productName}</div>
                <div class="rec-pack-tag">${rec.brand || ''} • ${rec.packSize}</div>
              </div>
              <span class="rec-urgency-badge ${badgeClass}">
                ${(rec.riskProbability * 100).toFixed(0)}% Stockout Risk
              </span>
            </div>

            <div class="rec-stock-metrics">
              <div class="stock-metric-item">
                <span class="stock-metric-label">Days of Supply</span>
                <span class="stock-metric-val ${rec.daysOfSupply < 1.5 ? 'text-alert' : 'text-main'}">
                  ${rec.daysOfSupply} days
                </span>
              </div>
              <div class="stock-metric-item">
                <span class="stock-metric-label">Avoidable Loss</span>
                <span class="stock-metric-val text-success">₹${winner.expectedBenefit}</span>
              </div>
              <div class="stock-metric-item">
                <span class="stock-metric-label">Best Action</span>
                <span class="stock-metric-val text-indigo" style="font-size:0.9rem;">
                  ${winner.type.toUpperCase()}
                </span>
              </div>
            </div>

            <div class="rec-action-badge badge-transfer-type">
              <span>${typeLabel}</span>
            </div>

            <p class="rec-explanation">${winner.explanation}</p>

            <!-- Transparent Money Math Expandable -->
            <details class="math-breakdown-details">
              <summary class="math-summary-toggle"><i class="bx bx-calculator"></i> View Money Math & Supplier Comparison</summary>
              <div class="math-content-body">
                ${mathHtml}
              </div>
            </details>
          </div>

          <div style="margin-top: 1rem;">
            ${actionBtnHtml}
          </div>
        </div>
      `;
    }).join('');
  },

  async confirmNudge(productId, quantity) {
    try {
      const res = await fetch('/api/confidence/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: App.activeStoreId,
          productId,
          quantity
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        this.loadDashboard();
      }
    } catch (e) {
      App.showToast('Nudge confirmation failed', 'alert');
    }
  },

  promptAdjustStock(productId, currentQty) {
    const input = prompt(`Enter actual verified count for this item:`, currentQty);
    if (input !== null && !isNaN(parseInt(input, 10))) {
      this.confirmNudge(productId, parseInt(input, 10));
    }
  },

  openTransferModal(productId, productName, details) {
    const modal = document.getElementById('transferModal');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');

    title.textContent = `Confirm Stock Transfer Request`;
    body.innerHTML = `
      <div style="font-size: 0.95rem;">
        <div style="background: var(--bg-secondary); padding: 1rem; border-radius: 8px; border: 1px solid var(--border-subtle); margin-bottom: 1rem;">
          <div style="font-size: 1.1rem; font-weight: bold;">${productName}</div>
          <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 2px;">
            Donor Store: <strong>${details.targetStoreName}</strong> (${details.distanceMeters}m away)
          </div>
        </div>

        <div style="margin-bottom: 1rem;">
          <div style="display:flex; justify-content:space-between; margin-bottom: 6px;">
            <span>Units to Transfer:</span>
            <strong style="font-size: 1.1rem; color: #818cf8;">${details.units} units</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom: 6px;">
            <span>Price to Pay Donor:</span>
            <span>₹${details.transferPricePerUnit} / unit</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom: 6px;">
            <span>Runner Delivery Fee:</span>
            <span>₹${details.transferCost}</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom: 6px; border-top: 1px solid var(--border-subtle); padding-top: 6px;">
            <span>Avoided Lost Sales Margin:</span>
            <strong class="text-success">+₹${details.avoidedLostSales}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; font-size: 1.05rem;">
            <span>Your Net Benefit:</span>
            <strong class="text-success">₹${details.netBenefit}</strong>
          </div>
        </div>

        <div style="background: rgba(219, 39, 119, 0.08); border: 1px solid rgba(219, 39, 119, 0.25); border-radius: 6px; padding: 0.75rem; font-size: 0.82rem; color: #4c1d95; margin-bottom: 1.25rem;">
          <i class="bx bx-gift text-pink"></i> <strong>Incentive Model:</strong> ${details.targetStoreName} earns <strong>₹${details.senderEarning}</strong> handling profit and safely keeps <strong>${details.donorDaysAfter} days</strong> of their own stock.
        </div>

        <div style="display: flex; gap: 0.75rem;">
          <button id="btnSubmitTransfer" class="btn btn-primary btn-block">
            Send Request to ${details.targetStoreName}
          </button>
          <button onclick="document.getElementById('transferModal').classList.add('hidden')" class="btn btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    `;

    document.getElementById('btnSubmitTransfer').onclick = async () => {
      try {
        const res = await fetch('/api/transfers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromStoreId: details.targetStoreId,
            toStoreId: App.activeStoreId,
            productId: productId,
            quantity: details.units,
            transferPrice: details.transferPricePerUnit,
            transferCost: details.transferCost,
            expectedBenefit: details.netBenefit
          })
        });
        const data = await res.json();
        if (data.success) {
          App.showToast(`Transfer request sent to ${details.targetStoreName}!`, 'success');
          modal.classList.add('hidden');
          App.switchTab('transfers');
        } else {
          App.showToast(data.error || 'Failed to request transfer', 'alert');
        }
      } catch (err) {
        App.showToast('Transfer request failed', 'alert');
      }
    };

    modal.classList.remove('hidden');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  RisksView.init();
});
window.RisksView = RisksView;
