import * as THREE from 'three';
import { groundHeight, pathCenterZ, PATH_RADIUS, terrainAlbedo } from './terrain.js';
import { addGroundBlend } from './groundBlend.js';

export function buildRocks(scene) {
  const N_ROCKS = 130;
  const rockGeo = new THREE.DodecahedronGeometry(0.75, 1);
  // Organic deformation of vertices
  const rpos = rockGeo.attributes.position;
  for (let j = 0; j < rpos.count; j++) {
    const rx = rpos.getX(j), ry = rpos.getY(j), rz = rpos.getZ(j);
    const noise = 1 + (Math.sin(rx * 3.7 + ry * 2.1) + Math.cos(rz * 4.2)) * 0.12;
    rpos.setXYZ(j, rx * noise, ry * (0.75 + noise * 0.25), rz * noise);
  }
  rockGeo.computeVertexNormals();

  const rockMat = new THREE.MeshStandardMaterial({
    roughness: 0.92,
    metalness: 0.05,
    flatShading: true
  });
  // Seamless contact ground blending for rocks into terrain
  addGroundBlend(rockMat, { blendHeight: 0.65, blendOffset: 0.35, hasAttribute: true });

  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, N_ROCKS);
  rocks.name = 'rocks_instanced';
  rocks.castShadow = true;
  rocks.receiveShadow = true;

  const terrainColors = new Float32Array(N_ROCKS * 3);

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const E = new THREE.Euler();
  const c = new THREE.Color();
  let i = 0;

  while (i < N_ROCKS) {
    const x = (Math.random() - 0.5) * 260;
    const side = Math.random() < 0.5 ? -1 : 1;
    // place primarily along the path borders (PATH_RADIUS ~4.2m)
    const offset = side * (PATH_RADIUS * 0.95 + Math.random() * 2.2);
    const z = pathCenterZ(x) + offset;
    const h = groundHeight(x, z);
    if (h < 0.35 || h > 18) continue; // avoid deep water or high peaks

    const s = 0.22 + Math.pow(Math.random(), 2.0) * 1.05;
    E.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    Q.setFromEuler(E);
    P.set(x, h - s * 0.25, z);
    S.set(s * (0.8 + Math.random() * 0.6), s * (0.45 + Math.random() * 0.4), s * (0.8 + Math.random() * 0.6));
    M.compose(P, Q, S);
    rocks.setMatrixAt(i, M);
    c.setHSL(0.12 + Math.random() * 0.08, 0.06 + Math.random() * 0.08, 0.34 + Math.random() * 0.18);
    rocks.setColorAt(i, c);

    const tc = terrainAlbedo(x, z, h);
    terrainColors[i * 3 + 0] = tc.r;
    terrainColors[i * 3 + 1] = tc.g;
    terrainColors[i * 3 + 2] = tc.b;
    i++;
  }
  rockGeo.setAttribute('aTerrainColor', new THREE.InstancedBufferAttribute(terrainColors, 3));
  rocks.instanceColor.needsUpdate = true;
  scene.add(rocks);

  return rocks;
}
