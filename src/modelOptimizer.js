/**
 * src/modelOptimizer.js
 * High-performance mesh simplification (MeshoptSimplifier WASM) and texture compression/downscaling.
 */
import * as THREE from 'three';
import { MeshoptSimplifier } from './libs/meshopt_simplifier.module.js';

let _simplifierReady = false;
export async function ensureSimplifier() {
  if (!_simplifierReady) {
    await MeshoptSimplifier.ready;
    _simplifierReady = true;
  }
}

/**
 * Scan a 3D model hierarchy and compute detailed statistics
 */
export function analyzeModel(rootObject, originalFileSizeBytes = 0) {
  let triangles = 0;
  let vertices = 0;
  let meshCount = 0;
  const texturesMap = new Map(); // uuid -> { name, width, height, format, sizeEstimate, type }
  const materialsSet = new Set();

  rootObject.traverse((node) => {
    if (node.isMesh && node.geometry) {
      meshCount++;
      const geo = node.geometry;
      const pos = geo.attributes.position;
      if (pos) vertices += pos.count;
      if (geo.index) {
        triangles += geo.index.count / 3;
      } else if (pos) {
        triangles += pos.count / 3;
      }

      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        if (!m) continue;
        materialsSet.add(m);
        const mapTypes = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
        for (const mType of mapTypes) {
          const tex = m[mType];
          if (tex && tex.isTexture && tex.image && !texturesMap.has(tex.uuid)) {
            const img = tex.image;
            const w = img.naturalWidth || img.videoWidth || img.width || 1024;
            const h = img.naturalHeight || img.videoHeight || img.height || 1024;
            const vramBytes = w * h * 4 * 1.333; // With mipmaps
            // Approximate PNG/uncompressed size in GLB
            const estimatedBytes = (w * h * 0.9); // Average PNG size heuristic
            texturesMap.set(tex.uuid, {
              uuid: tex.uuid,
              name: tex.name || mType,
              type: mType,
              width: w,
              height: h,
              vramBytes,
              estimatedBytes
            });
          }
        }
      }
    }
  });

  const textures = Array.from(texturesMap.values());
  const totalTexBytes = textures.reduce((acc, t) => acc + t.estimatedBytes, 0);
  const totalVramBytes = textures.reduce((acc, t) => acc + t.vramBytes, 0);
  const geoBytes = (vertices * 32) + (triangles * 12); // Positions (12) + Normals (12) + UVs (8) + Indices (12)
  const totalSizeBytes = originalFileSizeBytes > 0 ? originalFileSizeBytes : (geoBytes + totalTexBytes);

  return {
    triangles: Math.round(triangles),
    vertices,
    meshCount,
    materialCount: materialsSet.size,
    textures,
    geoBytes,
    totalTexBytes,
    totalVramBytes,
    totalSizeBytes,
    fileSizeMB: (totalSizeBytes / (1024 * 1024)).toFixed(1)
  };
}

/**
 * Predict estimated size and savings based on chosen optimization options
 */
