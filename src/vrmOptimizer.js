/**
 * src/vrmOptimizer.js
 * Advanced VRM/GLB in-memory compression & scene optimization pipeline:
 * 1. Embedded profile thumbnail pruning (saves 1.5MB - 6MB of dead 2D portrait payload)
 * 2. Canvas-based texture downscaling (to 1024/512) and WebP/JPEG re-compression (saves 70-85% texture VRAM & size)
 * 3. Safe GLB repacking with 4-byte chunk alignment
 * 4. Post-load scene optimization: Meshopt WASM decimation on static accessories & props
 * 5. Micro-mesh shadow pass pruning & VR texture filtering
 */
import * as THREE from 'three';
import { ensureSimplifier, simplifyBufferGeometry } from './modelOptimizer.js';

// 1x1 transparent RGBA PNG (68 bytes) to replace heavy embedded avatar portrait photos
const DUMMY_1X1_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x01, 0xf4, 0x71, 0x64, 0xa6, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

/**
 * Compress a binary VRM/GLB ArrayBuffer in-memory before passing to GLTFLoader.
 * @param {ArrayBuffer} arrayBuffer - Raw GLB/VRM buffer
 * @param {Object} options
 * @param {boolean} options.pruneThumbnail - Prune unused avatar profile portrait (saves 1-6MB)
 * @param {number} options.maxTextureRes - Max dimension for textures (512, 1024, 2048)
 * @param {string} options.textureFormat - 'image/webp' | 'image/jpeg' | 'image/png'
 * @param {number} options.textureQuality - Compression quality 0.1 to 1.0 (default 0.82)
 * @param {Function} options.onProgress - Optional callback(percent, statusText)
 * @returns {Promise<{ buffer: ArrayBuffer, stats: Object }>}
 */
