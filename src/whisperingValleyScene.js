/**
 * src/whisperingValleyScene.js
 * Quick test map generator recreating "Whispering Valley: Level 1" from the concept art.
 * Instantly constructs the scene layout using all 14 GLB props with Quest-optimized settings.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { optimizeModel } from './modelOptimizer.js';
import { registerObstacle } from './treeRules.js';
import { eraseTreesInRadius } from './trees.js';
import { selectObject } from './transformManager.js';
import { showNotification } from './levelSerializer.js';

let _valleyRoot = null;
const _gltfLoader = new GLTFLoader();
const _optimizedCache = new Map(); // assetName -> THREE.Group

// 14 assets from AssetsTest/Assets
export const VALLEY_ASSETS = {
  barrel: { filename: 'barrel.glb', url: './AssetsTest/Assets/barrel.glb', scale: 0.8 },
  box: { filename: 'box.glb', url: './AssetsTest/Assets/box.glb', scale: 0.9 },
  bridge: { filename: 'bridge.glb', url: './AssetsTest/Assets/bridge.glb', scale: 1.2 },
  fishing_stool: { filename: 'fishing stool.glb', url: './AssetsTest/Assets/fishing%20stool.glb', scale: 0.75 },
  lamp_post: { filename: 'lamp post.glb', url: './AssetsTest/Assets/lamp%20post.glb', scale: 0.9 },
  older_sprite: { filename: 'Older sprite.glb', url: './AssetsTest/Assets/Older%20sprite.glb', scale: 0.65 },
  portal: { filename: 'Portal.glb', url: './AssetsTest/Assets/Portal.glb', scale: 1.3 },
  red_flower_plant: { filename: 'red flower plant.glb', url: './AssetsTest/Assets/red%20flower%20plant.glb', scale: 0.7 },
  rock_1: { filename: 'rock 1.glb', url: './AssetsTest/Assets/rock%201.glb', scale: 1.1 },
  rock_2: { filename: 'rock 2.glb', url: './AssetsTest/Assets/rock%202.glb', scale: 0.9 },
  torii_gate: { filename: 'Torii gate.glb', url: './AssetsTest/Assets/Torii%20gate.glb', scale: 1.35 },
  tree: { filename: 'tree.glb', url: './AssetsTest/Assets/tree.glb', scale: 1.4 },
  watering_can: { filename: 'watering can.glb', url: './AssetsTest/Assets/watering%20can.glb', scale: 0.6 },
  well: { filename: 'well.glb', url: './AssetsTest/Assets/well.glb', scale: 1.0 }
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

  showNotification('🌲 Building Whispering Valley: Level 1...', 'info', 2500);

  // 1. Build Farmstead Structures (Cottage, Garden plots, Fences, Bunting)
  _buildFarmstead(_valleyRoot);

  // 2. Build Wooden Fishing Pier & Dock
  _buildFishingDock(_valleyRoot);

  // 3. Build Sacred Hill / Plateau for Shrine & Portal
  _buildSacredHill(_valleyRoot);

  // 4. Build Winding Stone Path & Stepping Stones
  _buildStonePath(_valleyRoot);

  // 5. Place all 14 GLB Props across the valley
  _placeAllProps(_valleyRoot);

  // 6. Set camera to cinematic concept art viewpoint
  if (camera && controls) {
    camera.position.set(-6, 9.5, 26);
    controls.target.set(6, 1.5, 4);
    controls.update();
  }

  // 7. Erase natural procedural trees in the valley settlement
  eraseTreesInRadius(0, 5, 26);
  eraseTreesInRadius(-14, 12, 18);
  eraseTreesInRadius(22, -10, 18);

  // 8. Stream high-fidelity GLBs in background to replace placeholders
  _streamAndUpgradeGlbs(_valleyRoot);

  showNotification('✨ Whispering Valley loaded! Test & explore.', 'success', 3500);
  return _valleyRoot;
}

/* ---------------------------------------------------------- Immediate Procedural Helpers */