export function estimateOptimizedSize(analysis, options) {
  const {
    simplifyRatio = 0.5,
    maxTextureRes = 1024,
    textureFormat = 'webp',
    textureQuality = 0.8,
    stripNormalMap = false
  } = options;

  // Geometry prediction
  const effectiveRatio = Math.max(0.08, Math.min(1.0, simplifyRatio));
  const estTris = Math.round(analysis.triangles * effectiveRatio);
  const estVerts = Math.round(analysis.vertices * effectiveRatio);
  const estGeoBytes = (estVerts * 32) + (estTris * 12);

  // Textures prediction
  let estTexBytes = 0;
  let estVramBytes = 0;

  for (const t of analysis.textures) {
    if (stripNormalMap && t.type === 'normalMap') {
      continue; // stripped
    }

    let w = t.width;
    let h = t.height;
    if (maxTextureRes < Infinity && Math.max(w, h) > maxTextureRes) {
      if (w >= h) {
        h = Math.round((h / w) * maxTextureRes);
        w = maxTextureRes;
      } else {
        w = Math.round((w / h) * maxTextureRes);
        h = maxTextureRes;
      }
    }

    estVramBytes += w * h * 4 * 1.333;

    // WebP vs JPEG vs PNG byte size estimate
    const pixels = w * h;
    let bytePerPixel = 0.22; // WebP average at 0.8
    if (textureFormat === 'jpeg') bytePerPixel = 0.32;
    else if (textureFormat === 'png') bytePerPixel = 0.75;
    bytePerPixel *= (textureQuality / 0.8);

    estTexBytes += Math.max(16000, Math.round(pixels * bytePerPixel));
  }

  const estTotalBytes = estGeoBytes + estTexBytes;
  const origTotal = analysis.totalSizeBytes;
  const savingsBytes = Math.max(0, origTotal - estTotalBytes);
  const savingsPercent = origTotal > 0 ? Math.min(99.5, ((savingsBytes / origTotal) * 100)).toFixed(1) : '0';

  return {
    estTris,
    estVerts,
    estGeoMB: (estGeoBytes / (1024 * 1024)).toFixed(2),
    estTexMB: (estTexBytes / (1024 * 1024)).toFixed(2),
    estVramMB: (estVramBytes / (1024 * 1024)).toFixed(1),
    origVramMB: (analysis.totalVramBytes / (1024 * 1024)).toFixed(1),
    estTotalMB: (estTotalBytes / (1024 * 1024)).toFixed(1),
    savingsPercent,
    savingsMB: (savingsBytes / (1024 * 1024)).toFixed(1)
  };
}

/**
 * Simplify a single BufferGeometry using MeshoptSimplifier and compact unreferenced attributes
 */
