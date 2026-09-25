import * as THREE from 'three';

// Install Directional Atmospheric In-Scattering Fog into Three.js ShaderChunks
THREE.ShaderChunk.fog_pars_vertex = `
  #ifdef USE_FOG
    varying float vFogDepth;
    varying vec3 vAtmosphereViewDir;
  #endif
`;

THREE.ShaderChunk.fog_vertex = `
  #ifdef USE_FOG
    vFogDepth = - mvPosition.z;
    vAtmosphereViewDir = vec3(
      dot(viewMatrix[0].xyz, mvPosition.xyz),
      dot(viewMatrix[1].xyz, mvPosition.xyz),
      dot(viewMatrix[2].xyz, mvPosition.xyz)
    );
  #endif
`;

THREE.ShaderChunk.fog_pars_fragment = `
  #ifdef USE_FOG
    uniform vec3 fogColor;
    varying float vFogDepth;
    varying vec3 vAtmosphereViewDir;
    #ifdef FOG_EXP2
      uniform float fogDensity;
    #else
      uniform float fogNear;
      uniform float fogFar;
    #endif
    uniform vec3 uAtmoSunDir;
    uniform vec3 uAtmoMoonDir;
    uniform vec3 uAtmoZenith;
    uniform vec3 uAtmoHorizon;
    uniform vec3 uAtmoSunColor;
    uniform vec3 uAtmoMoonColor;
  #endif
`;

THREE.ShaderChunk.fog_fragment = `
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif

    vec3 dirFogColor = fogColor;
    if (dot(vAtmosphereViewDir, vAtmosphereViewDir) > 0.0001) {
      vec3 d = normalize(vAtmosphereViewDir);
      float h = clamp(d.y * 1.5 + 0.15, 0.0, 1.0);
      dirFogColor = mix(uAtmoHorizon, uAtmoZenith, pow(h, 0.52));

      // Directional forward scattering towards Sun
      float sDot = dot(d, uAtmoSunDir);
      if (sDot > 0.0 && uAtmoSunDir.y > -0.18) {
        float sunGlow = pow(sDot, 20.0) * 0.45 + pow(sDot, 3.5) * 0.12;
        dirFogColor += uAtmoSunColor * sunGlow * smoothstep(-0.18, 0.15, uAtmoSunDir.y);
      }

      // Directional forward scattering towards Moon
      float mDot = dot(d, uAtmoMoonDir);
      if (mDot > 0.0 && uAtmoMoonDir.y > -0.18) {
        float moonGlow = pow(mDot, 16.0) * 0.28 + pow(mDot, 2.8) * 0.06;
        dirFogColor += uAtmoMoonColor * moonGlow * smoothstep(-0.18, 0.15, uAtmoMoonDir.y);
      }
    }

    gl_FragColor.rgb = mix( gl_FragColor.rgb, dirFogColor, fogFactor );
  #endif
`;

export const envConfig = {
  cycleDuration: 120.0, // seconds for a full 24h day/night cycle
  autoCycle: true,
  timeOfDay: 0.45, // 0.0 = midnight (00:00), 0.25 = sunrise (06:00), 0.50 = noon (12:00), 0.75 = sunset (18:00)
  sunIntensity: 2.35,
  moonIntensity: 0.18, // Reduced bright moonlight from 0.65 to 0.18 for realistic moody night GI
  fogBaseDensity: 0.0125 // Increased atmospheric fog (~3x denser than before)
};

export const envUniforms = {
  uTime:       { value: 0 },
  uSunDir:     { value: new THREE.Vector3(0.55, 0.62, 0.42).normalize() },
  uMoonDir:    { value: new THREE.Vector3(-0.55, -0.62, -0.42).normalize() },
  uZenith:     { value: new THREE.Color(0x6f9fd4) },
  uHorizon:    { value: new THREE.Color(0xe9dcc2) },
  uSunColor:   { value: new THREE.Color(0xfff0cc) },
  uMoonColor:  { value: new THREE.Color(0xcae2ff) },
  uCloudColor: { value: new THREE.Color(0xffffff) },
  uDayFactor:  { value: 1.0 } // 1.0 = full day, 0.0 = full night
};

