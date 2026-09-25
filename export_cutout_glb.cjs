/**
 * export_cutout_glb.cjs
 * 
 * Generates and exports a single upright grass card billboard whose mesh is cut out
 * using a BVH (Bounding Volume Hierarchy) along the exact silhouette edges of the
 * runtime-generated grass blades, projecting the runtime texture directly onto it.
 *
 * Usage:
 *   node export_cutout_glb.cjs [output_path]
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------------------------------------------------------- 1. Pure Node PNG Encoder */
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(width, height, rgbaBuffer) {
  const rowStride = width * 4;
  const filtered = Buffer.alloc(height * (rowStride + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (rowStride + 1)] = 0; // Filter: None
    rgbaBuffer.copy(filtered, y * (rowStride + 1) + 1, y * rowStride, (y + 1) * rowStride);
  }

  const compressed = zlib.deflateSync(filtered);

  function createChunk(type, data) {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, 4, 'ascii');
    data.copy(chunk, 8);
    const crc = crc32(chunk.subarray(4, 8 + data.length));
    chunk.writeUInt32BE(crc, 8 + data.length);
    return chunk;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: 6 (RGBA)
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

/* ---------------------------------------------------------- 2. Runtime Grass Texture Generator */
// 8-blade procedural parametric curve generator matching in-game canvas texture
function getBladeParams() {
  const blades = [];
  for (let b = 0; b < 8; b++) {
    const rootX = 16 + b * 14 + (Math.sin(b * 3.7) - 0.5) * 6;
    const tipX  = rootX + (b - 3.5) * 8 + (Math.cos(b * 2.1) - 0.5) * 12;
    const tipY  = 8 + (Math.sin(b * 1.9) * 0.5 + 0.5) * 18;
    const baseW = 4.2 + (Math.cos(b * 4.3) * 0.5 + 0.5) * 2.0;
    blades.push({ b, rootX, tipX, tipY, baseW });
  }
  return blades;
}

function generateGrassTextureRGBA(W = 128, H = 128) {
  const rgba = Buffer.alloc(W * H * 4, 0);
  const blades = getBladeParams();

  for (const blade of blades) {
    const { rootX, tipX, tipY, baseW } = blade;
    for (let y = Math.floor(tipY); y < H; y++) {
      const t = (y - tipY) / (H - tipY); // 0 at tip, 1 at root
      const cpX = rootX + (tipX - rootX) * 0.4;
      const invT = 1.0 - t;
      const cx = invT * invT * tipX + 2.0 * invT * t * cpX + t * t * rootX;
      const w = 0.8 + baseW * Math.pow(t, 0.7);

      // Color gradient from base (#b4cd91) to tip (#f8fce1)
      const r = Math.round(180 * t + 248 * (1 - t));
      const g = Math.round(205 * t + 252 * (1 - t));
      const bCol = Math.round(145 * t + 225 * (1 - t));

      const minX = Math.max(0, Math.floor(cx - w - 1));
      const maxX = Math.min(W - 1, Math.ceil(cx + w + 1));

      for (let x = minX; x <= maxX; x++) {
        const dist = Math.abs(x - cx);
        if (dist <= w + 0.6) {
          const alphaFade = Math.min(1.0, Math.max(0.0, (w + 0.6 - dist) * 1.5));
          const idx = (y * W + x) * 4;
          const aOld = rgba[idx + 3] / 255;
          const aNew = Math.max(aOld, alphaFade * 0.98);

          rgba[idx]     = r;
          rgba[idx + 1] = g;
          rgba[idx + 2] = bCol;
          rgba[idx + 3] = Math.round(aNew * 255);
        }
      }
    }
  }

  return rgba;
}

/* ---------------------------------------------------------- 3. BVH (Bounding Volume Hierarchy) & Edge Cutout */

class BVHNode {
  constructor(x0, y0, x1, y1, depth = 0, name = '') {
    this.x0 = x0; // Min X in pixel space
    this.y0 = y0; // Min Y (top of card in texture space)
    this.x1 = x1; // Max X in pixel space
    this.y1 = y1; // Max Y (bottom of card, y=128)
    this.depth = depth;
    this.name = name;
    this.children = [];
    this.bladeData = null;
  }
}

/**
 * Builds a 2D Bounding Volume Hierarchy over the 1 upright card.
 * - Root Node: Bounds the entire upright card [0, 0, W, H]
 * - Level 1: Bounds each active grass blade cluster (AABBs)
 * - Level 2: Hierarchical segment volumes along each blade's vertical span
 */
function buildCardBVH(blades, W = 128, H = 128) {
  const root = new BVHNode(0, 0, W, H, 0, 'Card_Root_AABB');

  for (const blade of blades) {
    const { rootX, tipX, tipY, baseW } = blade;
    // Compute tight AABB for this blade
    const minX = Math.max(0, Math.min(rootX - baseW - 2, tipX - 2));
    const maxX = Math.min(W, Math.max(rootX + baseW + 2, tipX + 2));
    const minY = Math.max(0, Math.floor(tipY));
    const maxY = H;

    const bladeNode = new BVHNode(minX, minY, maxX, maxY, 1, `Blade_${blade.b}_AABB`);
    bladeNode.bladeData = blade;

    // Subdivide into 3 hierarchical segments for optimal low-poly curved silhouette (40 tris total)
    const numSegments = 3;
    for (let s = 0; s < numSegments; s++) {
      const segY0 = minY + ((maxY - minY) * s) / numSegments;
      const segY1 = minY + ((maxY - minY) * (s + 1)) / numSegments;
      const segNode = new BVHNode(minX, segY0, maxX, segY1, 2, `Blade_${blade.b}_Seg_${s}`);
      bladeNode.children.push(segNode);
    }

    root.children.push(bladeNode);
  }

  return root;
}

/**
 * Traverses the BVH and projects the runtime texture onto the 1 upright card,
 * cutting the mesh strictly along the silhouette edges (left edge, right edge, tip) of each blade.
 */
function generateBvhCutoutMesh(bvhRoot, rgba, W = 128, H = 128, meshW = 0.75, meshH = 0.95) {
  const positions = [];
  const uvs = [];
  const normals = [];
  const indices = [];
  let vIdx = 0;

  function getAlpha(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || ix >= W || iy < 0 || iy >= H) return 0;
    return rgba[(iy * W + ix) * 4 + 3];
  }

  // Traverse the BVH blades on the 1 upright card
  for (const bladeNode of bvhRoot.children) {
    const blade = bladeNode.bladeData;
    const { rootX, tipX, tipY, baseW } = blade;

    const clampedTipX = Math.max(0, Math.min(W - 1, tipX));
    const clampedTipY = Math.max(0, Math.min(H - 1, tipY));

    // Tip Vertex (Planar upright at Z = 0)
    const tipVIdx = vIdx++;
    const tipU = clampedTipX / W;
    const tipV = 1.0 - clampedTipY / H;
    const tipPx = (tipU - 0.5) * meshW;
    const tipPy = tipV * meshH;

    positions.push(tipPx, tipPy, 0.0);
    uvs.push(tipU, tipV);
    normals.push(0, 0, 1);

    const segments = bladeNode.children;
    let prevLeftIdx = -1;
    let prevRightIdx = -1;

    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      const y = seg.y1; // Bottom of this segment (towards root)
      const t = (y - tipY) / (H - tipY);
      const cpX = rootX + (tipX - rootX) * 0.4;
      const invT = 1.0 - t;
      const cx = invT * invT * tipX + 2.0 * invT * t * cpX + t * t * rootX;
      const w = 0.8 + baseW * Math.pow(Math.max(0, t), 0.7);

      // Detect silhouette edges from the runtime texture
      let xLeft = Math.max(0, Math.min(W - 1, cx - w));
      let xRight = Math.max(0, Math.min(W - 1, cx + w));

      // Trace exact edge boundary where alpha crosses threshold
      while (xLeft > 0 && getAlpha(xLeft, y) > 30) xLeft -= 0.5;
      while (xRight < W - 1 && getAlpha(xRight, y) > 30) xRight += 0.5;

      // Project UVs directly from texture space onto 1 upright card
      const uL = xLeft / W;
      const vL = 1.0 - y / H;
      const uR = xRight / W;
      const vR = 1.0 - y / H;

      // 3D coordinates: planar upright at Z = 0
      const pxL = (uL - 0.5) * meshW;
      const pyL = vL * meshH;
      const pxR = (uR - 0.5) * meshW;
      const pyR = vR * meshH;

      const curLeftIdx = vIdx++;
      positions.push(pxL, pyL, 0.0);
      uvs.push(uL, vL);
      normals.push(0, 0, 1);

      const curRightIdx = vIdx++;
      positions.push(pxR, pyR, 0.0);
      uvs.push(uR, vR);
      normals.push(0, 0, 1);

      if (s === 0) {
        // Connect tip triangle along the silhouette edge
        indices.push(tipVIdx, curLeftIdx, curRightIdx);
      } else {
        // Connect quad along the blade ribbon edges
        indices.push(
          prevLeftIdx, curLeftIdx, curRightIdx,
          prevLeftIdx, curRightIdx, prevRightIdx
        );
      }

      prevLeftIdx = curLeftIdx;
      prevRightIdx = curRightIdx;
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices)
  };
}

