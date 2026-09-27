/**
 * src/assetsManager.js
 * Manages loading, procedural generation, interactive placement, and serialization
 * of GLB models and stylized fantasy world props.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { groundHeight } from './terrain.js';
import { registerObstacle, unregisterObstacle } from './treeRules.js';
import { eraseTreesInRadius } from './trees.js';

const gltfLoader = new GLTFLoader();

// ---------------------------------------------------------------- Placed Assets Registry
export const placedAssets = []; // Array of { id, type, name, mesh, radius, customData }
let _sceneRef = null;
let _cameraRef = null;

export const placementState = {
  active: false,
  assetType: 'cottage', // 'cottage' | 'shrine' | 'campfire' | 'lantern' | 'arch' | 'custom'
  customGlbUrl: null,
  customName: '',
  customMesh: null,
  ghostMesh: null,
  rotationY: 0,
  scale: 1.0,
  selectedAsset: null
};

// ---------------------------------------------------------------- Procedural Stylized Props
// Built-in low-poly stylized models crafted programmatically (100% offline & zero network dependency)

function createCottageModel() {
  const group = new THREE.Group();
  group.name = 'prop_cottage';

  // Materials
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6e4a2c, roughness: 0.85 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x5a6365, roughness: 0.95 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a3828, roughness: 0.8 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd56b });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3d2415, roughness: 0.9 });

  // Stone Foundation
  const foundation = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.5, 3.8), stoneMat);
  foundation.position.y = 0.25;
  group.add(foundation);

  // Timber Cabin Walls
  const walls = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.4, 3.4), woodMat);
  walls.position.y = 1.6;
  group.add(walls);

  // Slanted Gable Roof
  const roofGeo = new THREE.ConeGeometry(3.2, 1.8, 4);
  roofGeo.rotateY(Math.PI / 4);
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.scale.set(1.15, 1.0, 0.95);
  roof.position.y = 3.6;
  group.add(roof);

  // Stone Chimney
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.2, 0.7), stoneMat);
  chimney.position.set(1.3, 3.5, 0.8);
  group.add(chimney);

  // Glowing Windows
  const winFront = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.65), glowMat);
  winFront.position.set(0.9, 1.8, 1.71);
  const winSide = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.65), glowMat);
  winSide.position.set(2.01, 1.8, 0);
  winSide.rotateY(Math.PI / 2);
  group.add(winFront, winSide);

  // Wooden Door
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.5), doorMat);
  door.position.set(-0.8, 1.25, 1.71);
  group.add(door);

  group.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return group;
}

function createShrineModel() {
  const group = new THREE.Group();
  group.name = 'prop_shrine';

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x485257, roughness: 0.9 });
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x0891b2,
    emissiveIntensity: 0.7,
    roughness: 0.2,
    metalness: 0.1,
    transparent: true,
    opacity: 0.9
  });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.4, metalness: 0.6 });

  // Stepped Plinth
  const base1 = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.35, 8), stoneMat);
  base1.position.y = 0.175;
  const base2 = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.35, 8), stoneMat);
  base2.position.y = 0.525;
  group.add(base1, base2);

  // 4 Corner Pillars
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const px = Math.cos(angle) * 1.35;
    const pz = Math.sin(angle) * 1.35;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2.2, 6), stoneMat);
    col.position.set(px, 1.8, pz);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.45), goldMat);
    cap.position.set(px, 2.9, pz);
    group.add(col, cap);
  }

  // Floating Mystic Crystal
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), crystalMat);
  crystal.position.set(0, 1.8, 0);
  crystal.scale.set(1.0, 1.6, 1.0);
  crystal.name = 'floating_crystal';
  group.add(crystal);

  group.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return group;
}

function createCampfireModel() {
  const group = new THREE.Group();
  group.name = 'prop_campfire';

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x52525b, roughness: 0.95 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x452311, roughness: 0.9 });
  const fireMat = new THREE.MeshBasicMaterial({ color: 0xff6b1a });

  // Stone Circle
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), stoneMat);
    stone.position.set(Math.cos(a) * 0.75, 0.15, Math.sin(a) * 0.75);
    stone.scale.set(1, 0.8, 1);
    group.add(stone);
  }

  // Crossed Firewood Logs
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 6), woodMat);
    log.position.set(0, 0.18, 0);
    log.rotation.z = Math.PI / 4;
    log.rotation.y = (i * Math.PI) / 2;
    group.add(log);
  }

  // Flame Core
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 6), fireMat);
  flame.position.set(0, 0.45, 0);
  group.add(flame);

  // Warm Campfire Light
  const fireLight = new THREE.PointLight(0xff8833, 1.8, 9.0);
  fireLight.position.set(0, 0.6, 0);
  fireLight.castShadow = false;
  group.add(fireLight);

  group.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return group;
}

function createLanternModel() {
  const group = new THREE.Group();
  group.name = 'prop_lantern';

  const postMat = new THREE.MeshStandardMaterial({ color: 0x543621, roughness: 0.9 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.5, metalness: 0.8 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffe082 });

  // Wooden Post
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 2.5, 6), postMat);
  post.position.y = 1.25;
  group.add(post);

  // Iron Arm
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.65), metalMat);
  arm.position.set(0, 2.35, 0.28);
  group.add(arm);

  // Lantern Housing
  const cage = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.45, 0.32), metalMat);
  cage.position.set(0, 2.1, 0.55);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.36, 0.24), glowMat);
  lamp.position.set(0, 2.1, 0.55);
  group.add(cage, lamp);

  // Warm Lantern Light
  const light = new THREE.PointLight(0xffbe5c, 1.2, 8.0);
  light.position.set(0, 2.1, 0.55);
  group.add(light);

  group.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return group;
}

function createArchModel() {
  const group = new THREE.Group();
  group.name = 'prop_arch';

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x576063, roughness: 0.95 });

  // Left & Right Pillars
  const leftCol = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 3.4, 7), stoneMat);
  leftCol.position.set(-1.6, 1.7, 0);
  const rightCol = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 3.4, 7), stoneMat);
  rightCol.position.set(1.6, 1.7, 0);

  // Top Lintel / Arch Beam
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.65, 0.9), stoneMat);
  lintel.position.set(0, 3.65, 0);

  group.add(leftCol, rightCol, lintel);

  group.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return group;
}

export const ASSET_DEFINITIONS = {
  cottage:  { name: 'Cozy Magic Cabin', radius: 4.0, create: createCottageModel },
  shrine:   { name: 'Crystal Shrine',   radius: 3.0, create: createShrineModel },
  campfire: { name: 'Campfire',         radius: 2.2, create: createCampfireModel },
  lantern:  { name: 'Forest Lantern',   radius: 1.5, create: createLanternModel },
  arch:     { name: 'Ancient Arch',     radius: 3.5, create: createArchModel }
};

// ---------------------------------------------------------------- Ghost Preview Helpers

function createGhostMesh(sourceGroup) {
  const ghost = sourceGroup.clone(true);
  ghost.name = 'placement_ghost';

  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0x7ef088,
    transparent: true,
    opacity: 0.45,
    wireframe: false,
    depthWrite: false
  });

  ghost.traverse(child => {
    if (child.isMesh) {
      child.material = ghostMat;
      child.castShadow = false;
      child.receiveShadow = false;
    } else if (child.isLight) {
      child.visible = false;
    }
  });

  return ghost;
}

// ---------------------------------------------------------------- Core System API

export function initAssetsManager(scene, camera) {
  _sceneRef = scene;
  _cameraRef = camera;

  return {
    startPlacement,
    updateGhostPosition,
    confirmPlacement,
    cancelPlacement,
    loadCustomGLB,
    removeAsset,
    getPlacedAssetsData,
    restorePlacedAssets
  };
}

export function startPlacement(type = 'cottage', customModel = null) {
  if (!_sceneRef) return null;
  cancelPlacement();

  placementState.active = true;
  placementState.assetType = type;
  placementState.rotationY = 0;
  placementState.scale = 1.0;

  let source = null;
  if (type === 'custom' && (customModel || placementState.customMesh)) {
    source = customModel || placementState.customMesh;
  } else if (ASSET_DEFINITIONS[type]) {
    source = ASSET_DEFINITIONS[type].create();
  } else {
    source = createCottageModel();
  }

  const ghost = createGhostMesh(source);
  ghost.visible = false;
  _sceneRef.add(ghost);
  placementState.ghostMesh = ghost;

  return ghost;
}

export function updateGhostPosition(x, z, normal = null) {
  if (!placementState.active || !placementState.ghostMesh) return;
  const ghost = placementState.ghostMesh;
  const y = groundHeight(x, z);

  ghost.position.set(x, y, z);
  ghost.rotation.y = placementState.rotationY;
  ghost.scale.setScalar(placementState.scale);
  ghost.visible = true;
}

export function rotateGhost(angleDelta) {
  placementState.rotationY += angleDelta;
  if (placementState.ghostMesh) {
    placementState.ghostMesh.rotation.y = placementState.rotationY;
  }
}

export function scaleGhost(scaleMultiplier) {
  placementState.scale = THREE.MathUtils.clamp(placementState.scale * scaleMultiplier, 0.3, 3.5);
  if (placementState.ghostMesh) {
    placementState.ghostMesh.scale.setScalar(placementState.scale);
  }
}

export function confirmPlacement(x, z) {
  if (!placementState.active || !_sceneRef) return null;
  const type = placementState.assetType;
  const def = ASSET_DEFINITIONS[type];
  const radius = (def ? def.radius : 3.0) * placementState.scale;

  let model = null;
  let assetName = def ? def.name : 'Custom Model';

  if (type === 'custom' && placementState.customMesh) {
    model = placementState.customMesh.clone(true);
    assetName = placementState.customName || 'Custom Model';
  } else if (def) {
    model = def.create();
  } else {
    model = createCottageModel();
  }

  const y = groundHeight(x, z);
  model.position.set(x, y, z);
  model.rotation.y = placementState.rotationY;
  model.scale.setScalar(placementState.scale);

  _sceneRef.add(model);

  const id = 'asset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  model.userData = { assetId: id, assetType: type, name: assetName };

  // 1. Register obstacle in treeRules so trees won't spawn inside or overlap
  registerObstacle(id, x, z, radius);

  // 2. Erase any pre-existing procedural trees currently poking through the placed asset
  eraseTreesInRadius(x, z, radius + 0.8);

  const record = {
    id,
    type,
    name: assetName,
    mesh: model,
    radius,
    pos: [x, y, z],
    rot: [0, placementState.rotationY, 0],
    scale: placementState.scale,
    customData: type === 'custom' ? placementState.customGlbUrl : null
  };
  placedAssets.push(record);

  return record;
}

export function cancelPlacement() {
  if (placementState.ghostMesh && _sceneRef) {
    _sceneRef.remove(placementState.ghostMesh);
    placementState.ghostMesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    placementState.ghostMesh = null;
  }
  placementState.active = false;
}

export function removeAsset(id) {
  const idx = placedAssets.findIndex(a => a.id === id);
  if (idx < 0) return false;
  const item = placedAssets[idx];

  unregisterObstacle(item.id);
  if (_sceneRef && item.mesh) {
    _sceneRef.remove(item.mesh);
    item.mesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }

  placedAssets.splice(idx, 1);
  return true;
}

export function removeLastPlacedAsset() {
  if (placedAssets.length === 0) return false;
  const last = placedAssets[placedAssets.length - 1];
  return removeAsset(last.id);
}

// ---------------------------------------------------------------- External GLB Loader

/**
 * Load ANY external GLB / GLTF file from URL, File object, or ArrayBuffer
 * @param {string|File|ArrayBuffer} source
 * @param {string} name
 * @returns {Promise<THREE.Group>}
 */
