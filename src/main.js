import * as THREE from 'three';
import { windUniforms } from './wind.js';
import { setupEnvironment, hookAtmosphericFogToScene } from './environment.js';
import { createGround } from './terrain.js';
import { createWater, waterUniforms } from './water.js';
import { createMountain } from './mountain.js';
import { buildTrees, setTreeColors, placeTreeAt, removeTreeAt, sampleTreeCluster, eraseTreesInRadius, applyTreePreset, TREE_PRESETS } from './trees.js';
import { buildGrass, updateGrass, setGrassHeightScale } from './grass.js';
import { buildRocks } from './rocks.js';
import { createFireflies } from './fireflies.js';
import { setupStats } from './stats.js';
import { setupPostProcessing } from './postfx.js';
import { setupControls } from './controls.js';
import { setupVR } from './vr.js';
import { setGroundBlendIntensity } from './groundBlend.js';
import { setupTerrainEditor } from './terrainEditor.js';
import { loadGlbFile, listGlbAssets, selectGlbAsset, getSelectedGlbAsset, glbSettings, placeGlbAt, getGlbData, applyGlbData } from './glbAssets.js';
import { saveLevel, loadLevel, loadLevelFromBlob, buildLevelJson, saveLevelToStorage, loadLevelFromStorage, showNotification } from './levelIO.js';
import { setupTransformManager, selectObject } from './transformManager.js';
import { setupAssetBrowser, toggleAssetBrowser } from './assetBrowser.js';
import { getAssetById } from './assetCatalog.js';
import { openModelPreviewModal } from './modelPreviewModal.js';
import { buildWhisperingValley, upgradeValleyPrototypesToMesh, updateFarmstead, removeWhisperingValley } from './whisperingValleyScene.js';
import { VRMCharacterController } from './vrmController.js';
import { toggleOutline, setOutlineEnabled, setOutlineMode, getOutlineMode, cycleOutlineMode, attachOutlinesToScene } from './outlineEffect.js';

window.setGrassHeightScale = setGrassHeightScale;
window.setOutlineMode = (mode) => setOutlineMode(scene, mode);
window.getOutlineMode = () => getOutlineMode();
window.toggleOutline = (modeOrBool) => {
  if (typeof modeOrBool === 'string') return setOutlineMode(scene, modeOrBool);
  if (typeof modeOrBool === 'boolean') return setOutlineEnabled(scene, modeOrBool);
  return cycleOutlineMode(scene);
};

/* ---------------------------------------------------------- renderer & scene */
const app = document.getElementById('app');
// Manually build a WebGL2 context with antialias off so Three.js can bind OVR_multiview2 in XR
const canvas = document.createElement('canvas');
const glContext = canvas.getContext('webgl2', { antialias: true });
const renderer = new THREE.WebGLRenderer({ canvas, context: glContext, powerPreference: 'high-performance' });
renderer.setPixelRatio(1.5);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.xr.setFoveation(1); // Max fixed foveated rendering for Quest 2 (72-90 FPS target)

