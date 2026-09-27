/**
 * src/whisperingValleyScene.js
 * Whispering Valley: Level 1 — Fully integrated with the terrain sculpting system,
 * GPU grass, real water channels, path painting, instanced trees, and calibrated prop scalings.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { optimizeModel } from './modelOptimizer.js';
import { registerObstacle, unregisterObstacle } from './treeRules.js';
import { placeTreeAt, eraseTreesInRadius } from './trees.js';
import { 
  getTerrainDataTexture, 
  getGroundMesh, 
  TERRAIN_BOUNDS, 
  groundHeight,
  cGrassLush, 
  cGrassWarm, 
  cGrassDark,
  cPath, 
  cSandWet, 
  cSand, 
  cSeaShallow, 
  cRock 
} from './terrain.js';
import { showNotification } from './levelSerializer.js';

let _valleyRoot = null;
const _gltfLoader = new GLTFLoader();
const _optimizedCache = new Map();

// 14 GLB Assets with calibrated realistic fantasy scalings
export const VALLEY_ASSETS = {
  barrel: { filename: 'barrel.glb', url: './AssetsTest/Assets/barrel.glb', scale: 0.55 },
  box: { filename: 'box.glb', url: './AssetsTest/Assets/box.glb', scale: 0.65 },
  bridge: { filename: 'bridge.glb', url: './AssetsTest/Assets/bridge.glb', scale: 1.15 },
  fishing_stool: { filename: 'fishing stool.glb', url: './AssetsTest/Assets/fishing%20stool.glb', scale: 0.65 },
  lamp_post: { filename: 'lamp post.glb', url: './AssetsTest/Assets/lamp%20post.glb', scale: 0.75 },
  older_sprite: { filename: 'Older sprite.glb', url: './AssetsTest/Assets/Older%20sprite.glb', scale: 0.55 },
  portal: { filename: 'Portal.glb', url: './AssetsTest/Assets/Portal.glb', scale: 1.20 },
  red_flower_plant: { filename: 'red flower plant.glb', url: './AssetsTest/Assets/red%20flower%20plant.glb', scale: 0.55 },
  rock_1: { filename: 'rock 1.glb', url: './AssetsTest/Assets/rock%201.glb', scale: 0.95 },
  rock_2: { filename: 'rock 2.glb', url: './AssetsTest/Assets/rock%202.glb', scale: 0.85 },
  torii_gate: { filename: 'Torii gate.glb', url: './AssetsTest/Assets/Torii%20gate.glb', scale: 1.25 },
  tree: { filename: 'tree.glb', url: './AssetsTest/Assets/tree.glb', scale: 1.35 },
  watering_can: { filename: 'watering can.glb', url: './AssetsTest/Assets/watering%20can.glb', scale: 0.45 },
  well: { filename: 'well.glb', url: './AssetsTest/Assets/well.glb', scale: 0.95 }
};

/**
 * Build the Whispering Valley scene in the world
 */
export async function buildWhisperingValley(scene, camera, controls) {
  if (_valleyRoot && _valleyRoot.parent) {
    scene.remove(_valleyRoot);
  }

  _valleyRoot = new THREE.Group();
  _valleyRoot.name = 'whispering_valley_scene';
  scene.add(_valleyRoot);

  showNotification('🌲 Sculpting Whispering Valley Terrain...', 'info', 2500);

  // 1. Sculpt Real Terrain System (Sacred hill, carved river channel, lake basin, earthen path)
  _sculptValleyTerrain();

  // 2. Erase any procedural trees from the settlement clearing
  eraseTreesInRadius(0, 5, 28);
  eraseTreesInRadius(-14, 12, 18);
  eraseTreesInRadius(24, -10, 20);

  // 3. Plant natural trees framing the valley using instanced tree system
  _plantValleyTrees();

  // 4. Build Farmstead Structures (Cottage, Garden plots, Fences, Scarecrow)
  _buildFarmstead(_valleyRoot);

  // 5. Build Wooden Fishing Pier & Dock with Lily Pads
  _buildFishingDock(_valleyRoot);

  // 6. Build Winding Stepping Stones Path
  _buildSteppingStones(_valleyRoot);

  // 7. Place all 14 GLB Props with calibrated realistic scales
  _placeAllProps(_valleyRoot);

  // 8. Position camera to match concept art viewpoint
  if (camera && controls) {
    camera.position.set(-8, 10.5, 27);
    controls.target.set(6, 1.8, 4);
    controls.update();
  }

  // 9. Stream high-fidelity GLBs in background to upgrade placeholders
  _streamAndUpgradeGlbs(_valleyRoot);

  showNotification('✨ Whispering Valley: Level 1 Loaded!', 'success', 3500);
  return _valleyRoot;
}

/* ---------------------------------------------------------- 1. Real Terrain Sculpting */

