import * as THREE from 'three';
import { windUniforms } from './wind.js';
import { setupEnvironment } from './environment.js';
import { createGround } from './terrain.js';
import { createWater } from './water.js';
import { createMountain } from './mountain.js';
import { buildTrees } from './trees.js';
import { buildGrass, updateGrass } from './grass.js';
import { buildRocks } from './rocks.js';
import { createFireflies } from './fireflies.js';
import { setupStats } from './stats.js';
import { setupPostProcessing } from './postfx.js';
import { setupControls } from './controls.js';
import { setupVR } from './vr.js';
import { setGroundBlendIntensity } from './groundBlend.js';

/* ---------------------------------------------------------- renderer & scene */
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);
camera.position.set(21, 5.5, 25);

window.scene = scene;
window.camera = camera;
window.renderer = renderer;

/* ---------------------------------------------------------- world modules */
const { updateEnvironment, envConfig } = setupEnvironment(scene);
createGround(scene);
const { updateWater } = createWater(scene);
createMountain(scene);
buildTrees(scene);
buildGrass(scene);
buildRocks(scene);
const { updateFireflies } = createFireflies(scene);

/* ---------------------------------------------------------- triangle stats tracker */
const { updateUI: updateTriStats } = setupStats(scene, renderer);

/* ---------------------------------------------------------- post-processing */
const { composer, isPostProcessingActive, togglePostProcessing } = setupPostProcessing(renderer, scene, camera);

/* ---------------------------------------------------------- controls & VR */
const { controls, player, isWalkMode, updatePlayer } = setupControls(camera, renderer.domElement, togglePostProcessing);
const { cameraRig, updateVR, recordFps } = setupVR(renderer, scene, camera, player, isWalkMode, controls);

window.player = player;
window.controls = controls;
window.cameraRig = cameraRig;

// Hook Ground Blend Slider
const groundBlendSlider = document.getElementById('groundBlendSlider');
if (groundBlendSlider) {
  groundBlendSlider.addEventListener('input', (e) => {
    setGroundBlendIntensity(Number(e.target.value));
  });
}

// Hook Day/Night Time Controls
const timeOfDaySlider = document.getElementById('timeOfDaySlider');
if (timeOfDaySlider) {
  timeOfDaySlider.addEventListener('input', (e) => {
    envConfig.timeOfDay = Number(e.target.value) / 100;
    updateEnvironment(clock.getElapsedTime(), 0);
    renderer.render(scene, camera);
  });
  timeOfDaySlider.addEventListener('pointerdown', () => { envConfig.autoCycle = false; });
  timeOfDaySlider.addEventListener('pointerup', () => { envConfig.autoCycle = true; });
}

const timeCycleBtn = document.getElementById('timeCycleBtn');
if (timeCycleBtn) {
  timeCycleBtn.addEventListener('click', () => {
    envConfig.autoCycle = !envConfig.autoCycle;
    timeCycleBtn.style.background = envConfig.autoCycle ? 'rgba(255,255,255,0.15)' : 'rgba(230,80,60,0.5)';
  });
}

/* ---------------------------------------------------------- main loop */
const clock = new THREE.Clock();
let frame = 0;
const _userPos = new THREE.Vector3();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.getElapsedTime();
  windUniforms.uTime.value = t;
  frame++;

  // Update dynamic Day / Night cycle (Sun, Moon, Stars, drifting Clouds, Fog, Lighting)
  updateEnvironment(t, dt);

  // Bake static shadow map on initial frames, then freeze for maximum Quest performance
  if (frame <= 3) {
    renderer.shadowMap.needsUpdate = true;
  }

  // Player locomotion (desktop walk / orbit)
  updatePlayer(dt);

  // VR locomotion & right-hand controller tracking
  updateVR(dt);

  // Update dynamic grass pool centered around exact world-space user position
  camera.getWorldPosition(_userPos);
  updateGrass(_userPos, t);

  // Animated elements
  updateFireflies(t);
  updateWater(t, frame, renderer);

  // Periodic triangle stats refresh
  if (frame % 60 === 0) {
    updateTriStats();
  }

  // FPS calculations
  recordFps();

  // Render dispatch (direct render for WebXR stereoscopic VR, or conditional composer on desktop)
  if (renderer.xr.isPresenting) {
    renderer.render(scene, camera);
  } else if (isPostProcessingActive()) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

renderer.setAnimationLoop(tick);

/* ---------------------------------------------------------- resize */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
