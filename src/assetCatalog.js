/**
 * src/assetCatalog.js
 * Catalog registry for models in AssetsTest/Assets plus runtime imported models.
 */

export const FALLBACK_CATALOG = [
  { id: 'barrel', name: 'Barrel', filename: 'barrel.glb', url: './AssetsTest/Assets/barrel.glb', sizeBytes: 97776828, sizeMB: '93.2', category: 'Prop' },
  { id: 'box', name: 'Box', filename: 'box.glb', url: './AssetsTest/Assets/box.glb', sizeBytes: 93482444, sizeMB: '89.2', category: 'Prop' },
  { id: 'bridge', name: 'Bridge', filename: 'bridge.glb', url: './AssetsTest/Assets/bridge.glb', sizeBytes: 81924484, sizeMB: '78.1', category: 'Structure' },
  { id: 'fishing_stool', name: 'Fishing Stool', filename: 'fishing stool.glb', url: './AssetsTest/Assets/fishing%20stool.glb', sizeBytes: 99045192, sizeMB: '94.5', category: 'Prop' },
  { id: 'lamp_post', name: 'Lamp Post', filename: 'lamp post.glb', url: './AssetsTest/Assets/lamp%20post.glb', sizeBytes: 86728468, sizeMB: '82.7', category: 'Structure' },
  { id: 'older_sprite', name: 'Older Sprite', filename: 'Older sprite.glb', url: './AssetsTest/Assets/Older%20sprite.glb', sizeBytes: 79166648, sizeMB: '75.5', category: 'Character' },
  { id: 'portal', name: 'Portal', filename: 'Portal.glb', url: './AssetsTest/Assets/Portal.glb', sizeBytes: 80602324, sizeMB: '76.9', category: 'Structure' },
  { id: 'red_flower_plant', name: 'Red Flower Plant', filename: 'red flower plant.glb', url: './AssetsTest/Assets/red%20flower%20plant.glb', sizeBytes: 75688112, sizeMB: '72.2', category: 'Nature' },
  { id: 'rock_1', name: 'Rock 1', filename: 'rock 1.glb', url: './AssetsTest/Assets/rock%201.glb', sizeBytes: 73245520, sizeMB: '69.9', category: 'Nature' },
  { id: 'rock_2', name: 'Rock 2', filename: 'rock 2.glb', url: './AssetsTest/Assets/rock%202.glb', sizeBytes: 70537448, sizeMB: '67.3', category: 'Nature' },
  { id: 'torii_gate', name: 'Torii Gate', filename: 'Torii gate.glb', url: './AssetsTest/Assets/Torii%20gate.glb', sizeBytes: 71622212, sizeMB: '68.3', category: 'Structure' },
  { id: 'tree', name: 'Tree', filename: 'tree.glb', url: './AssetsTest/Assets/tree.glb', sizeBytes: 71971672, sizeMB: '68.6', category: 'Nature' },
  { id: 'watering_can', name: 'Watering Can', filename: 'watering can.glb', url: './AssetsTest/Assets/watering%20can.glb', sizeBytes: 81097816, sizeMB: '77.3', category: 'Prop' },
  { id: 'well', name: 'Well', filename: 'well.glb', url: './AssetsTest/Assets/well.glb', sizeBytes: 89985848, sizeMB: '85.8', category: 'Structure' }
];

let _catalog = [...FALLBACK_CATALOG];

export async function fetchAssetCatalog() {
  try {
    // Try /api/assets first (if launch_quest server is active)
    const res = await fetch('/api/assets');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        _catalog = data;
        return _catalog;
      }
    }
  } catch (e) {
    // Fall back to static manifest or fallback list
  }

  try {
    const res2 = await fetch('./AssetsTest/assets_manifest.json');
    if (res2.ok) {
      const data2 = await res2.json();
      if (Array.isArray(data2) && data2.length > 0) {
        _catalog = data2;
        return _catalog;
      }
    }
  } catch (e) {
    // Ignore, keep fallback
  }

  return _catalog;
}

export function getAssetCatalog() {
  return _catalog;
}

export function getAssetById(id) {
  return _catalog.find(a => a.id === id);
}

export function registerCustomAsset(file) {
  const name = file.name.replace(/\.(glb|gltf)$/i, '');
  const id = 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  const blobUrl = URL.createObjectURL(file);
  const item = {
    id,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    filename: file.name,
    url: blobUrl,
    sizeBytes: file.size,
    sizeMB: (file.size / 1024 / 1024).toFixed(1),
    category: 'Custom',
    fileObject: file
  };
  _catalog.unshift(item);
  return item;
}