export function _sculptValleyTerrain() {
  const tex = getTerrainDataTexture();
  const groundMesh = getGroundMesh();
  if (!tex || !groundMesh) return;

  const data = tex.image.data;
  const texSize = tex.image.width; // 512
  const minX = TERRAIN_BOUNDS.x, minZ = TERRAIN_BOUNDS.y;
  const sizeX = TERRAIN_BOUNDS.z, sizeZ = TERRAIN_BOUNDS.w;

  // River spline connecting mountain run into the lake
  const riverSpline = [
    { x: -4, z: -35 },
    { x: -1, z: -22 },
    { x: 2.5, z: -8 },
    { x: 5.5, z: 7.5 },  // Bridge Crossing
    { x: 8.5, z: 15 },
    { x: 14.0, z: 20 }   // Lake Inlet
  ];

  function distToRiver(x, z) {
    let minDist = 999;
    for (let i = 0; i < riverSpline.length - 1; i++) {
      const p1 = riverSpline[i], p2 = riverSpline[i + 1];
      const dx = p2.x - p1.x, dz = p2.z - p1.z;
      const lenSq = dx * dx + dz * dz;
      let t = lenSq > 0 ? ((x - p1.x) * dx + (z - p1.z) * dz) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const projX = p1.x + t * dx, projZ = p1.z + t * dz;
      const d = Math.hypot(x - projX, z - projZ);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  // Winding earthen trail spline
  const pathPoints = [
    { x: -16, z: 7.5 },  // Farmhouse
    { x: -11, z: 9.0 },  // Well
    { x: -6, z: 10.8 },  // Garden gate
    { x: -1, z: 11.0 },  // Meadow trail
    { x: 3, z: 9.8 },    // Bridge approach left
    { x: 5.5, z: 7.5 },  // Bridge centerline
    { x: 8.5, z: 5.5 },  // Bridge approach right
    { x: 13, z: 2.0 },   // East meadow
    { x: 17, z: -3.0 },  // Hill foot
    { x: 19.5, z: -10.0 }, // Torii Gate
    { x: 23, z: -12.0 }, // Hill stairs
    { x: 27.5, z: -13.5 } // Swirl Portal
  ];

  function distToPath(x, z) {
    let minDist = 999;
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const p1 = pathPoints[i], p2 = pathPoints[i + 1];
      const dx = p2.x - p1.x, dz = p2.z - p1.z;
      const lenSq = dx * dx + dz * dz;
      let t = lenSq > 0 ? ((x - p1.x) * dx + (z - p1.z) * dz) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const projX = p1.x + t * dx, projZ = p1.z + t * dz;
      const d = Math.hypot(x - projX, z - projZ);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  function computePoint(x, z, origH) {
    let h = origH;
    let col = new THREE.Color().copy(cGrassLush);

    // A. Sacred Hill (Center Right, X: 24, Z: -12, R: 18)
    const dHill = Math.hypot(x - 24, z - (-12));
    if (dHill < 18) {
      const wHill = 1 - THREE.MathUtils.smoothstep(dHill, 3.5, 18);
      // Smooth raised mound rising to +4.5m
      const hillH = 0.5 + wHill * 4.2;
      h = Math.max(h, hillH);
      col.copy(cGrassLush).lerp(cGrassWarm, wHill * 0.5);
    }

    // B. Lake Basin (Foreground Right, Center X: 22, Z: 20, R: 15)
    const dLake = Math.hypot(x - 22, z - 20);
    if (dLake < 16) {
      const wLake = 1 - THREE.MathUtils.smoothstep(dLake, 8, 16);
      h = THREE.MathUtils.lerp(h, -1.8, wLake);
      col.lerp(cSeaShallow, wLake);
      if (h < 0.2 && h > -0.6) col.lerp(cSandWet, 0.7);
    }

    // C. River Channel (Cut into terrain to fill with water under bridge)
    const dRiv = distToRiver(x, z);
    if (dRiv < 6.0) {
      const wRiv = 1 - THREE.MathUtils.smoothstep(dRiv, 1.6, 5.0);
      h = THREE.MathUtils.lerp(h, -1.25, wRiv);
      col.lerp(cSeaShallow, wRiv * 0.9);
      if (h < 0.25 && h > -0.5) col.lerp(cSandWet, 0.65);
    }

    // D. Farmstead Meadow (Flatten clearing around cottage & garden)
    const dFarm = Math.hypot(x - (-14), z - 10);
    if (dFarm < 16) {
      const wFarm = 1 - THREE.MathUtils.smoothstep(dFarm, 6, 16);
      h = THREE.MathUtils.lerp(h, 0.55, wFarm);
      col.copy(cGrassLush).lerp(cGrassWarm, 0.25);
    }

    // E. Winding Earthen Trail (Culls grass, draws natural road color)
    const dP = distToPath(x, z);
    if (dP < 1.8 && h > 0.1) {
      const wP = 1 - (dP / 1.8) * (dP / 1.8);
      col.lerp(cPath, wP * 0.92);
    }

    return { h, col };
  }

  // Update DataTexture
  for (let iy = 0; iy < texSize; iy++) {
    const z = minZ + (iy / (texSize - 1)) * sizeZ;
    for (let ix = 0; ix < texSize; ix++) {
      const x = minX + (ix / (texSize - 1)) * sizeX;
      if (x < -65 || x > 65 || z < -65 || z > 65) continue;

      const idx = (iy * texSize + ix) * 4;
      const origH = data[idx + 0];
      const res = computePoint(x, z, origH);

      data[idx + 0] = res.h;
      data[idx + 1] = res.col.r;
      data[idx + 2] = res.col.g;
      data[idx + 3] = res.col.b;
    }
  }
  tex.needsUpdate = true;

  // Update GroundMesh Geometry
  const geo = groundMesh.geometry;
  const posAttr = geo.attributes.position;
  const colAttr = geo.attributes.color;
  const vCount = posAttr.count;

  for (let i = 0; i < vCount; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    if (vx < -65 || vx > 65 || vz < -65 || vz > 65) continue;

    const vy = posAttr.getY(i);
    const res = computePoint(vx, vz, vy);

    posAttr.setY(i, res.h);
    colAttr.setXYZ(i, res.col.r, res.col.g, res.col.b);
  }

  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
  geo.computeVertexNormals();
}

/* ---------------------------------------------------------- 2. Instanced Tree System */

function _plantValleyTrees() {
  // Perimeter and mountain slopes framing Whispering Valley
  const treeCoords = [
    // Behind Farmstead (West)
    [-24.0, 3.0, 'conifer'],
    [-23.0, 11.0, 'conifer'],
    [-24.5, 19.0, 'conifer'],
    [-22.0, 25.0, 'broad'],
    // Northern Ridge & Mountain run
    [-15.0, -22.0, 'conifer'],
    [-7.0, -28.0, 'conifer'],
    [0.0, -32.0, 'conifer'],
    [8.0, -28.0, 'conifer'],
    [14.0, -24.0, 'conifer'],
    // Behind Sacred Hill (East)
    [30.0, -22.0, 'conifer'],
    [34.0, -15.0, 'conifer'],
    [33.0, -6.0, 'conifer'],
    [28.0, 2.0, 'broad'],
    [27.0, 10.0, 'conifer']
  ];

  for (const [tx, tz, type] of treeCoords) {
    placeTreeAt(tx, tz, type);
  }
}

/* ---------------------------------------------------------- 3. Farmstead Structures */

function _buildFarmstead(parent) {
  const g = new THREE.Group();
  g.name = 'farmstead_cluster';

  const cottageY = groundHeight(-16, 5.5);
  const cottage = new THREE.Group();
  cottage.position.set(-16, cottageY, 5.5);

  // Stone Foundation
  const stoneBase = new THREE.Mesh(
    new THREE.BoxGeometry(6.6, 0.65, 5.4),
    new THREE.MeshStandardMaterial({ color: 0x5a554a, roughness: 0.9 })
  );
  stoneBase.position.y = 0.32;
  stoneBase.castShadow = true;
  stoneBase.receiveShadow = true;
  cottage.add(stoneBase);

  // Timber Walls
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(6.0, 2.8, 4.8),
    new THREE.MeshStandardMaterial({ color: 0x8b6538, roughness: 0.8 })
  );
  walls.position.y = 2.0;
  walls.castShadow = true;
  cottage.add(walls);

  // Pitch Shingle Roof
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(4.8, 2.4, 4),
    new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.7 })
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 4.2;
  roof.castShadow = true;
  cottage.add(roof);

  // Front Porch Deck
  const porch = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 0.22, 2.6),
    new THREE.MeshStandardMaterial({ color: 0x9e7b4e, roughness: 0.85 })
  );
  porch.position.set(0, 0.45, 3.4);
  porch.receiveShadow = true;
  cottage.add(porch);

  // Porch Canopy
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.16, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x3d3023, roughness: 0.7 })
  );
  canopy.position.set(0, 2.6, 3.2);
  canopy.rotation.x = 0.15;
  canopy.castShadow = true;
  cottage.add(canopy);

  // Chimney
  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 2.0, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x44403c, roughness: 0.95 })
  );
  chimney.position.set(1.8, 4.4, -0.8);
  chimney.castShadow = true;
  cottage.add(chimney);

  g.add(cottage);
  registerObstacle('farm_cottage', -16, 5.5, 4.8);

  // Tilled Soil Beds
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x3d2716, roughness: 0.95 });
  const cabbageMat = new THREE.MeshStandardMaterial({ color: 0x48bb78, roughness: 0.6 });
  const carrotLeafMat = new THREE.MeshStandardMaterial({ color: 0x38a169, roughness: 0.6 });

  // Plot 1: Cabbage
  const p1Y = groundHeight(-13.5, 14.5);
  const plot1 = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.14, 3.0), soilMat);
  plot1.position.set(-13.5, p1Y + 0.08, 14.5);
  plot1.receiveShadow = true;
  g.add(plot1);

  for (let r = -1.0; r <= 1.0; r += 0.7) {
    for (let c = -1.8; c <= 1.8; c += 0.8) {
      const cab = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 1), cabbageMat);
      cab.position.set(-13.5 + c, p1Y + 0.26, 14.5 + r);
      cab.castShadow = true;
      g.add(cab);
    }
  }

  // Plot 2: Carrots
  const p2Y = groundHeight(-8.8, 15.8);
  const plot2 = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.14, 2.8), soilMat);
  plot2.position.set(-8.8, p2Y + 0.08, 15.8);
  plot2.receiveShadow = true;
  g.add(plot2);

  for (let r = -0.9; r <= 0.9; r += 0.6) {
    for (let c = -1.6; c <= 1.6; c += 0.55) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 4), carrotLeafMat);
      leaf.position.set(-8.8 + c, p2Y + 0.28, 15.8 + r);
      leaf.castShadow = true;
      g.add(leaf);
    }
  }

  // Post & Rail Fences with Bunting
  _buildFenceWithBunting(g, -16.5, 12.0, -5.5, 12.0);
  _buildFenceWithBunting(g, -16.5, 12.0, -16.5, 18.0);
  _buildFenceWithBunting(g, -16.5, 18.0, -6.0, 18.0);

  // Scarecrow
  const scY = groundHeight(-13.2, 12.8);
  const scarecrow = _buildScarecrow();
  scarecrow.position.set(-13.2, scY, 12.8);
  g.add(scarecrow);

  parent.add(g);
}