function _buildFarmstead(parent) {
  const g = new THREE.Group();
  g.name = 'farmstead_cluster';

  // Rustic Wooden Cottage
  const cottage = new THREE.Group();
  cottage.position.set(-16, 0.5, 5.5);

  // Foundation
  const stoneBase = new THREE.Mesh(
    new THREE.BoxGeometry(7, 0.8, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a554a, roughness: 0.9 })
  );
  stoneBase.position.y = 0.4;
  stoneBase.castShadow = true;
  stoneBase.receiveShadow = true;
  cottage.add(stoneBase);

  // Timber walls
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 3.2, 5.4),
    new THREE.MeshStandardMaterial({ color: 0x8b6538, roughness: 0.8 })
  );
  walls.position.y = 2.4;
  walls.castShadow = true;
  cottage.add(walls);

  // Roof
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(5.2, 2.6, 4),
    new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.7 })
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 4.8;
  roof.castShadow = true;
  cottage.add(roof);

  // Deck / Porch
  const porch = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.25, 3.0),
    new THREE.MeshStandardMaterial({ color: 0x9e7b4e, roughness: 0.85 })
  );
  porch.position.set(0, 0.5, 3.8);
  porch.receiveShadow = true;
  cottage.add(porch);

  // Porch roof canopy
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 0.2, 2.6),
    new THREE.MeshStandardMaterial({ color: 0x3d3023, roughness: 0.7 })
  );
  canopy.position.set(0, 3.2, 3.6);
  canopy.rotation.x = 0.15;
  canopy.castShadow = true;
  cottage.add(canopy);

  // Chimney
  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 2.2, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x44403c, roughness: 0.95 })
  );
  chimney.position.set(2.0, 5.0, -1.0);
  chimney.castShadow = true;
  cottage.add(chimney);

  g.add(cottage);
  registerObstacle('farm_cottage', -16, 5.5, 5.5);

  // Tilled Vegetable Garden Plots
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x422d1b, roughness: 0.95 });
  const cabbageMat = new THREE.MeshStandardMaterial({ color: 0x48bb78, roughness: 0.6 });
  const carrotMat = new THREE.MeshStandardMaterial({ color: 0xed8936, roughness: 0.5 });
  const carrotLeafMat = new THREE.MeshStandardMaterial({ color: 0x38a169, roughness: 0.6 });

  // Plot 1: Cabbage
  const plot1 = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 3.4), soilMat);
  plot1.position.set(-13.5, 0.42, 14.5);
  plot1.receiveShadow = true;
  g.add(plot1);

  for (let r = -1.2; r <= 1.2; r += 0.8) {
    for (let c = -2.0; c <= 2.0; c += 0.9) {
      const cab = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 1), cabbageMat);
      cab.position.set(-13.5 + c, 0.58, 14.5 + r);
      cab.castShadow = true;
      g.add(cab);
    }
  }

  // Plot 2: Carrots
  const plot2 = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.18, 3.2), soilMat);
  plot2.position.set(-8.8, 0.42, 16.0);
  plot2.receiveShadow = true;
  g.add(plot2);

  for (let r = -1.0; r <= 1.0; r += 0.7) {
    for (let c = -1.8; c <= 1.8; c += 0.6) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 4), carrotLeafMat);
      leaf.position.set(-8.8 + c, 0.62, 16.0 + r);
      leaf.castShadow = true;
      g.add(leaf);
    }
  }

  // Wooden Fences with colorful bunting
  _buildFenceWithBunting(g, -16.5, 12.0, -5.5, 12.0);
  _buildFenceWithBunting(g, -16.5, 12.0, -16.5, 18.0);
  _buildFenceWithBunting(g, -16.5, 18.0, -6.0, 18.0);

  // Scarecrow
  const scarecrow = _buildScarecrow();
  scarecrow.position.set(-13.2, 0.45, 12.8);
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
    const px = x1 + dx * t;
    const pz = z1 + dz * t;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.4, 6), postMat);
    post.position.set(px, 0.95, pz);
    post.castShadow = true;
    group.add(post);
  }

  // Horizontal rails
  const midX = (x1 + x2) * 0.5, midZ = (z1 + z2) * 0.5;
  const angle = Math.atan2(dz, dx);
  const rail1 = new THREE.Mesh(new THREE.BoxGeometry(dist, 0.08, 0.06), railMat);
  rail1.position.set(midX, 1.15, midZ);
  rail1.rotation.y = -angle;
  rail1.castShadow = true;
  group.add(rail1);

  const rail2 = new THREE.Mesh(new THREE.BoxGeometry(dist, 0.08, 0.06), railMat);
  rail2.position.set(midX, 0.75, midZ);
  rail2.rotation.y = -angle;
  rail2.castShadow = true;
  group.add(rail2);

  // Bunting flags
  const colors = [0xe53e3e, 0xdd6b20, 0xd69e2e, 0x38a169, 0x3182ce, 0x805ad5];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const flagMat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 3), flagMat);
    flag.position.set(x1 + dx * t, 0.95, z1 + dz * t);
    flag.rotation.z = Math.PI;
    group.add(flag);
  }
}

