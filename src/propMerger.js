/**
 * src/propMerger.js
 * Merges all Whispering Valley prop nodes into a single mesh (one draw per material),
 * while retaining per-prop identity (id, assetKey, transform) so individual props can
 * still be selected, moved, rotated, scaled, deleted and duplicated. When a prop's
 * transform changes, only its vertex ranges are re-baked in place inside the shared
 * geometry — no scene-graph objects are created or destroyed per prop.
 */
import * as THREE from 'three';
import { simplifyBufferGeometry } from './modelOptimizer.js';

let _propsGroup = null;  // scene group that owns the merged mesh
let _mergedMesh = null;  // single Mesh containing every prop
let _entries = [];       // per-prop records: { id, assetKey, def, matrix, node, parts[], bboxMin, bboxMax }
let _nodes = [];         // detached prop node objects (retained so GLB upgrades can swap their children)
let _faceMap = null;     // Uint32Array: faceIndex -> entry index
let _stats = { count: 0, verts: 0, tris: 0, materials: 0 };

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();

/** Non-indexed geometry copy with guaranteed position/normal/uv attributes. */
function _normalizeGeo(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  // Mesh optimization if vertex count is high (> 3500 vertices)
  if (g.attributes.position && g.attributes.position.count > 3500) {
    try {
      const simplified = simplifyBufferGeometry(g, 0.55, 0.02, false);
      if (simplified && simplified.attributes.position) {
        g.dispose();
        g = simplified.index ? simplified.toNonIndexed() : simplified;
      }
    } catch (_) {
      // Fallback to original geometry if Meshopt is not yet initialized
    }
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  return g;
}

/** Extract untransformed parts (base geometry + local matrix + material) from a prop node. */
function _extractParts(node) {
  const parts = [];
  node.updateMatrixWorld(true);
  const nodeInv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  node.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    // Skip shell outline meshes and hidden helpers
    if (obj.userData?.isOutlineMesh || obj.name?.endsWith('_outline') || obj.name?.includes('outline') || !obj.visible) return;
    // partMatrix = relative transform from prop root to this mesh (handles arbitrary nesting)
    const relMatrix = new THREE.Matrix4().multiplyMatrices(nodeInv, obj.matrixWorld);
    parts.push({
      baseGeo: _normalizeGeo(obj.geometry),
      partMatrix: relMatrix,
      material: obj.material,
      matIndex: -1,
      vertStart: 0,
      vertCount: 0,
      triCount: 0
    });
  });
  return parts;
}

/** Write one part's base geometry (transformed by entry.matrix * partMatrix) into the shared arrays. */
function _writePart(part, pos, nor, uv, faceMap, cursor, entryIndex) {
  const bp = part.baseGeo.attributes.position.array;
  const bn = part.baseGeo.attributes.normal.array;
  const buv = part.baseGeo.attributes.uv.array;
  _m.copy(_entries[entryIndex].matrix).multiply(part.partMatrix);
  _n.getNormalMatrix(_m);
  const count = part.vertCount;
  for (let i = 0; i < count; i++) {
    const s = i * 3;
    const d = (cursor + i) * 3;
    _v.fromArray(bp, s).applyMatrix4(_m);
    pos[d] = _v.x; pos[d + 1] = _v.y; pos[d + 2] = _v.z;
    _v.fromArray(bn, s).applyMatrix3(_n);
    nor[d] = _v.x; nor[d + 1] = _v.y; nor[d + 2] = _v.z;
  }
  const uvOff = cursor * 2;
  for (let i = 0; i < count * 2; i++) uv[uvOff + i] = buv[i];
  const triStart = Math.floor(cursor / 3);
  for (let t = 0; t < part.triCount; t++) faceMap[triStart + t] = entryIndex;
}