// Debug overdraw visualisation (toggle 'O' or in VR UI): every fragment adds a fixed amount into the cleared black buffer — brightness = layer count
const _overdrawMat = new THREE.MeshBasicMaterial({ color: 0x242424, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
let overdrawDebug = false;
const _overdrawHud = document.createElement('div');
Object.assign(_overdrawHud.style, { position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)', padding: '6px 12px', background: 'rgba(0,0,0,0.55)', color: '#7fd4ff', font: '12px monospace', borderRadius: '6px', display: 'none', zIndex: '10000', pointerEvents: 'none' });
_overdrawHud.textContent = 'OVERDRAW DEBUG — press O to toggle';
document.body.appendChild(_overdrawHud);
app.appendChild(renderer.domElement);

window.toggleOverdraw = () => {
  overdrawDebug = !overdrawDebug;
  _overdrawHud.style.display = overdrawDebug ? 'block' : 'none';
  return overdrawDebug;
};
window.isOverdrawActive = () => overdrawDebug;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 600);
camera.position.set(21, 5.5, 25);

const clock = new THREE.Clock();
window.THREE = THREE;
window.scene = scene;
window.camera = camera;
window.renderer = renderer;
window.clock = clock;

/* ---------------------------------------------------------- world modules */
const { updateEnvironment, envConfig } = setupEnvironment(scene);
createGround(scene);
const { updateWater } = createWater(scene);
createMountain(scene);
buildTrees(scene);
buildGrass(scene);
buildRocks(scene);
const { updateFireflies } = createFireflies(scene);
hookAtmosphericFogToScene(scene);

/* ---------------------------------------------------------- terrain level editor */
const placeGlbWithSelection = (p) => {
  const clone = placeGlbAt(p);
  if (clone) selectObject(clone);
  return clone;
};
const terrainEditor = setupTerrainEditor(scene, camera, renderer.domElement, { placeAt: placeGlbWithSelection });
window.terrainEditor = terrainEditor;

/* ---------------------------------------------------------- triangle stats tracker */
const { updateUI: updateTriStats } = setupStats(scene, renderer);

/* ---------------------------------------------------------- post-processing */
const { composer, isPostProcessingActive, togglePostProcessing } = setupPostProcessing(renderer, scene, camera);

/* ---------------------------------------------------------- controls, VR & gizmos */
const { controls, player, isWalkMode, updatePlayer } = setupControls(camera, renderer.domElement, togglePostProcessing);
const _glbApi = { getGlbData, applyGlbData };
const transformManager = setupTransformManager(scene, camera, renderer.domElement, controls);
window.transformManager = transformManager;
window.selectObject = selectObject;

// Edit Mode Toggle: enables clicking/scaling/rotating/moving all models (props, bridges, houses)
const editModeBtn = document.getElementById('editModeToggleBtn');
function _syncEditModeUI() {
  if (!editModeBtn) return;
  const on = transformManager.getEditMode?.() ?? false;
  editModeBtn.innerHTML = on ? '<span>✋</span> Edit: ON' : '<span>✋</span> Edit: OFF';
  editModeBtn.style.background = on ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255, 255, 255, 0.12)';
  editModeBtn.style.borderColor = on ? '#38bdf8' : 'rgba(255, 255, 255, 0.22)';
  editModeBtn.style.color = on ? '#fff' : 'rgba(235, 245, 225, 0.7)';
}
editModeBtn?.addEventListener('click', () => {
  transformManager.setEditMode(!transformManager.getEditMode());
  _syncEditModeUI();
});
_syncEditModeUI();

// Cel Outline Toggle (No Post-Processing Inverted Hull - Off by default)
document.getElementById('outlineBtn')?.addEventListener('click', () => toggleOutline(scene));
document.getElementById('sideOutlineBtn')?.addEventListener('click', () => toggleOutline(scene));

const vrManager = setupVR(renderer, scene, camera, player, isWalkMode, controls, {
  editorState: terrainEditor.editorState,
  setBrush: terrainEditor.setBrush,
  applyBrushAt: terrainEditor.applyBrushAt,
  placeTreeAt,
  placeGlbAt: placeGlbWithSelection,
  save: () => saveLevel(_glbApi)
});
const { cameraRig, updateVR, recordFps, toggleVRCanvasUI } = vrManager;

// In-VR Canvas UI Toggle (Off by default for clean view & maximum Quest performance)
document.getElementById('vrCanvasUIBtn')?.addEventListener('click', () => toggleVRCanvasUI());
document.getElementById('sideVrCanvasUIBtn')?.addEventListener('click', () => toggleVRCanvasUI());

window.vrManager = vrManager;
window.player = player;
window.controls = controls;
window.cameraRig = cameraRig;

/* ---------------------------------------------------------- VRM Character Controller */
const vrmController = new VRMCharacterController(scene, camera, renderer, cameraRig);
window.vrmController = vrmController;

// Auto-load high quality VRoid Avatar
vrmController.loadVRM();

// Avatar Model Switcher Buttons
const btnAlicia = document.getElementById('avatarAliciaBtn');
const btnSampleB = document.getElementById('avatarSampleBBtn');
const btnSeedSan = document.getElementById('avatarSeedSanBtn');
const btnCustomVrm = document.getElementById('customVrmBtn');

btnAlicia?.addEventListener('click', () => vrmController.selectAvatar('alicia'));
btnSampleB?.addEventListener('click', () => vrmController.selectAvatar('avatar_b'));
btnSeedSan?.addEventListener('click', () => vrmController.selectAvatar('seed_san'));
btnCustomVrm?.addEventListener('click', () => document.getElementById('vrmFileInput')?.click());

window.addEventListener('vrmAvatarChanged', (e) => {
  const { avatarId, avatarName, stats } = e.detail;
  btnAlicia?.classList.toggle('active', avatarId === 'alicia');
  btnSampleB?.classList.toggle('active', avatarId === 'avatar_b');
  btnSeedSan?.classList.toggle('active', avatarId === 'seed_san');

  const statsBadge = document.getElementById('vrmCompressionStatsBadge');
  if (statsBadge) {
    if (stats) {
      statsBadge.style.display = 'block';
      statsBadge.textContent = `⚡ ${avatarName}: ${stats.origSizeMB}MB → ${stats.newSizeMB}MB (Saved ${stats.savingsPercent}%)`;
    } else {
      statsBadge.style.display = 'none';
    }
  }
});

// Hook Ground Blend Slider
const groundBlendSlider = document.getElementById('groundBlendSlider');
if (groundBlendSlider) {
  groundBlendSlider.addEventListener('input', (e) => {
    setGroundBlendIntensity(Number(e.target.value));
  });
}

// Hook Dynamic Water Shoreline Fade & Foam Sliders
const waterFadeSlider = document.getElementById('waterFadeSlider');
if (waterFadeSlider) {
  waterFadeSlider.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    waterUniforms.uShoreFadeDist.value = val;
    const txt = document.getElementById('waterFadeVal');
    if (txt) txt.textContent = `${val.toFixed(2)}m`;
  });
}

