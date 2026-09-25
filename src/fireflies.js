import * as THREE from 'three';
import { groundHeight, pathFactor, terrainAlbedo } from './terrain.js';

export const FIREFLY_N = 3600;

export function createFireflies(scene) {
  const fireflyBase = new Float32Array(FIREFLY_N * 3);
  const fireflyPhase = new Float32Array(FIREFLY_N);

  let placed = 0;
  let attempts = 0;
  const maxAttempts = FIREFLY_N * 40;

  // Place fireflies strictly over lush grass areas
  while (placed < FIREFLY_N && attempts < maxAttempts) {
    attempts++;
    const a = Math.random() * Math.PI * 2;
    const r = 2.5 + Math.sqrt(Math.random()) * 85; // within grass radius
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const gh = groundHeight(x, z);

    // Filter out water (gh < 0.5), barren mountain summits (gh > 14.0), and paths
    if (gh < 0.5 || gh > 14.0) continue;
    if (pathFactor(x, z) > 0.22) continue;

    // Check terrain biome greenness
    const tc = terrainAlbedo(x, z, gh);
    const greenness = (tc.g - tc.r) / 0.18;
    if (greenness < 0.22) continue;

    // Hover directly above grass canopy (0.35m to 1.70m above ground surface)
    const hoverH = gh + 0.35 + Math.random() * 1.35;
    fireflyBase.set([x, hoverH, z], placed * 3);
    fireflyPhase[placed] = Math.random() * Math.PI * 2;
    placed++;
  }

  // Fallback in the rare case max attempts reached: duplicate valid points with slight jitter
  while (placed < FIREFLY_N) {
    const srcIdx = Math.floor(Math.random() * Math.max(1, placed));
    const jx = (Math.random() - 0.5) * 1.5;
    const jz = (Math.random() - 0.5) * 1.5;
    const x = fireflyBase[srcIdx * 3] + jx;
    const z = fireflyBase[srcIdx * 3 + 2] + jz;
    const gh = groundHeight(x, z);
    fireflyBase.set([x, Math.max(gh + 0.35, fireflyBase[srcIdx * 3 + 1]), z], placed * 3);
    fireflyPhase[placed] = Math.random() * Math.PI * 2;
    placed++;
  }

  const fireflyGeo = new THREE.BufferGeometry();
  fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyBase, 3));
  fireflyGeo.setAttribute('aPhase', new THREE.BufferAttribute(fireflyPhase, 1));

  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const cx = cv.getContext('2d');
  const g = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,235,170,0.8)');
  g.addColorStop(1, 'rgba(255,220,140,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, 64, 64);

  const sprite = new THREE.CanvasTexture(cv);
  sprite.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.PointsMaterial({
    map: sprite,
    color: 0xffd97a,
    size: 0.34,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false
  });

  const fireflyUniforms = { uTime: { value: 0 } };

    mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = fireflyUniforms.uTime;
    shader.vertexShader = `
      attribute float aPhase;
      uniform float uTime;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      transformed.x += sin(uTime * 0.45 + aPhase) * 1.1;
      transformed.y += sin(uTime * 0.65 + aPhase * 2.1) * 0.28;
      transformed.z += cos(uTime * 0.38 + aPhase * 1.6) * 1.1;`
    );
  };

  const pts = new THREE.Points(fireflyGeo, mat);
  pts.frustumCulled = false;
  scene.add(pts);

  function updateFireflies(t) {
    fireflyUniforms.uTime.value = t;
  }

  return { pts, updateFireflies };
}