function _buildFenceWithBunting(group, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.round(dist / 2.2));
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6e5233, roughness: 0.9 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x826442, roughness: 0.85 });

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x1 + dx * t, pz = z1 + dz * t;
    const py = groundHeight(px, pz);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.3, 6), postMat);
    post.position.set(px, py + 0.65, pz);
    post.castShadow = true;
    group.add(post);
  }

  const midX = (x1 + x2) * 0.5, midZ = (z1 + z2) * 0.5;
  const midY = groundHeight(midX, midZ);
  const angle = Math.atan2(dz, dx);

  const rail1 = new THREE.Mesh(new THREE.BoxGeometry(dist, 0.07, 0.05), railMat);
  rail1.position.set(midX, midY + 0.85, midZ);
  rail1.rotation.y = -angle;
  rail1.castShadow = true;
  group.add(rail1);

  const rail2 = new THREE.Mesh(new THREE.BoxGeometry(dist, 0.07, 0.05), railMat);
  rail2.position.set(midX, midY + 0.48, midZ);
  rail2.rotation.y = -angle;
  rail2.castShadow = true;
  group.add(rail2);

  // Bunting flags
  const colors = [0xe53e3e, 0xdd6b20, 0xd69e2e, 0x38a169, 0x3182ce, 0x805ad5];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const fx = x1 + dx * t, fz = z1 + dz * t;
    const fy = groundHeight(fx, fz);
    const flagMat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 3), flagMat);
    flag.position.set(fx, fy + 0.65, fz);
    flag.rotation.z = Math.PI;
    group.add(flag);
  }
}