const waterFoamSlider = document.getElementById('waterFoamSlider');
if (waterFoamSlider) {
  waterFoamSlider.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    waterUniforms.uShoreFoamWidth.value = val;
    const txt = document.getElementById('waterFoamVal');
    if (txt) txt.textContent = `${val.toFixed(2)}m`;
  });
}

window.waterUniforms = waterUniforms;

// Hook Day/Night Time Controls
const timeOfDaySlider = document.getElementById('timeOfDaySlider');
if (timeOfDaySlider) {
  timeOfDaySlider.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    envConfig.timeOfDay = val > 1.0 ? val / 100 : val;
    envConfig.autoCycle = false; // Pause while scrubbing
    updateEnvironment(clock.getElapsedTime(), 0);
    renderer.render(scene, camera);
  });
  timeOfDaySlider.addEventListener('pointerdown', () => { envConfig.autoCycle = false; });
}

const timeCycleBtn = document.getElementById('timeCycleBtn');
if (timeCycleBtn) {
  timeCycleBtn.addEventListener('click', () => {
    envConfig.autoCycle = !envConfig.autoCycle;
    timeCycleBtn.style.background = envConfig.autoCycle ? 'rgba(255,255,255,0.15)' : 'rgba(230,80,60,0.5)';
  });
}

// Hook Fog Density Slider
const fogDensitySlider = document.getElementById('fogDensitySlider');
if (fogDensitySlider) {
  fogDensitySlider.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    envConfig.fogBaseDensity = val < 0.1 ? val : val * 0.001;
    if (scene.fog) scene.fog.density = envConfig.fogBaseDensity;
    updateEnvironment(clock.getElapsedTime(), 0);
    renderer.render(scene, camera);
  });
}

window.updateEnvironment = (t, dt) => updateEnvironment(t, dt);
/* ---------------------------------------------------------- tree paint colors */
const _treeColorIds = {
  barkBottom: 'treeColorBarkBottom',
  barkTop: 'treeColorBarkTop',
  coniferBottom: 'treeColorLeafBottom',
  coniferTop: 'treeColorLeafTop',
  broadBottom: 'treeColorBroadBottom',
  broadTop: 'treeColorBroadTop'
};