export function simplifyBufferGeometry(geo, ratio = 0.5, targetError = 0.02, recomputeNormals = false) {
  const posAttr = geo.attributes.position;
  if (!posAttr) return geo;

  let indices = geo.index ? geo.index.array : null;
  if (!indices) {
    indices = new Uint32Array(posAttr.count);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
  }

  const origTris = indices.length / 3;
  if (ratio >= 0.99) {
    return geo.clone(); // Keep original full detail
  }

  const targetTris = Math.max(12, Math.floor(origTris * ratio));
  const targetIndexCount = targetTris * 3;

  MeshoptSimplifier.useExperimentalFeatures = true;

  let destIndices = null;
  let resultError = 0;

  const uvAttr = geo.attributes.uv;
  const normAttr = geo.attributes.normal;

  // Use attribute-aware simplification if UVs are available to preserve UV seams and texture mapping
  if (uvAttr && MeshoptSimplifier.simplifyWithAttributes) {
    try {
      const vertCount = posAttr.count;
      let attrStride = 2;
      let weights = [1.5, 1.5]; // High weight protects UV coordinates from collapsing across seams
      let attrData = null;

      if (normAttr) {
        attrStride = 5;
        weights = [0.5, 0.5, 0.5, 1.5, 1.5];
        attrData = new Float32Array(vertCount * 5);
        for (let i = 0; i < vertCount; i++) {
          attrData[i * 5 + 0] = normAttr.getX(i);
          attrData[i * 5 + 1] = normAttr.getY(i);
          attrData[i * 5 + 2] = normAttr.getZ(i);
          attrData[i * 5 + 3] = uvAttr.getX(i);
          attrData[i * 5 + 4] = uvAttr.getY(i);
        }
      } else {
        attrData = uvAttr.array instanceof Float32Array ? uvAttr.array : new Float32Array(uvAttr.array);
      }

      const res = MeshoptSimplifier.simplifyWithAttributes(
        indices,
        posAttr.array,
        3,
        attrData,
        attrStride,
        weights,
        null,
        targetIndexCount,
        targetError
      );
      destIndices = res[0];
      resultError = res[1];
    } catch (err) {
      console.warn('simplifyWithAttributes failed, falling back to standard simplify with LockBorder:', err);
    }
  }

  // Fallback if simplifyWithAttributes was not used or failed
  if (!destIndices) {
    const res = MeshoptSimplifier.simplify(
      indices,
      posAttr.array,
      3,
      targetIndexCount,
      targetError,
      ['LockBorder']
    );
    destIndices = res[0];
    resultError = res[1];
  }

  // Compact vertices: strip unreferenced vertex attributes
  const oldVertCount = posAttr.count;
  const remap = new Int32Array(oldVertCount).fill(-1);
  let newVertCount = 0;
  for (let i = 0; i < destIndices.length; i++) {
    const idx = destIndices[i];
    if (remap[idx] === -1) {
      remap[idx] = newVertCount++;
    }
  }

  const newIndices = new Uint32Array(destIndices.length);
  for (let i = 0; i < destIndices.length; i++) {
    newIndices[i] = remap[destIndices[i]];
  }

  const colAttr = geo.attributes.color;

  const newPositions = new Float32Array(newVertCount * 3);
  const newNormals = normAttr ? new Float32Array(newVertCount * 3) : null;
  const newUvs = uvAttr ? new Float32Array(newVertCount * 2) : null;
  const newCols = colAttr ? new Float32Array(newVertCount * colAttr.itemSize) : null;

  for (let oldIdx = 0; oldIdx < oldVertCount; oldIdx++) {
    const newIdx = remap[oldIdx];
    if (newIdx !== -1) {
      newPositions[newIdx * 3 + 0] = posAttr.getX(oldIdx);
      newPositions[newIdx * 3 + 1] = posAttr.getY(oldIdx);
      newPositions[newIdx * 3 + 2] = posAttr.getZ(oldIdx);

      if (newNormals && normAttr) {
        newNormals[newIdx * 3 + 0] = normAttr.getX(oldIdx);
        newNormals[newIdx * 3 + 1] = normAttr.getY(oldIdx);
        newNormals[newIdx * 3 + 2] = normAttr.getZ(oldIdx);
      }

      if (newUvs && uvAttr) {
        newUvs[newIdx * 2 + 0] = uvAttr.getX(oldIdx);
        newUvs[newIdx * 2 + 1] = uvAttr.getY(oldIdx);
      }

      if (newCols && colAttr) {
        for (let k = 0; k < colAttr.itemSize; k++) {
          newCols[newIdx * colAttr.itemSize + k] = colAttr.getComponent(oldIdx, k);
        }
      }
    }
  }

  const newGeo = new THREE.BufferGeometry();
  newGeo.setIndex(new THREE.BufferAttribute(newIndices, 1));
  newGeo.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
  if (newNormals) newGeo.setAttribute('normal', new THREE.BufferAttribute(newNormals, 3));
  if (newUvs) newGeo.setAttribute('uv', new THREE.BufferAttribute(newUvs, 2));
  if (newCols && colAttr) newGeo.setAttribute('color', new THREE.BufferAttribute(newCols, colAttr.itemSize));

  if (recomputeNormals || !newNormals) {
    newGeo.computeVertexNormals();
  }

  newGeo.computeBoundingBox();
  newGeo.computeBoundingSphere();

  return newGeo;
}

/**
 * Resize and compress an image texture using HTML Canvas 2D
 */
