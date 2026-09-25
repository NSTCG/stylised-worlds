import * as THREE from 'three';
import { windUniforms } from './wind.js';
import { envUniforms } from './environment.js';
import { groundHeight, WATER_Y } from './terrain.js';

function addWaterScroll(material) {
  const prev = material.onBeforeCompile || null;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uDayFactor = envUniforms.uDayFactor;
    shader.uniforms.uMoonDir = envUniforms.uMoonDir;
    shader.uniforms.uMoonColor = envUniforms.uMoonColor;
    shader.uniforms.uHorizon = envUniforms.uHorizon;

    shader.vertexShader = `
      attribute float aDepth;
      varying float vDepth;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vDepth = aDepth;`
    );
    shader.fragmentShader = `
      varying float vDepth;
    ` + shader.fragmentShader
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
        // Soft shoreline alpha fade: fades water to transparent where it touches terrain
        gl_FragColor.a *= smoothstep(0.01, 0.55, vDepth);`
      )
      .replace(
        'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;',
        `float shadowVal = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
        // Soften shadow cast on water: very low shadow intensity (translucent water in-scattering)
        directLight.color *= mix(0.82, 1.0, shadowVal);`
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

  // Vertex depth attribute for shoreline blending
  const pos = waterGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const depths = new Float32Array(pos.count);
  const cShallow = new THREE.Color(0x35b3aa);
  const cDeep    = new THREE.Color(0x0e3f60);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const depth = Math.max(0, WATER_Y - groundHeight(x, z));
    depths[i] = depth;
    c.copy(cDeep).lerp(cShallow, 1 - THREE.MathUtils.smoothstep(depth, 0.5, 9));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  waterGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  waterGeo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));

  const waterMat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.82,
    shininess: 160,
    specular: 0x9fd4ff,
    envMap: cubeRT.texture,
    reflectivity: 0.5,
    side: THREE.DoubleSide
  });
  addWaterScroll(waterMat);

  const water = new THREE.Mesh(waterGeo, waterMat);
  water.name = 'water_plane';
  water.position.y = WATER_Y;
  water.receiveShadow = true;
  scene.add(water);

  let cubeBaked = false;

  function updateWater(t, frame, renderer) {
    // Bake the sky & mountain reflection cubemap once on first frame
    if (!cubeBaked) {
      water.visible = false;
      renderer.shadowMap.autoUpdate = false;
      cubeCam.update(renderer, scene);
      water.visible = true;
      renderer.shadowMap.autoUpdate = true;
      cubeBaked = true;
    }

    // Dynamic wave normals are 100% computed on GPU in fragment shader via addWaterScroll.
    // In VR, bypass expensive CPU vertex loops to maximize Quest performance:
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

  return { water, waterGeo, cubeCam, updateWater };
}
