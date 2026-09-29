import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundHeight, terrainAlbedo, getLiveTerrainBiome } from './terrain.js';
import { 
  checkTreeLocation, 
  checkCustomTreeLocation, 
  clearTreeSpatialGrid, 
  registerTreePosition 
} from './treeRules.js';
import { addWind } from './wind.js';
import { addGroundBlend } from './groundBlend.js';

const FOREST_R = 195;

/** Preset palettes for tree foliage and trunk colors */
export const TREE_PRESETS = {
  summer: {
    name: 'Lush Summer',
    barkBottom: '#362112',
    barkTop: '#785437',
    coniferBottom: '#1a421c',
    coniferTop: '#5ea83c',
    broadBottom: '#24521c',
    broadTop: '#7cc643'
  },
  autumn: {
    name: 'Golden Autumn',
    barkBottom: '#3a2517',
    barkTop: '#8c5e3b',
    coniferBottom: '#2d421d',
    coniferTop: '#859635',
    broadBottom: '#7a3912',
    broadTop: '#e09822'
  },
  sakura: {
    name: 'Cherry Blossom (Sakura)',
    barkBottom: '#261b18',
    barkTop: '#5c3e38',
    coniferBottom: '#26402e',
    coniferTop: '#68a670',
    broadBottom: '#8f3856',
    broadTop: '#fba7c7'
  },
  mystic: {
    name: 'Mystic Fantasy',
    barkBottom: '#221533',
    barkTop: '#513369',
    coniferBottom: '#153b54',
    coniferTop: '#38bedc',
    broadBottom: '#4d1e73',
    broadTop: '#be4ef2'
  },
  frost: {
    name: 'Alpine Frost',
    barkBottom: '#23292e',
    barkTop: '#5c6870',
    coniferBottom: '#203d3c',
    coniferTop: '#92c7bc',
    broadBottom: '#37525c',
    broadTop: '#d0e7eb'
  }
};

/** Live-editable tree palette (bottom/top per part). */
export const treeColors = {
  barkBottom: '#362112',   // trunk base
  barkTop: '#785437',      // trunk top
  coniferBottom: '#1a421c',// conifer canopy base
  coniferTop: '#5ea83c',   // conifer canopy tip
  broadBottom: '#24521c',  // broadleaf canopy base
  broadTop: '#7cc643'      // broadleaf canopy crown
};

export function applyTreePreset(presetKey) {
  const p = TREE_PRESETS[presetKey];
  if (p) {
    setTreeColors(p);
    return true;
  }
  return false;
}

/**
 * Check if a location is valid for a tree.
 * All spawn rules live in ./treeRules.js (painted roads, slopes, water,
 * peaks, rock, clearing, greenness, spacing, obstacles).
 * @returns {[x, y, z, biome]|null} - placement spot or null if rejected
 */
function isValidTreeLocation(x, z) {
  return checkTreeLocation(x, z, true);
}

function placeTree(type = 'conifer') {
  for (let i = 0; i < 250; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 14 + Math.sqrt(Math.random()) * (FOREST_R - 14);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const spot = isValidTreeLocation(x, z);
    if (spot) {
      const [sx, sy] = spot;
      // Ecological altitude preference:
      // Conifer thrives on higher slopes and ridges
      if (type === 'conifer' && sy < 2.5 && Math.random() < 0.55) continue;
      // Broadleaf prefers lush lowland valleys
      if (type === 'broad' && sy > 7.0 && Math.random() < 0.65) continue;
      registerTreePosition(sx, spot[2]);
      return spot;
    }
  }
  return null;
}

