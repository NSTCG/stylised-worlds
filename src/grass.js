import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { windUniforms } from './wind.js';
import { getTerrainDataTexture, TERRAIN_BOUNDS } from './terrain.js';

export const grassConfig = {
  maxPool: 180000,
  currentCount: 62000,
  density: 16, // blades / m²
  userRadius: 35.0, // meters
  heightScale: 1.0, // global height scale factor
  currentColor: '#4ca03e'
};

export const grassUniforms = {
  uPlayerPos:        { value: new THREE.Vector3(21, 5.5, 25) },
  uGrassRadius:      { value: 35.0 },
  uGrassHeightScale: { value: 1.0 },
  uGrassColor:       { value: new THREE.Color(0x4ca03e) },
  uTerrainDataMap:   { value: null },
  uTerrainBounds:    { value: TERRAIN_BOUNDS }
};

/* ---------------------------------------------------------- Procedural Single Triangle Blade Geometry */
export function createTriangleBladeGeometry(baseWidth = 0.32, height = 1.20) {
  const halfW = baseWidth * 0.5;
  const positions = new Float32Array([
    -halfW, 0.0, 0.0,   // Root left
     halfW, 0.0, 0.0,   // Root right
       0.0, height, 0.0  // Tip center
  ]);
  const uvs = new Float32Array([
    0.0, 0.0,
    1.0, 0.0,
    0.5, 1.0
  ]);
  const normals = new Float32Array([
    0.0, 0.0, 1.0,
    0.0, 0.0, 1.0,
    0.0, 0.0, 1.0
  ]);
  const indices = new Uint16Array([0, 1, 2]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/* ---------------------------------------------------------- GPU-Driven Vertex Shader */
function addGpuGrassShader(material, bladeHeight = 1.20) {
  const f = (n) => { const s = String(n); return s.includes('.') || s.includes('e') ? s : s + '.0'; };
  const prev = material.onBeforeCompile || null;

  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uPlayerPos = grassUniforms.uPlayerPos;
    shader.uniforms.uGrassRadius = grassUniforms.uGrassRadius;
    shader.uniforms.uGrassHeightScale = grassUniforms.uGrassHeightScale;
    shader.uniforms.uGrassColor = grassUniforms.uGrassColor;
    shader.uniforms.uTerrainDataMap = grassUniforms.uTerrainDataMap;
    shader.uniforms.uTerrainBounds = grassUniforms.uTerrainBounds;

    shader.vertexShader = `
      uniform float uTime;
      uniform vec3 uPlayerPos;
      uniform float uGrassRadius;
      uniform float uGrassHeightScale;
      uniform vec3 uGrassColor;
      uniform sampler2D uTerrainDataMap;
      uniform vec4 uTerrainBounds;

      attribute vec2 aGrassBase;
      attribute vec3 aGrassSeed;

      varying float vBladeH;
      varying vec3 vTerrainColor;
      varying vec3 vGroundNormal;

      // Prevailing wind direction and perpendicular vector
      const vec2 wDir = vec2(0.82116, 0.5707);
      const vec2 wPerp = vec2(-0.5707, 0.82116);

      // 2D Simplex Noise for procedural rolling wind field
      vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod(i, 289.0);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
        m = m * m; m = m * m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      float getPathFactorG(vec2 p) {
        float centerZ = sin(p.x * 0.035) * 20.0 + cos(p.x * 0.08) * 7.0;
        float d = abs(p.y - centerZ);
        if (d >= 4.2) return 0.0;
        float t = d / 4.2;
        return 1.0 - t * t;
      }
    ` + shader.vertexShader
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float hNorm = clamp(position.y / ${f(bladeHeight)}, 0.0, 1.0);
        vBladeH = hNorm;
        vGroundNormal = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
        vec3 windTiltNormal = normalize(vec3(wDir.x * 0.42, 0.88, wDir.y * 0.42));
        objectNormal = normalize(mix(vec3(0.0, 1.0, 0.0), windTiltNormal, smoothstep(0.0, 0.70, hNorm)));`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float S = uGrassRadius * 2.0;
          vec2 localP = aGrassBase * S;
          float cellX = floor((uPlayerPos.x - localP.x) / S + 0.5);
          float cellZ = floor((uPlayerPos.z - localP.y) / S + 0.5);
          vec2 worldXZ = vec2(cellX * S + localP.x, cellZ * S + localP.y);

          // Radial distance from player
          float dist = length(worldXZ - uPlayerPos.xz);
          float radScale = 1.0 - smoothstep(uGrassRadius * 0.88, uGrassRadius, dist);

          // Streamed Heightmap & Terrain Albedo texture sample with hardware bilinear interpolation
          vec2 terrainUV = (worldXZ - uTerrainBounds.xy) / uTerrainBounds.zw;
          vec4 mapSample = texture2D(uTerrainDataMap, clamp(terrainUV, 0.0, 1.0));
          float yGround = mapSample.r;
          vec3 tc = mapSample.gba;
          vTerrainColor = tc;

          float pathVal = getPathFactorG(worldXZ);
          float greenness = clamp((tc.g - tc.r) / 0.18, 0.0, 1.0);

          // Full biome cutoff logic on GPU
          bool discardBlade = (yGround < 0.02) || (yGround > 15.0) || (pathVal > 0.35) || (greenness <= 0.03) || (aGrassSeed.x > pow(greenness, 1.4)) || (radScale <= 0.001);

          if (discardBlade) {
            transformed = vec3(0.0);
          } else {
            float h = clamp(position.y / ${f(bladeHeight)}, 0.0, 1.0);

            // Scale blade dimensions based on greenness and global height scale
            float heightFactor = (0.28 + 0.72 * pow(greenness, 0.85)) * (0.85 + 0.40 * aGrassSeed.z);
            float widthFactor  = (0.35 + 0.65 * greenness) * (0.90 + 0.35 * aGrassSeed.y);
            transformed.xz *= widthFactor;
            transformed.y *= heightFactor * uGrassHeightScale;

            // Natural initial yaw orientation: predominantly inclined with wind + organic variance
            float bladeYaw = 0.62 + (aGrassSeed.y - 0.5) * 1.35;
            float cy = cos(bladeYaw), sy = sin(bladeYaw);
            vec2 rotXZ = vec2(transformed.x * cy - transformed.z * sy, transformed.x * sy + transformed.z * cy);
            transformed.x = rotXZ.x;
            transformed.z = rotXZ.y;

            // Scrolled Perlin/Simplex noise wind field
            // Octave 1: Large rolling wind waves across the landscape
            vec2 scrollCoord1 = worldXZ * 0.032 - wDir * (uTime * 0.85);
            float wave1 = snoise(scrollCoord1);

            // Octave 2: Medium gust turbulence and front velocity
            vec2 scrollCoord2 = worldXZ * 0.075 - wDir * (uTime * 1.50) + vec2(3.6, 1.8);
            float wave2 = snoise(scrollCoord2);

            // Composite gust envelope
            float rawGust = wave1 * 0.65 + wave2 * 0.35;
            float gustFactor = smoothstep(-0.35, 0.85, rawGust);

            // Organic high-frequency tip flutter that intensifies during gusts
            float flutter = sin(uTime * 5.8 + dot(worldXZ, vec2(1.8, 2.2)) + aGrassSeed.x * 6.28) * (0.04 + 0.08 * gustFactor);

            // Initial resting tilt + dynamic wind push:
            // Realistic resting lean: blades naturally lean 0.38 - 0.65m along wind direction even in calm air
            float restingLean = 0.42 + 0.26 * aGrassSeed.z;
            float dynamicPush = gustFactor * 0.75;

            // Progressive spine bend curve: starts arching from lower-middle, max at tip
            float bendSpine = pow(h, 1.35);

            float totalForward = (restingLean + dynamicPush) * bendSpine * uGrassHeightScale;
            float lateralSway = (snoise(scrollCoord1 * 1.6 + vec2(5.4, 2.7)) * 0.14 + flutter * 0.65) * bendSpine * uGrassHeightScale;

            // Displace along wind vector and perpendicular vector
            transformed.x += wDir.x * totalForward + wPerp.x * lateralSway;
            transformed.z += wDir.y * totalForward + wPerp.y * lateralSway;

            // Realistic vertical dip: bending blades naturally pull down their tip
            transformed.y -= (totalForward * totalForward + lateralSway * lateralSway) * (0.26 * uGrassHeightScale);

            // Apply distance falloff
            transformed *= radScale;

            // Translate blade to world coordinates with EXACT terrain height (zero offset!)
            transformed.x += worldXZ.x;
            transformed.y += yGround;
            transformed.z += worldXZ.y;
          }
        }`
      );

    shader.fragmentShader = `
      varying float vBladeH;
      varying vec3 vTerrainColor;
      varying vec3 vGroundNormal;
      uniform vec3 uGrassColor;
    ` + shader.fragmentShader
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        if (!gl_FrontFacing) normal = -normal;
        normal = normalize(mix(vGroundNormal, normal, smoothstep(0.0, 0.60, vBladeH)));`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.95, 0.60, smoothstep(0.0, 0.50, vBladeH));`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float h = clamp(vBladeH, 0.0, 1.0);
          float blend = smoothstep(0.02, 0.85, h);
          vec3 tipColor = uGrassColor * (1.0 + 0.15 * smoothstep(0.65, 1.0, h));
          diffuseColor.rgb = mix(vTerrainColor, tipColor, blend);
        }`
      );
  };
}

let grassMeshRef = null;

/* ---------------------------------------------------------- build grass system */
export function buildGrass(scene) {
  grassUniforms.uTerrainDataMap.value = getTerrainDataTexture(512);
  grassUniforms.uTerrainBounds.value = TERRAIN_BOUNDS;

  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.75,
    metalness: 0.0,
    side: THREE.DoubleSide
  });
  addGpuGrassShader(mat, 1.20);

  const initialGeo = createTriangleBladeGeometry(0.32, 1.20);
  initialGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Infinity);

  // Pre-generate canonical base positions and seeds uploaded ONCE to GPU
  const N = grassConfig.maxPool;
  const basePositions = new Float32Array(N * 2);
  const seeds = new Float32Array(N * 3);

  const g = 1.324717957244746;
  const a1 = 1.0 / g, a2 = 1.0 / (g * g);

  for (let i = 0; i < N; i++) {
    // Progressive low-discrepancy 2D distribution normalized to [-0.5, 0.5]
    let u = ((0.5 + a1 * i) % 1.0) - 0.5;
    let v = ((0.5 + a2 * i) % 1.0) - 0.5;
    u += Math.sin(i * 12.9898) * 0.0015;
    v += Math.cos(i * 78.233) * 0.0015;
    basePositions[i * 2 + 0] = u;
    basePositions[i * 2 + 1] = v;

    seeds[i * 3 + 0] = Math.random(); // presence vs greenness
    seeds[i * 3 + 1] = Math.random(); // yaw / width
    seeds[i * 3 + 2] = Math.random(); // height scale
  }

  initialGeo.setAttribute('aGrassBase', new THREE.InstancedBufferAttribute(basePositions, 2));
  initialGeo.setAttribute('aGrassSeed', new THREE.InstancedBufferAttribute(seeds, 3));

  const mesh = new THREE.InstancedMesh(initialGeo, mat, N);
  mesh.name = 'grass_instanced';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  // Initialize identity matrices once
  const identityMat = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    mesh.setMatrixAt(i, identityMat);
  }
  mesh.instanceMatrix.needsUpdate = true;
  grassMeshRef = mesh;

  function updatePoolCount() {
    const R = grassConfig.userRadius;
    const D = grassConfig.density;
    const count = Math.min(grassConfig.maxPool, Math.round(4.0 * R * R * D));
    mesh.count = count;
    grassConfig.currentCount = Math.round(Math.PI * R * R * D);
    if (window.updateStatsUI) window.updateStatsUI();
  }

  updatePoolCount();
  scene.add(mesh);

  function setGrassRadius(radius) {
    const clamped = Math.max(10, Math.min(80, Math.round(radius)));
    grassConfig.userRadius = clamped;
    grassUniforms.uGrassRadius.value = clamped;

    const label = document.getElementById('grassRadiusVal');
    if (label) label.textContent = `${clamped}m`;
    const slider = document.getElementById('grassRadiusSlider');
    if (slider && Number(slider.value) !== clamped) slider.value = clamped;

    updatePoolCount();
  }

  function setGrassDensity(density) {
    const clamped = Math.max(2, Math.min(60, Math.round(density)));
    grassConfig.density = clamped;

    const label = document.getElementById('grassDensityVal');
    if (label) label.textContent = `${clamped}/m²`;
    const slider = document.getElementById('grassDensitySlider');
    if (slider && Number(slider.value) !== clamped) slider.value = clamped;

    updatePoolCount();
  }

  function setGrassHeightScale(scale) {
    const clamped = Math.max(0.2, Math.min(3.0, Number(scale)));
    grassConfig.heightScale = clamped;
    grassUniforms.uGrassHeightScale.value = clamped;

    const label = document.getElementById('grassHeightVal');
    if (label) label.textContent = `${clamped.toFixed(1)}x`;
    const slider = document.getElementById('grassHeightSlider');
    if (slider && Math.abs(Number(slider.value) - clamped) > 0.01) {
      slider.value = clamped;
    }
  }

  function setGrassColor(colorHex) {
    grassConfig.currentColor = colorHex;
    grassUniforms.uGrassColor.value.set(colorHex);

    const picker = document.getElementById('grassColorPicker');
    if (picker && picker.value !== colorHex) {
      picker.value = colorHex;
    }
  }

  // Hook UI Sliders
  const radiusSlider = document.getElementById('grassRadiusSlider');
  if (radiusSlider) {
    radiusSlider.addEventListener('input', (e) => {
      setGrassRadius(Number(e.target.value));
    });
  }

  const densitySlider = document.getElementById('grassDensitySlider');
  if (densitySlider) {
    densitySlider.addEventListener('input', (e) => {
      setGrassDensity(Number(e.target.value));
    });
  }

  const heightSlider = document.getElementById('grassHeightSlider');
  if (heightSlider) {
    heightSlider.addEventListener('input', (e) => {
      setGrassHeightScale(Number(e.target.value));
    });
  }

  // Hook UI Color Picker & Presets
  const colorPicker = document.getElementById('grassColorPicker');
  if (colorPicker) {
    colorPicker.addEventListener('input', (e) => {
      setGrassColor(e.target.value);
    });
  }

  document.querySelectorAll('.colorPreset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const color = e.currentTarget.getAttribute('data-color');
      if (color) setGrassColor(color);
    });
  });

  return {
    mesh,
    grassConfig,
    setGrassRadius,
    setGrassDensity,
    setGrassHeightScale,
    setGrassColor
  };
}

export function setGrassHeightScale(scale) {
  const clamped = Math.max(0.2, Math.min(3.0, Number(scale)));
  grassConfig.heightScale = clamped;
  grassUniforms.uGrassHeightScale.value = clamped;

  const label = document.getElementById('grassHeightVal');
  if (label) label.textContent = `${clamped.toFixed(1)}x`;
  const slider = document.getElementById('grassHeightSlider');
  if (slider && Math.abs(Number(slider.value) - clamped) > 0.01) {
    slider.value = clamped;
  }
}

/* ---------------------------------------------------------- update grass */
// ZERO CPU WORK: All calculations (toroidal wrapping, terrain height, terrain color, wind) execute on the GPU!
export function updateGrass(playerPos) {
  if (playerPos) {
    grassUniforms.uPlayerPos.value.set(playerPos.x, playerPos.y, playerPos.z);
  }
}

export function getGrassTriangles() {
  if (!grassMeshRef || !grassMeshRef.geometry) return 0;
  const tris = grassMeshRef.geometry.index ? grassMeshRef.geometry.index.count / 3 : grassMeshRef.geometry.attributes.position.count / 3;
  const visibleEstimate = Math.round(grassMeshRef.count * 0.7854);
  return Math.round(tris * visibleEstimate);
}
