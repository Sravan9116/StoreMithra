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
            <span style="font-size:1.15rem; font-weight:700; color: ${item.quantity <= 3 ? '#e11d48' : 'var(--text-main)'};">
              ${item.quantity}
            </span>
            <span class="text-muted text-sm">units</span>
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
            <div style="display:inline-flex; gap: 0.35rem;">
              <button class="btn btn-danger btn-sm" onclick="InventoryView.recordSale('${item.product_id}', null, 1)" title="Log 1 sale (-1)">
                <i class="bx bx-minus"></i> 1
              </button>
              <button class="btn btn-secondary btn-sm" onclick="InventoryView.updateStock('${item.product_id}', null, 1)" title="Add 1 restock (+1)">
                <i class="bx bx-plus"></i> 1
              </button>
              <button class="btn btn-success btn-sm" onclick="InventoryView.confirmStock('${item.product_id}')" title="Reset confidence badge to 100% (Flow C)">
                <i class="bx bx-check"></i> Confirm
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
  }
};

document.addEventListener('DOMContentLoaded', () => {
  InventoryView.init();
});
window.InventoryView = InventoryView;
