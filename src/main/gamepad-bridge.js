const { spawn } = require('child_process');
const path = require('path');
let proc = null;

function startGamepadBridge(sendEvent) {
  if (proc) return proc;
  const exePath = path.join(process.cwd(), 'gamepad-bridge.exe');
  try {
    proc = spawn(exePath, [], { windowsHide: true });
  } catch (err) {
    console.warn('Gamepad bridge not found or failed to spawn', err?.message || err);
    proc = null;
    return null;
  }

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', chunk => {
    const text = String(chunk || '').trim();
    if (!text) return;
    // Forward raw lines to renderer so UI can bind actions
    try {
      if (sendEvent && typeof sendEvent === 'function') sendEvent('gamepad-event', text);
    } catch (e) {}
    console.log('gamepad-bridge =>', text);
  });

  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', d => console.warn('gamepad-bridge stderr:', d.toString()));

  proc.on('exit', (code, signal) => {
    console.log('gamepad-bridge exited', code, signal);
    proc = null;
  });

  proc.on('error', err => {
    console.warn('gamepad-bridge error', err);
    proc = null;
  });

  return proc;
}

function stopGamepadBridge() {
  if (!proc) return;
  try { proc.kill(); } catch (e) {}
  proc = null;
}

module.exports = { startGamepadBridge, stopGamepadBridge };
