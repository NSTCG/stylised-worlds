/**
 * src/transformManager.js
 * Interactive In-World Object Selection & Manipulation (Move, Rotate, Scale) with TransformControls.
 */
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { groundHeight } from './terrain.js';
import { updateGlbPlacement, removeGlbPlacement, duplicateGlbPlacement, findPlacementByObject } from './glbAssets.js';
import { getMergedMesh, getPropsGroup, getPropEntry, propIdFromFace, updatePropTransform, removeProp, duplicateProp } from './propMerger.js';
import { registerObstacle, unregisterObstacle } from './treeRules.js';
import { setupModelMaterials } from './materialFeatures.js';
import { showNotification } from './levelSerializer.js';

let _transformControls = null;
let _selectedObject = null;
let _scene = null;
let _camera = null;
let _domElement = null;
let _orbitControls = null;
let _hudElement = null;
let _isTransforming = false;
let _editMode = false;

// Merged-prop proxy: when a merged prop is selected, we create a temporary Object3D
// at its position/rotation/scale so TransformControls can attach to it.
let _mergedPropProxy = null;   // THREE.Object3D
let _selectedMergedId = null;  // prop id string from propMerger

export function setEditMode(enabled) {
  _editMode = !!enabled;
  if (!_editMode) deselectObject();
  return _editMode;
}
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
      if (event.value) {
        _orbitControls.enabled = false;
      } else {
        // Re-enable OrbitControls only if we are in Inspect Mode
        _orbitControls.enabled = !!(window.isInspectMode || _orbitControls.isInspectMode);
      }
    }
    if (!event.value && _selectedObject) {
      // Finished dragging: update placement matrix & tree obstacle (GLB props only)
      if (_selectedMergedId) {
        // Re-bake merged prop vertices from proxy transform
        _selectedObject.updateMatrixWorld(true);
        updatePropTransform(_selectedMergedId, _selectedObject.matrix);
      } else if (findPlacementByObject(_selectedObject)) {
        updateGlbPlacement(_selectedObject);
      }
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
    // Edit Mode must be ON to select/manipulate models
    if (!_editMode) return;

    // Check if click was on HUD
    if (_hudElement && _hudElement.contains(e.target)) return;

    const rect = domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // 1. Try merged prop mesh first
    const merged = getMergedMesh();
    if (merged) {
      const mHits = raycaster.intersectObject(merged, false);
      if (mHits.length > 0) {
        const faceIdx = mHits[0].faceIndex;
        const propId = propIdFromFace(faceIdx);
        if (propId) {
          _selectMergedProp(propId);
          return;
        }
      }
    }

    // 2. Fallback: non-merged candidates (placed GLB props, clusters)
    const candidates = [];
    scene.traverse((obj) => {
      if (!obj.name) return;
      const n = obj.name;
      const isEditable =
        n.startsWith('glb_') ||
        n.startsWith('prop_') ||
        n === 'farmstead_cluster' ||
        n === 'fishing_dock_cluster';
      if (isEditable || obj.userData?.assetId) {
        candidates.push(obj);
      }
    });

    if (candidates.length === 0) return;

    const intersects = raycaster.intersectObjects(candidates, true);
    if (intersects.length > 0) {
      let hit = intersects[0].object;
      while (hit.parent && hit.parent !== scene && !hit.userData?.assetId && !_isEditableRoot(hit)) {
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
    duplicateSelected,
    setEditMode,
    getEditMode: () => _editMode,
    isTransforming: () => _isTransforming
  };
}

export function isTransforming() {
  return _isTransforming;
}

function _isEditableRoot(obj) {
  if (!obj.name) return false;
  const n = obj.name;
  return (
    n.startsWith('glb_') ||
    n.startsWith('prop_') ||
    n === 'farmstead_cluster' ||
    n === 'fishing_dock_cluster' ||
    !!obj.userData?.assetId
  );
}

export function selectObject(object) {
  if (!object || _selectedObject === object) return;
  _cleanupMergedProxy(); // clear any previous merged selection
  _selectedObject = object;
  _selectedMergedId = null;
  _transformControls.attach(object);
  _showHud();
  _syncHudValues();

  const p = findPlacementByObject(object);
  const name = p ? p.name : object.name;
  showNotification(`Selected: ${name} (W: Move · E: Rotate · R: Scale · G: Snap)`, 'info', 2200);
}

/** Select a prop inside the merged mesh by creating a proxy Object3D. */
function _selectMergedProp(propId) {
  const entry = getPropEntry(propId);
  if (!entry) return;
  _cleanupMergedProxy();

  // Create a proxy Object3D at the prop's transform
  _mergedPropProxy = new THREE.Object3D();
  _mergedPropProxy.name = `proxy_${propId}`;
  entry.matrix.decompose(_mergedPropProxy.position, _mergedPropProxy.quaternion, _mergedPropProxy.scale);
  _mergedPropProxy.updateMatrixWorld(true);
  const pg = getPropsGroup();
  if (pg) pg.add(_mergedPropProxy); else _scene.add(_mergedPropProxy);

  _selectedObject = _mergedPropProxy;
  _selectedMergedId = propId;
  _transformControls.attach(_mergedPropProxy);
  _showHud();
  _syncHudValues();

  const label = entry.assetKey || propId;
  showNotification(`Selected merged prop: ${label} (W: Move · E: Rotate · R: Scale · G: Snap)`, 'info', 2200);
}

function _cleanupMergedProxy() {
  if (_mergedPropProxy) {
    _transformControls.detach();
    if (_mergedPropProxy.parent) _mergedPropProxy.parent.remove(_mergedPropProxy);
    _mergedPropProxy = null;
  }
  _selectedMergedId = null;
}

export function deselectObject() {
  if (!_selectedObject) return;
  _cleanupMergedProxy();
  _transformControls.detach();
  _selectedObject = null;
  _selectedMergedId = null;
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

  if (_selectedMergedId) {
    // For merged props, use entry bbox to find bottom
    const entry = getPropEntry(_selectedMergedId);
    if (entry) {
      const curMinY = entry.bboxMin.y + pos.y; // bbox is in entry-local space shifted by pos
      const dy = gh - curMinY;
      _selectedObject.position.y += dy;
      _selectedObject.updateMatrixWorld(true);
      updatePropTransform(_selectedMergedId, _selectedObject.matrix);
    }
  } else {
    const box = new THREE.Box3().setFromObject(_selectedObject);
    const curMinY = box.min.y;
    const dy = gh - curMinY;
    _selectedObject.position.y += dy;
    _selectedObject.updateMatrixWorld(true);
    if (findPlacementByObject(_selectedObject)) updateGlbPlacement(_selectedObject);
  }
  _syncHudValues();
  showNotification('Snapped to terrain elevation', 'success', 1600);
}

export function deleteSelected() {
  if (!_selectedObject) return;
  if (_selectedMergedId) {
    const id = _selectedMergedId;
    deselectObject();
    removeProp(id);
    showNotification('Removed merged prop', 'warn', 1600);
    return;
  }
  const target = _selectedObject;
  deselectObject();
  removeGlbPlacement(target);
  showNotification('Removed 3D prop', 'warn', 1600);
}

export function duplicateSelected() {
  if (!_selectedObject) return;
  if (_selectedMergedId) {
    const newId = duplicateProp(_selectedMergedId, new THREE.Vector3(2, 0, 2));
    if (newId) {
      _selectMergedProp(newId);
      showNotification('Duplicated merged prop (offset by +2m)', 'success', 1800);
    }
    return;
  }
  const p = findPlacementByObject(_selectedObject);
  let clone = null;
  if (p) {
    clone = duplicateGlbPlacement(_selectedObject);
  } else {
    clone = _selectedObject.clone(true);
    clone.name = `prop_dup_${Date.now().toString(36)}`;
    clone.position.x += 2.0;
    clone.position.z += 2.0;
    setupModelMaterials(clone);
    if (_scene) _scene.add(clone);
  }
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

    <!-- Direct Numeric Transform Inputs -->
    <div style="display:flex; align-items:center; gap:6px; font-size:11px;">
      <div style="display:flex; align-items:center; gap:2px;">
        <span style="color:#7ef088; font-weight:bold;">Pos:</span>
        <input id="editPosX" type="number" step="0.2" class="transform-num-input" style="width:46px;" title="X Position">
        <input id="editPosY" type="number" step="0.2" class="transform-num-input" style="width:46px;" title="Y Position">
        <input id="editPosZ" type="number" step="0.2" class="transform-num-input" style="width:46px;" title="Z Position">
      </div>
      <div style="display:flex; align-items:center; gap:2px;">
        <span style="color:#ffd57e; font-weight:bold;">Yaw:</span>
        <input id="editRotY" type="number" step="5" class="transform-num-input" style="width:42px;" title="Yaw Rotation in Degrees">°
      </div>
      <div style="display:flex; align-items:center; gap:2px;">
        <span style="color:#38bdf8; font-weight:bold;">Scale:</span>
        <input id="editScale" type="number" step="0.05" min="0.05" class="transform-num-input" style="width:42px;" title="Scale Multiplier">×
      </div>
    </div>

    <div style="height:16px; width:1px; background:rgba(255,255,255,0.18);"></div>

    <!-- Actions -->
    <div style="display:flex; gap:3px;">
      <button id="gizmoBtnSnap" class="gizmo-btn" title="Snap to Terrain Elevation (G)">⛰️ Snap</button>
      <button id="gizmoBtnDup" class="gizmo-btn" title="Duplicate (Ctrl+D)">📋 Clone</button>
      <button id="gizmoBtnDel" class="gizmo-btn" style="color:#ff8b8b;" title="Delete Object (Del)">🗑️ Del</button>
      <button id="gizmoBtnClose" class="gizmo-btn" title="Deselect (Esc)">✖</button>
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
    .transform-num-input {
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid rgba(255, 255, 255, 0.22);
      color: #fff;
      font: 10.5px monospace;
      padding: 2px 4px;
      border-radius: 4px;
      outline: none;
      text-align: right;
    }
    .transform-num-input:focus {
      border-color: #38bdf8;
      background: rgba(0, 0, 0, 0.7);
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(_hudElement);

  // Hook HUD buttons
  _hudElement.querySelector('#gizmoBtnMove').addEventListener('click', () => setTransformMode('translate'));
  _hudElement.querySelector('#gizmoBtnRotate').addEventListener('click', () => setTransformMode('rotate'));
  _hudElement.querySelector('#gizmoBtnScale').addEventListener('click', () => setTransformMode('scale'));
  _hudElement.querySelector('#gizmoBtnSnap').addEventListener('click', () => snapSelectedToGround());
  _hudElement.querySelector('#gizmoBtnDup').addEventListener('click', () => duplicateSelected());
  _hudElement.querySelector('#gizmoBtnDel').addEventListener('click', () => deleteSelected());
  _hudElement.querySelector('#gizmoBtnClose').addEventListener('click', () => deselectObject());

  // Hook HUD numeric input changes
  const applyHudTransforms = () => {
    if (!_selectedObject) return;
    const nx = parseFloat(_hudElement.querySelector('#editPosX')?.value);
    const ny = parseFloat(_hudElement.querySelector('#editPosY')?.value);
    const nz = parseFloat(_hudElement.querySelector('#editPosZ')?.value);
    const nrot = parseFloat(_hudElement.querySelector('#editRotY')?.value);
    const nscl = parseFloat(_hudElement.querySelector('#editScale')?.value);

    if (Number.isFinite(nx)) _selectedObject.position.x = nx;
    if (Number.isFinite(ny)) _selectedObject.position.y = ny;
    if (Number.isFinite(nz)) _selectedObject.position.z = nz;
    if (Number.isFinite(nrot)) _selectedObject.rotation.y = THREE.MathUtils.degToRad(nrot);
    if (Number.isFinite(nscl) && nscl > 0) _selectedObject.scale.set(nscl, nscl, nscl);

    _selectedObject.updateMatrixWorld(true);
    if (findPlacementByObject(_selectedObject)) updateGlbPlacement(_selectedObject);
    _syncHudValues(true);
  };

  _hudElement.querySelectorAll('.transform-num-input').forEach((inp) => {
    inp.addEventListener('input', applyHudTransforms);
    inp.addEventListener('keydown', (e) => e.stopPropagation());
  });

  // Hook Side Panel transform inputs and buttons
  const panelGroup = document.getElementById('editTransformGroup');
  if (panelGroup) {
    const applyPanelTransforms = () => {
      if (!_selectedObject) return;
      const nx = parseFloat(document.getElementById('panelPosX')?.value);
      const ny = parseFloat(document.getElementById('panelPosY')?.value);
      const nz = parseFloat(document.getElementById('panelPosZ')?.value);
      const nrot = parseFloat(document.getElementById('panelRotY')?.value);
      const nscl = parseFloat(document.getElementById('panelScale')?.value);

      if (Number.isFinite(nx)) _selectedObject.position.x = nx;
      if (Number.isFinite(ny)) _selectedObject.position.y = ny;
      if (Number.isFinite(nz)) _selectedObject.position.z = nz;
      if (Number.isFinite(nrot)) _selectedObject.rotation.y = THREE.MathUtils.degToRad(nrot);
      if (Number.isFinite(nscl) && nscl > 0) _selectedObject.scale.set(nscl, nscl, nscl);

      _selectedObject.updateMatrixWorld(true);
      if (findPlacementByObject(_selectedObject)) updateGlbPlacement(_selectedObject);
      _syncHudValues(true);
    };

    ['panelPosX', 'panelPosY', 'panelPosZ', 'panelRotY', 'panelScale'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', applyPanelTransforms);
        el.addEventListener('keydown', (e) => e.stopPropagation());
      }
    });

    document.getElementById('panelBtnMove')?.addEventListener('click', () => setTransformMode('translate'));
    document.getElementById('panelBtnRotate')?.addEventListener('click', () => setTransformMode('rotate'));
    document.getElementById('panelBtnScale')?.addEventListener('click', () => setTransformMode('scale'));
    document.getElementById('panelBtnSnap')?.addEventListener('click', () => snapSelectedToGround());
    document.getElementById('panelBtnClone')?.addEventListener('click', () => duplicateSelected());
    document.getElementById('panelBtnDelete')?.addEventListener('click', () => deleteSelected());
  }
}