function _buildScarecrow() {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6e5233, roughness: 0.9 });
  const clothMat = new THREE.MeshStandardMaterial({ color: 0x3182ce, roughness: 0.8 });
  const hatMat = new THREE.MeshStandardMaterial({ color: 0xd69e2e, roughness: 0.7 });

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.2, 6), woodMat);
  post.position.y = 1.1;
  post.castShadow = true;
  g.add(post);

  const arms = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), woodMat);
  arms.position.y = 1.6;
  arms.rotation.z = Math.PI / 2;
  arms.castShadow = true;
  g.add(arms);

  const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.8, 6), clothMat);
  coat.position.y = 1.4;
  coat.castShadow = true;
  g.add(coat);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshStandardMaterial({ color: 0xf6e05e, roughness: 0.9 }));
  head.position.y = 1.95;
  g.add(head);

  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.3, 8), hatMat);
  hat.position.y = 2.2;
  hat.castShadow = true;
  g.add(hat);

  return g;
}

function _buildFishingDock(parent) {
  const g = new THREE.Group();
  g.name = 'fishing_dock_cluster';

  // Wooden dock platform
  const dockWoodMat = new THREE.MeshStandardMaterial({ color: 0x8c6239, roughness: 0.85 });
  const plank = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.22, 5.0), dockWoodMat);
  plank.position.set(13.5, 0.28, 17.5);
  plank.castShadow = true;
  plank.receiveShadow = true;
  g.add(plank);

  // Pilings into water
  const postMat = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.95 });
  const postCoords = [
    [11.6, 15.2], [15.4, 15.2],
    [11.6, 19.8], [15.4, 19.8]
  ];
  for (const [px, pz] of postCoords) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.8, 8), postMat);
    p.position.set(px, -0.3, pz);
    p.castShadow = true;
    g.add(p);
  }

  // Floating Lily Pads
  const lilyMat = new THREE.MeshStandardMaterial({ color: 0x38a169, roughness: 0.5 });
  const lilyCoords = [
    [16.2, 17.0, 0.45],
    [15.5, 18.5, 0.65],
    [17.5, 19.2, 0.40],
    [14.2, 21.0, 0.50],
    [12.5, 21.5, 0.35]
  ];
  for (const [lx, lz, rad] of lilyCoords) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.03, 16), lilyMat);
    pad.position.set(lx, 0.02, lz);
    pad.receiveShadow = true;
    g.add(pad);
  }

  registerObstacle('fishing_dock', 13.5, 17.5, 3.2);
  parent.add(g);
}

function _buildSacredHill(parent) {
  const g = new THREE.Group();
  g.name = 'sacred_hill_plateau';

  // Grassy terrace layers rising towards portal
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x48a038, roughness: 0.9 });
  const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(14, 16, 2.0, 16), hillMat);
  tier1.position.set(24, 0.8, -12);
  tier1.receiveShadow = true;
  g.add(tier1);

  const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(9, 12, 2.2, 14), hillMat);
  tier2.position.set(26, 2.6, -13);
  tier2.receiveShadow = true;
  g.add(tier2);

  const tier3 = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, 1.6, 12), hillMat);
  tier3.position.set(28, 4.2, -14);
  tier3.receiveShadow = true;
  g.add(tier3);

  // Stone steps up the hill
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.85 });
  for (let s = 0; s < 7; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 0.8), stoneMat);
    step.position.set(19.5 + s * 1.1, 1.2 + s * 0.45, -11.5 - s * 0.4);
    step.rotation.y = -0.3;
    step.castShadow = true;
    step.receiveShadow = true;
    g.add(step);
  }

  parent.add(g);
}

