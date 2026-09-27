/**
 * src/transformManager.js
 * Interactive In-World Object Selection & Manipulation (Move, Rotate, Scale) with TransformControls.
 */
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { groundHeight } from './terrain.js';
import { updateGlbPlacement, removeGlbPlacement, duplicateGlbPlacement, findPlacementByObject } from './glbAssets.js';
import { showNotification } from './levelSerializer.js';

let _transformControls = null;
let _selectedObject = null;
let _scene = null;
let _camera = null;
let _domElement = null;
let _orbitControls = null;
let _hudElement = null;
let _isTransforming = false;

export function setupTransformManager(scene, camera, domElement, orbitControls) {
  _scene = scene;
  _camera = camera;
  _domElement = domElement;
  _orbitControls = orbitControls;

  _transformControls = new TransformControls(camera, domElement);
  _transformControls.size = 0.85;
  _transformControls.setSpace('world');
  scene.add(_transformControls);

  _createTransformHud();

  // Suspend OrbitControls during transform drag
  _transformControls.addEventListener('dragging-changed', (event) => {
    _isTransforming = event.value;
    if (_orbitControls) {
      _orbitControls.enabled = !event.value;
    }
    if (!event.value && _selectedObject) {
      // Finished dragging: update placement matrix & tree obstacle
      updateGlbPlacement(_selectedObject);
      _syncHudValues();
    }
  });

  _transformControls.addEventListener('change', () => {
    if (_selectedObject) {
      _syncHudValues();
    }
  });

  // Raycasting for selecting placed objects on Left Click
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  domElement.addEventListener('pointerdown', (e) => {
    // Only handle left clicks when not already dragging transform gizmo
    if (e.button !== 0 || _isTransforming) return;

    // Check if click was on HUD
    if (_hudElement && _hudElement.contains(e.target)) return;

    // Only pick if editor brush is NOT in continuous paint mode (e.g. grass, no_grass, water, raise, lower)
    const brushType = window.terrainEditor?.editorState?.brushType;
    const isPaintBrush = ['grass', 'no_grass', 'sand', 'road', 'water', 'raise', 'lower', 'smooth', 'rock'].includes(brushType);
    if (isPaintBrush && e.shiftKey === false && window.terrainEditor?.editorState?.isPainting) return;

    const rect = domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Collect all candidates (objects with name starting with 'glb_' or tagged)
    const candidates = [];
    scene.traverse((obj) => {
      if (obj.name && (obj.name.startsWith('glb_') || obj.userData?.assetId)) {
        candidates.push(obj);
      }
    });

    if (candidates.length === 0) return;

    const intersects = raycaster.intersectObjects(candidates, true);
    if (intersects.length > 0) {
      // Find top-level model group
      let hit = intersects[0].object;
      while (hit.parent && hit.parent !== scene && !hit.name.startsWith('glb_') && !hit.userData?.assetId) {
        hit = hit.parent;
      }
      selectObject(hit);
    }
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (!_selectedObject) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const k = e.key.toLowerCase();
    if (k === 'w' || k === '1') {
      setTransformMode('translate');
    } else if (k === 'e' || k === '2') {
      setTransformMode('rotate');
    } else if (k === 'r' || k === '3') {
      setTransformMode('scale');
    } else if (k === 'g') {
      snapSelectedToGround();
    } else if (e.key === 'Escape') {
      deselectObject();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelected();
    } else if ((e.ctrlKey || e.metaKey) && k === 'd') {
      e.preventDefault();
      duplicateSelected();
    }
  });

  return {
    selectObject,
    deselectObject,
    getSelectedObject: () => _selectedObject,
    setTransformMode,
    snapSelectedToGround,
    deleteSelected,
    duplicateSelected
  };
}

export function selectObject(object) {
  if (!object || _selectedObject === object) return;
  _selectedObject = object;
  _transformControls.attach(object);
  _showHud();
  _syncHudValues();

  const p = findPlacementByObject(object);
  const name = p ? p.name : object.name;
  showNotification(`Selected: ${name} (W: Move · E: Rotate · R: Scale · G: Snap)`, 'info', 2200);
}

export function deselectObject() {
  if (!_selectedObject) return;
  _transformControls.detach();
  _selectedObject = null;
  _hideHud();
}

export function setTransformMode(mode) {
  if (!_transformControls) return;
  _transformControls.setMode(mode);
  _updateHudModeButtons(mode);
}

export function snapSelectedToGround() {
  if (!_selectedObject) return;
  const pos = _selectedObject.position;
  const gh = groundHeight(pos.x, pos.z);

  // Compute bounding box bottom offset
  const box = new THREE.Box3().setFromObject(_selectedObject);
  const curMinY = box.min.y;
  const dy = gh - curMinY;

  _selectedObject.position.y += dy;
  _selectedObject.updateMatrixWorld(true);
  updateGlbPlacement(_selectedObject);
  _syncHudValues();
  showNotification('Snapped to terrain elevation', 'success', 1600);
}

export function deleteSelected() {
  if (!_selectedObject) return;
  const target = _selectedObject;
  deselectObject();
  removeGlbPlacement(target);
  showNotification('Removed 3D prop', 'warn', 1600);
}

export function duplicateSelected() {
  if (!_selectedObject) return;
  const clone = duplicateGlbPlacement(_selectedObject);
  if (clone) {
    selectObject(clone);
    showNotification('Duplicated prop (offset by +2m)', 'success', 1800);
  }
}