export function compressTexture(originalTexture, maxDim = 1024, mimeType = 'image/webp', quality = 0.8) {
  if (!originalTexture || !originalTexture.image) return originalTexture;

  const img = originalTexture.image;
  const origW = img.naturalWidth || img.videoWidth || img.width || 1024;
  const origH = img.naturalHeight || img.videoHeight || img.height || 1024;

  let targetW = origW;
  let targetH = origH;
  if (maxDim < Infinity && Math.max(origW, origH) > maxDim) {
    if (origW >= origH) {
      targetW = maxDim;
      targetH = Math.max(1, Math.round((origH / origW) * maxDim));
    } else {
      targetH = maxDim;
      targetW = Math.max(1, Math.round((origW / origH) * maxDim));
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const newTexture = new THREE.CanvasTexture(canvas);
  newTexture.name = originalTexture.name || 'compressed_tex';
  newTexture.wrapS = originalTexture.wrapS;
  newTexture.wrapT = originalTexture.wrapT;
  if (originalTexture.offset) newTexture.offset.copy(originalTexture.offset);
  if (originalTexture.repeat) newTexture.repeat.copy(originalTexture.repeat);
  if (originalTexture.center) newTexture.center.copy(originalTexture.center);
  newTexture.rotation = originalTexture.rotation || 0;
  newTexture.channel = originalTexture.channel !== undefined ? originalTexture.channel : 0;

  // CRITICAL: Preserve flipY! In GLTF models flipY is false. CanvasTexture defaults to true!
  newTexture.flipY = originalTexture.flipY !== undefined ? originalTexture.flipY : false;

  // CRITICAL: Preserve colorSpace! Normal maps, roughness/metalness maps are linear (NoColorSpace).
  // Defaulting to SRGBColorSpace corrupts normal map tangent vectors and PBR data!
  newTexture.colorSpace = originalTexture.colorSpace !== undefined ? originalTexture.colorSpace : THREE.NoColorSpace;

  newTexture.generateMipmaps = true;
  newTexture.minFilter = THREE.LinearMipmapLinearFilter;
  newTexture.magFilter = THREE.LinearFilter;
  newTexture.needsUpdate = true;

  return newTexture;
}

/**
 * Deep-clone a 3D model and apply Meshopt decimation + texture downscaling/compression
 */
export async function optimizeModel(sourceModel, options = {}) {
  await ensureSimplifier();

  const {
    simplifyRatio = 0.45,
    targetError = 0.02,
    recomputeNormals = false,
    maxTextureRes = 1024,
    textureFormat = 'webp',
    textureQuality = 0.82,
    stripNormalMap = false,
    optimizeMaterials = true
  } = options;

  const mimeType = textureFormat === 'jpeg' ? 'image/jpeg' : (textureFormat === 'png' ? 'image/png' : 'image/webp');
  const clone = sourceModel.clone(true);
  const textureCache = new Map(); // old uuid -> newTexture

  clone.traverse((node) => {
    if (node.isMesh && node.geometry) {
      // 1. Simplify geometry
      node.geometry = simplifyBufferGeometry(node.geometry, simplifyRatio, targetError, recomputeNormals);

      // 2. Optimize material & textures
      if (node.material) {
        const isArr = Array.isArray(node.material);
        const mats = isArr ? node.material.slice() : [node.material.clone()];

        for (let i = 0; i < mats.length; i++) {
          const mat = mats[i].clone();

          if (stripNormalMap) {
            mat.normalMap = null;
          }

          const mapTypes = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
          for (const mType of mapTypes) {
            const oldTex = mat[mType];
            if (oldTex && oldTex.isTexture && oldTex.image) {
              if (textureCache.has(oldTex.uuid)) {
                mat[mType] = textureCache.get(oldTex.uuid);
              } else {
                const newTex = compressTexture(oldTex, maxTextureRes, mimeType, textureQuality);
                textureCache.set(oldTex.uuid, newTex);
                mat[mType] = newTex;
              }
            }
          }

          if (optimizeMaterials) {
            // Only adjust roughness/metalness if texture maps are not driving them
            if (!mat.roughnessMap && mat.roughness !== undefined) {
              mat.roughness = Math.max(mat.roughness, 0.2);
            }
            if (!mat.metalnessMap && mat.metalness !== undefined) {
              mat.metalness = Math.min(mat.metalness, 0.9);
            }
          }

          mat.needsUpdate = true;
          mats[i] = mat;
        }

        node.material = isArr ? mats : mats[0];
      }
    }
  });

  return clone;
}