export async function compressVRMBuffer(arrayBuffer, options = {}) {
  const {
    pruneThumbnail = true,
    maxTextureRes = 1024,
    textureFormat = 'image/webp',
    textureQuality = 0.82,
    onProgress = null
  } = options;

  const origSize = arrayBuffer.byteLength;
  const dv = new DataView(arrayBuffer);

  // Validate GLB Magic ('glTF')
  const magic = dv.getUint32(0, true);
  if (magic !== 0x46546c67) {
    throw new Error('Provided buffer is not a valid GLB/VRM file');
  }

  // Parse Chunk 0 (JSON)
  const chunk0Len = dv.getUint32(12, true);
  const jsonBytes = new Uint8Array(arrayBuffer, 20, chunk0Len);
  const jsonStr = new TextDecoder('utf-8').decode(jsonBytes);
  const gltf = JSON.parse(jsonStr);

  // Parse Chunk 1 (BIN)
  const binOffset = 20 + chunk0Len;
  const binLen = dv.getUint32(binOffset, true);
  const binData = new Uint8Array(arrayBuffer, binOffset + 8, binLen);

  // 1. Identify Profile Picture / Thumbnail Image Index
  let thumbnailImageIndex = -1;
  if (gltf.extensions?.VRM?.meta?.texture !== undefined) {
    thumbnailImageIndex = gltf.extensions.VRM.meta.texture;
  } else if (gltf.extensions?.VRMC_vrm?.meta?.thumbnailImage !== undefined) {
    thumbnailImageIndex = gltf.extensions.VRMC_vrm.meta.thumbnailImage;
  }

  // Extract all bufferView slices independently
  const bvDataList = gltf.bufferViews.map((bv) => {
    const start = bv.byteOffset || 0;
    return binData.subarray(start, start + bv.byteLength);
  });

  let prunedThumbBytes = 0;
  let compressedImagesCount = 0;
  let originalImageBytes = 0;
  let compressedImageBytes = 0;

  // 2. Identify Normal Maps to preserve fidelity
  const normalMapImageIndices = new Set();
  if (gltf.materials) {
    for (const mat of gltf.materials) {
      if (mat.normalTexture?.index !== undefined && gltf.textures) {
        const tex = gltf.textures[mat.normalTexture.index];
        if (tex?.source !== undefined) normalMapImageIndices.add(tex.source);
      }
    }
  }
  if (gltf.extensions?.VRM?.materialProperties) {
    for (const mp of gltf.extensions.VRM.materialProperties) {
      const bumpIdx = mp.textureProperties?._BumpMap;
      if (bumpIdx !== undefined && gltf.textures?.[bumpIdx]) {
        const tex = gltf.textures[bumpIdx];
        if (tex?.source !== undefined) normalMapImageIndices.add(tex.source);
      }
    }
  }

  // Check WebP canvas support
  let supportsWebp = false;
  try {
    const testCanvas = document.createElement('canvas');
    testCanvas.width = 1; testCanvas.height = 1;
    supportsWebp = testCanvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  } catch (e) {
    supportsWebp = false;
  }
  const effectiveFormat = (textureFormat === 'image/webp' && !supportsWebp) ? 'image/jpeg' : textureFormat;

  // 3. Process Each Embedded Image
  if (Array.isArray(gltf.images)) {
    const totalImgs = gltf.images.length;
    for (let imgIdx = 0; imgIdx < totalImgs; imgIdx++) {
      const imgDef = gltf.images[imgIdx];
      const bvIdx = imgDef.bufferView;
      if (bvIdx === undefined || !bvDataList[bvIdx]) continue;

      const rawBytes = bvDataList[bvIdx];
      originalImageBytes += rawBytes.byteLength;

      // Check if Thumbnail
      if (pruneThumbnail && imgIdx === thumbnailImageIndex) {
        prunedThumbBytes = rawBytes.byteLength - DUMMY_1X1_PNG.byteLength;
        bvDataList[bvIdx] = DUMMY_1X1_PNG;
        imgDef.mimeType = 'image/png';
        compressedImageBytes += DUMMY_1X1_PNG.byteLength;
        continue;
      }

      // Check if we need texture downscaling or format conversion
      try {
        const mime = imgDef.mimeType || 'image/png';
        const blob = new Blob([rawBytes], { type: mime });
        let bmp = null;

        if (typeof createImageBitmap === 'function') {
          bmp = await createImageBitmap(blob);
        } else {
          bmp = await new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(blob);
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
            img.src = url;
          });
        }

        const origW = bmp.width;
        const origH = bmp.height;
        let targetW = origW;
        let targetH = origH;

        if (maxTextureRes < Infinity && Math.max(origW, origH) > maxTextureRes) {
          if (origW >= origH) {
            targetW = maxTextureRes;
            targetH = Math.max(1, Math.round((origH / origW) * maxTextureRes));
          } else {
            targetH = maxTextureRes;
            targetW = Math.max(1, Math.round((origW / origH) * maxTextureRes));
          }
        }

        const shouldResize = (targetW !== origW || targetH !== origH);
        const isNormalMap = normalMapImageIndices.has(imgIdx);
        const targetMime = isNormalMap ? 'image/png' : effectiveFormat;
        const quality = isNormalMap ? 0.95 : textureQuality;

        // Skip compression if already within bounds and format matches
        if (!shouldResize && imgDef.mimeType === targetMime && rawBytes.byteLength < 250000) {
          compressedImageBytes += rawBytes.byteLength;
          if (bmp.close) bmp.close();
          continue;
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d', { alpha: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, 0, 0, targetW, targetH);
        if (bmp.close) bmp.close();

        const outBlob = await new Promise((resolve) => {
          canvas.toBlob(resolve, targetMime, quality);
        });

        if (outBlob) {
          const compArray = await outBlob.arrayBuffer();
          const compBytes = new Uint8Array(compArray);

          // Only replace if smaller or if dimensions were reduced
          if (compBytes.byteLength < rawBytes.byteLength || shouldResize) {
            bvDataList[bvIdx] = compBytes;
            imgDef.mimeType = targetMime;
            compressedImagesCount++;
            compressedImageBytes += compBytes.byteLength;
          } else {
            compressedImageBytes += rawBytes.byteLength;
          }
        } else {
          compressedImageBytes += rawBytes.byteLength;
        }
      } catch (err) {
        console.warn(`[VRMOptimizer] Image ${imgIdx} optimization skipped:`, err);
        compressedImageBytes += rawBytes.byteLength;
      }

      if (onProgress) {
        onProgress(Math.round(((imgIdx + 1) / totalImgs) * 85), `Optimizing textures (${imgIdx + 1}/${totalImgs})...`);
      }
    }
  }

  // 4. Update Extensions Used for WebP
  let usesWebp = false;
  if (Array.isArray(gltf.images)) {
    usesWebp = gltf.images.some(img => img.mimeType === 'image/webp');
  }
  if (usesWebp) {
    gltf.extensionsUsed = gltf.extensionsUsed || [];
    if (!gltf.extensionsUsed.includes('EXT_texture_webp')) {
      gltf.extensionsUsed.push('EXT_texture_webp');
    }
  }

  // 5. Repack BIN Chunk with 4-byte Alignment
  let currentOffset = 0;
  const newOffsets = new Array(bvDataList.length);

  for (let i = 0; i < bvDataList.length; i++) {
    // glTF bufferViews must be 4-byte aligned
    currentOffset = (currentOffset + 3) & ~3;
    newOffsets[i] = currentOffset;
    gltf.bufferViews[i].byteOffset = currentOffset;
    gltf.bufferViews[i].byteLength = bvDataList[i].byteLength;
    currentOffset += bvDataList[i].byteLength;
  }

  const newBinLen = (currentOffset + 3) & ~3;
  const newBinData = new Uint8Array(newBinLen);

  for (let i = 0; i < bvDataList.length; i++) {
    newBinData.set(bvDataList[i], newOffsets[i]);
  }

  // Update gltf buffer 0 length
  if (gltf.buffers && gltf.buffers[0]) {
    gltf.buffers[0].byteLength = newBinLen;
  }

  // 6. Repack JSON Chunk with 4-byte Space Padding
  let newJsonStr = JSON.stringify(gltf);
  let jsonUtf8 = new TextEncoder().encode(newJsonStr);
  const padLength = (4 - (jsonUtf8.length % 4)) % 4;
  if (padLength > 0) {
    newJsonStr += ' '.repeat(padLength);
    jsonUtf8 = new TextEncoder().encode(newJsonStr);
  }

  // 7. Assemble Complete Binary GLB
  const totalLength = 12 + 8 + jsonUtf8.length + 8 + newBinData.length;
  const outBuffer = new ArrayBuffer(totalLength);
  const outDv = new DataView(outBuffer);
  const outBytes = new Uint8Array(outBuffer);

  // GLB Header
  outDv.setUint32(0, 0x46546c67, true); // magic 'glTF'
  outDv.setUint32(4, 2, true);          // version 2
  outDv.setUint32(8, totalLength, true); // total length

  // Chunk 0: JSON
  outDv.setUint32(12, jsonUtf8.length, true);
  outDv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  outBytes.set(jsonUtf8, 20);

  // Chunk 1: BIN
  const chunk1HeaderOffset = 20 + jsonUtf8.length;
  outDv.setUint32(chunk1HeaderOffset, newBinData.length, true);
  outDv.setUint32(chunk1HeaderOffset + 4, 0x004e4942, true); // 'BIN\0'
  outBytes.set(newBinData, chunk1HeaderOffset + 8);

  const newSize = outBuffer.byteLength;
  const savingsBytes = Math.max(0, origSize - newSize);
  const savingsPercent = ((savingsBytes / origSize) * 100).toFixed(1);

  if (onProgress) {
    onProgress(100, `Done! Saved ${savingsPercent}%`);
  }

  return {
    buffer: outBuffer,
    stats: {
      origSize,
      newSize,
      origSizeMB: (origSize / 1048576).toFixed(2),
      newSizeMB: (newSize / 1048576).toFixed(2),
      savingsMB: (savingsBytes / 1048576).toFixed(2),
      savingsPercent,
      prunedThumbMB: (prunedThumbBytes / 1048576).toFixed(2),
      compressedImagesCount,
      totalImagesCount: gltf.images ? gltf.images.length : 0
    }
  };
}