function unwrapHeight(geo) {
  geo.computeBoundingBox();
  const minY = geo.boundingBox.min.y;
  const maxY = geo.boundingBox.max.y;
  const range = Math.max(maxY - minY, 0.001);
  const pos = geo.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const v = THREE.MathUtils.clamp((y - minY) / range, 0.0, 1.0);
    uvs[i * 2] = 0.5;
    uvs[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
}

function createPaletteTexture(bottomColor, topColor, w = 16, h = 256) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  // Canvas y=h is bottom (v=0), y=0 is top (v=1)
  const g = cx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, bottomColor); // base / bottom color
  g.addColorStop(1, topColor);    // crown / top color
  cx.fillStyle = g;
  cx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function buildTrees(scene) {
  const N_CONIFER = 400, N_BROAD = 250;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const E = new THREE.Euler();
  const color = new THREE.Color();

  // geometries -------------------------------------------------------
  const trunkCone = new THREE.CylinderGeometry(0.14, 0.34, 3.2, 5).translate(0, 1.6, 0);
  const trunkBroad = new THREE.CylinderGeometry(0.2, 0.45, 4.2, 5).translate(0, 2.1, 0);

  const c1 = new THREE.ConeGeometry(1.55, 2.3, 5).translate(0, 3.3, 0);
  const c2 = new THREE.ConeGeometry(1.18, 2.0, 5).translate(0, 4.5, 0);
  const c3 = new THREE.ConeGeometry(0.8, 1.8, 5).translate(0, 5.6, 0);
  const coniferCanopy = mergeGeometries([c1, c2, c3]);

  const b1 = new THREE.IcosahedronGeometry(1.7, 1).translate(0, 5.4, 0);
  const b2 = new THREE.IcosahedronGeometry(1.25, 1).translate(1.1, 4.7, 0.45);
  const b3 = new THREE.IcosahedronGeometry(1.15, 1).translate(-1.0, 4.8, -0.4);
  const broadCanopy = mergeGeometries([b1, b2, b3]);

  // Height-based UV unwrapping so texture fades cleanly between 2 colors
  for (const g of [trunkCone, trunkBroad, coniferCanopy, broadCanopy]) {
    unwrapHeight(g);
  }

  // Pure 2-color gradient palette textures (live-editable via setTreeColors)
  const barkTex = createPaletteTexture(treeColors.barkBottom, treeColors.barkTop);
  const coniferTex = createPaletteTexture(treeColors.coniferBottom, treeColors.coniferTop);
  const broadTex = createPaletteTexture(treeColors.broadBottom, treeColors.broadTop);

  // Materials with smooth shading & height-based 2-color fade
  const barkMat = new THREE.MeshStandardMaterial({
    map: barkTex, roughness: 0.92, metalness: 0, flatShading: false
  });
  const coniferMat = new THREE.MeshStandardMaterial({
    map: coniferTex, roughness: 0.85, metalness: 0, flatShading: false
  });
  const broadMat = new THREE.MeshStandardMaterial({
    map: broadTex, roughness: 0.85, metalness: 0, flatShading: false
  });

  // Synchronized wind sway for both trunk and canopy
  addWind(barkMat, 0.05);
  addWind(coniferMat, 0.05);
  addWind(broadMat, 0.05);

  // Seamless contact ground blending for tree trunks into terrain
  addGroundBlend(barkMat, { blendHeight: 1.15, blendOffset: 0.15, hasAttribute: true });

  // Instances --------------------------------------------------------
  const coniferT = new THREE.InstancedMesh(trunkCone, barkMat, N_CONIFER);
  const coniferC = new THREE.InstancedMesh(coniferCanopy, coniferMat, N_CONIFER);
  const broadT = new THREE.InstancedMesh(trunkBroad, barkMat, N_BROAD);
  const broadC = new THREE.InstancedMesh(broadCanopy, broadMat, N_BROAD);
  coniferT.name = 'trees_coniferTrunk';
  coniferC.name = 'trees_coniferCanopy';
  broadT.name = 'trees_broadTrunk';
  broadC.name = 'trees_broadCanopy';

  const terrainColorsConifer = new Float32Array(N_CONIFER * 3);
  const terrainColorsBroad = new Float32Array(N_BROAD * 3);

  for (const m of [coniferT, coniferC, broadT, broadC]) {
    m.castShadow = true; m.receiveShadow = true;
    m.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  }
  scene.add(coniferT, coniferC, broadT, broadC);

  const cWhite = new THREE.Color(0xffffff);

  _treeInstances = { coniferT, coniferC, broadT, broadC, N_CONIFER, N_BROAD, trunkCone, trunkBroad, barkMat, coniferMat, broadMat };

  for (let i = 0; i < N_CONIFER; i++) {
    const spot = placeTree();
    if (spot) {
      const [x, y, z, biome] = spot;
      const s = 0.7 + Math.random() * 0.95;
      E.set((Math.random() - 0.5) * 0.07, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.07);
      Q.setFromEuler(E); P.set(x, y - 0.15, z); S.set(s, s * (0.9 + Math.random() * 0.35), s);
      M.compose(P, Q, S);
      terrainColorsConifer[i * 3]     = biome.r;
      terrainColorsConifer[i * 3 + 1] = biome.g;
      terrainColorsConifer[i * 3 + 2] = biome.b;
    } else {
      M.makeScale(0, 0, 0);
    }
    coniferT.setMatrixAt(i, M);
    coniferC.setMatrixAt(i, M);
    color.copy(cWhite).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
    coniferC.setColorAt(i, color);
    coniferT.setColorAt(i, cWhite);
  }
  for (let i = 0; i < N_BROAD; i++) {
    const spot = placeTree();
    if (spot) {
      const [x, y, z, biome] = spot;
      const s = 0.75 + Math.random() * 0.85;
      E.set((Math.random() - 0.5) * 0.06, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.06);
      Q.setFromEuler(E); P.set(x, y - 0.15, z); S.set(s, s * (0.9 + Math.random() * 0.3), s);
      M.compose(P, Q, S);
      terrainColorsBroad[i * 3]     = biome.r;
      terrainColorsBroad[i * 3 + 1] = biome.g;
      terrainColorsBroad[i * 3 + 2] = biome.b;
    } else {
      M.makeScale(0, 0, 0);
    }
    broadT.setMatrixAt(i, M);
    broadC.setMatrixAt(i, M);
    color.copy(cWhite).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
    broadC.setColorAt(i, color);
    broadT.setColorAt(i, cWhite);
  }

  // Set instanced attributes for ground color blending
  trunkCone.setAttribute('aTerrainColor', new THREE.InstancedBufferAttribute(terrainColorsConifer, 3));
  trunkBroad.setAttribute('aTerrainColor', new THREE.InstancedBufferAttribute(terrainColorsBroad, 3));

  coniferC.instanceColor.needsUpdate = true; broadC.instanceColor.needsUpdate = true;
  coniferT.instanceColor.needsUpdate = true; broadT.instanceColor.needsUpdate = true;

  return { coniferT, coniferC, broadT, broadC, rebuildTreesPCG };
}

