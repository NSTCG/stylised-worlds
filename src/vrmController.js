/**
 * src/vrmController.js
 * High-Quality VRoid VRM Character Controller with:
 * - Desktop WASD + Smooth Orbit Camera with Zoom-to-First-Person
 * - Inspect Mode ('V' key) with detached OrbitControls, MMB Screen-Space Pan, RMB Look
 * - Genuine Mixamo Animation Retargeting (Idle, Walk, Run) via vrm-mixamo-retarget standard
 * - Stored pristine T-pose baseline with zero-drift resetting before/after animations & IK
 * - Meta Quest WebXR Controller Tracking with Analytical Two-Bone Arm IK (Vector-based, no crooked roll)
 * - Headset yaw & spine tracking, VR first-person view with unclipped body & legs
 * - Detached VR Fly/Edit Mode ('X' button)
 * - Procedural facial expressions (blinking) & breathing dynamics
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { loadMixamoAnimation } from './loadMixamoAnimation.js';
import { mixamoVRMRigMap } from './mixamoVRMRigMap.js';
import { groundHeight } from './terrain.js';
import { windUniforms } from './wind.js';
import { showNotification } from './levelSerializer.js';
import { compressVRMBuffer, optimizeVRMScene } from './vrmOptimizer.js';

export const AVAILABLE_AVATARS = [
  { id: 'alicia', name: 'Alicia Solid', url: './assets/vrm/AliciaSolid.vrm', desc: 'Classic Mascot (VRM 0.0)' },
  { id: 'avatar_b', name: 'Avatar Sample B', url: './assets/vrm/AvatarSample_B.vrm', desc: 'VRoid Student (VRM 0.0)' },
  { id: 'seed_san', name: 'Seed-san', url: './assets/vrm/Seed-san.vrm', desc: 'Sci-Fi Humanoid Suit (VRM 1.0)' },
];

export class VRMCharacterController {
  constructor(scene, camera, renderer, cameraRig = null) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.cameraRig = cameraRig;

    this.vrm = null;
    this.currentModelUrl = './assets/vrm/AliciaSolid.vrm';
    this.isLoading = false;

    // Avatar Model Registry
    this.availableAvatars = AVAILABLE_AVATARS;
    this.activeAvatarId = 'alicia';
    this.customAvatarName = null;

    // Advanced VRM Compression & Optimization Suite
    this.compressionConfig = {
      enabled: true,              // Pre-compress GLB buffer before loader parse
      maxTextureRes: 1024,        // Max texture dimension: 512, 1024, or 2048
      pruneThumbnail: true,       // Strip embedded 1.5MB-6MB 2D portrait photo
      textureFormat: 'image/webp',// High-efficiency WebP texture compression
      textureQuality: 0.82,       // Visually lossless 0.82 quality
      meshoptAccessory: true      // Meshopt WASM decimation on static accessories/props
    };
    this.lastOptimizationStats = null;

    // Player State
    this.position = new THREE.Vector3(0, 0.5, 12);
    this.velocity = new THREE.Vector3();
    this.avatarYaw = Math.PI; // Character facing forward direction
    this.orbitYaw = 0;
    this.orbitPitch = 0.22;
    this.orbitDistance = 2.8;
    this.currentCameraDistance = 2.8;
    this.speed = 4.2;
    this.sprintMultiplier = 1.6;
    this.isGrounded = true;
    this.walkCycle = 0;

    // View Modes: 'first_person' | 'third_person'
    this.viewMode = 'third_person';
    this._camRaycaster = new THREE.Raycaster();

    // Desktop Input
    this.keys = { w: false, a: false, s: false, d: false, shift: false, space: false };
    this.isMoving = false;
    this.isMouseDown = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.isVRDetached = false;

    // Animation Mixer & Locomotion Actions
    this.mixer = null;
    this.actions = null;
    this.hasWorkingMixamo = false;
    this.animWeights = { idle: 1.0, walk: 0.0, run: 0.0 };

    // Humanoid Bone Cache
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

    // Stored Canonical T-Pose Reference for Pristine Resets
    this.initialTPose = null;

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
   * Load a VRM avatar from URL, File, or Blob with optional pre-compression and scene optimization
   */
  async loadVRM(source = this.currentModelUrl, customLabel = null) {
    if (this.isLoading) return;
    this.isLoading = true;

    if (typeof source === 'string') {
      this.currentModelUrl = source;
      const matched = this.availableAvatars.find(a => a.url === source);
      if (matched) {
        this.activeAvatarId = matched.id;
        this.customAvatarName = null;
      }
    } else if (source instanceof File || source instanceof Blob) {
      this.activeAvatarId = 'custom';
      this.customAvatarName = customLabel || (source.name || 'Custom Avatar');
    }

    const currentName = this.customAvatarName || (this.availableAvatars.find(a => a.id === this.activeAvatarId)?.name || 'VRoid Avatar');
    showNotification(`👤 Preparing ${currentName}...`, 'info', 3000);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));

    let loadUrl = null;
    let isCreatedBlobUrl = false;

    try {
      // 1. Pre-Load Compression Pipeline
      if (this.compressionConfig.enabled) {
        let rawBuffer = null;
        if (typeof source === 'string') {
          showNotification('⚡ Optimizing VRM textures & pruning profile pic...', 'info', 4000);
          const res = await fetch(source);
          if (!res.ok) throw new Error(`HTTP error ${res.status} fetching ${source}`);
          rawBuffer = await res.arrayBuffer();
        } else if (source instanceof File || source instanceof Blob) {
          showNotification('⚡ Compressing custom VRM in-memory...', 'info', 4000);
          rawBuffer = await source.arrayBuffer();
        } else if (source instanceof ArrayBuffer) {
          rawBuffer = source;
        }

        if (rawBuffer) {
          const compResult = await compressVRMBuffer(rawBuffer, this.compressionConfig);
          this.lastOptimizationStats = compResult.stats;
          const blob = new Blob([compResult.buffer], { type: 'model/gltf-binary' });
          loadUrl = URL.createObjectURL(blob);
          isCreatedBlobUrl = true;
        }
      } else {
        this.lastOptimizationStats = null;
        if (typeof source === 'string') {
          loadUrl = source;
        } else if (source instanceof File || source instanceof Blob) {
          loadUrl = URL.createObjectURL(source);
          isCreatedBlobUrl = true;
        }
      }

      const gltf = await new Promise((resolve, reject) => {
        loader.load(loadUrl, resolve, undefined, reject);
      });

      const vrm = gltf.userData.vrm;
      if (!vrm) throw new Error('No VRM instance found in loaded asset');

      // Remove existing VRM
      if (this.vrm) {
        this.scene.remove(this.vrm.scene);
        VRMUtils.deepDispose(this.vrm.scene);
      }

      this.vrm = vrm;

      // Rotate VRM 0.0 models to face Three.js forward convention
      VRMUtils.rotateVRM0(vrm);

      // Set up pristine anime cel-shading, shadow casting, and normal handling
      this._setupVRMMaterials(this.vrm.scene);

      // Run post-load Meshopt accessory decimation & VR texture filtering
      await optimizeVRMScene(this.vrm, this.compressionConfig);

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
      this._loadMixamoLocomotion();

      // Disable orbit controls so character follow camera immediately takes over (only when not in inspect mode)
      if (window.controls && !window.isInspectMode) {
        window.controls.enabled = false;
      }

      const finalAvatarName = this.customAvatarName || this.vrm.meta?.title || this.vrm.meta?.name || currentName;
      const switchBtn = document.getElementById('switchAvatarBtn');
      if (switchBtn) {
        switchBtn.textContent = `🔄 Avatar: ${finalAvatarName}`;
      }

      if (this.lastOptimizationStats) {
        const s = this.lastOptimizationStats;
        showNotification(`✨ ${finalAvatarName} Ready! (Saved ${s.savingsPercent}%: ${s.origSizeMB}MB → ${s.newSizeMB}MB)`, 'success', 5000);
      } else {
        showNotification(`✨ ${finalAvatarName} Ready! WASD to move · Scroll to zoom`, 'success', 4000);
      }

      // Notify UI systems to update button active highlights
      window.dispatchEvent(new CustomEvent('vrmAvatarChanged', {
        detail: {
          avatarId: this.activeAvatarId,
          avatarName: finalAvatarName,
          stats: this.lastOptimizationStats
        }
      }));
    } catch (err) {
      console.warn('VRM load error (trying fallback avatar):', err);
      showNotification('Failed to load VRM: ' + err.message, 'error', 4500);
      const fallbackUrl = './assets/vrm/AliciaSolid.vrm';
      if (typeof source === 'string' && source !== fallbackUrl) {
        this.isLoading = false;
        return this.loadVRM(fallbackUrl);
      }
    } finally {
      if (isCreatedBlobUrl && loadUrl) {
        URL.revokeObjectURL(loadUrl);
      }
      this.isLoading = false;
    }
  }

  /**
   * Load custom user VRM file (from <input type="file"> or drag-and-drop)
   */
  async loadCustomVRMFile(file) {
    if (!file) return;
    this.activeAvatarId = 'custom';
    this.customAvatarName = file.name.replace(/\.[^/.]+$/, '');
    showNotification(`📂 Reading ${file.name}...`, 'info', 3000);
    return this.loadVRM(file, file.name);
  }

  /**
   * Select a specific model by avatar ID ('alicia', 'avatar_b', 'seed_san')
   */
  async selectAvatar(avatarId) {
    const item = this.availableAvatars.find(a => a.id === avatarId);
    if (item) {
      this.activeAvatarId = item.id;
      this.customAvatarName = null;
      return this.loadVRM(item.url, item.name);
    }
  }

  /**
   * Cycle between available avatars
   */
  async switchAvatar() {
    const ids = this.availableAvatars.map(a => a.id);
    const currIdx = ids.indexOf(this.activeAvatarId);
    const nextIdx = (currIdx + 1) % ids.length;
    return this.selectAvatar(ids[nextIdx]);
  }

  _cacheHumanoidBones() {
    if (!this.vrm || !this.vrm.humanoid) return;
    const h = this.vrm.humanoid;

    // Reset humanoid to canonical normalized T-pose baseline
    if (h.resetNormalizedPose) {
      h.resetNormalizedPose();
    }

    this.initialTPose = {};

    for (const key of Object.keys(this.bones)) {
      const node = h.getNormalizedBoneNode(key) || h.getRawBoneNode(key);
      this.bones[key] = node;
      if (node) {
        this.initialTPose[key] = {
          position: node.position.clone(),
          quaternion: node.quaternion.clone(),
          rotation: node.rotation.clone(),
          scale: node.scale.clone()
        };
      }
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
   * Reset specified humanoid bones (or all bones) to the stored normalized T-pose baseline
   */
  resetToTPose(boneKeys = null) {
    if (!this.initialTPose) return;
    if (!boneKeys && this.vrm?.humanoid?.resetNormalizedPose) {
      this.vrm.humanoid.resetNormalizedPose();
    }
    const keys = boneKeys || Object.keys(this.bones);
    for (const key of keys) {
      const bone = this.bones[key];
      const initial = this.initialTPose[key];
      if (bone && initial) {
        bone.quaternion.copy(initial.quaternion);
        bone.rotation.copy(initial.rotation);
        bone.position.copy(initial.position);
      }
    }
  }

  /**
   * Load and retarget genuine Mixamo locomotion (idle, walk, run) onto VRM Humanoid skeleton
   * using the official pixiv/three-vrm retargeting implementation
   */
  async _loadMixamoLocomotion() {
    try {
      const gltfLoader = new GLTFLoader();
      const gltf = await new Promise((resolve, reject) => {
        gltfLoader.load('./assets/vrm/Xbot.glb', resolve, undefined, reject);
      });

      if (!gltf.animations || gltf.animations.length === 0) return;

      const mixer = new THREE.AnimationMixer(this.vrm.scene);
      const actions = {};

      for (const animName of ['idle', 'walk', 'run']) {
        const rawClip = gltf.animations.find(a => a.name.toLowerCase() === animName.toLowerCase())
          || gltf.animations.find(a => a.name.toLowerCase().includes(animName.toLowerCase()));

        if (!rawClip) {
          console.warn(`Mixamo locomotion: clip "${animName}" not found in Xbot.glb`);
          continue;
        }

        const clip = await loadMixamoAnimation(gltf, this.vrm, rawClip);
        if (clip && clip.tracks.length > 0) {
          const action = mixer.clipAction(clip);
          action.setEffectiveWeight(animName === 'idle' ? 1.0 : 0.0);
          action.play();
          actions[animName] = action;
        }
      }

      if (actions.idle && actions.walk && actions.run) {
        this.mixer = mixer;
        this.actions = actions;
        this.hasWorkingMixamo = true;
        console.log('✅ Mixamo locomotion retargeted cleanly onto VRM skeleton via pixiv/three-vrm standard');
      } else {
        this.mixer = null;
        this.actions = null;
        this.hasWorkingMixamo = false;
      }
    } catch (err) {
      console.warn('Mixamo locomotion fallback:', err.message);
      this.mixer = null;
      this.actions = null;
      this.hasWorkingMixamo = false;
    }
  }

  /**
   * Dynamically retarget and play any external Mixamo FBX or GLTF animation on this avatar
   */
  async applyAnimation(urlOrAsset, clipName = 'mixamo.com') {
    if (!this.vrm) return null;
    try {
      const clip = await loadMixamoAnimation(urlOrAsset, this.vrm, clipName);
      if (clip) {
        if (!this.mixer) this.mixer = new THREE.AnimationMixer(this.vrm.scene);
        const action = this.mixer.clipAction(clip);
        action.reset().play();
        return action;
      }
    } catch (e) {
      console.warn('Failed to apply animation:', e);
    }
    return null;
  }

  toggleViewMode() {
    if (this._isInspectOrTransformActive()) return;
    this.viewMode = this.viewMode === 'first_person' ? 'third_person' : 'first_person';
    this._applyViewMode();
    showNotification(
      this.viewMode === 'first_person'
        ? '👁️ First-Person Mode (Head unclipped, body & hands visible)'
        : '🎥 Third-Person Mode Active',
      'info',
      2500
    );
  }

  _applyViewMode() {
    if (!this.vrm) return;

    const isFirstPerson = (this.viewMode === 'first_person');

    // In first person, hide head, hair, face, and eye meshes so hair never obstructs view,
    // while keeping torso, arms, hands, legs, and feet fully visible!
    this.vrm.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.frustumCulled = false;
        if (!isFirstPerson) {
          obj.visible = true;
        } else {
          const lowerName = (obj.name || '').toLowerCase();
          const isHeadPart = lowerName.includes('hair') || 
                             lowerName.includes('face') || 
                             lowerName.includes('eye') || 
                             lowerName.includes('head');
          obj.visible = !isHeadPart;
        }
      }
    });
  }

  /**
   * Configure pristine cel-shading, shadow casting, and normal handling for VRM avatar:
   * - Enable castShadow (clean grounded shadow on grass, path, terrain)
   * - Disable receiveShadow on avatar meshes (eliminates normalBias 0.5 self-shadow acne
   *   and inverted normal artifacts across thin limbs, neck, and face)
   * - Set DoubleSide on surface materials (prevents hollow gaps on single-sided hair/skirts/ribbons,
   *   with MToon automatically flipping backface normals via DOUBLE_SIDED to avoid inverted shading)
   * - Enforce BackSide on outline materials (required for inverted hull outline silhouette)
   * - Ensure clean giEqualizationFactor (around 0.15 - 0.20) for vibrant normal-based anime shading
   * - Keep atmospheric fog enabled
   */
  _setupVRMMaterials(root) {
    if (!root) return;
    root.traverse((o) => {
      o.userData.isVRM = true;
      o.userData.isAvatar = true;
      if (o.isMesh) {
        o.frustumCulled = false;
        o.visible = true;
        // Cast shadows onto the terrain and grass
        o.castShadow = true;
        // Do NOT receive self-shadows from the coarse directional light shadow map:
        // this completely resolves inverted shadow acne caused by scene normalBias (0.5).
        o.receiveShadow = false;

        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          const isOutline = m.isOutline || (m.name && m.name.includes('(Outline)'));
          m.fog = !isOutline;

          if (m.isMToonMaterial) {
            // Restore clean directional cel shading contrast
            if (m.giEqualizationFactor !== undefined) {
              m.giEqualizationFactor = 0.15;
            }

            if (isOutline) {
              // Outlines MUST render on BackSide so the inverted hull forms a clean boundary
              m.side = THREE.BackSide;
              m.castShadow = false;
              m.receiveShadow = false;
            } else {
              // Surface materials render on DoubleSide so hair strips and clothing folds are visible from all angles.
              // In MToon, DOUBLE_SIDED automatically flips the normal for backfaces (normal *= faceDirection),
              // preventing inverted lighting on the back of double-sided planes.
              m.side = THREE.DoubleSide;
            }
            m.needsUpdate = true;
          } else {
            // Standard/PBR fallback
            if (isOutline) {
              m.side = THREE.BackSide;
            } else {
              m.side = THREE.DoubleSide;
            }
            m.needsUpdate = true;
          }
        }
      }
    });
  }

  _isInspectOrTransformActive() {
    return !!(
      (typeof window !== 'undefined' && window.isInspectMode) ||
      (window.controls && (window.controls.isInspectMode || window.controls.enabled)) ||
      (window.transformManager && window.transformManager.isTransforming && window.transformManager.isTransforming())
    );
  }

  _setupInputListeners() {
    window.addEventListener('keydown', (e) => {
      // In Inspect mode or when interacting with gizmos, character controls are completely disabled
      if (this._isInspectOrTransformActive()) return;
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

    // Orbit Camera Drag Rotation (Desktop)
    window.addEventListener('mousedown', (e) => {
      // In Inspect mode or when interacting with gizmos, ignore character mouse look
      if (this._isInspectOrTransformActive()) return;
      if (e.button === 0 || e.button === 2) {
        this.isMouseDown = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (this._isInspectOrTransformActive()) return;
      if (!this.isMouseDown) return;

      const deltaX = e.clientX - this.lastMouseX;
      const deltaY = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      this.orbitYaw -= deltaX * 0.0055;
      this.orbitPitch -= deltaY * 0.0055;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch, -1.25, 1.25);
    });

    // Mouse Wheel Zoom: Seamless transition between 3rd person orbit and 1st person
    window.addEventListener('wheel', (e) => {
      if (this._isInspectOrTransformActive()) return;

      this.orbitDistance += e.deltaY * 0.0035;
      this.orbitDistance = THREE.MathUtils.clamp(this.orbitDistance, 0.45, 8.0);

      // Automatically switch to 1st person if zoomed in close enough (< 0.8m)
      if (this.orbitDistance < 0.80 && this.viewMode !== 'first_person') {
        this.viewMode = 'first_person';
        this._applyViewMode();
        showNotification('👁️ First-Person Mode (Zoom in)', 'info', 1800);
      } else if (this.orbitDistance >= 0.80 && this.viewMode === 'first_person') {
        this.viewMode = 'third_person';
        this._applyViewMode();
        showNotification('🎥 Third-Person Mode (Zoom out)', 'info', 1800);
      }
    }, { passive: true });

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

    const switchBtn = document.getElementById('switchAvatarBtn');
    if (switchBtn) {
      switchBtn.addEventListener('click', () => {
        this.switchAvatar();
      });
    }

    // Custom File Picker Input
    const fileInput = document.getElementById('vrmFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.loadCustomVRMFile(e.target.files[0]);
          e.target.value = ''; // Reset for re-selection
        }
      });
    }

    // Window Drag and Drop Support for .vrm and .glb
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.vrm') || lower.endsWith('.glb')) {
          this.loadCustomVRMFile(file);
        }
      }
    });
  }

  /* ---------------------------------------------------------- Main Update Loop */

  update(dt, vrContext = null) {
    if (!this.vrm) return;

    const isVR = this.renderer.xr.isPresenting;

    // 1. VR Tracking & Inverse Kinematics
    if (isVR) {
      this._updateVRTracking(dt, vrContext);
    }

    // 2. Desktop Mode (WASD Locomotion & Camera)
    if (!isVR) {
      this._updateDesktopLocomotion(dt);
    }

    // Ground Clamping
    const gh = groundHeight(this.position.x, this.position.z);
    this.position.y = Math.max(gh, 0.02);
    this.vrm.scene.position.copy(this.position);
    this.vrm.scene.rotation.y = this.avatarYaw;

    // Procedural Facial Expressions (Blink) & Idle Breathing
    this._updateExpressions(dt);

    // Camera Positioning (Desktop)
    if (!isVR) {
      if (this._isInspectOrTransformActive()) {
        // In Inspect Mode, camera is completely detached from the VRM character!
      } else {
        this._updateDesktopCamera();
      }
    }

    // VRM Physics & Spring Bones
    this.vrm.update(dt);
  }

  /* ---------------------------------------------------------- Desktop Controls */

  _updateDesktopLocomotion(dt) {
    if (this._isInspectOrTransformActive()) {
      this.isMoving = false;
      this.keys.w = false; this.keys.a = false; this.keys.s = false; this.keys.d = false;
      this.walkCycle = THREE.MathUtils.lerp(this.walkCycle, Math.round(this.walkCycle / Math.PI) * Math.PI, 0.12);
      this._animateDesktopBody(false, dt);
      return;
    }

    let moveX = 0, moveZ = 0;
    if (this.keys.w) moveZ -= 1;
    if (this.keys.s) moveZ += 1;
    if (this.keys.a) moveX -= 1;
    if (this.keys.d) moveX += 1;

    this.isMoving = (moveX !== 0 || moveZ !== 0);
    const currentSpeed = (this.keys.shift ? this.speed * this.sprintMultiplier : this.speed);

    if (this.isMoving) {
      // Camera horizontal forward and right vectors
      const camFwd = new THREE.Vector3(-Math.sin(this.orbitYaw), 0, -Math.cos(this.orbitYaw)).normalize();
      const camRgt = new THREE.Vector3(-camFwd.z, 0, camFwd.x).normalize();

      const moveDir = new THREE.Vector3();
      if (moveZ !== 0) moveDir.addScaledVector(camFwd, -moveZ);
      if (moveX !== 0) moveDir.addScaledVector(camRgt, moveX);
      moveDir.normalize();

      this.position.addScaledVector(moveDir, currentSpeed * dt);

      // Character faces forward in movement direction
      const targetYaw = (this.viewMode === 'first_person') 
        ? this.orbitYaw + Math.PI 
        : Math.atan2(moveDir.x, moveDir.z) + Math.PI;
      let diff = targetYaw - this.avatarYaw;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.avatarYaw += diff * 0.22;
      this.vrm.scene.rotation.y = this.avatarYaw;

      this.walkCycle += dt * (this.keys.shift ? 10.5 : 7.0);
    } else {
      if (this.viewMode === 'first_person') {
        const targetYaw = this.orbitYaw + Math.PI;
        let diff = targetYaw - this.avatarYaw;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.avatarYaw += diff * 0.15;
        this.vrm.scene.rotation.y = this.avatarYaw;
      }
      this.walkCycle = THREE.MathUtils.lerp(this.walkCycle, Math.round(this.walkCycle / Math.PI) * Math.PI, 0.12);
    }

    // Blend Mixamo locomotion actions if confirmed working, otherwise rich procedural locomotion
    if (this.hasWorkingMixamo && this.mixer && this.actions) {
      this.mixer.update(dt);
      const targetIdle = this.isMoving ? 0.0 : 1.0;
      const targetWalk = (this.isMoving && !this.keys.shift) ? 1.0 : 0.0;
      const targetRun = (this.isMoving && this.keys.shift) ? 1.0 : 0.0;
      const blendSpeed = dt * 10.0;
      if (this.actions.idle) this.actions.idle.setEffectiveWeight(THREE.MathUtils.lerp(this.actions.idle.getEffectiveWeight(), targetIdle, blendSpeed));
      if (this.actions.walk) this.actions.walk.setEffectiveWeight(THREE.MathUtils.lerp(this.actions.walk.getEffectiveWeight(), targetWalk, blendSpeed));
      if (this.actions.run) this.actions.run.setEffectiveWeight(THREE.MathUtils.lerp(this.actions.run.getEffectiveWeight(), targetRun, blendSpeed));
    } else {
      this._animateDesktopBody(this.isMoving, dt);
    }
  }

  /**
   * Reset / repose all bones to neutral rest pose before and after VR or mode transitions
   */
  reposeAvatar() {
    if (!this.vrm) return;

    // Reset all bones to pristine stored T-pose baseline
    this.resetToTPose();

    // Reset VRM spring bones physics
    if (this.vrm.springBoneManager?.reset) {
      this.vrm.springBoneManager.reset();
    }

    if (this.hasWorkingMixamo && this.actions?.idle) {
      this.actions.idle.setEffectiveWeight(1.0);
      if (this.actions.walk) this.actions.walk.setEffectiveWeight(0.0);
      if (this.actions.run) this.actions.run.setEffectiveWeight(0.0);
    } else {
      // Natural resting arms (arms angled down at sides, avoiding rigid T-pose)
      if (this.bones.leftUpperArm) this.bones.leftUpperArm.rotation.set(0, 0, -1.25);
      if (this.bones.rightUpperArm) this.bones.rightUpperArm.rotation.set(0, 0, 1.25);
      if (this.bones.leftLowerArm) this.bones.leftLowerArm.rotation.set(0, -0.2, 0);
      if (this.bones.rightLowerArm) this.bones.rightLowerArm.rotation.set(0, 0.2, 0);
    }

    this.walkCycle = 0;
    this.animWeights = { idle: 1.0, walk: 0.0, run: 0.0 };
  }

  onVRExit() {
    this.isVRDetached = false;
    this.reposeAvatar();
    this._applyViewMode();
  }

  /**
   * High-Quality Full-Body Procedural Locomotion Fallback
   */
  _animateDesktopBody(isMoving, dt) {
    // 0. Always reset active bones to stored T-pose baseline before applying this frame's animation
    this.resetToTPose([
      'hips', 'spine', 'chest', 'neck', 'head',
      'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
      'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
      'leftUpperArm', 'leftLowerArm', 'leftHand',
      'rightUpperArm', 'rightLowerArm', 'rightHand'
    ]);

    this.breathingTime += dt;
    const t = this.breathingTime;

    const isRunning = isMoving && this.keys.shift;
    const isWalking = isMoving && !this.keys.shift;

    const targetIdle = isMoving ? 0.0 : 1.0;
    const targetWalk = isWalking ? 1.0 : 0.0;
    const targetRun = isRunning ? 1.0 : 0.0;

    const blendSpeed = dt * 10.0;
    this.animWeights.idle = THREE.MathUtils.lerp(this.animWeights.idle, targetIdle, blendSpeed);
    this.animWeights.walk = THREE.MathUtils.lerp(this.animWeights.walk, targetWalk, blendSpeed);
    this.animWeights.run = THREE.MathUtils.lerp(this.animWeights.run, targetRun, blendSpeed);

    const wIdle = this.animWeights.idle;
    const wWalk = this.animWeights.walk;
    const wRun = this.animWeights.run;

    const cycle = this.walkCycle;

    // 1. Pelvis / Hips
    if (this.bones.hips) {
      const idleSway = Math.sin(t * 1.1) * 0.02 * wIdle;
      const walkRoll = Math.sin(cycle) * 0.04 * wWalk;
      const runTwist = Math.sin(cycle) * 0.08 * wRun;

      this.bones.hips.rotation.z = idleSway + walkRoll;
      this.bones.hips.rotation.y = runTwist;
      this.bones.hips.rotation.x = (isRunning ? 0.06 : 0.0) * wRun;
    }

    // 2. Spine & Chest
    if (this.bones.spine && this.bones.chest) {
      const breath = Math.sin(t * 2.2) * 0.035 * wIdle;
      const runLean = 0.18 * wRun;
      const walkCounterTwist = -Math.sin(cycle) * 0.05 * wWalk;

      this.bones.spine.rotation.x = breath * 0.5 + runLean * 0.5;
      this.bones.spine.rotation.y = walkCounterTwist * 0.5;

      this.bones.chest.rotation.x = breath + runLean;
      this.bones.chest.rotation.y = walkCounterTwist;
      this.bones.chest.rotation.z = -Math.sin(t * 1.1) * 0.015 * wIdle;
    }

    // 3. Legs, Knees & Feet
    if (this.bones.leftUpperLeg && this.bones.rightUpperLeg) {
      const walkStride = Math.sin(cycle) * 0.54 * wWalk;
      const runStride = Math.sin(cycle) * 0.82 * wRun;

      const idleLegL = 0.02 * wIdle;
      const idleLegR = -0.02 * wIdle;

      this.bones.leftUpperLeg.rotation.x = walkStride + runStride;
      this.bones.rightUpperLeg.rotation.x = -(walkStride + runStride);
      this.bones.leftUpperLeg.rotation.z = idleLegL;
      this.bones.rightUpperLeg.rotation.z = idleLegR;

      if (this.bones.leftLowerLeg && this.bones.rightLowerLeg) {
        const walkKneeL = Math.max(0, -Math.sin(cycle) * 0.85) * wWalk;
        const walkKneeR = Math.max(0, Math.sin(cycle) * 0.85) * wWalk;

        const runKneeL = Math.max(0, -Math.sin(cycle) * 1.35) * wRun;
        const runKneeR = Math.max(0, Math.sin(cycle) * 1.35) * wRun;

        const idleKneeL = 0.04 * wIdle;
        const idleKneeR = 0.02 * wIdle;

        this.bones.leftLowerLeg.rotation.x = walkKneeL + runKneeL + idleKneeL;
        this.bones.rightLowerLeg.rotation.x = walkKneeR + runKneeR + idleKneeR;
      }

      if (this.bones.leftFoot && this.bones.rightFoot) {
        const walkFootL = Math.sin(cycle + 0.3) * 0.22 * wWalk;
        const walkFootR = -Math.sin(cycle + 0.3) * 0.22 * wWalk;
        this.bones.leftFoot.rotation.x = walkFootL;
        this.bones.rightFoot.rotation.x = walkFootR;
      }
    }

    // 4. Arms & Forearms (Anatomically natural ZYX order without gimbal roll)
    if (this.bones.leftUpperArm && this.bones.rightUpperArm) {
      this.bones.leftUpperArm.rotation.order = 'ZYX';
      this.bones.rightUpperArm.rotation.order = 'ZYX';

      const baseArmZ = -1.25;
      const idleArmBreath = Math.sin(t * 2.2) * 0.02 * wIdle;

      const walkArmL = -Math.sin(cycle) * 0.42 * wWalk;
      const walkArmR = Math.sin(cycle) * 0.42 * wWalk;

      const runArmL = -Math.sin(cycle) * 0.75 * wRun;
      const runArmR = Math.sin(cycle) * 0.75 * wRun;

      this.bones.leftUpperArm.rotation.z = (baseArmZ - idleArmBreath) * (wIdle + wWalk) - 0.95 * wRun;
      this.bones.rightUpperArm.rotation.z = -(baseArmZ - idleArmBreath) * (wIdle + wWalk) + 0.95 * wRun;

      this.bones.leftUpperArm.rotation.y = -(walkArmL + runArmL);
      this.bones.rightUpperArm.rotation.y = (walkArmR + runArmR);

      if (this.bones.leftLowerArm && this.bones.rightLowerArm) {
        const runElbow = 0.75 * wRun;
        const walkElbow = 0.18 * wWalk;
        const idleElbow = 0.08 * wIdle;

        this.bones.leftLowerArm.rotation.y = -(runElbow + walkElbow + idleElbow);
        this.bones.rightLowerArm.rotation.y = (runElbow + walkElbow + idleElbow);
      }
    }

    // 5. Head Pitch
    if (this.bones.neck) {
      const pitchVal = Number.isFinite(this.orbitPitch) ? this.orbitPitch : 0;
      this.bones.neck.rotation.x = pitchVal * 0.35;
    }
  }

  _updateDesktopCamera() {
    if (this._isInspectOrTransformActive()) return;
    if (this.viewMode === 'first_person') {
      let eyeY = this.position.y + 1.48;
      if (this.bones.head) {
        const headWorld = new THREE.Vector3();
        this.bones.head.getWorldPosition(headWorld);
        eyeY = headWorld.y;
      }
      const fwd = new THREE.Vector3(-Math.sin(this.orbitYaw), 0, -Math.cos(this.orbitYaw));
      const eyePos = new THREE.Vector3(this.position.x, eyeY, this.position.z).addScaledVector(fwd, 0.12);

      this.camera.position.copy(eyePos);
      this.camera.rotation.set(this.orbitPitch, this.orbitYaw, 0, 'YXZ');
    } else {
      const lookTarget = new THREE.Vector3(this.position.x, this.position.y + 1.25, this.position.z);

      const cosPitch = Math.cos(this.orbitPitch);
      const sinPitch = Math.sin(this.orbitPitch);
      const sinYaw = Math.sin(this.orbitYaw);
      const cosYaw = Math.cos(this.orbitYaw);

      const rayDir = new THREE.Vector3(
        sinYaw * cosPitch,
        sinPitch,
        cosYaw * cosPitch
      ).normalize();

      const desiredDist = this.orbitDistance;
      let allowedDist = desiredDist;

      // 1. Raycast against trees, obstacles, models, and terrain
      const colliders = [];
      this.scene.traverse((obj) => {
        if (obj.isMesh && obj.visible) {
          const n = obj.name || '';
          if (n.includes('grass') || n.includes('brush') || n.includes('water') || n.includes('sky')) return;
          let isAvatarMesh = false;
          let p = obj;
          while (p) {
            if (p === this.vrm?.scene || p.userData?.isVRM || p.userData?.isAvatar) {
              isAvatarMesh = true;
              break;
            }
            p = p.parent;
          }
          if (isAvatarMesh) return;
          colliders.push(obj);
        }
      });

      this._camRaycaster.set(lookTarget, rayDir);
      this._camRaycaster.near = 0.35;
      this._camRaycaster.far = desiredDist;

      if (colliders.length > 0) {
        const hits = this._camRaycaster.intersectObjects(colliders, false);
        if (hits.length > 0) {
          allowedDist = Math.max(0.65, hits[0].distance - 0.35);
        }
      }

      // 2. Terrain ground height occlusion test
      const desiredPos = lookTarget.clone().addScaledVector(rayDir, allowedDist);
      const groundMinY = groundHeight(desiredPos.x, desiredPos.z) + 0.35;
      if (desiredPos.y < groundMinY) {
        allowedDist = Math.max(0.65, allowedDist * 0.75);
      }

      this.currentCameraDistance = THREE.MathUtils.lerp(this.currentCameraDistance, allowedDist, 0.22);

      const finalPos = lookTarget.clone().addScaledVector(rayDir, this.currentCameraDistance);
      finalPos.y = Math.max(finalPos.y, groundHeight(finalPos.x, finalPos.z) + 0.35);

      this.camera.position.lerp(finalPos, 0.25);
      this.camera.lookAt(lookTarget);
    }
  }

  /* ---------------------------------------------------------- Meta Quest VR Tracking */

  setVRDetached(detached) {
    this.isVRDetached = !!detached;
    if (this.isVRDetached) {
      this.viewMode = 'third_person';
      this._applyViewMode();
    } else {
      if (this.cameraRig) {
        this.position.x = this.cameraRig.position.x;
        this.position.z = this.cameraRig.position.z;
      }
      this.viewMode = 'first_person';
      this._applyViewMode();
    }
  }

  _updateVRTracking(dt, vrContext) {
    const xrCam = this.renderer.xr.getCamera ? this.renderer.xr.getCamera() : this.camera;
    const session = this.renderer.xr.getSession ? this.renderer.xr.getSession() : null;

    // 1. Sync avatar position with VR cameraRig (when attached)
    if (this.cameraRig && !this.isVRDetached) {
      this.position.x = this.cameraRig.position.x;
      this.position.z = this.cameraRig.position.z;
    }

    // 2. Headset Orientation -> Avatar Head & Spine
    const hmdQuat = new THREE.Quaternion();
    const hmdPos = new THREE.Vector3();
    xrCam.getWorldQuaternion(hmdQuat);
    xrCam.getWorldPosition(hmdPos);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(hmdQuat);
    const hmdYaw = Math.atan2(-forward.x, -forward.z);

    const yawDiff = hmdYaw - this.avatarYaw;
    if (Math.abs(yawDiff) > 0.6) {
      this.avatarYaw = THREE.MathUtils.lerp(this.avatarYaw, hmdYaw - Math.sign(yawDiff) * 0.6, 0.12);
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
            -1,
            'left'
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
            1,
            'right'
          );
        }
      }

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
   * Vector-based, gimbal-lock-free, canonical VRM normalized bone coordinate system
   */
  _solveArmIK(upperArm, lowerArm, hand, targetPos, targetQuat, l1, l2, poleSide = 1, sideName = 'left') {
    if (!upperArm || !lowerArm || !hand) return;

    // Reset arm bones to initial stored T-pose baseline before calculating IK
    if (this.initialTPose) {
      const uKey = sideName === 'left' ? 'leftUpperArm' : 'rightUpperArm';
      const lKey = sideName === 'left' ? 'leftLowerArm' : 'rightLowerArm';
      const hKey = sideName === 'left' ? 'leftHand' : 'rightHand';
      if (this.initialTPose[uKey]) upperArm.quaternion.copy(this.initialTPose[uKey].quaternion);
      if (this.initialTPose[lKey]) lowerArm.quaternion.copy(this.initialTPose[lKey].quaternion);
      if (this.initialTPose[hKey]) hand.quaternion.copy(this.initialTPose[hKey].quaternion);
      upperArm.updateMatrixWorld(true);
      lowerArm.updateMatrixWorld(true);
    }

    const shoulderPos = new THREE.Vector3();
    upperArm.getWorldPosition(shoulderPos);

    // Vector from shoulder to target hand in world space
    const toTarget = targetPos.clone().sub(shoulderPos);
    const targetDist = toTarget.length();
    if (targetDist < 0.001) return;

    const maxReach = (l1 + l2) * 0.998;
    const minReach = Math.abs(l1 - l2) + 0.04;
    const d = THREE.MathUtils.clamp(targetDist, minReach, maxReach);

    // Law of Cosines to solve shoulder offset alpha and elbow hinge beta
    const cosAlpha = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const alpha = Math.acos(THREE.MathUtils.clamp(cosAlpha, -1.0, 1.0));

    const targetDir = toTarget.clone().normalize();

    // Natural human elbow pole hint: points down, outward, and slightly back
    const avatarQuat = new THREE.Quaternion();
    this.vrm.scene.getWorldQuaternion(avatarQuat);
    const vDown = new THREE.Vector3(0, -1, 0).applyQuaternion(avatarQuat);
    const vSide = new THREE.Vector3(sideName === 'left' ? -1 : 1, 0, 0).applyQuaternion(avatarQuat);
    const vBack = new THREE.Vector3(0, 0, 1).applyQuaternion(avatarQuat);
    const poleDir = new THREE.Vector3()
      .addScaledVector(vDown, 0.70)
      .addScaledVector(vSide, 0.50)
      .addScaledVector(vBack, 0.30)
      .normalize();

    let planeNormal = new THREE.Vector3().crossVectors(targetDir, poleDir).normalize();
    if (planeNormal.lengthSq() < 0.001) {
      planeNormal.crossVectors(targetDir, vDown).normalize();
    }

    // Direct upper arm towards target rotated by alpha towards pole
    let upperArmDir = targetDir.clone().applyAxisAngle(planeNormal, alpha);
    if (upperArmDir.dot(poleDir) < targetDir.dot(poleDir)) {
      upperArmDir = targetDir.clone().applyAxisAngle(planeNormal, -alpha);
    }

    const elbowPos = shoulderPos.clone().addScaledVector(upperArmDir, l1);
    const lowerArmDir = targetPos.clone().sub(elbowPos).normalize();

    // Orient upperArm in parent space
    // In canonical VRM T-pose, leftUpperArm points along (+1, 0, 0), rightUpperArm points along (-1, 0, 0)
    const restDir = (sideName === 'left') ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0);

    const parentQuat = new THREE.Quaternion();
    upperArm.parent.getWorldQuaternion(parentQuat);
    const parentQuatInv = parentQuat.clone().invert();
    const localUpperDir = upperArmDir.clone().applyQuaternion(parentQuatInv);
    upperArm.quaternion.setFromUnitVectors(restDir, localUpperDir);
    upperArm.updateMatrixWorld(true);

    // Orient lowerArm in upperArm space
    const upperQuat = new THREE.Quaternion();
    upperArm.getWorldQuaternion(upperQuat);
    const upperQuatInv = upperQuat.clone().invert();
    const localLowerDir = lowerArmDir.clone().applyQuaternion(upperQuatInv);
    lowerArm.quaternion.setFromUnitVectors(restDir, localLowerDir);
    lowerArm.updateMatrixWorld(true);

    // Orient hand to match controller orientation in lowerArm space
    if (targetQuat) {
      const lowerQuat = new THREE.Quaternion();
      lowerArm.getWorldQuaternion(lowerQuat);
      const lowerQuatInv = lowerQuat.clone().invert();
      hand.quaternion.copy(lowerQuatInv.multiply(targetQuat));
    }
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