/* ---------------------------------------------------------- 4. Pure GLB Binary Builder */
function exportGlbFile(meshData, pngBuffer, outputPath) {
  const { positions, normals, uvs, indices } = meshData;

  const posBuf = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength);
  const normBuf = Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength);
  const uvBuf = Buffer.from(uvs.buffer, uvs.byteOffset, uvs.byteLength);
  const idxBuf = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);

  // Compute bounding box
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      if (positions[i + c] < min[c]) min[c] = positions[i + c];
      if (positions[i + c] > max[c]) max[c] = positions[i + c];
    }
  }

  function pad4(buf) {
    const pad = (4 - (buf.length % 4)) % 4;
    return pad === 0 ? buf : Buffer.concat([buf, Buffer.alloc(pad)]);
  }

  const pIdx = pad4(idxBuf);
  const pPos = pad4(posBuf);
  const pNorm = pad4(normBuf);
  const pUv = pad4(uvBuf);
  const pPng = pad4(pngBuffer);

  const binBuffer = Buffer.concat([pIdx, pPos, pNorm, pUv, pPng]);

  const byteOffsets = [
    0,
    pIdx.length,
    pIdx.length + pPos.length,
    pIdx.length + pPos.length + pNorm.length,
    pIdx.length + pPos.length + pNorm.length + pUv.length
  ];

  const gltf = {
    asset: { version: '2.0', generator: 'Antigravity 1-Card BVH Edge Cutout GLB Exporter' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0, name: 'CutoutGrassCard' }],
    materials: [{
      name: 'M_CutoutGrass',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        baseColorFactor: [1.0, 1.0, 1.0, 1.0],
        metallicFactor: 0.0,
        roughnessFactor: 0.65
      },
      alphaMode: 'MASK',
      alphaCutoff: 0.15,
      doubleSided: true
    }],
    textures: [{ sampler: 0, source: 0 }],
    images: [{ bufferView: 4, mimeType: 'image/png', name: 'T_GrassAlphaCard' }],
    samplers: [{
      magFilter: 9729, // LINEAR
      minFilter: 9987, // LINEAR_MIPMAP_LINEAR
      wrapS: 10497,    // REPEAT
      wrapT: 10497
    }],
    meshes: [{
      name: 'CutoutGrassMesh',
      primitives: [{
        attributes: {
          POSITION: 1,
          NORMAL: 2,
          TEXCOORD_0: 3
        },
        indices: 0,
        material: 0,
        mode: 4 // TRIANGLES
      }]
    }],
    buffers: [{
      byteLength: binBuffer.length
    }],
    bufferViews: [
      { buffer: 0, byteOffset: byteOffsets[0], byteLength: idxBuf.length, target: 34963 }, // ELEMENT_ARRAY_BUFFER
      { buffer: 0, byteOffset: byteOffsets[1], byteLength: posBuf.length, target: 34962 }, // ARRAY_BUFFER
      { buffer: 0, byteOffset: byteOffsets[2], byteLength: normBuf.length, target: 34962 },
      { buffer: 0, byteOffset: byteOffsets[3], byteLength: uvBuf.length, target: 34962 },
      { buffer: 0, byteOffset: byteOffsets[4], byteLength: pngBuffer.length }               // IMAGE_BUFFER
    ],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: 5123, count: indices.length, type: 'SCALAR' }, // UNSIGNED_SHORT
      { bufferView: 1, byteOffset: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max }, // FLOAT
      { bufferView: 2, byteOffset: 0, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
      { bufferView: 3, byteOffset: 0, componentType: 5126, count: uvs.length / 2, type: 'VEC2' }
    ]
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const paddedJson = jsonPad === 0 ? jsonBuf : Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  const totalLength = 12 + 8 + paddedJson.length + 8 + binBuffer.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);          // version
  header.writeUInt32LE(totalLength, 8);

  const chunk0Header = Buffer.alloc(8);
  chunk0Header.writeUInt32LE(paddedJson.length, 0);
  chunk0Header.writeUInt32LE(0x4E4F534A, 4); // 'JSON'

  const chunk1Header = Buffer.alloc(8);
  chunk1Header.writeUInt32LE(binBuffer.length, 0);
  chunk1Header.writeUInt32LE(0x004E4942, 4); // 'BIN\0'

  const glbBuffer = Buffer.concat([header, chunk0Header, paddedJson, chunk1Header, binBuffer]);

  fs.writeFileSync(outputPath, glbBuffer);
  return {
    totalBytes: glbBuffer.length,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    outputPath: path.resolve(outputPath)
  };
}

