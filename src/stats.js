/**
 * src/stats.js
 * Real-time Triangle Counter & Detailed Object Breakdown
 */

export function setupStats(scene, renderer) {
  function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toLocaleString();
  }

  function formatFull(num) {
    return num.toLocaleString();
  }

  function getMeshTriangles(obj) {
    if (!obj.geometry) return 0;
    const count = obj.geometry.index
      ? obj.geometry.index.count / 3
      : obj.geometry.attributes.position.count / 3;
    if (obj.isInstancedMesh) {
      return count * (obj.count !== undefined ? obj.count : obj.instanceMatrix.count);
    }
    return count;
  }

  function computeBreakdown() {
    const stats = {
      grass: 0,
      trees: 0,
      terrain: 0,
      water: 0,
      rocks: 0,
      mountain: 0,
      other: 0,
      total: 0
    };

    scene.traverse((obj) => {
      if (!obj.isMesh && !obj.isInstancedMesh) return;
      const tris = Math.round(getMeshTriangles(obj));
      if (tris <= 0) return;

      const name = obj.name || '';
      if (name === 'grass_instanced' || name.startsWith('grass')) {
        stats.grass += tris;
      } else if (name.startsWith('trees_') || name.startsWith('tree')) {
        stats.trees += tris;
      } else if (name === 'terrain_ground' || name.startsWith('terrain')) {
        stats.terrain += tris;
      } else if (name === 'water_plane' || name.startsWith('water')) {
        stats.water += tris;
      } else if (name === 'mountain_mesh' || name.startsWith('mountain')) {
        stats.mountain += tris;
      } else if (name === 'rocks_instanced' || name.startsWith('rock')) {
        stats.rocks += tris;
      } else {
        stats.other += tris;
      }
    });

    stats.total = stats.grass + stats.trees + stats.terrain + stats.water + stats.rocks + stats.mountain + stats.other;
    return stats;
  }

  function updateUI() {
    const stats = computeBreakdown();
    window.totalSceneTriangles = stats.total;

    const totalEl = document.getElementById('statTotalTri');
    if (totalEl) {
      totalEl.textContent = formatFull(stats.total);
      totalEl.title = `${stats.total.toLocaleString()} total triangles in scene`;
    }

    const chipsEl = document.getElementById('triBreakdownChips');
    if (chipsEl) {
      chipsEl.innerHTML = `
        <span class="triChip" title="Instanced Grass Billboard Cards: ${stats.grass.toLocaleString()} tris" style="background:rgba(76,160,62,0.35); border:1px solid rgba(76,160,62,0.6); padding:1px 6px; border-radius:8px;">
          🌾 Grass: <b style="color:#aff29a;">${formatNumber(stats.grass)}</b>
        </span>
        <span class="triChip" title="Instanced Conifer & Broadleaf Trees (Trunks + Foliage): ${stats.trees.toLocaleString()} tris" style="background:rgba(37,98,32,0.35); border:1px solid rgba(94,168,60,0.5); padding:1px 6px; border-radius:8px;">
          🌲 Trees: <b style="color:#d5f8c6;">${formatNumber(stats.trees)}</b>
        </span>
        <span class="triChip" title="Deformed Terrain Heightfield Plane: ${stats.terrain.toLocaleString()} tris" style="background:rgba(90,80,50,0.35); border:1px solid rgba(160,140,90,0.5); padding:1px 6px; border-radius:8px;">
          🏞 Terrain: <b style="color:#f2e6af;">${formatNumber(stats.terrain)}</b>
        </span>
        <span class="triChip" title="Dynamic Wave Water Surface: ${stats.water.toLocaleString()} tris" style="background:rgba(20,80,120,0.35); border:1px solid rgba(53,179,170,0.5); padding:1px 6px; border-radius:8px;">
          🌊 Water: <b style="color:#7ee6df;">${formatNumber(stats.water)}</b>
        </span>
        <span class="triChip" title="Instanced Path Rocks: ${stats.rocks.toLocaleString()} tris" style="background:rgba(80,80,80,0.35); border:1px solid rgba(140,140,140,0.5); padding:1px 6px; border-radius:8px;">
          🪨 Rocks: <b style="color:#e0e0e0;">${formatNumber(stats.rocks)}</b>
        </span>
        <span class="triChip" title="Craggy Background Mountain: ${stats.mountain.toLocaleString()} tris" style="background:rgba(90,100,105,0.35); border:1px solid rgba(160,175,185,0.5); padding:1px 6px; border-radius:8px;">
          🏔 Mountain: <b style="color:#e8edf0;">${formatNumber(stats.mountain)}</b>
        </span>
      `;
    }
  }

  window.updateStatsUI = updateUI;

  // Initial calculation after scene load
  setTimeout(updateUI, 100);
  setTimeout(updateUI, 800);

  return {
    updateUI,
    computeBreakdown
  };
}
