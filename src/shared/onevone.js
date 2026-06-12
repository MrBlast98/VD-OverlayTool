class PreciseTimer {
  constructor() {
    this._running = false;
    this._startedAt = 0;
    this._accum = 0;
  }

  start() {
    if (this._running) return;
    this._startedAt = performance.now();
    this._running = true;
  }

  pause() {
    if (!this._running) return;
    this._accum += performance.now() - this._startedAt;
    this._running = false;
  }

  reset() {
    this._running = false;
    this._accum = 0;
    this._startedAt = 0;
  }

  setElapsedMs(ms) {
    this._accum = Math.max(0, Number(ms) || 0);
    this._startedAt = this._running ? performance.now() : 0;
  }

  get running() {
    return this._running;
  }

  get elapsedMs() {
    return this._running ? this._accum + (performance.now() - this._startedAt) : this._accum;
  }
}

function formatMillisDynamic(ms) {
  const total = Math.max(0, Math.floor(ms));
  const cs = Math.floor((total % 1000) / 10);
  const secs = Math.floor(total / 1000) % 60;
  const mins = Math.floor(total / 60000);
  const cs2 = cs.toString().padStart(2, '0');

  if (mins > 0) {
    const ss = secs.toString().padStart(2, '0');
    return `${mins}:${ss}.${cs2}`;
  }

  return `${secs}.${cs2}`;
}

function tick(state) {
  if (!state.timerRunning) return state;
  const active = state.activeTimer === 2 ? 'player2Seconds' : 'player1Seconds';
  const next = Object.assign({}, state);
  next[active] = (next[active] || 0) + 1;
  return next;
}

function finishPlayer(state, playerNum) {
  const next = Object.assign({}, state);
  if (playerNum === 1) next.player1Finished = true;
  if (playerNum === 2) next.player2Finished = true;

  if (next.player1Finished && next.player2Finished) next.timerRunning = false;

  return next;
}

function switchTimer(state) {
  const next = Object.assign({}, state);
  next.activeTimer = next.activeTimer === 1 ? 2 : 1;
  return next;
}

function reset(state) {
  return {
    player1Seconds: 0,
    player2Seconds: 0,
    player1Score: 0,
    player2Score: 0,
    activeTimer: 1,
    timerRunning: false,
    player1Finished: false,
    player2Finished: false,
  };
}

module.exports = { PreciseTimer, formatMillisDynamic, tick, finishPlayer, switchTimer, reset };