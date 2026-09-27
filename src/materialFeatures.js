/**
 * src/materialFeatures.js
 * Advanced Stylized Terrain Integration for 3D Models:
 * - Full Atmospheric In-Scattering Directional Fog
 * - Terrain Contact Ground Blending:
 *     - Smooth Base Color transition into live terrain albedo (grass, sand, road, rock)
 *     - Normal vector smoothing towards ground plane normal (eliminates hard seams)
 */
import * as THREE from 'three';
import { envUniforms } from './environment.js';
import { getTerrainDataTexture, TERRAIN_BOUNDS } from './terrain.js';

export function applyGroundBlendingAndFog(material, options = {}) {
  if (!material) return;

  // Atmospheric fog applies to all standard and custom materials with fog support
  material.fog = true;

  // Ground blending hooks are designed for standard Three.js PBR materials (Standard, Physical, Lambert, Phong)
  const isPbr = material.isMeshStandardMaterial || material.isMeshPhysicalMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial;
  if (!isPbr) return;

  const blendDistance = options.blendDistance ?? 0.38; // Transition distance in meters
  const blendStrength = options.blendStrength ?? 0.85; // Max albedo blend amount
  const normalBlend   = options.normalBlend   ?? 0.65; // Max normal tilt towards ground normal

  material.fog = true;
  const prev = material.onBeforeCompile || null;

  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);

    // 1. Atmospheric Sky & Sun/Moon Fog Uniforms
    shader.uniforms.uAtmoSunDir   = envUniforms.uSunDir;
    shader.uniforms.uAtmoMoonDir  = envUniforms.uMoonDir;
    shader.uniforms.uAtmoZenith   = envUniforms.uZenith;
    shader.uniforms.uAtmoHorizon  = envUniforms.uHorizon;
    shader.uniforms.uAtmoSunColor = envUniforms.uSunColor;
    shader.uniforms.uAtmoMoonColor = envUniforms.uMoonColor;

    // 2. Terrain Data & Ground Blending Uniforms
    shader.uniforms.uTerrainDataMap = { value: getTerrainDataTexture() };
    shader.uniforms.uTerrainBounds  = { value: TERRAIN_BOUNDS };
    shader.uniforms.uGroundBlendDistance = { value: blendDistance };
    shader.uniforms.uGroundBlendStrength = { value: blendStrength };
    shader.uniforms.uGroundNormalBlend   = { value: normalBlend };

    // 3. Vertex Shader: Export World Position
    shader.vertexShader = `
      varying vec3 vGroundBlendWorldPos;
    ` + shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vGroundBlendWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    );

    // 4. Fragment Shader: Sample Terrain & Apply Seamless Contact Blend
    shader.fragmentShader = `
      uniform sampler2D uTerrainDataMap;
      uniform vec4 uTerrainBounds;
      uniform float uGroundBlendDistance;
      uniform float uGroundBlendStrength;
      uniform float uGroundNormalBlend;
      varying vec3 vGroundBlendWorldPos;
    ` + shader.fragmentShader;

    // Inject Normal vector blending
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
      {
        vec2 terrainUV = (vGroundBlendWorldPos.xz - uTerrainBounds.xy) / uTerrainBounds.zw;
        vec4 terrainSample = texture2D(uTerrainDataMap, clamp(terrainUV, 0.0, 1.0));
        float groundH = terrainSample.r;
        float hDist = vGroundBlendWorldPos.y - groundH;
        float blendFactor = 1.0 - smoothstep(0.0, uGroundBlendDistance, max(0.0, hDist));
        blendFactor = clamp(blendFactor * uGroundBlendStrength, 0.0, 1.0);

        // Smooth normal towards terrain up vector to soften hard mesh intersections
        normal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), blendFactor * uGroundNormalBlend));
      }`
    );

    // Inject Base Color blending
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        vec2 terrainUV = (vGroundBlendWorldPos.xz - uTerrainBounds.xy) / uTerrainBounds.zw;
        vec4 terrainSample = texture2D(uTerrainDataMap, clamp(terrainUV, 0.0, 1.0));
        float groundH = terrainSample.r;
        vec3 groundColor = terrainSample.gba;
        float hDist = vGroundBlendWorldPos.y - groundH;
        float blendFactor = 1.0 - smoothstep(0.0, uGroundBlendDistance, max(0.0, hDist));
        blendFactor = clamp(blendFactor * uGroundBlendStrength, 0.0, 1.0);

        // Seamless base color gradient blend into terrain albedo
        diffuseColor.rgb = mix(diffuseColor.rgb, groundColor, blendFactor);
      }`
    );
  };

  material.needsUpdate = true;
}

/**
 * Traverses a 3D object / hierarchy and applies atmospheric fog & ground blending to all materials
 */
export function setupModelMaterials(object, options = {}) {
  if (!object) return;
  object.traverse((child) => {
    if (child.isMesh && child.material) {
      child.castShadow = true;
      child.receiveShadow = true;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        applyGroundBlendingAndFog(m, options);
      }
    }
  });
}
