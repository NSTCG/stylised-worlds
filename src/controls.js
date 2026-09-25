import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { groundHeight } from './terrain.js';

export function setupControls(camera, domElement, onTogglePostProcessing) {
  const controls = new OrbitControls(camera, domElement);
  controls.target.set(0, 2.6, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 5;
  controls.maxDistance = 70;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.45;
  domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; }, { once: true });

  let isWalkMode = false;
  const keys = { w: false, a: false, s: false, d: false, shift: false, space: false };
  const player = {
    pos: new THREE.Vector3(21, 5.5, 25),
    yaw: -2.3,
    pitch: -0.1,
    onGround: true,
    jumpVel: 0,
    eyeHeight: 1.72
  };

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') keys.w = true;
    if (k === 'a' || k === 'arrowleft') keys.a = true;
    if (k === 's' || k === 'arrowdown') keys.s = true;
    if (k === 'd' || k === 'arrowright') keys.d = true;
    if (e.key === 'Shift') keys.shift = true;
    if (e.key === ' ') { keys.space = true; e.preventDefault(); }
    if (k === 'v') toggleMode();
    if (k === 'p') onTogglePostProcessing?.();
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') keys.w = false;
    if (k === 'a' || k === 'arrowleft') keys.a = false;
    if (k === 's' || k === 'arrowdown') keys.s = false;
    if (k === 'd' || k === 'arrowright') keys.d = false;
    if (e.key === 'Shift') keys.shift = false;
    if (e.key === ' ') keys.space = false;
  });

  function setWalkMode(walk) {
    isWalkMode = walk;
    const btn = document.getElementById('modeBtn');
    const help = document.getElementById('hudHelp');
    if (isWalkMode) {
      controls.enabled = false;
      const px = camera.position.x, pz = camera.position.z;
      player.pos.set(px, Math.max(groundHeight(px, pz), 0) + player.eyeHeight, pz);
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      player.yaw = Math.atan2(-dir.x, -dir.z);
      player.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -0.85, 0.85));
      if (btn) { btn.textContent = '🔭 Orbit Mode (V)'; btn.style.background = 'rgba(76, 160, 62, 0.5)'; }
      if (help) help.innerHTML = 'WASD — walk &nbsp;·&nbsp; SHIFT — sprint &nbsp;·&nbsp; SPACE — jump &nbsp;·&nbsp; mouse — look &nbsp;·&nbsp; V — orbit &nbsp;·&nbsp; 🥽 VR: Ready';
      domElement.requestPointerLock?.();
    } else {
      document.exitPointerLock?.();
      controls.enabled = true;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      controls.target.copy(camera.position).addScaledVector(dir, 16);
      if (btn) { btn.textContent = '🚶 Walk Mode (V)'; btn.style.background = 'rgba(255,255,255,0.2)'; }
      if (help) help.innerHTML = 'WASD — pan &nbsp;·&nbsp; drag — orbit &nbsp;·&nbsp; wheel — zoom &nbsp;·&nbsp; V — walk &nbsp;·&nbsp; 🥽 VR: Ready';
    }
  }

  function toggleMode() {
    setWalkMode(!isWalkMode);
  }

  document.getElementById('modeBtn')?.addEventListener('click', toggleMode);

  let isMouseDown = false;
  domElement.addEventListener('pointerdown', () => {
    isMouseDown = true;
    if (isWalkMode && document.pointerLockElement !== domElement) {
      domElement.requestPointerLock?.();
    }
  });
  window.addEventListener('pointerup', () => { isMouseDown = false; });
  window.addEventListener('pointermove', (e) => {
    if (isWalkMode && (document.pointerLockElement === domElement || isMouseDown)) {
      player.yaw -= e.movementX * 0.0024;
      player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0024, -Math.PI * 0.44, Math.PI * 0.44);
    }
  });

  function updatePlayer(dt) {
    if (isWalkMode) {
      const moveX = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
      const moveZ = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
      if (moveX !== 0 || moveZ !== 0) {
        const spd = (keys.shift ? 11.5 : 5.4) * dt;
        const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
        const rgt = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
        const delta = fwd.multiplyScalar(-moveZ).addScaledVector(rgt, moveX).normalize().multiplyScalar(spd);
        player.pos.add(delta);
        const r = Math.hypot(player.pos.x, player.pos.z);
        if (r > 200) player.pos.setLength(200);
      }
      const gh = groundHeight(player.pos.x, player.pos.z);
      const floorY = Math.max(gh, -0.4) + player.eyeHeight;
      player.jumpVel -= 25 * dt;
      player.pos.y += player.jumpVel * dt;
      if (player.pos.y <= floorY) {
        player.pos.y = floorY;
        player.jumpVel = 0;
        player.onGround = true;
      }
      if (keys.space && player.onGround) {
        player.jumpVel = 8.5;
        player.onGround = false;
      }
      camera.position.copy(player.pos);
      camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    } else {
      // In Orbit mode, WASD smoothly navigates the camera / orbit target
      const moveX = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
      const moveZ = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
      if (moveX !== 0 || moveZ !== 0) {
        controls.autoRotate = false;
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        fwd.y = 0; fwd.normalize();
        const rgt = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
        const panSpd = (keys.shift ? 36 : 16) * dt;
        const delta = fwd.multiplyScalar(-moveZ).addScaledVector(rgt, moveX).normalize().multiplyScalar(panSpd);
        camera.position.add(delta);
        controls.target.add(delta);
      }
      controls.update();
    }
  }

  return {
    controls,
    player,
    isWalkMode: () => isWalkMode,
    setWalkMode,
    toggleMode,
    updatePlayer
  };
}
