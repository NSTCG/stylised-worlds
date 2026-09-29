/**
 * src/modelPreviewModal.js
 * Interactive 3D Model Preview Inspector & Optimization Studio.
 * Allows viewing models before import, configuring meshopt & texture compression,
 * estimating savings in real-time, and loading into the forest world or downloading GLB.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { analyzeModel, estimateOptimizedSize, optimizeModel, ensureSimplifier } from './modelOptimizer.js';
import { registerGlbAsset } from './glbAssets.js';
import { showNotification } from './levelSerializer.js';

let _modalEl = null;
let _previewScene = null;
let _previewCamera = null;
let _previewRenderer = null;
let _previewControls = null;
let _previewGrid = null;
let _animId = null;

let _currentRawModel = null;
let _currentOptimizedModel = null;
let _currentAnalysis = null;
let _currentAsset = null;
let _wireframeActive = false;
let _autoRotate = true;
let _showingOptimized = false;

// Default optimization settings (Defaulted to Quest 10% & 512 WebP for peak performance)
const _optSettings = {
  simplifyRatio: 0.10,
  targetError: 0.02,
  recomputeNormals: false,
  maxTextureRes: 512,
  textureFormat: 'webp',
  textureQuality: 0.75,
  stripNormalMap: false,
  optimizeMaterials: true
};

export function openModelPreviewModal(asset, onLoadToWorldCallback = null) {
  _currentAsset = asset;
  _createModalDom();
  _initThreePreview();
  _loadModelIntoPreview(asset, onLoadToWorldCallback);
}

function _createModalDom() {
  if (_modalEl) {
    _modalEl.style.display = 'flex';
    return;
  }

  _modalEl = document.createElement('div');
  _modalEl.id = 'modelPreviewModal';
  _modalEl.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(4, 8, 6, 0.88);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 16px;
    box-sizing: border-box;
    font: 12px/1.4 ui-monospace, Consolas, monospace;
    color: #eaf2df;
    user-select: none;
  `;

  _modalEl.innerHTML = `
    <div style="
      position: relative;
      width: 1140px;
      max-width: 96vw;
      height: 700px;
      max-height: 94vh;
      background: rgba(13, 20, 16, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 18px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.8);
      display: flex;
      overflow: hidden;
    ">
      <!-- Left: 3D Preview Canvas Viewport -->
      <div style="flex: 1.25; position: relative; background: #080d0a; border-right: 1px solid rgba(255,255,255,0.15); display: flex; flex-direction: column;">
        <div id="previewCanvasContainer" style="flex:1; width:100%; height:100%; position:relative; overflow:hidden;"></div>

        <!-- Viewport Top Toolbar -->
        <div style="position:absolute; top:12px; left:14px; z-index:10; display:flex; gap:6px;">
          <button id="prevWireframeBtn" class="prev-toolbar-btn" title="Toggle Wireframe Overlay">🕸️ Wireframe</button>
          <button id="prevRotateBtn" class="prev-toolbar-btn active" title="Toggle Auto-Rotation">🔄 Rotate</button>
          <button id="prevResetCamBtn" class="prev-toolbar-btn" title="Reset Camera Framing">🎯 Reset View</button>
          <button id="prevCompareBtn" class="prev-toolbar-btn" style="display:none;" title="Toggle Original vs Optimized">👁️ View: Optimized</button>
        </div>

        <!-- Viewport Bottom Hint -->
        <div style="position:absolute; bottom:10px; left:14px; font-size:10px; color:rgba(235,245,225,0.55); pointer-events:none;">
          🖱️ Left: Orbit &nbsp;·&nbsp; Right: Pan &nbsp;·&nbsp; Wheel: Zoom
        </div>

        <!-- Loading Overlay -->
        <div id="previewLoadingOverlay" style="position:absolute; inset:0; background:rgba(8,13,10,0.92); z-index:20; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px;">
          <div style="font-size:28px;">📦</div>
          <div id="previewLoadingTitle" style="font-weight:bold; font-size:14px; color:#7ef088;">Loading 3D Model...</div>
          <div style="width:220px; height:6px; background:rgba(255,255,255,0.15); border-radius:3px; overflow:hidden;">
            <div id="previewProgressBar" style="width:0%; height:100%; background:linear-gradient(90deg, #38bdf8, #7ef088); transition:width 0.15s;"></div>
          </div>
          <div id="previewLoadingStatus" style="font-size:10.5px; color:rgba(235,245,225,0.7);">0 MB / ...</div>
        </div>
      </div>

      <!-- Right: Optimization Studio & Model Specs -->
      <div style="flex: 1; display:flex; flex-direction:column; overflow-y:auto; padding:16px 20px; box-sizing:border-box;">
        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.12);">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span id="prevPropName" style="font-size:16px; font-weight:bold; color:#fff;">Model Name</span>
              <span id="prevPropCategory" style="font-size:9.5px; padding:2px 6px; border-radius:6px; background:rgba(126,240,136,0.25); color:#7ef088; border:1px solid rgba(126,240,136,0.4);">Prop</span>
            </div>
            <div id="prevPropFileSize" style="font-size:11px; color:#ffd57e; margin-top:2px;">Original Size: -- MB</div>
          </div>
          <button id="closePreviewBtn" style="cursor:pointer; background:none; border:none; color:rgba(255,255,255,0.6); font-size:18px; line-height:1; padding:2px 6px; border-radius:6px;">✕</button>
        </div>

        <!-- Specs Breakdown Chips -->
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-bottom:12px;">
          <div class="prev-spec-box">
            <span style="font-size:9px; color:rgba(235,245,225,0.6);">TRIANGLES</span>
            <b id="specTriCount" style="color:#7ef088; font-size:12.5px;">--</b>
          </div>
          <div class="prev-spec-box">
            <span style="font-size:9px; color:rgba(235,245,225,0.6);">VERTICES</span>
            <b id="specVertCount" style="color:#38bdf8; font-size:12.5px;">--</b>
          </div>
          <div class="prev-spec-box">
            <span style="font-size:9px; color:rgba(235,245,225,0.6);">TEXTURES</span>
            <b id="specTexCount" style="color:#fbbf24; font-size:12.5px;">--</b>
          </div>
        </div>

        <!-- Presets Bar -->
        <div style="margin-bottom:12px;">
          <div style="font-size:10px; font-weight:bold; color:rgba(235,245,225,0.85); margin-bottom:5px;">⚡ QUICK OPTIMIZATION PRESETS:</div>
          <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:5px;">
            <button class="opt-preset-btn active" data-preset="quest">🥽 Quest / Ultra-Light (10%)</button>
            <button class="opt-preset-btn" data-preset="balanced">⚖️ Balanced (45%)</button>
            <button class="opt-preset-btn" data-preset="high">💎 High Detail (75%)</button>
            <button class="opt-preset-btn" data-preset="original">📦 Keep Original (100%)</button>
          </div>
        </div>

        <!-- Geometry Meshopt Controls -->
        <div class="prev-section-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:bold; color:#7ef088; font-size:11px;">📐 MESHOPT SIMPLIFICATION</span>
            <span id="simplifyRatioVal" style="color:#7ef088; font-weight:bold;">10%</span>
          </div>
          <input id="simplifyRatioSlider" type="range" min="5" max="100" step="5" value="10" class="ctrl-slider" style="accent-color:#7ef088;">
          <div style="display:flex; justify-content:space-between; font-size:9.5px; color:rgba(235,245,225,0.6); margin-top:2px;">
            <span>Target Triangles: <b id="targetTrisVal" style="color:#fff;">--</b></span>
            <span>Error: <b>0.02</b></span>
          </div>
          <label style="display:flex; align-items:center; gap:6px; font-size:10px; color:rgba(235,245,225,0.8); margin-top:6px; cursor:pointer;">
            <input id="recomputeNormalsCheck" type="checkbox"> Recompute smooth vertex normals
          </label>
        </div>

        <!-- Texture Compression Controls -->
        <div class="prev-section-card" style="margin-top:8px;">
          <span style="font-weight:bold; color:#38bdf8; font-size:11px; display:block; margin-bottom:6px;">🖼️ TEXTURE COMPRESSION</span>
          
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <label style="font-size:10px; color:rgba(235,245,225,0.8);">
              Max Resolution:
              <select id="maxTexResSelect" class="prev-select">
                <option value="256">256 px (Ultra Light)</option>
                <option value="512" selected>512 px (Mobile VR / Web)</option>
                <option value="1024">1024 px (Recommended)</option>
                <option value="2048">2048 px (High Res)</option>
                <option value="Infinity">Original</option>
              </select>
            </label>

            <label style="font-size:10px; color:rgba(235,245,225,0.8);">
              Format:
              <select id="texFormatSelect" class="prev-select">
                <option value="webp" selected>WebP (Best Ratio)</option>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG (Original)</option>
              </select>
            </label>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
            <span style="font-size:10px; color:rgba(235,245,225,0.8);">Texture Quality</span>
            <span id="texQualityVal" style="font-size:10px; font-weight:bold; color:#ffd57e;">75%</span>
          </div>
          <input id="texQualitySlider" type="range" min="30" max="95" step="5" value="75" class="ctrl-slider" style="accent-color:#ffd57e;">

          <label style="display:flex; align-items:center; gap:6px; font-size:10px; color:rgba(235,245,225,0.8); margin-top:6px; cursor:pointer;">
            <input id="stripNormalCheck" type="checkbox"> Drop normal maps for flat/stylized look
          </label>
        </div>

        <!-- Live Size Estimation Card -->
        <div style="margin-top:10px; background:linear-gradient(135deg, rgba(16, 40, 24, 0.75), rgba(12, 28, 38, 0.75)); border:1px solid rgba(126,240,136,0.35); border-radius:12px; padding:10px 12px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:10.5px; color:rgba(235,245,225,0.7);">ESTIMATED SIZE AFTER COMPRESSION:</span>
            <b id="estSavingsPercent" style="color:#7ef088; font-size:12px; background:rgba(126,240,136,0.25); padding:1px 6px; border-radius:8px;">-95.2%</b>
          </div>
          <div style="display:flex; align-items:baseline; gap:8px; margin-top:4px;">
            <span id="estCompressedSize" style="font-size:20px; font-weight:bold; color:#7ef088;">~4.2 MB</span>
            <span id="origSizeCrossed" style="font-size:11.5px; color:rgba(235,245,225,0.5); text-decoration:line-through;">93.2 MB</span>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:6px; font-size:9.5px; color:rgba(235,245,225,0.7); border-top:1px solid rgba(255,255,255,0.1); padding-top:6px;">
            <div>📐 Geometry: <b id="estGeoSize" style="color:#fff;">~4.5 MB</b></div>
            <div>🖼️ Textures: <b id="estTexSize" style="color:#fff;">~1.1 MB</b></div>
            <div>⚡ GPU VRAM: <b id="estVramSize" style="color:#38bdf8;">~12 MB</b> (was <span id="origVramSize">148 MB</span>)</div>
            <div>💾 Disk Savings: <b id="estDiskSavings" style="color:#ffd57e;">-89 MB</b></div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:14px;">
          <button id="applyPreviewOptBtn" class="action-btn" style="padding:7px; font-size:11.5px; font-weight:bold; background:linear-gradient(135deg, rgba(56, 189, 248, 0.5), rgba(126, 240, 136, 0.5)); border-color:#7ef088;">
            ⚡ Preview Optimization in 3D
          </button>
          
          <div style="display:flex; gap:6px;">
            <button id="loadToWorldBtn" class="action-btn" style="flex:1; padding:7px; font-size:11.5px; font-weight:bold; background:rgba(30, 140, 75, 0.6); border-color:#4ca03e;">
              🚀 Load into Forest Scene
            </button>
            <button id="downloadGlbBtn" class="action-btn" style="flex:1; padding:7px; font-size:11px; background:rgba(255, 255, 255, 0.15);" title="Download compressed .glb file">
              💾 Export .GLB
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Inject modal CSS
  const style = document.createElement('style');
  style.textContent = `
    .prev-toolbar-btn {
      cursor: pointer;
      background: rgba(10, 16, 12, 0.82);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #eaf2df;
      padding: 3px 8px;
      border-radius: 8px;
      font: 10.5px monospace;
      backdrop-filter: blur(8px);
      transition: all 0.15s;
    }
    .prev-toolbar-btn:hover { background: rgba(255, 255, 255, 0.25); color: #fff; }
    .prev-toolbar-btn.active { background: rgba(126, 240, 136, 0.35); border-color: #7ef088; color: #fff; }
    
    .prev-spec-box {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 6px 8px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    
    .opt-preset-btn {
      cursor: pointer;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #eaf2df;
      padding: 5px 6px;
      border-radius: 8px;
      font: 10px monospace;
      text-align: center;
      transition: all 0.15s;
    }
    .opt-preset-btn:hover { background: rgba(255, 255, 255, 0.2); color: #fff; }
    .opt-preset-btn.active {
      background: rgba(126, 240, 136, 0.3);
      border-color: #7ef088;
      color: #fff;
      font-weight: bold;
    }
    
    .prev-section-card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      padding: 8px 10px;
    }
    
    .prev-select {
      width: 100%;
      background: rgba(10, 16, 12, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #eaf2df;
      font: 10.5px monospace;
      padding: 3px 4px;
      border-radius: 6px;
      margin-top: 3px;
      outline: none;
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(_modalEl);

  _bindModalEvents();
}

function _initThreePreview() {
  const container = _modalEl.querySelector('#previewCanvasContainer');
  if (!container || _previewRenderer) return;

  const w = container.clientWidth || 600;
  const h = container.clientHeight || 700;

  _previewScene = new THREE.Scene();
  _previewScene.background = new THREE.Color(0x0c130e);

  _previewCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  _previewCamera.position.set(3, 2.5, 4);

  _previewRenderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  _previewRenderer.setSize(w, h);
  _previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  _previewRenderer.toneMappingExposure = 1.1;
  container.appendChild(_previewRenderer.domElement);

  _previewControls = new OrbitControls(_previewCamera, _previewRenderer.domElement);
  _previewControls.enableDamping = true;
  _previewControls.dampingFactor = 0.08;
  _previewControls.autoRotate = true;
  _previewControls.autoRotateSpeed = 1.2;
  _previewControls.screenSpacePanning = true;
  _previewControls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE
  };
  let _isPreviewMiddleDown = false;
  let _wasAutoRotateBeforePan = false;
  _previewRenderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      _isPreviewMiddleDown = true;
      _previewControls.enableRotate = false;
      _previewControls.enablePan = true;
      if (_previewControls.autoRotate) {
        _wasAutoRotateBeforePan = true;
        _previewControls.autoRotate = false;
      }
      try {
        Object.defineProperty(e, 'shiftKey', { get: () => false, configurable: true });
        Object.defineProperty(e, 'ctrlKey', { get: () => false, configurable: true });
        Object.defineProperty(e, 'metaKey', { get: () => false, configurable: true });
        Object.defineProperty(e, 'altKey', { get: () => false, configurable: true });
      } catch (_) {}
    }
  }, { capture: true });

  window.addEventListener('pointerup', (e) => {
    if (e.button === 1 || _isPreviewMiddleDown) {
      _isPreviewMiddleDown = false;
      _previewControls.enableRotate = true;
      if (_wasAutoRotateBeforePan && _autoRotate) {
        _previewControls.autoRotate = true;
        _wasAutoRotateBeforePan = false;
      }
    }
  }, { capture: true });

  _previewRenderer.domElement.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  // Studio Lighting
  const ambLight = new THREE.AmbientLight(0xffffff, 0.85);
  _previewScene.add(ambLight);

  const dirLight = new THREE.DirectionalLight(0xfff5e6, 1.6);
  dirLight.position.set(5, 10, 7);
  _previewScene.add(dirLight);

  const rimLight = new THREE.DirectionalLight(0x7ef088, 0.6);
  rimLight.position.set(-6, -2, -6);
  _previewScene.add(rimLight);

  // Subtle Ground Grid
  _previewGrid = new THREE.GridHelper(10, 20, 0x7ef088, 0x1f3826);
  _previewGrid.position.y = -0.01;
  _previewScene.add(_previewGrid);

  // Render loop
  function tick() {
    _animId = requestAnimationFrame(tick);
    _previewControls.update();
    _previewRenderer.render(_previewScene, _previewCamera);
  }
  tick();

  // Resize handler
  window.addEventListener('resize', () => {
    if (!_modalEl || _modalEl.style.display === 'none') return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw > 0 && ch > 0) {
      _previewCamera.aspect = cw / ch;
      _previewCamera.updateProjectionMatrix();
      _previewRenderer.setSize(cw, ch);
    }
  });
}

function _bindModalEvents() {
  _modalEl.querySelector('#closePreviewBtn').addEventListener('click', closeModelPreviewModal);

  // Toolbar
  const rotBtn = _modalEl.querySelector('#prevRotateBtn');
  rotBtn.addEventListener('click', () => {
    _autoRotate = !_autoRotate;
    _previewControls.autoRotate = _autoRotate;
    rotBtn.classList.toggle('active', _autoRotate);
  });

  const wireBtn = _modalEl.querySelector('#prevWireframeBtn');
  wireBtn.addEventListener('click', () => {
    _wireframeActive = !_wireframeActive;
    wireBtn.classList.toggle('active', _wireframeActive);
    _applyWireframe(_wireframeActive);
  });

  _modalEl.querySelector('#prevResetCamBtn').addEventListener('click', () => {
    const activeModel = _showingOptimized ? _currentOptimizedModel : _currentRawModel;
    if (activeModel) _frameModel(activeModel);
  });

  const compBtn = _modalEl.querySelector('#prevCompareBtn');
  compBtn.addEventListener('click', () => {
    if (!_currentOptimizedModel || !_currentRawModel) return;
    _showingOptimized = !_showingOptimized;
    _previewScene.remove(_showingOptimized ? _currentRawModel : _currentOptimizedModel);
    _previewScene.add(_showingOptimized ? _currentOptimizedModel : _currentRawModel);
    compBtn.textContent = _showingOptimized ? '👁️ View: Optimized' : '👁️ View: Original';
    compBtn.style.background = _showingOptimized ? 'rgba(126,240,136,0.35)' : 'rgba(255,255,255,0.2)';
    _applyWireframe(_wireframeActive);
  });

  // Presets
  _modalEl.querySelectorAll('.opt-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _modalEl.querySelectorAll('.opt-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const p = btn.dataset.preset;
      _applyPreset(p);
      _updateLiveEstimation();
    });
  });

  // Sliders & inputs
  const ratioSlider = _modalEl.querySelector('#simplifyRatioSlider');
  ratioSlider.addEventListener('input', (e) => {
    _optSettings.simplifyRatio = Number(e.target.value) / 100;
    _modalEl.querySelector('#simplifyRatioVal').textContent = `${e.target.value}%`;
    _updateLiveEstimation();
  });

  _modalEl.querySelector('#recomputeNormalsCheck').addEventListener('change', (e) => {
    _optSettings.recomputeNormals = e.target.checked;
  });

  _modalEl.querySelector('#maxTexResSelect').addEventListener('change', (e) => {
    _optSettings.maxTextureRes = Number(e.target.value);
    _updateLiveEstimation();
  });

  _modalEl.querySelector('#texFormatSelect').addEventListener('change', (e) => {
    _optSettings.textureFormat = e.target.value;
    _updateLiveEstimation();
  });

  const qSlider = _modalEl.querySelector('#texQualitySlider');
  qSlider.addEventListener('input', (e) => {
    _optSettings.textureQuality = Number(e.target.value) / 100;
    _modalEl.querySelector('#texQualityVal').textContent = `${e.target.value}%`;
    _updateLiveEstimation();
  });

  _modalEl.querySelector('#stripNormalCheck').addEventListener('change', (e) => {
    _optSettings.stripNormalMap = e.target.checked;
    _updateLiveEstimation();
  });

  // Preview Optimization button
  _modalEl.querySelector('#applyPreviewOptBtn').addEventListener('click', async () => {
    await _runOptimizationPreview();
  });
}

function _applyPreset(presetKey) {
  const ratioSlider = _modalEl.querySelector('#simplifyRatioSlider');
  const maxTex = _modalEl.querySelector('#maxTexResSelect');
  const format = _modalEl.querySelector('#texFormatSelect');
  const qSlider = _modalEl.querySelector('#texQualitySlider');

  if (presetKey === 'quest') {
    _optSettings.simplifyRatio = 0.10;
    _optSettings.maxTextureRes = 512;
    _optSettings.textureFormat = 'webp';
    _optSettings.textureQuality = 0.75;
  } else if (presetKey === 'balanced') {
    _optSettings.simplifyRatio = 0.45;
    _optSettings.maxTextureRes = 1024;
    _optSettings.textureFormat = 'webp';
    _optSettings.textureQuality = 0.82;
  } else if (presetKey === 'high') {
    _optSettings.simplifyRatio = 0.75;
    _optSettings.maxTextureRes = 2048;
    _optSettings.textureFormat = 'webp';
    _optSettings.textureQuality = 0.90;
  } else if (presetKey === 'original') {
    _optSettings.simplifyRatio = 1.0;
    _optSettings.maxTextureRes = Infinity;
    _optSettings.textureFormat = 'png';
    _optSettings.textureQuality = 0.95;
  }

  ratioSlider.value = Math.round(_optSettings.simplifyRatio * 100);
  _modalEl.querySelector('#simplifyRatioVal').textContent = `${ratioSlider.value}%`;
  maxTex.value = String(_optSettings.maxTextureRes);
  format.value = _optSettings.textureFormat;
  qSlider.value = Math.round(_optSettings.textureQuality * 100);
  _modalEl.querySelector('#texQualityVal').textContent = `${qSlider.value}%`;
}

async function _loadModelIntoPreview(asset, onLoadToWorldCallback) {
  const overlay = _modalEl.querySelector('#previewLoadingOverlay');
  const pBar = _modalEl.querySelector('#previewProgressBar');
  const pStatus = _modalEl.querySelector('#previewLoadingStatus');
  const pTitle = _modalEl.querySelector('#previewLoadingTitle');
  const compBtn = _modalEl.querySelector('#prevCompareBtn');

  overlay.style.display = 'flex';
  pBar.style.width = '0%';
  pTitle.textContent = `Loading ${asset.name}...`;
  pStatus.textContent = `Reading GLB (0 MB / ${asset.sizeMB || '...'} MB)`;
  compBtn.style.display = 'none';

  // Clear previous models
  if (_currentRawModel && _previewScene) _previewScene.remove(_currentRawModel);
  if (_currentOptimizedModel && _previewScene) _previewScene.remove(_currentOptimizedModel);
  _currentRawModel = null;
  _currentOptimizedModel = null;

  _modalEl.querySelector('#prevPropName').textContent = asset.name;
  _modalEl.querySelector('#prevPropCategory').textContent = asset.category || 'Prop';
  _modalEl.querySelector('#prevPropFileSize').textContent = `Original File Size: ${asset.sizeMB || '--'} MB`;

  const loader = new GLTFLoader();
  const url = asset.url;

  try {
    const gltf = await new Promise((resolve, reject) => {
      loader.load(
        url,
        resolve,
        (xhr) => {
          const loadedMB = (xhr.loaded / 1024 / 1024).toFixed(1);
          const totalMB = asset.sizeBytes ? (asset.sizeBytes / 1024 / 1024).toFixed(1) : (xhr.total ? (xhr.total / 1024 / 1024).toFixed(1) : '--');
          const pct = asset.sizeBytes ? Math.min(100, Math.round((xhr.loaded / asset.sizeBytes) * 100)) : (xhr.lengthComputable ? Math.round((xhr.loaded / xhr.total) * 100) : 50);
          pBar.style.width = `${pct}%`;
          pStatus.textContent = `${loadedMB} MB / ${totalMB} MB (${pct}%)`;
        },
        reject
      );
    });

    _currentRawModel = gltf.scene;

    // Analyze model
    _currentAnalysis = analyzeModel(_currentRawModel, asset.sizeBytes || 0);

    // Populate spec chips
    _modalEl.querySelector('#specTriCount').textContent = _currentAnalysis.triangles.toLocaleString();
    _modalEl.querySelector('#specVertCount').textContent = _currentAnalysis.vertices.toLocaleString();
    _modalEl.querySelector('#specTexCount').textContent = `${_currentAnalysis.textures.length} Maps`;
    _modalEl.querySelector('#origSizeCrossed').textContent = `${_currentAnalysis.fileSizeMB} MB`;

    // Center bottom pivot
    _centerModel(_currentRawModel);
    _previewScene.add(_currentRawModel);
    _frameModel(_currentRawModel);

    _updateLiveEstimation();
    overlay.style.display = 'none';

    // Hook Load into Forest Scene button
    const loadBtn = _modalEl.querySelector('#loadToWorldBtn');
    loadBtn.onclick = () => {
      const modelToLoad = _currentOptimizedModel || _currentRawModel;
      registerGlbAsset(asset.name, modelToLoad);
      closeModelPreviewModal();
      if (onLoadToWorldCallback) {
        onLoadToWorldCallback(asset.name, modelToLoad);
      }
      showNotification(`Loaded ${asset.name} into World! Left-Click terrain to place.`, 'success', 3000);
    };

    // Hook Download GLB button
    const dlBtn = _modalEl.querySelector('#downloadGlbBtn');
    dlBtn.onclick = async () => {
      const modelToExport = _currentOptimizedModel || _currentRawModel;
      showNotification('Exporting GLB binary...', 'info', 2000);
      try {
        const exporter = new GLTFExporter();
        exporter.parse(
          modelToExport,
          (buffer) => {
            const blob = new Blob([buffer], { type: 'model/gltf-binary' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `optimized_${asset.filename || (asset.name + '.glb')}`;
            link.click();
            URL.revokeObjectURL(link.href);
            showNotification('GLB downloaded successfully!', 'success', 2500);
          },
          (err) => {
            console.error('Export error:', err);
            showNotification('Export failed: ' + err.message, 'error', 2500);
          },
          { binary: true }
        );
      } catch (e) {
        console.error('GLTFExporter failed:', e);
      }
    };

  } catch (err) {
    console.error('Failed to load preview GLB:', err);
    pTitle.textContent = 'Failed to load GLB';
    pStatus.textContent = err.message || 'Network / parsing error';
  }
}

function _updateLiveEstimation() {
  if (!_currentAnalysis) return;
  const est = estimateOptimizedSize(_currentAnalysis, _optSettings);

  _modalEl.querySelector('#targetTrisVal').textContent = `${est.estTris.toLocaleString()} tris`;
  _modalEl.querySelector('#estSavingsPercent').textContent = `-${est.savingsPercent}%`;
  _modalEl.querySelector('#estCompressedSize').textContent = `~${est.estTotalMB} MB`;
  _modalEl.querySelector('#estGeoSize').textContent = `~${est.estGeoMB} MB`;
  _modalEl.querySelector('#estTexSize').textContent = `~${est.estTexMB} MB`;
  _modalEl.querySelector('#estVramSize').textContent = `~${est.estVramMB} MB`;
  _modalEl.querySelector('#origVramSize').textContent = `${est.origVramMB} MB`;
  _modalEl.querySelector('#estDiskSavings').textContent = `-${est.savingsMB} MB`;
}

async function _runOptimizationPreview() {
  if (!_currentRawModel) return;

  const btn = _modalEl.querySelector('#applyPreviewOptBtn');
  const compBtn = _modalEl.querySelector('#prevCompareBtn');
  btn.textContent = '⏳ Decimating geometry & compressing textures...';
  btn.style.pointerEvents = 'none';

  try {
    await ensureSimplifier();

    if (_currentOptimizedModel) {
      _previewScene.remove(_currentOptimizedModel);
    }

    _currentOptimizedModel = await optimizeModel(_currentRawModel, _optSettings);
    _centerModel(_currentOptimizedModel);

    // Switch view to optimized model
    _previewScene.remove(_currentRawModel);
    _previewScene.add(_currentOptimizedModel);
    _showingOptimized = true;

    _applyWireframe(_wireframeActive);

    // Show compare button
    compBtn.style.display = 'block';
    compBtn.textContent = '👁️ View: Optimized';
    compBtn.style.background = 'rgba(126,240,136,0.35)';

    const optAnalysis = analyzeModel(_currentOptimizedModel);
    showNotification(`⚡ Optimized: ${optAnalysis.triangles.toLocaleString()} tris (from ${_currentAnalysis.triangles.toLocaleString()})`, 'success', 3000);

  } catch (err) {
    console.error('Optimization error:', err);
    showNotification('Optimization error: ' + err.message, 'error', 3000);
  } finally {
    btn.textContent = '⚡ Preview Optimization in 3D';
    btn.style.pointerEvents = 'auto';
  }
}

function _centerModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  model.position.y += (box.max.y - box.min.y) * 0.5;
}

function _frameModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim * 2.2;

  _previewCamera.position.set(dist * 0.8, dist * 0.6, dist * 0.9);
  _previewControls.target.set(0, size.y * 0.5, 0);
  _previewControls.update();
}

function _applyWireframe(enabled) {
  const activeModel = _showingOptimized ? _currentOptimizedModel : _currentRawModel;
  if (!activeModel) return;

  activeModel.traverse((node) => {
    if (node.isMesh && node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        m.wireframe = enabled;
      }
    }
  });
}

export function closeModelPreviewModal() {
  if (_modalEl) {
    _modalEl.style.display = 'none';
  }
}