let _treeInstances = null;
/** Slots occupied by user-placed trees — rebuildTreesPCG must preserve them. */
const _userSlots = { conifer: new Set(), broad: new Set() };

export function rebuildTreesPCG(options = {}) {
  if (!_treeInstances) return;
  const { coniferT, coniferC, broadT, broadC, N_CONIFER, N_BROAD, trunkCone, trunkBroad } = _treeInstances;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const E = new THREE.Euler();

  clearTreeSpatialGrid();

  // Re-register protected user-placed trees in the spatial index
  for (const type of ['conifer', 'broad']) {
    const trunk = _treeInstances[type + 'T'];
    for (const i of _userSlots[type]) {
      trunk.getMatrixAt(i, M);
      if (M.determinant() !== 0) {
        M.decompose(P, Q, S);
        registerTreePosition(P.x, P.z);
      }
    }
  }

  const treeSet = options.treeSet || 'all'; // 'all' | 'conifer' | 'broad'

  const terrainColorsConifer = trunkCone.attributes.aTerrainColor ? trunkCone.attributes.aTerrainColor.array : new Float32Array(N_CONIFER * 3);
  const terrainColorsBroad = trunkBroad.attributes.aTerrainColor ? trunkBroad.attributes.aTerrainColor.array : new Float32Array(N_BROAD * 3);

  for (let i = 0; i < N_CONIFER; i++) {
    if (_userSlots.conifer.has(i)) continue; // preserve user-placed trees
    if (treeSet === 'broad') {
      M.makeScale(0, 0, 0);
    } else {
      const spot = placeTree('conifer');
      if (spot) {
        const [x, y, z, biome] = spot;
        const s = 0.7 + Math.random() * 0.95;
        E.set((Math.random() - 0.5) * 0.07, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.07);
        Q.setFromEuler(E); P.set(x, y - 0.15, z); S.set(s, s * (0.9 + Math.random() * 0.35), s);
        M.compose(P, Q, S);
        terrainColorsConifer[i * 3]     = biome.r;
        terrainColorsConifer[i * 3 + 1] = biome.g;
        terrainColorsConifer[i * 3 + 2] = biome.b;
      } else {
        M.makeScale(0, 0, 0); // Hide tree if no valid spot
      }
    }
    coniferT.setMatrixAt(i, M);
    coniferC.setMatrixAt(i, M);
  }

  for (let i = 0; i < N_BROAD; i++) {
    if (_userSlots.broad.has(i)) continue; // preserve user-placed trees
    if (treeSet === 'conifer') {
      M.makeScale(0, 0, 0);
    } else {
      const spot = placeTree('broad');
      if (spot) {
        const [x, y, z, biome] = spot;
        const s = 0.75 + Math.random() * 0.85;
        E.set((Math.random() - 0.5) * 0.06, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.06);
        Q.setFromEuler(E); P.set(x, y - 0.15, z); S.set(s, s * (0.9 + Math.random() * 0.3), s);
        M.compose(P, Q, S);
        terrainColorsBroad[i * 3]     = biome.r;
        terrainColorsBroad[i * 3 + 1] = biome.g;
        terrainColorsBroad[i * 3 + 2] = biome.b;
      } else {
        M.makeScale(0, 0, 0); // Hide tree if no valid spot
      }
    }
    broadT.setMatrixAt(i, M);
    broadC.setMatrixAt(i, M);
  }

  coniferT.instanceMatrix.needsUpdate = true;
  coniferC.instanceMatrix.needsUpdate = true;
  broadT.instanceMatrix.needsUpdate = true;
  broadC.instanceMatrix.needsUpdate = true;

  if (trunkCone.attributes.aTerrainColor) trunkCone.attributes.aTerrainColor.needsUpdate = true;
  if (trunkBroad.attributes.aTerrainColor) trunkBroad.attributes.aTerrainColor.needsUpdate = true;
}