export async function loadCustomGLB(source, name = 'Custom GLB') {
  return new Promise((resolve, reject) => {
    let url = source;
    let cleanupUrl = false;

    if (source instanceof File) {
      url = URL.createObjectURL(source);
      cleanupUrl = true;
    }

    gltfLoader.load(
      url,
      (gltf) => {
        const root = gltf.scene;

        // Auto-center and normalize scale
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // Center bottom pivot
        root.position.x = -center.x;
        root.position.y = -box.min.y;
        root.position.z = -center.z;

        const wrapper = new THREE.Group();
        wrapper.add(root);

        // Normalize max dimension to ~3.2m
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0.001) {
          const normScale = 3.2 / maxDim;
          wrapper.scale.setScalar(normScale);
        }

        wrapper.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        placementState.customMesh = wrapper;
        placementState.customName = name;
        placementState.customGlbUrl = typeof source === 'string' ? source : null;

        if (cleanupUrl) {
          URL.revokeObjectURL(url);
        }

        resolve(wrapper);
      },
      undefined,
      (err) => {
        console.error('Failed to load custom GLB:', err);
        reject(err);
      }
    );
  });
}

// ---------------------------------------------------------------- Level Serialization Helpers

export function getPlacedAssetsData() {
  return placedAssets.map(a => ({
    id: a.id,
    type: a.type,
    name: a.name,
    pos: [a.mesh.position.x, a.mesh.position.y, a.mesh.position.z],
    rot: [a.mesh.rotation.x, a.mesh.rotation.y, a.mesh.rotation.z],
    scale: a.mesh.scale.x,
    customData: a.customData || null
  }));
}

export function restorePlacedAssets(savedList) {
  if (!Array.isArray(savedList)) return;

  // Clear existing placed assets
  while (placedAssets.length > 0) {
    removeAsset(placedAssets[0].id);
  }

  for (const item of savedList) {
    const type = item.type;
    const def = ASSET_DEFINITIONS[type];
    let model = null;

    if (def) {
      model = def.create();
    } else {
      model = createCottageModel();
    }

    model.position.set(item.pos[0], item.pos[1], item.pos[2]);
    model.rotation.set(item.rot[0], item.rot[1], item.rot[2]);
    model.scale.setScalar(item.scale || 1.0);
    _sceneRef.add(model);

    const radius = (def ? def.radius : 3.0) * (item.scale || 1.0);
    registerObstacle(item.id, item.pos[0], item.pos[2], radius);

    placedAssets.push({
      id: item.id,
      type: item.type,
      name: item.name || 'Prop',
      mesh: model,
      radius,
      pos: item.pos,
      rot: item.rot,
      scale: item.scale,
      customData: item.customData
    });
  }
}
