import * as THREE from 'three';

export const groundBlendUniforms = {
  uGroundBlendIntensity: { value: 0.65 },
  uGroundBlendDefaultColor: { value: new THREE.Color(0x3e7a2b) }
};

export function setGroundBlendIntensity(val) {
  const clamped = Math.max(0.0, Math.min(1.0, Number(val)));
  groundBlendUniforms.uGroundBlendIntensity.value = clamped;

  const label = document.getElementById('groundBlendVal');
  if (label) label.textContent = `${Math.round(clamped * 100)}%`;
  const slider = document.getElementById('groundBlendSlider');
  if (slider && Number(slider.value) !== clamped) slider.value = clamped;
}

export function addGroundBlend(material, options = {}) {
  const blendHeight = options.blendHeight || 1.20;
  const blendOffset = options.blendOffset || 0.0;
  const hasAttr = options.hasAttribute !== false;
  const normalBlend = options.normalBlend !== false;
  const fixedColor = options.fixedColor || null;

  const f = (n) => {
    const s = String(n);
    return s.includes('.') || s.includes('e') ? s : s + '.0';
  };

  const prev = material.onBeforeCompile || null;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);

    shader.uniforms.uGroundBlendIntensity = groundBlendUniforms.uGroundBlendIntensity;
    shader.uniforms.uGroundBlendDefaultColor = groundBlendUniforms.uGroundBlendDefaultColor;
    if (fixedColor) {
      shader.uniforms.uGroundBlendFixedColor = { value: fixedColor };
    }

    // 1. Vertex Shader Injection
    const vsHeader = `
      uniform float uGroundBlendIntensity;
      varying float vGroundBlendFactor;
      ${normalBlend ? 'varying vec3 vGroundNormal;' : ''}
      ${hasAttr ? 'attribute vec3 aTerrainColor; varying vec3 vGroundColor;' : ''}
    `;

    shader.vertexShader = vsHeader + shader.vertexShader;

    if (normalBlend) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        // Upward ground normal in view space for seamless lighting blend
        vGroundNormal = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));`
      );
    }

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        ${hasAttr ? 'vGroundColor = aTerrainColor;' : ''}
        // Local contact height above ground
        float contactH = max(0.0, position.y + ${f(blendOffset)});
        // Blend factor fades from 1.0 at base to 0.0 at blendHeight
        float rawFactor = 1.0 - smoothstep(0.0, ${f(blendHeight)}, contactH);
        vGroundBlendFactor = rawFactor * uGroundBlendIntensity;
      }`
    );

    // 2. Fragment Shader Injection
    const fsHeader = `
      uniform float uGroundBlendIntensity;
      uniform vec3 uGroundBlendDefaultColor;
      ${fixedColor ? 'uniform vec3 uGroundBlendFixedColor;' : ''}
      varying float vGroundBlendFactor;
      ${normalBlend ? 'varying vec3 vGroundNormal;' : ''}
      ${hasAttr ? 'varying vec3 vGroundColor;' : ''}
    `;

    shader.fragmentShader = fsHeader + shader.fragmentShader;

    if (normalBlend) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        if (!gl_FrontFacing) normal = -normal;
        // Soften normal towards ground normal at contact
        normal = normalize(mix(normal, vGroundNormal, vGroundBlendFactor * 0.70));`
      );
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        vec3 groundCol = ${hasAttr ? 'vGroundColor' : (fixedColor ? 'uGroundBlendFixedColor' : 'uGroundBlendDefaultColor')};
        // Seamlessly blend diffuse albedo into terrain ground color
        diffuseColor.rgb = mix(diffuseColor.rgb, groundCol, vGroundBlendFactor);
      }`
    );
  };
}