function _buildScarecrow() {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6e5233, roughness: 0.9 });
  const clothMat = new THREE.MeshStandardMaterial({ color: 0x3182ce, roughness: 0.8 });
  const hatMat = new THREE.MeshStandardMaterial({ color: 0xd69e2e, roughness: 0.7 });

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.0, 6), woodMat);
  post.position.y = 1.0;
  post.castShadow = true;
  g.add(post);

  const arms = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.4, 6), woodMat);
  arms.position.y = 1.45;
  arms.rotation.z = Math.PI / 2;
  arms.castShadow = true;
  g.add(arms);

  const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.7, 6), clothMat);
  coat.position.y = 1.25;
  coat.castShadow = true;
  g.add(coat);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshStandardMaterial({ color: 0xf6e05e, roughness: 0.9 }));
  head.position.y = 1.75;
  g.add(head);

  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.28, 8), hatMat);
  hat.position.y = 1.95;
  hat.castShadow = true;
  g.add(hat);

  return g;
}

/* ---------------------------------------------------------- 4. Fishing Dock & Lily Pads */

function _buildFishingDock(parent) {
  const g = new THREE.Group();
  g.name = 'fishing_dock_cluster';

  // Wooden dock platform (Extending into lake water at Y=0.35)
  const dockWoodMat = new THREE.MeshStandardMaterial({ color: 0x8c6239, roughness: 0.85 });
  const plank = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.2, 4.8), dockWoodMat);
  plank.position.set(13.6, 0.35, 17.5);
  plank.castShadow = true;
  plank.receiveShadow = true;
  g.add(plank);

  // Pilings dipping into water
  const postMat = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.95 });
  const postCoords = [
    [11.9, 15.3], [15.3, 15.3],
    [11.9, 19.7], [15.3, 19.7]
  ];
  for (const [px, pz] of postCoords) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.2, 8), postMat);
    p.position.set(px, -0.4, pz);
    p.castShadow = true;
    g.add(p);
  }

  // Floating Lily Pads on Water (Y=0.02)
  const lilyMat = new THREE.MeshStandardMaterial({ color: 0x2e8540, roughness: 0.45 });
  const lilyCoords = [
    [16.2, 17.0, 0.42],
    [15.5, 18.5, 0.60], // Sprite standing on this one!
    [17.5, 19.2, 0.38],
    [14.2, 21.0, 0.48],
    [12.5, 21.5, 0.32]
  ];
  for (const [lx, lz, rad] of lilyCoords) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.03, 16), lilyMat);
    pad.position.set(lx, 0.02, lz);
    pad.receiveShadow = true;
    g.add(pad);
  }

  registerObstacle('fishing_dock', 13.6, 17.5, 2.8);
  parent.add(g);
}