/**
 * Custom Sampler: Sample and plant a picturesque cluster / grove of trees around (cx, cz).
 * @param {number} cx World center X
 * @param {number} cz World center Z
 * @param {number} [count=6] Number of trees in cluster
 * @param {number} [radius=14] Radius of grove
 * @param {'conifer'|'broad'} [type='conifer']
 * @returns {number} Placed tree count
 */
export function sampleTreeCluster(cx, cz, count = 6, radius = 14, type = 'conifer') {
  let placed = 0;
  for (let i = 0; i < count * 10 && placed < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    const px = cx + Math.cos(a) * r;
    const pz = cz + Math.sin(a) * r;
    const spot = checkTreeLocation(px, pz, true);
    if (spot) {
      if (placeTreeAt(px, pz, type)) {
        registerTreePosition(px, pz);
        placed++;
      }
    }
  }
  return placed;
}

/**
 * Tree Eraser: Removes any trees (PCG or user-placed) within `radius` of (cx, cz).
 * @param {number} cx World center X
 * @param {number} cz World center Z
 * @param {number} [radius=6.0] Erase radius
 * @returns {number} Erased count
 */
export function eraseTreesInRadius(cx, cz, radius = 6.0) {
  if (!_treeInstances) return 0;
  const radSq = radius * radius;
  let count = 0;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const M = new THREE.Matrix4(), P = new THREE.Vector3();

  for (const type of ['conifer', 'broad']) {
    const trunk = _treeInstances[type + 'T'];
    const canopy = _treeInstances[type + 'C'];
    const N = type === 'conifer' ? _treeInstances.N_CONIFER : _treeInstances.N_BROAD;

    for (let i = 0; i < N; i++) {
      trunk.getMatrixAt(i, M);
      if (M.determinant() === 0) continue;
      M.decompose(P, new THREE.Quaternion(), new THREE.Vector3());
      const distSq = (P.x - cx) * (P.x - cx) + (P.z - cz) * (P.z - cz);
      if (distSq <= radSq) {
        trunk.setMatrixAt(i, zero);
        canopy.setMatrixAt(i, zero);
        _userSlots[type].delete(i);
        count++;
      }
    }
    trunk.instanceMatrix.needsUpdate = true;
    canopy.instanceMatrix.needsUpdate = true;
  }
  return count;
}

/**
 * Live-update the tree palette. Rebuilds the three gradient CanvasTextures
 * and swaps them onto the existing materials — no material recreation, so
 * wind / ground-blend shader hooks stay intact.
 */
export function setTreeColors(partial) {
  Object.assign(treeColors, partial);
  if (!_treeInstances) return;
  const { barkMat, coniferMat, broadMat } = _treeInstances;
  const old = [barkMat.map, coniferMat.map, broadMat.map];
  barkMat.map = createPaletteTexture(treeColors.barkBottom, treeColors.barkTop);
  coniferMat.map = createPaletteTexture(treeColors.coniferBottom, treeColors.coniferTop);
  broadMat.map = createPaletteTexture(treeColors.broadBottom, treeColors.broadTop);
  for (const m of [barkMat, coniferMat, broadMat]) m.needsUpdate = true;
  for (const t of old) if (t) t.dispose();
}

