import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { groundHeight } from './terrain.js';
import { grassConfig } from './grass.js';

export function setupVR(renderer, scene, camera, player, getIsWalkMode, controls) {
  renderer.xr.enabled = true;

  // Append styled VR Button
  const vrBtn = VRButton.createButton(renderer);
  vrBtn.style.position = 'fixed';
  vrBtn.style.bottom = '14px';
  vrBtn.style.right = '16px';
  vrBtn.style.left = 'auto';
  vrBtn.style.padding = '8px 18px';
  vrBtn.style.borderRadius = '20px';
  vrBtn.style.background = 'rgba(76, 160, 62, 0.9)';
  vrBtn.style.border = '1px solid rgba(255,255,255,0.4)';
  vrBtn.style.color = '#fff';
  vrBtn.style.font = 'bold 12px monospace';
  vrBtn.style.backdropFilter = 'blur(6px)';
  vrBtn.style.zIndex = '999';
  vrBtn.style.boxShadow = '0 4px 14px rgba(0,0,0,0.5)';
  document.body.appendChild(vrBtn);

  // Camera rig for WebXR world positioning and locomotion
  const cameraRig = new THREE.Group();
  cameraRig.position.set(0, 0, 0);
  scene.add(cameraRig);
  cameraRig.add(camera);

  // VR Controllers & Grips
  const controller0 = renderer.xr.getController(0);
  const controller1 = renderer.xr.getController(1);
  const controllerGrip0 = renderer.xr.getControllerGrip(0);
  const controllerGrip1 = renderer.xr.getControllerGrip(1);
  cameraRig.add(controller0, controller1, controllerGrip0, controllerGrip1);

  // Controller guide pointer beams
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x7ef088, transparent: true, opacity: 0.5 });
  const beamGeo = new THREE.CylinderGeometry(0.002, 0.002, 0.4).rotateX(Math.PI / 2).translate(0, 0, -0.2);
  controller0.add(new THREE.Mesh(beamGeo, beamMat));
  controller1.add(new THREE.Mesh(beamGeo, beamMat));

  // Right-hand wrist FPS display
  const rightHandGroup = new THREE.Group();
  rightHandGroup.visible = false;
  scene.add(rightHandGroup);

  const cvFps = document.createElement('canvas');
  cvFps.width = 512; cvFps.height = 256;
  const cxFps = cvFps.getContext('2d');
  const fpsTex = new THREE.CanvasTexture(cvFps);
  fpsTex.colorSpace = THREE.SRGBColorSpace;

  const fpsPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.09),
    new THREE.MeshBasicMaterial({ map: fpsTex, transparent: true, side: THREE.DoubleSide })
  );
  // Angled on right wrist facing user eye
  fpsPanel.position.set(0, 0.065, -0.04);
  fpsPanel.rotation.x = -Math.PI * 0.35;
  rightHandGroup.add(fpsPanel);

  function updateFpsCanvas(fps, ms) {
    cxFps.clearRect(0, 0, 512, 256);
    cxFps.fillStyle = 'rgba(10, 16, 12, 0.92)';
    cxFps.beginPath();
    cxFps.roundRect(10, 10, 492, 236, 28);
    cxFps.fill();
    cxFps.strokeStyle = '#4ca03e';
    cxFps.lineWidth = 5;
    cxFps.stroke();

    cxFps.font = 'bold 26px monospace';
    cxFps.fillStyle = '#8ee09a';
    cxFps.fillText('QUEST VR MONITOR', 36, 54);

    cxFps.font = 'bold 78px monospace';
    if (fps >= 85) cxFps.fillStyle = '#4ef05a';
    else if (fps >= 70) cxFps.fillStyle = '#8ee09a';
    else if (fps >= 55) cxFps.fillStyle = '#f0d04e';
    else cxFps.fillStyle = '#f05a4e';
    cxFps.fillText(`${Math.round(fps)} FPS`, 36, 138);

    cxFps.font = '24px monospace';
    cxFps.fillStyle = '#ffffff';
    const kCount = (grassConfig.currentCount / 1000).toFixed(0);
    const rVal = Math.round(grassConfig.currentRadius);
    const triStr = window.totalSceneTriangles ? ` · ${(window.totalSceneTriangles / 1000).toFixed(0)}k TRIS` : '';
    cxFps.fillText(`${ms.toFixed(1)}ms · GRASS: ${kCount}k (${rVal}m)${triStr}`, 36, 185);

    cxFps.font = '21px monospace';
    cxFps.fillStyle = 'rgba(220, 240, 210, 0.75)';
    cxFps.fillText('L-STICK: Move (Head-Rel) · R-STICK: Turn', 36, 224);

    fpsTex.needsUpdate = true;
  }
  updateFpsCanvas(90, 11.1);

  function bindControllerEvents(controller, grip) {
    controller.addEventListener('connected', (e) => {
      if (e.data.handedness === 'right') {
        grip.add(rightHandGroup);
        rightHandGroup.position.set(0, 0, 0);
        rightHandGroup.visible = true;
      }
    });
  }
  bindControllerEvents(controller0, controllerGrip0);
  bindControllerEvents(controller1, controllerGrip1);

  renderer.xr.setFoveation(1.0); // Maximum fixed foveation (1.0 = maximum peripheral VRS for Quest)

  renderer.xr.addEventListener('sessionstart', () => {
    controls.enabled = false;
    renderer.xr.setFoveation(1.0);
    const session = renderer.xr.getSession();
    if (session) {
      // Set target framerate to 90 FPS for Quest
      if (session.updateTargetFrameRate) {
        if (session.supportedFrameRates) {
          const rates = Array.from(session.supportedFrameRates);
          const rate90 = rates.find(r => Math.round(r) === 90);
          const rate72 = rates.find(r => Math.round(r) === 72);
          const rate60 = rates.find(r => Math.round(r) === 60);
          if (rate90) {
            session.updateTargetFrameRate(rate90).catch(() => {});
          } else if (rate72) {
            session.updateTargetFrameRate(rate72).catch(() => {});
          } else if (rate60) {
            session.updateTargetFrameRate(rate60).catch(() => {});
          }
        } else {
          session.updateTargetFrameRate(90).catch(() => {});
        }
      }
      try {
        if (session.renderState?.baseLayer && 'fixedFoveation' in session.renderState.baseLayer) {
          session.renderState.baseLayer.fixedFoveation = 1.0;
        }
        if (session.renderState?.layers) {
          for (const layer of session.renderState.layers) {
            if (layer && 'fixedFoveation' in layer) layer.fixedFoveation = 1.0;
          }
        }
      } catch (e) {}
    }

    if (getIsWalkMode()) {
      cameraRig.position.copy(player.pos);
    } else {
      cameraRig.position.copy(camera.position);
    }
    const gh = groundHeight(cameraRig.position.x, cameraRig.position.z);
    cameraRig.position.y = Math.max(gh, 0.2);
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
  });

  renderer.xr.addEventListener('sessionend', () => {
    controls.enabled = !getIsWalkMode();
    camera.position.copy(cameraRig.position).add(new THREE.Vector3(0, 1.72, 0));
    cameraRig.position.set(0, 0, 0);
  });

  // Real-time FPS tracker
  let fpsFrames = 0;
  let fpsLastTime = performance.now();
  let smoothedFps = 60;
  let smoothedMs = 16.6;

  function recordFps() {
    fpsFrames++;
    const now = performance.now();
    const elapsed = now - fpsLastTime;
    if (elapsed >= 250) {
      smoothedFps = Math.round((fpsFrames * 1000) / elapsed);
      smoothedMs = elapsed / fpsFrames;
      fpsFrames = 0;
      fpsLastTime = now;

      updateFpsCanvas(smoothedFps, smoothedMs);
      const hudFps = document.getElementById('hudFps');
      if (hudFps) {
        hudFps.textContent = `${smoothedFps} FPS (${smoothedMs.toFixed(1)}ms)`;
        hudFps.style.color = smoothedFps >= 60 ? '#7ef088' : (smoothedFps >= 45 ? '#f0d04e' : '#f05a4e');
      }
    }
  }

  // Snap turn state
  let snapTurnReady = true;
  const SNAP_ANGLE = Math.PI / 4; // 45 degrees snap turn

  function updateVR(dt) {
    const session = renderer.xr.getSession();
    if (session && renderer.xr.isPresenting) {
      // Enforce full fixed foveation for maximum Quest performance
      if (renderer.xr.setFoveation) {
        renderer.xr.setFoveation(1.0);
      }
      try {
        if (session.renderState?.baseLayer && 'fixedFoveation' in session.renderState.baseLayer) {
          session.renderState.baseLayer.fixedFoveation = 1.0;
        }
        if (session.renderState?.layers) {
          for (const layer of session.renderState.layers) {
            if (layer && 'fixedFoveation' in layer) layer.fixedFoveation = 1.0;
          }
        }
      } catch (e) {}

      // Keep camera rig and camera world transforms synced
      cameraRig.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);

      for (let i = 0; i < session.inputSources.length; i++) {
        const src = session.inputSources[i];
        if (src.handedness === 'right') {
          const grip = (i === 0 ? controllerGrip0 : controllerGrip1);
          if (rightHandGroup.parent !== grip) {
            grip.add(rightHandGroup);
            rightHandGroup.position.set(0, 0, 0);
            rightHandGroup.visible = true;
          }
        }
        if (!src.gamepad || !src.gamepad.axes) continue;
        const axes = src.gamepad.axes;
        if (axes.length < 2) continue;

        let stickX = 0, stickY = 0;
        if (axes.length >= 4 && (Math.abs(axes[2]) > 0.12 || Math.abs(axes[3]) > 0.12)) {
          stickX = axes[2];
          stickY = axes[3];
        } else if (Math.abs(axes[0]) > 0.12 || Math.abs(axes[1]) > 0.12) {
          stickX = axes[0];
          stickY = axes[1];
        }

        if (src.handedness === 'left') {
          // Move in exact direction user is looking in VR headset (respects head gaze + right stick snap turns)
          if (Math.abs(stickX) > 0.12 || Math.abs(stickY) > 0.12) {
            const moveSpeed = 6.5 * dt;
            const headDir = new THREE.Vector3();
            // Read direction directly from camera which has both head orientation and rig rotation applied
            camera.getWorldDirection(headDir);
            headDir.y = 0;
            if (headDir.lengthSq() > 0.0001) {
              headDir.normalize();
            } else {
              headDir.set(0, 0, -1);
            }

            const headRgt = new THREE.Vector3().crossVectors(headDir, new THREE.Vector3(0, 1, 0)).normalize();
            cameraRig.position.addScaledVector(headDir, -stickY * moveSpeed);
            cameraRig.position.addScaledVector(headRgt, stickX * moveSpeed);

            const r = Math.hypot(cameraRig.position.x, cameraRig.position.z);
            if (r > 200) cameraRig.position.setLength(200);
          }
        } else if (src.handedness === 'right') {
          // Snap rotation with right stick (45 degrees per flick with release-to-center debounce)
          if (Math.abs(stickX) > 0.55) {
            if (snapTurnReady) {
              // stickX > 0: flicked right -> snap turn right (clockwise)
              // stickX < 0: flicked left  -> snap turn left (counter-clockwise)
              const snapDir = stickX > 0 ? -1 : 1;
              cameraRig.rotation.y += snapDir * SNAP_ANGLE;
              cameraRig.updateMatrixWorld(true);
              camera.updateMatrixWorld(true);
              snapTurnReady = false;
            }
          } else if (Math.abs(stickX) < 0.20) {
            snapTurnReady = true;
          }
        }
      }
      const gh = groundHeight(cameraRig.position.x, cameraRig.position.z);
      cameraRig.position.y = Math.max(gh, 0.1);
    }
  }

  return {
    cameraRig,
    updateVR,
    recordFps
  };
}
