const { tick, finishPlayer, switchTimer, reset } = require('../src/shared/onevone');

test('tick increments active timer only', () => {
  const s = { player1Seconds: 0, player2Seconds: 0, activeTimer: 1, timerRunning: true };
  const s2 = tick(s);
  expect(s2.player1Seconds).toBe(1);
  expect(s2.player2Seconds).toBe(0);

  const s3 = Object.assign({}, s, { activeTimer: 2 });
  s3.timerRunning = true;
  const s4 = tick(s3);
  expect(s4.player1Seconds).toBe(0);
  expect(s4.player2Seconds).toBe(1);
});

test('finishPlayer marks done and stops after both players finish', () => {
  let s = { player1Seconds: 10, player2Seconds: 12, player1Finished: false, player2Finished: false, timerRunning: true };
  s = finishPlayer(s, 1);
  expect(s.player1Finished).toBe(true);
  expect(s.timerRunning).toBe(true);

  s = finishPlayer(s, 2);
  expect(s.player2Finished).toBe(true);
  expect(s.timerRunning).toBe(false);
});

test('switchTimer flips the active stopwatch', () => {
  const s = { activeTimer: 1 };
  const s2 = switchTimer(s);
  expect(s2.activeTimer).toBe(2);
});

test('reset clears timers and scores', () => {
  const s = { player1Seconds: 5, player2Seconds: 3, player1Score: 2, player2Score: 1, player1Finished: true, player2Finished: true, activeTimer:2 };
  const r = reset(s);
  expect(r.player1Seconds).toBe(0);
  expect(r.player2Seconds).toBe(0);
  expect(r.player1Score).toBe(0);
  expect(r.player2Score).toBe(0);
  expect(r.activeTimer).toBe(1);
});