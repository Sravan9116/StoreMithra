/**
 * StoreMithra — Leaflet.js Store Map & Pooling Discovery
 */
const StoreMap = {
  map: null,
  markersLayer: null,
  radiusCircle: null,
  routeLinesLayer: null,

  init() {
    const mapEl = document.getElementById('storeMap');
    if (!mapEl) return;

    // Bangalore Indiranagar cluster center
    this.map = L.map('storeMap').setView([12.9719, 77.6412], 14);

    // Clean light-themed CartoDB map tiles for modern white aesthetics
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> | StoreMithra',
      maxZoom: 19
    }).addTo(this.map);

    this.markersLayer = L.layerGroup().addTo(this.map);
    this.routeLinesLayer = L.layerGroup().addTo(this.map);

    // Radius change listener
    const radiusSelect = document.getElementById('mapRadiusSelect');
    if (radiusSelect) {
      radiusSelect.addEventListener('change', () => this.refreshMap());
    }

    this.refreshMap();
  },

  invalidateSize() {
    if (!this.map) {
      this.init();
    } else {
      setTimeout(() => this.map.invalidateSize(), 150);
    }
  },

  async refreshMap() {
    if (!this.map) this.init();
    if (!this.map) return;

    this.markersLayer.clearLayers();
    this.routeLinesLayer.clearLayers();
    if (this.radiusCircle) this.map.removeLayer(this.radiusCircle);

    const currentStore = App.stores.find(s => s.id === App.activeStoreId);
    if (!currentStore) return;

    // Center map on active store
    this.map.setView([currentStore.lat, currentStore.lng], 14);

    const radiusMeters = parseInt(document.getElementById('mapRadiusSelect')?.value || 3000, 10);

    // Draw radius boundary circle with purple/pink styling
    this.radiusCircle = L.circle([currentStore.lat, currentStore.lng], {
      color: '#db2777',
      fillColor: '#581c87',
      fillOpacity: 0.07,
      radius: radiusMeters,
      dashArray: '5, 8'
    }).addTo(this.map);

    // Fetch dashboard risks for current store to see which neighbors can help
    let atRiskProductIds = [];
    try {
      const dashRes = await fetch(`/api/stores/${App.activeStoreId}/dashboard`);
      const dashData = await dashRes.json();
      if (dashData.success && dashData.recommendations) {
        atRiskProductIds = dashData.recommendations.map(r => r.productId);
      }
    } catch (e) {
      console.warn('Could not fetch recommendations for map highlighting', e);
    }

    // Query nearby stores
    try {
      const res = await fetch(`/api/stores/nearby?lat=${currentStore.lat}&lng=${currentStore.lng}&radius=${radiusMeters}&currentStoreId=${App.activeStoreId}`);
      const data = await res.json();
      const nearbyStores = data.success ? data.stores : [];

      // Update count badge
      const countEl = document.getElementById('storesInRadiusCount');
      if (countEl) countEl.textContent = (nearbyStores.length + 1).toString();

      // Render store list in sidebar
      const listEl = document.getElementById('mapStoreList');
      if (listEl) {
        let listHtml = `
          <div class="map-store-card" style="border-left: 3px solid #60a5fa;">
            <strong>${currentStore.name}</strong> (Active Store)
            <div class="text-muted">${currentStore.address}</div>
          </div>
        `;

        nearbyStores.forEach(s => {
          listHtml += `
            <div class="map-store-card" onclick="StoreMap.focusStore(${s.lat}, ${s.lng})">
              <div style="display:flex; justify-content:space-between;">
                <strong>${s.name}</strong>
                <span class="text-indigo font-semibold">${s.distanceMeters}m</span>
              </div>
              <div class="text-muted">${s.address}</div>
              <div class="text-sm mt-1">Reputation: <i class="bx bxs-star text-warning"></i> ${(s.reputation_score * 100).toFixed(0)}%</div>
            </div>
          `;
        });
        listEl.innerHTML = listHtml;
      }

      // 1. Add Marker for Active Store (Dark Purple to Pink gradient pin)
      const activeIcon = L.divIcon({
        className: 'custom-map-pin active-pin',
        html: `<div style="background: linear-gradient(135deg, #581c87, #db2777); width: 36px; height: 36px; border-radius: 50%; border: 3px solid #ffffff; display:flex; align-items:center; justify-content:center; font-size:18px; color:#ffffff; box-shadow: 0 4px 14px rgba(219, 39, 119, 0.5);"><i class="bx bxs-store-alt"></i></div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });

      L.marker([currentStore.lat, currentStore.lng], { icon: activeIcon })
        .bindPopup(`
          <div style="color: #1e1b4b; font-family: sans-serif; padding: 4px;">
            <h4 style="margin:0; font-size: 14px; font-weight: bold; color: #581c87;">${currentStore.name}</h4>
            <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;"><i class="bx bxs-map-pin" style="color: #db2777;"></i> Your Store (${currentStore.address})</p>
            <p style="margin: 4px 0 0; font-size: 12px;">Reputation: <i class="bx bxs-star" style="color: #f59e0b;"></i> ${(currentStore.reputation_score * 100).toFixed(0)}%</p>
          </div>
        `)
        .addTo(this.markersLayer);

      // 2. Add Markers for Neighbor Stores (Green/Amber)
      for (const s of nearbyStores) {
        const pinIcon = L.divIcon({
          className: 'custom-map-pin neighbor-pin',
          html: `<div style="background: #10b981; width: 30px; height: 30px; border-radius: 50%; border: 2px solid #ffffff; display:flex; align-items:center; justify-content:center; font-size:16px; color:#ffffff; box-shadow: 0 0 12px rgba(16, 185, 129, 0.6);"><i class="bx bxs-store"></i></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });

        const marker = L.marker([s.lat, s.lng], { icon: pinIcon })
          .bindPopup(`
            <div style="color: #0f172a; font-family: sans-serif; padding: 4px; min-width: 180px;">
              <h4 style="margin:0; font-size: 14px; font-weight: bold;">${s.name}</h4>
              <p style="margin: 3px 0; font-size: 12px; color: #475569;">${s.address}</p>
              <div style="background:#f1f5f9; padding: 6px; border-radius: 4px; margin-top: 6px; font-size: 11px;">
                <div><strong>Distance:</strong> ${s.distanceMeters}m (~${Math.round(s.distanceMeters / 80)} min walk)</div>
                <div><strong>Sharing Mode:</strong> ${s.data_sharing_mode}</div>
                <div><strong>Reputation:</strong> <i class="bx bxs-star" style="color: #f59e0b;"></i> ${(s.reputation_score * 100).toFixed(0)}%</div>
              </div>
            </div>
          `)
          .addTo(this.markersLayer);
      }

      // 3. Draw Active Transfer Routes
      const trRes = await fetch(`/api/transfers/${App.activeStoreId}`);
      const trData = await trRes.json();
      if (trData.success) {
        const activeOrders = [...trData.incomingRequests, ...trData.outgoingRequests]
          .filter(t => t.status === 'in_transit' || t.status === 'accepted');

        for (const order of activeOrders) {
          const fromStore = App.stores.find(st => st.id === order.from_store_id);
          const toStore = App.stores.find(st => st.id === order.to_store_id);
          if (fromStore && toStore) {
            L.polyline([[fromStore.lat, fromStore.lng], [toStore.lat, toStore.lng]], {
              color: '#db2777',
              weight: 4,
              dashArray: '8, 8',
              opacity: 0.95
            }).bindTooltip(`Transferring ${order.quantity} units of ${order.product_name}`, { permanent: false })
              .addTo(this.routeLinesLayer);
          }
        }
      }

    } catch (err) {
      console.error('Error refreshing map:', err);
    }
  },

  focusStore(lat, lng) {
    if (this.map) {
      this.map.setView([lat, lng], 15, { animate: true });
    }
  }
};

window.StoreMap = StoreMap;
