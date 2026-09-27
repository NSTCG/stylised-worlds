/**
 * src/treeRules.js
 * Comprehensive tree-placement validation rules for the stylized forest island world.
 *
 * Rules:
 *   0. clearing        – inside flat spawn clearing (r < clearRadius)
 *   1. obstacle        – inside or too close to a placed GLB asset / structure
 *   2. water           – below beach level or in tidal surf (y < minWaterY)
 *   3. peak            – above tree line / bare mountain peaks (y > maxPeakY)
 *   4. rock            – painted grey cliff rock color
 *   5. proceduralPath  – on or immediately adjacent to the procedural winding path
 *   6. paintedRoad     – on or adjacent to editor-painted earthen road
 *   7. slope           – terrain steeper than slopeMax (~30°)
 *   8. noGrass         – low greenness / bare ground where grass doesn't grow
 *   9. spacing         – too close to another placed tree (minimum spacing distance)
 */
import { cPath, pathCenterZ, pathFactor, PATH_RADIUS, getLiveTerrainBiome, groundHeight } from './terrain.js';

export const TREE_RULES = {
  clearRadius: 17,        // rule 0: flat spawn clearing radius (m)
  minWaterY: 0.55,        // rule 2: sea level is y=0, beach/surf up to 0.55m
  maxPeakY: 13.5,         // rule 3: rocky peaks / bare cliffs above this height
  rockGrayTol: 0.06,      // rule 4: |r-g| and |g-b| tolerance for grey stone
  rockGreenMax: 0.20,     // rule 4: rock must also fail the greenness test
  pathFactorMin: 0.04,    // rule 5: procedural path factor threshold
  roadClearanceMargin: 1.8, // rule 5: extra clearance distance beyond path radius (m)
  paintedRoadDist: 0.15,  // rule 6: color distance to cPath in RGB space (rock is 0.153)
  slopeMax: 0.65,         // rule 7: max average rise per meter (~33° slope)
  greennessMin: 0.20,     // rule 8: trees only grow where grass thrives
  minTreeDistance: 2.8    // rule 9: minimum distance between tree trunks (m)
};