function _buildStonePath(parent) {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8c8275, roughness: 0.9 });
  const pathPoints = [
    [-11, 8.5], [-9, 9.2], [-7, 9.8], [-5, 10.5], [-3, 11.0], [-1, 10.5],
    [1, 9.8], [3, 9.0], [5, 8.0], /* bridge */ [7, 6.8], [9, 5.5],
    [11, 4.0], [13, 2.0], [15, 0.0], [17, -2.5], [18.5, -6.0], [19.5, -9.5]
  ];

  for (let i = 0; i < pathPoints.length; i++) {
    const [px, pz] = pathPoints[i];
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.08, 7), stoneMat);
    s.position.set(px, 0.38, pz);
    s.rotation.y = (i * 1.3) % Math.PI;
    s.receiveShadow = true;
    g.add(s);
  }

  parent.add(g);
}

/* ---------------------------------------------------------- 14 Props Placement */

function _placeAllProps(root) {
  const propsGroup = new THREE.Group();
  propsGroup.name = 'whispering_valley_props';

  // 1. Well (Stone Water Well by Farmhouse)
  _spawnProp(propsGroup, 'well', { x: -10.5, y: 0.45, z: 5.5, yaw: 0.4, scale: 1.1 });

  // 2. Barrels (Stacked by Well & Farmhouse & Dock)
  _spawnProp(propsGroup, 'barrel', { x: -9.5, y: 0.45, z: 7.0, yaw: 0.2, scale: 0.85 });
  _spawnProp(propsGroup, 'barrel', { x: -8.8, y: 0.45, z: 6.2, yaw: -0.6, scale: 0.85 });
  _spawnProp(propsGroup, 'barrel', { x: -13.2, y: 0.5, z: 8.8, yaw: 1.1, scale: 0.9 });
  _spawnProp(propsGroup, 'barrel', { x: 11.8, y: 0.38, z: 15.2, yaw: 0.5, scale: 0.8 });

  // 3. Boxes / Crates (Stacked by Farmhouse Porch)
  _spawnProp(propsGroup, 'box', { x: -14.2, y: 0.5, z: 8.2, yaw: 0.15, scale: 0.9 });
  _spawnProp(propsGroup, 'box', { x: -14.2, y: 1.1, z: 8.2, yaw: -0.25, scale: 0.75 });
  _spawnProp(propsGroup, 'box', { x: -13.2, y: 0.5, z: 7.5, yaw: 0.8, scale: 0.85 });

  // 4. Watering Can (In the Vegetable Garden Plot)
  _spawnProp(propsGroup, 'watering_can', { x: -10.5, y: 0.45, z: 15.2, yaw: -0.8, scale: 0.6 });

  // 5. Bridge (Arched Wooden Bridge crossing the Stream)
  _spawnProp(propsGroup, 'bridge', { x: 5.5, y: 0.35, z: 7.5, yaw: -0.42, scale: 1.25 });

  // 6. Fishing Stool (On the Fishing Dock)
  _spawnProp(propsGroup, 'fishing_stool', { x: 13.5, y: 0.38, z: 17.5, yaw: 1.8, scale: 0.8 });

  // 7. Lamp Posts (Bridge entrances, Path, Torii Gate)
  _spawnProp(propsGroup, 'lamp_post', { x: 2.8, y: 0.4, z: 9.5, yaw: 0.5, scale: 0.95 });
  _spawnProp(propsGroup, 'lamp_post', { x: 8.2, y: 0.4, z: 5.5, yaw: -1.2, scale: 0.95 });
  _spawnProp(propsGroup, 'lamp_post', { x: 17.0, y: 1.8, z: -9.5, yaw: 0.2, scale: 1.0 });
  _spawnProp(propsGroup, 'lamp_post', { x: 25.5, y: 3.8, z: -11.8, yaw: -0.7, scale: 1.0 });

  // 8. Torii Gate (Red Shrine Gate at approach to hill)
  _spawnProp(propsGroup, 'torii_gate', { x: 18.5, y: 1.7, z: -11.0, yaw: -0.4, scale: 1.4 });

  // 9. Portal (Mystic Stone Swirl Portal on top of the Hill)
  _spawnProp(propsGroup, 'portal', { x: 28.0, y: 3.6, z: -13.5, yaw: -0.6, scale: 1.35 });

  // 10. Older Sprite (Valley Spirits in charming spots)
  _spawnProp(propsGroup, 'older_sprite', { x: -15.0, y: 0.8, z: 8.0, yaw: 0.3, scale: 0.65 }); // Cottage porch
  _spawnProp(propsGroup, 'older_sprite', { x: -11.5, y: 0.5, z: 16.0, yaw: -0.5, scale: 0.65 }); // Carrot patch
  _spawnProp(propsGroup, 'older_sprite', { x: -14.0, y: 0.5, z: 14.5, yaw: 0.2, scale: 0.65 }); // Scarecrow
  _spawnProp(propsGroup, 'older_sprite', { x: -2.5, y: 0.45, z: 11.5, yaw: 1.1, scale: 0.65 }); // Meadow path
  _spawnProp(propsGroup, 'older_sprite', { x: 12.5, y: 0.38, z: 16.5, yaw: 0.7, scale: 0.65 }); // Fishing dock
  _spawnProp(propsGroup, 'older_sprite', { x: 15.5, y: 0.05, z: 18.5, yaw: 0.0, scale: 0.60 }); // Floating on lily pad!
  _spawnProp(propsGroup, 'older_sprite', { x: 19.0, y: 1.9, z: -12.5, yaw: 0.5, scale: 0.70 }); // Torii gate
  _spawnProp(propsGroup, 'older_sprite', { x: 26.5, y: 3.8, z: -13.0, yaw: -0.4, scale: 0.70 }); // Beside portal

  // 11. Red Flower Plant (Along shoreline, bridge, portal, garden)
  _spawnProp(propsGroup, 'red_flower_plant', { x: 17.5, y: 0.25, z: 9.0, yaw: 0.3, scale: 0.8 });
  _spawnProp(propsGroup, 'red_flower_plant', { x: 20.0, y: 0.25, z: 13.0, yaw: 1.2, scale: 0.85 });
  _spawnProp(propsGroup, 'red_flower_plant', { x: 4.2, y: 0.35, z: 11.5, yaw: -0.8, scale: 0.75 });
  _spawnProp(propsGroup, 'red_flower_plant', { x: 30.5, y: 3.7, z: -11.5, yaw: 0.4, scale: 0.9 });
  _spawnProp(propsGroup, 'red_flower_plant', { x: 25.5, y: 3.7, z: -15.5, yaw: -1.1, scale: 0.85 });
  _spawnProp(propsGroup, 'red_flower_plant', { x: -7.5, y: 0.45, z: 18.5, yaw: 0.6, scale: 0.75 });

  // 12. Rock 1 & Rock 2 (River Boulders & Mossy Rocks)
  _spawnProp(propsGroup, 'rock_1', { x: 1.5, y: 0.15, z: -5.0, yaw: 0.5, scale: 1.2 });
  _spawnProp(propsGroup, 'rock_1', { x: 6.8, y: 0.20, z: 3.5, yaw: -0.4, scale: 1.1 });
  _spawnProp(propsGroup, 'rock_1', { x: 11.0, y: 0.15, z: 10.5, yaw: 0.9, scale: 1.3 });
  _spawnProp(propsGroup, 'rock_1', { x: -2.0, y: 0.25, z: 2.5, yaw: 1.5, scale: 1.0 });

  _spawnProp(propsGroup, 'rock_2', { x: 4.5, y: 0.08, z: 9.0, yaw: 0.2, scale: 0.9 });
  _spawnProp(propsGroup, 'rock_2', { x: 15.0, y: 0.12, z: 21.0, yaw: -0.7, scale: 1.1 });
  _spawnProp(propsGroup, 'rock_2', { x: 8.5, y: 0.12, z: -1.5, yaw: 1.3, scale: 0.95 });
  _spawnProp(propsGroup, 'rock_2', { x: 22.0, y: 0.18, z: 2.0, yaw: 0.6, scale: 1.05 });

  // 13. Tree (Valley Conifers framing the settlement)
  _spawnProp(propsGroup, 'tree', { x: -24.0, y: 0.6, z: 3.0, yaw: 0.2, scale: 1.5 });
  _spawnProp(propsGroup, 'tree', { x: -22.5, y: 0.6, z: 13.0, yaw: 0.9, scale: 1.4 });
  _spawnProp(propsGroup, 'tree', { x: -23.0, y: 0.6, z: 23.0, yaw: -0.4, scale: 1.6 });
  _spawnProp(propsGroup, 'tree', { x: -12.0, y: 0.8, z: -22.0, yaw: 1.1, scale: 1.5 });
  _spawnProp(propsGroup, 'tree', { x: 2.0, y: 0.8, z: -30.0, yaw: -0.7, scale: 1.7 });
  _spawnProp(propsGroup, 'tree', { x: 12.0, y: 0.8, z: -26.0, yaw: 0.4, scale: 1.5 });
  _spawnProp(propsGroup, 'tree', { x: 30.0, y: 3.8, z: -22.0, yaw: 0.8, scale: 1.6 });
  _spawnProp(propsGroup, 'tree', { x: 34.0, y: 3.8, z: -15.0, yaw: -0.3, scale: 1.5 });
  _spawnProp(propsGroup, 'tree', { x: 33.0, y: 2.5, z: -7.0, yaw: 0.5, scale: 1.4 });

  root.add(propsGroup);
}

