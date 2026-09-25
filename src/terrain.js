import * as THREE from 'three';

/* ---------------------------------------------------------- noise */
export function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) {
    v += amp * vnoise(x * f, y * f);
    amp *= 0.5;
    f *= 2.1;
  }
  return v;
}

export const WATER_Y = 0;

export function proceduralHeight(x, z) {
  const r = Math.hypot(x, z);
  const flat = THREE.MathUtils.smoothstep(r, 8, 34); // keep clearing near camera flat
  const h = (fbm(x * 0.018 + 9.2, z * 0.018 + 4.7) - 0.4) * 9.0 * flat
        + (fbm(x * 0.09 + 3.1, z * 0.09 + 7.7) - 0.5) * 1.6 * flat;
  // island falloff: coast drops below sea level toward plane edge
  const coast = THREE.MathUtils.smoothstep(r, 120, 210);
  return h * (1 - coast) - coast * coast * 40;
}

export function groundHeight(x, z) {
  // If live modified terrain data texture exists, sample live sculpted/painted heights!
  const tex = _cachedTerrainDataTexture;
  if (!tex || !tex.image || !tex.image.data) {
    return proceduralHeight(x, z);
  }

  const minX = TERRAIN_BOUNDS.x, minZ = TERRAIN_BOUNDS.y;
  const sizeX = TERRAIN_BOUNDS.z, sizeZ = TERRAIN_BOUNDS.w;
  const u = (x - minX) / sizeX;
  const v = (z - minZ) / sizeZ;
  if (u < 0 || u > 1 || v < 0 || v > 1) {
    return proceduralHeight(x, z);
  }

  const size = tex.image.width; // 512
  const fx = u * (size - 1);
  const fy = v * (size - 1);
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const rx = fx - ix;
  const ry = fy - iy;

  const data = tex.image.data;
  const i00 = (iy * size + ix) * 4;
  const i10 = (iy * size + Math.min(size - 1, ix + 1)) * 4;
  const i01 = (Math.min(size - 1, iy + 1) * size + ix) * 4;
  const i11 = (Math.min(size - 1, iy + 1) * size + Math.min(size - 1, ix + 1)) * 4;

  const h0 = data[i00] * (1 - rx) + data[i10] * rx;
  const h1 = data[i01] * (1 - rx) + data[i11] * rx;
  return h0 * (1 - ry) + h1 * ry;
}

export function getLiveTerrainBiome(x, z) {
  const tex = _cachedTerrainDataTexture;
  if (!tex || !tex.image || !tex.image.data) {
    const y = groundHeight(x, z);
    const col = terrainAlbedo(x, z, y);
    return { y, r: col.r, g: col.g, b: col.b, greenness: (col.g - col.r) / 0.18 };
  }
  const minX = TERRAIN_BOUNDS.x, minZ = TERRAIN_BOUNDS.y;
  const sizeX = TERRAIN_BOUNDS.z, sizeZ = TERRAIN_BOUNDS.w;
  const u = THREE.MathUtils.clamp((x - minX) / sizeX, 0, 1);
  const v = THREE.MathUtils.clamp((z - minZ) / sizeZ, 0, 1);
  const size = tex.image.width;
  const ix = Math.floor(u * (size - 1));
  const iy = Math.floor(v * (size - 1));
  const idx = (iy * size + ix) * 4;
  const data = tex.image.data;
  const y = data[idx + 0];
  const r = data[idx + 1];
  const g = data[idx + 2];
  const b = data[idx + 3];
  const greenness = (g - r) / 0.18;
  return { y, r, g, b, greenness };
}

/* ---------------------------------------------------------- forest path */
export const PATH_RADIUS = 4.2;

export function pathCenterZ(x) {
  return Math.sin(x * 0.035) * 20 + Math.cos(x * 0.08) * 7;
}

export function pathFactor(x, z) {
  const d = Math.abs(z - pathCenterZ(x));
  if (d >= PATH_RADIUS) return 0.0;
  const t = d / PATH_RADIUS;
  return 1.0 - t * t; // 1.0 in path center, smoothly drops to 0.0 at edge
}