function _findFreeSlot(type) {
  const isConifer = type === 'conifer';
  const N = isConifer ? _treeInstances.N_CONIFER : _treeInstances.N_BROAD;
  const trunk = isConifer ? _treeInstances.coniferT : _treeInstances.broadT;
  const slots = _userSlots[isConifer ? 'conifer' : 'broad'];
  const M = new THREE.Matrix4();
  // Prefer an empty (zero-scale) PCG slot, else the first non-user slot.
  for (let i = 0; i < N; i++) {
    if (slots.has(i)) continue;
    trunk.getMatrixAt(i, M);
    if (M.determinant() === 0) return i;
  }
  for (let i = 0; i < N; i++) if (!slots.has(i)) return i;
  return -1; // every slot in use
}

/**
 * Place one user-specified tree at (x, z). Bypasses the greenness rule
 * (users may plant on sand/rock) but still rejects underwater spots.
 * @param {'conifer'|'broad'} type
 * @returns {boolean} success
 */
export function placeTreeAt(x, z, type = 'conifer') {
  if (!_treeInstances) return false;
  const spot = checkCustomTreeLocation(x, z);
  if (!spot) return false;
  const [sx, sy, sz, biome] = spot;
  const isConifer = type !== 'broad';
  const trunk = isConifer ? _treeInstances.coniferT : _treeInstances.broadT;
  const canopy = isConifer ? _treeInstances.coniferC : _treeInstances.broadC;
  const idx = _findFreeSlot(isConifer ? 'conifer' : 'broad');
  if (idx < 0) return false;
  _userSlots[isConifer ? 'conifer' : 'broad'].add(idx);

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const E = new THREE.Euler();
  const s = 0.7 + Math.random() * 0.95;
  E.set((Math.random() - 0.5) * 0.06, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.06);
  Q.setFromEuler(E); P.set(sx, sy - 0.15, sz); S.set(s, s * (0.9 + Math.random() * 0.35), s);
  M.compose(P, Q, S);
  trunk.setMatrixAt(idx, M);
  canopy.setMatrixAt(idx, M);

  const tint = new THREE.Color(0xffffff).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
  canopy.setColorAt(idx, tint);
  trunk.setColorAt(idx, new THREE.Color(0xffffff));

  const tcAttr = (isConifer ? _treeInstances.trunkCone : _treeInstances.trunkBroad).attributes.aTerrainColor;
  if (tcAttr) {
    tcAttr.array[idx * 3] = biome.r;
    tcAttr.array[idx * 3 + 1] = biome.g;
    tcAttr.array[idx * 3 + 2] = biome.b;
    tcAttr.needsUpdate = true;
  }
  trunk.instanceMatrix.needsUpdate = true;
  canopy.instanceMatrix.needsUpdate = true;
  trunk.instanceColor.needsUpdate = true;
  canopy.instanceColor.needsUpdate = true;
  return true;
}

/**
 * Remove the nearest user-placed tree within ~1.5m of (x, z).
 * @returns {boolean} removed
 */
export function removeTreeAt(x, z) {
  if (!_treeInstances) return false;
  let best = null, bestD2 = 1.5 * 1.5;
  for (const type of ['conifer', 'broad']) {
    const trunk = _treeInstances[type + 'T'];
    const N = type === 'conifer' ? _treeInstances.N_CONIFER : _treeInstances.N_BROAD;
    const M = new THREE.Matrix4(), P = new THREE.Vector3();
    for (const i of _userSlots[type]) {
      trunk.getMatrixAt(i, M);
      if (M.determinant() === 0) continue;
      M.decompose(P, new THREE.Quaternion(), new THREE.Vector3());
      const d2 = P.distanceToSquared(new THREE.Vector3(x, P.y, z));
      if (d2 < bestD2) { bestD2 = d2; best = { type, i }; }
    }
  }
  if (!best) return false;
  const trunk = _treeInstances[best.type + 'T'];
  const canopy = _treeInstances[best.type + 'C'];
  const M = new THREE.Matrix4().makeScale(0, 0, 0);
  trunk.setMatrixAt(best.i, M);
  canopy.setMatrixAt(best.i, M);
  _userSlots[best.type].delete(best.i);
  trunk.instanceMatrix.needsUpdate = true;
  canopy.instanceMatrix.needsUpdate = true;
  return true;
}

