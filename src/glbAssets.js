/**
 * src/glbAssets.js — Browser-only GLB asset loading & placement with obstacle collision.
 *
 * Pre-populates with built-in stylized fantasy props (Cottage, Shrine, Campfire, Lantern, Arch),
 * supports loading external .glb files, registers obstacles in treeRules so trees won't spawn
 * inside placed structures, and saves/restores placements with level data.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyAtmosphericFog } from './environment.js';
import { setupModelMaterials } from './materialFeatures.js';
import { ASSET_DEFINITIONS } from './assetsManager.js';
import { registerObstacle, unregisterObstacle } from './treeRules.js';
import { eraseTreesInRadius } from './trees.js';

const _assets = new Map(); // name -> { scene, size: Vector3, radius: number }
let _selectedName = 'cottage';
let _placements = [];      // { name, m: number[16] }
let _nextId = 0;

// Initialize built-in stylized props into the asset cache
function _initBuiltInProps() {
  for (const [key, def] of Object.entries(ASSET_DEFINITIONS)) {
    const scene = def.create();
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    _assets.set(key, { scene, size, radius: def.radius });
  }
}
_initBuiltInProps();

/**
 * Load a .glb file into the asset cache.
 * @returns {Promise<string>} asset name on success
 */
export function loadGlbFile(file) {
  const name = file.name.replace(/\.glb$/i, '');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const loader = new GLTFLoader();
      loader.parse(reader.result, '', (gltf) => {
        const scene = gltf.scene;
        // Normalize: center on origin, scale to ~2.5m reference height.
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        scene.position.sub(center);
        scene.position.y += size.y * 0.5; // Sit on ground
        const refH = Math.max(size.y, 0.001);
        const s = 2.5 / refH;
        scene.scale.setScalar(s);

        const radius = Math.max(size.x, size.z) * 0.5 * s;
        _assets.set(name, { scene, size, radius });
        _selectedName = name;
        resolve(name);
      }, reject);
    };
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsArrayBuffer(file);
  });
}

export function listGlbAssets() { return Array.from(_assets.keys()); }

export function selectGlbAsset(name) {
  if (_assets.has(name)) _selectedName = name;
}

export function getSelectedGlbAsset() { return _selectedName; }

/** Current placement transform settings (sliders). */
export const glbSettings = { scale: 1.0, yaw: 0 };

function _placeClone(name, point, scale, yaw) {
  const entry = _assets.get(name);
  if (!entry || !point) return null;
  const clone = entry.scene.clone(true);
  const id = `glb_${name}_${_nextId++}`;
  clone.name = id;

  // Patch materials for atmospheric fog & terrain contact ground blending
  setupModelMaterials(clone, { blendDistance: 0.35, blendStrength: 0.85 });

  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const S = new THREE.Vector3(scale, scale, scale);
  M.compose(new THREE.Vector3(point.x, point.y - 0.02, point.z), Q, S);
  clone.applyMatrix4(M);

  // 1. Register obstacle in treeRules so trees never spawn inside placed asset
  const obstacleRadius = (entry.radius || 2.5) * scale;
  registerObstacle(id, point.x, point.z, obstacleRadius);

  // 2. Erase any pre-existing trees poking through this placed asset
  eraseTreesInRadius(point.x, point.z, obstacleRadius + 0.8);

  _placements.push({ name, m: Array.from(clone.matrix.elements), id, x: point.x, z: point.z, radius: obstacleRadius });
  return clone;
}

/**
 * Place the selected GLB at a world point (ground hit).
 * @returns {THREE.Object3D|null} placed clone
 */
export function placeGlbAt(point) {
  const clone = _placeClone(_selectedName, point, glbSettings.scale, glbSettings.yaw);
  if (clone) window.scene?.add(clone);
  return clone;
}

/** Serialize placements for level save. */
export function getGlbData() {
  return _placements.map(p => ({ name: p.name, m: p.m }));
}