// ---------------------------------------------------------------- Floating Transform HUD
function _createTransformHud() {
  if (_hudElement) return;

  _hudElement = document.createElement('div');
  _hudElement.id = 'transformGizmoHud';
  _hudElement.style.cssText = `
    position: fixed;
    bottom: 58px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    display: none;
    align-items: center;
    gap: 8px;
    background: rgba(12, 18, 14, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 16px;
    padding: 6px 14px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    font: 11.5px/1.3 ui-monospace, Consolas, monospace;
    color: #eaf2df;
    user-select: none;
    transition: all 0.2s ease;
  `;

  _hudElement.innerHTML = `
    <div style="display:flex; align-items:center; gap:6px; padding-right:8px; border-right:1px solid rgba(255,255,255,0.18);">
      <span style="font-size:13px;">📦</span>
      <b id="gizmoPropName" style="color:#7ef088; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Prop</b>
    </div>

    <!-- Mode toggles -->
    <div style="display:flex; gap:3px;">
      <button id="gizmoBtnMove" class="gizmo-btn active" title="Move Object (W / 1)">✥ Move</button>
      <button id="gizmoBtnRotate" class="gizmo-btn" title="Rotate Object (E / 2)">🔄 Rotate</button>
      <button id="gizmoBtnScale" class="gizmo-btn" title="Scale Object (R / 3)">⤢ Scale</button>
    </div>

    <div style="height:16px; width:1px; background:rgba(255,255,255,0.18);"></div>

    <!-- Actions -->
    <div style="display:flex; gap:3px;">
      <button id="gizmoBtnSnap" class="gizmo-btn" title="Snap to Terrain Elevation (G)">⛰️ Snap</button>
      <button id="gizmoBtnDup" class="gizmo-btn" title="Duplicate (Ctrl+D)">📋 Clone</button>
      <button id="gizmoBtnDel" class="gizmo-btn" style="color:#ff8b8b;" title="Delete Object (Del)">🗑️ Del</button>
      <button id="gizmoBtnClose" class="gizmo-btn" title="Deselect (Esc)">✖</button>
    </div>

    <div style="height:16px; width:1px; background:rgba(255,255,255,0.18);"></div>

    <!-- Coordinates Display -->
    <div style="display:flex; align-items:center; gap:6px; font-size:10px; color:rgba(235,245,225,0.75);">
      <span>Pos: <span id="gizmoPosReadout" style="color:#fff; font-weight:bold;">0, 0, 0</span></span>
      <span>Yaw: <span id="gizmoYawReadout" style="color:#ffd57e; font-weight:bold;">0°</span></span>
      <span>Scale: <span id="gizmoScaleReadout" style="color:#38bdf8; font-weight:bold;">1.0×</span></span>
    </div>
  `;

  // Style button rules
  const style = document.createElement('style');
  style.textContent = `
    .gizmo-btn {
      cursor: pointer;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.22);
      color: #eaf2df;
      border-radius: 8px;
      font: 11px monospace;
      padding: 3px 8px;
      transition: all 0.15s;
    }
    .gizmo-btn:hover {
      background: rgba(255, 255, 255, 0.26);
      color: #fff;
    }
    .gizmo-btn.active {
      background: rgba(126, 240, 136, 0.35);
      border-color: #7ef088;
      color: #fff;
      font-weight: bold;
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(_hudElement);

  // Hook buttons
  _hudElement.querySelector('#gizmoBtnMove').addEventListener('click', () => setTransformMode('translate'));
  _hudElement.querySelector('#gizmoBtnRotate').addEventListener('click', () => setTransformMode('rotate'));
  _hudElement.querySelector('#gizmoBtnScale').addEventListener('click', () => setTransformMode('scale'));
  _hudElement.querySelector('#gizmoBtnSnap').addEventListener('click', () => snapSelectedToGround());
  _hudElement.querySelector('#gizmoBtnDup').addEventListener('click', () => duplicateSelected());
  _hudElement.querySelector('#gizmoBtnDel').addEventListener('click', () => deleteSelected());
  _hudElement.querySelector('#gizmoBtnClose').addEventListener('click', () => deselectObject());
}

function _showHud() {
  if (!_hudElement) return;
  _hudElement.style.display = 'flex';
  const nameEl = _hudElement.querySelector('#gizmoPropName');
  if (nameEl && _selectedObject) {
    const p = findPlacementByObject(_selectedObject);
    nameEl.textContent = p ? p.name : _selectedObject.name.replace(/^glb_/, '');
  }
}

function _hideHud() {
  if (!_hudElement) return;
  _hudElement.style.display = 'none';
}

function _updateHudModeButtons(mode) {
  if (!_hudElement) return;
  const moveBtn = _hudElement.querySelector('#gizmoBtnMove');
  const rotBtn = _hudElement.querySelector('#gizmoBtnRotate');
  const sclBtn = _hudElement.querySelector('#gizmoBtnScale');

  moveBtn.classList.toggle('active', mode === 'translate');
  rotBtn.classList.toggle('active', mode === 'rotate');
  sclBtn.classList.toggle('active', mode === 'scale');
}

function _syncHudValues() {
  if (!_hudElement || !_selectedObject) return;
  const pos = _selectedObject.position;
  const rot = _selectedObject.rotation;
  const scl = _selectedObject.scale;

  const posEl = _hudElement.querySelector('#gizmoPosReadout');
  if (posEl) posEl.textContent = `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`;

  const yawEl = _hudElement.querySelector('#gizmoYawReadout');
  if (yawEl) {
    const deg = Math.round(rot.y * (180 / Math.PI));
    yawEl.textContent = `${deg}°`;
  }

  const sclEl = _hudElement.querySelector('#gizmoScaleReadout');
  if (sclEl) sclEl.textContent = `${scl.x.toFixed(2)}×`;
}
