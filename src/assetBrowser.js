/**
 * src/assetBrowser.js
 * Asset Browser UI Gallery for exploring models in AssetsTest/Assets,
 * triggering 3D preview & optimization, and managing placed world objects.
 */
import { fetchAssetCatalog, getAssetCatalog, registerCustomAsset } from './assetCatalog.js';
import { openModelPreviewModal } from './modelPreviewModal.js';
import { selectGlbAsset, getAllPlacements } from './glbAssets.js';
import { selectObject } from './transformManager.js';
import { showNotification } from './levelSerializer.js';

let _browserPanel = null;
let _currentFilter = 'all';
let _searchQuery = '';

export async function setupAssetBrowser(onSelectAssetForPlacement) {
  _createBrowserDom();
  await fetchAssetCatalog();
  _renderAssetGrid(onSelectAssetForPlacement);
}

export function openAssetBrowser() {
  if (_browserPanel) {
    _browserPanel.classList.remove('hidden');
    _renderPlacedObjectsList();
  }
}

export function closeAssetBrowser() {
  if (_browserPanel) {
    _browserPanel.classList.add('hidden');
  }
}

export function toggleAssetBrowser() {
  if (_browserPanel) {
    _browserPanel.classList.toggle('hidden');
    if (!_browserPanel.classList.contains('hidden')) {
      _renderPlacedObjectsList();
    }
  }
}

function _createBrowserDom() {
  if (_browserPanel) return;

  _browserPanel = document.createElement('div');
  _browserPanel.id = 'assetBrowserPanel';
  _browserPanel.className = 'asset-browser-drawer hidden';
  _browserPanel.style.cssText = `
    position: fixed;
    top: 52px;
    right: 280px;
    z-index: 25;
    width: 380px;
    max-height: calc(100vh - 72px);
    overflow-y: auto;
    overflow-x: hidden;
    background: rgba(10, 16, 12, 0.94);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 16px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
    padding: 14px 16px;
    font: 11.5px/1.4 ui-monospace, Consolas, monospace;
    color: #eaf2df;
    user-select: none;
    box-sizing: border-box;
    transition: opacity 0.2s, transform 0.2s;
  `;

  _browserPanel.innerHTML = `
    <!-- Header -->
    <div style="display:flex; justify-content:space-between; align-items:center; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.14); margin-bottom:10px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:16px;">📦</span>
        <div>
          <b style="color:#fff; font-size:13px; letter-spacing:0.04em;">3D ASSETS & OPTIMIZER</b>
          <div style="font-size:9.5px; color:rgba(235,245,225,0.65);">AssetsTest/Assets Library</div>
        </div>
      </div>
      <button id="closeBrowserBtn" class="icon-btn" title="Close Panel">✕</button>
    </div>

    <!-- Search & Filters -->
    <div style="margin-bottom:8px;">
      <input id="assetSearchInput" type="text" placeholder="🔍 Search 3D models..." style="
        width: 100%;
        box-sizing: border-box;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #fff;
        padding: 5px 8px;
        border-radius: 8px;
        font: 11px monospace;
        outline: none;
        margin-bottom: 6px;
      ">

      <!-- Category Filter Pills -->
      <div style="display:flex; gap:4px; flex-wrap:wrap;">
        <button class="cat-pill active" data-cat="all">All</button>
        <button class="cat-pill" data-cat="Structure">🏛️ Structures</button>
        <button class="cat-pill" data-cat="Prop">📦 Props</button>
        <button class="cat-pill" data-cat="Nature">🌿 Nature</button>
        <button class="cat-pill" data-cat="Character">👤 Chars</button>
      </div>
    </div>

    <!-- Local File Dropzone -->
    <label style="
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 8px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px dashed rgba(255, 255, 255, 0.28);
      border-radius: 10px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: background 0.15s;
    " id="browserDropZone">
      <span style="font-size:11px; font-weight:bold; color:#7ef088;">+ Add Custom .GLB / .GLTF</span>
      <span style="font-size:9.5px; color:rgba(235,245,225,0.6);">Click to upload or drag & drop</span>
      <input id="customFileInput" type="file" accept=".glb,.gltf" multiple style="display:none;">
    </label>

    <!-- Asset Cards List -->
    <div id="assetCardsContainer" style="display:flex; flex-direction:column; gap:6px; max-height:300px; overflow-y:auto; padding-right:2px;">
      <!-- Populated dynamically -->
    </div>

    <!-- Placed World Objects Section -->
    <div style="margin-top:12px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.14);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <span style="font-weight:bold; font-size:11px; color:#ffd57e;">📍 PLACED OBJECTS IN SCENE</span>
        <span id="placedCountBadge" style="font-size:9.5px; color:rgba(235,245,225,0.6);">0 props</span>
      </div>
      <div id="placedObjectsContainer" style="display:flex; flex-direction:column; gap:3px; max-height:140px; overflow-y:auto;">
        <!-- Populated dynamically -->
      </div>
    </div>
  `;

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    .asset-browser-drawer.hidden {
      display: none !important;
    }
    .cat-pill {
      cursor: pointer;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #eaf2df;
      border-radius: 12px;
      padding: 2px 7px;
      font: 9.5px monospace;
      transition: all 0.15s;
    }
    .cat-pill:hover { background: rgba(255, 255, 255, 0.22); color: #fff; }
    .cat-pill.active {
      background: rgba(126, 240, 136, 0.3);
      border-color: #7ef088;
      color: #fff;
      font-weight: bold;
    }
    
    .asset-card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 10px;
      padding: 7px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.15s;
    }
    .asset-card:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.28);
    }
    
    .placed-prop-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 6px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      font-size: 10px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .placed-prop-row:hover {
      background: rgba(126, 240, 136, 0.2);
      border-color: #7ef088;
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(_browserPanel);

  // Hook close button
  _browserPanel.querySelector('#closeBrowserBtn').addEventListener('click', closeAssetBrowser);

  // Hook search input
  const searchInput = _browserPanel.querySelector('#assetSearchInput');
  searchInput.addEventListener('input', (e) => {
    _searchQuery = e.target.value.toLowerCase().trim();
    _renderAssetGrid();
  });

  // Hook category filters
  _browserPanel.querySelectorAll('.cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      _browserPanel.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      _currentFilter = pill.dataset.cat;
      _renderAssetGrid();
    });
  });

  // Hook custom file upload
  const fileInp = _browserPanel.querySelector('#customFileInput');
  fileInp.addEventListener('change', (e) => {
    for (const file of e.target.files) {
      const item = registerCustomAsset(file);
      showNotification(`Added custom asset: ${item.name}`, 'success', 2000);
    }
    _renderAssetGrid();
  });
}

