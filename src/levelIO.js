/**
 * src/levelIO.js — Level save/load (browser).
 *
 * Save format (JSON, v1):
 *   { version: 1, savedAt, terrain: base64(Float32Array 512²×4),
 *     trees: [{type,i,m,c,tc}], glbs: [{name,m}], envConfig, treeColors }
 *
 * GLB access is injected (glbAssets.js imports three/addons → browser-only).
 * The codec lives in levelCodec.js (pure, Node-testable).
 */
import { getTerrainDataTexture, getGroundMesh } from './terrain.js';
import { getTreeData, applyTreeData, setTreeColors, treeColors } from './trees.js';
import { envConfig } from './environment.js';
import { encodeTerrain, decodeTerrain } from './levelCodec.js';

/* ---------------------------------------------------------- save */

export function buildLevelJson(glbApi) {
  const tex = getTerrainDataTexture();
  if (!tex) throw new Error('terrain data texture unavailable');
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    terrain: encodeTerrain(tex.image.data),
    trees: getTreeData(),
    glbs: glbApi ? (glbApi.getGlbData() || []) : [],
    envConfig: { ...envConfig },
    treeColors: { ...treeColors }
  };
}

export function showNotification(message, type = 'success', duration = 3000) {
  let toast = document.getElementById('levelToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'levelToast';
    toast.style.position = 'fixed';
    toast.style.bottom = '55px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.zIndex = '9999';
    toast.style.padding = '8px 18px';
    toast.style.borderRadius = '24px';
    toast.style.font = 'bold 12px ui-monospace, Consolas, monospace';
    toast.style.color = '#fff';
    toast.style.boxShadow = '0 6px 24px rgba(0,0,0,0.6)';
    toast.style.backdropFilter = 'blur(10px)';
    toast.style.border = '1px solid rgba(255,255,255,0.3)';
    toast.style.pointerEvents = 'none';
    toast.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.background = type === 'success' 
    ? 'rgba(40, 160, 75, 0.92)' 
    : (type === 'warn' ? 'rgba(215, 140, 30, 0.92)' : 'rgba(210, 50, 50, 0.92)');
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(12px)';
  }, duration);
}

export function saveLevelToStorage(glbApi) {
  try {
    const pkg = buildLevelJson(glbApi);
    localStorage.setItem('nstcg_forest_island_level_data', JSON.stringify(pkg));
    showNotification('💾 Level saved to browser storage!', 'success');
    return true;
  } catch (err) {
    console.error('Storage save failed:', err);
    showNotification('⚠️ Storage save failed', 'error');
    return false;
  }
}

export function loadLevelFromStorage(glbApi) {
  try {
    const raw = localStorage.getItem('nstcg_forest_island_level_data');
    if (!raw) {
      showNotification('ℹ️ No saved level found in storage', 'warn');
      return false;
    }
    loadLevel(raw, glbApi);
    showNotification('📂 Level restored from storage!', 'success');
    return true;
  } catch (err) {
    console.error('Storage load failed:', err);
    showNotification('⚠️ Failed to load level', 'error');
    return false;
  }
}

export function saveLevel(glbApi) {
  const json = JSON.stringify(buildLevelJson(glbApi));
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  a.href = url;
  a.download = `forest_level_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showNotification('💾 Level exported to ' + a.download, 'success');
  return json.length;
}

/* ---------------------------------------------------------- load */

function syncGroundMeshFromTexture(data, texSize) {
  const ground = getGroundMesh();
  if (!ground) return;
  const geo = ground.geometry;
  const posAttr = geo.attributes.position;
  const colAttr = geo.attributes.color;
  const minX = -220, minZ = -220, sizeX = 440, sizeZ = 440;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), z = posAttr.getZ(i);
    // Bilinear sample of the saved heightmap.
    const fx = ((x - minX) / sizeX) * (texSize - 1);
    const fz = ((z - minZ) / sizeZ) * (texSize - 1);
    const ix = Math.min(texSize - 2, Math.max(0, Math.floor(fx)));
    const iz = Math.min(texSize - 2, Math.max(0, Math.floor(fz)));
    const tx = fx - ix, tz = fz - iz;
    const i00 = (iz * texSize + ix) * 4, i10 = i00 + 4, i01 = i00 + texSize * 4, i11 = i01 + 4;
    const h00 = data[i00], h10 = data[i10], h01 = data[i01], h11 = data[i11];
    const y = (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
    const r = (data[i00 + 1] * (1 - tx) + data[i10 + 1] * tx) * (1 - tz) + (data[i01 + 1] * (1 - tx) + data[i11 + 1] * tx) * tz;
    const g = (data[i00 + 2] * (1 - tx) + data[i10 + 2] * tx) * (1 - tz) + (data[i01 + 2] * (1 - tx) + data[i11 + 2] * tx) * tz;
    const b = (data[i00 + 3] * (1 - tx) + data[i10 + 3] * tx) * (1 - tz) + (data[i01 + 3] * (1 - tx) + data[i11 + 3] * tx) * tz;
    posAttr.setY(i, y);
    colAttr.setXYZ(i, r, g, b);
  }
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
  geo.computeVertexNormals();
}

export function loadLevel(json, glbApi) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  if (!j || j.version !== 1) throw new Error('unsupported level format');

  // 1. Terrain: write saved heightmap+colors into the live data texture.
  const tex = getTerrainDataTexture();
  const data = decodeTerrain(j.terrain);
  if (tex && data.length === tex.image.data.length) {
    tex.image.data.set(data);
    tex.needsUpdate = true;
    syncGroundMeshFromTexture(data, tex.image.width);
  }

  // 2. Trees (exact slot restore).
  applyTreeData(j.trees || []);

  // 3. GLB placements (skips assets not loaded this session).
  if (glbApi) glbApi.applyGlbData(j.glbs || []);

  // 4. Environment + tree palette.
  if (j.envConfig) Object.assign(envConfig, j.envConfig);
  if (j.treeColors) setTreeColors(j.treeColors);

  return { trees: (j.trees || []).length, glbs: (j.glbs || []).length };
}

export function loadLevelFromBlob(blob, glbApi) {
  return blob.text().then((text) => loadLevel(text, glbApi));
}
