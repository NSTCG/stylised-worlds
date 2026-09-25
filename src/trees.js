import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundHeight, pathFactor, terrainAlbedo, getLiveTerrainBiome } from './terrain.js';
import { addWind } from './wind.js';
import { addGroundBlend } from './groundBlend.js';

const CLEAR_R = 17, FOREST_R = 195;

export function isValidTreeLocation(x, z) {
  // Rule 0: Keep spawn clearing flat and tree-free
  if (Math.hypot(x, z) < CLEAR_R) return null;

  // Sample live biome at this world position
  const biome = getLiveTerrainBiome(x, z);

  // Rule 1: Tree won't grow on water (sea level is y=0, beach/surf up to 0.55m)
  if (biome.y < 0.55) return null;

  // Rule 2: Tree won't grow on rocky peaks / steep bare cliffs (y > 13.5)
  if (biome.y > 13.5) return null;

  // Rule 3: Tree won't grow on painted rock (grey stone cliff)
  const isRockColor = (Math.abs(biome.r - biome.g) < 0.06 && Math.abs(biome.g - biome.b) < 0.06 && biome.greenness < 0.20);
  if (isRockColor) return null;

  // Rule 4: Tree won't grow on road / path (pathFactor > 0.05 or painted earthen road)
  if (pathFactor(x, z) > 0.05) return null;

  // Rule 5: Tree ONLY grows on green ground (where grass thrives)
  if (biome.greenness < 0.20) return null;

  return [x, biome.y, z, biome];
}

function placeTree() {
  for (let i = 0; i < 250; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 12 + Math.sqrt(Math.random()) * (FOREST_R - 12);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const spot = isValidTreeLocation(x, z);
    if (spot) return spot;
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
  const N_CONIFER = 1050, N_BROAD = 700;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const E = new THREE.Euler();
  const color = new THREE.Color();

  // geometries -------------------------------------------------------
  const trunkCone = new THREE.CylinderGeometry(0.14, 0.34, 3.2, 10).translate(0, 1.6, 0);
  const trunkBroad = new THREE.CylinderGeometry(0.2, 0.45, 4.2, 10).translate(0, 2.1, 0);

  const c1 = new THREE.ConeGeometry(1.55, 2.3, 10).translate(0, 3.3, 0);
  const c2 = new THREE.ConeGeometry(1.18, 2.0, 10).translate(0, 4.5, 0);
  const c3 = new THREE.ConeGeometry(0.8, 1.8, 10).translate(0, 5.6, 0);
  const coniferCanopy = mergeGeometries([c1, c2, c3]);

  const b1 = new THREE.IcosahedronGeometry(1.7, 2).translate(0, 5.4, 0);
  const b2 = new THREE.IcosahedronGeometry(1.25, 2).translate(1.1, 4.7, 0.45);
  const b3 = new THREE.IcosahedronGeometry(1.15, 2).translate(-1.0, 4.8, -0.4);
  const broadCanopy = mergeGeometries([b1, b2, b3]);

  // Height-based UV unwrapping so texture fades cleanly between 2 colors
  for (const g of [trunkCone, trunkBroad, coniferCanopy, broadCanopy]) {
    unwrapHeight(g);
  }

  // Pure 2-color gradient palette textures
  const barkTex = createPaletteTexture('#362112', '#785437'); // dark bark base -> warm timber top
  const coniferTex = createPaletteTexture('#1a421c', '#5ea83c'); // deep pine base -> bright conifer tip
  const broadTex = createPaletteTexture('#24521c', '#7cc643'); // deep leaf base -> lush sunlit crown

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

  _treeInstances = { coniferT, coniferC, broadT, broadC, N_CONIFER, N_BROAD, trunkCone, trunkBroad };

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

export function rebuildTreesPCG() {
  if (!_treeInstances) return;
  const { coniferT, coniferC, broadT, broadC, N_CONIFER, N_BROAD, trunkCone, trunkBroad } = _treeInstances;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const E = new THREE.Euler();

  const terrainColorsConifer = trunkCone.attributes.aTerrainColor ? trunkCone.attributes.aTerrainColor.array : new Float32Array(N_CONIFER * 3);
  const terrainColorsBroad = trunkBroad.attributes.aTerrainColor ? trunkBroad.attributes.aTerrainColor.array : new Float32Array(N_BROAD * 3);

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
      M.makeScale(0, 0, 0); // Hide tree if no valid spot
    }
    coniferT.setMatrixAt(i, M);
    coniferC.setMatrixAt(i, M);
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
      M.makeScale(0, 0, 0); // Hide tree if no valid spot
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