function _showHud() {
  if (!_hudElement) return;
  _hudElement.style.display = 'flex';
  const nameEl = _hudElement.querySelector('#gizmoPropName');
  const panelNameEl = document.getElementById('panelPropName');
  const panelGroup = document.getElementById('editTransformGroup');
  if (panelGroup) panelGroup.style.display = 'block';

  if (_selectedObject) {
    const p = findPlacementByObject(_selectedObject);
    const propName = p ? p.name : _selectedObject.name.replace(/^glb_/, '').replace(/^prop_/, '');
    if (nameEl) nameEl.textContent = propName;
    if (panelNameEl) panelNameEl.textContent = propName;
  }
  _syncHudValues();
}

function _hideHud() {
  if (_hudElement) _hudElement.style.display = 'none';
  const panelGroup = document.getElementById('editTransformGroup');
  if (panelGroup) panelGroup.style.display = 'none';
}

function _updateHudModeButtons(mode) {
  if (_hudElement) {
    _hudElement.querySelector('#gizmoBtnMove')?.classList.toggle('active', mode === 'translate');
    _hudElement.querySelector('#gizmoBtnRotate')?.classList.toggle('active', mode === 'rotate');
    _hudElement.querySelector('#gizmoBtnScale')?.classList.toggle('active', mode === 'scale');
  }
  document.getElementById('panelBtnMove')?.classList.toggle('active', mode === 'translate');
  document.getElementById('panelBtnRotate')?.classList.toggle('active', mode === 'rotate');
  document.getElementById('panelBtnScale')?.classList.toggle('active', mode === 'scale');
}

