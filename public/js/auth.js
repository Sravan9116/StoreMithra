/**
 * StoreMithra — Merchant Authentication & Store Profile Governance
 * Handles merchant authentication, PostgreSQL session persistence,
 * store profile modal, fast-switch demo accounts, and data sharing controls.
 */
const Auth = {
  tokenKey: 'storemithra_token',
  storeKey: 'storemithra_active_store',
  currentStore: null,

  async init() {
    console.log('🔐 Initializing Merchant Auth & Profile Module...');
    this.bindModalEvents();
    await this.restoreSession();
  },

  getToken() {
    return localStorage.getItem(this.tokenKey) || '';
  },

  setSession(token, store) {
    if (token) localStorage.setItem(this.tokenKey, token);
    if (store) {
      this.currentStore = store;
      localStorage.setItem(this.storeKey, JSON.stringify(store));
      if (window.App) {
        App.activeStoreId = store.id;
      }
    }
    this.renderHeaderBadge();
  },

  async restoreSession() {
    const token = this.getToken();
    try {
      const res = await fetch('/api/auth/me', {
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      if (data.success && data.store) {
        this.currentStore = data.store;
        if (window.App) {
          App.activeStoreId = data.store.id;
        }
      }
    } catch (err) {
      console.warn('Could not restore auth session from PostgreSQL, falling back to local storage', err);
      const cached = localStorage.getItem(this.storeKey);
      if (cached) {
        try {
          this.currentStore = JSON.parse(cached);
          if (window.App) App.activeStoreId = this.currentStore.id;
        } catch (e) {}
      }
    }

    if (!this.currentStore && window.App && App.stores && App.stores.length > 0) {
      this.currentStore = App.stores[0];
      App.activeStoreId = this.currentStore.id;
    }

    this.renderHeaderBadge();
  },

  renderHeaderBadge() {
    if (!this.currentStore) return;

    const ownerEl = document.getElementById('headerOwnerName');
    const storeEl = document.getElementById('headerStoreName');
    const repVal = document.getElementById('repScoreVal');
    const shareVal = document.getElementById('sharingModeVal');

    if (ownerEl) ownerEl.textContent = this.currentStore.owner_name || 'Store Owner';
    if (storeEl) storeEl.textContent = this.currentStore.name || 'Store Profile';

    if (repVal) {
      const score = parseFloat(this.currentStore.reputation_score || 0.85);
      repVal.textContent = `${(score * 100).toFixed(0)}% Rep`;
    }

    if (shareVal) {
      const modes = {
        full: 'Full Pool',
        limited: 'Limited Share',
        privacy_preserving: 'Privacy Mode'
      };
      shareVal.textContent = modes[this.currentStore.data_sharing_mode] || 'Active';
    }

    // Also sync the hidden dropdown if present
    const select = document.getElementById('storeSelect');
    if (select && select.value !== this.currentStore.id) {
      select.value = this.currentStore.id;
    }
  },

  bindModalEvents() {
    // Merchant badge click -> open profile modal
    const badge = document.getElementById('merchantProfileBadge');
    if (badge) {
      badge.addEventListener('click', () => this.openProfileModal());
    }

    // Switch store button click -> open switcher modal
    const btnSwitch = document.getElementById('btnOpenLoginModal');
    if (btnSwitch) {
      btnSwitch.addEventListener('click', () => this.openLoginModal());
    }

    // Close profile modal
    const closeProfile = document.getElementById('btnCloseProfileModal');
    if (closeProfile) {
      closeProfile.addEventListener('click', () => this.closeProfileModal());
    }

    // Close login modal
    const closeLogin = document.getElementById('btnCloseLoginModal');
    if (closeLogin) {
      closeLogin.addEventListener('click', () => this.closeLoginModal());
    }

    // Profile form submission
    const profileForm = document.getElementById('storeProfileForm');
    if (profileForm) {
      profileForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleProfileSubmit();
      });
    }

    // Login form submission
    const loginForm = document.getElementById('storeLoginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleLoginSubmit();
      });
    }
  },

  async openProfileModal() {
    if (!this.currentStore) return;
    const storeId = this.currentStore.id;

    const modal = document.getElementById('storeProfileModal');
    if (!modal) return;

    modal.classList.remove('hidden');

    // Fetch latest profile & stats from PostgreSQL
    try {
      const res = await fetch(`/api/stores/${storeId}/profile`);
      const data = await res.json();
      if (data.success) {
        const store = data.store;
        const stats = data.stats;

        // Fill inputs
        document.getElementById('profOwnerName').value = store.owner_name || '';
        document.getElementById('profStoreName').value = store.name || '';
        document.getElementById('profPhone').value = store.phone || '';
        document.getElementById('profUpiId').value = store.upi_id || '';
        document.getElementById('profAddress').value = store.address || '';
        document.getElementById('profPin').value = ''; // leave blank unless changing

        // Set radio / select data sharing mode
        const sharingSelect = document.getElementById('profSharingMode');
        if (sharingSelect) sharingSelect.value = store.data_sharing_mode || 'full';

        // Update stats widgets
        const score = parseFloat(store.reputation_score || 0.85);
        document.getElementById('profRepScore').textContent = `${(score * 100).toFixed(0)}%`;
        document.getElementById('profTotalSkus').textContent = stats.totalSkus || 25;
        document.getElementById('profTotalUnits').textContent = stats.totalUnits || 0;
        document.getElementById('profAvgConfidence').textContent = `${stats.avgConfidence}%`;
        document.getElementById('profTransfersCount').textContent = stats.completedTransfers || 0;
        document.getElementById('profTotalSaved').textContent = `₹${parseFloat(stats.totalSaved || 0).toFixed(0)}`;
      }
    } catch (err) {
      console.error('Failed to load store profile details:', err);
    }
  },

  closeProfileModal() {
    const modal = document.getElementById('storeProfileModal');
    if (modal) modal.classList.add('hidden');
  },

  async handleProfileSubmit() {
    if (!this.currentStore) return;
    const storeId = this.currentStore.id;

    const owner_name = document.getElementById('profOwnerName').value.trim();
    const phone = document.getElementById('profPhone').value.trim();
    const upi_id = document.getElementById('profUpiId').value.trim();
    const address = document.getElementById('profAddress').value.trim();
    const pin = document.getElementById('profPin').value.trim();
    const data_sharing_mode = document.getElementById('profSharingMode').value;

    const submitBtn = document.getElementById('btnSaveProfile');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Saving to PostgreSQL...";
    }

    try {
      const res = await fetch(`/api/stores/${storeId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_name,
          phone,
          upi_id,
          address,
          pin: pin || undefined,
          data_sharing_mode
        })
      });
      const data = await res.json();
      if (data.success && data.store) {
        this.currentStore = data.store;
        this.setSession(this.getToken(), data.store);
        this.closeProfileModal();
        if (window.App) {
          App.showToast('Store Profile & Governance saved to PostgreSQL!', 'success');
          await App.loadStores();
          await App.loadActiveStoreData();
        }
      } else {
        alert(data.error || 'Failed to update store profile');
      }
    } catch (err) {
      console.error('Error saving profile:', err);
      alert('Network error while saving profile to PostgreSQL');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = "<i class='bx bx-save'></i> Save Profile & Governance";
      }
    }
  },

  async openLoginModal() {
    const modal = document.getElementById('storeLoginModal');
    if (!modal) return;
    modal.classList.remove('hidden');

    // Populate quick-switch stores list
    const listContainer = document.getElementById('demoStoresQuickList');
    if (!listContainer) return;

    listContainer.innerHTML = "<div class='text-center p-3'><i class='bx bx-loader-alt bx-spin'></i> Loading Stores...</div>";

    try {
      const res = await fetch('/api/stores');
      const data = await res.json();
      if (data.success && data.stores) {
        listContainer.innerHTML = data.stores.map(s => `
          <div class="quick-store-card ${this.currentStore && this.currentStore.id === s.id ? 'active-store' : ''}"
               onclick="Auth.demoSwitch('${s.id}')">
            <div class="quick-store-icon">
              <i class="bx bxs-store-alt"></i>
            </div>
            <div class="quick-store-info">
              <div class="quick-store-title">
                <strong>${s.name}</strong>
                ${this.currentStore && this.currentStore.id === s.id ? '<span class="current-tag"><i class="bx bx-check"></i> Active</span>' : ''}
              </div>
              <div class="quick-store-owner">
                <i class="bx bx-user"></i> ${s.owner_name} &bull; <i class="bx bx-phone"></i> ${s.phone}
              </div>
              <div class="quick-store-badges">
                <span class="badge-mini"><i class="bx bxs-star text-warning"></i> ${(s.reputation_score * 100).toFixed(0)}% Trust</span>
                <span class="badge-mini"><i class="bx bx-map-pin"></i> ${s.address.split(',')[0]}</span>
                <span class="badge-mini"><i class="bx bx-credit-card"></i> UPI: ${s.upi_id || 'merchant@upi'}</span>
              </div>
            </div>
            <button class="btn btn-sm btn-ghost switch-action-btn">
              <i class="bx bx-right-arrow-alt"></i> Switch
            </button>
          </div>
        `).join('');
      }
    } catch (err) {
      listContainer.innerHTML = "<div class='text-danger p-2'>Failed to load stores from PostgreSQL</div>";
    }
  },

  closeLoginModal() {
    const modal = document.getElementById('storeLoginModal');
    if (modal) modal.classList.add('hidden');
  },

  async handleLoginSubmit() {
    const phone = document.getElementById('loginPhone').value.trim();
    const pin = document.getElementById('loginPin').value.trim();

    if (!phone) {
      alert('Please enter your phone number');
      return;
    }

    const loginBtn = document.getElementById('btnLoginSubmit');
    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Verifying in PostgreSQL...";
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin })
      });
      const data = await res.json();
      if (data.success && data.store) {
        this.setSession(data.token, data.store);
        this.closeLoginModal();
        if (window.App) {
          App.showToast(`Logged in as ${data.store.owner_name} (${data.store.name})`, 'success');
          await App.loadStores();
          await App.loadActiveStoreData();
        }
      } else {
        alert(data.error || 'Login failed. Check phone and PIN (default 1234).');
      }
    } catch (err) {
      console.error('Login error:', err);
      alert('Network error during login');
    } finally {
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.innerHTML = "<i class='bx bx-log-in'></i> Merchant Login";
      }
    }
  },

  async demoSwitch(storeId) {
    try {
      const res = await fetch('/api/auth/demo-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId })
      });
      const data = await res.json();
      if (data.success && data.store) {
        this.setSession(data.token, data.store);
        this.closeLoginModal();
        if (window.App) {
          App.showToast(`Switched active profile to ${data.store.name}`, 'success');
          await App.loadStores();
          await App.loadActiveStoreData();
        }
      }
    } catch (err) {
      console.error('Demo switch error:', err);
    }
  },

  async logout() {
    const token = this.getToken();
    try {
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
      }
    } catch (e) {
      console.warn('Logout notification error:', e);
    }
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.storeKey);
    window.location.href = '/login';
  }
};

window.Auth = Auth;