/* ---------------------------------------------------------- 5. Stepping Stones */

function _buildSteppingStones(parent) {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x827c73, roughness: 0.9 });
  const stoneCoords = [
    [-11.5, 8.5], [-9.5, 9.2], [-7.5, 9.8], [-5.5, 10.5], [-3.5, 10.8], [-1.5, 10.8],
    [0.8, 10.2], [2.8, 9.5], /* Bridge: 5.5, 7.5 */ [8.2, 6.2], [10.5, 4.8],
    [12.8, 3.2], [15.0, 0.8], [17.0, -2.0], [18.5, -5.5], [19.5, -9.0]
  ];

  for (let i = 0; i < stoneCoords.length; i++) {
    const [px, pz] = stoneCoords[i];
    const py = groundHeight(px, pz);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.08, 7), stoneMat);
    s.position.set(px, py + 0.04, pz);
    s.rotation.y = (i * 1.3) % Math.PI;
    s.receiveShadow = true;
    g.add(s);
  }

  parent.add(g);
}

/* ---------------------------------------------------------- 6. All 14 Props Placement */

function _placeAllProps(root) {
  const propsGroup = new THREE.Group();
  propsGroup.name = 'whispering_valley_props';

  // 1. Well (Stone Water Well by Farmhouse)
  _spawnProp(propsGroup, 'well', { x: -10.5, z: 5.5, yaw: 0.4, scale: 0.95 });

  // 2. Barrels (Stacked by Well & Farmhouse & Dock)
  _spawnProp(propsGroup, 'barrel', { x: -9.5, z: 6.8, yaw: 0.2, scale: 0.55 });
  _spawnProp(propsGroup, 'barrel', { x: -8.8, z: 6.0, yaw: -0.6, scale: 0.55 });
  _spawnProp(propsGroup, 'barrel', { x: -13.2, z: 8.6, yaw: 1.1, scale: 0.55 });
  _spawnProp(propsGroup, 'barrel', { x: 12.0, y: 0.48, z: 15.5, yaw: 0.5, scale: 0.52 }); // On dock platform

  // 3. Boxes / Crates (Stacked by Farmhouse Porch)
  _spawnProp(propsGroup, 'box', { x: -14.2, z: 8.0, yaw: 0.15, scale: 0.65 });
  _spawnProp(propsGroup, 'box', { x: -14.2, z: 8.0, yOffset: 0.65, yaw: -0.25, scale: 0.55 }); // Stacked
  _spawnProp(propsGroup, 'box', { x: -13.2, z: 7.2, yaw: 0.8, scale: 0.60 });

  // 4. Watering Can (In the Vegetable Garden Plot)
  _spawnProp(propsGroup, 'watering_can', { x: -10.2, z: 15.2, yaw: -0.8, scale: 0.45 });

  // 5. Bridge (Arched Wooden Bridge spanning over sculpted river channel)
  _spawnProp(propsGroup, 'bridge', { x: 5.5, y: 0.62, z: 7.5, yaw: -0.45, scale: 1.25 });

  // 6. Fishing Stool (On the Wooden Fishing Dock)
  _spawnProp(propsGroup, 'fishing_stool', { x: 13.8, y: 0.45, z: 17.5, yaw: 1.8, scale: 0.65 });

  // 7. Lamp Posts (Bridge entrances & Torii Gate approach)
  _spawnProp(propsGroup, 'lamp_post', { x: 2.5, z: 9.5, yaw: 0.5, scale: 0.75 });
  _spawnProp(propsGroup, 'lamp_post', { x: 8.5, z: 5.5, yaw: -1.2, scale: 0.75 });
  _spawnProp(propsGroup, 'lamp_post', { x: 17.5, z: -8.5, yaw: 0.2, scale: 0.80 });
  _spawnProp(propsGroup, 'lamp_post', { x: 23.5, z: -12.5, yaw: -0.7, scale: 0.80 });

  // 8. Torii Gate (Red Shrine Gate at approach to sacred hill)
  _spawnProp(propsGroup, 'torii_gate', { x: 19.5, z: -10.5, yaw: -0.42, scale: 1.25 });

  // 9. Portal (Mystic Stone Swirl Portal on top of the Hill)
  _spawnProp(propsGroup, 'portal', { x: 27.5, z: -13.5, yaw: -0.65, scale: 1.20 });

  // 10. Older Sprite (Cute Glowing Blue Valley Spirits)
  _spawnProp(propsGroup, 'older_sprite', { x: -15.0, z: 7.8, yOffset: 0.35, yaw: 0.3, scale: 0.55 }); // Porch
  _spawnProp(propsGroup, 'older_sprite', { x: -11.5, z: 16.0, yaw: -0.5, scale: 0.55 }); // Carrot patch
  _spawnProp(propsGroup, 'older_sprite', { x: -14.0, z: 14.5, yaw: 0.2, scale: 0.55 }); // Scarecrow
  _spawnProp(propsGroup, 'older_sprite', { x: -2.5, z: 11.2, yaw: 1.1, scale: 0.55 });  // Meadow path
  _spawnProp(propsGroup, 'older_sprite', { x: 12.6, y: 0.45, z: 16.5, yaw: 0.7, scale: 0.55 }); // Dock
  _spawnProp(propsGroup, 'older_sprite', { x: 15.5, y: 0.05, z: 18.5, yaw: 0.0, scale: 0.50 }); // Lily pad!
  _spawnProp(propsGroup, 'older_sprite', { x: 19.5, z: -12.2, yaw: 0.5, scale: 0.58 }); // Torii gate
  _spawnProp(propsGroup, 'older_sprite', { x: 26.2, z: -13.0, yaw: -0.4, scale: 0.58 }); // Beside portal

  // 11. Red Flower Plant (Along shoreline, bridge, portal, garden)
  _spawnProp(propsGroup, 'red_flower_plant', { x: 17.5, z: 9.0, yaw: 0.3, scale: 0.55 });
  _spawnProp(propsGroup, 'red_flower_plant', { x: 20.0, z: 13.0, yaw: 1.2, scale: 0.60 });
  _spawnProp(propsGroup, 'red_flower_plant', { x: 4.0, z: 11.2, yaw: -0.8, scale: 0.55 });
  _spawnProp(propsGroup, 'red_flower_plant', { x: 29.5, z: -11.5, yaw: 0.4, scale: 0.65 });
  _spawnProp(propsGroup, 'red_flower_plant', { x: 25.5, z: -15.5, yaw: -1.1, scale: 0.60 });
  _spawnProp(propsGroup, 'red_flower_plant', { x: -7.5, z: 18.2, yaw: 0.6, scale: 0.55 });

  // 12. Rock 1 & Rock 2 (River Boulders & Mossy Stones)
  _spawnProp(propsGroup, 'rock_1', { x: 1.5, z: -5.0, yaw: 0.5, scale: 1.1 });
  _spawnProp(propsGroup, 'rock_1', { x: 6.8, z: 3.5, yaw: -0.4, scale: 1.0 });
  _spawnProp(propsGroup, 'rock_1', { x: 11.0, z: 10.5, yaw: 0.9, scale: 1.2 });
  _spawnProp(propsGroup, 'rock_1', { x: -2.0, z: 2.5, yaw: 1.5, scale: 0.85 });

  _spawnProp(propsGroup, 'rock_2', { x: 4.5, z: 8.5, yaw: 0.2, scale: 0.75 });
  _spawnProp(propsGroup, 'rock_2', { x: 15.0, z: 21.0, yaw: -0.7, scale: 0.95 });
  _spawnProp(propsGroup, 'rock_2', { x: 8.5, z: -1.5, yaw: 1.3, scale: 0.85 });
  _spawnProp(propsGroup, 'rock_2', { x: 22.0, z: 2.0, yaw: 0.6, scale: 0.90 });

  // 13. Tree (Valley Conifers framing settlement)
  _spawnProp(propsGroup, 'tree', { x: -24.0, z: 3.0, yaw: 0.2, scale: 1.35 });
  _spawnProp(propsGroup, 'tree', { x: -22.5, z: 13.0, yaw: 0.9, scale: 1.30 });
  _spawnProp(propsGroup, 'tree', { x: -23.0, z: 23.0, yaw: -0.4, scale: 1.45 });
  _spawnProp(propsGroup, 'tree', { x: 30.0, z: -22.0, yaw: 0.8, scale: 1.40 });
  _spawnProp(propsGroup, 'tree', { x: 34.0, z: -15.0, yaw: -0.3, scale: 1.35 });

  root.add(propsGroup);
}