for (const [key, id] of Object.entries(_treeColorIds)) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', (e) => setTreeColors({ [key]: e.target.value }));
}

document.querySelectorAll('.tree-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = btn.dataset.preset;
    if (applyTreePreset(preset)) {
      const p = TREE_PRESETS[preset];
      if (p) {
        for (const [key, id] of Object.entries(_treeColorIds)) {
          const el = document.getElementById(id);
          if (el && p[key]) el.value = p[key];
        }
      }
    }
  });
});

/* ---------------------------------------------------------- GLB assets */
function _refreshGlbList() {
  const listEl = document.getElementById('glbAssetList');
  if (!listEl) return;
  listEl.innerHTML = '';
  for (const name of listGlbAssets()) {
    const wrap = document.createElement('div');
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.margin = '1px';
    wrap.style.background = name === getSelectedGlbAsset() ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255, 255, 255, 0.1)';
    wrap.style.borderRadius = '6px';
    wrap.style.border = name === getSelectedGlbAsset() ? '1px solid #fbbf24' : '1px solid rgba(255, 255, 255, 0.2)';

    const b = document.createElement('button');
    b.className = 'mini-btn';
    b.textContent = name;
    b.style.fontSize = '9.5px';
    b.style.padding = '2px 5px';
    b.style.background = 'none';
    b.style.border = 'none';
    b.addEventListener('click', () => {
      selectGlbAsset(name);
      terrainEditor.setBrush('glb');
      _refreshGlbList();
    });

    const inspBtn = document.createElement('button');
    inspBtn.className = 'mini-btn';
    inspBtn.textContent = '🔍';
    inspBtn.title = 'Preview & Optimize 3D model';
    inspBtn.style.fontSize = '8.5px';
    inspBtn.style.padding = '1px 3px';
    inspBtn.style.background = 'none';
    inspBtn.style.border = 'none';
    inspBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const asset = getAssetById(name.toLowerCase().replace(/\s+/g, '_')) || {
        id: name,
        name: name,
        filename: name + '.glb',
        url: `./AssetsTest/Assets/${encodeURIComponent(name)}.glb`
      };
      openModelPreviewModal(asset, (loadedName) => {
        selectGlbAsset(loadedName);
        terrainEditor.setBrush('glb');
        _refreshGlbList();
      });
    });

    wrap.appendChild(b);
    wrap.appendChild(inspBtn);
    listEl.appendChild(wrap);
  }
}
_refreshGlbList(); // Populate with built-in props immediately!

// Initialize 3D Asset Browser & Optimizer
setupAssetBrowser((assetName) => {
  terrainEditor.setBrush('glb');
  selectGlbAsset(assetName);
  _refreshGlbList();
});

document.getElementById('openAssetBrowserBtn')?.addEventListener('click', toggleAssetBrowser);
document.getElementById('sideOpenAssetBrowserBtn')?.addEventListener('click', toggleAssetBrowser);

const glbFileInput = document.getElementById('glbFileInput');
if (glbFileInput) {
  glbFileInput.addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      try {
        await loadGlbFile(file);
        showNotification(`Loaded GLB: ${file.name}`, 'success');
      } catch (err) {
        console.error('GLB load failed:', file.name, err);
        showNotification(`Failed to load: ${file.name}`, 'error');
      }
    }
    _refreshGlbList();
  });
}
const glbScaleSlider = document.getElementById('glbScaleSlider');
if (glbScaleSlider) glbScaleSlider.addEventListener('input', (e) => {
  glbSettings.scale = Number(e.target.value);
  const v = document.getElementById('glbScaleVal'); if (v) v.textContent = `${glbSettings.scale.toFixed(1)}×`;
});
const glbYawSlider = document.getElementById('glbYawSlider');
if (glbYawSlider) glbYawSlider.addEventListener('input', (e) => {
  glbSettings.yaw = Number(e.target.value) * Math.PI / 180;
  const v = document.getElementById('glbYawVal'); if (v) v.textContent = `${Math.round(Number(e.target.value))}°`;
});