/** Linear RGB distance between two {r,g,b} colors (or THREE.Color). */
export function colorDist(a, b) {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// ---------------------------------------------------------------- Placed Asset Obstacles
const _obstacles = new Map(); // id -> { x, z, radius }

export function registerObstacle(id, x, z, radius = 3.0) {
  _obstacles.set(id, { x, z, radius });
}

export function unregisterObstacle(id) {
  _obstacles.delete(id);
}

export function clearObstacles() {
  _obstacles.clear();
}

export function isInsideObstacle(x, z, margin = 1.0) {
  for (const obs of _obstacles.values()) {
    const dist = Math.hypot(x - obs.x, z - obs.z);
    if (dist < (obs.radius + margin)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- Spatial Tree Spacing
// Fast 2D spatial grid to ensure natural tree spacing without overlapping trunks
const GRID_CELL = 4.0;
const _treeGrid = new Map(); // key `${cellX},${cellZ}` -> array of [x, z]

function gridKey(x, z) {
  return `${Math.floor(x / GRID_CELL)},${Math.floor(z / GRID_CELL)}`;
}

export function clearTreeSpatialGrid() {
  _treeGrid.clear();
}

export function registerTreePosition(x, z) {
  const key = gridKey(x, z);
  let list = _treeGrid.get(key);
  if (!list) {
    list = [];
    _treeGrid.set(key, list);
  }
  list.push([x, z]);
}

export function isTooCloseToOtherTrees(x, z, minDist = TREE_RULES.minTreeDistance) {
  const cx = Math.floor(x / GRID_CELL);
  const cz = Math.floor(z / GRID_CELL);
  const minDistSq = minDist * minDist;

  for (let ox = -1; ox <= 1; ox++) {
    for (let oz = -1; oz <= 1; oz++) {
      const list = _treeGrid.get(`${cx + ox},${cz + oz}`);
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const [tx, tz] = list[i];
          const d2 = (x - tx) * (x - tx) + (z - tz) * (z - tz);
          if (d2 < minDistSq) return true;
        }
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------- Evaluation Logic
/**
 * Evaluate all environmental and terrain rules for a location with sampled biome.
 * @returns {string|null} rejection reason, or null when valid.
 */
export function rejectReasonFor(x, z, biome) {
  // Rule 0: Flat spawn clearing
  if (Math.hypot(x, z) < TREE_RULES.clearRadius) return 'clearing';

  // Rule 1: Placed structures / GLB assets
  if (isInsideObstacle(x, z)) return 'obstacle';

  // Rule 2: Water / Surf zone
  if (biome.y < TREE_RULES.minWaterY) return 'water';

  // Rule 3: Rocky mountain peaks
  if (biome.y > TREE_RULES.maxPeakY) return 'peak';

  // Rule 4: Painted grey cliff rock
  const isRockColor =
    Math.abs(biome.r - biome.g) < TREE_RULES.rockGrayTol &&
    Math.abs(biome.g - biome.b) < TREE_RULES.rockGrayTol &&
    biome.greenness < TREE_RULES.rockGreenMax;
  if (isRockColor) return 'rock';

  // Rule 5: Procedural winding road & clearance buffer
  const pz = pathCenterZ(x);
  const distToPathCenter = Math.abs(z - pz);
  if (distToPathCenter < (PATH_RADIUS + TREE_RULES.roadClearanceMargin)) {
    return 'proceduralPath';
  }
  if (pathFactor(x, z) > TREE_RULES.pathFactorMin) return 'proceduralPath';

  // Rule 6: Painted earthen road (check center and small footprint)
  if (colorDist(biome, cPath) < TREE_RULES.paintedRoadDist) return 'paintedRoad';

  // Footprint check: trees should not overhang directly onto adjacent painted roads
  const checkFootprint = 1.4;
  const b1 = getLiveTerrainBiome(x + checkFootprint, z);
  if (colorDist(b1, cPath) < TREE_RULES.paintedRoadDist) return 'paintedRoad';
  const b2 = getLiveTerrainBiome(x - checkFootprint, z);
  if (colorDist(b2, cPath) < TREE_RULES.paintedRoadDist) return 'paintedRoad';
  const b3 = getLiveTerrainBiome(x, z + checkFootprint);
  if (colorDist(b3, cPath) < TREE_RULES.paintedRoadDist) return 'paintedRoad';
  const b4 = getLiveTerrainBiome(x, z - checkFootprint);
  if (colorDist(b4, cPath) < TREE_RULES.paintedRoadDist) return 'paintedRoad';

  // Rule 7: Slope gradient (sample live height at ±1.2m)
  const sampleDist = 1.2;
  const dx = (groundHeight(x + sampleDist, z) - groundHeight(x - sampleDist, z)) / (sampleDist * 2);
  const dz = (groundHeight(x, z + sampleDist) - groundHeight(x, z - sampleDist)) / (sampleDist * 2);
  const slope = Math.hypot(dx, dz);
  if (slope > TREE_RULES.slopeMax) return 'slope';

  // Rule 8: Vegetated green ground only
  if (biome.greenness < TREE_RULES.greennessMin) return 'noGrass';

  return null;
}

/**
 * Full check for procedural tree placement, including live biome and spacing.
 * @param {number} x
 * @param {number} z
 * @param {boolean} [checkSpacing=true]
 * @returns {[number, number, number, object]|null}
 */
export function checkTreeLocation(x, z, checkSpacing = true) {
  const biome = getLiveTerrainBiome(x, z);
  const reason = rejectReasonFor(x, z, biome);
  if (reason !== null) return null;

  if (checkSpacing && isTooCloseToOtherTrees(x, z)) {
    return null;
  }

  return [x, biome.y, z, biome];
}

/**
 * Validation for user-planted trees (tree brush / stamp):
 * Allows planting anywhere except underwater, on roads, cliffs, or inside obstacles.
 */
export function checkCustomTreeLocation(x, z) {
  const biome = getLiveTerrainBiome(x, z);
  if (isInsideObstacle(x, z)) return null;
  if (biome.y < TREE_RULES.minWaterY) return null;
  if (colorDist(biome, cPath) < TREE_RULES.paintedRoadDist) return null;
  const pz = pathCenterZ(x);
  if (Math.abs(z - pz) < (PATH_RADIUS + 0.5)) return null;
  return [x, biome.y, z, biome];
}
