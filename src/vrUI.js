/**
 * src/vrUI.js
 * Unified Canvas Editor UI for both Desktop and Meta Quest VR.
 * Single source of truth for the entire editor controls:
 * - TAB 1: 📊 Scene Stats & Triangles breakdown
 * - TAB 2: 🗺️ Maps & Level Prototypes (Whispering Valley & Mesh Models)
 * - TAB 3: 👤 VRM Character Controller & Avatar Switcher (Alicia / Avatar B / Inspect / Fly)
 * - TAB 4: 🎨 Terrain Sculpting (Brush ON/OFF, Edit ON/OFF, 12 Brushes, Radius, Strength, PCG, Auto-Trees, Reset)
 * - TAB 5: 📐 Model Transform (Move, Rotate, Scale, Snap to Ground, Clone, Delete)
 * - TAB 6: 📦 3D GLB Props & Asset Spawner (12 Assets, Scale, Yaw, Stamp)
 * - TAB 7: 🌲 Trees & Foliage (5 Seasonal Presets, Conifers, Oaks, Eraser, Grove, PCG Trees)
 * - TAB 8: ☀️ Environment & Atmosphere (Time of Day, Auto Cycle, Fog, Shoreline Fade & Foam)
 * - TAB 9: 🌾 Grass Meadow (Height, Density, Radius, Ground Blend, 5 Blade Tints)
 * - TAB 10: ⚙️ Performance, Cel Outlines & Level Save (Quest FX, Cel Outline Modes, Quick Save/Load)
 *
 * Mindful vertical design (520 x 880):
 * - Runs directly on PC inside #sideControlsPanel with standard mouse / pointer events.
 * - Runs in VR on an interactive 3D tablet plane (0.48m x 0.812m) summonable via Y or B button.
 */
import * as THREE from 'three';
import { editorState } from './terrainEditor.js';
import { applyTreePreset, rebuildTreesPCG, sampleTreeCluster, eraseTreesInRadius, placeTreeAt } from './trees.js';
import { startPlacement, confirmPlacement, placementState } from './assetsManager.js';
import { saveLevelToStorage, loadLevelFromStorage, showNotification } from './levelSerializer.js';