/* ---------------------------------------------------------- 5. Main Execution */
function main() {
  const targetFile = process.argv[2] || path.join(__dirname, 'cutout_grass.glb');
  console.log('Generating 1-Card BVH Edge Cutout Grass Billboard...');

  const W = 128, H = 128;
  const blades = getBladeParams();
  const rgba = generateGrassTextureRGBA(W, H);
  const png = encodePng(W, H, rgba);
  console.log(`✓ Synthesized Grass Alpha Card texture (${W}x${H}, PNG: ${png.length} bytes)`);

  const bvhRoot = buildCardBVH(blades, W, H);
  console.log(`✓ Constructed 1-Card BVH Tree (${bvhRoot.children.length} blade AABBs, ${bvhRoot.children.reduce((acc, c) => acc + c.children.length, 0)} hierarchical segments)`);

  const mesh = generateBvhCutoutMesh(bvhRoot, rgba, W, H, 0.75, 0.95);
  console.log(`✓ Generated 1-Card Edge-Cutout Mesh:`);
  console.log(`   - Planar:        Z = 0.0 (strictly 1 upright card)`);
  console.log(`   - Vertices:      ${mesh.positions.length / 3} (placed directly along blade silhouette edges)`);
  console.log(`   - Triangles:     ${mesh.indices.length / 3}`);
  console.log(`   - UV Projection: direct 1:1 texture mapping`);

  const info = exportGlbFile(mesh, png, targetFile);
  console.log(`\n======================================================`);
  console.log(`🎉 SUCCESS! Exported GLB to:`);
  console.log(`   ${info.outputPath}`);
  console.log(`------------------------------------------------------`);
  console.log(`   Card Orientation: 1 Card, Upright (XY plane, Z = 0)`);
  console.log(`   Triangles:        ${info.triangleCount}`);
  console.log(`   Vertices:         ${info.vertexCount}`);
  console.log(`   File Size:        ${(info.totalBytes / 1024).toFixed(1)} KB`);
  console.log(`   Format:           glTF 2.0 Binary (.glb) with embedded PNG & MASK material`);
  console.log(`======================================================\n`);
}

main();
