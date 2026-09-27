/**
 * src/vr.js
 * Meta Quest WebXR integration with:
 * - Free Roam & 3D Flight locomotion (Toggle with X button)
 * - Interactive in-VR 3D tablet UI (Sculpt, Tree Samplers, Prop Placing, Level Saving)
 * - Right-hand laser pointer editing (Terrain sculpt, Tree stamp/erase, Prop placement)
 * - 90 FPS target framerate & fixed foveation optimization for Quest 2/3/Pro
 */
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { groundHeight, getGroundMesh } from './terrain.js';
import { grassConfig } from './grass.js';
import { createVRUI } from './vrUI.js';
import { placeTreeAt, sampleTreeCluster, eraseTreesInRadius, rebuildTreesPCG } from './trees.js';
import { confirmPlacement, updateGhostPosition, placementState } from './assetsManager.js';
import { saveLevelToStorage, loadLevelFromStorage, showNotification } from './levelSerializer.js';

export function setupVR(renderer, scene, camera, player, getIsWalkMode, controls, editorApi = null) {
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
  const beamGeo = new THREE.CylinderGeometry(0.002, 0.002, 0.5).rotateX(Math.PI / 2).translate(0, 0, -0.25);
  const beamMesh0 = new THREE.Mesh(beamGeo, beamMat);
  const beamMesh1 = new THREE.Mesh(beamGeo, beamMat);
  controller0.add(beamMesh0);
  controller1.add(beamMesh1);

  // Locomotion & Flight State
  let isFlyMode = false;
  let xBtnPrev = false;
  let yBtnPrev = false;
  let bBtnPrev = false;

  function toggleFlyMode() {
    isFlyMode = !isFlyMode;
    showNotification(
      isFlyMode ? '🕊️ Fly Mode Active! Soar in 3D (Press X to Land)' : '🚶 Ground Walk Mode Active',
      'success'
    );
    if (vrUI) vrUI.renderUI();
  }

  // ---------------------------------------------------------- Interactive In-VR Tablet UI
  const vrUI = createVRUI(
    cameraRig,
    cameraRig,
    window.envConfig || {},
    toggleFlyMode,
    () => isFlyMode
  );

  // Position tablet comfortably in front of user view
  vrUI.panelMesh.position.set(0, 1.25, -1.15);
  vrUI.panelMesh.rotation.set(-0.15, 0, 0);

  // Reposition UI tablet in front of player when summoned
  function repositionVRUI() {
    vrUI.panelMesh.visible = true;
    const fwd = new THREE.Vector3(0, 0, -1);
    const xrCam = renderer.xr.getCamera ? renderer.xr.getCamera() : camera;
    if (xrCam && xrCam.quaternion) {
      fwd.applyQuaternion(xrCam.quaternion);
    }
    fwd.y = 0;
    if (fwd.lengthSq() > 0.001) fwd.normalize();
    else fwd.set(0, 0, -1);

    vrUI.panelMesh.position.copy(camera.position).addScaledVector(fwd, 1.15);
    vrUI.panelMesh.position.y = Math.max(1.1, camera.position.y - 0.15);
    vrUI.panelMesh.quaternion.copy(camera.quaternion);
    vrUI.renderUI();
  }

  // ---------------------------------------------------------- Brush Ground Indicator
  const groundMesh = getGroundMesh();
  const _vrRay = new THREE.Raycaster();
  const _vPos = new THREE.Vector3(), _vQuat = new THREE.Quaternion(), _vDir = new THREE.Vector3();
  const _vBrushColorMap = {
    grass: 0x7ef088, sand: 0xf2d680, road: 0xb5885c, water: 0x38bdf8,
    raise: 0xff6b4a, lower: 0x818cf8, smooth: 0xe2e8f0, rock: 0x94a3b8
  };

  const vrRingGeo = new THREE.RingGeometry(0.92, 1.0, 32);
  vrRingGeo.rotateX(-Math.PI / 2);
  const vrRingMat = new THREE.MeshBasicMaterial({
    color: 0x7ef088,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
    depthTest: false
  });
  const vrBrushRing = new THREE.Mesh(vrRingGeo, vrRingMat);
  vrBrushRing.renderOrder = 999;
  vrBrushRing.visible = false;
  scene.add(vrBrushRing);

  // Controller ray -> terrain hit point
  function getControllerGroundHit(controller) {
    if (!groundMesh) return null;
    controller.getWorldPosition(_vPos);
    controller.getWorldQuaternion(_vQuat);
    _vDir.set(0, 0, -1).applyQuaternion(_vQuat);
    _vrRay.set(_vPos, _vDir);
    const hits = _vrRay.intersectObject(groundMesh, false);
    return hits.length ? hits[0].point : null;
  }

  let isSqueezePainting = false;

  // Bind Controller Triggers & Grips for World Editing
  function bindControllerActions(controller) {
    // Trigger Press (Selectstart)
    controller.addEventListener('selectstart', () => {
      // 1. Check if clicking on In-VR UI tablet
      const uiHit = vrUI.raycastUI(controller);
      if (uiHit) {
        vrUI.triggerClick();
        return;
      }

      // 2. Otherwise interact with world / terrain
      const hit = getControllerGroundHit(controller);
      if (!hit) return;

      const tool = vrUI.state.activeTool;
      if (tool === 'terrain') {
        if (window.terrainEditor?.editorState) {
          window.terrainEditor.editorState.brushRadius = vrUI.state.brushRadius || 10;
        }
        if (editorApi?.applyBrushAt) {
          editorApi.applyBrushAt(hit.x, hit.z);
        }
      } else if (tool === 'tree_stamp') {
        const type = vrUI.state.selectedTreeType || 'conifer';
        placeTreeAt(hit.x, hit.z, type);
      } else if (tool === 'tree_cluster') {
        const type = vrUI.state.selectedTreeType || 'conifer';
        sampleTreeCluster(hit.x, hit.z, 6, 12.0, type);
      } else if (tool === 'tree_eraser') {
        eraseTreesInRadius(hit.x, hit.z, 6.0);
      } else if (tool === 'prop_place') {
        confirmPlacement(hit.x, hit.z);
      }
    });

    // Squeeze / Grip for continuous terrain sculpting
    controller.addEventListener('squeezestart', () => {
      isSqueezePainting = true;
    });
    controller.addEventListener('squeezeend', () => {
      isSqueezePainting = false;
    });
  }

  bindControllerActions(controller0);
  bindControllerActions(controller1);

  // ---------------------------------------------------------- Right-hand Wrist FPS Display
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
    const modeStr = isFlyMode ? ' · 🕊️ FLY' : ' · 🚶 WALK';
    cxFps.fillText(`${ms.toFixed(1)}ms · GRASS: ${kCount}k${modeStr}`, 36, 185);

    cxFps.font = '21px monospace';
    cxFps.fillStyle = 'rgba(220, 240, 210, 0.75)';
    cxFps.fillText('X: Toggle Fly · Y/B: UI Menu', 36, 224);

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

  renderer.xr.setFoveation(1.0); // Maximum fixed foveation for Quest 2/3/Pro

  renderer.xr.addEventListener('sessionstart', () => {
    controls.enabled = false;
    renderer.xr.setFoveation(1.0);
    const session = renderer.xr.getSession();
    if (session) {
      if (session.updateTargetFrameRate && session.supportedFrameRates) {
        const rates = Array.from(session.supportedFrameRates);
        const rate90 = rates.find(r => Math.round(r) === 90);
        const rate72 = rates.find(r => Math.round(r) === 72);
        if (rate90) session.updateTargetFrameRate(rate90).catch(() => {});
        else if (rate72) session.updateTargetFrameRate(rate72).catch(() => {});
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
    repositionVRUI();
  });

  renderer.xr.addEventListener('sessionend', () => {
    controls.enabled = !getIsWalkMode();
    camera.position.copy(cameraRig.position).add(new THREE.Vector3(0, 1.72, 0));
    cameraRig.position.set(0, 0, 0);
  });

  // FPS tracker
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
      if (renderer.xr.setFoveation) {
        renderer.xr.setFoveation(1.0);
      }

      if (renderer.xr.updateCamera) {
        renderer.xr.updateCamera(camera);
      }
      cameraRig.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);

      // Check controller inputs
      for (let i = 0; i < session.inputSources.length; i++) {
        const src = session.inputSources[i];
        const gp = src.gamepad;
        if (!gp) continue;

        // Check Left Controller Buttons (X button = buttons[4], Y button = buttons[5])
        if (src.handedness === 'left') {
          // X Button: Toggle Free Roam / Fly Mode
          const xPressed = (gp.buttons[4] && gp.buttons[4].pressed) || (gp.buttons[2] && gp.buttons[2].pressed);
          if (xPressed && !xBtnPrev) {
            toggleFlyMode();
          }
          xBtnPrev = !!xPressed;

          // Y Button: Toggle VR UI Menu
          const yPressed = gp.buttons[5] && gp.buttons[5].pressed;
          if (yPressed && !yBtnPrev) {
            repositionVRUI();
          }
          yBtnPrev = !!yPressed;
        }

        // Check Right Controller Buttons (A button = buttons[4], B button = buttons[5])
        if (src.handedness === 'right') {
          const bPressed = gp.buttons[5] && gp.buttons[5].pressed;
          if (bPressed && !bBtnPrev) {
            repositionVRUI();
          }
          bBtnPrev = !!bPressed;

          // Raycast laser to VR UI for hover tracking
          vrUI.raycastUI(controller1);
        }

        // Joystick Locomotion
        if (!gp.axes || gp.axes.length < 2) continue;
        const axes = gp.axes;
        let stickX = 0, stickY = 0;
        if (axes.length >= 4 && (Math.abs(axes[2]) > 0.12 || Math.abs(axes[3]) > 0.12)) {
          stickX = axes[2]; stickY = axes[3];
        } else if (Math.abs(axes[0]) > 0.12 || Math.abs(axes[1]) > 0.12) {
          stickX = axes[0]; stickY = axes[1];
        }

        if (src.handedness === 'left') {
          // Left Stick Locomotion
          if (Math.abs(stickX) > 0.12 || Math.abs(stickY) > 0.12) {
            const xrCam = renderer.xr.getCamera ? renderer.xr.getCamera() : camera;

            if (isFlyMode) {
              // 🕊️ FULL 3D FLIGHT LOCOMOTION
              // Moves in the exact 3D gaze vector (pitch + yaw) to soar across the sky!
              const flyDir = new THREE.Vector3(0, 0, -1);
              if (xrCam && xrCam.quaternion) {
                flyDir.applyQuaternion(xrCam.quaternion);
              } else {
                camera.getWorldDirection(flyDir);
              }
              flyDir.applyQuaternion(cameraRig.quaternion).normalize();

              const flyRgt = new THREE.Vector3().crossVectors(flyDir, new THREE.Vector3(0, 1, 0)).normalize();
              const flySpd = 14.0 * dt; // Fast smooth soaring speed

              cameraRig.position.addScaledVector(flyDir, -stickY * flySpd);
              cameraRig.position.addScaledVector(flyRgt, stickX * flySpd);

              // Altitude bounds in fly mode (0.3m to 90m)
              cameraRig.position.y = THREE.MathUtils.clamp(cameraRig.position.y, 0.3, 90.0);
            } else {
              // 🚶 GROUND WALK LOCOMOTION
              const headDir = new THREE.Vector3(0, 0, -1);
              if (xrCam && xrCam.quaternion) {
                headDir.applyQuaternion(xrCam.quaternion);
              } else {
                camera.getWorldDirection(headDir);
              }
              headDir.applyQuaternion(cameraRig.quaternion);
              headDir.y = 0;
              if (headDir.lengthSq() > 0.0001) headDir.normalize();
              else headDir.set(0, 0, -1);

              const headRgt = new THREE.Vector3().crossVectors(headDir, new THREE.Vector3(0, 1, 0)).normalize();
              const moveSpeed = 6.5 * dt;

              cameraRig.position.addScaledVector(headDir, -stickY * moveSpeed);
              cameraRig.position.addScaledVector(headRgt, stickX * moveSpeed);
            }

            const r = Math.hypot(cameraRig.position.x, cameraRig.position.z);
            if (r > 200) cameraRig.position.setLength(200);
          }
        } else if (src.handedness === 'right') {
          // Right Stick Snap Turning
          if (Math.abs(stickX) > 0.55) {
            if (snapTurnReady) {
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

      // Ground clamping (ONLY in ground walk mode; disabled in Fly Mode so user can soar!)
      if (!isFlyMode) {
        const gh = groundHeight(cameraRig.position.x, cameraRig.position.z);
        cameraRig.position.y = Math.max(gh, 0.1);
      }

      // Continuous Squeeze Sculpting & Ring positioning
      const hit = getControllerGroundHit(controller1);
      if (hit) {
        vrBrushRing.position.set(hit.x, hit.y + 0.08, hit.z);
        const radius = window.terrainEditor?.editorState?.brushRadius || 10;
        vrBrushRing.scale.setScalar(radius);
        const bType = window.terrainEditor?.editorState?.brushType || 'grass';
        vrRingMat.color.setHex(_vBrushColorMap[bType] || 0x7ef088);
        vrBrushRing.visible = true;

        if (isSqueezePainting && editorApi?.applyBrushAt) {
          editorApi.applyBrushAt(hit.x, hit.z);
        }

        // Ghost prop update
        if (placementState.active) {
          updateGhostPosition(hit.x, hit.z);
        }
      } else {
        vrBrushRing.visible = false;
      }
    }
  }

  return {
    cameraRig,
    vrUI,
    updateVR,
    recordFps,
    toggleFlyMode,
    isFlyMode: () => isFlyMode,
    repositionVRUI
  };
}
