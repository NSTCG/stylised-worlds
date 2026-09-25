import * as THREE from 'three';
import { fbm, terrainAlbedo } from './terrain.js';
import { addGroundBlend } from './groundBlend.js';

export function createMountain(scene) {
  const ang = Math.PI + 0.88;
  const cx = Math.cos(ang) * 192, cz = Math.sin(ang) * 192;
  const H = 118, BASE = 78, SINK = 40; // deep base: rises from sea
  const geo = new THREE.ConeGeometry(BASE, H, 26, 9);
  geo.translate(0, H / 2 - SINK, 0);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cRock = new THREE.Color(0x59615a), cSnow = new THREE.Color(0xe3e8ec);
  const _tc = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 0.5) {
      const a = Math.atan2(z, x);
      const hF = THREE.MathUtils.clamp((y + SINK) / H, 0, 1);
      const jag = (fbm(a * 3.1 + 7.3, hF * 2.6 + 1.9) - 0.5) * 2;
      const rr = r * (1 + jag * 0.28 * (0.35 + 0.65 * hF));
      x = x / r * rr; z = z / r * rr; y += jag * (4 + 10 * hF);
      pos.setXYZ(i, x, y, z);
    }
    const hF = THREE.MathUtils.clamp((y + SINK) / H, 0, 1);
    const n2 = fbm(x * 0.11 + 3.7, z * 0.11 + 8.2);
    _tc.copy(cRock).lerp(cSnow, THREE.MathUtils.smoothstep(hF, 0.58 + n2 * 0.16, 0.72 + n2 * 0.16));
    colors.set([_tc.r, _tc.g, _tc.b], i * 3);
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1.0, metalness: 0, flatShading: true
  });

  // Seamless contact ground blending for mountain base into island terrain
  const groundCol = terrainAlbedo(cx, cz);
  addGroundBlend(mat, {
    blendHeight: 18.0,
    blendOffset: 0.0,
    hasAttribute: false,
    fixedColor: new THREE.Color(groundCol.r, groundCol.g, groundCol.b)
  });

  const mountain = new THREE.Mesh(geo, mat);
  mountain.name = 'mountain_mesh';
  mountain.position.set(cx, 0, cz);
  mountain.castShadow = true;
  mountain.receiveShadow = true;
  scene.add(mountain);

  return mountain;
}
