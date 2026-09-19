/**
 * StoreMithra — Inventory View & Quick Barcode POS
 */
const InventoryView = {
  inventoryData: [],
  selectedCategory: 'all',
  selectedConfidence: 'all',
  searchQuery: '',

  init() {
    this.bindEvents();
  },

  bindEvents() {
    // Search input
    const searchInput = document.getElementById('inventorySearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderTable();
      });
    }

    // Category pills
    document.querySelectorAll('.filter-group-inline button[data-cat]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-group-inline button[data-cat]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedCategory = btn.getAttribute('data-cat');
        this.renderTable();
      });
    });

    // Confidence pills
    document.querySelectorAll('.filter-group-inline button[data-conf]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-group-inline button[data-conf]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedConfidence = btn.getAttribute('data-conf');
        this.renderTable();
      });
    });

    // Barcode quick sale / restock
    const barcodeInput = document.getElementById('barcodeScanInput');
    const btnBarcodeSale = document.getElementById('btnBarcodeSale');
    const btnBarcodeRestock = document.getElementById('btnBarcodeRestock');

    if (btnBarcodeSale && barcodeInput) {
      btnBarcodeSale.addEventListener('click', () => {
        const barcode = barcodeInput.value.trim();
        if (!barcode) return App.showToast('Please enter or scan a barcode', 'alert');
        this.recordSale(null, barcode, 1);
        barcodeInput.value = '';
      });
    }

    if (btnBarcodeRestock && barcodeInput) {
      btnBarcodeRestock.addEventListener('click', () => {
        const barcode = barcodeInput.value.trim();
        if (!barcode) return App.showToast('Please enter or scan a barcode', 'alert');
        this.updateStock(null, barcode, 5);
        barcodeInput.value = '';
      });
    }

    if (barcodeInput) {
      barcodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          btnBarcodeSale.click();
        }
      });
    }
  },

  async loadInventory() {
    try {
      const res = await fetch(`/api/inventory/${App.activeStoreId}`);
      const data = await res.json();
      if (data.success) {
        this.inventoryData = data.inventory || [];
        this.renderTable();
      }
    } catch (err) {
      console.error('Error loading inventory:', err);
    }
  },

  renderTable() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    let filtered = this.inventoryData;

    // Filter category
    if (this.selectedCategory !== 'all') {
      filtered = filtered.filter(i => i.category.toLowerCase() === this.selectedCategory.toLowerCase());
    }

    // Filter confidence
    if (this.selectedConfidence !== 'all') {
      filtered = filtered.filter(i => i.confidenceBadge.level === this.selectedConfidence);
    }

    // Search query
    if (this.searchQuery) {
      filtered = filtered.filter(i =>
        i.name.toLowerCase().includes(this.searchQuery) ||
        (i.brand && i.brand.toLowerCase().includes(this.searchQuery)) ||
        (i.barcode && i.barcode.includes(this.searchQuery))
      );
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No products found matching filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(item => {
      const badge = item.confidenceBadge;
      const confClass = badge.level === 'high' ? 'conf-high' : (badge.level === 'medium' ? 'conf-medium' : 'conf-low');
      const staleTag = item.possibleStale ? `<span class="possible-stale-tag" title="Category is selling well but this item had zero updates"><i class="bx bx-error-circle"></i> Stale Flag</span>` : '';
      const perishableTag = item.isPerishable ? `<span style="font-size:0.75rem; color:#f87171; margin-left:4px;"><i class="bx bx-time-five"></i> Exp: ${item.expiry_date || 'Soon'}</span>` : '';

      return `
        <tr data-product-id="${item.product_id}">
          <td>
            <div class="font-semibold text-main">${item.name}</div>
            <div class="text-dim text-sm">${item.brand || ''} • ${item.pack_size} ${perishableTag}</div>
            <div style="font-size:0.7rem; color:#64748b; font-family: monospace;">Barcode: ${item.barcode || 'N/A'}</div>
          </td>
          <td><span class="badge badge-category">${item.category}</span></td>
          <td>
            <div class="font-semibold text-main">₹${item.price}</div>
            <div class="text-dim text-sm">Cost: ₹${item.cost_price}</div>
          </td>
          <td>
            <span style="font-size:1.15rem; font-weight:700; color: ${item.quantity <= 0 ? '#ef4444' : (item.quantity <= 3 ? '#f59e0b' : 'var(--text-main)')};">
              ${item.quantity}
            </span>
            <span class="text-muted text-sm">units</span>
            ${item.quantity === 0 ? '<div style="font-size:0.7rem; font-weight:700; color:#ef4444; text-transform:uppercase; letter-spacing:0.5px;">Out of Stock</div>' : ''}
          </td>
          <td>
            <span class="conf-badge ${confClass}">
              <i class="bx bxs-circle" style="font-size:0.55rem; vertical-align:middle;"></i>
              ${badge.label}
            </span>
            ${staleTag}
          </td>
          <td class="text-muted text-sm">
            ${new Date(item.last_updated).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </td>
          <td class="text-right">
            <div style="display:inline-flex; gap: 0.35rem; align-items:center;">
              ${item.quantity === 0 ? `
                <button class="btn btn-primary btn-sm" onclick="InventoryView.openDirectTransfer('${item.product_id}', '${item.name.replace(/'/g, "\\'")}')" title="Request out-of-stock item from nearby stores">
                  <i class="bx bx-transfer-alt"></i> Request Stock
                </button>
              ` : `
                <button class="btn btn-danger btn-sm" onclick="InventoryView.recordSale('${item.product_id}', null, 1)" title="Log 1 sale (-1)">
                  <i class="bx bx-minus"></i> 1
                </button>
                <button class="btn btn-secondary btn-sm" onclick="InventoryView.updateStock('${item.product_id}', null, 1)" title="Add 1 restock (+1)">
                  <i class="bx bx-plus"></i> 1
                </button>
              `}
              <button class="btn btn-ghost btn-sm" onclick="InventoryView.openDirectTransfer('${item.product_id}', '${item.name.replace(/'/g, "\\'")}')" title="Find surplus stock in nearby kirana network">
                <i class="bx bx-transfer"></i>
              </button>
              <button class="btn btn-success btn-sm" onclick="InventoryView.confirmStock('${item.product_id}')" title="Reset confidence badge to 100% (Flow C)">
                <i class="bx bx-check"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  async recordSale(productId, barcode, quantity = 1) {
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: App.activeStoreId,
          productId,
          barcode,
          quantity
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        await this.loadInventory();
        if (window.RisksView) RisksView.loadDashboard();
      } else {
        App.showToast(data.error || 'Sale failed', 'alert');
      }
    } catch (err) {
      console.error(err);
      App.showToast('Sale recording failed', 'alert');
    }
  },

  async updateStock(productId, barcode, quantityChange = 1) {
    try {
      const res = await fetch('/api/inventory/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: App.activeStoreId,
          productId,
          barcode,
          quantityChange
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        await this.loadInventory();
        if (window.RisksView) RisksView.loadDashboard();
      } else {
        App.showToast(data.error || 'Update failed', 'alert');
      }
    } catch (err) {
      console.error(err);
      App.showToast('Stock update failed', 'alert');
    }
  },

  async confirmStock(productId) {
    try {
      const res = await fetch('/api/confidence/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: App.activeStoreId,
          productId
        })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(data.message, 'success');
        await this.loadInventory();
        if (window.RisksView) RisksView.loadDashboard();
      }
    } catch (err) {
      console.error(err);
      App.showToast('Confirm failed', 'alert');
    }
  },

  async openDirectTransfer(productId, productName) {
    try {
      App.showToast('Searching nearby stores for available stock...', 'info');
      const res = await fetch(`/api/inventory/${App.activeStoreId}/donors/${productId}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const donors = data.donors || [];
      const product = data.product || {};
      if (donors.length === 0) {
        return App.showToast(`No nearby stores currently have surplus stock of ${productName}.`, 'alert');
      }

      const modal = document.getElementById('transferModal');
      const title = document.getElementById('modalTitle');
      const body = document.getElementById('modalBody');

      title.textContent = `Request Stock from Neighbor Store`;
      const marginPerUnit = parseFloat(product.price || 0) - parseFloat(product.cost_price || 0);

      body.innerHTML = `
        <div style="font-size: 0.95rem;">
          <div style="background: var(--bg-secondary); padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid var(--border-subtle); margin-bottom: 1rem;">
            <div style="font-size: 1.1rem; font-weight: bold;">${productName}</div>
            <div style="color: var(--text-muted); font-size: 0.85rem;">
              MRP: ₹${product.price} • Cost: ₹${product.cost_price} • Margin: ₹${marginPerUnit.toFixed(2)}/unit
            </div>
          </div>

          <div style="margin-bottom: 1rem;">
            <label style="display:block; font-weight:600; margin-bottom:0.35rem;">Select Supplying Store:</label>
            <select id="directTransferDonorSelect" class="form-control" style="width:100%; padding:0.5rem; background:var(--bg-card); color:var(--text-main); border:1px solid var(--border-subtle); border-radius:6px;">
              ${donors.map((d, i) => `
                <option value="${i}">
                  ${d.storeName} (${d.distanceMeters}m away) — ${d.transferableUnits} units surplus (${(d.confidence * 100).toFixed(0)}% conf)
                </option>
              `).join('')}
            </select>
          </div>

          <div style="margin-bottom: 1rem;">
            <label style="display:block; font-weight:600; margin-bottom:0.35rem;">Transfer Quantity:</label>
            <input id="directTransferQtyInput" type="number" min="1" max="${donors[0].transferableUnits || 10}" value="${Math.min(5, donors[0].transferableUnits || 5)}" class="form-control" style="width:100%; padding:0.5rem; background:var(--bg-card); color:var(--text-main); border:1px solid var(--border-subtle); border-radius:6px;" />
          </div>

          <div id="directTransferSummaryBox" style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 6px; padding: 0.75rem; font-size: 0.85rem; margin-bottom: 1.25rem;">
          </div>

          <div style="display: flex; gap: 0.75rem;">
            <button id="btnSubmitDirectTransfer" class="btn btn-primary btn-block">
              <i class="bx bx-send"></i> Send Stock Request
            </button>
            <button onclick="document.getElementById('transferModal').classList.add('hidden')" class="btn btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      `;

      const donorSelect = document.getElementById('directTransferDonorSelect');
      const qtyInput = document.getElementById('directTransferQtyInput');
      const summaryBox = document.getElementById('directTransferSummaryBox');

      const updateSummary = () => {
        const donor = donors[parseInt(donorSelect.value, 10)];
        const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
        const distanceKm = donor.distanceKm;
        const runnerCost = +( (distanceKm < 0.3 ? 15.0 : 25.0) + (distanceKm * 15) ).toFixed(2);
        const handlingFee = Math.max(3, Math.round(marginPerUnit * 0.25));
        const transferPricePerUnit = +(parseFloat(product.cost_price || 0) + handlingFee).toFixed(2);
        const avoidedLoss = +(qty * marginPerUnit).toFixed(2);
        const netBenefit = +(avoidedLoss - runnerCost).toFixed(2);

        summaryBox.innerHTML = `
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span>Price to Pay Donor:</span>
            <strong>₹${transferPricePerUnit}/unit (₹${(transferPricePerUnit * qty).toFixed(2)})</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span>Runner Fee:</span>
            <span>₹${runnerCost}</span>
          </div>
          <div style="display:flex; justify-content:space-between; border-top:1px solid rgba(99, 102, 241, 0.2); padding-top:4px;">
            <span>Avoided Lost Sales Margin:</span>
            <strong class="text-success">+₹${avoidedLoss}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-top:2px;">
            <span>Estimated Net Value:</span>
            <strong class="text-success">₹${netBenefit}</strong>
          </div>
        `;
      };

      donorSelect.addEventListener('change', () => {
        const donor = donors[parseInt(donorSelect.value, 10)];
        qtyInput.max = donor.transferableUnits;
        qtyInput.value = Math.min(qtyInput.value, donor.transferableUnits);
        updateSummary();
      });
      qtyInput.addEventListener('input', updateSummary);
      updateSummary();

      document.getElementById('btnSubmitDirectTransfer').onclick = async () => {
        const donor = donors[parseInt(donorSelect.value, 10)];
        const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
        const distanceKm = donor.distanceKm;
        const runnerCost = +( (distanceKm < 0.3 ? 15.0 : 25.0) + (distanceKm * 15) ).toFixed(2);
        const handlingFee = Math.max(3, Math.round(marginPerUnit * 0.25));
        const transferPricePerUnit = +(parseFloat(product.cost_price || 0) + handlingFee).toFixed(2);
        const avoidedLoss = +(qty * marginPerUnit).toFixed(2);
        const netBenefit = +(avoidedLoss - runnerCost).toFixed(2);

        try {
          const tRes = await fetch('/api/transfers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromStoreId: donor.storeId,
              toStoreId: App.activeStoreId,
              productId: productId,
              quantity: qty,
              transferPrice: transferPricePerUnit,
              transferCost: runnerCost,
              expectedBenefit: netBenefit
            })
          });
          const tData = await tRes.json();
          if (tData.success) {
            App.showToast(`Transfer request for ${qty} units sent to ${donor.storeName}!`, 'success');
            modal.classList.add('hidden');
            App.switchTab('transfers');
          } else {
            App.showToast(tData.error || 'Failed to request transfer', 'alert');
          }
        } catch (e) {
          App.showToast('Transfer request failed', 'alert');
        }
      };

      modal.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      App.showToast('Could not search network for surplus stock', 'alert');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  InventoryView.init();
});
window.InventoryView = InventoryView;
