import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.55, 0.62, 0.42).normalize();

export function setupEnvironment(scene) {
  // Fog
  scene.fog = new THREE.FogExp2(0xd9cdb8, 0.0045);

  // Atmospheric sky dome
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(480, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith:   { value: new THREE.Color(0x6f9fd4) },
        uHorizon:  { value: new THREE.Color(0xe9dcc2) },
        uSunColor: { value: new THREE.Color(0xfff0cc) },
        uSunDir:   { value: SUN_DIR }
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uZenith, uHorizon, uSunColor, uSunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.12, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunColor * (pow(s, 900.0) * 3.0 + pow(s, 10.0) * 0.22 + pow(s, 2.0) * 0.05);
          col = mix(col, uHorizon * 0.94, smoothstep(0.0, -0.12, h));
          gl_FragColor = vec4(col, 1.0);
        }`
    })
  );
  scene.add(sky);

  // Direct Sunlight
  const sun = new THREE.DirectionalLight(0xffecd0, 2.35);
  sun.position.copy(SUN_DIR).multiplyScalar(130);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -80;  sun.shadow.camera.right = 80;
  sun.shadow.camera.top  =  80;  sun.shadow.camera.bottom = -80;
  sun.shadow.camera.near = 30;   sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.5;
  scene.add(sun, sun.target);

  // Subtle ambient hemisphere: sky-fill with deep ground tone for dark, punchy shadows
  const hemi = new THREE.HemisphereLight(0x92b9e6, 0x182412, 0.22);
  scene.add(hemi);

  // Deep ambient floor to preserve maximum shadow darkness and depth
  const ambient = new THREE.AmbientLight(0x0c140e, 0.06);
  scene.add(ambient);

  return { sun, hemi, ambient, sky };
}