function _syncHudValues(skipActive = false) {
  if (!_selectedObject) return;
  const pos = _selectedObject.position;
  const rot = _selectedObject.rotation;
  const scl = _selectedObject.scale;
  const yawDeg = Math.round(rot.y * (180 / Math.PI));

  // Sync HUD inputs
  if (_hudElement) {
    const inX = _hudElement.querySelector('#editPosX');
    const inY = _hudElement.querySelector('#editPosY');
    const inZ = _hudElement.querySelector('#editPosZ');
    const inRot = _hudElement.querySelector('#editRotY');
    const inScl = _hudElement.querySelector('#editScale');

    if (inX && (!skipActive || document.activeElement !== inX)) inX.value = pos.x.toFixed(2);
    if (inY && (!skipActive || document.activeElement !== inY)) inY.value = pos.y.toFixed(2);
    if (inZ && (!skipActive || document.activeElement !== inZ)) inZ.value = pos.z.toFixed(2);
    if (inRot && (!skipActive || document.activeElement !== inRot)) inRot.value = yawDeg;
    if (inScl && (!skipActive || document.activeElement !== inScl)) inScl.value = scl.x.toFixed(2);
  }

  // Sync Side Panel inputs
  const pX = document.getElementById('panelPosX');
  const pY = document.getElementById('panelPosY');
  const pZ = document.getElementById('panelPosZ');
  const pRot = document.getElementById('panelRotY');
  const pScl = document.getElementById('panelScale');

  if (pX && (!skipActive || document.activeElement !== pX)) pX.value = pos.x.toFixed(2);
  if (pY && (!skipActive || document.activeElement !== pY)) pY.value = pos.y.toFixed(2);
  if (pZ && (!skipActive || document.activeElement !== pZ)) pZ.value = pos.z.toFixed(2);
  if (pRot && (!skipActive || document.activeElement !== pRot)) pRot.value = yawDeg;
  if (pScl && (!skipActive || document.activeElement !== pScl)) pScl.value = scl.x.toFixed(2);
}