function _spawnProp(group, assetKey, def) {
  const gY = def.y !== undefined ? def.y : groundHeight(def.x, def.z);
  const finalY = gY + (def.yOffset || 0);

  const placeholder = _createFastPlaceholder(assetKey);
  const node = new THREE.Group();
  node.name = `prop_${assetKey}_${Math.random().toString(36).substr(2, 6)}`;
  node.userData = { assetKey, def };

  node.position.set(def.x, finalY, def.z);
  node.rotation.y = def.yaw || 0;
  const s = def.scale || 1.0;
  node.scale.set(s, s, s);

  node.add(placeholder);
  group.add(node);

  registerObstacle(node.name, def.x, def.z, 1.2 * s);
  return node;
}

/**
 * Creates an instant stylized placeholder so the map appears in under 50ms!
 */
function _createFastPlaceholder(key) {
  const g = new THREE.Group();
  let mesh;

  switch (key) {
    case 'barrel': {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.38, 0.85, 10),
        new THREE.MeshStandardMaterial({ color: 0x8c5b2e, roughness: 0.75 })
      );
      mesh.position.y = 0.42;
      mesh.castShadow = true;
      g.add(mesh);
      break;
    }
    case 'box': {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.65, 0.65, 0.65),
        new THREE.MeshStandardMaterial({ color: 0xb7791f, roughness: 0.8 })
      );
      mesh.position.y = 0.32;
      mesh.castShadow = true;
      g.add(mesh);
      break;
    }
    case 'bridge': {
      // Arched wooden footbridge spanning river
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.22, 7.8),
        new THREE.MeshStandardMaterial({ color: 0x855328, roughness: 0.8 })
      );
      deck.position.y = 0.25;
      deck.castShadow = true;
      deck.receiveShadow = true;
      g.add(deck);

      // Wooden railings and posts
      const postMat = new THREE.MeshStandardMaterial({ color: 0x543316, roughness: 0.9 });
      for (let s = -3.4; s <= 3.4; s += 1.7) {
        const pL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.9, 6), postMat);
        pL.position.set(-1.15, 0.7, s);
        pL.castShadow = true;
        const pR = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.9, 6), postMat);
        pR.position.set(1.15, 0.7, s);
        pR.castShadow = true;
        g.add(pL, pR);
      }

      const railL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 7.8), postMat);
      railL.position.set(-1.15, 1.1, 0);
      const railR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 7.8), postMat);
      railR.position.set(1.15, 1.1, 0);
      g.add(railL, railR);
      break;
    }
    case 'fishing_stool': {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, 0.45, 8),
        new THREE.MeshStandardMaterial({ color: 0x975a16, roughness: 0.8 })
      );
      mesh.position.y = 0.22;
      mesh.castShadow = true;
      g.add(mesh);
      break;
    }
    case 'lamp_post': {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.07, 1.9, 6),
        new THREE.MeshStandardMaterial({ color: 0x3d352e, roughness: 0.9 })
      );
      pole.position.y = 0.95;
      pole.castShadow = true;
      g.add(pole);

      const lantern = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.35, 0.3),
        new THREE.MeshStandardMaterial({ color: 0xed8936, emissive: 0xdd6b20, emissiveIntensity: 0.65, roughness: 0.3 })
      );
      lantern.position.y = 1.95;
      g.add(lantern);
      break;
    }
    case 'older_sprite': {
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 12, 10),
        new THREE.MeshStandardMaterial({
          color: 0x90cdf4,
          emissive: 0x3182ce,
          emissiveIntensity: 0.55,
          roughness: 0.2,
          transparent: true,
          opacity: 0.92
        })
      );
      body.position.y = 0.38;
      g.add(body);

      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a202c });
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), eyeMat);
      eyeL.position.set(-0.08, 0.42, 0.24);
      const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), eyeMat);
      eyeR.position.set(0.08, 0.42, 0.24);
      g.add(eyeL, eyeR);
      break;
    }
    case 'portal': {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.5, 0.32, 10, 24),
        new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.9 })
      );
      ring.position.y = 1.7;
      ring.castShadow = true;
      g.add(ring);

      const swirl = new THREE.Mesh(
        new THREE.CircleGeometry(1.3, 24),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85
        })
      );
      swirl.position.y = 1.7;
      g.add(swirl);
      break;
    }
    case 'red_flower_plant': {
      const pot = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x276749, roughness: 0.8 })
      );
      pot.position.y = 0.22;
      g.add(pot);

      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2;
        const fl = new THREE.Mesh(
          new THREE.ConeGeometry(0.1, 0.3, 5),
          new THREE.MeshStandardMaterial({ color: 0xe53e3e, roughness: 0.5 })
        );
        fl.position.set(Math.cos(ang) * 0.18, 0.42, Math.sin(ang) * 0.18);
        fl.castShadow = true;
        g.add(fl);
      }
      break;
    }
    case 'rock_1':
    case 'rock_2': {
      mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.65, 1),
        new THREE.MeshStandardMaterial({ color: key === 'rock_1' ? 0x64748b : 0x475569, roughness: 0.95 })
      );
      mesh.scale.set(1.2, 0.65, 0.95);
      mesh.position.y = 0.38;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      break;
    }
    case 'torii_gate': {
      const redMat = new THREE.MeshStandardMaterial({ color: 0xc53030, roughness: 0.6 });
      const pL = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3.2, 8), redMat);
      pL.position.set(-1.4, 1.6, 0);
      pL.castShadow = true;
      const pR = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3.2, 8), redMat);
      pR.position.set(1.4, 1.6, 0);
      pR.castShadow = true;
      const top = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.28, 0.38), redMat);
      top.position.set(0, 3.1, 0);
      top.castShadow = true;
      const sub = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 0.28), redMat);
      sub.position.set(0, 2.6, 0);
      sub.castShadow = true;
      g.add(pL, pR, top, sub);
      break;
    }
    case 'tree': {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.28, 1.8, 6),
        new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 })
      );
      trunk.position.y = 0.9;
      trunk.castShadow = true;
      g.add(trunk);

      const leafMat = new THREE.MeshStandardMaterial({ color: 0x22543d, roughness: 0.75 });
      for (let l = 0; l < 3; l++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5 - l * 0.35, 1.5, 6), leafMat);
        cone.position.y = 1.7 + l * 0.85;
        cone.castShadow = true;
        g.add(cone);
      }
      break;
    }
    case 'watering_can': {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.22, 0.38, 8),
        new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.4, metalness: 0.7 })
      );
      mesh.position.y = 0.19;
      mesh.castShadow = true;
      g.add(mesh);
      break;
    }
    case 'well': {
      const stoneWall = new THREE.Mesh(
        new THREE.CylinderGeometry(0.85, 0.9, 0.85, 12),
        new THREE.MeshStandardMaterial({ color: 0x5a554a, roughness: 0.95 })
      );
      stoneWall.position.y = 0.42;
      stoneWall.castShadow = true;
      g.add(stoneWall);

      const roofMat = new THREE.MeshStandardMaterial({ color: 0x744210, roughness: 0.8 });
      const wRoof = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.75, 4), roofMat);
      wRoof.rotation.y = Math.PI / 4;
      wRoof.position.y = 1.8;
      wRoof.castShadow = true;
      g.add(wRoof);

      const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 6), roofMat);
      p1.position.set(-0.65, 1.15, 0);
      const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 6), roofMat);
      p2.position.set(0.65, 1.15, 0);
      g.add(p1, p2);
      break;
    }
  }

  return g;
}

