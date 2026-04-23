import { PigScene } from './scene.js';
import { Game, scoreRoll } from './game.js';
import { UI } from './ui.js';
import { tintPig } from './pig.js';

const canvas = document.getElementById('stage');
const ui = new UI();
let scene = new PigScene(canvas);
let game = null;

let inRoll = false;
let waitingForRest = false;
let aiTimer = null;

// --- Swipe / drag roll control ---
const swipe = {
  active: false,
  startX: 0,
  startY: 0,
  startT: 0,
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
  swipe.startX = p.x;
  swipe.startY = p.y;
  swipe.startT = performance.now();
}
function onPointerUp(e) {
  if (!swipe.active) return;
  swipe.active = false;
  const p = clientPos(e);
  const dx = p.x - swipe.startX;
  const dy = p.y - swipe.startY;
  const dt = Math.max(1, performance.now() - swipe.startT);
  const dist = Math.hypot(dx, dy);

  // Must be a meaningful upward-ish swipe
  if (dist < 40 || dy > -30) return; // need at least ~40px with decent upward travel

  const speed = dist / dt; // px per ms
  // Normalize vector so "up" on screen maps to +y here (we flip in scene)
  const mag = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / mag, y: -dy / mag }; // flip so upward swipe => +y
  const power = Math.min(1, speed / 2.5); // 2.5 px/ms ~ full power
  doRoll(dir, power);
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', () => { swipe.active = false; });

// --- Wire UI ---
ui.onStart(() => {
  const players = ui.getPlayers();
  game = new Game({ players, target: ui.target });
  applyCurrentPlayerColor();
  ui.showGame();
  ui.renderScoreboard(game);
  ui.renderTurn(game, isMobileLike() ? 'Swipe up to roll' : 'Swipe up or press Roll');
  ui.setButtons({ canRoll: true, canBank: false });
  scene.resetPigs();
  maybeStartAITurn();
});

ui.onRoll(() => {
  // Default straight-forward roll with medium power
  doRoll({ x: (Math.random() - 0.5) * 0.2, y: 1 }, 0.75);
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

ui.onQuit(() => {
  cancelAll();
  ui.showMenu();
});

ui.onPlayAgain(() => {
  if (!game) return;
  cancelAll();
  // Reset scores, keep same players
  game = new Game({ players: game.players.map(p => ({ name: p.name, ai: p.ai })), target: game.target });
  applyCurrentPlayerColor();
  ui.showGame();
  ui.renderScoreboard(game);
  ui.renderTurn(game, nextTurnStatus());
  ui.setButtons({ canRoll: true, canBank: false });
  scene.resetPigs();
  maybeStartAITurn();
});

ui.onBackToMenu(() => {
  cancelAll();
  ui.showMenu();
});

function cancelAll() {
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  inRoll = false;
  waitingForRest = false;
  swipe.active = false;
}

function canRollCurrent() {
  if (!game || game.state === 'gameover') return false;
  const ui_menu_open = !document.getElementById('menu').classList.contains('hidden');
  const ui_help_open = !document.getElementById('help').classList.contains('hidden');
  const ui_winner_open = !document.getElementById('winner').classList.contains('hidden');
  if (ui_menu_open || ui_help_open || ui_winner_open) return false;
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
  // Slight delay so reset is visible, then fling
  setTimeout(() => {
    scene.rollPigs(dir, power);
    inRoll = false;
    waitForPigsToRest();
  }, 120);
}

function waitForPigsToRest() {
  const deadline = performance.now() + 6000; // safety timeout
  const tick = () => {
    if (scene.pigsAtRest() || performance.now() > deadline) {
      onRollResolved();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function onRollResolved() {
  waitingForRest = false;
  const result = scoreRoll(scene.getPigStates());
  const outcome = game.onRollResolved(result);
  ui.flashResult(result, !outcome.busted);
  ui.renderScoreboard(game);

  if (outcome.busted) {
    // Turn already ended internally; render new turn after a pause
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

  // Good roll
  ui.renderTurn(game, 'Roll again or bank');
  ui.setButtons({
    canRoll: !game.currentPlayer.ai,
    canBank: !game.currentPlayer.ai && game.turnScore > 0,
  });

  if (game.currentPlayer.ai) {
    scheduleAIDecision();
  }
}

function nextTurnStatus() {
  if (!game) return '';
  if (game.currentPlayer.ai) return 'AI is rolling...';
  return isMobileLike() ? 'Swipe up to roll' : 'Swipe up or press Roll';
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
  const dir = { x: (Math.random() - 0.5) * 0.4, y: 1 };
  const power = 0.55 + Math.random() * 0.4;
  doRoll(dir, power);
}

// Prevent accidental page scroll on iOS Safari when interacting with canvas
canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// Initial menu
ui.showMenu();
