import { detectPigPosition } from './pig.js';

// Distance backup for the Oinker check. The pig physics body is a ~1.47m
// long box plus a snout sphere out front, so two pigs touching head-to-head
// have centers ~1.55m apart, while two pigs side-by-side along the narrow
// axis are ~0.95m apart. Threshold 1.65 catches every realistic touching
// configuration (including snout-into-rump) while still leaving plenty of
// daylight for legitimate Pig Outs where the pigs landed close but separated.
function pigsCloseEnoughToBeTouching(a, b) {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  const dz = a.position.z - b.position.z;
  return Math.hypot(dx, dy, dz) < 1.65;
}

// Pass the Pigs single-pig positions.
// 'side-dot' / 'side-plain' are the two sides (one has the printed dot).
export const POSITIONS = [
  'side-dot',
  'side-plain',
  'razorback',
  'trotter',
  'snouter',
  'jowler',
];

// Points for each single-pig position (used when combining across two pigs).
const POINTS = {
  'side-dot': 0,
  'side-plain': 0,
  'razorback': 5,
  'trotter': 5,
  'snouter': 10,
  'jowler': 15,
};

// Evaluate both pigs' final positions and return a scored outcome.
//
// pigStates = [{ position, quaternion, body, dotSide }]
// opts.contacted = true if the physics engine fired a pig-pig collision
//                  event at any point during the throw (authoritative).
//
// Returns { positions: [p1, p2], name, points, special }
// special can be: 'pig-out', 'oinker', 'piggyback'
export function scoreRoll(pigStates, opts = {}) {
  const [a, b] = pigStates;
  const contacted = !!opts.contacted;

  // Special: piggy-back — one pig resting on top of the other.
  const dx = a.position.x - b.position.x;
  const dz = a.position.z - b.position.z;
  const dy = Math.abs(a.position.y - b.position.y);
  const planar = Math.hypot(dx, dz);
  if (planar < 1.2 && dy > 0.6) {
    return { positions: ['piggyback', 'piggyback'], name: 'Piggy Back!', detail: 'You lose ALL your points.', points: 0, special: 'piggyback' };
  }

  // Special: oinker — pigs touched at any point during the roll, OR are
  // resting close enough to count as touching at the end. Using the physics
  // collision flag as the primary signal means a brief mid-air bump that
  // bounced the pigs apart still busts the turn (matching "Makin' Bacon").
  if (contacted || pigsCloseEnoughToBeTouching(a, b)) {
    return { positions: ['oinker', 'oinker'], name: 'Oinker!', detail: 'Pigs touched — you lose ALL your points.', points: 0, special: 'oinker' };
  }

  // Score each pig directly from its rested physics orientation.
  const p1 = detectPigPosition(a.quaternion, a.dotSide);
  const p2 = detectPigPosition(b.quaternion, b.dotSide);

  // Pig Out: one on each side (opposite-dot siders).
  const siders = ['side-dot', 'side-plain'];
  if (siders.includes(p1) && siders.includes(p2)) {
    if (p1 === p2) {
      return { positions: [p1, p2], name: 'Sider', detail: 'Both pigs on the same side.', points: 1, special: null };
    } else {
      return { positions: [p1, p2], name: 'Pig Out', detail: 'One pig on each side. Turn ends with 0.', points: 0, special: 'pig-out' };
    }
  }

  // Doubles (non-side)
  if (p1 === p2) {
    const table = { razorback: 20, trotter: 20, snouter: 40, jowler: 60 };
    if (table[p1] != null) {
      return {
        positions: [p1, p2],
        name: `Double ${labelOf(p1)}!`,
        detail: `Both pigs ${labelOf(p1).toLowerCase()}.`,
        points: table[p1],
        special: null,
      };
    }
  }

  // Mixed combo: if either is a sider, only the non-sider scores.
  const s1 = siders.includes(p1) ? 0 : POINTS[p1];
  const s2 = siders.includes(p2) ? 0 : POINTS[p2];
  const total = s1 + s2;
  const name = describeMixed(p1, p2);
  return {
    positions: [p1, p2],
    name,
    detail: `${labelOf(p1)} + ${labelOf(p2)}`,
    points: total,
    special: null,
  };
}