/** Full rebuild: re-extract parts from every retained node, sort by material, fill shared arrays. */
function _rebuild() {
  const all = [];
  for (let ei = 0; ei < _entries.length; ei++) {
    const e = _entries[ei];
    // release previous part geometry clones before re-extracting
    for (const p of e.parts) p.baseGeo.dispose();
    e.parts = _extractParts(e.node);

    e.bboxMin.set(Infinity, Infinity, Infinity);
    e.bboxMax.set(-Infinity, -Infinity, -Infinity);
    for (const p of e.parts) {
      p.baseGeo.computeBoundingBox();
      const bb = p.baseGeo.boundingBox;
      if (!bb) continue;
      const box = new THREE.Box3();
      for (let i = 0; i < 8; i++) {
        _v.set(
          (i & 1) ? bb.max.x : bb.min.x,
          (i & 2) ? bb.max.y : bb.min.y,
          (i & 4) ? bb.max.z : bb.min.z
        );
        _v.applyMatrix4(p.partMatrix);
        box.expandByPoint(_v);
      }
      e.bboxMin.min(box.min);
      e.bboxMax.max(box.max);
    }
    for (const p of e.parts) all.push({ part: p, entryIndex: ei });
  }

  // Dedupe materials in first-seen order
  const matIndex = new Map();
  const materials = [];
  for (const { part } of all) {
    if (!matIndex.has(part.material)) {
      matIndex.set(part.material, materials.length);
      materials.push(part.material);
    }
    part.matIndex = matIndex.get(part.material);
  }

  // Sort parts by material so each material is one contiguous range (few draw calls)
  all.sort((a, b) => a.part.matIndex - b.part.matIndex || a.entryIndex - b.entryIndex);

  let totalVerts = 0;
  for (const { part } of all) totalVerts += part.baseGeo.attributes.position.count;
  const totalTris = Math.floor(totalVerts / 3);

  const pos = new Float32Array(totalVerts * 3);
  const nor = new Float32Array(totalVerts * 3);
  const uv = new Float32Array(totalVerts * 2);
  _faceMap = totalTris > 0 ? new Uint32Array(totalTris) : null;

  let cursor = 0;
  const groups = [];
  for (const { part, entryIndex } of all) {
    const count = part.baseGeo.attributes.position.count;
    part.vertStart = cursor;
    part.vertCount = count;
    part.triCount = Math.floor(count / 3);
    if (count > 0) {
      _writePart(part, pos, nor, uv, _faceMap, cursor, entryIndex);
      groups.push({ start: cursor, count, materialIndex: part.matIndex });
    }
    cursor += count;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);
  geo.computeBoundingSphere();

  if (_mergedMesh && _propsGroup) {
    _propsGroup.remove(_mergedMesh);
    _mergedMesh.geometry.dispose();
  }
  _mergedMesh = new THREE.Mesh(geo, materials);
  _mergedMesh.name = 'merged_props';
  _mergedMesh.castShadow = true;
  _mergedMesh.receiveShadow = true;
  _mergedMesh.userData.isMergedProps = true;
  if (_propsGroup) _propsGroup.add(_mergedMesh);

  _stats = { count: _entries.length, verts: totalVerts, tris: totalTris, materials: materials.length };
}

/** Tear down merged mesh + retained state (keeps node child geometry alive for asset cache). */
function _disposeAll() {
  if (_mergedMesh && _propsGroup) _propsGroup.remove(_mergedMesh);
  if (_mergedMesh) {
    _mergedMesh.geometry.dispose();
    _mergedMesh = null;
  }
  for (const e of _entries) {
    for (const p of e.parts) p.baseGeo.dispose();
  }
  _entries = [];
  _nodes = [];
  _faceMap = null;
  _propsGroup = null;
  _stats = { count: 0, verts: 0, tris: 0, materials: 0 };
}

/**
 * Merge every `prop_*` node in propsGroup into one mesh.
 * Prop nodes are detached from the scene (retained internally) and replaced by the merged mesh.
 * @returns {{count:number, verts:number, tris:number, materials:number}}
 */
export function mergeProps(propsGroup) {
  _disposeAll();
  _propsGroup = propsGroup;
  if (!propsGroup) return _stats;

  propsGroup.updateMatrixWorld(true);
  _nodes = propsGroup.children.filter((c) => c.name.startsWith('prop_'));
  _entries = _nodes.map((node) => ({
    id: node.name,
    assetKey: node.userData?.assetKey || '',
    def: node.userData?.def || null,
    matrix: node.matrix.clone(),
    node,
    parts: [],
    bboxMin: new THREE.Vector3(),
    bboxMax: new THREE.Vector3()
  }));

  _rebuild();
  return { ..._stats };
}

