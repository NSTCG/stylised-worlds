import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { groundHeight } from './terrain.js';
import { rotateGhost, scaleGhost, cancelPlacement, placementState } from './assetsManager.js';
import { inputState } from './touchControls.js';
import { saveLevelToStorage } from './levelSerializer.js';

export function setupControls(camera, domElement, onTogglePostProcessing) {
  const controls = new OrbitControls(camera, domElement);
  controls.target.set(0, 2.6, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 5;
  controls.maxDistance = 180;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.45;

  // Level Editor Mouse Configuration:
  // Right click to look around / orbit, Middle click strictly to pan, Left click reserved for drawing/interaction
  controls.mouseButtons = {
    LEFT: null,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE
  };
  controls.screenSpacePanning = true;
  controls.enablePan = true;

  // Direct Screen-Space Pan on Middle Mouse Button (guarantees 0% rotation)
  let isMiddlePanning = false;
  let prevPanX = 0, prevPanY = 0;

  domElement.addEventListener('pointerdown', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      // In Character Mode, middle mouse button does NOTHING
      if (!isInspectMode) return;
      isMiddlePanning = true;
      prevPanX = e.clientX;
      prevPanY = e.clientY;
      controls.enableRotate = false;
    }
  }, { capture: true });

  window.addEventListener('pointermove', (e) => {
    if (!isInspectMode && isMiddlePanning) {
      isMiddlePanning = false;
      return;
    }
    if (isMiddlePanning) {
      e.preventDefault();
      const dx = e.clientX - prevPanX;
      const dy = e.clientY - prevPanY;
      prevPanX = e.clientX;
      prevPanY = e.clientY;

      const camRight = new THREE.Vector3();
      const camUp = new THREE.Vector3();
      camera.matrixWorld.extractBasis(camRight, camUp, new THREE.Vector3());

      const dist = camera.position.distanceTo(controls.target);
      const factor = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) / Math.max(1, domElement.clientHeight);
      const panSpeed = Math.max(0.01, dist * factor);

      const offset = new THREE.Vector3()
        .addScaledVector(camRight, -dx * panSpeed)
        .addScaledVector(camUp, dy * panSpeed);

      camera.position.add(offset);
      controls.target.add(offset);
    }
  }, { capture: true });

  window.addEventListener('pointerup', (e) => {
    if (e.button === 1 || isMiddlePanning) {
      isMiddlePanning = false;
      controls.enableRotate = true;
    }
  }, { capture: true });

  domElement.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });
  domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  let isInspectMode = false;
  controls.isInspectMode = false;
  if (typeof window !== 'undefined') window.isInspectMode = false;

  const keys = { w: false, a: false, s: false, d: false, shift: false, space: false, c: false };
  const player = {
    pos: new THREE.Vector3(21, 5.5, 25),
    yaw: -2.3,
    pitch: -0.1,
    onGround: true,
    jumpVel: 0,
    eyeHeight: 1.72
  };

  window.addEventListener('keydown', (e) => {
    // Quick Save: Ctrl + S
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveLevelToStorage(window.envConfig);
      return;
    }

    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') keys.w = true;
    if (k === 'a' || k === 'arrowleft') keys.a = true;
    if (k === 's' || k === 'arrowdown') keys.s = true;
    if (k === 'd' || k === 'arrowright') keys.d = true;
    if (k === 'c') keys.c = true;
    if (e.key === 'Shift') keys.shift = true;
    if (e.key === ' ') { keys.space = true; e.preventDefault(); }
    if (k === 'v') toggleMode();
    if (k === 'p') onTogglePostProcessing?.();

    // Prop placement shortcuts
    if (placementState.active) {
      if (k === 'r') rotateGhost(Math.PI / 8);
      if (k === '[') scaleGhost(0.9);
      if (k === ']') scaleGhost(1.1);
      if (e.key === 'Escape') cancelPlacement();
    }
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') keys.w = false;
    if (k === 'a' || k === 'arrowleft') keys.a = false;
    if (k === 's' || k === 'arrowdown') keys.s = false;
    if (k === 'd' || k === 'arrowright') keys.d = false;
    if (k === 'c') keys.c = false;
    if (e.key === 'Shift') keys.shift = false;
    if (e.key === ' ') keys.space = false;
  });

  // Wheel to rotate prop during placement
  domElement.addEventListener('wheel', (e) => {
    if (placementState.active) {
      e.preventDefault();
      rotateGhost(e.deltaY > 0 ? 0.2 : -0.2);
    }
  }, { passive: false });

  function setInspectMode(inspect) {
    isInspectMode = inspect;
    controls.isInspectMode = inspect;
    if (typeof window !== 'undefined') window.isInspectMode = inspect;
    const btn = document.getElementById('modeBtn');
    const help = document.getElementById('hudHelp');

    if (isInspectMode) {
      // Detach camera from VRM character completely and stop character locomotion
      controls.enabled = true;
      if (window.vrmController) {
        window.vrmController.isMoving = false;
        window.vrmController.keys = { w: false, a: false, s: false, d: false, shift: false, space: false };
      }
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      controls.target.copy(camera.position).addScaledVector(dir, 8.0);
      if (btn) {
        btn.textContent = '👤 Character Mode (V)';
        btn.style.background = 'rgba(56, 189, 248, 0.45)';
      }
      if (help) {
        help.innerHTML = '🔭 Inspect: Right-drag — look/rotate &nbsp;·&nbsp; Middle-drag — pan &nbsp;·&nbsp; Scroll — zoom &nbsp;·&nbsp; V — character &nbsp;·&nbsp; 🥽 VR: Ready';
      }
    } else {
      // Re-attach camera to VRM Character Mode
      controls.enabled = false;
      if (window.vrmController) {
        // Sync orbit yaw with current camera orientation
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        window.vrmController.orbitYaw = Math.atan2(-camDir.x, -camDir.z);
      }
      if (btn) {
        btn.textContent = '🔭 Inspect Mode (V)';
        btn.style.background = 'rgba(76, 160, 62, 0.55)';
      }
      if (help) {
        help.innerHTML = '👤 Character: WASD — move &nbsp;·&nbsp; Drag — orbit &nbsp;·&nbsp; Scroll — 1st/3rd person &nbsp;·&nbsp; V — inspect &nbsp;·&nbsp; 🥽 VR: Ready';
      }
    }
  }

  function toggleMode() {
    setInspectMode(!isInspectMode);
  }

  document.getElementById('modeBtn')?.addEventListener('click', toggleMode);

  let isMouseDown = false;
  domElement.addEventListener('pointerdown', (e) => {
    if (e.button === 1) return; // Never rotate on middle mouse button
    isMouseDown = true;
    if (!isInspectMode && !window.vrmController?.vrm && document.pointerLockElement !== domElement) {
      domElement.requestPointerLock?.();
    }
  });
  window.addEventListener('pointerup', () => { isMouseDown = false; });
  window.addEventListener('pointermove', (e) => {
    if (!isInspectMode && !window.vrmController?.vrm && (document.pointerLockElement === domElement || isMouseDown)) {
      player.yaw -= e.movementX * 0.0024;
      player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0024, -Math.PI * 0.44, Math.PI * 0.44);
    }
  });

  function updatePlayer(dt) {
    if (controls.enabled) {
      // In Inspect Mode, WASD smoothly navigates the camera / orbit target
      const moveX = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
      const moveZ = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
      if (moveX !== 0 || moveZ !== 0) {
        controls.autoRotate = false;
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        fwd.y = 0;
        if (fwd.lengthSq() > 0.0001) fwd.normalize();
        else fwd.set(0, 0, -1);
        const rgt = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
        const panSpd = (keys.shift ? 36 : 16) * dt;
        const delta = fwd.multiplyScalar(-moveZ).addScaledVector(rgt, moveX).normalize().multiplyScalar(panSpd);
        camera.position.add(delta);
        controls.target.add(delta);
      }
      controls.update();
    } else if (!window.vrmController?.vrm) {
      // Fallback ground walk if VRM is not yet initialized
      const k = {
        w: keys.w || inputState.w,
        a: keys.a || inputState.a,
        s: keys.s || inputState.s,
        d: keys.d || inputState.d,
        shift: keys.shift || inputState.shift,
        space: keys.space || inputState.space
      };
      const moveX = (k.d ? 1 : 0) - (k.a ? 1 : 0);
      const moveZ = (k.s ? 1 : 0) - (k.w ? 1 : 0);
      if (moveX !== 0 || moveZ !== 0) {
        const spd = (k.shift ? 11.5 : 5.4) * dt;
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
      if (k.space && player.onGround) {
        player.jumpVel = 8.5;
        player.onGround = false;
      }
      camera.position.copy(player.pos);
      camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    }
  }

  return {
    controls,
    player,
    isInspectMode: () => isInspectMode,
    isWalkMode: () => !isInspectMode,
    toggleMode,
    setInspectMode,
    setWalkMode: (walk) => setInspectMode(!walk),
    updatePlayer
  };
}