function _renderAssetGrid(onSelectAssetForPlacement) {
  const container = _browserPanel.querySelector('#assetCardsContainer');
  if (!container) return;

  const catalog = getAssetCatalog();
  const filtered = catalog.filter(a => {
    const matchesCat = _currentFilter === 'all' || a.category === _currentFilter;
    const matchesSearch = !_searchQuery || a.name.toLowerCase().includes(_searchQuery);
    return matchesCat && matchesSearch;
  });

  container.innerHTML = '';
  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:18px; color:rgba(235,245,225,0.5);">No matching 3D models found</div>`;
    return;
  }

  for (const asset of filtered) {
    const card = document.createElement('div');
    card.className = 'asset-card';

    // Format size badge color: >80MB is amber warning, <10MB green
    const sizeNum = parseFloat(asset.sizeMB) || 0;
    const sizeColor = sizeNum > 60 ? '#f59e0b' : '#7ef088';

    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:16px;">📦</span>
        <div>
          <div style="font-weight:bold; color:#fff; font-size:11.5px;">${asset.name}</div>
          <div style="display:flex; align-items:center; gap:5px; margin-top:1px;">
            <span style="font-size:9.5px; color:${sizeColor}; font-weight:bold;">${asset.sizeMB} MB</span>
            <span style="color:rgba(255,255,255,0.3);">·</span>
            <span style="font-size:9px; color:rgba(235,245,225,0.6);">${asset.category}</span>
          </div>
        </div>
      </div>

      <div style="display:flex; gap:4px;">
        <button class="mini-btn prev-btn" style="padding:3px 7px; background:rgba(56, 189, 248, 0.35); border-color:#38bdf8;" title="Preview in 3D & Configure Compression Options">
          🔍 Preview & Optimize
        </button>
      </div>
    `;

    // Click on card or Preview button opens the 3D Preview & Optimizer Inspector
    card.querySelector('.prev-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openModelPreviewModal(asset, (name, model) => {
        selectGlbAsset(name);
        if (onSelectAssetForPlacement) onSelectAssetForPlacement(name);
        closeAssetBrowser();
      });
    });

    card.addEventListener('click', () => {
      openModelPreviewModal(asset, (name, model) => {
        selectGlbAsset(name);
        if (onSelectAssetForPlacement) onSelectAssetForPlacement(name);
        closeAssetBrowser();
      });
    });

    container.appendChild(card);
  }
}

function _renderPlacedObjectsList() {
  const container = _browserPanel?.querySelector('#placedObjectsContainer');
  const countBadge = _browserPanel?.querySelector('#placedCountBadge');
  if (!container) return;

  const placements = getAllPlacements();
  if (countBadge) countBadge.textContent = `${placements.length} placed`;

  container.innerHTML = '';
  if (placements.length === 0) {
    container.innerHTML = `<div style="font-size:9.5px; color:rgba(235,245,225,0.45); padding:4px 0;">No props placed on terrain yet.</div>`;
    return;
  }

  for (const p of placements) {
    const row = document.createElement('div');
    row.className = 'placed-prop-row';
    row.innerHTML = `
      <span style="color:#7ef088; font-weight:bold;">${p.name}</span>
      <span style="color:rgba(235,245,225,0.6); font-size:9px;">[${p.x?.toFixed(1)}, ${p.z?.toFixed(1)}]</span>
    `;

    row.addEventListener('click', () => {
      // Find object in scene by id
      const obj = window.scene?.getObjectByName(p.id);
      if (obj) {
        selectObject(obj);
        showNotification(`Selected ${p.name}`, 'info', 1800);
      }
    });

    container.appendChild(row);
  }
}
