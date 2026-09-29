/**
 * src/outlineEffect.js
 * High-performance, zero-post-processing Inverted Hull Cel Outlines:
 * - Extrudes vertex normals in view-space on BackSide
 * - Renders crisp anime / comic-style silhouette outlines directly in the main render pass
 * - Zero post-processing overhead (100% compatible with Quest VR, mobile, and desktop)
 * - Off by default, cleanly toggled via UI
 */
import * as THREE from 'three';
import { windUniforms } from './wind.js';

const _sharedOutlineWidth = { value: 0.026 };
const _sharedOutlineColor = { value: new THREE.Color(0x111612) };
const _sharedFogColor = { value: new THREE.Color(0x000000) };

// Shared inverted-hull silhouette material (Standard)
const _outlineMaterial = new THREE.ShaderMaterial({
  name: 'GlobalInvertedHullOutline',
  fog: false,
  uniforms: {
    uOutlineWidth: _sharedOutlineWidth,
    uOutlineColor: _sharedOutlineColor,
    fogColor: _sharedFogColor // Fallback safeguard against Three.js refreshFogUniforms
  },
  vertexShader: `
    uniform float uOutlineWidth;

    void main() {
      vec3 objectNormal = normal;
      vec4 localPos = vec4(position, 1.0);

      #ifdef USE_INSTANCING
        mat3 im = mat3(instanceMatrix);
        objectNormal /= vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
        objectNormal = im * objectNormal;
        localPos = instanceMatrix * localPos;
      #endif

      vec3 transformedNormal = normalize(normalMatrix * objectNormal);
      vec4 mvPosition = modelViewMatrix * localPos;

      // Depth-compensated extrusion: crisp up close, legible on distant objects
      float depthFactor = clamp(1.0 - mvPosition.z * 0.032, 1.0, 3.2);
      mvPosition.xyz += transformedNormal * (uOutlineWidth * depthFactor);

      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 uOutlineColor;
    void main() {
      gl_FragColor = vec4(uOutlineColor, 1.0);
    }
  `,
  side: THREE.BackSide,
  depthWrite: true,
  depthTest: true
});

// Shared inverted-hull silhouette material for swaying trees / wind-affected foliage
const _windOutlineMaterial = new THREE.ShaderMaterial({
  name: 'GlobalInvertedHullOutline_Wind',
  fog: false,
  uniforms: {
    uOutlineWidth: _sharedOutlineWidth,
    uOutlineColor: _sharedOutlineColor,
    fogColor: _sharedFogColor,
    uTime: windUniforms.uTime
  },
  vertexShader: `
    uniform float uOutlineWidth;
    uniform float uTime;

    void main() {
      vec3 objectNormal = normal;
      vec3 transformed = position;

      #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
        float ph = (ip.x * 0.37 + ip.z * 0.43);
        float w = sin(uTime * 1.1 + ph) + 0.5 * sin(uTime * 2.7 + ph * 1.7);
        float bend = max(transformed.y, 0.0) * 0.05;
        transformed.x += w * bend;
        transformed.z += cos(uTime * 0.8 + ph * 1.3) * bend * 0.7;

        mat3 im = mat3(instanceMatrix);
        objectNormal /= vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
        objectNormal = im * objectNormal;
        vec4 localPos = instanceMatrix * vec4(transformed, 1.0);
      #else
        vec4 localPos = vec4(transformed, 1.0);
      #endif

      vec3 transformedNormal = normalize(normalMatrix * objectNormal);
      vec4 mvPosition = modelViewMatrix * localPos;

      float depthFactor = clamp(1.0 - mvPosition.z * 0.032, 1.0, 3.2);
      mvPosition.xyz += transformedNormal * (uOutlineWidth * depthFactor);

      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 uOutlineColor;
    void main() {
      gl_FragColor = vec4(uOutlineColor, 1.0);
    }
  `,
  side: THREE.BackSide,
  depthWrite: true,
  depthTest: true
});

