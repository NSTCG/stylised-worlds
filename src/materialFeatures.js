/**
 * src/materialFeatures.js
 * Model Material Setup & Atmospheric Integration:
 * - Enables native Three.js atmospheric fog across all model materials
 * - Configures shadow casting and shadow receiving
 * - Ensures rock-solid WebGL shader compatibility (zero program linking failures)
 */
import * as THREE from 'three';
import { attachOutline } from './outlineEffect.js';

export function applyGroundBlendingAndFog(material, options = {}) {
  if (!material || material.isShaderMaterial || material.isRawShaderMaterial) return;
  material.fog = true;
  material.needsUpdate = true;
}

/**
 * Traverses a 3D object / hierarchy and configures lighting, shadows, and fog
 */
export function setupModelMaterials(object, options = {}) {
  if (!object) return;
  if (object.userData?.isVRM || object.userData?.isAvatar) return;
  object.traverse((child) => {
    if (child.userData?.isVRM || child.userData?.isAvatar || child.userData?.isOutlineMesh) return;
    if (child.isMesh && child.material) {
      child.castShadow = true;
      child.receiveShadow = true;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        if (!m || m.isShaderMaterial || m.isRawShaderMaterial) continue;
        m.fog = true;
        m.needsUpdate = true;
      }
      attachOutline(child);
    }
  });
}
