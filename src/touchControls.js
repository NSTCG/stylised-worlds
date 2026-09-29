/**
 * src/touchControls.js
 * On-screen touch UI for mobile / Quest browser:
 * - Virtual WASD d-pad (bottom-left) with click-and-hold buttons + JUMP + SPRINT toggle
 * - Drag-to-look zone covering the right half of the viewport (click & hold, then drag)
 *
 * Movement flags live in the shared `inputState` object; controls.js and
 * vrmController.js merge them with their keyboard state each frame.
 */

// Shared touch input state — read by controls.js / vrmController.js
export const inputState = {
  w: false, a: false, s: false, d: false,
  shift: false, space: false
};

const LOOK_SENSITIVITY = 0.0045; // radians per CSS pixel (slightly higher than mouse for touch)
export function setupTouchControls(camera, domElement, api) {
  // api = { player, isWalkMode(), setWalkMode(bool) } from controls.js
  const player = api.player;
  const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!isCoarsePointer) return null; // desktop keeps keyboard + pointer-lock only

  /* ---------------------------------------------------------- DOM UI */
  const ui = document.createElement('div');
  ui.id = 'touchControlsUI';
  ui.style.cssText = 'position:fixed; inset:0; z-index:30; pointer-events:none; display:none; touch-action:none; user-select:none; -webkit-user-select:none;';

  // Look zone: right half of the screen (click & hold to look around)
  const lookZone = document.createElement('div');
  lookZone.style.cssText = 'position:absolute; top:0; right:0; width:50%; height:100%; pointer-events:auto; cursor:grab; touch-action:none;';
  // Subtle center crosshair hint inside the look zone
  const cross = document.createElement('div');
  cross.style.cssText = 'position:absolute; left:50%; top:50%; width:26px; height:26px; margin:-13px 0 0 -13px; border-radius:50%; border:2px solid rgba(255,255,255,.45); box-shadow:0 0 8px rgba(0,0,0,.5); pointer-events:none;';
  const dot = document.createElement('div');
  dot.style.cssText = 'position:absolute; left:50%; top:50%; width:4px; height:4px; margin:-2px 0 0 -2px; border-radius:50%; background:rgba(255,255,255,.7);';
  cross.appendChild(dot);
  lookZone.appendChild(cross);

  // D-pad cluster (bottom-left)
  const dpad = document.createElement('div');
  dpad.style.cssText = 'position:absolute; left:14px; bottom:60px; pointer-events:auto; touch-action:none;';
  const btnCss = 'pointer-events:auto; width:58px; height:58px; border-radius:14px; background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.35); color:#fff; font:bold 17px ui-monospace, Consolas, monospace; touch-action:none; user-select:none; -webkit-user-select:none; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px); box-shadow:0 4px 14px rgba(0,0,0,.45);';

  function makeMoveBtn(label, key) {
    const b = document.createElement('button');
    b.style.cssText = btnCss;
    b.textContent = label;
    let heldId = null;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      heldId = e.pointerId;
      inputState[key] = true;
      b.style.background = 'rgba(126, 240, 136, 0.5)';
      b.style.borderColor = '#7ef088';
      try { b.setPointerCapture(e.pointerId); } catch (_) {}
    });
    const release = (e) => {
      if (heldId !== e.pointerId) return;
      heldId = null;
      inputState[key] = false;
      b.style.background = 'rgba(255,255,255,.14)';
      b.style.borderColor = 'rgba(255,255,255,.35)';
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    return b;
  }

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns:repeat(3, 58px); grid-template-rows:repeat(2, 58px); gap:6px;';
  const btnW = makeMoveBtn('W', 'w'), btnA = makeMoveBtn('A', 'a'), btnS = makeMoveBtn('S', 's'), btnD = makeMoveBtn('D', 'd');
  grid.appendChild(btnW);
  grid.appendChild(btnA);
  grid.appendChild(btnS);
  grid.appendChild(btnD);

  const jumpBtn = document.createElement('button');
  jumpBtn.style.cssText = btnCss + ' background:rgba(56,189,248,.30); border-color:#38bdf8; font-size:12px;';
  jumpBtn.textContent = 'JUMP';
  let jumpId = null;
  const pressJump = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (jumpId !== null) return;
    jumpId = e.pointerId;
    inputState.space = true;
    jumpBtn.style.background = 'rgba(56,189,248,.6)';
    try { jumpBtn.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const releaseJump = (e) => {
    if (jumpId !== e.pointerId) return;
    jumpId = null;
    inputState.space = false;
    jumpBtn.style.background = 'rgba(56,189,248,.30)';
  };
  jumpBtn.addEventListener('pointerdown', pressJump);
  jumpBtn.addEventListener('pointerup', releaseJump);
  jumpBtn.addEventListener('pointercancel', releaseJump);

  const sprintBtn = document.createElement('button');
  sprintBtn.style.cssText = btnCss + ' background:rgba(245,158,11,.30); border-color:#f59e0b; font-size:12px;';
  sprintBtn.textContent = 'SPRINT';
  let sprintOn = false;
  const toggleSprint = (e) => {
    e.preventDefault();
    e.stopPropagation();
    sprintOn = !sprintOn;
    inputState.shift = sprintOn;
    sprintBtn.style.background = sprintOn ? 'rgba(245,158,11,.6)' : 'rgba(245,158,11,.30)';
  };
  sprintBtn.addEventListener('pointerdown', toggleSprint);

  dpad.appendChild(grid);
  const actionRow = document.createElement('div');
  actionRow.style.cssText = 'display:flex; gap:6px; margin-top:6px;';
  actionRow.appendChild(jumpBtn);
  actionRow.appendChild(sprintBtn);
  dpad.appendChild(actionRow);

  // Walk-mode toggle (touch equivalent of the V key / modeBtn)
  const walkBtn = document.createElement('button');
  walkBtn.style.cssText = btnCss + ' width:auto; padding:0 14px; height:40px; margin-top:8px; background:rgba(76,160,62,.4); border-color:#7ef088; font-size:12px;';
  walkBtn.textContent = '🚶 WALK / LOOK';
  walkBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    api.setWalkMode(!api.isWalkMode());
    syncUI();
  });
  dpad.appendChild(walkBtn);

  ui.appendChild(lookZone);
  ui.appendChild(dpad);
  document.body.appendChild(ui);

  /* ---------------------------------------------------------- drag-to-look */
  let lookId = null;
  let lastX = 0, lastY = 0;

  lookZone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (lookId !== null) return; // second finger: ignore until first releases
    lookId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    // Starting a look-drag in orbit mode switches into walk mode (first-person)
    if (!api.isWalkMode()) {
      api.setWalkMode(true);
      syncUI();
    }
    try { lookZone.setPointerCapture(e.pointerId); } catch (_) {}
  });

  lookZone.addEventListener('pointermove', (e) => {
    if (lookId !== e.pointerId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    player.yaw -= dx * LOOK_SENSITIVITY;
    player.pitch = Math.max(-Math.PI * 0.44, Math.min(Math.PI * 0.44, player.pitch - dy * LOOK_SENSITIVITY));
  });

  const endLook = (e) => {
    if (lookId !== e.pointerId) return;
    lookId = null;
  };
  lookZone.addEventListener('pointerup', endLook);
  lookZone.addEventListener('pointercancel', endLook);

  /* ---------------------------------------------------------- visibility sync */
  function syncUI() {
    ui.style.display = api.isWalkMode() ? 'block' : 'none';
    walkBtn.textContent = api.isWalkMode() ? '🔭 ORBIT MODE' : '🚶 WALK / LOOK';
    walkBtn.style.background = api.isWalkMode() ? 'rgba(255,255,255,.18)' : 'rgba(76,160,62,.4)';
  }

  return {
    ui,
    update: () => {
      // Re-sync in case mode changed from keyboard (V key) or other UI
      if ((ui.style.display === 'block') !== api.isWalkMode()) syncUI();
    }
  };
}