/**
 * Asynchronously loads and optimizes GLB models in background, then seamlessly upgrades placeholders
 */
async function _streamAndUpgradeGlbs(root) {
  const toLoad = Object.entries(VALLEY_ASSETS);

  for (const [key, def] of toLoad) {
    try {
      let optModel = _optimizedCache.get(key);
      if (!optModel) {
        // Load raw GLB
        const gltf = await new Promise((resolve, reject) => {
          _gltfLoader.load(def.url, resolve, undefined, reject);
        });

        // Optimize with Quest Profile: 10% simplify ratio, 512px WebP textures
        optModel = await optimizeModel(gltf.scene, {
          simplifyRatio: 0.10,
          maxTextureRes: 512,
          textureFormat: 'webp',
          textureQuality: 0.75,
          targetError: 0.02
        });

        // Center bottom pivot
        const box = new THREE.Box3().setFromObject(optModel);
        const center = box.getCenter(new THREE.Vector3());
        optModel.position.sub(center);
        optModel.position.y += (box.max.y - box.min.y) * 0.5;

        _optimizedCache.set(key, optModel);
      }

      // Upgrade all matching placeholder instances in root
      root.traverse((node) => {
        if (node.isGroup && node.userData && node.userData.assetKey === key) {
          while (node.children.length > 0) {
            node.remove(node.children[0]);
          }
          const instance = optModel.clone(true);
          node.add(instance);
        }
      });

    } catch (err) {
      console.warn(`[WhisperingValley] GLB streaming fallback for ${key}:`, err.message);
    }
  }
}
