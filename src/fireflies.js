import * as THREE from 'three';
import { groundHeight } from './terrain.js';

export const FIREFLY_N = 3600;

export function createFireflies(scene) {
  const fireflyBase = new Float32Array(FIREFLY_N * 3);
  const fireflyPhase = new Float32Array(FIREFLY_N);

  for (let i = 0; i < FIREFLY_N; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 4 + Math.sqrt(Math.random()) * 165;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const gh = groundHeight(x, z);
    fireflyBase.set([x, Math.max(gh, 0.2) + 0.4 + Math.random() * 3.8, z], i * 3);
    fireflyPhase[i] = Math.random() * Math.PI * 2;
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
      transformed.x += sin(uTime * 0.5 + aPhase) * 1.6;
      transformed.y += sin(uTime * 0.7 + aPhase * 2.1) * 0.7;
      transformed.z += cos(uTime * 0.4 + aPhase * 1.6) * 1.6;`
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
