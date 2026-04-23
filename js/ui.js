import { PLAYER_COLORS } from './game.js';

// Small helpers
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const hexToCss = (h) => '#' + h.toString(16).padStart(6, '0');

export class UI {
  constructor() {
    this.elements = {
      menu: $('#menu'),
      hud: $('#hud'),
      help: $('#help'),
      winner: $('#winner'),
      scoreboard: $('#scoreboard'),
      turnPlayer: $('#turnPlayer'),
      turnStatus: $('#turnStatus'),
      turnScore: $('#turnScore'),
      rollBtn: $('#rollBtn'),
      bankBtn: $('#bankBtn'),
      helpBtn: $('#helpBtn'),
      menuHelpBtn: $('#menuHelpBtn'),
      closeHelp: $('#closeHelp'),
      closeHelp2: $('#closeHelp2'),
      quitBtn: $('#quitBtn'),
      startBtn: $('#startBtn'),
      playerNames: $('#playerNames'),
      rollResult: $('#rollResult'),
      winnerName: $('#winnerName'),
      finalScores: $('#finalScores'),
      playAgain: $('#playAgain'),
      backToMenu: $('#backToMenu'),
    };

    this.mode = 'ai';    // 'ai' | '2' | '3' | '4'
    this.target = 100;
    this._rollResultTimer = null;

    this._bindMenu();
  }

  _bindMenu() {
    $$('.toggle[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.toggle[data-mode]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.mode = btn.dataset.mode;
        this._renderPlayerNames();
      });
    });

    $$('.toggle[data-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.toggle[data-target]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.target = parseInt(btn.dataset.target, 10);
      });
    });

    this.elements.menuHelpBtn.addEventListener('click', () => this.showHelp());
    this.elements.helpBtn.addEventListener('click', () => this.showHelp());
    this.elements.closeHelp.addEventListener('click', () => this.hideHelp());
    this.elements.closeHelp2.addEventListener('click', () => this.hideHelp());

    this._renderPlayerNames();
  }

  _renderPlayerNames() {
    const n = this.mode === 'ai' ? 2 : parseInt(this.mode, 10);
    const container = this.elements.playerNames;
    container.innerHTML = '';
    const label = document.createElement('label');
    label.textContent = 'Players';
    container.appendChild(label);
    for (let i = 0; i < n; i++) {
      const row = document.createElement('div');
      row.className = 'name-row';

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = hexToCss(PLAYER_COLORS[i]);
      row.appendChild(swatch);

      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 14;
      input.dataset.idx = i;
      if (this.mode === 'ai' && i === 1) {
        input.value = 'Ham-AI';
        input.readOnly = true;
      } else {
        input.placeholder = `Player ${i + 1}`;
      }
      row.appendChild(input);

      container.appendChild(row);
    }
  }

  getPlayers() {
    const n = this.mode === 'ai' ? 2 : parseInt(this.mode, 10);
    const inputs = $$('#playerNames input');
    const players = [];
    for (let i = 0; i < n; i++) {
      const name = (inputs[i]?.value || '').trim() || `Player ${i + 1}`;
      const ai = this.mode === 'ai' && i === 1;
      players.push({ name, ai });
    }
    return players;
  }

  onStart(fn) { this.elements.startBtn.addEventListener('click', fn); }
  onRoll(fn) { this.elements.rollBtn.addEventListener('click', fn); }
  onBank(fn) { this.elements.bankBtn.addEventListener('click', fn); }
  onQuit(fn) { this.elements.quitBtn.addEventListener('click', fn); }
  onPlayAgain(fn) { this.elements.playAgain.addEventListener('click', fn); }
  onBackToMenu(fn) { this.elements.backToMenu.addEventListener('click', fn); }

  showMenu() {
    this.elements.menu.classList.remove('hidden');
    this.elements.hud.classList.add('hidden');
    this.elements.winner.classList.add('hidden');
  }

  showGame() {
    this.elements.menu.classList.add('hidden');
    this.elements.hud.classList.remove('hidden');
    this.elements.winner.classList.add('hidden');
  }

  showHelp() { this.elements.help.classList.remove('hidden'); }
  hideHelp() { this.elements.help.classList.add('hidden'); }

  renderScoreboard(game) {
    const sb = this.elements.scoreboard;
    sb.innerHTML = '';
    game.players.forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'sb-player' + (i === game.currentIdx ? ' active' : '');
      const dotColor = hexToCss(p.color);
      el.innerHTML = `
        <div class="who"><span class="dot" style="background:${dotColor}"></span>${escapeHtml(p.name)}${p.ai ? ' 🤖' : ''}</div>
        <div class="score">${p.total}</div>
      `;
      sb.appendChild(el);
    });
  }

  renderTurn(game, status = '') {
    const p = game.currentPlayer;
    this.elements.turnPlayer.textContent = p.name + (p.ai ? ' 🤖' : '');
    this.elements.turnStatus.textContent = status;
    this.elements.turnScore.textContent = game.turnScore;
  }

  setButtons({ canRoll, canBank }) {
    this.elements.rollBtn.disabled = !canRoll;
    this.elements.bankBtn.disabled = !canBank;
  }

  flashResult(result, good = true) {
    const el = this.elements.rollResult;
    el.classList.remove('bad', 'great');
    if (!good) el.classList.add('bad');
    else if (result.points >= 15) el.classList.add('great');

    el.innerHTML = `
      <div class="name">${escapeHtml(result.name)}</div>
      <div class="detail">${escapeHtml(result.detail || '')}</div>
      <div class="pts">${good ? '+' : ''}${result.points} pts</div>
    `;
    el.classList.remove('hidden');
    requestAnimationFrame(() => el.classList.add('show'));

    if (this._rollResultTimer) clearTimeout(this._rollResultTimer);
    this._rollResultTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.classList.add('hidden'), 250);
    }, 1800);
  }

  showWinner(game) {
    this.elements.winner.classList.remove('hidden');
    this.elements.hud.classList.add('hidden');
    this.elements.winnerName.textContent = game.winner.name + (game.winner.ai ? ' 🤖' : '');
    const fs = this.elements.finalScores;
    fs.innerHTML = '';
    const sorted = [...game.players].sort((a, b) => b.total - a.total);
    sorted.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'fs-row' + (p === game.winner ? ' winner' : '');
      row.innerHTML = `<span>${escapeHtml(p.name)}${p.ai ? ' 🤖' : ''}</span><span>${p.total}</span>`;
      fs.appendChild(row);
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
