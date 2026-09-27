/**
 * src/vrUI.js
 * In-VR 3D interactive floating tablet UI for Quest headsets.
 * Allows full world editing, terrain sculpting, tree styling/sampling, asset placing,
 * toggling Free Roam Fly Mode, and saving levels directly inside VR.
 */
import * as THREE from 'three';
import { editorState } from './terrainEditor.js';
import { applyTreePreset, rebuildTreesPCG, sampleTreeCluster, eraseTreesInRadius, TREE_PRESETS } from './trees.js';
import { startPlacement, confirmPlacement, removeLastPlacedAsset, placementState } from './assetsManager.js';
import { saveLevelToStorage, loadLevelFromStorage, showNotification } from './levelSerializer.js';

export function createVRUI(scene, cameraRig, envConfig = {}, toggleFlyModeCallback = null, isFlyModeGetter = null) {
  const CANVAS_W = 1024;
  const CANVAS_H = 640;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  // 3D Tablet Mesh
  const panelGeo = new THREE.PlaneGeometry(0.72, 0.45);
  const panelMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: true
  });

  const panelMesh = new THREE.Mesh(panelGeo, panelMat);
  panelMesh.name = 'vr_ui_panel';

  // Tablet border frame backing
  const frameGeo = new THREE.BoxGeometry(0.74, 0.47, 0.015);
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x141e16,
    metalness: 0.8,
    roughness: 0.3
  });
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.position.z = -0.008;
  panelMesh.add(frameMesh);

  // Position tablet comfortably in front of user rig
  panelMesh.position.set(0.35, 1.25, -0.68);
  panelMesh.rotation.set(-0.25, -0.35, -0.08);
  scene.add(panelMesh);

  // UI State
  const state = {
    visible: true,
    tab: 'sculpt', // 'sculpt' | 'trees' | 'props' | 'world'
    hoveredBtn: null,
    cursorUv: new THREE.Vector2(-1, -1),
    isLaserHovered: false,
    activeTool: 'terrain', // 'terrain' | 'tree_stamp' | 'tree_cluster' | 'tree_eraser' | 'prop_place'
    selectedTreeType: 'conifer',
    statusMsg: 'Quest VR Ready · Point Laser & Click Trigger'
  };

  // Button Registry for Raycast Hit Testing
  let buttons = [];

  function registerBtn(id, x, y, w, h, label, onClick, isActive = false, color = '#2a4230') {
    buttons.push({ id, x, y, w, h, label, onClick, isActive, color });
  }

  function renderUI() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Frosted dark tablet body
    ctx.fillStyle = 'rgba(11, 18, 14, 0.95)';
    ctx.beginPath();
    ctx.roundRect(12, 12, CANVAS_W - 24, CANVAS_H - 24, 28);
    ctx.fill();

    // Vibrant emerald glowing border
    ctx.strokeStyle = state.isLaserHovered ? '#7ef088' : 'rgba(126, 240, 136, 0.45)';
    ctx.lineWidth = 4;
    ctx.stroke();

    buttons = [];

    // Header Title Bar
    ctx.fillStyle = '#eaf2df';
    ctx.font = 'bold 26px ui-monospace, Consolas, monospace';
    ctx.fillText('🌲 LEVEL EDITOR & QUEST CONTROLS', 36, 52);

    const isFlying = isFlyModeGetter ? isFlyModeGetter() : false;
    ctx.font = 'bold 19px monospace';
    ctx.fillStyle = isFlying ? '#38bdf8' : '#7ef088';
    ctx.fillText(isFlying ? '🕊️ FLY MODE ACTIVE (Press X)' : '🚶 GROUND WALK (Press X to Fly)', CANVAS_W - 410, 52);

    // Tab Navigation Bar
    const tabs = [
      { id: 'sculpt', label: '🎨 SCULPT' },
      { id: 'trees',  label: '🌲 TREES' },
      { id: 'props',  label: '🏛️ PROPS' },
      { id: 'world',  label: '⚙️ WORLD & SAVE' }
    ];

    const tabW = 224;
    const tabH = 46;
    tabs.forEach((t, i) => {
      const tx = 36 + i * (tabW + 16);
      const ty = 76;
      const isSel = state.tab === t.id;

      registerBtn(`tab_${t.id}`, tx, ty, tabW, tabH, t.label, () => {
        state.tab = t.id;
        renderUI();
      }, isSel, isSel ? '#4ca03e' : '#1b2b20');

      ctx.fillStyle = isSel ? 'rgba(76, 160, 62, 0.85)' : 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.roundRect(tx, ty, tabW, tabH, 12);
      ctx.fill();
      ctx.strokeStyle = isSel ? '#7ef088' : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = isSel ? '#ffffff' : '#c5d8be';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(t.label, tx + tabW / 2, ty + 30);
      ctx.textAlign = 'left';
    });

    // Separator line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(36, 136);
    ctx.lineTo(CANVAS_W - 36, 136);
    ctx.stroke();

    // Tab Content Panels
    if (state.tab === 'sculpt') {
      renderSculptTab();
    } else if (state.tab === 'trees') {
      renderTreesTab();
    } else if (state.tab === 'props') {
      renderPropsTab();
    } else if (state.tab === 'world') {
      renderWorldTab();
    }

    // Bottom Status Strip
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.roundRect(36, CANVAS_H - 62, CANVAS_W - 72, 42, 10);
    ctx.fill();
    ctx.fillStyle = '#a8f09e';
    ctx.font = '17px monospace';
    ctx.fillText(`⚡ ${state.statusMsg}`, 52, CANVAS_H - 35);

    // Laser cursor dot on canvas
    if (state.isLaserHovered && state.cursorUv.x >= 0) {
      const cx = state.cursorUv.x * CANVAS_W;
      const cy = (1 - state.cursorUv.y) * CANVAS_H;

      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(126, 240, 136, 0.85)';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    texture.needsUpdate = true;
  }

  function renderSculptTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('TERRAIN BRUSHES (Aim at ground & pull Right Trigger):', 36, 172);

    const brushes = [
      { id: 'grass', label: '🌿 Grass' },
      { id: 'sand',  label: '🏖️ Sand' },
      { id: 'road',  label: '🛤️ Road' },
      { id: 'water', label: '🌊 Water' },
      { id: 'raise', label: '⛰️ Raise' },
      { id: 'lower', label: '🔻 Lower' },
      { id: 'smooth',label: '〰️ Smooth' },
      { id: 'rock',  label: '🪨 Rock' }
    ];

    const bw = 108;
    const bh = 54;
    brushes.forEach((b, i) => {
      const col = i % 8;
      const bx = 36 + col * (bw + 12);
      const by = 192;
      const isAct = editorState.brushType === b.id && state.activeTool === 'terrain';

      registerBtn(`brush_${b.id}`, bx, by, bw, bh, b.label, () => {
        editorState.brushType = b.id;
        state.activeTool = 'terrain';
        state.statusMsg = `Brush set to: ${b.label}. Aim at ground & pull trigger.`;
        renderUI();
      }, isAct);

      drawButton(bx, by, bw, bh, b.label, isAct);
    });

    // Brush Radius & Strength controls
    ctx.fillStyle = '#eaf2df';
    ctx.font = 'bold 19px monospace';
    ctx.fillText(`Radius: ${editorState.brushRadius}m`, 36, 290);
    ctx.fillText(`Strength: ${Math.round(editorState.brushStrength * 100)}%`, 440, 290);

    // Radius buttons
    registerBtn('rad_minus', 190, 264, 48, 38, '-', () => {
      editorState.brushRadius = Math.max(3, editorState.brushRadius - 3);
      renderUI();
    });
    drawButton(190, 264, 48, 38, '-');

    registerBtn('rad_plus', 250, 264, 48, 38, '+', () => {
      editorState.brushRadius = Math.min(35, editorState.brushRadius + 3);
      renderUI();
    });
    drawButton(250, 264, 48, 38, '+');

    // Strength buttons
    registerBtn('str_minus', 620, 264, 48, 38, '-', () => {
      editorState.brushStrength = Math.max(0.1, editorState.brushStrength - 0.1);
      renderUI();
    });
    drawButton(620, 264, 48, 38, '-');

    registerBtn('str_plus', 680, 264, 48, 38, '+', () => {
      editorState.brushStrength = Math.min(1.0, editorState.brushStrength + 0.1);
      renderUI();
    });
    drawButton(680, 264, 48, 38, '+');

    // PCG Quick Tools
    registerBtn('pcg_random', 36, 335, 270, 52, '🎲 Randomize PCG Island', () => {
      if (window.terrainEditor?.pcgGenerateNewWorld) {
        window.terrainEditor.pcgGenerateNewWorld();
        state.statusMsg = '🎲 Generated new procedural island landscape!';
        renderUI();
      }
    });
    drawButton(36, 335, 270, 52, '🎲 Randomize PCG');

    registerBtn('pcg_autotrees', 320, 335, 270, 52, '🌲 Auto-Sample Trees', () => {
      rebuildTreesPCG();
      state.statusMsg = '🌲 Re-sampled forest trees across valid biomes!';
      renderUI();
    });
    drawButton(320, 335, 270, 52, '🌲 Auto-Sample Trees');

    registerBtn('pcg_reset', 604, 335, 230, 52, '↺ Reset Terrain', () => {
      if (window.terrainEditor?.pcgResetDefault) {
        window.terrainEditor.pcgResetDefault();
        state.statusMsg = '↺ Terrain reset to procedural baseline.';
        renderUI();
      }
    });
    drawButton(604, 335, 230, 52, '↺ Reset Terrain');
  }

  function renderTreesTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('TREE PALETTE PRESETS (Updates Trunk & Leaf Chunk Colors):', 36, 172);

    const presets = [
      { id: 'summer', label: '🌲 Lush Summer' },
      { id: 'autumn', label: '🍂 Golden Autumn' },
      { id: 'sakura', label: '🌸 Sakura Blossom' },
      { id: 'mystic', label: '🔮 Mystic Fantasy' },
      { id: 'frost',  label: '❄️ Alpine Frost' }
    ];

    const pw = 178;
    presets.forEach((p, i) => {
      const px = 36 + i * (pw + 16);
      const py = 192;
      registerBtn(`preset_${p.id}`, px, py, pw, 50, p.label, () => {
        applyTreePreset(p.id);
        state.statusMsg = `Applied tree preset: ${p.label}!`;
        renderUI();
      });
      drawButton(px, py, pw, 50, p.label);
    });

    ctx.fillStyle = '#eaf2df';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('CUSTOM TREE SAMPLER & INTERACTIVE TOOLS:', 36, 282);

    // Tree Set selector
    registerBtn('type_conifer', 36, 302, 180, 48, '🌲 Conifer Pine', () => {
      state.selectedTreeType = 'conifer';
      state.statusMsg = 'Selected: Conifer Pine trees.';
      renderUI();
    }, state.selectedTreeType === 'conifer');
    drawButton(36, 302, 180, 48, '🌲 Conifer Pine', state.selectedTreeType === 'conifer');

    registerBtn('type_broad', 226, 302, 180, 48, '🌳 Broadleaf Oak', () => {
      state.selectedTreeType = 'broad';
      state.statusMsg = 'Selected: Broadleaf Oak trees.';
      renderUI();
    }, state.selectedTreeType === 'broad');
    drawButton(226, 302, 180, 48, '🌳 Broadleaf Oak', state.selectedTreeType === 'broad');

    // Stamp & Cluster & Eraser Tools
    registerBtn('tool_stamp', 430, 302, 170, 48, '📍 Stamp Tree', () => {
      state.activeTool = 'tree_stamp';
      state.statusMsg = '📍 Stamp Mode: Aim at ground & pull trigger to plant!';
      renderUI();
    }, state.activeTool === 'tree_stamp');
    drawButton(430, 302, 170, 48, '📍 Stamp Tree', state.activeTool === 'tree_stamp');

    registerBtn('tool_grove', 610, 302, 180, 48, '🌸 Plant Grove', () => {
      state.activeTool = 'tree_cluster';
      state.statusMsg = '🌸 Grove Mode: Pull trigger to spawn a grove of 6 trees!';
      renderUI();
    }, state.activeTool === 'tree_cluster');
    drawButton(610, 302, 180, 48, '🌸 Plant Grove', state.activeTool === 'tree_cluster');

    registerBtn('tool_erase', 800, 302, 180, 48, '🧹 Tree Eraser', () => {
      state.activeTool = 'tree_eraser';
      state.statusMsg = '🧹 Tree Eraser: Pull trigger to remove trees in radius.';
      renderUI();
    }, state.activeTool === 'tree_eraser');
    drawButton(800, 302, 180, 48, '🧹 Tree Eraser', state.activeTool === 'tree_eraser');

    // Island auto-sample buttons
    registerBtn('sample_set_only', 36, 368, 280, 48, '🌲 Sample Selected Set', () => {
      rebuildTreesPCG({ treeSet: state.selectedTreeType });
      state.statusMsg = `Sampled full island with ${state.selectedTreeType} trees!`;
      renderUI();
    });
    drawButton(36, 368, 280, 48, '🌲 Sample Selected Set');

    registerBtn('sample_balanced', 330, 368, 280, 48, '🌿 Ecological Balanced Mix', () => {
      rebuildTreesPCG({ treeSet: 'all' });
      state.statusMsg = 'Sampled balanced ecosystem (pines on ridges, oaks in valleys)!';
      renderUI();
    });
    drawButton(330, 368, 280, 48, '🌿 Ecological Balanced Mix');
  }

  function renderPropsTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('SELECT GLB ASSET TO PLACE (Aim Laser at ground & Click Trigger):', 36, 172);

    const props = [
      { id: 'cottage',  label: '🏠 Magic Cottage' },
      { id: 'shrine',   label: '🔮 Crystal Shrine' },
      { id: 'campfire', label: '🔥 Campfire' },
      { id: 'lantern',  label: '🏮 Forest Lantern' },
      { id: 'arch',     label: '🏛️ Ancient Arch' }
    ];

    const pw = 178;
    props.forEach((p, i) => {
      const px = 36 + i * (pw + 16);
      const py = 192;
      const isAct = placementState.active && placementState.assetType === p.id;

      registerBtn(`prop_${p.id}`, px, py, pw, 52, p.label, () => {
        startPlacement(p.id);
        state.activeTool = 'prop_place';
        state.statusMsg = `Placing: ${p.label}. Aim at ground & pull trigger to drop!`;
        renderUI();
      }, isAct);

      drawButton(px, py, pw, 52, p.label, isAct);
    });

    // Placement Actions
    ctx.fillStyle = '#eaf2df';
    ctx.font = 'bold 19px monospace';
    ctx.fillText('PROP MANIPULATION:', 36, 290);

    registerBtn('prop_undo', 36, 312, 220, 50, '❌ Remove Last Placed', () => {
      const removed = removeLastPlacedAsset();
      state.statusMsg = removed ? 'Removed last placed prop.' : 'No placed props to remove.';
      renderUI();
    });
    drawButton(36, 312, 220, 50, '❌ Remove Last Placed');

    registerBtn('prop_cancel', 270, 312, 200, 50, '🚫 Cancel Placement', () => {
      placementState.active = false;
      state.activeTool = 'terrain';
      state.statusMsg = 'Placement cancelled.';
      renderUI();
    });
    drawButton(270, 312, 200, 50, '🚫 Cancel Placement');
  }

  function renderWorldTab() {
    ctx.fillStyle = '#7ef088';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('NAVIGATION & LEVEL PERSISTENCE:', 36, 172);

    const isFlying = isFlyModeGetter ? isFlyModeGetter() : false;

    // Fly Mode Big Button
    registerBtn('toggle_fly', 36, 196, 290, 56, isFlying ? '🕊️ Fly Mode: ON (X)' : '🚶 Fly Mode: OFF (X)', () => {
      if (toggleFlyModeCallback) toggleFlyModeCallback();
      state.statusMsg = isFlying ? 'Walk Mode Active.' : '🕊️ Fly Mode Active! Move stick to soar in 3D.';
      renderUI();
    }, isFlying, isFlying ? '#0284c7' : '#1b2b20');
    drawButton(36, 196, 290, 56, isFlying ? '🕊️ Fly Mode: ON (X)' : '🚶 Fly Mode: OFF (X)', isFlying);

    // Save Level Button
    registerBtn('save_level', 346, 196, 280, 56, '💾 SAVE LEVEL TO STORAGE', () => {
      saveLevelToStorage(envConfig);
      state.statusMsg = '💾 Level successfully saved to browser storage!';
      renderUI();
    }, false, '#15803d');
    drawButton(346, 196, 280, 56, '💾 SAVE LEVEL', false);

    // Load Level Button
    registerBtn('load_level', 646, 196, 240, 56, '📂 LOAD SAVED LEVEL', () => {
      loadLevelFromStorage(envConfig);
      state.statusMsg = '📂 Level restored from browser storage!';
      renderUI();
    });
    drawButton(646, 196, 240, 56, '📂 LOAD LEVEL', false);

    // Time of Day Quick Presets
    ctx.fillStyle = '#eaf2df';
    ctx.font = 'bold 19px monospace';
    ctx.fillText('TIME OF DAY:', 36, 296);

    const times = [
      { label: '🌅 Sunrise', val: 0.28 },
      { label: '☀️ Noon',    val: 0.48 },
      { label: '🌇 Sunset',  val: 0.76 },
      { label: '🌙 Night',   val: 0.05 }
    ];
    times.forEach((t, i) => {
      const tx = 36 + i * (200 + 16);
      const ty = 318;
      registerBtn(`time_${i}`, tx, ty, 200, 48, t.label, () => {
        if (envConfig) {
          envConfig.timeOfDay = t.val;
          state.statusMsg = `Time set to ${t.label}.`;
          renderUI();
        }
      });
      drawButton(tx, ty, 200, 48, t.label);
    });
  }

  function drawButton(x, y, w, h, text, isActive = false) {
    ctx.fillStyle = isActive ? 'rgba(126, 240, 136, 0.45)' : 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();

    ctx.strokeStyle = isActive ? '#7ef088' : 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = isActive ? 3 : 1.5;
    ctx.stroke();

    ctx.fillStyle = isActive ? '#ffffff' : '#eaf2df';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, x + w / 2, y + h / 2 + 6);
    ctx.textAlign = 'left';
  }

  // ---------------------------------------------------------------- Raycast & Pointer Interaction

  const raycaster = new THREE.Raycaster();
  const _tempMatrix = new THREE.Matrix4();

  function raycastUI(controller) {
    if (!panelMesh.visible) return null;

    _tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_tempMatrix);

    const hits = raycaster.intersectObject(panelMesh, false);
    if (hits.length > 0) {
      const uv = hits[0].uv;
      state.cursorUv.copy(uv);
      state.isLaserHovered = true;

      const px = uv.x * CANVAS_W;
      const py = (1 - uv.y) * CANVAS_H;

      let found = null;
      for (const btn of buttons) {
        if (px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h) {
          found = btn;
          break;
        }
      }
      state.hoveredBtn = found;
      renderUI();
      return hits[0];
    } else {
      if (state.isLaserHovered) {
        state.isLaserHovered = false;
        state.hoveredBtn = null;
        renderUI();
      }
      return null;
    }
  }

  function triggerClick() {
    if (state.hoveredBtn && state.hoveredBtn.onClick) {
      state.hoveredBtn.onClick();
      return true;
    }
    return false;
  }

  function toggleVisibility() {
    panelMesh.visible = !panelMesh.visible;
  }

  renderUI();

  return {
    panelMesh,
    raycastUI,
    triggerClick,
    toggleVisibility,
    state,
    renderUI
  };
}