// Protect materials from being overwritten with fog = true by scene traversals
Object.defineProperty(_outlineMaterial, 'fog', {
  value: false,
  writable: false,
  configurable: false
});

Object.defineProperty(_windOutlineMaterial, 'fog', {
  value: false,
  writable: false,
  configurable: false
});

function _shouldHaveOutline(mesh) {
  if (!mesh || (!mesh.isMesh && !mesh.isInstancedMesh)) return false;
  if (mesh.userData?.isOutlineMesh) return false;
  const n = mesh.name || '';
  if (n.includes('grass') || n.includes('brush') || n.includes('water') || n === 'sky_dome') return false;
  let p = mesh;
  while (p) {
    if (p.userData?.isVRM || p.userData?.isAvatar) return false;
    p = p.parent;
  }
  return true;
}

export function attachOutline(mesh) {
  if (!_shouldHaveOutline(mesh)) return;

  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const hasWind = (mesh.name && mesh.name.startsWith('trees_')) ||
                  mesh.userData?.hasWind ||
                  mats.some(m => m?.userData?.hasWind);
  const targetMat = hasWind ? _windOutlineMaterial : _outlineMaterial;

  // Check if an outline child already exists (e.g. from cloning or previous pass)
  const existingOutline = mesh.children?.find(ch => ch.userData?.isOutlineMesh);
  if (existingOutline) {
    existingOutline.visible = _outlinesEnabled;
    mesh.userData.hasOutlineAttached = true;
    if (existingOutline.material !== targetMat) {
      existingOutline.material = targetMat;
    }
    if (mesh.isInstancedMesh && existingOutline.isInstancedMesh) {
      existingOutline.count = mesh.count;
      existingOutline.instanceMatrix = mesh.instanceMatrix;
    }
    return;
  }

  mesh.userData = mesh.userData || {};
  mesh.userData.hasOutlineAttached = true;

  let outline;
  if (mesh.isInstancedMesh) {
    outline = new THREE.InstancedMesh(mesh.geometry, targetMat, mesh.count);
    outline.instanceMatrix = mesh.instanceMatrix;
    outline.count = mesh.count;
    if (mesh.instanceColor) outline.instanceColor = mesh.instanceColor;
    outline.onBeforeRender = () => {
      if (outline.count !== mesh.count) outline.count = mesh.count;
      if (outline.instanceMatrix !== mesh.instanceMatrix) {
        outline.instanceMatrix = mesh.instanceMatrix;
      }
    };
  } else {
    outline = new THREE.Mesh(mesh.geometry, targetMat);
  }

  outline.name = `${mesh.name || 'mesh'}_outline`;
  outline.userData.isOutlineMesh = true;
  outline.visible = _outlinesEnabled;
  outline.castShadow = false;
  outline.receiveShadow = false;
  mesh.add(outline);
}

export function attachOutlinesToScene(scene) {
  if (!scene) return;
  scene.traverse((obj) => {
    if ((obj.isMesh || obj.isInstancedMesh) && !obj.userData?.isOutlineMesh) {
      attachOutline(obj);
    }
  });
}

export const fragOutlineUniforms = {
  uFragOutlineActive: { value: 0.0 }
};

let _outlineMode = 'off'; // 'off' | 'frag' | 'shell'
let _outlinesEnabled = false;

export function getOutlineMode() {
  return _outlineMode;
}

export function setOutlineMode(scene, mode) {
  _outlineMode = mode === 'frag' || mode === 'shell' ? mode : 'off';
  _outlinesEnabled = (_outlineMode === 'shell');

  // 1. Update Frag Outline global uniform
  fragOutlineUniforms.uFragOutlineActive.value = (_outlineMode === 'frag') ? 1.0 : 0.0;

  // 2. Update Shell Meshes visibility
  if (scene) {
    if (_outlineMode === 'shell') {
      attachOutlinesToScene(scene);
    }
    scene.traverse((obj) => {
      if (obj.userData?.isOutlineMesh) {
        obj.visible = (_outlineMode === 'shell');
      }
    });
  }

  // 3. Sync UI buttons
  _syncOutlineButtons();

  // 4. Update scene triangle counter immediately
  if (typeof window !== 'undefined' && typeof window.updateStatsUI === 'function') {
    window.updateStatsUI();
  }

  return _outlineMode;
}