/**
 * Serialize every visible tree (PCG + user) for level save.
 * @returns {Array<{type, i, m: number[], c: number[], tc: number[]}>}
 */
export function getTreeData() {
  if (!_treeInstances) return [];
  const out = [];
  const M = new THREE.Matrix4();
  const c = new THREE.Color();
  for (const type of ['conifer', 'broad']) {
    const trunk = _treeInstances[type + 'T'];
    const canopy = _treeInstances[type + 'C'];
    const N = type === 'conifer' ? _treeInstances.N_CONIFER : _treeInstances.N_BROAD;
    const tcAttr = (type === 'conifer' ? _treeInstances.trunkCone : _treeInstances.trunkBroad).attributes.aTerrainColor;
    for (let i = 0; i < N; i++) {
      trunk.getMatrixAt(i, M);
      if (M.determinant() === 0) continue; // hidden slot
      canopy.getColorAt(i, c);
      out.push({
        type, i,
        user: _userSlots[type].has(i),
        m: Array.from(M.elements),
        c: [c.r, c.g, c.b],
        tc: tcAttr ? [tcAttr.array[i * 3], tcAttr.array[i * 3 + 1], tcAttr.array[i * 3 + 2]] : [0.3, 0.5, 0.2]
      });
    }
  }
  return out;
}

/**
 * Restore trees from saved level data (exact slot indices, matrices, tints).
 * Only entries flagged `user` are protected as user slots so Auto-Trees keeps them.
 */
export function applyTreeData(data) {
  if (!_treeInstances) return;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const type of ['conifer', 'broad']) {
    const trunk = _treeInstances[type + 'T'];
    const canopy = _treeInstances[type + 'C'];
    const N = type === 'conifer' ? _treeInstances.N_CONIFER : _treeInstances.N_BROAD;
    for (let i = 0; i < N; i++) { trunk.setMatrixAt(i, zero); canopy.setMatrixAt(i, zero); }
  }
  _userSlots.conifer.clear();
  _userSlots.broad.clear();
  const M = new THREE.Matrix4();
  const c = new THREE.Color();
  for (const t of data) {
    if (t.type !== 'conifer' && t.type !== 'broad') continue;
    const trunk = _treeInstances[t.type + 'T'];
    const canopy = _treeInstances[t.type + 'C'];
    const N = t.type === 'conifer' ? _treeInstances.N_CONIFER : _treeInstances.N_BROAD;
    if (t.i < 0 || t.i >= N) continue;
    M.fromArray(t.m);
    trunk.setMatrixAt(t.i, M);
    canopy.setMatrixAt(t.i, M);
    // Saved instance colors are linear-space components.
    c.setRGB(t.c[0], t.c[1], t.c[2], THREE.LinearSRGBColorSpace);
    canopy.setColorAt(t.i, c);
    trunk.setColorAt(t.i, new THREE.Color(0xffffff));
    const tcAttr = (t.type === 'conifer' ? _treeInstances.trunkCone : _treeInstances.trunkBroad).attributes.aTerrainColor;
    if (tcAttr && t.tc) {
      tcAttr.array[t.i * 3] = t.tc[0];
      tcAttr.array[t.i * 3 + 1] = t.tc[1];
      tcAttr.array[t.i * 3 + 2] = t.tc[2];
    }
    if (t.user === true) _userSlots[t.type].add(t.i);
  }
  for (const type of ['conifer', 'broad']) {
    const trunk = _treeInstances[type + 'T'];
    const canopy = _treeInstances[type + 'C'];
    trunk.instanceMatrix.needsUpdate = true;
    canopy.instanceMatrix.needsUpdate = true;
    trunk.instanceColor.needsUpdate = true;
    canopy.instanceColor.needsUpdate = true;
  }
  if (_treeInstances.trunkCone.attributes.aTerrainColor) _treeInstances.trunkCone.attributes.aTerrainColor.needsUpdate = true;
  if (_treeInstances.trunkBroad.attributes.aTerrainColor) _treeInstances.trunkBroad.attributes.aTerrainColor.needsUpdate = true;
}
