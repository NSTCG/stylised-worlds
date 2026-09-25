import * as THREE from 'three';
import { 
  getTerrainDataTexture, 
  getGroundMesh, 
  TERRAIN_BOUNDS, 
  groundHeight, 
  proceduralHeight,
  terrainAlbedo, 
  fbm,
  vnoise,
  cGrassLush, 
  cGrassWarm, 
  cSand, 
  cPath, 
  cSeaShallow, 
  cRock 
} from './terrain.js';
import { rebuildTreesPCG } from './trees.js';

export const editorState = {
  active: true,
  brushType: 'grass', // 'grass' | 'sand' | 'road' | 'water' | 'raise' | 'lower' | 'smooth' | 'rock'
  brushRadius: 10.0,
  brushStrength: 0.45,
  isPainting: false,
  hitPoint: new THREE.Vector3(),
  hasHit: false
};

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

export function setupTerrainEditor(scene, camera, domElement) {
  const tex = getTerrainDataTexture();
  const groundMesh = getGroundMesh();
  if (!groundMesh || !tex) return null;

  const data = tex.image.data;
  const texSize = tex.image.width; // 512
  const geo = groundMesh.geometry;
  const posAttr = geo.attributes.position;
  const colAttr = geo.attributes.color;

  // ---------------------------------------------------------- 3D Brush Ring Indicator
  const ringGeo = new THREE.RingGeometry(0.95, 1.0, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7ef088,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
    depthTest: false
  });
  const brushRing = new THREE.Mesh(ringGeo, ringMat);
  brushRing.renderOrder = 999;
  brushRing.visible = false;
  scene.add(brushRing);

  // Brush color mapping for ring visual
  const brushColorMap = {
    grass: 0x7ef088,
    sand: 0xf2d680,
    road: 0xb5885c,
    water: 0x38bdf8,
    raise: 0xff6b4a,
    lower: 0x818cf8,
    smooth: 0xe2e8f0,
    rock: 0x94a3b8
  };

  function updateBrushColor() {
    ringMat.color.setHex(brushColorMap[editorState.brushType] || 0xffffff);
  }

  // ---------------------------------------------------------- Raycasting
  function raycastTerrain(event) {
    const rect = domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(groundMesh, false);
    if (intersects.length > 0) {
      editorState.hitPoint.copy(intersects[0].point);
      editorState.hasHit = true;
      brushRing.visible = true;
      brushRing.position.copy(editorState.hitPoint);
      brushRing.position.y += 0.08;
      brushRing.scale.set(editorState.brushRadius, 1, editorState.brushRadius);
      return true;
    } else {
      editorState.hasHit = false;
      brushRing.visible = false;
      return false;
    }
  }

  // ---------------------------------------------------------- Paint Engine
  function applyBrushAt(cx, cz) {
    const R = editorState.brushRadius;
    const strength = editorState.brushStrength;
    const bType = editorState.brushType;
    let modifiedHeights = false;

    // 1. Update 512x512 DataTexture (Affects GPU Grass & Biome streaming)
    const minX = TERRAIN_BOUNDS.x, minZ = TERRAIN_BOUNDS.y;
    const sizeX = TERRAIN_BOUNDS.z, sizeZ = TERRAIN_BOUNDS.w;

    const uMin = Math.max(0, (cx - R - minX) / sizeX);
    const uMax = Math.min(1, (cx + R - minX) / sizeX);
    const vMin = Math.max(0, (cz - R - minZ) / sizeZ);
    const vMax = Math.min(1, (cz + R - minZ) / sizeZ);

    const pxMin = Math.floor(uMin * (texSize - 1));
    const pxMax = Math.ceil(uMax * (texSize - 1));
    const pyMin = Math.floor(vMin * (texSize - 1));
    const pyMax = Math.ceil(vMax * (texSize - 1));

    for (let iy = pyMin; iy <= pyMax; iy++) {
      const pz = minZ + (iy / (texSize - 1)) * sizeZ;
      for (let ix = pxMin; ix <= pxMax; ix++) {
        const px = minX + (ix / (texSize - 1)) * sizeX;
        const d = Math.hypot(px - cx, pz - cz);
        if (d > R) continue;

        // Smooth cosine falloff
        const w = Math.cos((d / R) * (Math.PI * 0.5)) * strength;
        const idx = (iy * texSize + ix) * 4;

        let curH = data[idx + 0];
        let cr = data[idx + 1];
        let cg = data[idx + 2];
        let cb = data[idx + 3];

        if (bType === 'grass') {
          // Lush Green Ground (high greenness => grass blades spawn)
          cr = THREE.MathUtils.lerp(cr, cGrassLush.r, w);
          cg = THREE.MathUtils.lerp(cg, cGrassLush.g, w);
          cb = THREE.MathUtils.lerp(cb, cGrassLush.b, w);
        } else if (bType === 'sand') {
          // Beach / Sand (culls grass)
          cr = THREE.MathUtils.lerp(cr, cSand.r, w);
          cg = THREE.MathUtils.lerp(cg, cSand.g, w);
          cb = THREE.MathUtils.lerp(cb, cSand.b, w);
        } else if (bType === 'road') {
          // Earthen Road / Trail (culls grass)
          cr = THREE.MathUtils.lerp(cr, cPath.r, w);
          cg = THREE.MathUtils.lerp(cg, cPath.g, w);
          cb = THREE.MathUtils.lerp(cb, cPath.b, w);
        } else if (bType === 'rock') {
          // Rugged Rock Cliff (culls grass)
          cr = THREE.MathUtils.lerp(cr, cRock.r, w);
          cg = THREE.MathUtils.lerp(cg, cRock.g, w);
          cb = THREE.MathUtils.lerp(cb, cRock.b, w);
        } else if (bType === 'water') {
          // Lower into water basin & paint turquoise
          curH = THREE.MathUtils.lerp(curH, -1.8, w * 0.65);
          cr = THREE.MathUtils.lerp(cr, cSeaShallow.r, w);
          cg = THREE.MathUtils.lerp(cg, cSeaShallow.g, w);
          cb = THREE.MathUtils.lerp(cb, cSeaShallow.b, w);
          modifiedHeights = true;
        } else if (bType === 'raise') {
          curH += w * 1.8;
          modifiedHeights = true;
        } else if (bType === 'lower') {
          curH -= w * 1.8;
          modifiedHeights = true;
        } else if (bType === 'smooth') {
          // 4-neighborhood average
          const leftIdx = (iy * texSize + Math.max(0, ix - 1)) * 4;
          const rightIdx = (iy * texSize + Math.min(texSize - 1, ix + 1)) * 4;
          const upIdx = (Math.min(texSize - 1, iy + 1) * texSize + ix) * 4;
          const downIdx = (Math.max(0, iy - 1) * texSize + ix) * 4;
          const avgH = (data[leftIdx] + data[rightIdx] + data[upIdx] + data[downIdx]) * 0.25;
          curH = THREE.MathUtils.lerp(curH, avgH, w);
          modifiedHeights = true;
        }

        data[idx + 0] = curH;
        data[idx + 1] = cr;
        data[idx + 2] = cg;
        data[idx + 3] = cb;
      }
    }
    tex.needsUpdate = true;

    // 2. Update Ground 3D Mesh Geometry (Positions & Vertex Colors)
    const vCount = posAttr.count;
    for (let i = 0; i < vCount; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      const d = Math.hypot(vx - cx, vz - cz);
      if (d > R) continue;

      const w = Math.cos((d / R) * (Math.PI * 0.5)) * strength;
      let vy = posAttr.getY(i);
      let vr = colAttr.getX(i);
      let vg = colAttr.getY(i);
      let vb = colAttr.getZ(i);

      if (bType === 'grass') {
        vr = THREE.MathUtils.lerp(vr, cGrassLush.r, w);
        vg = THREE.MathUtils.lerp(vg, cGrassLush.g, w);
        vb = THREE.MathUtils.lerp(vb, cGrassLush.b, w);
      } else if (bType === 'sand') {
        vr = THREE.MathUtils.lerp(vr, cSand.r, w);
        vg = THREE.MathUtils.lerp(vg, cSand.g, w);
        vb = THREE.MathUtils.lerp(vb, cSand.b, w);
      } else if (bType === 'road') {
        vr = THREE.MathUtils.lerp(vr, cPath.r, w);
        vg = THREE.MathUtils.lerp(vg, cPath.g, w);
        vb = THREE.MathUtils.lerp(vb, cPath.b, w);
      } else if (bType === 'rock') {
        vr = THREE.MathUtils.lerp(vr, cRock.r, w);
        vg = THREE.MathUtils.lerp(vg, cRock.g, w);
        vb = THREE.MathUtils.lerp(vb, cRock.b, w);
      } else if (bType === 'water') {
        vy = THREE.MathUtils.lerp(vy, -1.8, w * 0.65);
        vr = THREE.MathUtils.lerp(vr, cSeaShallow.r, w);
        vg = THREE.MathUtils.lerp(vg, cSeaShallow.g, w);
        vb = THREE.MathUtils.lerp(vb, cSeaShallow.b, w);
        posAttr.setY(i, vy);
      } else if (bType === 'raise') {
        vy += w * 1.8;
        posAttr.setY(i, vy);
      } else if (bType === 'lower') {
        vy -= w * 1.8;
        posAttr.setY(i, vy);
      } else if (bType === 'smooth') {
        // Sample exact ground height from data texture
        const u = THREE.MathUtils.clamp((vx - minX) / sizeX, 0, 1);
        const v = THREE.MathUtils.clamp((vz - minZ) / sizeZ, 0, 1);
        const tx = Math.floor(u * (texSize - 1));
        const ty = Math.floor(v * (texSize - 1));
        const sH = data[(ty * texSize + tx) * 4];
        vy = THREE.MathUtils.lerp(vy, sH, w);
        posAttr.setY(i, vy);
      }

      colAttr.setXYZ(i, vr, vg, vb);
    }

    colAttr.needsUpdate = true;
    if (modifiedHeights) {
      posAttr.needsUpdate = true;
      geo.computeVertexNormals();
    }
  }

  // ---------------------------------------------------------- Mouse Event Listeners
  // Left Click (button 0): Draw
  // Right Click (button 2): Orbit / Look around (handled by OrbitControls)
  // Middle Click (button 1): Pan (handled by OrbitControls)
  domElement.addEventListener('pointerdown', (e) => {
    if (e.button === 0) { // Left click
      const hit = raycastTerrain(e);
      if (hit) {
        editorState.isPainting = true;
        applyBrushAt(editorState.hitPoint.x, editorState.hitPoint.z);
      }
    }
  });

  window.addEventListener('pointermove', (e) => {
    raycastTerrain(e);
    if (editorState.isPainting && editorState.hasHit) {
      applyBrushAt(editorState.hitPoint.x, editorState.hitPoint.z);
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (e.button === 0) {
      editorState.isPainting = false;
    }
  });

  // ---------------------------------------------------------- PCG Tools
  let pcgSeed = Math.random() * 1000;

  function pcgGenerateNewWorld() {
    pcgSeed = Math.random() * 10000;
    const inv = 1 / (texSize - 1);
    const minX = TERRAIN_BOUNDS.x, minZ = TERRAIN_BOUNDS.y;
    const sizeX = TERRAIN_BOUNDS.z, sizeZ = TERRAIN_BOUNDS.w;

    // Randomize noise parameters for distinctive island shapes
    const scale1 = 0.012 + Math.random() * 0.014;
    const scale2 = 0.045 + Math.random() * 0.045;
    const amp1 = 8.0 + Math.random() * 7.0;
    const amp2 = 1.4 + Math.random() * 1.6;
    const warpAmt = 15.0 + Math.random() * 20.0;
    const coastRadius = 110 + Math.random() * 30;

    // Procedural generation of heights & albedo
    for (let iy = 0; iy < texSize; iy++) {
      const z = minZ + iy * inv * sizeZ;
      for (let ix = 0; ix < texSize; ix++) {
        const x = minX + ix * inv * sizeX;
        const r = Math.hypot(x, z);
        const flat = THREE.MathUtils.smoothstep(r, 7, 32);

        // Domain warping for organic ridges & mountain ravines
        const wx = x + fbm(x * 0.02 + pcgSeed, z * 0.02 + 13.5) * warpAmt;
        const wz = z + fbm(z * 0.02 - 7.2, x * 0.02 + pcgSeed) * warpAmt;

        const h = (fbm(wx * scale1 + pcgSeed, wz * scale1 + pcgSeed * 0.7) - 0.38) * amp1 * flat
                + (fbm(x * scale2 + 3.1, z * scale2 + 7.7) - 0.5) * amp2 * flat;

        const coast = THREE.MathUtils.smoothstep(r, coastRadius, coastRadius + 85);
        const y = h * (1 - coast) - coast * coast * 42;
        const col = terrainAlbedo(x, z, y);

        const idx = (iy * texSize + ix) * 4;
        data[idx + 0] = y;
        data[idx + 1] = col.r;
        data[idx + 2] = col.g;
        data[idx + 3] = col.b;
      }
    }
    tex.needsUpdate = true;

    // Sync mesh geometry
    const vCount = posAttr.count;
    for (let i = 0; i < vCount; i++) {
      const x = posAttr.getX(i), z = posAttr.getZ(i);
      const u = THREE.MathUtils.clamp((x - minX) / sizeX, 0, 1);
      const v = THREE.MathUtils.clamp((z - minZ) / sizeZ, 0, 1);
      const tx = Math.floor(u * (texSize - 1));
      const ty = Math.floor(v * (texSize - 1));
      const idx = (ty * texSize + tx) * 4;

      posAttr.setY(i, data[idx + 0]);
      colAttr.setXYZ(i, data[idx + 1], data[idx + 2], data[idx + 3]);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    geo.computeVertexNormals();

    // Auto pick up trees: rules ensure no trees in water, rock, or road!
    rebuildTreesPCG();
  }

  function pcgResetDefault() {
    const inv = 1 / (texSize - 1);
    const minX = TERRAIN_BOUNDS.x, minZ = TERRAIN_BOUNDS.y;
    const sizeX = TERRAIN_BOUNDS.z, sizeZ = TERRAIN_BOUNDS.w;

    for (let iy = 0; iy < texSize; iy++) {
      const z = minZ + iy * inv * sizeZ;
      for (let ix = 0; ix < texSize; ix++) {
        const x = minX + ix * inv * sizeX;
        const y = proceduralHeight(x, z);
        const col = terrainAlbedo(x, z, y);
        const idx = (iy * texSize + ix) * 4;
        data[idx + 0] = y;
        data[idx + 1] = col.r;
        data[idx + 2] = col.g;
        data[idx + 3] = col.b;
      }
    }
    tex.needsUpdate = true;

    const vCount = posAttr.count;
    for (let i = 0; i < vCount; i++) {
      const x = posAttr.getX(i), z = posAttr.getZ(i);
      const y = proceduralHeight(x, z);
      const col = terrainAlbedo(x, z, y);
      posAttr.setY(i, y);
      colAttr.setXYZ(i, col.r, col.g, col.b);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    rebuildTreesPCG();
  }

  // ---------------------------------------------------------- UI Binding
  function setBrush(type) {
    editorState.brushType = type;
    updateBrushColor();
    document.querySelectorAll('.brush-btn').forEach(btn => {
      if (btn.getAttribute('data-brush') === type) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  document.querySelectorAll('.brush-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const b = e.currentTarget.getAttribute('data-brush');
      if (b) setBrush(b);
    });
  });

  const bSizeSlider = document.getElementById('brushRadiusSlider');
  if (bSizeSlider) {
    bSizeSlider.addEventListener('input', (e) => {
      editorState.brushRadius = Number(e.target.value);
      const val = document.getElementById('brushRadiusVal');
      if (val) val.textContent = `${editorState.brushRadius}m`;
      brushRing.scale.set(editorState.brushRadius, 1, editorState.brushRadius);
    });
  }

  const bStrengthSlider = document.getElementById('brushStrengthSlider');
  if (bStrengthSlider) {
    bStrengthSlider.addEventListener('input', (e) => {
      editorState.brushStrength = Number(e.target.value);
      const val = document.getElementById('brushStrengthVal');
      if (val) val.textContent = `${Math.round(editorState.brushStrength * 100)}%`;
    });
  }

  document.getElementById('pcgNewWorldBtn')?.addEventListener('click', pcgGenerateNewWorld);
  document.getElementById('pcgAutoTreesBtn')?.addEventListener('click', rebuildTreesPCG);
  document.getElementById('pcgResetBtn')?.addEventListener('click', pcgResetDefault);

  updateBrushColor();

  return {
    editorState,
    setBrush,
    pcgGenerateNewWorld,
    pcgResetDefault,
    brushRing
  };
}
