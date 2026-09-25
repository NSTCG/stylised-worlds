import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function setupPostProcessing(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.65, 0.84);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let usePostProcessing = false;

  function setPostProcessing(enabled) {
    usePostProcessing = enabled;
    bloom.enabled = usePostProcessing;
    const btn = document.getElementById('fxBtn');
    if (btn) {
      if (usePostProcessing) {
        btn.textContent = '✨ FX: ON (P)';
        btn.style.background = 'rgba(255,255,255,0.2)';
      } else {
        btn.textContent = '⚡ Quest Mode: FX OFF (P)';
        btn.style.background = 'rgba(230, 140, 30, 0.5)';
      }
    }
  }

  function togglePostProcessing() {
    setPostProcessing(!usePostProcessing);
  }

  // Initialize OFF by default (No post-processing, No Unreal Bloom)
  setPostProcessing(false);

  document.getElementById('fxBtn')?.addEventListener('click', togglePostProcessing);

  return {
    composer,
    isPostProcessingActive: () => usePostProcessing,
    setPostProcessing,
    togglePostProcessing
  };
}