export function setupEnvironment(scene) {
  // Fog (dynamically updated to match horizon color and atmospheric density)
  const fog = new THREE.FogExp2(0xd9cdb8, envConfig.fogBaseDensity);
  scene.fog = fog;

  // Atmospheric Sky Dome with Sun, Moon, Stars, and Drifting Clouds
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime:       envUniforms.uTime,
      uSunDir:     envUniforms.uSunDir,
      uMoonDir:    envUniforms.uMoonDir,
      uZenith:     envUniforms.uZenith,
      uHorizon:    envUniforms.uHorizon,
      uSunColor:   envUniforms.uSunColor,
      uMoonColor:  envUniforms.uMoonColor,
      uCloudColor: envUniforms.uCloudColor,
      uDayFactor:  envUniforms.uDayFactor
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uMoonDir;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSunColor;
      uniform vec3 uMoonColor;
      uniform vec3 uCloudColor;
      uniform float uDayFactor;

      varying vec3 vDir;

      // Fast 2D hash & value noise for clouds and stars
      float hash2(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash2(i + vec2(0.0, 0.0)), hash2(i + vec2(1.0, 0.0)), u.x),
          mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      float cloudFbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * vnoise(p);
          p *= 2.15;
          a *= 0.48;
        }
        return v;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.15, 1.0);

        // 1. Sky Gradient (Zenith to Horizon)
        vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.52));

        // 2. Stars (Visible at Night when looking upwards)
        if (uDayFactor < 0.85 && d.y > 0.05) {
          vec2 starCoord = d.xz / (d.y + 0.40) * 180.0;
          float starVal = hash2(floor(starCoord));
          if (starVal > 0.985) {
            float twinkle = sin(uTime * 4.0 + starVal * 62.8) * 0.5 + 0.5;
            float starIntensity = pow((starVal - 0.985) / 0.015, 2.0) * twinkle * (1.0 - uDayFactor) * smoothstep(0.05, 0.4, d.y);
            col += vec3(0.85, 0.92, 1.0) * starIntensity * 1.8;
          }
        }

        // 3. Sun Disk & Golden Corona Glow
        float sDot = dot(d, uSunDir);
        if (sDot > 0.0 && uSunDir.y > -0.15) {
          float sunDisc = smoothstep(0.9992, 0.9998, sDot);
          float sunCorona = pow(sDot, 700.0) * 2.8 + pow(sDot, 24.0) * 0.28 + pow(sDot, 3.0) * 0.06;
          vec3 sunGlow = uSunColor * (sunDisc * 4.0 + sunCorona);
          col += sunGlow * smoothstep(-0.15, 0.15, uSunDir.y);
        }

        // 4. Moon Disk & Silver Halo
        float mDot = dot(d, uMoonDir);
        if (mDot > 0.0 && uMoonDir.y > -0.15) {
          float moonDisc = smoothstep(0.9988, 0.9996, mDot);
          // Subtle lunar surface contrast
          vec2 moonUv = d.xz * 12.0;
          float moonDetail = 0.85 + 0.15 * vnoise(moonUv);
          float moonHalo = pow(mDot, 400.0) * 0.9 + pow(mDot, 12.0) * 0.14;
          vec3 moonGlow = uMoonColor * (moonDisc * 2.2 * moonDetail + moonHalo);
          col += moonGlow * smoothstep(-0.15, 0.15, uMoonDir.y);
        }

        // 5. Procedural Drifting Clouds
        if (d.y > 0.02) {
          // Perspective projection onto cloud plane
          vec2 cloudPlane = (d.xz / (d.y + 0.18)) * 0.55;
          vec2 windDrift = vec2(uTime * 0.012, uTime * 0.007);
          vec2 cloudCoord = cloudPlane + windDrift;

          float density = cloudFbm(cloudCoord);
          float cloudMask = smoothstep(0.48, 0.76, density) * smoothstep(0.02, 0.25, d.y);

          if (cloudMask > 0.01) {
            // Sun & Moon directional shading across cloud puffs
            vec3 sunLitCloud = mix(uCloudColor * 0.65, uSunColor * 1.15, clamp(sDot * 0.5 + 0.5, 0.0, 1.0));
            vec3 moonLitCloud = mix(vec3(0.12, 0.16, 0.25), uMoonColor * 0.70, clamp(mDot * 0.5 + 0.5, 0.0, 1.0));
            vec3 activeCloudColor = mix(moonLitCloud, sunLitCloud, uDayFactor);

            // Cloud edge shading and puff density
            col = mix(col, activeCloudColor, cloudMask * 0.82);
          }
        }

        // 6. Horizon atmospheric blend
        col = mix(col, uHorizon * 0.96, smoothstep(0.04, -0.15, h));

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 32, 16), skyMat);
  sky.name = 'sky_dome';
  scene.add(sky);

  // Directional Light (Primary Sun/Moon Light)
  const dirLight = new THREE.DirectionalLight(0xffecd0, envConfig.sunIntensity);
  dirLight.name = 'celestial_light';
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.left = -80;  dirLight.shadow.camera.right = 80;
  dirLight.shadow.camera.top  =  80;  dirLight.shadow.camera.bottom = -80;
  dirLight.shadow.camera.near = 30;   dirLight.shadow.camera.far = 300;
  dirLight.shadow.bias = -0.0004;
  dirLight.shadow.normalBias = 0.5;
  scene.add(dirLight, dirLight.target);

  // Ambient & Hemisphere Lights
  const hemi = new THREE.HemisphereLight(0x92b9e6, 0x182412, 0.22);
  hemi.name = 'hemi_light';
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0x0c140e, 0.06);
  ambient.name = 'ambient_light';
  scene.add(ambient);

  // Reusable Color Buffers
  const cZenithDay   = new THREE.Color(0x5a94d8);
  const cZenithSun   = new THREE.Color(0x3d2b63); // Sunset deep violet
  const cZenithNight = new THREE.Color(0x05122e); // Rich deep indigo blue

  const cHorizonDay   = new THREE.Color(0xe8d8be);
  const cHorizonSun   = new THREE.Color(0xed6834); // Fiery golden amber
  const cHorizonNight = new THREE.Color(0x091b3b); // Atmospheric midnight blue horizon

  const cSunDay = new THREE.Color(0xfff0cc);
  const cSunSet = new THREE.Color(0xff7733);

  // Cinematic moonlight blue
  const cMoonLight = new THREE.Color(0x4a82cf); // Rich environmental blue tint
  const cFogDay    = new THREE.Color(0xd9cdb8);
  const cFogSun    = new THREE.Color(0x8a4d3b);
  const cFogNight  = new THREE.Color(0x08152e);

  function updateEnvironment(t, dt = 0.016) {
    envUniforms.uTime.value = t;

    // Advance time of day
    if (envConfig.autoCycle && envConfig.cycleDuration > 0) {
      envConfig.timeOfDay = (envConfig.timeOfDay + dt / envConfig.cycleDuration) % 1.0;
    }

    // Solar angle: 0.0 = midnight (00:00), 0.25 = sunrise (06:00), 0.50 = noon (12:00), 0.75 = sunset (18:00)
    const phi = (envConfig.timeOfDay - 0.25) * Math.PI * 2.0;
    const sunX = -Math.cos(phi) * 0.85;
    const sunY = Math.sin(phi);
    const sunZ = Math.cos(phi * 0.5) * 0.42;

    envUniforms.uSunDir.value.set(sunX, sunY, sunZ).normalize();
    envUniforms.uMoonDir.value.copy(envUniforms.uSunDir.value).negate();

    // Day/Night and Twilight blend factors
    const sunElevation = sunY;
    const dayFactor = THREE.MathUtils.clamp((sunElevation + 0.12) / 0.35, 0.0, 1.0);
    const sunsetFactor = Math.exp(-Math.pow(sunElevation * 6.5, 2.0)); // Peak at horizon
    envUniforms.uDayFactor.value = dayFactor;

    // Interpolate Sky Zenith & Horizon
    envUniforms.uZenith.value.copy(cZenithNight).lerp(cZenithDay, dayFactor).lerp(cZenithSun, sunsetFactor * 0.7);
    envUniforms.uHorizon.value.copy(cHorizonNight).lerp(cHorizonDay, dayFactor).lerp(cHorizonSun, sunsetFactor * 0.95);

    // Interpolate Sun Color & Corona
    envUniforms.uSunColor.value.copy(cSunDay).lerp(cSunSet, sunsetFactor);

    // Dynamic Environmental Adaptive Fog
    // 1. Fog Color: Seamlessly matches the horizon sky color, infused with celestial in-scattering
    fog.color.copy(envUniforms.uHorizon.value);
    if (sunsetFactor > 0.05) {
      // Warm golden/amber in-scattering at sunset and dawn
      fog.color.lerp(envUniforms.uSunColor.value, sunsetFactor * 0.35);
    } else if (dayFactor < 0.25) {
      // Cool silver lunar in-scattering under the moonlight
      fog.color.lerp(envUniforms.uMoonColor.value, (1.0 - dayFactor) * 0.20);
    }

    // 2. Fog Density: Naturally adapts to the forest microclimate & time of day
    // - Early morning ground dew & mist (peaks around 06:00 - 07:00 AM)
    const morningMist = Math.exp(-Math.pow((envConfig.timeOfDay - 0.27) * 16.0, 2.0));
    // - Nighttime cool ground radiation fog
    const nightMist = Math.max(0.0, 1.0 - dayFactor);
    // - Golden hour atmospheric aerosol haze
    const sunsetHaze = sunsetFactor * 0.35;
    // - Subtle organic living atmospheric breathing
    const atmosphericBreathe = Math.sin(t * 0.12) * 0.05;

    const envDensityMultiplier = 1.0 + 0.45 * morningMist + 0.35 * nightMist + 0.25 * sunsetHaze + atmosphericBreathe;
    fog.density = envConfig.fogBaseDensity * envDensityMultiplier;

    // Directional Celestial Light (Transitions from Sun to Moon smoothly)
    if (sunElevation > -0.05) {
      // Day Sun
      dirLight.position.copy(envUniforms.uSunDir.value).multiplyScalar(130);
      dirLight.color.copy(cSunDay).lerp(cSunSet, sunsetFactor);
      dirLight.intensity = Math.max(0.05, envConfig.sunIntensity * dayFactor);
    } else {
      // Night Moon: Soft moody moonlight with rich blue hue
      dirLight.position.copy(envUniforms.uMoonDir.value).multiplyScalar(130);
      dirLight.color.copy(cMoonLight);
      const moonFactor = THREE.MathUtils.clamp((-sunElevation) / 0.5, 0.0, 1.0);
      dirLight.intensity = envConfig.moonIntensity * moonFactor;
    }

    // Hemisphere & Ambient Light Modulation (Reduced Night GI + Rich Environmental Blue Tint)
    // Night sky hemilight: deep midnight blue (0x122a5c)
    // Night ground hemilight: dark midnight navy/ground (0x030814)
    hemi.color.copy(new THREE.Color(0x122a5c)).lerp(new THREE.Color(0x92b9e6), dayFactor);
    hemi.groundColor.copy(new THREE.Color(0x030814)).lerp(new THREE.Color(0x182412), dayFactor);
    // Reduced night GI intensity: 0.022 at night, up to 0.26 during the day
    hemi.intensity = 0.022 + 0.238 * dayFactor;

    // Ambient light: environmental blue tint (0x081836) at night
    ambient.color.copy(new THREE.Color(0x081836)).lerp(new THREE.Color(0x0c140e), dayFactor);
    // Reduced night ambient intensity: 0.010 at night, up to 0.07 during the day
    ambient.intensity = 0.010 + 0.060 * dayFactor;

    // Update HUD time of day slider if present
    const timeSlider = document.getElementById('timeOfDaySlider');
    if (timeSlider && !timeSlider.matches(':active')) {
      timeSlider.value = Math.round(envConfig.timeOfDay * 100);
    }
    const timeVal = document.getElementById('timeOfDayVal');
    if (timeVal) {
      const hours = Math.floor(envConfig.timeOfDay * 24);
      const mins = Math.floor((envConfig.timeOfDay * 24 - hours) * 60);
      const hh = String(hours).padStart(2, '0');
      const mm = String(mins).padStart(2, '0');
      const icon = dayFactor > 0.4 ? '☀️' : (sunsetFactor > 0.4 ? '🌅' : '🌙');
      timeVal.textContent = `${icon} ${hh}:${mm}`;
    }

    // Update HUD fog display if present
    const fogVal = document.getElementById('fogDensityVal');
    if (fogVal) {
      fogVal.textContent = (fog.density * 100).toFixed(1) + '%';
    }
  }

  // Initial update
  updateEnvironment(0, 0);

  return {
    sun: dirLight,
    hemi,
    ambient,
    sky,
    fog,
    envConfig,
    updateEnvironment
  };
}

export function applyAtmosphericFog(material) {
  if (!material) return;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uAtmoSunDir   = envUniforms.uSunDir;
    shader.uniforms.uAtmoMoonDir  = envUniforms.uMoonDir;
    shader.uniforms.uAtmoZenith   = envUniforms.uZenith;
    shader.uniforms.uAtmoHorizon  = envUniforms.uHorizon;
    shader.uniforms.uAtmoSunColor = envUniforms.uSunColor;
    shader.uniforms.uAtmoMoonColor = envUniforms.uMoonColor;
  };
  material.needsUpdate = true;
}

export function hookAtmosphericFogToScene(scene) {
  scene.traverse(obj => {
    if (obj.isMesh && obj.material && obj.name !== 'sky_dome') {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        applyAtmosphericFog(m);
      }
    }
  });
}
