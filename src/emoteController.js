/**
 * src/emoteController.js
 * Emote / facial expression controller for the VRM character.
 * Preset expressions blended smoothly via three-vrm's ExpressionManager,
 * with timed auto-return to neutral and optional UI buttons + hotkeys.
 */
import * as THREE from 'three';

export const EMOTES = [
  { id: 'neutral',   label: 'Neutral',   key: '1' },
  { id: 'happy',     label: 'Happy',     key: '2' },
  { id: 'sad',       label: 'Sad',       key: '3' },
  { id: 'angry',     label: 'Angry',     key: '4' },
  { id: 'surprised', label: 'Surprised', key: '5' },
  { id: 'relaxed',   label: 'Relaxed',   key: '6' },
];

const BLEND_SPEED = 8.0; // per-second blend rate in/out

/**
 * @param {() => import('@pixiv/three-vrm').VRM | null} getVrm - lazy VRM getter
 * @returns {{ setEmote, update, current, buildUI }}
 */
export function createEmoteController(getVrm) {
  let target = 'neutral';
  let holdUntil = 0; // absolute seconds (performance.now()/1000) when emote returns to neutral; 0 = held
  const weights = {};

  function setEmote(id, durationSec = 0) {
    if (!EMOTES.some((e) => e.id === id)) return;
    target = id;
    holdUntil = durationSec > 0 ? performance.now() / 1000 + durationSec : 0;
  }

  function update(dt, nowSec) {
    const vrm = getVrm();
    if (!vrm || !vrm.expressionManager) return;
    if (holdUntil && nowSec >= holdUntil) { target = 'neutral'; holdUntil = 0; }
    const step = Math.min(1, BLEND_SPEED * dt);
    for (const e of EMOTES) {
      const goal = e.id === target ? 1 : 0;
      weights[e.id] = THREE.MathUtils.lerp(weights[e.id] || 0, goal, step);
      try { vrm.expressionManager.setValue(e.id, weights[e.id]); } catch (_) { /* model lacks this expression */ }
    }
  }

  /** Build a minimal button row; returns the container element. */
  function buildUI(parentEl) {
    const bar = document.createElement('div');
    Object.assign(bar.style, { display: 'flex', gap: '4px' });
    for (const e of EMOTES) {
      const btn = document.createElement('button');
      btn.textContent = `${e.label} (${e.key})`;
      Object.assign(btn.style, { fontSize: '10px', padding: '3px 6px', background: 'rgba(255,255,255,0.08)', color: '#cfe8cf', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', cursor: 'pointer' });
      btn.addEventListener('click', () => setEmote(e.id, 3));
      bar.appendChild(btn);
    }
    if (parentEl) parentEl.appendChild(bar);
    return bar;
  }

  /** Register hotkeys (1-6). Pass a keydown handler-safe predicate if needed. */
  function bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const hit = EMOTES.find((em) => em.key === e.key);
      if (hit) setEmote(hit.id, 3);
    });
  }

  return { setEmote, update, buildUI, bindKeys, get current() { return target; } };
}