/* ---------------------------------------------------------- save / load level */
document.getElementById('saveLevelBtn')?.addEventListener('click', () => {
  saveLevelToStorage(_glbApi);
  saveLevel(_glbApi);
});
document.getElementById('loadLevelBtn')?.addEventListener('click', () => {
  document.getElementById('levelFileInput')?.click();
});
document.getElementById('quickSaveStorageBtn')?.addEventListener('click', () => {
  saveLevelToStorage(_glbApi);
});
document.getElementById('quickLoadStorageBtn')?.addEventListener('click', () => {
  loadLevelFromStorage(_glbApi);
});
document.getElementById('levelFileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const res = await loadLevelFromBlob(file, _glbApi);
    showNotification(`📂 Level loaded: ${res.trees} trees, ${res.glbs} props`, 'success');
  } catch (err) {
    console.error('[levelIO] load failed:', err);
    showNotification('⚠️ Load failed: invalid file format', 'error');
  }
});

/* ---------------------------------------------------------- custom tree samplers */
document.getElementById('sampleConiferOnlyBtn')?.addEventListener('click', () => {
  rebuildTreesPCG({ treeSet: 'conifer' });
  showNotification('🌲 Re-sampled forest with Conifers only', 'success');
});
document.getElementById('sampleBroadOnlyBtn')?.addEventListener('click', () => {
  rebuildTreesPCG({ treeSet: 'broad' });
  showNotification('🌳 Re-sampled forest with Oaks only', 'success');
});
document.getElementById('eraseTreesBrushBtn')?.addEventListener('click', () => {
  if (window.terrainEditor) {
    window.terrainEditor.editorState.brushType = 'tree_eraser';
    showNotification('🧹 Tree Eraser: Click terrain to erase trees in radius', 'info');
  }
});
document.getElementById('sampleGroveBrushBtn')?.addEventListener('click', () => {
  if (window.terrainEditor) {
    window.terrainEditor.editorState.brushType = 'tree_cluster';
    showNotification('🌸 Grove Sampler: Click terrain to plant a grove of 6 trees', 'info');
  }
});

/* ---------------------------------------------------------- Quest console & window hooks */
window.placeTreeAt = placeTreeAt;
window.removeTreeAt = removeTreeAt;
window.sampleTreeCluster = sampleTreeCluster;
window.eraseTreesInRadius = eraseTreesInRadius;
window.applyTreePreset = applyTreePreset;
window.saveLevel = () => saveLevel(_glbApi);
window.loadLevel = loadLevel;
window.saveLevelToStorage = () => saveLevelToStorage(_glbApi);
window.loadLevelFromStorage = () => loadLevelFromStorage(_glbApi);
window.buildLevelJson = () => buildLevelJson(_glbApi);
window.envConfig = envConfig;

// Hook Whispering Valley Level 1 quick map & model upgrade
const whisperingValleyBtn = document.getElementById('whisperingValleyBtn');
if (whisperingValleyBtn) {
  whisperingValleyBtn.addEventListener('click', async () => {
    await buildWhisperingValley(scene, camera, controls);
    hookAtmosphericFogToScene(scene);
  });
}
const upgradeValleyModelsBtn = document.getElementById('upgradeValleyModelsBtn');
if (upgradeValleyModelsBtn) {
  upgradeValleyModelsBtn.addEventListener('click', async () => {
    await upgradeValleyPrototypesToMesh(scene, camera, controls);
    hookAtmosphericFogToScene(scene);
  });
}
window.buildWhisperingValley = () => buildWhisperingValley(scene, camera, controls);
window.upgradeValleyPrototypesToMesh = () => upgradeValleyPrototypesToMesh(scene, camera, controls);
// Load Level Toggle: ON builds Whispering Valley, OFF removes it entirely from scene
const loadLevelToggleBtn = document.getElementById('loadLevelToggleBtn');
function _setLoadLevel(on) {
  if (on) buildWhisperingValley(scene, camera, controls);
  else removeWhisperingValley(scene);
}
if (loadLevelToggleBtn) {
  loadLevelToggleBtn.addEventListener('click', () => {
    const on = !loadLevelToggleBtn.classList.contains('active-toggle');
    loadLevelToggleBtn.classList.toggle('active-toggle', on);
    loadLevelToggleBtn.textContent = on ? '🎮 Load Level: ON' : '🎮 Load Level: OFF';
    loadLevelToggleBtn.style.borderColor = on ? '#4ade80' : '#f87171';
    _setLoadLevel(on);
  });
}
window.setLoadLevel = _setLoadLevel;

