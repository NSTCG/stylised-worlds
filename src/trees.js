import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundHeight, pathFactor, terrainAlbedo } from './terrain.js';
import { addWind } from './wind.js';
import { addGroundBlend } from './groundBlend.js';

const CLEAR_R = 17, FOREST_R = 195;

function placeTree() {
  for (let i = 0; i < 200; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 12 + Math.sqrt(Math.random()) * (FOREST_R - 12);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // keep clearing near camera flat
    if (Math.hypot(x, z) < CLEAR_R) continue;
    if (pathFactor(x, z) > 0.02) continue; // keep path strictly clear of trees
    const y = groundHeight(x, z);
    if (y < 0.45) continue; // no trees in the surf
    return [x, y, z];
  }
  return [0, 0, 0];
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

  for (let i = 0; i < N_CONIFER; i++) {
    const [x, y, z] = placeTree();
    const s = 0.7 + Math.random() * 0.95;
    E.set((Math.random() - 0.5) * 0.07, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.07);
    Q.setFromEuler(E); P.set(x, y - 0.15, z); S.set(s, s * (0.9 + Math.random() * 0.35), s);
    M.compose(P, Q, S);
    coniferT.setMatrixAt(i, M);
    coniferC.setMatrixAt(i, M);
    color.copy(cWhite).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
    coniferC.setColorAt(i, color);
    coniferT.setColorAt(i, cWhite);

    const tc = terrainAlbedo(x, z, y);
    terrainColorsConifer[i * 3]     = tc.r;
    terrainColorsConifer[i * 3 + 1] = tc.g;
    terrainColorsConifer[i * 3 + 2] = tc.b;
  }
  for (let i = 0; i < N_BROAD; i++) {
    const [x, y, z] = placeTree();
    const s = 0.75 + Math.random() * 0.85;
    E.set((Math.random() - 0.5) * 0.06, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.06);
    Q.setFromEuler(E); P.set(x, y - 0.15, z); S.set(s, s * (0.9 + Math.random() * 0.3), s);
    M.compose(P, Q, S);
    broadT.setMatrixAt(i, M);
    broadC.setMatrixAt(i, M);
    color.copy(cWhite).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
    broadC.setColorAt(i, color);
    broadT.setColorAt(i, cWhite);

    const tc = terrainAlbedo(x, z, y);
    terrainColorsBroad[i * 3]     = tc.r;
    terrainColorsBroad[i * 3 + 1] = tc.g;
    terrainColorsBroad[i * 3 + 2] = tc.b;
  }

  // Set instanced attributes for ground color blending
  trunkCone.setAttribute('aTerrainColor', new THREE.InstancedBufferAttribute(terrainColorsConifer, 3));
  trunkBroad.setAttribute('aTerrainColor', new THREE.InstancedBufferAttribute(terrainColorsBroad, 3));

  coniferC.instanceColor.needsUpdate = true; broadC.instanceColor.needsUpdate = true;
  coniferT.instanceColor.needsUpdate = true; broadT.instanceColor.needsUpdate = true;

  return { coniferT, coniferC, broadT, broadC };
}