/** Re-extract geometry from retained nodes (call after GLB upgrade swapped node children). */
export function rebuildMerged() {
  if (!_propsGroup || _entries.length === 0) return;
  _rebuild();
}

/** The single merged mesh (null when nothing is merged). */
export function getMergedMesh() {
  return _mergedMesh;
}

/** Scene group owning the merged mesh (proxy gizmos attach here so local == propsGroup space). */
export function getPropsGroup() {
  return _propsGroup;
}

/** Retained prop node objects, for GLB upgrade passes. */
export function getPropNodes() {
  return _nodes;
}

export function getPropEntry(id) {
  return _entries.find((e) => e.id === id) || null;
}

export function getEntries() {
  return _entries;
}

/** Map a raycast face index on the merged mesh to a prop id. */
export function propIdFromFace(faceIndex) {
  if (!_faceMap || faceIndex == null || faceIndex < 0 || faceIndex >= _faceMap.length) return null;
  const ei = _faceMap[faceIndex];
  return ei < _entries.length ? _entries[ei].id : null;
}

/** Live re-bake of one prop's vertex ranges after its transform changed. */
export function updatePropTransform(id, matrix) {
  const ei = _entries.findIndex((e) => e.id === id);
  if (ei < 0 || !_mergedMesh) return;
  const e = _entries[ei];
  e.matrix.copy(matrix);

  const pos = _mergedMesh.geometry.attributes.position.array;
  const nor = _mergedMesh.geometry.attributes.normal.array;
  for (const part of e.parts) {
    if (part.vertCount === 0) continue;
    _m.copy(e.matrix).multiply(part.partMatrix);
    _n.getNormalMatrix(_m);
    const bp = part.baseGeo.attributes.position.array;
    const bn = part.baseGeo.attributes.normal.array;
    for (let i = 0; i < part.vertCount; i++) {
      const s = i * 3;
      const d = (part.vertStart + i) * 3;
      _v.fromArray(bp, s).applyMatrix4(_m);
      pos[d] = _v.x; pos[d + 1] = _v.y; pos[d + 2] = _v.z;
      _v.fromArray(bn, s).applyMatrix3(_n);
      nor[d] = _v.x; nor[d + 1] = _v.y; nor[d + 2] = _v.z;
    }
  }
  _mergedMesh.geometry.attributes.position.needsUpdate = true;
  _mergedMesh.geometry.attributes.normal.needsUpdate = true;
  _mergedMesh.geometry.computeBoundingSphere();
}

/** Remove a prop by id and rebuild the merged geometry without it. */
export function removeProp(id) {
  const ei = _entries.findIndex((e) => e.id === id);
  if (ei < 0) return false;
  _entries.splice(ei, 1);
  _nodes.splice(ei, 1);
  _rebuild();
  return true;
}

/** Duplicate a prop by id with a translation offset. Returns the new prop id. */
export function duplicateProp(id, offset) {
  const ei = _entries.findIndex((e) => e.id === id);
  if (ei < 0) return null;
  const src = _entries[ei];

  const nid = `prop_${src.assetKey || 'dup'}_${Math.random().toString(36).slice(2, 8)}`;
  const m = src.matrix.clone();
  m.setPosition(m.elements[12] + offset.x, m.elements[13] + offset.y, m.elements[14] + offset.z);

  const node = src.node.clone(true);
  node.name = nid;
  node.userData = { assetKey: src.assetKey, def: src.def };
  m.decompose(node.position, node.quaternion, node.scale);

  _entries.push({
    id: nid,
    assetKey: src.assetKey,
    def: src.def,
    matrix: m.clone(),
    node,
    parts: [],
    bboxMin: new THREE.Vector3(),
    bboxMax: new THREE.Vector3()
  });
  _nodes.push(node);
  _rebuild();
  return nid;
}

/** Full teardown (valley unload). */
export function dispose() {
  _disposeAll();
}