export function createVRUI(scene, cameraRig, envConfig = {}, toggleFlyModeCallback = null, isFlyModeGetter = null) {
  const CANVAS_W = 520;
  const CANVAS_H = 880;

  // Use DOM canvas if present, or create a new one
  let canvas = document.getElementById('unifiedEditorCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'unifiedEditorCanvas';
  }
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  // CanvasTexture for the 3D Tablet Mesh in VR
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  // 3D Tablet Mesh in VR (0.48m x 0.812m portrait slate)
  const panelGeo = new THREE.PlaneGeometry(0.48, 0.812);
  const panelMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: true
  });
  const panelMesh = new THREE.Mesh(panelGeo, panelMat);
  panelMesh.name = 'vr_ui_panel';

  // Tablet border frame backing
  const frameGeo = new THREE.BoxGeometry(0.50, 0.832, 0.015);
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x0a140e,
    metalness: 0.9,
    roughness: 0.25
  });
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.position.z = -0.008;
  panelMesh.add(frameMesh);

  // Initial hidden state for VR tablet (Mounted when pressing Y or B)
  panelMesh.position.set(0, 1.25, -1.15);
  panelMesh.rotation.set(-0.12, 0, 0);
  panelMesh.visible = false;
  scene.add(panelMesh);

  // UI State
  const state = {
    visible: false,
    tab: 'sculpt', // 'stats' | 'maps' | 'avatar' | 'sculpt' | 'transform' | 'props' | 'trees' | 'env' | 'grass' | 'view'
    statusMsg: 'Ready · Click controls or use VR laser',
    cursorPos: new THREE.Vector2(-1, -1),
    isLaserHovered: false
  };

  // Top Tabs (2 rows of 5 pills)
  const tabs = [
    // Row 0
    { id: 'stats',     label: '📊 Stats',  x: 10,  y: 10, w: 96, h: 32 },
    { id: 'maps',      label: '🗺️ Maps',   x: 112, y: 10, w: 96, h: 32 },
    { id: 'avatar',    label: '👤 Avatar', x: 214, y: 10, w: 96, h: 32 },
    { id: 'sculpt',    label: '🎨 Sculpt', x: 316, y: 10, w: 96, h: 32 },
    { id: 'transform', label: '📐 Move',   x: 418, y: 10, w: 92, h: 32 },
    // Row 1
    { id: 'props',     label: '📦 Props',  x: 10,  y: 48, w: 96, h: 32 },
    { id: 'trees',     label: '🌲 Trees',  x: 112, y: 48, w: 96, h: 32 },
    { id: 'env',       label: '☀️ Env',    x: 214, y: 48, w: 96, h: 32 },
    { id: 'grass',     label: '🌾 Grass',  x: 316, y: 48, w: 96, h: 32 },
    { id: 'view',      label: '⚙️ View',   x: 418, y: 48, w: 92, h: 32 }
  ];

  let currentButtons = [];
  let currentSliders = [];
  let activeSlider = null;
  let hoveredBtnId = null;
  let hoveredTabId = null;

  function registerBtn(id, x, y, w, h, label, onClick, isActive = false, color = null, subtext = null) {
    currentButtons.push({ id, x, y, w, h, label, onClick, isActive, color, subtext });
  }

  function registerSlider(id, x, y, w, h, value, min, max, label, onInput, displayVal) {
    currentSliders.push({ id, x, y, w, h, value, min, max, label, onInput, displayVal });

    // Background track bar
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.roundRect(x, y + 24, w, 10, 5);
    ctx.fill();

    // Active fill bar
    const ratio = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
    ctx.fillStyle = '#7ef088';
    ctx.beginPath();
    ctx.roundRect(x, y + 24, Math.max(10, w * ratio), 10, 5);
    ctx.fill();

    // Draggable thumb knob
    const thumbX = x + w * ratio;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(thumbX, y + 29, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4ca03e';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#eaf2df';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y + 16);

    ctx.fillStyle = '#7ef088';
    ctx.textAlign = 'right';
    ctx.fillText(displayVal !== undefined ? displayVal : String(value), x + w, y + 16);
    ctx.textAlign = 'left';
  }

  function drawButton(b) {
    const isHovered = (hoveredBtnId === b.id);
    const bg = b.isActive
      ? 'rgba(76, 160, 62, 0.85)'
      : (isHovered ? 'rgba(255, 255, 255, 0.22)' : (b.color || 'rgba(255, 255, 255, 0.09)'));

    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, 8);
    ctx.fill();

    ctx.strokeStyle = b.isActive ? '#7ef088' : (isHovered ? 'rgba(126, 240, 136, 0.6)' : 'rgba(255, 255, 255, 0.2)');
    ctx.lineWidth = b.isActive ? 2.5 : 1.5;
    ctx.stroke();

    ctx.fillStyle = b.isActive ? '#ffffff' : '#eaf2df';
    ctx.textAlign = 'center';

    if (b.subtext) {
      ctx.font = 'bold 14px monospace';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + 22);
      ctx.fillStyle = b.isActive ? 'rgba(255,255,255,0.85)' : 'rgba(215, 235, 205, 0.65)';
      ctx.font = '11px monospace';
      ctx.fillText(b.subtext, b.x + b.w / 2, b.y + 40);
    } else {
      ctx.font = 'bold 13px monospace';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 5);
    }
    ctx.textAlign = 'left';
  }

  // ---------------------------------------------------------------- TAB RENDERING
  function renderUI() {
    currentButtons = [];
    currentSliders = [];

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Dark frosted obsidian background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    bgGrad.addColorStop(0, '#0c1611');
    bgGrad.addColorStop(0.5, '#070f0b');
    bgGrad.addColorStop(1, '#050a07');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.roundRect(0, 0, CANVAS_W, CANVAS_H, 14);
    ctx.fill();

    // Outer border
    ctx.strokeStyle = 'rgba(126, 240, 136, 0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 1. Draw Top Tab Bar (2 Rows)
    tabs.forEach(t => {
      const isAct = (state.tab === t.id);
      const isHov = (hoveredTabId === t.id);

      ctx.fillStyle = isAct ? 'rgba(76, 160, 62, 0.9)' : (isHov ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)');
      ctx.beginPath();
      ctx.roundRect(t.x, t.y, t.w, t.h, 6);
      ctx.fill();

      ctx.strokeStyle = isAct ? '#7ef088' : (isHov ? 'rgba(126,240,136,0.5)' : 'rgba(255,255,255,0.18)');
      ctx.lineWidth = isAct ? 2 : 1;
      ctx.stroke();

      ctx.fillStyle = isAct ? '#ffffff' : (isHov ? '#7ef088' : '#eaf2df');
      ctx.font = 'bold 11.5px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(t.label, t.x + t.w / 2, t.y + t.h / 2 + 4);
      ctx.textAlign = 'left';
    });

    // Divider line below tab bar
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(10, 88);
    ctx.lineTo(CANVAS_W - 10, 88);
    ctx.stroke();

    // 2. Render Active Tab Content
    switch (state.tab) {
      case 'stats':     renderStatsTab(); break;
      case 'maps':      renderMapsTab(); break;
      case 'avatar':    renderAvatarTab(); break;
      case 'sculpt':    renderSculptTab(); break;
      case 'transform': renderTransformTab(); break;
      case 'props':     renderPropsTab(); break;
      case 'trees':     renderTreesTab(); break;
      case 'env':       renderEnvTab(); break;
      case 'grass':     renderGrassTab(); break;
      case 'view':      renderViewTab(); break;
    }

    // Draw all registered buttons for this tab
    currentButtons.forEach(drawButton);

    // 3. Bottom Status Notification Bar
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(10, CANVAS_H - 52, CANVAS_W - 20, 42, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(126, 240, 136, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#7ef088';
    ctx.beginPath();
    ctx.arc(26, CANVAS_H - 31, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '12px monospace';
    ctx.fillStyle = '#eaf2df';
    const cleanMsg = (state.statusMsg.length > 56) ? state.statusMsg.slice(0, 53) + '...' : state.statusMsg;
    ctx.fillText(cleanMsg, 38, CANVAS_H - 27);

    // Notify Three.js texture to update for VR view
    texture.needsUpdate = true;
  }

  // ---------------------------------------------------------------- TAB 1: STATS
  function renderStatsTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('📊 SCENE STATS & TRIANGLES', 14, 114);

    const totalTris = document.getElementById('statTotalTri')?.textContent || '...';
    const fpsText = document.getElementById('hudFps')?.textContent || '60 FPS';
    const drawCalls = document.getElementById('statDrawCalls')?.textContent || '...';

    // Big Tris Card
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.roundRect(10, 128, CANVAS_W - 20, 78, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(126, 240, 136, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`▲ ${totalTris} TRIS`, 24, 164);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${fpsText} · ${drawCalls} CALLS`, CANVAS_W - 26, 164);
    ctx.textAlign = 'left';

    ctx.fillStyle = 'rgba(235, 245, 225, 0.65)';
    ctx.font = '11px monospace';
    ctx.fillText('TOTAL RENDERED SCENE TRIANGLES', 24, 192);
    const r = window.renderer;
    let mvState = 'OFF';
    if (r) {
      const gl = r.getContext();
      const hasExt = !!(gl.getExtension('OVR_multiview2') || gl.getExtension('OCULUS_multiview'));
      mvState = (hasExt && r.xr.isPresenting) ? 'ACTIVE' : (hasExt ? 'READY' : 'OFF');
    }
    ctx.fillStyle = mvState === 'ACTIVE' ? '#c4b5fd' : mvState === 'READY' ? '#fbbf24' : 'rgba(235, 245, 225, 0.4)';
    ctx.textAlign = 'right';
    ctx.fillText(`👓 MULTIVIEW: ${mvState}`, CANVAS_W - 26, 192);
    ctx.textAlign = 'left';

    // Breakdown list
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.roundRect(10, 218, CANVAS_W - 20, 240, 10);
    ctx.fill();

    ctx.fillStyle = '#eaf2df';
    ctx.font = '13.5px monospace';
    ctx.fillText('Category Breakdown:', 24, 248);

    const chips = [];
    document.querySelectorAll('#triBreakdownChips span').forEach(el => {
      chips.push(el.textContent.trim());
    });

    if (chips.length > 0) {
      chips.forEach((c, idx) => {
        ctx.fillStyle = 'rgba(235, 245, 225, 0.85)';
        ctx.font = '12px monospace';
        ctx.fillText(`• ${c}`, 24, 280 + idx * 26);
      });
    } else {
      ctx.fillStyle = 'rgba(235, 245, 225, 0.7)';
      ctx.font = '12px monospace';
      ctx.fillText('• 🌾 Grass Blades: dynamic GPU instancing', 24, 280);
      ctx.fillText('• 🌲 Trees & Foliage: multi-lod batches', 24, 306);
      ctx.fillText('• 🏞 Terrain: dynamic sculptable heightfield', 24, 332);
      ctx.fillText('• 🌊 Water: Gerstner wave displacement pass', 24, 358);
      ctx.fillText('• 🪨 Rocks: scattered instanced boulders', 24, 384);
      ctx.fillText('• 🏔 Mountain: distant horizon silhouette', 24, 410);
    }

    // Refresh Button
    registerBtn('refresh_stats_btn', 10, 480, CANVAS_W - 20, 46, '🔄 Recalculate Triangle Stats', () => {
      window.updateStatsUI?.();
      state.statusMsg = 'Scene triangle counts updated';
      renderUI();
    }, false, 'rgba(56, 189, 248, 0.35)');
  }

  // ---------------------------------------------------------------- TAB 2: MAPS
  function renderMapsTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('🗺️ MAP & LEVEL PROTOTYPES', 14, 114);

    registerBtn('btn_load_level_vr', 10, 128, CANVAS_W - 20, 60, '🎮 Load Level: ON/OFF', () => {
      document.getElementById('loadLevelToggleBtn')?.click();
      const on = document.getElementById('loadLevelToggleBtn')?.classList.contains('active-toggle');
      state.statusMsg = on ? 'Load Level ON — Whispering Valley loaded' : 'Load Level OFF — valley removed from scene';
      renderUI();
    }, false, 'rgba(74, 222, 128, 0.45)', 'ON: load Whispering Valley scene / OFF: remove it entirely');

    registerBtn('btn_valley_vr', 10, 198, CANVAS_W - 20, 60, '🏔️ Whispering Valley: Level 1', () => {
      document.getElementById('whisperingValleyBtn')?.click();
      state.statusMsg = 'Loaded Whispering Valley: Level 1';
      renderUI();
    }, false, 'rgba(234, 179, 8, 0.45)', 'Load complete river valley, bridge, farmhouse & crops');

    registerBtn('btn_upgrade_vr', 10, 268, CANVAS_W - 20, 60, '🏛️ Load Actual Models (Meshes)', () => {
      document.getElementById('upgradeValleyModelsBtn')?.click();
      state.statusMsg = 'Upgraded prototype boxes to 3D GLB meshes!';
      renderUI();
    }, false, 'rgba(168, 85, 247, 0.45)', 'Replaces prototype boxes with optimized 3D assets');

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.roundRect(10, 340, CANVAS_W - 20, 240, 10);
    ctx.fill();

    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('✨ Whispering Valley Features:', 24, 370);
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(235,245,225,0.85)';
    ctx.fillText('• River channel carved with deep stone embankment', 24, 402);
    ctx.fillText('• Wooden arched river bridge with lampposts', 24, 432);
    ctx.fillText('• Half-timbered cottage with animated weathervane', 24, 462);
    ctx.fillText('• Rotating Dutch windmill on north-western ridge', 24, 492);
    ctx.fillText('• Red torii gate & mystic hilltop stone circle', 24, 522);
    ctx.fillText('• Agricultural wheat crops and wooden fishing pier', 24, 552);
  }

  // ---------------------------------------------------------------- TAB 3: AVATAR
  function renderAvatarTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('👤 CHARACTER & AVATAR MODELS', 14, 112);

    const vrmCtrl = window.vrmController;
    const activeId = vrmCtrl?.activeAvatarId || 'alicia';
    const isCustom = (activeId === 'custom');

    // 1. Model Selection Row (3 Built-in models)
    const btnW = 160;
    registerBtn('btn_av_alicia', 10, 126, btnW, 40, '👧 Alicia Solid', () => {
      vrmCtrl?.selectAvatar('alicia');
      state.statusMsg = 'Loading Alicia Solid...';
      renderUI();
    }, activeId === 'alicia', activeId === 'alicia' ? 'rgba(76, 160, 62, 0.85)' : 'rgba(255, 255, 255, 0.1)');

    registerBtn('btn_av_sampleb', 180, 126, btnW, 40, '🎀 Avatar B', () => {
      vrmCtrl?.selectAvatar('avatar_b');
      state.statusMsg = 'Loading Avatar Sample B...';
      renderUI();
    }, activeId === 'avatar_b', activeId === 'avatar_b' ? 'rgba(76, 160, 62, 0.85)' : 'rgba(255, 255, 255, 0.1)');

    registerBtn('btn_av_seed', 350, 126, btnW, 40, '🤖 Seed-san', () => {
      vrmCtrl?.selectAvatar('seed_san');
      state.statusMsg = 'Loading Seed-san (VRM 1.0)...';
      renderUI();
    }, activeId === 'seed_san', activeId === 'seed_san' ? 'rgba(76, 160, 62, 0.85)' : 'rgba(255, 255, 255, 0.1)');

    // 2. Custom VRM Model Loader
    const customLabel = isCustom ? `📂 Custom: ${vrmCtrl?.customAvatarName || 'Avatar'}` : '📂 Load Custom .VRM Model';
    registerBtn('btn_custom_vrm', 10, 174, CANVAS_W - 20, 44, customLabel, () => {
      document.getElementById('vrmFileInput')?.click();
      state.statusMsg = 'Opening file selector for custom .VRM...';
      renderUI();
    }, isCustom, isCustom ? 'rgba(56, 189, 248, 0.85)' : 'rgba(34, 197, 94, 0.35)', 'Click to select .vrm / .glb, or drag & drop onto window');

    // 3. Pre-Load Compression & Optimization Card
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.roundRect(10, 226, CANVAS_W - 20, 224, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(126, 240, 136, 0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 12.5px monospace';
    ctx.fillText('⚡ PRE-LOAD COMPRESSION & MESHOPT', 22, 248);

    // Live stats readout if available
    const stats = vrmCtrl?.lastOptimizationStats;
    if (stats) {
      ctx.fillStyle = 'rgba(126, 240, 136, 0.15)';
      ctx.beginPath();
      ctx.roundRect(20, 256, CANVAS_W - 40, 28, 6);
      ctx.fill();
      ctx.fillStyle = '#7ef088';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`✨ Saved ${stats.savingsPercent}%: ${stats.origSizeMB}MB → ${stats.newSizeMB}MB (${stats.compressedImagesCount} WebP tex)`, 28, 274);
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.roundRect(20, 256, CANVAS_W - 40, 28, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(235, 245, 225, 0.7)';
      ctx.font = '11px monospace';
      ctx.fillText('💡 Optimizes textures to WebP & strips heavy 2D portrait', 28, 274);
    }

    const comp = vrmCtrl?.compressionConfig || { enabled: true, maxTextureRes: 1024, pruneThumbnail: true, meshoptAccessory: true };

    // Toggle 1: Enable Pre-Compression
    registerBtn('btn_comp_enable', 20, 292, 230, 36, comp.enabled ? '⚡ Pre-Compress: ON' : '⚡ Pre-Compress: OFF', () => {
      comp.enabled = !comp.enabled;
      state.statusMsg = comp.enabled ? 'VRM Pre-Compression Enabled' : 'VRM Pre-Compression Disabled';
      renderUI();
    }, comp.enabled, comp.enabled ? 'rgba(76, 160, 62, 0.85)' : 'rgba(255, 255, 255, 0.1)');

    // Toggle 2: Prune Profile Thumbnail
    registerBtn('btn_comp_prune', 270, 292, 230, 36, comp.pruneThumbnail ? '✂️ Prune Pic: ON' : '✂️ Prune Pic: OFF', () => {
      comp.pruneThumbnail = !comp.pruneThumbnail;
      state.statusMsg = comp.pruneThumbnail ? 'Prune profile thumbnail ON (saves 2-6MB)' : 'Prune profile thumbnail OFF';
      renderUI();
    }, comp.pruneThumbnail, comp.pruneThumbnail ? 'rgba(168, 85, 247, 0.85)' : 'rgba(255, 255, 255, 0.1)');

    // Texture Resolution Selector (512 / 1024 / 2048)
    ctx.fillStyle = '#eaf2df';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('Max Texture Res:', 22, 350);

    const resOpts = [
      { res: 512, label: '512px (VR Fast)' },
      { res: 1024, label: '1024px (Crisp)' },
      { res: 2048, label: '2048px (Max)' }
    ];
    resOpts.forEach((r, idx) => {
      const rx = 145 + idx * 118;
      const isSel = (comp.maxTextureRes === r.res);
      registerBtn(`btn_res_${r.res}`, rx, 334, 114, 28, r.label, () => {
        comp.maxTextureRes = r.res;
        state.statusMsg = `Max Texture Resolution: ${r.res}px`;
        renderUI();
      }, isSel, isSel ? 'rgba(56, 189, 248, 0.85)' : 'rgba(255, 255, 255, 0.1)');
    });

    // Meshopt Simplifier Toggle
    registerBtn('btn_comp_meshopt', 20, 370, 230, 36, comp.meshoptAccessory ? '⚙️ Meshopt Props: ON' : '⚙️ Meshopt Props: OFF', () => {
      comp.meshoptAccessory = !comp.meshoptAccessory;
      state.statusMsg = comp.meshoptAccessory ? 'Meshopt decimation for accessories ON' : 'Meshopt decimation OFF';
      renderUI();
    }, comp.meshoptAccessory, comp.meshoptAccessory ? 'rgba(76, 160, 62, 0.85)' : 'rgba(255, 255, 255, 0.1)');

    // Re-apply Optimization on Active Avatar
    registerBtn('btn_comp_apply', 270, 370, 230, 36, '🔄 Re-load with Settings', () => {
      state.statusMsg = 'Re-loading avatar with new compression settings...';
      if (isCustom && vrmCtrl?._lastCustomFile) {
        vrmCtrl.loadCustomVRMFile(vrmCtrl._lastCustomFile);
      } else {
        vrmCtrl?.selectAvatar(activeId);
      }
      renderUI();
    }, false, 'rgba(234, 179, 8, 0.55)');

    ctx.fillStyle = 'rgba(235, 245, 225, 0.65)';
    ctx.font = '10px monospace';
    ctx.fillText('• 100% Rig Safe: SkinnedMesh & blendshape morphs preserved', 22, 424);
    ctx.fillText('• WebP downscaling reduces Quest VRAM pressure by up to 85%', 22, 439);

    // 4. Locomotion & Camera Modes
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('🎮 LOCOMOTION & CAMERA MODES', 14, 474);

    registerBtn('btn_vrm_vr', 10, 488, 244, 44, '👤 1st/3rd View (C)', () => {
      document.getElementById('vrmAvatarBtn')?.click();
      state.statusMsg = 'Toggled 1st / 3rd person view mode';
      renderUI();
    }, false, 'rgba(236, 72, 153, 0.45)', 'Toggle camera view');

    registerBtn('btn_mode_vr', 266, 488, 244, 44, '🔭 Inspect / Walk (V)', () => {
      document.getElementById('modeBtn')?.click();
      state.statusMsg = 'Toggled Inspect / Locomotion mode';
      renderUI();
    }, false, 'rgba(76, 160, 62, 0.55)', 'Orbit controls vs character follow');

    const isFlying = isFlyModeGetter ? isFlyModeGetter() : false;
    registerBtn('btn_fly_vr', 10, 540, CANVAS_W - 20, 44, isFlying ? '🕊️ 3D Flight Active (Press X to Ground)' : '🚶 Ground Locomotion (Press X to Fly)', () => {
      toggleFlyModeCallback?.();
      state.statusMsg = 'Toggled 3D Flight / Ground Mode';
      renderUI();
    }, isFlying, 'rgba(56, 189, 248, 0.45)');

    // 5. Facial Expressions & Emotes
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 12.5px monospace';
    ctx.fillText('😊 FACIAL EMOTES & EXPRESSIONS (Keys 1-6)', 14, 600);

    const emotes = [
      { id: 'happy', label: '😊 Happy' },
      { id: 'sad', label: '😢 Sad' },
      { id: 'angry', label: '😠 Angry' },
      { id: 'surprised', label: '😮 Wow' },
      { id: 'relaxed', label: '😌 Relax' },
      { id: 'neutral', label: '😐 Reset' }
    ];
    const ew = 78;
    emotes.forEach((em, idx) => {
      const ex = 10 + idx * (ew + 6);
      registerBtn(`btn_emote_${em.id}`, ex, 614, ew, 34, em.label, () => {
        vrmCtrl?.setEmote?.(em.id, 4);
        state.statusMsg = `Emote: ${em.label}`;
        renderUI();
      }, false, 'rgba(236, 72, 153, 0.45)');
    });

    // 6. Controls Guide Box
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(10, 660, CANVAS_W - 20, 204, 10);
    ctx.fill();

    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('🎮 Meta Quest Controller Mapping:', 24, 682);
    ctx.font = '11px monospace';
    ctx.fillStyle = '#eaf2df';
    ctx.fillText('• Left Thumbstick: Walk / Soar along gaze vector', 24, 704);
    ctx.fillText('• Right Thumbstick: 45° Snap Turning', 24, 726);
    ctx.fillText('• Y Button (Left) / B (Right): Mount/Dismiss UI Tablet', 24, 748);
    ctx.fillText('• X Button: Toggle 3D Flight / Ground Walk', 24, 770);
    ctx.fillText('• Right Trigger: Laser click UI / Paint terrain', 24, 792);
    ctx.fillText('• WebXR Hands: Two-bone arm IK tracking with wrist alignment', 24, 814);
    ctx.fillText('• Hotkeys: 1-6 expressions · V inspect · C 1st/3rd person · O overdraw', 24, 836);
  }

  // ---------------------------------------------------------------- TAB 4: SCULPT
  function renderSculptTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('🎨 TERRAIN SCULPTING & BRUSHES', 14, 114);

    // Row 1: Brush ON/OFF & Edit ON/OFF
    const isBrushOn = !!editorState.active;
    registerBtn('btn_brush_toggle', 10, 128, 244, 42, isBrushOn ? '🖌️ Brush: ON' : '🖌️ Brush: OFF', () => {
      if (window.terrainEditor?.toggleBrushActive) {
        window.terrainEditor.toggleBrushActive();
      } else {
        editorState.active = !editorState.active;
        if (!editorState.active) {
          editorState.isPainting = false;
          editorState.hasHit = false;
        }
      }
      state.statusMsg = editorState.active ? 'Brush enabled: ready to paint' : 'Brush DISABLED: editing paused';
      renderUI();
    }, isBrushOn, isBrushOn ? 'rgba(76, 160, 62, 0.85)' : 'rgba(255, 255, 255, 0.12)');

    const editOn = window.transformManager?.getEditMode?.() ?? false;
    registerBtn('btn_edit_toggle', 266, 128, 244, 42, editOn ? '✋ Edit: ON' : '✋ Edit: OFF', () => {
      if (window.transformManager?.toggleEditMode) {
        const on = window.transformManager.toggleEditMode();
        state.statusMsg = on ? 'Edit Mode ON: Click any model in world to move' : 'Edit Mode OFF';
      } else {
        document.getElementById('editModeToggleBtn')?.click();
      }
      renderUI();
    }, editOn, editOn ? 'rgba(56, 189, 248, 0.85)' : 'rgba(255, 255, 255, 0.12)');

    // 12 Brushes
    ctx.fillStyle = 'rgba(235, 245, 225, 0.7)';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('BRUSH PALETTE (12)', 14, 192);

    const brushes = [
      { id: 'grass', label: '🌿 Grass' },
      { id: 'no_grass', label: '🌱 No Grass' },
      { id: 'sand',  label: '🏖️ Sand' },
      { id: 'road',  label: '🛤️ Road' },
      { id: 'water', label: '🌊 Water' },
      { id: 'raise', label: '⛰️ Raise' },
      { id: 'lower', label: '🔻 Lower' },
      { id: 'smooth',label: '〰️ Smooth' },
      { id: 'rock',  label: '🪨 Rock' },
      { id: 'treeConifer', label: '🌲 Conifer' },
      { id: 'treeBroad', label: '🍃 Oak' },
      { id: 'glb',   label: '📦 Prop' }
    ];

    const bw = 160;
    const bh = 38;
    brushes.forEach((b, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const bx = 10 + col * (bw + 10);
      const by = 204 + row * (bh + 6);
      const isAct = editorState.brushType === b.id;

      registerBtn(`brush_${b.id}`, bx, by, bw, bh, b.label, () => {
        editorState.brushType = b.id;
        document.querySelector(`.brush-btn[data-brush="${b.id}"]`)?.click();
        state.statusMsg = `Brush: ${b.label}`;
        renderUI();
      }, isAct);
    });

    // Sliders
    registerSlider('sl_radius', 10, 396, CANVAS_W - 20, 38, editorState.brushRadius, 2, 35, '⭕ Brush Radius', (v) => {
      editorState.brushRadius = Math.round(v);
      const sl = document.getElementById('brushRadiusSlider');
      if (sl) { sl.value = editorState.brushRadius; sl.dispatchEvent(new Event('input')); }
    }, `${editorState.brushRadius}m`);

    registerSlider('sl_strength', 10, 456, CANVAS_W - 20, 38, editorState.brushStrength, 0.1, 1.0, '💧 Sculpt Strength', (v) => {
      editorState.brushStrength = parseFloat(v.toFixed(2));
      const sl = document.getElementById('brushStrengthSlider');
      if (sl) { sl.value = editorState.brushStrength; sl.dispatchEvent(new Event('input')); }
    }, `${Math.round(editorState.brushStrength * 100)}%`);

    // Procedural Landscape Actions
    registerBtn('btn_pcg_new', 10, 520, CANVAS_W - 20, 42, '🎲 Randomize PCG Terrain', () => {
      document.getElementById('pcgNewWorldBtn')?.click();
      state.statusMsg = 'Generated random multi-octave PCG terrain';
      renderUI();
    }, false, 'rgba(56, 189, 248, 0.45)');

    registerBtn('btn_auto_trees', 10, 570, 244, 40, '🌲 Auto-Place Trees', () => {
      document.getElementById('pcgAutoTreesBtn')?.click();
      state.statusMsg = 'Auto-placed trees across painted grass';
      renderUI();
    }, false, 'rgba(76, 160, 62, 0.45)');

    registerBtn('btn_reset_pcg', 266, 570, 244, 40, '↺ Reset Default Terrain', () => {
      document.getElementById('pcgResetBtn')?.click();
      state.statusMsg = 'Reset terrain back to baseline';
      renderUI();
    }, false, 'rgba(200, 70, 50, 0.45)');

    // Help tips card
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.roundRect(10, 622, CANVAS_W - 20, 100, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(235, 245, 225, 0.8)';
    ctx.font = '11px monospace';
    ctx.fillText('💡 Tip: Aim laser / cursor at ground and pull trigger to sculpt.', 20, 646);
    ctx.fillText('• Squeeze controller grip for continuous real-time terrain carving.', 20, 670);
    ctx.fillText('• Toggle Brush OFF above to safely look around without painting.', 20, 694);
  }

  // ---------------------------------------------------------------- TAB 5: TRANSFORM
  function renderTransformTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('📐 MODEL TRANSFORM & EDIT MODE', 14, 114);

    const selName = document.getElementById('panelPropName')?.textContent || 'No Selection';
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(`Target: ${selName}`, 14, 144);

    // Modes (3 columns)
    const mw = 160;
    registerBtn('btn_move_vr', 10, 162, mw, 46, '✥ Move', () => {
      document.getElementById('panelBtnMove')?.click();
      state.statusMsg = 'Gizmo: Translation (Move)';
      renderUI();
    }, false, 'rgba(56, 189, 248, 0.4)');

    registerBtn('btn_rot_vr', 180, 162, mw, 46, '🔄 Rotate', () => {
      document.getElementById('panelBtnRotate')?.click();
      state.statusMsg = 'Gizmo: Rotation (Yaw)';
      renderUI();
    }, false, 'rgba(255, 213, 126, 0.4)');

    registerBtn('btn_scl_vr', 350, 162, mw, 46, '⤢ Scale', () => {
      document.getElementById('panelBtnScale')?.click();
      state.statusMsg = 'Gizmo: Scale (Size)';
      renderUI();
    }, false, 'rgba(126, 240, 136, 0.4)');

    // Actions (3 columns)
    registerBtn('btn_snap_vr', 10, 220, mw, 46, '⛰️ Snap', () => {
      document.getElementById('panelBtnSnap')?.click();
      state.statusMsg = 'Snapped model directly to ground';
      renderUI();
    }, false, 'rgba(255, 255, 255, 0.15)');

    registerBtn('btn_clone_vr', 180, 220, mw, 46, '📋 Clone', () => {
      document.getElementById('panelBtnClone')?.click();
      state.statusMsg = 'Duplicated selected model';
      renderUI();
    }, false, 'rgba(76, 160, 62, 0.45)');

    registerBtn('btn_del_vr', 350, 220, mw, 46, '🗑️ Delete', () => {
      document.getElementById('panelBtnDelete')?.click();
      state.statusMsg = 'Deleted selected model from level';
      renderUI();
    }, false, 'rgba(220, 70, 70, 0.45)');

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.roundRect(10, 286, CANVAS_W - 20, 160, 10);
    ctx.fill();

    ctx.fillStyle = '#eaf2df';
    ctx.font = 'bold 12.5px monospace';
    ctx.fillText('💡 Edit Mode Tips:', 24, 316);
    ctx.fillStyle = 'rgba(235, 245, 225, 0.8)';
    ctx.font = '11.5px monospace';
    ctx.fillText('• Click or aim laser at any prop (bridge, cottage, barrel)', 24, 346);
    ctx.fillText('  in the 3D scene to select it.', 24, 368);
    ctx.fillText('• Drag the 3D colored gizmo handles with mouse or trigger', 24, 398);
    ctx.fillText('  to move, rotate or resize.', 24, 420);
  }

  // ---------------------------------------------------------------- TAB 6: PROPS
  function renderPropsTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('📦 3D GLB PROPS & ASSET SPAWNER', 14, 114);

    const props = [
      'barrel', 'box', 'watering_can',
      'bridge', 'fishing_stool', 'lamp_post',
      'torii_gate', 'portal', 'older_sprite',
      'tree_autumn', 'tree_small', 'rock_moss'
    ];

    const pw = 160;
    const ph = 38;
    props.forEach((pName, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const px = 10 + col * (pw + 10);
      const py = 128 + row * (ph + 6);
      const isAct = placementState.active && placementState.assetId === pName;

      registerBtn(`prop_${pName}`, px, py, pw, ph, pName.replace(/_/g, ' '), () => {
        startPlacement(pName);
        editorState.brushType = 'glb';
        state.statusMsg = `Placing: ${pName}. Aim at ground & click to stamp!`;
        renderUI();
      }, isAct, 'rgba(56, 189, 248, 0.25)');
    });

    const scale = placementState.scale || 1.0;
    registerSlider('sl_prop_scale', 10, 320, CANVAS_W - 20, 38, scale, 0.3, 3.0, '📏 Prop Scale', (v) => {
      placementState.scale = parseFloat(v.toFixed(2));
      const sl = document.getElementById('glbScaleSlider');
      if (sl) { sl.value = placementState.scale; sl.dispatchEvent(new Event('input')); }
    }, `${scale.toFixed(1)}×`);

    const yaw = placementState.yaw || 0;
    registerSlider('sl_prop_yaw', 10, 380, CANVAS_W - 20, 38, yaw, -180, 180, '🧭 Prop Yaw', (v) => {
      placementState.yaw = Math.round(v);
      const sl = document.getElementById('glbYawSlider');
      if (sl) { sl.value = placementState.yaw; sl.dispatchEvent(new Event('input')); }
    }, `${yaw}°`);

    registerBtn('btn_confirm_prop', 10, 442, CANVAS_W - 20, 44, '✅ Confirm Placement (Stamp)', () => {
      if (editorState.hitPoint) {
        confirmPlacement(editorState.hitPoint.x, editorState.hitPoint.z);
        state.statusMsg = 'Stamped prop into level!';
      } else {
        state.statusMsg = 'Aim at ground to place prop';
      }
      renderUI();
    }, false, 'rgba(76, 160, 62, 0.65)');

    registerBtn('btn_open_browser', 10, 498, CANVAS_W - 20, 44, '📂 3D Models & Optimizer (14 Assets)', () => {
      document.getElementById('sideOpenAssetBrowserBtn')?.click();
      state.statusMsg = 'Opened 3D Asset Browser';
      renderUI();
    }, false, 'rgba(168, 85, 247, 0.45)');
  }

  // ---------------------------------------------------------------- TAB 7: TREES
  function renderTreesTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('🌲 TREES & FOLIAGE CUSTOMIZER', 14, 114);

    ctx.fillStyle = 'rgba(235, 245, 225, 0.7)';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('SEASONAL COLOR PRESETS', 14, 142);

    const presets = [
      { id: 'spring', label: '🌱 Spring' },
      { id: 'summer', label: '☀️ Summer' },
      { id: 'autumn', label: '🍁 Autumn' },
      { id: 'cherry', label: '🌸 Cherry' },
      { id: 'golden', label: '✨ Golden' }
    ];
    const tw = 94;
    presets.forEach((p, idx) => {
      const tx = 10 + idx * (tw + 8);
      registerBtn(`tree_preset_${p.id}`, tx, 154, tw, 36, p.label, () => {
        applyTreePreset(p.id);
        state.statusMsg = `Applied Tree Season: ${p.label}`;
        renderUI();
      }, false, 'rgba(255,255,255,0.12)');
    });

    ctx.fillStyle = 'rgba(235, 245, 225, 0.7)';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('TREE TOOLS', 14, 216);

    const toolW = 244;
    registerBtn('tool_conifer', 10, 228, toolW, 44, '🌲 Stamp Conifer', () => {
      editorState.brushType = 'treeConifer';
      editorState.active = true;
      state.statusMsg = 'Aim at terrain to plant Pine Conifer';
      renderUI();
    }, editorState.brushType === 'treeConifer');

    registerBtn('tool_broad', 266, 228, toolW, 44, '🍃 Stamp Broadleaf', () => {
      editorState.brushType = 'treeBroad';
      editorState.active = true;
      state.statusMsg = 'Aim at terrain to plant Oak Broadleaf';
      renderUI();
    }, editorState.brushType === 'treeBroad');

    registerBtn('tool_erase', 10, 280, toolW, 44, '🧹 Erase Trees', () => {
      editorState.brushType = 'tree_eraser';
      editorState.active = true;
      state.statusMsg = 'Tree Eraser active. Aim at trees to clear.';
      renderUI();
    }, editorState.brushType === 'tree_eraser');

    registerBtn('tool_grove', 266, 280, toolW, 44, '🌳 Plant Grove', () => {
      editorState.brushType = 'tree_cluster';
      editorState.active = true;
      state.statusMsg = 'Aim at terrain to plant cluster grove';
      renderUI();
    }, editorState.brushType === 'tree_cluster');

    registerBtn('btn_trees_pcg', 10, 340, CANVAS_W - 20, 44, '🎲 Randomize Trees PCG', () => {
      rebuildTreesPCG();
      state.statusMsg = 'Rebuilt procedural tree distribution!';
      renderUI();
    }, false, 'rgba(56, 189, 248, 0.45)');
  }

  // ---------------------------------------------------------------- TAB 8: ENV
  function renderEnvTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('☀️ ENVIRONMENT & ATMOSPHERE', 14, 114);

    const targetCfg = window.envConfig || envConfig || {};
    const curTime = (typeof targetCfg.timeOfDay === 'number') ? targetCfg.timeOfDay : 0.45;

    // Calculate 24h clock string
    const hours = Math.floor(curTime * 24);
    const mins = Math.floor((curTime * 24 - hours) * 60);
    const hh = String(hours).padStart(2, '0');
    const mm = String(mins).padStart(2, '0');

    let timeName = `${hh}:${mm}`;
    if (curTime < 0.22 || curTime > 0.78) timeName += ' 🌌 Night';
    else if (curTime < 0.32) timeName += ' 🌅 Dawn';
    else if (curTime < 0.65) timeName += ' ☀️ Day';
    else timeName += ' 🌇 Sunset';

    registerSlider('sl_time_day', 10, 130, CANVAS_W - 20, 38, curTime, 0.0, 1.0, '⏰ Time of Day', (v) => {
      const cfg = window.envConfig || envConfig;
      if (cfg) {
        cfg.timeOfDay = v;
        cfg.autoCycle = false; // Pause auto cycle while manually scrubbed
      }
      const timeSlider = document.getElementById('timeOfDaySlider');
      if (timeSlider) {
        timeSlider.value = v;
      }
      if (window.updateEnvironment) {
        window.updateEnvironment(window.clock ? window.clock.getElapsedTime() : 0, 0);
      }
      state.statusMsg = `Time set to: ${timeName}`;
    }, timeName);

    const isAutoCycle = targetCfg?.autoCycle ?? false;
    registerBtn('btn_time_cycle', 10, 186, CANVAS_W - 20, 42, isAutoCycle ? '🔄 Auto Day/Night: ON' : '🔄 Auto Day/Night: OFF', () => {
      const cfg = window.envConfig || envConfig;
      if (cfg) {
        cfg.autoCycle = !cfg.autoCycle;
        state.statusMsg = cfg.autoCycle ? 'Auto Day/Night cycle enabled' : 'Auto Day/Night cycle paused';
      }
      renderUI();
    }, isAutoCycle, isAutoCycle ? 'rgba(76, 160, 62, 0.7)' : 'rgba(255, 255, 255, 0.12)');

    // Fog Density Slider
    // Base range: 0.0005 (clear) to 0.0350 (dense mist)
    const curFog = (typeof targetCfg?.fogBaseDensity === 'number') ? targetCfg.fogBaseDensity : 0.0125;
    let fogLabel = 'Medium';
    if (curFog < 0.003) fogLabel = 'Clear';
    else if (curFog < 0.008) fogLabel = 'Light';
    else if (curFog < 0.018) fogLabel = 'Medium';
    else fogLabel = 'Dense';
    const fogDisplay = `${fogLabel} (${(curFog * 1000).toFixed(1)})`;

    registerSlider('sl_fog', 10, 246, CANVAS_W - 20, 38, curFog, 0.0005, 0.035, '🌫️ Fog Density', (v) => {
      const cfg = window.envConfig || envConfig;
      if (cfg) {
        cfg.fogBaseDensity = v;
      }
      if (window.scene?.fog) {
        window.scene.fog.density = v;
      }
      const fogSlider = document.getElementById('fogDensitySlider');
      if (fogSlider) {
        fogSlider.value = v;
      }
      if (window.updateEnvironment) {
        window.updateEnvironment(window.clock ? window.clock.getElapsedTime() : 0, 0);
      }
      state.statusMsg = `Fog Density: ${(v * 1000).toFixed(1)}`;
    }, fogDisplay);

    const fadeVal = window.waterUniforms?.uShoreFadeDist?.value ?? 1.2;
    registerSlider('sl_water_fade', 10, 306, CANVAS_W - 20, 38, fadeVal, 0.1, 3.0, '🌊 Shoreline Fade', (v) => {
      if (window.waterUniforms?.uShoreFadeDist) {
        window.waterUniforms.uShoreFadeDist.value = v;
      }
      const fadeSlider = document.getElementById('waterFadeSlider');
      if (fadeSlider) fadeSlider.value = v;
      state.statusMsg = `Water Shore Fade: ${v.toFixed(1)}m`;
    }, `${fadeVal.toFixed(1)}m`);

    const foamVal = window.waterUniforms?.uShoreFoamWidth?.value ?? 1.0;
    registerSlider('sl_water_foam', 10, 366, CANVAS_W - 20, 38, foamVal, 0.0, 2.5, '🫧 Water Foam Intensity', (v) => {
      if (window.waterUniforms?.uShoreFoamWidth) {
        window.waterUniforms.uShoreFoamWidth.value = v;
      }
      const foamSlider = document.getElementById('waterFoamSlider');
      if (foamSlider) foamSlider.value = v;
      state.statusMsg = `Water Foam: ${v.toFixed(1)}×`;
    }, `${foamVal.toFixed(1)}×`);
  }

  // ---------------------------------------------------------------- TAB 9: GRASS
  function renderGrassTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('🌾 GRASS MEADOW CUSTOMIZER', 14, 114);

    const hSlider = document.getElementById('grassHeightSlider');
    const hVal = hSlider ? parseFloat(hSlider.value) : 1.0;
    registerSlider('sl_grass_h', 10, 130, CANVAS_W - 20, 38, hVal, 0.4, 2.5, '🌾 Blade Height', (v) => {
      if (hSlider) { hSlider.value = v; hSlider.dispatchEvent(new Event('input')); }
    }, `${hVal.toFixed(2)}m`);

    const dSlider = document.getElementById('grassDensitySlider');
    const dVal = dSlider ? parseInt(dSlider.value) : 16;
    registerSlider('sl_grass_d', 10, 190, CANVAS_W - 20, 38, dVal, 2, 50, '🌱 Blade Density', (v) => {
      const rounded = Math.round(v);
      if (dSlider) { dSlider.value = rounded; dSlider.dispatchEvent(new Event('input')); }
      if (window.setGrassDensity) window.setGrassDensity(rounded);
    }, `${Math.round(dVal)}/m²`);

    const rSlider = document.getElementById('grassRadiusSlider');
    const rVal = rSlider ? parseInt(rSlider.value) : 35;
    registerSlider('sl_grass_r', 10, 250, CANVAS_W - 20, 38, rVal, 15, 65, '⭕ Render Radius', (v) => {
      const rounded = Math.round(v);
      if (rSlider) { rSlider.value = rounded; rSlider.dispatchEvent(new Event('input')); }
      if (window.setGrassRadius) window.setGrassRadius(rounded);
    }, `${Math.round(rVal)}m`);

    const bSlider = document.getElementById('groundBlendSlider');
    const bVal = bSlider ? parseFloat(bSlider.value) : 0.45;
    registerSlider('sl_grass_b', 10, 310, CANVAS_W - 20, 38, bVal, 0.0, 1.0, '🎨 Ground Blend', (v) => {
      if (bSlider) { bSlider.value = v; bSlider.dispatchEvent(new Event('input')); }
    }, `${Math.round(bVal * 100)}%`);

    ctx.fillStyle = 'rgba(235, 245, 225, 0.7)';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('BLADE COLOR PRESETS', 14, 380);

    const presets = [
      { id: 'emerald', label: '🌿 Emerald' },
      { id: 'summer',  label: '🌾 Summer' },
      { id: 'autumn',  label: '🍂 Autumn' },
      { id: 'mystic',  label: '🌙 Mystic' },
      { id: 'golden',  label: '✨ Golden' }
    ];
    const gw = 94;
    presets.forEach((p, idx) => {
      const gx = 10 + idx * (gw + 8);
      registerBtn(`grass_preset_${p.id}`, gx, 394, gw, 36, p.label, () => {
        document.querySelector(`.preset-btn[data-preset="${p.id}"]`)?.click();
        state.statusMsg = `Applied Grass Preset: ${p.label}`;
        renderUI();
      }, false, 'rgba(255,255,255,0.12)');
    });
  }

  // ---------------------------------------------------------------- TAB 10: VIEW & SAVE
  function renderViewTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('⚙️ PERFORMANCE, OUTLINES & PERSISTENCE', 14, 114);

    registerBtn('btn_quest_fx', 10, 128, 244, 42, '⚡ Quest FX', () => {
      document.getElementById('fxBtn')?.click();
      const txt = document.getElementById('fxBtn')?.textContent || 'FX Toggled';
      state.statusMsg = txt;
      renderUI();
    }, false, 'rgba(56, 189, 248, 0.35)');

    const isOverdraw = typeof window !== 'undefined' && window.isOverdrawActive ? window.isOverdrawActive() : false;
    registerBtn('btn_overdraw_toggle', 266, 128, 244, 42, isOverdraw ? '👁️ Overdraw: ON' : '👁️ Overdraw: OFF', () => {
      if (window.toggleOverdraw) {
        const on = window.toggleOverdraw();
        state.statusMsg = on ? 'Overdraw Debug ON (Additive)' : 'Overdraw Debug OFF';
      }
      renderUI();
    }, isOverdraw, isOverdraw ? 'rgba(234, 179, 8, 0.85)' : 'rgba(255, 255, 255, 0.12)');

    ctx.fillStyle = 'rgba(235, 245, 225, 0.7)';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('CEL OUTLINE MODES', 14, 196);

    const ow = 160;
    registerBtn('btn_outline_off', 10, 208, ow, 42, '🚫 Off', () => {
      document.getElementById('outlineModeOffBtn')?.click();
      state.statusMsg = 'Cel outlines disabled';
      renderUI();
    }, false, 'rgba(255, 255, 255, 0.12)');

    registerBtn('btn_outline_frag', 180, 208, ow, 42, '⚡ Frag (0 Tris)', () => {
      document.getElementById('outlineModeFragBtn')?.click();
      state.statusMsg = 'Frag-only outline (cheap, zero extra tris)';
      renderUI();
    }, false, 'rgba(234, 179, 8, 0.45)');

    registerBtn('btn_outline_shell', 350, 208, ow, 42, '📐 Shell (Hull)', () => {
      document.getElementById('outlineModeShellBtn')?.click();
      state.statusMsg = 'Inverted hull geometric shell outline';
      renderUI();
    }, false, 'rgba(56, 189, 248, 0.45)');

    ctx.fillStyle = 'rgba(235, 245, 225, 0.7)';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('LEVEL PERSISTENCE', 14, 276);

    registerBtn('btn_save_storage', 10, 288, CANVAS_W - 20, 44, '💾 Quick Save Level (Storage)', () => {
      document.getElementById('quickSaveStorageBtn')?.click();
      state.statusMsg = 'Level saved to browser local storage!';
      renderUI();
    }, false, 'rgba(76, 160, 62, 0.55)');

    registerBtn('btn_load_storage', 10, 340, CANVAS_W - 20, 44, '📂 Quick Load Level (Storage)', () => {
      document.getElementById('quickLoadStorageBtn')?.click();
      state.statusMsg = 'Loaded level from local storage!';
      renderUI();
    }, false, 'rgba(56, 189, 248, 0.55)');

    registerBtn('btn_export_json', 10, 392, CANVAS_W - 20, 44, '📥 Export Level JSON File', () => {
      document.getElementById('saveLevelBtn')?.click();
      state.statusMsg = 'Exported level JSON download';
      renderUI();
    }, false, 'rgba(168, 85, 247, 0.45)');
  }

  // ---------------------------------------------------------------- POINTER EVENT HANDLING
  function updateSliderFromX(slider, x) {
    const ratio = THREE.MathUtils.clamp((x - slider.x) / slider.w, 0, 1);
    const val = slider.min + ratio * (slider.max - slider.min);
    slider.value = val;
    if (slider.onInput) slider.onInput(val);
  }

  function handlePointerDown(x, y) {
    // 1. Check Top Tab Bar
    for (const t of tabs) {
      if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
        state.tab = t.id;
        state.statusMsg = `Tab: ${t.label}`;
        renderUI();
        return true;
      }
    }

    // 2. Check Sliders (hit margin around bar)
    for (const s of currentSliders) {
      if (x >= s.x - 10 && x <= s.x + s.w + 10 && y >= s.y && y <= s.y + s.h + 12) {
        activeSlider = s;
        updateSliderFromX(s, x);
        renderUI();
        return true;
      }
    }

    // 3. Check Buttons
    for (const b of currentButtons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        if (b.onClick) b.onClick();
        renderUI();
        return true;
      }
    }

    return false;
  }

  function handlePointerMove(x, y, isPressed) {
    state.cursorPos.set(x, y);

    if (isPressed && activeSlider) {
      updateSliderFromX(activeSlider, x);
      renderUI();
      return;
    }

    // Hover detection
    let changed = false;
    let newHoverBtn = null;
    for (const b of currentButtons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        newHoverBtn = b.id;
        break;
      }
    }
    if (newHoverBtn !== hoveredBtnId) {
      hoveredBtnId = newHoverBtn;
      changed = true;
    }

    let newHoverTab = null;
    for (const t of tabs) {
      if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
        newHoverTab = t.id;
        break;
      }
    }
    if (newHoverTab !== hoveredTabId) {
      hoveredTabId = newHoverTab;
      changed = true;
    }

    if (changed) renderUI();
  }

  function handlePointerUp() {
    activeSlider = null;
    renderUI();
  }

  // Attach Desktop Pointer Events to DOM Canvas
  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    return {
      x: Math.max(0, Math.min(CANVAS_W, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(CANVAS_H, (e.clientY - rect.top) * scaleY))
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const { x, y } = getCanvasCoords(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    handlePointerDown(x, y);
  });

  canvas.addEventListener('pointermove', (e) => {
    const { x, y } = getCanvasCoords(e);
    handlePointerMove(x, y, e.buttons !== 0);
    canvas.style.cursor = (hoveredBtnId || hoveredTabId) ? 'pointer' : 'default';
  });

  canvas.addEventListener('pointerup', (e) => {
    handlePointerUp();
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  });

  canvas.addEventListener('pointercancel', () => {
    handlePointerUp();
  });

  // VR Laser Raycast onto 3D Tablet Mesh
  const _raycaster = new THREE.Raycaster();
  const _vPos = new THREE.Vector3();
  const _vQuat = new THREE.Quaternion();
  const _vDir = new THREE.Vector3();

  function raycastUI(controller) {
    if (!panelMesh.visible) return null;
    controller.getWorldPosition(_vPos);
    controller.getWorldQuaternion(_vQuat);
    _vDir.set(0, 0, -1).applyQuaternion(_vQuat);
    _raycaster.set(_vPos, _vDir);

    const hits = _raycaster.intersectObject(panelMesh, false);
    if (!hits.length) {
      if (state.isLaserHovered) {
        state.isLaserHovered = false;
        hoveredBtnId = null;
        hoveredTabId = null;
        renderUI();
      }
      return null;
    }

    state.isLaserHovered = true;
    const uv = hits[0].uv;
    const x = uv.x * CANVAS_W;
    const y = (1 - uv.y) * CANVAS_H;
    return { x, y, hit: hits[0] };
  }

  // Listen to external avatar changes and re-render
  window.addEventListener('vrmAvatarChanged', () => {
    renderUI();
  });

  // Initial draw
  renderUI();

  return {
    panelMesh,
    canvas,
    renderUI,
    raycastUI,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    state
  };
}