export function cycleOutlineMode(scene) {
  const nextMode = _outlineMode === 'off' ? 'frag' : (_outlineMode === 'frag' ? 'shell' : 'off');
  return setOutlineMode(scene, nextMode);
}

export function setOutlineEnabled(scene, enabled) {
  return setOutlineMode(scene, enabled ? 'shell' : 'off');
}

export function toggleOutline(scene) {
  return cycleOutlineMode(scene);
}

export function isOutlineEnabled() {
  return _outlineMode !== 'off';
}

function _syncOutlineButtons() {
  const btns = [document.getElementById('outlineBtn'), document.getElementById('sideOutlineBtn')];
  btns.forEach((btn) => {
    if (!btn) return;
    if (_outlineMode === 'frag') {
      btn.textContent = '⚡ Frag Outline (0 Tris)';
      btn.title = 'Fragment-Only Fake Normal Edge Outline (Zero extra triangles). Click to switch to Shell Outline.';
      btn.style.background = 'linear-gradient(135deg, rgba(234, 179, 8, 0.5), rgba(59, 130, 246, 0.5))';
      btn.style.borderColor = '#facc15';
      btn.style.color = '#fff';
    } else if (_outlineMode === 'shell') {
      btn.textContent = '📐 Shell Outline (Hull)';
      btn.title = 'Inverted Hull Geometric Shell Outline (Double mesh pass). Click to turn OFF.';
      btn.style.background = 'rgba(56, 189, 248, 0.45)';
      btn.style.borderColor = '#38bdf8';
      btn.style.color = '#fff';
    } else {
      btn.textContent = '✒️ Outline: OFF';
      btn.title = 'Turn on Cel Outlines: Click to switch to Frag Outline (0 Tris)';
      btn.style.background = 'rgba(255, 255, 255, 0.15)';
      btn.style.borderColor = 'rgba(255, 255, 255, 0.3)';
      btn.style.color = '#eaf2df';
    }
  });

  const offBtn = document.getElementById('outlineModeOffBtn');
  const fragBtn = document.getElementById('outlineModeFragBtn');
  const shellBtn = document.getElementById('outlineModeShellBtn');

  if (offBtn) {
    offBtn.style.background = _outlineMode === 'off' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
    offBtn.style.borderColor = _outlineMode === 'off' ? '#fff' : 'rgba(255,255,255,0.25)';
  }
  if (fragBtn) {
    fragBtn.style.background = _outlineMode === 'frag' ? 'rgba(234,179,8,0.45)' : 'rgba(255,255,255,0.12)';
    fragBtn.style.borderColor = _outlineMode === 'frag' ? '#facc15' : 'rgba(255,255,255,0.25)';
  }
  if (shellBtn) {
    shellBtn.style.background = _outlineMode === 'shell' ? 'rgba(56,189,248,0.45)' : 'rgba(255,255,255,0.12)';
    shellBtn.style.borderColor = _outlineMode === 'shell' ? '#38bdf8' : 'rgba(255,255,255,0.25)';
  }
}

// Hook DOM button click events
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('outlineModeOffBtn')?.addEventListener('click', () => setOutlineMode(window.scene, 'off'));
    document.getElementById('outlineModeFragBtn')?.addEventListener('click', () => setOutlineMode(window.scene, 'frag'));
    document.getElementById('outlineModeShellBtn')?.addEventListener('click', () => setOutlineMode(window.scene, 'shell'));
    _syncOutlineButtons();
  });
}
