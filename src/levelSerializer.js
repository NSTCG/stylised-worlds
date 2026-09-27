/**
 * src/levelSerializer.js
 * Complete level serialization, persistence to localStorage, and JSON export/import.
 */
import * as THREE from 'three';
import { getGroundMesh, getTerrainDataTexture, proceduralHeight, terrainAlbedo, TERRAIN_BOUNDS } from './terrain.js';
import { getTreeData, applyTreeData, treeColors, setTreeColors } from './trees.js';
import { getPlacedAssetsData, restorePlacedAssets } from './assetsManager.js';
import { grassConfig, grassUniforms } from './grass.js';

export const LEVEL_SAVE_KEY = 'nstcg_forest_island_level_data';

/**
 * Show a sleek floating notification toast in the UI.
 */
export function showNotification(message, type = 'success', duration = 3200) {
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
    toast.style.font = 'bold 12.5px ui-monospace, Consolas, monospace';
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

/**
 * Extract compact delta of terrain vertex modifications
 */
function serializeTerrainDeltas() {
  const ground = getGroundMesh();
  if (!ground || !ground.geometry) return [];

  const pos = ground.geometry.attributes.position;
  const col = ground.geometry.attributes.color;
  const vCount = pos.count;
  const deltas = [];

  for (let i = 0; i < vCount; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const curY = pos.getY(i);
    const curR = col.getX(i);
    const curG = col.getY(i);
    const curB = col.getZ(i);

    const baseH = proceduralHeight(x, z);
    const baseC = terrainAlbedo(x, z, baseH);

    // If height or color differs meaningfully from default PCG baseline, save as delta
    const hDiff = Math.abs(curY - baseH);
    const cDiff = Math.abs(curR - baseC.r) + Math.abs(curG - baseC.g) + Math.abs(curB - baseC.b);

    if (hDiff > 0.05 || cDiff > 0.05) {
      deltas.push([
        i,
        Math.round(curY * 100) / 100,
        Math.round(curR * 100) / 100,
        Math.round(curG * 100) / 100,
        Math.round(curB * 100) / 100
      ]);
    }
  }

  return deltas;
}

/**
 * Apply saved terrain deltas to ground mesh and sync the 512x512 DataTexture
 */
function deserializeTerrainDeltas(deltas) {
  const ground = getGroundMesh();
  const tex = getTerrainDataTexture();
  if (!ground || !tex || !Array.isArray(deltas)) return;

  const pos = ground.geometry.attributes.position;
  const col = ground.geometry.attributes.color;
  const data = tex.image.data;
  const texSize = tex.image.width; // 512

  const minX = TERRAIN_BOUNDS.x, minZ = TERRAIN_BOUNDS.y;
  const sizeX = TERRAIN_BOUNDS.z, sizeZ = TERRAIN_BOUNDS.w;

  for (const item of deltas) {
    const [idx, y, r, g, b] = item;
    if (idx >= 0 && idx < pos.count) {
      pos.setY(idx, y);
      col.setXYZ(idx, r, g, b);

      // Update corresponding DataTexture cell
      const x = pos.getX(idx);
      const z = pos.getZ(idx);
      const u = THREE.MathUtils.clamp((x - minX) / sizeX, 0, 1);
      const v = THREE.MathUtils.clamp((z - minZ) / sizeZ, 0, 1);
      const tx = Math.floor(u * (texSize - 1));
      const ty = Math.floor(v * (texSize - 1));
      const dIdx = (ty * texSize + tx) * 4;

      data[dIdx + 0] = y;
      data[dIdx + 1] = r;
      data[dIdx + 2] = g;
      data[dIdx + 3] = b;
    }
  }

  pos.needsUpdate = true;
  col.needsUpdate = true;
  ground.geometry.computeVertexNormals();
  tex.needsUpdate = true;
}

/**
 * Package complete world state into a JSON-serializable object
 */
export function createLevelPackage(envConfig = {}) {
  return {
    version: '1.2.0',
    title: 'Stylized Forest Island Level',
    timestamp: new Date().toISOString(),
    terrainDeltas: serializeTerrainDeltas(),
    trees: {
      colors: { ...treeColors },
      instances: getTreeData()
    },
    assets: getPlacedAssetsData(),
    environment: {
      timeOfDay: envConfig.timeOfDay ?? 0.45,
      fogDensity: envConfig.fogBaseDensity ?? 0.012,
      grassRadius: grassConfig.userRadius ?? 35,
      grassDensity: grassConfig.density ?? 16,
      grassHeightScale: grassConfig.heightScale ?? 1.0,
      grassColor: grassConfig.currentColor ?? '#4ca03e'
    }
  };
}

/**
 * Save level to browser localStorage
 */
export function saveLevelToStorage(envConfig = {}) {
  try {
    const pkg = createLevelPackage(envConfig);
    const json = JSON.stringify(pkg);
    localStorage.setItem(LEVEL_SAVE_KEY, json);
    showNotification('💾 Level saved to browser storage!', 'success');
    return true;
  } catch (err) {
    console.error('Save level error:', err);
    showNotification('⚠️ Save failed (storage quota)', 'error');
    return false;
  }
}

/**
 * Load level from browser localStorage
 */
export function loadLevelFromStorage(envConfig = {}) {
  try {
    const raw = localStorage.getItem(LEVEL_SAVE_KEY);
    if (!raw) {
      showNotification('ℹ️ No saved level found', 'warn');
      return false;
    }
    const pkg = JSON.parse(raw);
    applyLevelPackage(pkg, envConfig);
    showNotification('📂 Level restored successfully!', 'success');
    return true;
  } catch (err) {
    console.error('Load level error:', err);
    showNotification('⚠️ Failed to load level', 'error');
    return false;
  }
}

/**
 * Apply level data package to the active scene
 */
export function applyLevelPackage(pkg, envConfig = {}) {
  if (!pkg) return;

  // 1. Terrain
  if (pkg.terrainDeltas) {
    deserializeTerrainDeltas(pkg.terrainDeltas);
  }

  // 2. Tree Colors & Instances
  if (pkg.trees) {
    if (pkg.trees.colors) {
      setTreeColors(pkg.trees.colors);
    }
    if (pkg.trees.instances) {
      applyTreeData(pkg.trees.instances);
    }
  }

  // 3. Placed Assets
  if (pkg.assets) {
    restorePlacedAssets(pkg.assets);
  }

  // 4. Environment
  if (pkg.environment) {
    const env = pkg.environment;
    if (env.timeOfDay !== undefined && envConfig) envConfig.timeOfDay = env.timeOfDay;
    if (env.fogDensity !== undefined && envConfig) envConfig.fogBaseDensity = env.fogDensity;
    if (env.grassRadius !== undefined && window.setGrassRadius) window.setGrassRadius(env.grassRadius);
    if (env.grassDensity !== undefined && window.setGrassDensity) window.setGrassDensity(env.grassDensity);
    if (env.grassHeightScale !== undefined && window.setGrassHeightScale) window.setGrassHeightScale(env.grassHeightScale);
  }
}

/**
 * Export level as downloadable JSON file
 */
export function exportLevelFile(envConfig = {}, filename = 'island_forest_level.json') {
  const pkg = createLevelPackage(envConfig);
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showNotification('⬇️ Level exported to ' + filename, 'success');
}

/**
 * Import level from a user-uploaded JSON file
 */
export function importLevelFile(file, envConfig = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const pkg = JSON.parse(e.target.result);
        applyLevelPackage(pkg, envConfig);
        showNotification('⬆️ Level imported successfully!', 'success');
        resolve(pkg);
      } catch (err) {
        showNotification('⚠️ Invalid level file format', 'error');
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
