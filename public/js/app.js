/**
 * StoreMithra - Global App State & Orchestrator
 */
const App = {
  activeStoreId: 'STORE_1',
  stores: [],
  activeTab: 'dashboard',

  async init() {
    console.log('Initializing StoreMithra Client...');
    this.bindEvents();
    await this.loadStores();
    if (window.Auth) {
      await Auth.init();
      if (Auth.currentStore) {
        this.activeStoreId = Auth.currentStore.id;
      }
    }
    await this.loadActiveStoreData();
  },

  bindEvents() {
    // Tab switching
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabId = tab.getAttribute('data-tab');
        this.switchTab(tabId);
      });
    });

    // Store switcher dropdown (backup if used)
    const storeSelect = document.getElementById('storeSelect');
    if (storeSelect) {
      storeSelect.addEventListener('change', (e) => {
        this.activeStoreId = e.target.value;
        if (window.Auth && Auth.demoSwitch) {
          Auth.demoSwitch(this.activeStoreId);
        } else {
          this.loadActiveStoreData();
        }
      });
    }

    // Top action buttons
    document.getElementById('btnFastForward').addEventListener('click', () => {
      SimulationView.fastForward(2);
    });

    document.getElementById('btnSimulateSale').addEventListener('click', () => {
      SimulationView.simulateRandomSale();
    });

    document.getElementById('btnResetDemo').addEventListener('click', () => {
      SimulationView.resetNetwork();
    });

    // Modal close button
    const btnCloseModal = document.getElementById('btnCloseModal');
    if (btnCloseModal) {
      btnCloseModal.addEventListener('click', () => {
        document.getElementById('transferModal').classList.add('hidden');
      });
    }
  },

  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
    });

    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.toggle('active', view.id === `tab-${tabId}`);
    });

    // Trigger tab-specific refreshes
    if (tabId === 'map' && window.StoreMap) {
      StoreMap.invalidateSize();
    } else if (tabId === 'inventory' && window.InventoryView) {
      InventoryView.loadInventory();
    } else if (tabId === 'transfers' && window.TransfersView) {
      TransfersView.loadTransfers();
    } else if (tabId === 'simulation' && window.SimulationView) {
      SimulationView.loadSummary();
    }
  },

  async loadStores() {
    try {
      const res = await fetch('/api/stores');
      const data = await res.json();
      if (data.success && data.stores) {
        this.stores = data.stores;
        const select = document.getElementById('storeSelect');
        if (select) {
          select.innerHTML = this.stores.map(s => `
            <option value="${s.id}" ${s.id === this.activeStoreId ? 'selected' : ''}>
              ${s.name} (${s.address})
            </option>
          `).join('');
        }

        this.updateStoreBadges();
      }
    } catch (err) {
      console.error('Failed to load stores from PostgreSQL:', err);
      this.showToast('Could not connect to PostgreSQL stores network', 'alert');
    }
  },

  updateStoreBadges() {
    if (window.Auth && Auth.currentStore) {
      Auth.renderHeaderBadge();
      return;
    }

    const current = this.stores.find(s => s.id === this.activeStoreId);
    if (!current) return;

    const repBadge = document.getElementById('repScoreVal');
    if (repBadge) repBadge.textContent = (parseFloat(current.reputation_score) * 100).toFixed(0) + '% Rep';

    const shareBadge = document.getElementById('sharingModeVal');
    if (shareBadge) {
      const modeNames = {
        full: 'Full Pool',
        limited: 'Limited Share',
        privacy_preserving: 'Privacy Mode'
      };
      shareBadge.textContent = modeNames[current.data_sharing_mode] || current.data_sharing_mode;
    }

    const ownerEl = document.getElementById('headerOwnerName');
    if (ownerEl && current.owner_name) ownerEl.textContent = current.owner_name;

    const storeEl = document.getElementById('headerStoreName');
    if (storeEl && current.name) storeEl.textContent = current.name;
  },

  async loadActiveStoreData() {
    this.updateStoreBadges();

    // Reload active views
    if (window.RisksView) await RisksView.loadDashboard();
    if (window.InventoryView) await InventoryView.loadInventory();
    if (window.StoreMap) await StoreMap.refreshMap();
    if (window.TransfersView) await TransfersView.loadTransfers();
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? "<i class='bx bx-check-circle toast-icon'></i>" : (type === 'alert' ? "<i class='bx bx-error-circle toast-icon'></i>" : "<i class='bx bx-info-circle toast-icon'></i>");
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