function _spawnProp(group, assetKey, transform) {
  const placeholder = _createFastPlaceholder(assetKey);
  const node = new THREE.Group();
  node.name = `prop_${assetKey}_${Math.random().toString(36).substr(2, 6)}`;
  node.userData = { assetKey, transform };

  node.position.set(transform.x, transform.y, transform.z);
  node.rotation.y = transform.yaw || 0;
  const s = transform.scale || 1.0;
  node.scale.set(s, s, s);

  node.add(placeholder);
  group.add(node);

  registerObstacle(node.name, transform.x, transform.z, 1.5 * s);
  return node;
}

/**
 * Creates an instant, beautiful stylized placeholder so the map appears in under 50ms!
 */
function _createFastPlaceholder(key) {
  const g = new THREE.Group();
  let mesh;

  switch (key) {
    case 'barrel': {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.38, 0.45, 1.0, 10),
        new THREE.MeshStandardMaterial({ color: 0x8c5b2e, roughness: 0.75 })
      );
      mesh.position.y = 0.5;
      mesh.castShadow = true;
      g.add(mesh);
      break;
    }
    case 'box': {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.75, 0.75),
        new THREE.MeshStandardMaterial({ color: 0xb7791f, roughness: 0.8 })
      );
      mesh.position.y = 0.38;
      mesh.castShadow = true;
      g.add(mesh);
      break;
    }
    case 'bridge': {
      const arch = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.3, 6.5),
        new THREE.MeshStandardMaterial({ color: 0x7c4a1e, roughness: 0.8 })
      );
      arch.position.y = 0.6;
      arch.castShadow = true;
      g.add(arch);
      break;
    }
    case 'fishing_stool': {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8),
        new THREE.MeshStandardMaterial({ color: 0x975a16, roughness: 0.8 })
      );
      mesh.position.y = 0.25;
      mesh.castShadow = true;
      g.add(mesh);
      break;
    }
    case 'lamp_post': {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.08, 2.0, 6),
        new THREE.MeshStandardMaterial({ color: 0x3d352e, roughness: 0.9 })
      );
      pole.position.y = 1.0;
      pole.castShadow = true;
      g.add(pole);

      const lantern = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.4, 0.35),
        new THREE.MeshStandardMaterial({ color: 0xed8936, emissive: 0xdd6b20, emissiveIntensity: 0.6, roughness: 0.3 })
      );
      lantern.position.y = 2.1;
      g.add(lantern);
      break;
    }
    case 'older_sprite': {
      // Cute glowing blue spirit
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 12, 10),
        new THREE.MeshStandardMaterial({
          color: 0x90cdf4,
          emissive: 0x3182ce,
          emissiveIntensity: 0.5,
          roughness: 0.2,
          transparent: true,
          opacity: 0.92
        })
      );
      body.position.y = 0.45;
      g.add(body);

      // Cute eyes
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a202c });
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), eyeMat);
      eyeL.position.set(-0.09, 0.48, 0.28);
      const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), eyeMat);
      eyeR.position.set(0.09, 0.48, 0.28);
      g.add(eyeL, eyeR);
      break;
    }
    case 'portal': {
      // Mystic Stone Swirl Portal
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.6, 0.35, 10, 24),
        new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.9 })
      );
      ring.position.y = 1.8;
      ring.castShadow = true;
      g.add(ring);

      const swirl = new THREE.Mesh(
        new THREE.CircleGeometry(1.4, 24),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85
        })
      );
      swirl.position.y = 1.8;
      g.add(swirl);
      break;
    }
    case 'red_flower_plant': {
      const pot = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x276749, roughness: 0.8 })
      );
      pot.position.y = 0.25;
      g.add(pot);

      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2;
        const fl = new THREE.Mesh(
          new THREE.ConeGeometry(0.12, 0.35, 5),
          new THREE.MeshStandardMaterial({ color: 0xe53e3e, roughness: 0.5 })
        );
        fl.position.set(Math.cos(ang) * 0.2, 0.48, Math.sin(ang) * 0.2);
        fl.castShadow = true;
        g.add(fl);
      }
      break;
    }
    case 'rock_1':
    case 'rock_2': {
      mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.7, 1),
        new THREE.MeshStandardMaterial({ color: key === 'rock_1' ? 0x64748b : 0x475569, roughness: 0.95 })
      );
      mesh.scale.set(1.2, 0.7, 1.0);
      mesh.position.y = 0.45;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      break;
    }
    case 'torii_gate': {
      const redMat = new THREE.MeshStandardMaterial({ color: 0xc53030, roughness: 0.6 });
      const pL = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3.2, 8), redMat);
      pL.position.set(-1.4, 1.6, 0);
      pL.castShadow = true;
      const pR = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3.2, 8), redMat);
      pR.position.set(1.4, 1.6, 0);
      pR.castShadow = true;
      const top = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.3, 0.4), redMat);
      top.position.set(0, 3.1, 0);
      top.castShadow = true;
      const sub = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.18, 0.3), redMat);
      sub.position.set(0, 2.6, 0);
      sub.castShadow = true;
      g.add(pL, pR, top, sub);
      break;
    }
    case 'tree': {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.3, 1.8, 6),
        new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 })
      );
      trunk.position.y = 0.9;
      trunk.castShadow = true;
      g.add(trunk);

      const leafMat = new THREE.MeshStandardMaterial({ color: 0x22543d, roughness: 0.75 });
      for (let l = 0; l < 3; l++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6 - l * 0.35, 1.6, 6), leafMat);
        cone.position.y = 1.8 + l * 0.9;
        cone.castShadow = true;
        g.add(cone);
      }
      break;
    }
    case 'watering_can': {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.25, 0.45, 8),
        new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.4, metalness: 0.7 })
      );
      mesh.position.y = 0.22;
      mesh.castShadow = true;
      g.add(mesh);
      break;
    }
    case 'well': {
      const stoneWall = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.95, 0.9, 12),
        new THREE.MeshStandardMaterial({ color: 0x5a554a, roughness: 0.95 })
      );
      stoneWall.position.y = 0.45;
      stoneWall.castShadow = true;
      g.add(stoneWall);

      const roofMat = new THREE.MeshStandardMaterial({ color: 0x744210, roughness: 0.8 });
      const wRoof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.8, 4), roofMat);
      wRoof.rotation.y = Math.PI / 4;
      wRoof.position.y = 1.9;
      wRoof.castShadow = true;
      g.add(wRoof);

      const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), roofMat);
      p1.position.set(-0.7, 1.2, 0);
      const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), roofMat);
      p2.position.set(0.7, 1.2, 0);
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