// Auto-build Whispering Valley scene on launch for immediate testing
setTimeout(async () => {
  await buildWhisperingValley(scene, camera, controls);
  hookAtmosphericFogToScene(scene);
}, 600);

// Hook Side Panel Collapsing into Gear Icon & Visibility
const sidePanel = document.getElementById('sideControlsPanel');
const collapseSidePanelBtn = document.getElementById('collapseSidePanelBtn');
const gearToggleBtn = document.getElementById('gearToggleBtn');
const toggleSideBtn = document.getElementById('toggleSideBtn');

function setSidePanelOpen(open) {
  if (!sidePanel) return;
  if (open) {
    sidePanel.classList.remove('collapsed');
    sidePanel.classList.remove('hidden');
    if (gearToggleBtn) gearToggleBtn.style.display = 'none';
  } else {
    sidePanel.classList.add('collapsed');
    if (gearToggleBtn) gearToggleBtn.style.display = 'flex';
  }
}

function toggleSidePanel() {
  const isClosed = sidePanel ? (sidePanel.classList.contains('collapsed') || sidePanel.classList.contains('hidden')) : false;
  setSidePanelOpen(isClosed);
}

gearToggleBtn?.addEventListener('click', () => setSidePanelOpen(true));
collapseSidePanelBtn?.addEventListener('click', () => setSidePanelOpen(false));
toggleSideBtn?.addEventListener('click', toggleSidePanel);

// Shortcut: Tab or E key to toggle editor controls (when not typing in an input)
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === 'Tab' || e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    toggleSidePanel();
  }
  if (e.key === 'o' || e.key === 'O') {
    overdrawDebug = !overdrawDebug;
    _overdrawHud.style.display = overdrawDebug ? 'block' : 'none';
  }
});

/* ---------------------------------------------------------- main loop */
let frame = 0;
const _userPos = new THREE.Vector3();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.getElapsedTime();
  windUniforms.uTime.value = t;
  frame++;

  // Update dynamic Day / Night cycle (Sun, Moon, Stars, drifting Clouds, Fog, Lighting)
  updateEnvironment(t, dt);

  // Sync In-VR / Desktop Env tab with live dynamic cycle
  if (vrManager?.vrUI?.state?.tab === 'env' && frame % 30 === 0 && envConfig.autoCycle) {
    vrManager.vrUI.renderUI();
  }

  // Bake static shadow map on initial frames, then freeze for maximum Quest performance
  if (frame <= 3) {
    renderer.shadowMap.needsUpdate = true;
  }

  // Player locomotion (desktop walk / orbit)
  updatePlayer(dt);

  // VR locomotion & right-hand controller tracking
  updateVR(dt);

  // VRM Character Controller (WASD, VR Thumbsticks, 3-point tracking, IK)
  vrmController.update(dt);

  // Update dynamic grass pool centered around exact world-space user position
  camera.getWorldPosition(_userPos);
  updateGrass(_userPos, t);

  // Animated elements
  updateFireflies(t);
  updateWater(t, frame, renderer);

  // Farmstead dynamic elements (weathervane)
  updateFarmstead(t);

  // Periodic triangle stats refresh
  if (frame % 60 === 0) {
    updateTriStats();
  }

  // FPS calculations
  recordFps();

  // Render dispatch (direct render for WebXR stereoscopic VR, or conditional composer on desktop)
  scene.overrideMaterial = overdrawDebug ? _overdrawMat : null;
  if (renderer.xr.isPresenting || overdrawDebug) {
    renderer.render(scene, camera);
  } else if (isPostProcessingActive()) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

renderer.setAnimationLoop(tick);

/* ---------------------------------------------------------- resize */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