function describeMixed(p1, p2) {
  const onlyOne = (p) => `${labelOf(p)} + Sider`;
  const siders = ['side-dot', 'side-plain'];
  if (siders.includes(p1) && !siders.includes(p2)) return onlyOne(p2);
  if (siders.includes(p2) && !siders.includes(p1)) return onlyOne(p1);
  return `${labelOf(p1)} + ${labelOf(p2)}`;
}

export function labelOf(pos) {
  switch (pos) {
    case 'side-dot': return 'Sider';
    case 'side-plain': return 'Sider';
    case 'razorback': return 'Razorback';
    case 'trotter': return 'Trotter';
    case 'snouter': return 'Snouter';
    case 'jowler': return 'Leaning Jowler';
    default: return pos;
  }
}

// ---- Game state / turn flow ----
export const PLAYER_COLORS = [
  0xff6b8a, // pink
  0x66c2ff, // blue
  0xffd166, // yellow
  0x7ad66b, // green
];

export class Game {
  constructor(opts) {
    // opts: { players: [{name, ai?}], target: number }
    this.players = opts.players.map((p, i) => ({
      name: p.name || `Player ${i + 1}`,
      ai: !!p.ai,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      total: 0,
    }));
    this.target = opts.target || 100;
    this.currentIdx = 0;
    this.turnScore = 0;
    this.state = 'idle'; // idle | rolling | resolved | gameover
    this.winner = null;
    this.history = []; // last few rolls this turn (for flavor)
  }

  get currentPlayer() { return this.players[this.currentIdx]; }

  onRollResolved(result) {
    // Apply result to turn score / state.
    this.history.push(result);
    if (result.special === 'oinker' || result.special === 'piggyback') {
      this.currentPlayer.total = 0;
      this.turnScore = 0;
      this._endTurn(false);
      return { busted: true, result };
    }
    if (result.special === 'pig-out') {
      this.turnScore = 0;
      this._endTurn(false);
      return { busted: true, result };
    }
    this.turnScore += result.points;
    // Check for win after a successful roll (player still needs to bank, but if
    // the turn score alone would push past target, let them choose to bank).
    return { busted: false, result };
  }

  bank() {
    if (this.state === 'gameover') return;
    this.currentPlayer.total += this.turnScore;
    this.turnScore = 0;
    if (this.currentPlayer.total >= this.target) {
      this.state = 'gameover';
      this.winner = this.currentPlayer;
      return { gameover: true };
    }
    this._endTurn(true);
    return { gameover: false };
  }

  _endTurn() {
    this.turnScore = 0;
    this.history = [];
    this.currentIdx = (this.currentIdx + 1) % this.players.length;
  }

  // Very lightweight AI: pushes when behind, plays safe when ahead.
  aiShouldBank() {
    const me = this.currentPlayer;
    const opp = this.players.reduce((best, p, i) =>
      (i !== this.currentIdx && p.total > (best?.total ?? -1) ? p : best), null);
    const oppTotal = opp ? opp.total : 0;
    const projected = me.total + this.turnScore;

    // Always bank if it wins.
    if (projected >= this.target) return true;

    // Push aggressively when behind.
    const deficit = oppTotal - me.total;
    let threshold = 20;
    if (deficit > 20) threshold = 30;
    if (deficit > 40) threshold = 40;
    if (deficit > 60) threshold = 55;
    // Play safer when ahead.
    if (deficit < -15) threshold = 15;
    if (deficit < -30) threshold = 10;

    // Occasional "gut check" randomness so AI isn't perfectly predictable.
    threshold += Math.floor((Math.random() - 0.5) * 6);

    return this.turnScore >= threshold;
  }
}