/* ---------------------------------------------------------- biomes & albedo */
export const cGrassLush = new THREE.Color(0x4ca03e); // stylized vibrant green
export const cGrassWarm = new THREE.Color(0x6eb84e); // bright sunlit meadow
export const cGrassDark = new THREE.Color(0x2d6824); // deep mossy forest green
export const cPath      = new THREE.Color(0x826649); // earthen path
export const cSandWet   = new THREE.Color(0xbfa472); // wet sand at shoreline
export const cSand      = new THREE.Color(0xecd396); // warm golden beach sand
export const cSeaShallow = new THREE.Color(0x237075); // turquoise shallows bed
export const cSeaMid     = new THREE.Color(0x113b5e); // deep ocean floor
export const cSeaDeep    = new THREE.Color(0x061a30); // abyss floor
export const cRock       = new THREE.Color(0x6e747b); // rugged cliff rock
const _tc = new THREE.Color();

export function terrainAlbedo(x, z, yVal) {
  const y = (yVal !== undefined) ? yVal : groundHeight(x, z);
  const n = fbm(x * 0.06 + 40, z * 0.06 + 11);

  if (y < 0.0) {
    // Underwater depth gradient: shallow turquoise -> deep ocean navy -> dark abyss
    const depth = -y;
    _tc.copy(cSandWet)
       .lerp(cSeaShallow, THREE.MathUtils.smoothstep(depth, 0.2, 3.0))
       .lerp(cSeaMid, THREE.MathUtils.smoothstep(depth, 3.0, 10.0))
       .lerp(cSeaDeep, THREE.MathUtils.smoothstep(depth, 10.0, 30.0));
  } else {
    // Stylized lush green terrain where grass grows
    _tc.copy(cGrassLush).lerp(cGrassWarm, THREE.MathUtils.smoothstep(n, 0.42, 0.72));
    _tc.lerp(cGrassDark, THREE.MathUtils.smoothstep(y, 2.5, 7.0) * 0.5);

    // Warm golden sand near water (beach from y=0 up to y=1.8)
    const sandAmount = 1.0 - THREE.MathUtils.smoothstep(y, 0.2, 1.8);
    _tc.lerp(cSand, sandAmount);
    _tc.lerp(cSandWet, 1.0 - THREE.MathUtils.smoothstep(y, 0.0, 0.4));

    // Winding forest earthen path
    const p = pathFactor(x, z);
    if (p > 0.0 && y > 1.0) {
      _tc.lerp(cPath, p * 0.88);
    }
  }

  return _tc;
}

export const TERRAIN_BOUNDS = new THREE.Vector4(-220.0, -220.0, 440.0, 440.0);

let _cachedTerrainDataTexture = null;

export function getTerrainDataTexture(size = 512) {
  if (_cachedTerrainDataTexture) return _cachedTerrainDataTexture;

  const data = new Float32Array(size * size * 4);
  const inv = 1 / (size - 1);
  const minX = TERRAIN_BOUNDS.x, minZ = TERRAIN_BOUNDS.y;
  const sizeX = TERRAIN_BOUNDS.z, sizeZ = TERRAIN_BOUNDS.w;

  for (let iy = 0; iy < size; iy++) {
    const z = minZ + iy * inv * sizeZ;
    for (let ix = 0; ix < size; ix++) {
      const x = minX + ix * inv * sizeX;
      const y = proceduralHeight(x, z);
      const col = terrainAlbedo(x, z, y);
      const idx = (iy * size + ix) * 4;
      data[idx + 0] = y;
      data[idx + 1] = col.r;
      data[idx + 2] = col.g;
      data[idx + 3] = col.b;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  _cachedTerrainDataTexture = tex;
  return tex;
}

let _cachedGroundMesh = null;

export function getGroundMesh() {
  return _cachedGroundMesh;
}

export function createGround(scene) {
  const geo = new THREE.PlaneGeometry(440, 440, 200, 200);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = groundHeight(x, z);
    pos.setY(i, y);
    const c = terrainAlbedo(x, z, y);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0
  }));
  ground.name = 'terrain_ground';
  ground.receiveShadow = true;
  scene.add(ground);
  _cachedGroundMesh = ground;
  return ground;
}

