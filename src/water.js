import * as THREE from 'three';
import { windUniforms } from './wind.js';
import { envUniforms } from './environment.js';
import { getTerrainDataTexture, TERRAIN_BOUNDS, WATER_Y } from './terrain.js';

export const waterUniforms = {
  uTime: windUniforms.uTime,
  uDayFactor: envUniforms.uDayFactor,
  uMoonDir: envUniforms.uMoonDir,
  uMoonColor: envUniforms.uMoonColor,
  uHorizon: envUniforms.uHorizon,
  uTerrainTex: { value: null },
  uTerrainBounds: { value: TERRAIN_BOUNDS },
  uWaterY: { value: WATER_Y },
  uShoreFadeDist: { value: 0.55 },
  uShoreFoamWidth: { value: 0.32 }
};

function addWaterScroll(material) {
  const prev = material.onBeforeCompile || null;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);

    // Bind uniforms to live waterUniforms
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.uniforms.uDayFactor = waterUniforms.uDayFactor;
    shader.uniforms.uMoonDir = waterUniforms.uMoonDir;
    shader.uniforms.uMoonColor = waterUniforms.uMoonColor;
    shader.uniforms.uHorizon = waterUniforms.uHorizon;
    shader.uniforms.uTerrainTex = waterUniforms.uTerrainTex;
    shader.uniforms.uTerrainBounds = waterUniforms.uTerrainBounds;
    shader.uniforms.uWaterY = waterUniforms.uWaterY;
    shader.uniforms.uShoreFadeDist = waterUniforms.uShoreFadeDist;
    shader.uniforms.uShoreFoamWidth = waterUniforms.uShoreFoamWidth;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <envmap_pars_vertex>',
        `#include <envmap_pars_vertex>
        #ifndef ENV_WORLDPOS
        varying vec3 vWorldPosition;
        #endif`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        #ifndef ENV_WORLDPOS
        vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <envmap_pars_fragment>',
        `#include <envmap_pars_fragment>
        #ifndef ENV_WORLDPOS
        varying vec3 vWorldPosition;
        #endif

        uniform sampler2D uTerrainTex;
        uniform vec4 uTerrainBounds;
        uniform float uWaterY;
        uniform float uShoreFadeDist;
        uniform float uShoreFoamWidth;

        // High-precision bilinear sampling of live terrain height map
        float getDynamicGroundHeight(vec2 worldXZ) {
          vec2 terrainUV = (worldXZ - uTerrainBounds.xy) / uTerrainBounds.zw;
          if (terrainUV.x >= 0.002 && terrainUV.x <= 0.998 && terrainUV.y >= 0.002 && terrainUV.y <= 0.998) {
            vec2 st = terrainUV * 512.0 - 0.5;
            vec2 i0 = floor(st);
            vec2 f = fract(st);
            vec2 tc0 = (clamp(i0, 0.0, 511.0) + 0.5) / 512.0;
            vec2 tc1 = (clamp(i0 + 1.0, 0.0, 511.0) + 0.5) / 512.0;
            float d00 = texture2D(uTerrainTex, vec2(tc0.x, tc0.y)).r;
            float d10 = texture2D(uTerrainTex, vec2(tc1.x, tc0.y)).r;
            float d01 = texture2D(uTerrainTex, vec2(tc0.x, tc1.y)).r;
            float d11 = texture2D(uTerrainTex, vec2(tc1.x, tc1.y)).r;
            return mix(mix(d00, d10, f.x), mix(d01, d11, f.x), f.y);
          }
          float r = length(worldXZ);
          float coast = smoothstep(120.0, 210.0, r);
          return -coast * coast * 40.0 - 5.0;
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Dynamic water depth coloring calculated per-pixel from live terrain heights
          vec2 wp = vWorldPosition.xz;
          float gH = getDynamicGroundHeight(wp);
          float dynD = max(0.0, vWorldPosition.y - gH);

          vec3 cShallow = vec3(0.20, 0.72, 0.68);  // vibrant turquoise shallows
          vec3 cMid     = vec3(0.08, 0.44, 0.56);  // tropical azure lagoon
          vec3 cDeep    = vec3(0.04, 0.18, 0.30);  // ocean navy

          float d1 = smoothstep(0.05, 2.2, dynD);
          float d2 = smoothstep(2.2, 9.0, dynD);
          vec3 dynamicWaterColor = mix(cShallow, cMid, d1);
          dynamicWaterColor = mix(dynamicWaterColor, cDeep, d2);
          diffuseColor.rgb = dynamicWaterColor;
        }`
      )
      .replace('#include <emissivemap_pars_fragment>', `#include <emissivemap_pars_fragment>
        uniform float uTime;
        uniform float uDayFactor;
        uniform vec3 uMoonDir;
        uniform vec3 uMoonColor;
        uniform vec3 uHorizon;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Rotated non-Cartesian wave directions break repetitive square grid
          vec2 wp = vWorldPosition.xz;
          float warp = sin(wp.x * 0.04 + wp.y * 0.05 + uTime * 0.25) * 1.6;
          vec2 p = wp + vec2(warp, -warp);

          vec2 d1 = vec2(0.906, 0.423);   // ~25 deg
          vec2 d2 = vec2(0.342, 0.940);   // ~70 deg
          vec2 d3 = vec2(0.707, -0.707);  // ~-45 deg
          vec2 d4 = vec2(-0.574, 0.819);  // ~125 deg

          float w1 = dot(p, d1) * 0.32 + uTime * 1.15;
          float w2 = dot(p, d2) * 0.68 - uTime * 1.35;
          float w3 = dot(p, d3) * 1.42 + uTime * 1.8;
          float w4 = dot(p, d4) * 2.75 - uTime * 2.2;

          vec2 grad = d1 * (cos(w1) * 0.20)
                    + d2 * (cos(w2) * 0.15)
                    + d3 * (cos(w3) * 0.09)
                    + d4 * (cos(w4) * 0.05);

          // Increased ripple amplitude for crisp wave relief in low light
          normal = normalize(normal + vec3(grad.x, 0.0, grad.y) * 0.58);

          // Make water ripples and movement vividly visible at night
          float nightFactor = 1.0 - uDayFactor;
          if (nightFactor > 0.01) {
            // Wave crest pattern
            float waveCrest = sin(w1) * 0.36 + cos(w2) * 0.28 + sin(w3) * 0.22 + cos(w4) * 0.14;
            float crestMask = smoothstep(0.06, 0.52, waveCrest);

            // Glistening moon glade / specular highlights dancing across wave faces
            vec3 V = normalize(cameraPosition - vWorldPosition);
            vec3 H = normalize(uMoonDir + V);
            float NdotH = max(dot(normal, H), 0.0);
            float moonGlade = pow(NdotH, 32.0) * 0.90 + pow(NdotH, 7.0) * 0.25;

            // Glowing moon-kissed wave crests & moon glade reflection
            vec3 moonWaterTone = mix(uHorizon * 1.3, uMoonColor * 1.6, 0.70);
            totalEmissiveRadiance += moonWaterTone * (crestMask * 0.085 + moonGlade * 0.55) * nightFactor;
          }
        }`)
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          // Dynamic live shoreline detection & fade-out:
          vec2 wp = vWorldPosition.xz;
          float gH = getDynamicGroundHeight(wp);
          float dynDepth = vWorldPosition.y - gH;

          // Discard underground water well inland beneath the terrain
          if (dynDepth < -0.30) {
            discard;
          }

          // Dynamic soft shoreline alpha fade: fades water to transparent where it touches terrain
          float shoreAlpha = smoothstep(0.0, uShoreFadeDist, max(0.0, dynDepth));
          gl_FragColor.a *= shoreAlpha;

          // Dynamic shoreline contact foam line & wave surge
          float warpVal = sin(wp.x * 0.04 + wp.y * 0.05 + uTime * 0.25) * 1.6;
          float waveSurge = sin(uTime * 2.8 - max(0.0, dynDepth) * 15.0 + warpVal * 0.8) * 0.5 + 0.5;
          float foamBand = smoothstep(uShoreFoamWidth, 0.01, dynDepth) * smoothstep(0.25, 0.75, waveSurge);
          float contactEdge = 1.0 - smoothstep(0.0, 0.10, max(0.0, dynDepth));
          float totalFoam = clamp(contactEdge * 0.90 + foamBand * 0.65, 0.0, 1.0) * shoreAlpha;

          vec3 foamColor = vec3(0.92, 0.98, 1.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, foamColor, totalFoam * 0.82);
          gl_FragColor.a = max(gl_FragColor.a, totalFoam * 0.85);
        }`
      );
  };
}

export function createWater(scene) {
  const waterGeo = new THREE.PlaneGeometry(520, 520, 128, 128);
  waterGeo.rotateX(-Math.PI / 2);

  const cubeRT = new THREE.WebGLCubeRenderTarget(256, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter
  });
  const cubeCam = new THREE.CubeCamera(0.5, 400, cubeRT);
  cubeCam.position.set(0, 3, 0);
  scene.add(cubeCam);
  scene.environment = cubeRT.texture;

  // Initialize terrain texture uniform to live terrain texture
  waterUniforms.uTerrainTex.value = getTerrainDataTexture();
  waterUniforms.uTerrainBounds.value = TERRAIN_BOUNDS;
  waterUniforms.uWaterY.value = WATER_Y;

  const waterMat = new THREE.MeshPhongMaterial({
    color: new THREE.Color(0x237075),
    vertexColors: false,
    transparent: true,
    opacity: 0.85,
    shininess: 160,
    specular: 0x9fd4ff,
    envMap: cubeRT.texture,
    reflectivity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  addWaterScroll(waterMat);

  const water = new THREE.Mesh(waterGeo, waterMat);
  water.name = 'water_plane';
  water.position.y = WATER_Y;
  water.receiveShadow = true;
  water.renderOrder = 1;
  scene.add(water);

  let cubeBaked = false;

  function updateWater(t, frame, renderer) {
    // Keep terrain texture uniform reference in sync with live sculpted terrain
    const liveTex = getTerrainDataTexture();
    if (waterUniforms.uTerrainTex.value !== liveTex) {
      waterUniforms.uTerrainTex.value = liveTex;
    }

    // Bake the sky & mountain reflection cubemap once on first frame
    if (!cubeBaked) {
      water.visible = false;
      renderer.shadowMap.autoUpdate = false;
      try {
        cubeCam.update(renderer, scene);
      } catch (err) {
        console.warn('cubeCam update failed:', err);
      } finally {
        water.visible = true;
        renderer.shadowMap.autoUpdate = true;
        cubeBaked = true;
      }
    }

    // Dynamic wave ripples on CPU in non-VR mode
    if (!renderer.xr.isPresenting && frame % 2 === 0) {
      const wpos = waterGeo.attributes.position;
      for (let i = 0; i < wpos.count; i++) {
        const x = wpos.getX(i), z = wpos.getZ(i);
        const w1 = x * 0.058 + z * 0.032 + t * 0.7;
        const w2 = x * 0.022 + z * 0.075 - t * 0.55;
        const w3 = (x * 0.04 - z * 0.045) + t * 0.4;
        wpos.setY(i,
          Math.sin(w1) * 0.065
        + Math.sin(w2) * 0.045
        + Math.cos(w3) * 0.035
        );
      }
      wpos.needsUpdate = true;
    }
  }

  return { water, waterGeo, cubeCam, updateWater, waterUniforms };
}