/** Restore placements from saved level data (removes existing clones first). */
export function applyGlbData(data) {
  if (!window.scene) return;
  const scene = window.scene;
  for (const o of Array.from(scene.children)) {
    if (o.name.startsWith('glb_')) {
      unregisterObstacle(o.name);
      scene.remove(o);
    }
  }
  _placements = [];
  for (const p of data || []) {
    const entry = _assets.get(p.name);
    if (!entry) continue; // asset not loaded this session — skip
    const clone = entry.scene.clone(true);
    const id = `glb_${p.name}_${_nextId++}`;
    clone.name = id;
    setupModelMaterials(clone, { blendDistance: 0.35, blendStrength: 0.85 });
    const M = new THREE.Matrix4().fromArray(p.m);
    clone.applyMatrix4(M);
    scene.add(clone);

    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    M.decompose(pos, rot, scl);

    const obstacleRadius = (entry.radius || 2.5) * scl.x;
    registerObstacle(id, pos.x, pos.z, obstacleRadius);

    _placements.push({ name: p.name, m: Array.from(clone.matrix.elements), id, x: pos.x, z: pos.z, radius: obstacleRadius });
  }
}

/**
 * Register a loaded or optimized 3D model into the active asset cache.
 */
export function registerGlbAsset(name, scene, options = {}) {
  // Normalize: center on origin, sit on ground, scale to reasonable reference height ~3.0m
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // Center bottom pivot
  scene.position.sub(center);
  scene.position.y += size.y * 0.5;

  const refH = Math.max(size.y, 0.001);
  const targetH = options.referenceHeight || 3.0;
  const s = targetH / refH;
  scene.scale.setScalar(s);

  const radius = Math.max(size.x, size.z) * 0.5 * s;
  _assets.set(name, { scene, size, radius });
  _selectedName = name;
  return { name, radius, size };
}

/** Find placement record corresponding to a placed Three.js object */
export function findPlacementByObject(object) {
  if (!object) return null;
  return _placements.find(p => p.id === object.name) || null;
}

/** Update placement record and tree obstacle after Move / Rotate / Scale */
export function updateGlbPlacement(object) {
  if (!object) return;
  const p = findPlacementByObject(object);
  object.updateMatrixWorld(true);

  const pos = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  object.matrixWorld.decompose(pos, rot, scl);

  const entry = p ? _assets.get(p.name) : null;
  const baseRadius = entry ? entry.radius : 2.5;
  const newRadius = baseRadius * Math.max(scl.x, scl.z);

  if (p) {
    p.m = Array.from(object.matrix.elements);
    p.x = pos.x;
    p.z = pos.z;
    p.radius = newRadius;
  }

  // Sync tree obstacle collision
  registerObstacle(object.name, pos.x, pos.z, newRadius);
  eraseTreesInRadius(pos.x, pos.z, newRadius + 0.8);
}

/** Remove placed asset from scene and obstacle registry */
export function removeGlbPlacement(object) {
  if (!object) return false;
  const idx = _placements.findIndex(p => p.id === object.name);
  if (idx !== -1) {
    _placements.splice(idx, 1);
  }
  unregisterObstacle(object.name);
  if (object.parent) {
    object.parent.remove(object);
  }
  return true;
}

/** Duplicate placed asset with small offset */
export function duplicateGlbPlacement(object) {
  if (!object) return null;
  const p = findPlacementByObject(object);
  const assetName = p ? p.name : _selectedName;
  const entry = _assets.get(assetName);
  if (!entry) return null;

  const clone = entry.scene.clone(true);
  const id = `glb_${assetName}_${_nextId++}`;
  clone.name = id;

  setupModelMaterials(clone, { blendDistance: 0.35, blendStrength: 0.85 });

  const pos = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  object.matrix.decompose(pos, rot, scl);

  // Offset duplicated position slightly
  pos.x += 2.0;
  pos.z += 2.0;

  const M = new THREE.Matrix4().compose(pos, rot, scl);
  clone.applyMatrix4(M);
  window.scene?.add(clone);

  const radius = (entry.radius || 2.5) * scl.x;
  registerObstacle(id, pos.x, pos.z, radius);
  eraseTreesInRadius(pos.x, pos.z, radius + 0.8);

  _placements.push({ name: assetName, m: Array.from(clone.matrix.elements), id, x: pos.x, z: pos.z, radius });
  return clone;
}

export function getAllPlacements() {
  return _placements;
}

/** Handle passed to terrainEditor for brush placement. */
export function getGlbHandle() {
  return { placeAt: (p) => placeGlbAt(p) };
}