/**
 * Optimize an instantiated VRM scene hierarchy:
 * - Decimate non-skinned accessory/prop meshes using Meshopt WASM
 * - Clean micro-mesh shadow casting (saves render passes in VR)
 * - Tune mipmaps and anisotropic filtering for Quest & desktop clarity
 */
export async function optimizeVRMScene(vrm, options = {}) {
  if (!vrm || !vrm.scene) return;
  const {
    meshoptAccessory = true,
    accessoryRatio = 0.5,
    tuneShadows = true,
    tuneTextures = true
  } = options;

  if (meshoptAccessory) {
    await ensureSimplifier();
  }

  let accessoryMeshesOptimized = 0;
  let shadowPrunedCount = 0;

  vrm.scene.traverse((node) => {
    if (!node.isMesh) return;

    // 1. Meshopt decimation for non-skinned accessories (glasses, hats, ribbons, props)
    // NOTE: We strictly preserve SkinnedMesh with bone weights & morph targets to avoid rig desync.
    if (meshoptAccessory && !node.isSkinnedMesh && node.geometry && !node.morphTargetDictionary) {
      try {
        const origVerts = node.geometry.attributes.position ? node.geometry.attributes.position.count : 0;
        if (origVerts > 50) {
          node.geometry = simplifyBufferGeometry(node.geometry, accessoryRatio, 0.02, false);
          accessoryMeshesOptimized++;
        }
      } catch (err) {
        console.warn('[VRMOptimizer] Accessory meshopt skipped for node:', node.name, err);
      }
    }

    // 2. Micro-mesh shadow pass pruning: Tiny interior oral meshes, tear lines, eye reflections
    // do not need to cast directional shadows, saving multiple shadow map passes per frame!
    if (tuneShadows) {
      const lowerName = (node.name || '').toLowerCase();
      if (
        lowerName.includes('tooth') ||
        lowerName.includes('teeth') ||
        lowerName.includes('tongue') ||
        lowerName.includes('mouth_interior') ||
        lowerName.includes('eye_highlight') ||
        lowerName.includes('eyeref') ||
        lowerName.includes('tear')
      ) {
        node.castShadow = false;
        shadowPrunedCount++;
      } else {
        node.castShadow = true;
        node.receiveShadow = false; // Self-shadowing on anime cel-shading is handled by MToon
      }
    }

    // 3. Texture filtering for VR clarity
    if (tuneTextures) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        if (!m) continue;
        const maps = [m.map, m.shadeTexture, m.normalMap, m.emissiveMap, m.rimTexture, m.sphereAdd];
        for (const tex of maps) {
          if (tex && tex.isTexture) {
            tex.generateMipmaps = true;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.anisotropy = 4;
            tex.needsUpdate = true;
          }
        }
      }
    }

    // Ensure camera culling doesn't clip body in VR first person
    node.frustumCulled = false;
  });

  return {
    accessoryMeshesOptimized,
    shadowPrunedCount
  };
}
