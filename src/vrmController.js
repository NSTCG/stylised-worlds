/**
 * src/vrmController.js
 * High-Quality VRoid VRM Character Controller with:
 * - Desktop WASD + PointerLock Mouse Look (or Orbit)
 * - Meta Quest WebXR Joystick Locomotion (Smooth Walk & Snap Turn)
 * - First-Person Mode (Eye camera with chest/arms/legs visible, head unclipped) & Third-Person Mode
 * - Full-Body 3-Point Tracking Solver (Head + 2 Controllers / Hands)
 * - Analytical Two-Bone Arm Inverse Kinematics (IK)
 * - Procedural Leg Stride, Foot Terrain Adaptation & Natural Blinking / Breathing
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { groundHeight } from './terrain.js';
import { setupModelMaterials } from './materialFeatures.js';
import { showNotification } from './levelSerializer.js';

export class VRMCharacterController {
  constructor(scene, camera, renderer, cameraRig = null) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.cameraRig = cameraRig;

    this.vrm = null;
    this.currentModelUrl = './assets/vrm/AvatarSample_B.vrm';
    this.isLoading = false;

    // Player State
    this.position = new THREE.Vector3(0, 0.5, 12);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.speed = 4.2;
    this.sprintMultiplier = 1.6;
    this.isGrounded = true;
    this.walkCycle = 0;

    // View Modes: 'first_person' | 'third_person'
    this.viewMode = 'third_person';
    this.thirdPersonOffset = new THREE.Vector3(0, 1.45, 2.8);

    // Desktop Input
    this.keys = { w: false, a: false, s: false, d: false, shift: false, space: false };
    this.isPointerLocked = false;

    // Bone Cache
    this.bones = {
      hips: null,
      spine: null,
      chest: null,
      neck: null,
      head: null,
      leftUpperArm: null,
      leftLowerArm: null,
      leftHand: null,
      rightUpperArm: null,
      rightLowerArm: null,
      rightHand: null,
      leftUpperLeg: null,
      leftLowerLeg: null,
      leftFoot: null,
      rightUpperLeg: null,
      rightLowerLeg: null,
      rightFoot: null
    };

    // Bone Lengths for IK
    this.armLengthL = { upper: 0.26, lower: 0.24 };
    this.armLengthR = { upper: 0.26, lower: 0.24 };

    // Procedural Animation State
    this.blinkTimer = 0;
    this.nextBlinkInterval = 3.5;
    this.breathingTime = 0;

    this._setupInputListeners();
  }

  /**
   * Load a VRM avatar
   */
  async loadVRM(url = this.currentModelUrl) {
    if (this.isLoading) return;
    this.isLoading = true;
    this.currentModelUrl = url;

    showNotification('👤 Loading High-Quality VRoid Avatar...', 'info', 3000);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    try {
      const gltf = await new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });

      const vrm = gltf.userData.vrm;
      if (!vrm) throw new Error('No VRM instance found in loaded asset');

      // Remove existing VRM
      if (this.vrm) {
        this.scene.remove(this.vrm.scene);
        VRMUtils.deepDispose(this.vrm.scene);
      }

      this.vrm = vrm;
      VRMUtils.rotateVRM0(vrm);

      // Disable frustum culling on avatar meshes so arms & hands never pop when looking down
      this.vrm.scene.traverse((o) => {
        if (o.isMesh) {
          o.frustumCulled = false;
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });

      // Apply atmospheric directional fog & terrain contact ground blending
      setupModelMaterials(this.vrm.scene, {
        blendDistance: 0.15,
        blendStrength: 0.55,
        normalBlend: 0.40
      });

      this._cacheHumanoidBones();
      this.scene.add(this.vrm.scene);

      // Initial placement at current position
      const gh = groundHeight(this.position.x, this.position.z);
      this.position.y = Math.max(gh, 0.05);
      this.vrm.scene.position.copy(this.position);

      // Snap spring bones to rest position initially
      if (this.vrm.springBoneManager && this.vrm.springBoneManager.reset) {
        this.vrm.springBoneManager.reset();
      }

      this._applyViewMode();

      // Disable orbit controls so character follow camera immediately takes over
      if (window.controls) {
        window.controls.enabled = false;
      }

      showNotification('✨ VRM Avatar Ready! Press "C" to toggle 1st/3rd Person', 'success', 4000);
    } catch (err) {
      console.warn('VRM load error (trying AliciaSolid fallback):', err.message);
      if (url !== './assets/vrm/AliciaSolid.vrm') {
        this.isLoading = false;
        return this.loadVRM('./assets/vrm/AliciaSolid.vrm');
      }
      showNotification('Failed to load VRM: ' + err.message, 'error', 4000);
    } finally {
      this.isLoading = false;
    }
  }

  _cacheHumanoidBones() {
    if (!this.vrm || !this.vrm.humanoid) return;
    const h = this.vrm.humanoid;

    for (const key of Object.keys(this.bones)) {
      this.bones[key] = h.getNormalizedBoneNode(key);
    }

    // Estimate limb lengths
    if (this.bones.leftUpperArm && this.bones.leftLowerArm) {
      this.armLengthL.upper = this.bones.leftUpperArm.position.distanceTo(this.bones.leftLowerArm.position) || 0.26;
    }
    if (this.bones.leftLowerArm && this.bones.leftHand) {
      this.armLengthL.lower = this.bones.leftLowerArm.position.distanceTo(this.bones.leftHand.position) || 0.24;
    }
    if (this.bones.rightUpperArm && this.bones.rightLowerArm) {
      this.armLengthR.upper = this.bones.rightUpperArm.position.distanceTo(this.bones.rightLowerArm.position) || 0.26;
    }
    if (this.bones.rightLowerArm && this.bones.rightHand) {
      this.armLengthR.lower = this.bones.rightLowerArm.position.distanceTo(this.bones.rightHand.position) || 0.24;
    }
  }

  /**
   * Toggle between First-Person Mode and Third-Person Mode
   */
  toggleViewMode() {
    if (window.controls && window.controls.enabled) {
      window.controls.enabled = false;
    }
    this.viewMode = this.viewMode === 'first_person' ? 'third_person' : 'first_person';
    this._applyViewMode();
    showNotification(
      this.viewMode === 'first_person'
        ? '👁️ First-Person Mode Active (Look down to see body & hands)'
        : '🎥 Third-Person Mode Active',
      'info',
      2500
    );
  }

  _applyViewMode() {
    if (!this.vrm) return;

    if (this.viewMode === 'first_person') {
      // In first-person, scale head bone down to avoid clipping inside the player's skull/eyes
      // while keeping torso, arms, hands, legs, and feet fully visible!
      if (this.bones.head) {
        this.bones.head.scale.set(0.001, 0.001, 0.001);
      }
    } else {
      if (this.bones.head) {
        this.bones.head.scale.set(1.0, 1.0, 1.0);
      }
    }
  }

  _setupInputListeners() {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') this.keys.w = true;
      if (k === 'a' || k === 'arrowleft') this.keys.a = true;
      if (k === 's' || k === 'arrowdown') this.keys.s = true;
      if (k === 'd' || k === 'arrowright') this.keys.d = true;
      if (e.key === 'Shift') this.keys.shift = true;
      if (e.key === ' ') this.keys.space = true;
      if (k === 'c') this.toggleViewMode();
    });

    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') this.keys.w = false;
      if (k === 'a' || k === 'arrowleft') this.keys.a = false;
      if (k === 's' || k === 'arrowdown') this.keys.s = false;
      if (k === 'd' || k === 'arrowright') this.keys.d = false;
      if (e.key === 'Shift') this.keys.shift = false;
      if (e.key === ' ') this.keys.space = false;
    });

    // Mouse Look (when pointer locked)
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        this.yaw -= e.movementX * 0.0022;
        this.pitch -= e.movementY * 0.0022;
        this.pitch = THREE.MathUtils.clamp(this.pitch, -1.35, 1.35);
      }
    });

    const vrmBtn = document.getElementById('vrmAvatarBtn');
    if (vrmBtn) {
      vrmBtn.addEventListener('click', () => {
        if (!this.vrm) {
          this.loadVRM();
        } else {
          this.toggleViewMode();
        }
      });
    }
  }

  /**
   * Main per-frame update loop
   */
  update(dt, vrContext = null) {
    if (!this.vrm) return;

    const isVR = this.renderer.xr.isPresenting;

    if (isVR) {
      this._updateVRTracking(dt, vrContext);
    } else {
      this._updateDesktopLocomotion(dt);
    }

    // Ground Clamping
    const gh = groundHeight(this.position.x, this.position.z);
    this.position.y = THREE.MathUtils.lerp(this.position.y, Math.max(gh, 0.05), 0.22);
    this.vrm.scene.position.copy(this.position);
    this.vrm.scene.rotation.y = this.yaw;

    // Procedural Facial Expressions (Blink) & Idle Breathing
    this._updateExpressions(dt);

    // Camera Positioning (Desktop)
    if (!isVR) {
      if (window.controls && window.controls.enabled) {
        // In Orbit mode, center the orbit target on the avatar
        window.controls.target.lerp(new THREE.Vector3(this.position.x, this.position.y + 1.1, this.position.z), 0.15);
      } else {
        this._updateDesktopCamera();
      }
    }

    // VRM Physics & Spring Bones
    this.vrm.update(dt);
  }

  /* ---------------------------------------------------------- Desktop Controls */

  _updateDesktopLocomotion(dt) {
    let moveX = 0, moveZ = 0;
    if (this.keys.w) moveZ -= 1;
    if (this.keys.s) moveZ += 1;
    if (this.keys.a) moveX -= 1;
    if (this.keys.d) moveX += 1;

    const isMoving = (moveX !== 0 || moveZ !== 0);
    const currentSpeed = (this.keys.shift ? this.speed * this.sprintMultiplier : this.speed);

    if (isMoving) {
      const inputDir = new THREE.Vector3(moveX, 0, moveZ).normalize();
      inputDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

      this.position.x += inputDir.x * currentSpeed * dt;
      this.position.z += inputDir.z * currentSpeed * dt;

      this.walkCycle += dt * (this.keys.shift ? 10.5 : 7.0);
    } else {
      // Return walk cycle smoothly to rest
      this.walkCycle = THREE.MathUtils.lerp(this.walkCycle, Math.round(this.walkCycle / Math.PI) * Math.PI, 0.12);
    }

    this._animateDesktopBody(isMoving, dt);
  }

  _animateDesktopBody(isMoving, dt) {
    const cycle = this.walkCycle;
    const stride = isMoving ? 0.45 : 0.0;
    const armSwing = isMoving ? 0.38 : 0.0;

    // Legs
    if (this.bones.leftUpperLeg && this.bones.rightUpperLeg) {
      this.bones.leftUpperLeg.rotation.x = Math.sin(cycle) * stride;
      this.bones.rightUpperLeg.rotation.x = -Math.sin(cycle) * stride;

      if (this.bones.leftLowerLeg && this.bones.rightLowerLeg) {
        this.bones.leftLowerLeg.rotation.x = Math.max(0, -Math.sin(cycle) * 0.7);
        this.bones.rightLowerLeg.rotation.x = Math.max(0, Math.sin(cycle) * 0.7);
      }
    }

    // Arms (Relaxed natural stance at sides + walk swing)
    if (this.bones.leftUpperArm && this.bones.rightUpperArm) {
      this.bones.leftUpperArm.rotation.x = -Math.sin(cycle) * armSwing;
      this.bones.rightUpperArm.rotation.x = Math.sin(cycle) * armSwing;

      this.bones.leftUpperArm.rotation.z = 1.25;
      this.bones.rightUpperArm.rotation.z = -1.25;

      if (this.bones.leftLowerArm && this.bones.rightLowerArm) {
        this.bones.leftLowerArm.rotation.y = 0.22;
        this.bones.rightLowerArm.rotation.y = -0.22;
      }
    }

    // Head Pitch
    if (this.bones.neck) {
      this.bones.neck.rotation.x = this.pitch * 0.45;
    }
  }

  _updateDesktopCamera() {
    if (this.viewMode === 'first_person') {
      // Place camera at head bone position
      let eyeY = this.position.y + 1.48;
      if (this.bones.head) {
        const headWorld = new THREE.Vector3();
        this.bones.head.getWorldPosition(headWorld);
        eyeY = headWorld.y;
      }
      this.camera.position.set(this.position.x, eyeY, this.position.z);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    } else {
      // Third person follow camera
      const rotatedOffset = this.thirdPersonOffset.clone();
      rotatedOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

      const targetPos = this.position.clone().add(rotatedOffset);
      const lookTarget = new THREE.Vector3(this.position.x, this.position.y + 1.25, this.position.z);

      this.camera.position.lerp(targetPos, 0.2);
      this.camera.lookAt(lookTarget);
    }
  }

  /* ---------------------------------------------------------- Meta Quest VR Tracking */

  _updateVRTracking(dt, vrContext) {
    const xrCam = this.renderer.xr.getCamera ? this.renderer.xr.getCamera() : this.camera;
    const session = this.renderer.xr.getSession ? this.renderer.xr.getSession() : null;

    // 1. Sync avatar position with VR cameraRig
    if (this.cameraRig) {
      this.position.x = this.cameraRig.position.x;
      this.position.z = this.cameraRig.position.z;
    }

    // 2. Headset Orientation -> Avatar Head & Spine
    const hmdQuat = new THREE.Quaternion();
    const hmdPos = new THREE.Vector3();
    xrCam.getWorldQuaternion(hmdQuat);
    xrCam.getWorldPosition(hmdPos);

    // Extract HMD yaw
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(hmdQuat);
    const hmdYaw = Math.atan2(-forward.x, -forward.z);

    // Smooth torso alignment with deadzone
    const yawDiff = hmdYaw - this.yaw;
    if (Math.abs(yawDiff) > 0.6) {
      this.yaw = THREE.MathUtils.lerp(this.yaw, hmdYaw - Math.sign(yawDiff) * 0.6, 0.12);
    }

    if (this.bones.head) {
      this.bones.head.quaternion.copy(hmdQuat);
    }
    if (this.bones.spine) {
      this.bones.spine.rotation.x = forward.y * 0.35;
    }

    // 3. Two-Bone Inverse Kinematics for Left & Right Controllers / Hands
    if (session && session.inputSources) {
      let isMovingInVR = false;

      for (let i = 0; i < session.inputSources.length; i++) {
        const src = session.inputSources[i];
        if (!src.gamepad) continue;

        // Check if joystick movement is active
        const axes = src.gamepad.axes;
        if (axes && (Math.abs(axes[0]) > 0.15 || Math.abs(axes[1]) > 0.15 || Math.abs(axes[2] || 0) > 0.15)) {
          isMovingInVR = true;
        }

        const controller = this.renderer.xr.getController(i);
        if (!controller) continue;

        const ctrlPos = new THREE.Vector3();
        const ctrlQuat = new THREE.Quaternion();
        controller.getWorldPosition(ctrlPos);
        controller.getWorldQuaternion(ctrlQuat);

        if (src.handedness === 'left') {
          this._solveArmIK(
            this.bones.leftUpperArm,
            this.bones.leftLowerArm,
            this.bones.leftHand,
            ctrlPos,
            ctrlQuat,
            this.armLengthL.upper,
            this.armLengthL.lower,
            -1 // Left arm pole
          );
        } else if (src.handedness === 'right') {
          this._solveArmIK(
            this.bones.rightUpperArm,
            this.bones.rightLowerArm,
            this.bones.rightHand,
            ctrlPos,
            ctrlQuat,
            this.armLengthR.upper,
            this.armLengthR.lower,
            1 // Right arm pole
          );
        }
      }

      // Procedural walking legs when traversing with joystick
      if (isMovingInVR) {
        this.walkCycle += dt * 8.0;
        this._animateLegs(true);
      } else {
        this._animateLegs(false);
      }
    }
  }

  /**
   * Analytical Two-Bone Inverse Kinematics (Shoulder -> Elbow -> Hand)
   */
  _solveArmIK(upperArm, lowerArm, hand, targetPos, targetQuat, l1, l2, poleSide = 1) {
    if (!upperArm || !lowerArm || !hand) return;

    const shoulderPos = new THREE.Vector3();
    upperArm.getWorldPosition(shoulderPos);

    // Vector from shoulder to target hand
    const toTarget = targetPos.clone().sub(shoulderPos);
    const targetDist = toTarget.length();
    const maxReach = (l1 + l2) * 0.999;
    const clampedDist = Math.max(0.05, Math.min(targetDist, maxReach));

    // Law of Cosines to solve elbow hinge angle
    const cosAngle = (l1 * l1 + clampedDist * clampedDist - l2 * l2) / (2 * l1 * clampedDist);
    const alpha = Math.acos(THREE.MathUtils.clamp(cosAngle, -1.0, 1.0));

    const cosElbow = (l1 * l1 + l2 * l2 - clampedDist * clampedDist) / (2 * l1 * l2);
    const beta = Math.acos(THREE.MathUtils.clamp(cosElbow, -1.0, 1.0));

    // Direct upper arm towards target + elevation offset
    toTarget.normalize();
    const upVector = new THREE.Vector3(poleSide * 0.35, -0.85, 0.1).normalize();
    const armPlaneNormal = new THREE.Vector3().crossVectors(toTarget, upVector).normalize();

    // Rotate upper arm
    upperArm.lookAt(shoulderPos.clone().add(toTarget));
    upperArm.rotateOnAxis(new THREE.Vector3(0, 1, 0), alpha * poleSide);

    // Hinge elbow angle
    lowerArm.rotation.set(0, 0, 0);
    lowerArm.rotateOnAxis(new THREE.Vector3(0, 0, 1), (Math.PI - beta) * poleSide);

    // Orient hand to match controller orientation
    hand.quaternion.copy(targetQuat);
  }

  _animateLegs(isMoving) {
    const cycle = this.walkCycle;
    const stride = isMoving ? 0.42 : 0.0;

    if (this.bones.leftUpperLeg && this.bones.rightUpperLeg) {
      this.bones.leftUpperLeg.rotation.x = Math.sin(cycle) * stride;
      this.bones.rightUpperLeg.rotation.x = -Math.sin(cycle) * stride;

      if (this.bones.leftLowerLeg && this.bones.rightLowerLeg) {
        this.bones.leftLowerLeg.rotation.x = Math.max(0, -Math.sin(cycle) * 0.65);
        this.bones.rightLowerLeg.rotation.x = Math.max(0, Math.sin(cycle) * 0.65);
      }
    }
  }

  _updateExpressions(dt) {
    if (!this.vrm || !this.vrm.expressionManager) return;
    const em = this.vrm.expressionManager;

    // Procedural Periodic Blinking
    this.blinkTimer += dt;
    if (this.blinkTimer > this.nextBlinkInterval) {
      const blinkProgress = (this.blinkTimer - this.nextBlinkInterval) / 0.18;
      if (blinkProgress <= 1.0) {
        const val = Math.sin(blinkProgress * Math.PI);
        em.setValue('blink', val);
      } else {
        em.setValue('blink', 0.0);
        this.blinkTimer = 0;
        this.nextBlinkInterval = 2.8 + Math.random() * 3.5;
      }
    }

    // Subtle breathing spine sway
    this.breathingTime += dt * 1.8;
    if (this.bones.chest) {
      this.bones.chest.rotation.z = Math.sin(this.breathingTime) * 0.012;
    }
  }
}
