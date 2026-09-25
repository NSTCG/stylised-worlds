import * as THREE from 'three';

export const windUniforms = { uTime: { value: 0 } };

export function addWind(material, strength, phaseScale = 1) {
  const f = (n) => {
    const s = String(n);
    return s.includes('.') || s.includes('e') ? s : s + '.0';
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec3 ip = instanceMatrix[3].xyz;
        float ph = (ip.x * 0.37 + ip.z * 0.43) * ${f(phaseScale)};
        float w = sin(uTime * 1.1 + ph) + 0.5 * sin(uTime * 2.7 + ph * 1.7);
        float bend = max(transformed.y, 0.0) * ${f(strength)};
        transformed.x += w * bend;
        transformed.z += cos(uTime * 0.8 + ph * 1.3) * bend * 0.7;
      }`
    );
  };
}
