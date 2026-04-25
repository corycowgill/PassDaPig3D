import { PigScene } from './scene.js';
import { Game, scoreRoll } from './game.js';
import { UI } from './ui.js';
import { tintPig } from './pig.js';

const canvas = document.getElementById('stage');
const aimSvg = document.getElementById('aim');
const aimLine = document.getElementById('aim-line');
const aimPower = document.getElementById('aim-power');

const ui = new UI();
let scene = new PigScene(canvas);
let game = null;

let inRoll = false;
let waitingForRest = false;
let aiTimer = null;

// Drag-to-aim parameters. The drag *length* is the primary power signal;
// drag *speed* nudges the spin so a flick has more english than a slow drag
// of the same length. Min length filters out accidental taps.
const DRAG_MIN_PX = 28;     // shorter than this = treated as a tap
const DRAG_FULL_PX = 260;   // distance at which power saturates
const TAP_MAX_MS = 220;     // pointerdown→up under this with little move = tap

const swipe = {
  active: false,
  startX: 0, startY: 0, startT: 0,
  curX: 0,   curY: 0,
};

function clientPos(e) {
  if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function onPointerDown(e) {
  if (inRoll || waitingForRest) return;
  if (!canRollCurrent()) return;
  const p = clientPos(e);
  swipe.active = true;
  swipe.startX = swipe.curX = p.x;
  swipe.startY = swipe.curY = p.y;
  swipe.startT = performance.now();
  // Prime aim overlay (still hidden until drag exceeds threshold).
  hideAim();
}

function onPointerMove(e) {
  if (!swipe.active) return;
  const p = clientPos(e);
  swipe.curX = p.x;
  swipe.curY = p.y;
  const dx = swipe.curX - swipe.startX;
  const dy = swipe.curY - swipe.startY;
  const dist = Math.hypot(dx, dy);
  if (dist < DRAG_MIN_PX || dy > -10) {
    hideAim();
    return;
  }
  drawAim(dist, dx, dy);
}

function onPointerUp(e) {
  if (!swipe.active) return;
  swipe.active = false;
  hideAim();

  const p = clientPos(e);
  const dx = p.x - swipe.startX;
  const dy = p.y - swipe.startY;
  const dt = Math.max(1, performance.now() - swipe.startT);
  const dist = Math.hypot(dx, dy);

  // Tap (short, brief, mostly stationary) → default forward toss.
  if (dist < DRAG_MIN_PX && dt < TAP_MAX_MS) {
    doRoll({ x: 0, y: 1 }, 0.65);
    return;
  }
  // Drag must be meaningfully upward to count as a roll.
  if (dist < DRAG_MIN_PX || dy > -20) return;

  // Power: primarily drag length, with a small flick bonus from speed.
  const lenPower = Math.min(1, dist / DRAG_FULL_PX);
  const flick = Math.min(0.2, (dist / dt) / 8); // px/ms → small bonus
  const power = Math.min(1, lenPower + flick);

  // Direction: clamp to forward half-plane so a sideways/diagonal swipe still
  // sends the pigs onto the felt rather than into the player.
  const dir = clampForward(dx, dy);
  doRoll(dir, power);
}

// Convert a screen-space drag (dx, dy with +y down) into a forward-biased
// world-launch direction with +y meaning "up the screen / towards the far rail".
// Sideways component is preserved up to ~45°, then clamped.
function clampForward(dx, dy) {
  let fx = dx;
  let fy = -dy;       // upward swipe → +fy
  if (fy < 0.05) fy = 0.05;
  // Limit horizontal/vertical ratio to ~tan(45°) = 1 so the throw never
  // points >45° from "straight forward".
  const ratio = Math.abs(fx) / fy;
  if (ratio > 1) fx = Math.sign(fx) * fy;
  const m = Math.hypot(fx, fy) || 1;
  return { x: fx / m, y: fy / m };
}

// Render the aim arrow as an SVG line + power label. Color & label intensity
// scale with power so the player can feel weak vs hard throws.
function drawAim(dist, dx, dy) {
  const x1 = swipe.startX;
  const y1 = swipe.startY;
  const x2 = swipe.curX;
  const y2 = swipe.curY;
  aimLine.setAttribute('x1', x1);
  aimLine.setAttribute('y1', y1);
  aimLine.setAttribute('x2', x2);
  aimLine.setAttribute('y2', y2);

  const pct = Math.min(1, dist / DRAG_FULL_PX);
  const label = pct >= 0.99 ? 'MAX' : `${Math.round(pct * 100)}%`;
  // Place label near drag end, offset slightly perpendicular for readability.
  const ox = -dy / (Math.hypot(dx, dy) || 1) * 18;
  const oy = dx  / (Math.hypot(dx, dy) || 1) * 18;
  aimPower.setAttribute('x', x2 + ox);
  aimPower.setAttribute('y', y2 + oy);
  aimPower.textContent = label;

  let cls = 'weak';
  if (pct > 0.25) cls = 'medium';
  if (pct > 0.6)  cls = 'strong';
  if (pct > 0.9)  cls = 'max';
  aimSvg.classList.remove('weak', 'medium', 'strong', 'max');
  aimSvg.classList.add(cls);
  aimSvg.classList.remove('hidden');
}

function hideAim() {
  aimSvg.classList.add('hidden');
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', () => { swipe.active = false; hideAim(); });
// Prevent accidental page scroll on iOS Safari when interacting with canvas
canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// --- Wire UI ---
ui.onStart(() => {
  const players = ui.getPlayers();
  game = new Game({ players, target: ui.target });
  applyCurrentPlayerColor();
  ui.showGame();
  ui.renderScoreboard(game);
  ui.renderTurn(game, isMobileLike() ? 'Drag up to aim, release to roll' : 'Drag up to aim, or press Roll');
  ui.setButtons({ canRoll: true, canBank: false });
  scene.resetPigs();
  maybeStartAITurn();
});

ui.onRoll(() => {
  // Default straight-forward roll with medium power
  doRoll({ x: (Math.random() - 0.5) * 0.15, y: 1 }, 0.7);
});

ui.onBank(() => {
  if (!game || inRoll || waitingForRest) return;
  const r = game.bank();
  ui.renderScoreboard(game);
  if (r.gameover) {
    ui.showWinner(game);
    return;
  }
  ui.renderTurn(game, 'Pass the pigs...');
  ui.setButtons({ canRoll: true, canBank: false });
  applyCurrentPlayerColor();
  scene.resetPigs();
  maybeStartAITurn();
});

ui.onQuit(() => { cancelAll(); ui.showMenu(); });

ui.onPlayAgain(() => {
  if (!game) return;
  cancelAll();
  game = new Game({ players: game.players.map(p => ({ name: p.name, ai: p.ai })), target: game.target });
  applyCurrentPlayerColor();
  ui.showGame();
  ui.renderScoreboard(game);
  ui.renderTurn(game, nextTurnStatus());
  ui.setButtons({ canRoll: true, canBank: false });
  scene.resetPigs();
  maybeStartAITurn();
});

ui.onBackToMenu(() => { cancelAll(); ui.showMenu(); });

function cancelAll() {
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  inRoll = false;
  waitingForRest = false;
  swipe.active = false;
  hideAim();
}

function canRollCurrent() {
  if (!game || game.state === 'gameover') return false;
  if (!document.getElementById('menu').classList.contains('hidden')) return false;
  if (!document.getElementById('help').classList.contains('hidden')) return false;
  if (!document.getElementById('winner').classList.contains('hidden')) return false;
  return !inRoll && !waitingForRest && !game.currentPlayer.ai;
}

function applyCurrentPlayerColor() {
  if (!game) return;
  const p = game.currentPlayer;
  for (const { mesh } of scene.pigs) {
    tintPig(mesh, p.color);
  }
}

function isMobileLike() {
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}

function doRoll(dir, power) {
  if (!game || inRoll || waitingForRest) return;
  if (game.state === 'gameover') return;
  inRoll = true;
  waitingForRest = true;
  ui.setButtons({ canRoll: false, canBank: false });
  ui.renderTurn(game, 'Rolling...');
  scene.resetPigs();
  setTimeout(() => {
    scene.rollPigs(dir, power);
    inRoll = false;
    waitForPigsToRest();
  }, 120);
}

// Don't score until the pigs have actually been still for a continuous
// stretch (~250ms). A pig wobbling on its snout could read "at rest" for a
// single frame between two oscillations, and we don't want to lock in the
// wrong scoring position.
function waitForPigsToRest() {
  const STABLE_MS = 260;
  const TIMEOUT_MS = 7000;
  const start = performance.now();
  let stableSince = null;
  const tick = () => {
    const now = performance.now();
    if (scene.pigsAtRest()) {
      if (stableSince == null) stableSince = now;
      if (now - stableSince >= STABLE_MS) {
        onRollResolved();
        return;
      }
    } else {
      stableSince = null;
    }
    if (now - start >= TIMEOUT_MS) {
      // Safety: settle anyway. Nudge any lingering velocity to zero so the
      // detected orientation is read from a stable pose.
      scene.forceSleepPigs();
      onRollResolved();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function onRollResolved() {
  waitingForRest = false;
  let result;
  try {
    result = scoreRoll(scene.getPigStates());
  } catch (err) {
    console.error('scoreRoll failed:', err);
    result = { positions: ['side-plain', 'side-plain'], name: 'Reroll', detail: 'Scoring hiccup — try again.', points: 0, special: null };
  }
  const outcome = game.onRollResolved(result);
  ui.flashResult(result, !outcome.busted);
  ui.renderScoreboard(game);

  if (outcome.busted) {
    setTimeout(() => {
      if (!game || game.state === 'gameover') return;
      applyCurrentPlayerColor();
      ui.renderTurn(game, nextTurnStatus());
      ui.setButtons({ canRoll: true, canBank: false });
      scene.resetPigs();
      maybeStartAITurn();
    }, 1400);
    return;
  }

  ui.renderTurn(game, 'Roll again or bank');
  ui.setButtons({
    canRoll: !game.currentPlayer.ai,
    canBank: !game.currentPlayer.ai && game.turnScore > 0,
  });

  if (game.currentPlayer.ai) scheduleAIDecision();
}

function nextTurnStatus() {
  if (!game) return '';
  if (game.currentPlayer.ai) return 'AI is rolling...';
  return isMobileLike() ? 'Drag up to aim, release to roll' : 'Drag up to aim, or press Roll';
}

function maybeStartAITurn() {
  if (!game || game.state === 'gameover') return;
  if (game.currentPlayer.ai) {
    ui.setButtons({ canRoll: false, canBank: false });
    ui.renderTurn(game, 'AI is thinking...');
    aiTimer = setTimeout(() => aiRoll(), 700);
  }
}

function scheduleAIDecision() {
  aiTimer = setTimeout(() => {
    if (!game || game.state === 'gameover') return;
    if (game.aiShouldBank()) {
      const r = game.bank();
      ui.renderScoreboard(game);
      if (r.gameover) {
        ui.showWinner(game);
        return;
      }
      ui.renderTurn(game, 'Pass the pigs...');
      applyCurrentPlayerColor();
      ui.setButtons({ canRoll: true, canBank: false });
      scene.resetPigs();
      maybeStartAITurn();
    } else {
      aiRoll();
    }
  }, 900);
}

function aiRoll() {
  const dir = { x: (Math.random() - 0.5) * 0.3, y: 1 };
  const power = 0.55 + Math.random() * 0.35;
  doRoll(dir, power);
}

// Initial menu
ui.showMenu();
