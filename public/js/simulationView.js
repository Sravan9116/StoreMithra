/**
 * StoreMithra — Simulation & Platform Analytics View
 */
const SimulationView = {
  init() {
    // Bind sandbox buttons
    const btnSandboxDecay = document.getElementById('btnSandboxDecay');
    if (btnSandboxDecay) {
      btnSandboxDecay.addEventListener('click', () => this.fastForward(3));
    }

    const btnSandboxSpike = document.getElementById('btnSandboxSpike');
    if (btnSandboxSpike) {
      btnSandboxSpike.addEventListener('click', () => this.simulateRandomSale(10));
    }

    const btnSandboxReset = document.getElementById('btnSandboxReset');
    if (btnSandboxReset) {
      btnSandboxReset.addEventListener('click', () => this.resetNetwork());
    }
  },

  async loadSummary() {
    try {
      const res = await fetch('/api/network/summary');
      const data = await res.json();
      if (data.success && data.summary) {
        const simSaved = document.getElementById('simSavedTotal');
        if (simSaved) {
          simSaved.textContent = '₹' + data.summary.totalSavedThroughTransfers;
        }
      }
    } catch (e) {
      console.error('Failed to load summary', e);
    }
  },

  async fastForward(days = 2) {
    try {
      const res = await fetch('/api/simulation/fast-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`Fast-forwarded ${days} days: Confidence scores decayed and stale warnings active!`, 'info');
        await App.loadActiveStoreData();
      }
    } catch (e) {
      App.showToast('Simulation failed', 'alert');
    }
  },

  async simulateRandomSale(count = 6) {
    try {
      const res = await fetch('/api/simulation/random-sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`Simulated ${data.sales.length} customer sales. Stocks updated in real-time.`, 'success');
        await App.loadActiveStoreData();
      }
    } catch (e) {
      App.showToast('Sale simulation failed', 'alert');
    }
  },

  async resetNetwork() {
    if (!confirm('Reset entire network to initial demo state?')) return;
    try {
      const res = await fetch('/api/simulation/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        App.showToast('Network restored to pristine demo state!', 'success');
        await App.loadStores();
        await App.loadActiveStoreData();
      }
    } catch (e) {
      App.showToast('Reset failed', 'alert');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  SimulationView.init();
});
window.SimulationView = SimulationView;
