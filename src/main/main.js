const { app, BrowserWindow, ipcMain, screen, dialog, desktopCapturer } = require('electron');
const { uIOhook, UiohookKey } = require('uiohook-napi');
const { execFile } = require('child_process');
const path = require('path');
const Store = require('electron-store');
const fs = require('fs');
const { recognize } = require('tesseract.js');
const { startGamepadBridge, stopGamepadBridge } = require('./gamepad-bridge');
const dotenv = require('dotenv');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  console.warn('electron-updater unavailable in legacy main process', err?.message || err);
}

if (autoUpdater) {
  autoUpdater.autoDownload = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', {
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
        bytesPerSecond: progressObj.bytesPerSecond,
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    try {
      store.set('post_update_install', true);
    } catch (e) {
      console.warn('Failed to set post_update_install flag', e);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', {
        version: info.version,
      });
    }
    // Auto-install and restart immediately
    try {
      autoUpdater.quitAndInstall();
    } catch (e) {
      console.warn('Auto install failed to start', e);
    }
  });

  autoUpdater.on('error', (err) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', {
        message: err.message,
      });
    }
  });
}

const store = new Store();
const crypto = require('crypto');

// Load local environment files so the main process can read server-side Supabase secrets.
try {
  const envCandidates = [
    path.join(__dirname, '../../bot/.env'),
    path.join(process.cwd(), 'bot/.env'),
    path.join(__dirname, '../../.env'),
    path.join(process.cwd(), '.env'),
  ];
  for (const envPath of envCandidates) {
    try { dotenv.config({ path: envPath, override: false }); } catch (e) { /* ignore */ }
  }
} catch (e) {
  console.warn('dotenv config skipped:', e?.message || e);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
const githubRepoUrl = String(packageJson.repository?.url || '').trim();
const githubRepoMatch = githubRepoUrl.match(/github\.com[:/](.+?)(?:\.git)?$/i);
const GITHUB_OWNER_REPO = githubRepoMatch ? githubRepoMatch[1].replace(/\/+$/, '') : 'MrBlast98/VD-OverlayTool';

let latestReleaseCache = null;
let releaseDownloadInProgress = false;

const RENDERER_MANIFEST_PATH = path.join(__dirname, '../renderer/renderer-manifest.json');

let rendererIntegrityStatus = { checked: false, ok: true, reasons: [] };

function sha256File(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
  } catch (err) {
    return null;
  }
}

function verifyRendererIntegrity() {
  if (!app.isPackaged && process.env.ENFORCE_RENDERER_INTEGRITY !== '1') {
    rendererIntegrityStatus = { checked: true, ok: true, reasons: [] };
    return rendererIntegrityStatus;
  }

  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(RENDERER_MANIFEST_PATH, 'utf8'));
  } catch (err) {
    rendererIntegrityStatus = {
      checked: true,
      ok: false,
      reasons: ['Renderer integrity manifest is missing or unreadable.'],
    };
    return rendererIntegrityStatus;
  }

  const checks = [
    { label: 'renderer/app.bundle.js', path: path.join(__dirname, '../renderer/app.bundle.js'), expected: manifest?.appBundleHash },
    { label: 'renderer/index.html', path: path.join(__dirname, '../renderer/index.html'), expected: manifest?.indexHtmlHash },
    { label: 'main/preload.js', path: path.join(__dirname, 'preload.js'), expected: manifest?.preloadHash },
  ];

  const reasons = [];
  for (const check of checks) {
    const actual = sha256File(check.path);
    if (!actual) {
      reasons.push(`${check.label} is missing or unreadable.`);
      continue;
    }
    if (actual !== check.expected) {
      reasons.push(`${check.label} hash mismatch.`);
    }
  }

  rendererIntegrityStatus = {
    checked: true,
    ok: reasons.length === 0,
    reasons,
  };

  return rendererIntegrityStatus;
}

function buildIntegrityBlockedHtml(reasons = []) {
  const details = Array.isArray(reasons) && reasons.length
    ? reasons.map(reason => `<li>${String(reason).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</li>`).join('')
    : '<li>Renderer files were modified.</li>';

  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VD OverlayTools</title>
    <style>
      html, body { margin: 0; height: 100%; background: #07080d; color: #e9edf5; font-family: system-ui, sans-serif; }
      body { display: grid; place-items: center; }
      .card { width: min(640px, calc(100vw - 32px)); padding: 28px; border: 1px solid rgba(255,255,255,.08); border-radius: 20px; background: rgba(15,18,28,.96); box-shadow: 0 24px 80px rgba(0,0,0,.45); }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0 0 16px; line-height: 1.5; color: #b7c0d4; }
      ul { margin: 0; padding-left: 20px; color: #d7dbea; }
      li { margin: 8px 0; }
      .note { margin-top: 18px; color: #93a0ba; font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>App integrity check failed</h1>
      <p>The packaged renderer was modified, so this build will not unlock the app.</p>
      <ul>${details}</ul>
      <div class="note">Reinstall from a clean package if this was unintentional.</div>
    </div>
  </body>
</html>`);
}

function getWindowDpiScale(win) {
  try {
    if (!win || win.isDestroyed()) return 1;
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const scale = Number(display?.scaleFactor || 1);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  } catch (e) {
    return 1;
  }
}

function applyWindowSecurity(win) {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function syncWindowDpiScale(win) {
  if (!win || win.isDestroyed()) return;
  const scale = getWindowDpiScale(win);
  try {
    win.webContents.send('dpi-scale-changed', scale);
    win.webContents.send('ui-scale-changed', Number(store.get('ui.scale', 1)) || 1);
  } catch (e) {
    console.warn('Failed to send dpi-scale-changed', e?.message || e);
  }
  try {
    win.webContents.setZoomFactor(1);
    win.webContents.setZoomLevel(0);
  } catch (e) {
    console.warn('Failed to normalize zoom level', e?.message || e);
  }
}

function getSlugbotApiKey() {
  return String(
    process.env.SLUGBOT_API_KEY ||
    process.env.LADDER_API_KEY ||
    store.get('slugbot.apiKey') ||
    store.get('ladder.apiKey') ||
    ''
  ).trim();
}

// Initialize optional SQLite cache (if better-sqlite3 installed)
let sqlite = null;
try {
  sqlite = require('./sqlite/db');
  const ok = sqlite.init(app.getPath('userData'));
  if (ok) console.log('SQLite cache initialized');
} catch (e) {
  console.warn('SQLite helpers not available:', e?.message || e);
}

function normalizeReleaseVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').toLowerCase();
}

function isExeAsset(asset) {
  const name = String(asset?.name || '').toLowerCase();
  return name.endsWith('.exe') && !name.endsWith('.blockmap');
}

function pickInstallerAsset(assets = []) {
  const exeAssets = assets.filter(isExeAsset);
  if (!exeAssets.length) return null;
  const ranked = [...exeAssets].sort((a, b) => {
    const nameA = String(a.name || '').toLowerCase();
    const nameB = String(b.name || '').toLowerCase();
    const score = (name) => {
      if (name.includes('setup')) return 0;
      if (name.includes('installer')) return 1;
      if (name.includes('nsis')) return 2;
      return 3;
    };
    return score(nameA) - score(nameB);
  });
  return ranked[0] || null;
}

async function fetchLatestReleaseInfo() {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER_REPO}/releases/latest`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'VD-OverlayTools-Updater',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub release lookup failed (${response.status}): ${text || response.statusText}`);
  }

  const release = await response.json();
  const asset = pickInstallerAsset(release.assets || []);
  if (!asset) {
    throw new Error('No .exe installer asset found on the latest GitHub release');
  }

  return {
    tag: String(release.tag_name || release.name || '').trim(),
    version: String(release.name || release.tag_name || '').trim(),
    htmlUrl: String(release.html_url || ''),
    assetName: String(asset.name || ''),
    assetUrl: String(asset.browser_download_url || ''),
    publishedAt: release.published_at || null,
  };
}

function normalizeReleaseBody(body) {
  return String(body || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 8);
}

async function fetchReleaseNotesFeed(limit = 5) {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER_REPO}/releases?per_page=${Math.max(1, Math.min(Number(limit) || 5, 10))}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'VD-OverlayTools-Updater',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub release feed failed (${response.status}): ${text || response.statusText}`);
  }

  const releases = await response.json();
  return (Array.isArray(releases) ? releases : []).map(release => ({
    tag: String(release.tag_name || release.name || '').trim(),
    version: String(release.name || release.tag_name || '').trim(),
    htmlUrl: String(release.html_url || ''),
    publishedAt: release.published_at || null,
    draft: !!release.draft,
    prerelease: !!release.prerelease,
    bodyLines: normalizeReleaseBody(release.body || ''),
  }));
}

function buildSlugbotPlayerUrl(apiUrl, serverId, leaderboardId, discordId) {
  const trimmed = String(apiUrl || '').trim() || 'https://api.slugbot.xyz/pvplb';
  const normalizedApi = trimmed.replace(/\/+$/, '');
  const segments = [
    normalizedApi,
    encodeURIComponent(serverId),
    encodeURIComponent(leaderboardId),
    'player',
    encodeURIComponent(discordId),
  ];
  return segments.join('/');
}

async function fetchSlugbotPlayer(discordId, serverId, leaderboardId, apiUrl) {
  const apiKey = getSlugbotApiKey();
  const url = buildSlugbotPlayerUrl(apiUrl, serverId, leaderboardId, discordId);
  const authHeaders = apiKey
    ? [
        { Authorization: `Bearer ${apiKey}` },
        { Authorization: `Token ${apiKey}` },
        { 'x-api-key': apiKey },
      ]
    : [{}];

  let lastError = null;
  for (const authHeader of authHeaders) {
    try {
      const headers = Object.assign({ Accept: 'application/json' }, authHeader);
      const res = await fetch(url, { headers });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const error = new Error(`HTTP ${res.status}${body ? ` - ${body.slice(0, 180)}` : ''}`);
        error.status = res.status;

        if ((res.status === 401 || res.status === 403) && apiKey) {
          lastError = error;
          continue;
        }

        throw error;
      }

      const json = await res.json();
      return {
        ok: true,
        data: json,
      };
    } catch (err) {
      lastError = err;
    }
  }

  return { ok: false, error: String(lastError?.message || lastError || 'Slugbot request failed') };
}

async function downloadAssetToFile(assetUrl, targetPath, onProgress) {
  const response = await fetch(assetUrl, {
    headers: {
      'User-Agent': 'VD-OverlayTools-Updater',
      'Accept': 'application/octet-stream',
    },
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`Installer download failed (${response.status}): ${text || response.statusText}`);
  }

  const total = Number(response.headers.get('content-length') || 0);
  const fileStream = fs.createWriteStream(targetPath);
  const reader = response.body.getReader();
  let transferred = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      transferred += chunk.length;
      if (!fileStream.write(chunk)) {
        await new Promise(resolve => fileStream.once('drain', resolve));
      }
      if (typeof onProgress === 'function') {
        onProgress({ transferred, total, percent: total > 0 ? (transferred / total) * 100 : 0 });
      }
    }
  } finally {
    fileStream.end();
  }

  await new Promise((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });
}

async function downloadLatestInstallerAndLaunch() {
  if (releaseDownloadInProgress) {
    throw new Error('Update download already in progress');
  }
  releaseDownloadInProgress = true;

  try {
    const release = latestReleaseCache || await fetchLatestReleaseInfo();
    latestReleaseCache = release;

    const targetDir = path.join(app.getPath('temp'), 'vd-overlaytools-updates');
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, release.assetName || 'VD-OverlayTools-Setup.exe');

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
    }

    await downloadAssetToFile(release.assetUrl, targetPath, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', {
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: 0,
        });
      }
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', { version: release.version, assetName: release.assetName });
    }

    setTimeout(() => {
      try {
        const { spawn } = require('child_process');
        spawn(targetPath, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      } catch (err) {
        console.warn('Failed to launch downloaded installer', err?.message || err);
      }
      app.quit();
    }, 300);

    return { ok: true, version: release.version, assetName: release.assetName, assetPath: targetPath };
  } finally {
    releaseDownloadInProgress = false;
  }
}

async function checkLatestReleaseAndNotify() {
  try {
    const release = await fetchLatestReleaseInfo();
    latestReleaseCache = release;
    const current = normalizeReleaseVersion(app.getVersion());
    const latest = normalizeReleaseVersion(release.tag || release.version);

    if (!current || !latest || current !== latest) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', {
          version: release.version || release.tag,
          assetName: release.assetName,
        });
      }
      return { ok: true, updateAvailable: true, release };
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-not-available', { version: app.getVersion() });
    }
    return { ok: true, updateAvailable: false, release };
  } catch (err) {
    const message = String(err?.message || err || '');
    if (message.includes('(404)') || /not found/i.test(message)) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-not-available', { version: app.getVersion() });
      }
      return { ok: true, updateAvailable: false, release: null };
    }
    throw err;
  }
}

ipcMain.handle('open-external', async (event, url) => {
  try {
    const { shell } = require('electron');
    if (!url) return { ok: false };
    await shell.openExternal(String(url));
    return { ok: true };
  } catch (err) {
    console.warn('Failed to open external URL', err?.message || err);
    return { ok: false, error: String(err?.message || err) };
  }
});

// OBS WebSocket client (loaded on demand)
let OBSWebSocket = null;
let obsClient = null;
let obsConnected = false;
let robloxWatcherTimer = null;
let robloxLastDetected = false;

const ROBLOX_OVERLAY_TYPES = ['onevone', 'maps', 'queue', 'fourvone', 'winstreak'];
const DEFAULT_ROBLOX_PLACE_ID = '93978595733734';
const WINDOWS_ANIMATION_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects\\ControlAnimations';

function safeRequireObs() {
  if (OBSWebSocket) return OBSWebSocket;
  try {
    OBSWebSocket = require('obs-websocket-js');
    return OBSWebSocket;
  } catch (err) {
    console.warn('obs-websocket-js not installed; OBS integration disabled', err?.message || err);
    OBSWebSocket = null;
    return null;
  }
}

function getObsMapping() {
  return store.get('obs.sceneMap', {});
}

function getRobloxConfig() {
  return {
    enabled: !!store.get('roblox.enabled', false),
    placeId: String(store.get('roblox.placeId', DEFAULT_ROBLOX_PLACE_ID) || DEFAULT_ROBLOX_PLACE_ID).trim() || DEFAULT_ROBLOX_PLACE_ID,
    closeOnExit: !!store.get('roblox.closeOnExit', true),
    selection: {
      onevone: !!store.get('roblox.selection.onevone', false),
      maps: !!store.get('roblox.selection.maps', true),
      queue: !!store.get('roblox.selection.queue', false),
      fourvone: !!store.get('roblox.selection.fourvone', false),
      winstreak: !!store.get('roblox.selection.winstreak', true),
    },
  };
}

function getSelectedRobloxOverlayTypes() {
  const config = getRobloxConfig();
  return ROBLOX_OVERLAY_TYPES.filter(type => config.selection[type]);
}

// Install id helper (store-backed) for main process
function getInstallIdMain() {
  let id = store.get('install.id', null);
  if (!id) {
    try {
      id = (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    } catch (e) {
      id = `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
    }
    try { store.set('install.id', id); } catch (e) { /* ignore */ }
  }
  return id;
}

// License validation: always returns premium (free forever)
ipcMain.handle('license-validate', async () => {
  return { valid: true, keyType: 'premium', userId: 'bypass', markFailed: false };
});

function normalizePlaceId(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function extractPlaceIdFromCommandLine(commandLine) {
  const text = String(commandLine || '');
  const matches = [
    text.match(/placeid\s*[:=]\s*(\d+)/i),
    text.match(/placeId(?:%3A|%3D|:|=)\s*(\d+)/i),
    text.match(/placeId=([0-9]+)/i),
  ];

  for (const match of matches) {
    if (match && match[1]) return match[1];
  }

  return normalizePlaceId(text.includes(DEFAULT_ROBLOX_PLACE_ID) ? DEFAULT_ROBLOX_PLACE_ID : '');
}

function queryRobloxCommandLines() {
  if (process.platform !== 'win32') return Promise.resolve([]);

  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$processes = Get-CimInstance Win32_Process -Filter \"Name='RobloxPlayerBeta.exe'\"",
    'if ($null -eq $processes) { exit 0 }',
    '$processes | ForEach-Object { if ($_.CommandLine) { Write-Output $_.CommandLine } }',
  ].join('; ');

  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, (error, stdout) => {
      if (error && !stdout) {
        resolve([]);
        return;
      }

      const lines = String(stdout || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
      resolve(lines);
    });
  });
}

async function detectRobloxViolenceDistrict() {
  const config = getRobloxConfig();
  const commandLines = await queryRobloxCommandLines();
  const targetPlaceId = normalizePlaceId(config.placeId);

  if (!commandLines.length) {
    return { active: false, placeId: null, message: 'Roblox is not running.' };
  }

  for (const commandLine of commandLines) {
    const detectedPlaceId = extractPlaceIdFromCommandLine(commandLine);
    if (detectedPlaceId && targetPlaceId && detectedPlaceId === targetPlaceId) {
      return {
        active: true,
        placeId: detectedPlaceId,
        message: `Violence District detected at place ID ${detectedPlaceId}.`,
      };
    }

    if (targetPlaceId && String(commandLine).includes(targetPlaceId)) {
      return {
        active: true,
        placeId: targetPlaceId,
        message: `Violence District detected at place ID ${targetPlaceId}.`,
      };
    }
  }

  return {
    active: false,
    placeId: null,
    message: `Roblox is running, but place ID ${targetPlaceId} was not found.`,
  };
}

function sendRobloxStatus(status) {
  if (mainWindow) {
    mainWindow.webContents.send('roblox-status', status);
  }
}

function openSelectedRobloxOverlays() {
  getSelectedRobloxOverlayTypes().forEach(type => {
    createOverlayWindow(type);
  });
}

function closeSelectedRobloxOverlays() {
  getSelectedRobloxOverlayTypes().forEach(type => {
    closeOverlayWindow(type);
  });
}

async function refreshRobloxIntegration() {
  const config = getRobloxConfig();
  if (!config.enabled) {
    sendRobloxStatus({ active: false, message: 'Roblox auto-open is disabled.' });
    robloxLastDetected = false;
    return { active: false, message: 'Roblox auto-open is disabled.' };
  }

  const status = await detectRobloxViolenceDistrict();
  sendRobloxStatus(status);

  if (status.active && !robloxLastDetected) {
    openSelectedRobloxOverlays();
  } else if (!status.active && robloxLastDetected && config.closeOnExit) {
    closeSelectedRobloxOverlays();
  }

  robloxLastDetected = status.active;
  return status;
}

function startRobloxWatcher() {
  if (robloxWatcherTimer) return;

  robloxWatcherTimer = setInterval(() => {
    refreshRobloxIntegration().catch(err => {
      console.warn('Roblox watcher error', err);
    });
  }, 5000);

  refreshRobloxIntegration().catch(err => {
    console.warn('Initial Roblox watcher check failed', err);
  });
}

function queryWindowsAnimationsEnabled() {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: true, enabled: true, canFix: false });
  }

  return new Promise(resolve => {
    execFile('reg.exe', ['query', WINDOWS_ANIMATION_KEY, '/v', 'DefaultApplied'], { windowsHide: true }, (error, stdout) => {
      const output = String(stdout || '');
      if (error && !output) {
        resolve({ ok: false, enabled: false, canFix: true, error: String(error) });
        return;
      }

      const match = output.match(/DefaultApplied\s+REG_DWORD\s+0x([0-9a-fA-F]+)/i);
      const enabled = match ? parseInt(match[1], 16) !== 0 : /\b0x1\b/i.test(output);
      resolve({ ok: true, enabled, canFix: true });
    });
  });
}

function enableWindowsAnimations() {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, error: 'Windows only.' });
  }

  return new Promise(resolve => {
    execFile('reg.exe', [
      'add',
      WINDOWS_ANIMATION_KEY,
      '/v',
      'DefaultApplied',
      '/t',
      'REG_DWORD',
      '/d',
      '1',
      '/f',
    ], { windowsHide: true }, (error) => {
      if (error) {
        resolve({ ok: false, error: String(error) });
        return;
      }

      try {
        execFile('rundll32.exe', ['user32.dll,UpdatePerUserSystemParameters'], { windowsHide: true }, () => {});
      } catch (e) {}

      resolve({ ok: true, message: 'Windows animation setting enabled.' });
    });
  });
}

async function connectToOBS(config = {}) {
  const OBS = safeRequireObs();
  if (!OBS) throw new Error('OBS WebSocket library not available');

  if (obsClient) {
    try { await obsClient.disconnect(); } catch (e) {}
    obsClient = null;
  }

  obsClient = new OBS();

  // wire up event handlers
  obsClient.on('ConnectionOpened', () => {
    obsConnected = true;
    if (mainWindow) mainWindow.webContents.send('obs-status', { connected: true });
  });
  obsClient.on('ConnectionClosed', () => {
    obsConnected = false;
    if (mainWindow) mainWindow.webContents.send('obs-status', { connected: false });
  });

  // listen for both common scene-change events (compat layer)
  obsClient.on('SwitchScenes', event => {
    const scene = event?.scene || event?.sceneName || (event && event.scene?.name);
    if (scene) handleObsSceneChange(String(scene));
  });
  obsClient.on('CurrentProgramSceneChanged', event => {
    const scene = event?.sceneName || (event && event.scene?.name);
    if (scene) handleObsSceneChange(String(scene));
  });

  // attempt to connect
  const address = `${config.host || 'localhost'}:${config.port || 4455}`;
  const password = config.password || '';
  // obs-websocket-js v5 uses connect({ address, password })
  try {
    await obsClient.connect({ address, password });
    obsConnected = true;
    if (mainWindow) mainWindow.webContents.send('obs-status', { connected: true });
    // fetch scenes and send
    try {
      const resp = await obsClient.call('GetSceneList');
      const scenes = (resp && resp.scenes) ? resp.scenes.map(s => s.sceneName || s.name || s) : [];
      if (mainWindow) mainWindow.webContents.send('obs-scenes', scenes);
    } catch (e) {
      // older API fallback
      try {
        const list = await obsClient.call('GetSceneList', {});
        const scenes = (list && list.scenes) ? list.scenes.map(s => s.sceneName || s.name || s) : [];
        if (mainWindow) mainWindow.webContents.send('obs-scenes', scenes);
      } catch (err) {
        console.warn('Failed fetching scenes from OBS', err);
      }
    }
    return true;
  } catch (err) {
    obsConnected = false;
    if (mainWindow) mainWindow.webContents.send('obs-status', { connected: false, error: String(err) });
    throw err;
  }
}

async function disconnectOBS() {
  if (!obsClient) return;
  try {
    await obsClient.disconnect();
  } catch (e) {}
  obsClient = null;
  obsConnected = false;
  if (mainWindow) mainWindow.webContents.send('obs-status', { connected: false });
}

function handleObsSceneChange(sceneName) {
  try {
    const map = getObsMapping();
    const normalized = String(sceneName || '').trim();
    const overlays = map[normalized] || [];
    // overlays is expected to be array of overlay keys to show
    // hide overlays not present, show overlays present
    Object.keys(overlayWindows).forEach(type => {
      const shouldShow = overlays.includes(type) && overlayState[type] && overlayState[type].enabled;
      const win = getOverlayWindow(type);
      if (shouldShow && !win) createOverlayWindow(type);
      if (!shouldShow && win) closeOverlayWindow(type);
    });
  } catch (err) {
    console.warn('Error handling OBS scene change', err);
  }
}

const HOTKEY_DEFAULTS = {
  onevoneTimer: 'F1',
  onevoneStart: null,
  onevonePause: null,
  onevoneSwitchTimer: 'Shift+F1',
  onevoneReset: null,
  onevoneAlwaysOnTop: 'Shift+F5',
  mapsNext: 'F2',
  mapsPrevious: 'F3',
  mapsAlwaysOnTop: 'F4',
  mapsToggleRegion: 'Shift+F2',
  winstreakNextKiller: null,
  winstreakAlwaysOnTop: null,
  overlayClose: 'Shift+F6',
};

let mainWindow = null;
let hotkeysSuspended = false;
let hotkeyBindings = [];
let uiohookStarted = false;
const overlayWindows = {
  onevone: null,
  maps: null,
  fourvone: null,
  winstreak: null,
  ladder: null,
  queue: null,
};

// Initialize overlay state, loading lock/enabled from store
const overlayState = {
  onevone: { enabled: true, locked: store.get('overlay.onevone.locked', false) },
  maps: { enabled: true, locked: store.get('overlay.maps.locked', false) },
  fourvone: { enabled: true, locked: store.get('overlay.fourvone.locked', false) },
  winstreak: { enabled: true, locked: store.get('overlay.winstreak.locked', false) },
  ladder: { enabled: true, locked: store.get('overlay.ladder.locked', false) },
  queue: { enabled: true, locked: store.get('overlay.queue.locked', false) },
};

const OVERLAY_LAYOUT = {
  onevone: { width: 760, height: 230, xOffset: 0, y: 40 },
  maps: { width: 560, height: 320, xOffset: 0, y: 40 },
  fourvone: { width: 640, height: 320, xOffset: 0, y: 40 },
  winstreak: { width: 560, height: 240, xOffset: 0, y: 40 },
  ladder: { width: 700, height: 240, xOffset: 0, y: 40 },
  queue: { width: 520, height: 300, xOffset: 0, y: 40 },
};

function getOverlayWindow(type) {
  return overlayWindows[type] || null;
}

function getOverlayState(type) {
  return overlayState[type] || { enabled: false, locked: false };
}

function getQueueOverlayConfig() {
  return {
    apiToken: String(store.get('queue.apiToken', '') || ''),
    channelId: String(store.get('queue.channelId', '') || ''),
    serverId: String(store.get('queue.serverId', '') || ''),
    title: String(store.get('queue.title', 'Queue') || 'Queue'),
    maxVisible: Math.max(3, Math.min(12, parseInt(store.get('queue.maxVisible', 8), 10) || 8)),
  };
}

function normalizeQueuePlayers(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const candidateList = [payload.players, payload.data, payload.queue, payload.items, payload.results];
  for (const candidate of candidateList) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function normalizeQueuePlayerName(player, index) {
  if (!player || typeof player !== 'object') return `Player ${index + 1}`;
  return String(
    player.display_name ||
    player.displayName ||
    player.name ||
    player.username ||
    player.user_name ||
    player.discord_username ||
    player.discordName ||
    player.player_name ||
    `Player ${index + 1}`
  ).trim() || `Player ${index + 1}`;
}

function normalizeQueueApiToken(token) {
  const value = String(token || '').trim();
  if (!value) return '';

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function buildQueueRequestHeaders(token) {
  const normalizedToken = normalizeQueueApiToken(token);
  return [
    { Authorization: `Bearer ${normalizedToken}` },
    { Authorization: `Token ${normalizedToken}` },
    { 'x-api-key': normalizedToken },
  ];
}

async function readQueueErrorBody(response) {
  try {
    const text = await response.text();
    return text ? text.slice(0, 300) : '';
  } catch {
    return '';
  }
}

async function fetchQueueOverlayData() {
  const config = getQueueOverlayConfig();
  const apiToken = normalizeQueueApiToken(config.apiToken);
  if (!apiToken) {
    return { ok: false, title: config.title, message: 'Add your NeatQueue token to enable this overlay.', players: [], count: 0, maxVisible: config.maxVisible };
  }

  const hasChannel = Boolean(config.channelId);
  const hasServer = Boolean(config.serverId);
  if (!hasChannel && !hasServer) {
    return { ok: false, title: config.title, message: 'Add a queue channel or server ID.', players: [], count: 0, maxVisible: config.maxVisible };
  }

  const endpoints = [];
  if (hasChannel) {
    endpoints.push(`https://api.neatqueue.com/api/v1/queue/${encodeURIComponent(config.channelId)}/players`);
  }
  if (hasServer) {
    endpoints.push(`https://api.neatqueue.com/api/v1/queues/${encodeURIComponent(config.serverId)}/players`);
  }

  const errors = [];
  for (const endpoint of endpoints) {
    for (const headers of buildQueueRequestHeaders(apiToken)) {
      const response = await fetch(endpoint, { headers });
      if (!response.ok) {
        errors.push(`${response.status} ${await readQueueErrorBody(response)}`.trim());
        continue;
      }

      const raw = await response.json();
      const players = normalizeQueuePlayers(raw).map((player, index) => ({
        index: index + 1,
        name: normalizeQueuePlayerName(player, index),
        raw: player,
      }));

      return {
        ok: true,
        title: config.title,
        channelId: config.channelId,
        serverId: config.serverId,
        count: players.length,
        players,
        maxVisible: config.maxVisible,
        fetchedAt: Date.now(),
      };
    }
  }

  const errorText = errors.filter(Boolean).slice(0, 3).join(' | ');
  throw new Error(errorText ? `NeatQueue request failed: ${errorText}` : 'NeatQueue request failed');
}

function getHotkey(name) {
  return store.get(`hotkeys.${name}`, HOTKEY_DEFAULTS[name]);
}

function normalizeHotkeyPart(part) {
  return String(part || '').trim();
}

function resolveUiohookKeycode(keyName) {
  const normalized = normalizeHotkeyPart(keyName);
  if (!normalized) return null;

  if (UiohookKey[normalized] != null) return UiohookKey[normalized];

  const upper = normalized.toUpperCase();
  if (UiohookKey[upper] != null) return UiohookKey[upper];

  const capitalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  if (UiohookKey[capitalized] != null) return UiohookKey[capitalized];

  return null;
}

function parseHotkeyAccelerator(accelerator) {
  if (!accelerator) return null;

  const parts = String(accelerator).split('+').map(normalizeHotkeyPart).filter(Boolean);
  if (!parts.length) return null;

  const keyName = parts.pop();
  const keycode = resolveUiohookKeycode(keyName);
  if (keycode == null) return null;

  return {
    keycode,
    ctrlKey: parts.some(part => /^(ctrl|control|cmdorctrl)$/i.test(part)),
    shiftKey: parts.some(part => /^shift$/i.test(part)),
    altKey: parts.some(part => /^(alt|option)$/i.test(part)),
    metaKey: parts.some(part => /^(meta|cmd|command|super)$/i.test(part)),
  };
}

function hotkeyMatchesEvent(binding, event) {
  if (!binding || !event) return false;
  if (event.keycode !== binding.keycode) return false;

  return Boolean(event.ctrlKey) === binding.ctrlKey
    && Boolean(event.shiftKey) === binding.shiftKey
    && Boolean(event.altKey) === binding.altKey
    && Boolean(event.metaKey) === binding.metaKey;
}

function dispatchHotkey(name) {
  const mapping = {
    onevoneTimer: ['onevone', 'timer-toggle'],
    onevoneReset: ['onevone', 'timer-reset'],
    onevoneStart: ['onevone', 'timer-start'],
    onevonePause: ['onevone', 'timer-pause'],
    onevoneSwitchTimer: ['onevone', 'switch-timer'],
    onevoneAlwaysOnTop: ['onevone', 'always-on-top-toggle'],
    mapsNext: ['maps', 'next-map'],
    mapsPrevious: ['maps', 'previous-map'],
    mapsAlwaysOnTop: ['maps', 'always-on-top-toggle'],
    mapsToggleRegion: ['maps', 'toggle-region'],
    winstreakNextKiller: ['winstreak', 'next-killer'],
    winstreakAlwaysOnTop: ['winstreak', 'always-on-top-toggle'],
  };

  if (name === 'overlayClose') {
    closeAllOverlays();
    return;
  }

  const map = mapping[name] || null;
  if (!map) return;

  const [scope, action] = map;
  if (mainWindow) mainWindow.webContents.send('hotkey', scope, action);
  Object.keys(overlayWindows).forEach(type => {
    const overlayWindow = overlayWindows[type];
    if (overlayWindow) overlayWindow.webContents.send('hotkey', scope, action);
  });
}

function ensureUiohookStarted() {
  if (uiohookStarted) return;

  uIOhook.on('keydown', event => {
    if (hotkeysSuspended) return;

    const binding = hotkeyBindings.find(item => hotkeyMatchesEvent(item.binding, event));
    if (!binding) return;

    dispatchHotkey(binding.name);
  });

  uIOhook.start();
  uiohookStarted = true;
}

function broadcastOverlayState(type) {
  const window = getOverlayWindow(type);
  if (!window) return;
  if (type === 'queue') {
    fetchQueueOverlayData()
      .then(data => window.webContents.send('overlay-data', { type, state: getOverlayState(type), data }))
      .catch(err => window.webContents.send('overlay-data', {
        type,
        state: getOverlayState(type),
        data: {
          ok: false,
          title: getQueueOverlayConfig().title,
          message: String(err?.message || err || 'Failed to load queue'),
          players: [],
          count: 0,
        },
      }));
  } else {
    window.webContents.send('overlay-data', { type, state: getOverlayState(type) });
  }
  // Request the main window to send current overlay data
  if (mainWindow) {
    mainWindow.webContents.send('request-overlay-data', type);
  }
}

async function testQueueOverlayToken() {
  const data = await fetchQueueOverlayData();
  if (data.ok) {
    return { ok: true, message: 'NeatQueue token validated successfully.' };
  }

  return {
    ok: false,
    message: data.message || 'NeatQueue token test failed.',
  };
}

function createMainWindow() {
  const integrity = verifyRendererIntegrity();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    title: 'VD OverlayTools',
    titleBarStyle: 'hidden',
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../../assets/icon.png'),
  });

  applyWindowSecurity(mainWindow);

  if (!integrity.ok) {
    console.warn('Renderer integrity check failed:', integrity.reasons);
    mainWindow.loadURL(buildIntegrityBlockedHtml(integrity.reasons));
    return;
  }

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.webContents.once('did-finish-load', () => syncWindowDpiScale(mainWindow));
  mainWindow.on('move', () => syncWindowDpiScale(mainWindow));
  mainWindow.on('resize', () => syncWindowDpiScale(mainWindow));

  // Hotkeys are managed via IPC suspend/resume from renderer input field handling
  // When the app window loses complete focus (unfocused), keep hotkeys active
  // When an input field is focused in the renderer, suspend hotkeys via IPC

  mainWindow.on('closed', () => {
    mainWindow = null;
    Object.keys(overlayWindows).forEach(type => closeOverlayWindow(type));
  });
}

function createOverlayWindow(type) {
  const existingWindow = getOverlayWindow(type);
  if (existingWindow) {
    existingWindow.focus();
    return;
  }


  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const layout = OVERLAY_LAYOUT[type] || OVERLAY_LAYOUT.onevone;
  const clickthrough = store.get(`overlay.${type}.clickthrough`, true);
  const gpuStatus = typeof app.getGPUFeatureStatus === 'function' ? app.getGPUFeatureStatus() : {};
  const transparencySupported = process.platform !== 'win32' || gpuStatus.gpu_compositing === 'enabled' || gpuStatus.webgl === 'enabled';
  const useTransparentWindow = transparencySupported;

  const overlayWindow = new BrowserWindow({
    width: layout.width,
    height: layout.height,
    x: Math.floor((width - layout.width) / 2) + layout.xOffset,
    y: layout.y,
    transparent: useTransparentWindow,
    backgroundColor: useTransparentWindow ? '#00000000' : '#0b0d10',
    frame: false,
    alwaysOnTop: store.get(`overlay.${type}.alwaysOnTop`, true),
    resizable: true,
    movable: true,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: false,
      additionalArguments: [`--overlay-type=${type}`],
    },
  });

  applyWindowSecurity(overlayWindow);

  overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'));
  overlayWindow.webContents.once('did-finish-load', () => syncWindowDpiScale(overlayWindow));
  overlayWindow.on('move', () => syncWindowDpiScale(overlayWindow));
  overlayWindow.on('resize', () => syncWindowDpiScale(overlayWindow));
  const locked = overlayState[type]?.locked || false;
  overlayWindow.setIgnoreMouseEvents(Boolean(locked && clickthrough), { forward: true });
  
  // Apply lock state from overlayState
  overlayWindow.setMovable(!locked);
  overlayWindow.setResizable(!locked);
  
  overlayWindow.once('ready-to-show', () => {
    if (!overlayWindow.isDestroyed()) {
      overlayWindow.showInactive();
    }
  });
  overlayWindow.webContents.once('did-finish-load', () => {
    broadcastOverlayState(type);
    setTimeout(() => {
      if (!overlayWindow.isDestroyed() && !overlayWindow.isVisible()) {
        overlayWindow.showInactive();
      }
    }, 150);
  });

  overlayWindow.on('closed', () => {
    overlayWindows[type] = null;
    if (mainWindow) mainWindow.webContents.send('overlay-closed', type);
  });

  overlayWindows[type] = overlayWindow;
}

function closeOverlayWindow(type) {
  const overlayWindow = getOverlayWindow(type);
  if (overlayWindow) overlayWindow.close();
}

function setOverlayEnabled(type, enabled) {
  if (!overlayState[type]) return;
  overlayState[type].enabled = enabled;
}

function setOverlayLocked(type, locked) {
  if (!overlayState[type]) return;
  overlayState[type].locked = locked;
  const overlayWindow = getOverlayWindow(type);
  if (overlayWindow) {
    overlayWindow.setMovable(!locked);
    overlayWindow.setResizable(!locked);
    overlayWindow.setIgnoreMouseEvents(Boolean(locked), { forward: true });
    // notify overlay window about the new locked state so UI can update
    overlayWindow.webContents.send('overlay-data', { type, state: getOverlayState(type) });
  }
}

// IPC Handlers
ipcMain.on('overlay-enable', (event, type, enabled) => setOverlayEnabled(type, enabled));

ipcMain.on('open-overlay', (event, type) => {
  createOverlayWindow(type);
});

ipcMain.on('close-overlay', (event, type) => {
  closeOverlayWindow(type);
});

ipcMain.on('toggle-overlay-lock', (event, type, locked) => {
  setOverlayLocked(type, locked);
});

ipcMain.on('update-overlay', (event, type, data) => {
  const overlayWindow = getOverlayWindow(type);
  if (overlayWindow) {
    if (type === 'queue') {
      fetchQueueOverlayData()
        .then(queueData => overlayWindow.webContents.send('overlay-data', { type, state: getOverlayState(type), data: queueData }))
        .catch(err => overlayWindow.webContents.send('overlay-data', {
          type,
          state: getOverlayState(type),
          data: {
            ok: false,
            title: getQueueOverlayConfig().title,
            message: String(err?.message || err || 'Failed to load queue'),
            players: [],
            count: 0,
            maxVisible: getQueueOverlayConfig().maxVisible,
            maxVisible: getQueueOverlayConfig().maxVisible,
          },
        }));
    } else {
      overlayWindow.webContents.send('overlay-data', { type, data });
    }
  }
});

ipcMain.on('store-set', (event, key, value) => {
  store.set(key, value);
});

// Broadcast CSS alpha value to overlay renderer windows
ipcMain.on('overlay-set-alpha', (event, alpha) => {
  try {
    const val = Number(alpha);
    Object.keys(overlayWindows).forEach(type => {
      const w = overlayWindows[type];
      if (w) w.webContents.send('overlay-set-alpha', val);
    });
    store.set('overlay.alpha', val);
  } catch (e) {
    console.warn('Failed to broadcast overlay alpha', e);
  }
});

// (removed) minimal boxes toggle: overlays are minimal when fully transparent

ipcMain.on('store-get', (event, key) => {
  event.returnValue = store.get(key);
});

ipcMain.on('store-get-all', (event) => {
  event.returnValue = store.store;
});

ipcMain.on('hotkeys-updated', () => {
  registerHotkeys();
});

ipcMain.on('minimize-window', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('maximize-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.on('close-window', () => { if (mainWindow) mainWindow.close(); });

ipcMain.on('resize-overlay-window', (event, width, height) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return;

  // determine overlay type for this sender window
  const type = Object.keys(overlayWindows).find(k => overlayWindows[k] === senderWindow);
  if (type && overlayState[type] && overlayState[type].locked) {
    // ignore resize requests when overlay is locked
    return;
  }

  const minSizes = {
    onevone: { width: 560, height: 180 },
    maps: { width: 420, height: 240 },
    fourvone: { width: 520, height: 220 },
    winstreak: { width: 420, height: 180 },
    ladder: { width: 480, height: 200 },
    queue: { width: 420, height: 220 },
  };
  const fallbackMin = { width: 320, height: 180 };
  const minSize = (type && minSizes[type]) || fallbackMin;
  const nextWidth = Math.max(minSize.width, Math.round(Number(width) || 0));
  const nextHeight = Math.max(minSize.height, Math.round(Number(height) || 0));

  senderWindow.setBounds({ width: nextWidth, height: nextHeight });
});

ipcMain.on('move-overlay-window', (event, dx, dy) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return;

  // determine overlay type for this sender window
  const type = Object.keys(overlayWindows).find(k => overlayWindows[k] === senderWindow);
  if (type && overlayState[type] && overlayState[type].locked) {
    // ignore move requests when overlay is locked
    return;
  }

  const deltaX = Math.round(Number(dx) || 0);
  const deltaY = Math.round(Number(dy) || 0);
  if (!deltaX && !deltaY) return;

  const [x, y] = senderWindow.getPosition();
  senderWindow.setPosition(Math.round(x + deltaX), Math.round(y + deltaY));
});

ipcMain.on('toggle-overlay-always-on-top', (event, type, alwaysOnTop) => {
  const overlayWindow = getOverlayWindow(type);
  if (overlayWindow) {
    overlayWindow.setAlwaysOnTop(alwaysOnTop);
    overlayWindow.setIgnoreMouseEvents(Boolean(store.get(`overlay.${type}.clickthrough`, false)), { forward: true });
  }
});

ipcMain.on('update-overlay-opacity', (event, type, opacity) => {
  const overlayWindow = getOverlayWindow(type);
  if (overlayWindow) {
    overlayWindow.webContents.executeJavaScript(`
      document.documentElement.style.opacity = '${opacity / 100}';
    `);
  }
});

ipcMain.on('toggle-overlay-transparent', (event, type, transparent) => {
  const overlayWindow = getOverlayWindow(type);
  if (overlayWindow) {
    // Toggle only the overlay background alpha so content remains visible.
    const alpha = transparent ? '0' : '0.8';
    overlayWindow.webContents.executeJavaScript(`
      document.documentElement.style.setProperty('--overlay-bg-alpha', '${alpha}');
      // ensure the window itself remains rendered
      document.documentElement.style.opacity = document.documentElement.style.opacity || '1';
      if (typeof updateTransparencyClass === 'function') updateTransparencyClass();
    `);
  }
});

ipcMain.on('update-overlay-background-alpha', (event, type, alpha) => {
  const overlayWindow = getOverlayWindow(type);
  if (overlayWindow) {
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    overlayWindow.webContents.executeJavaScript(`
      document.documentElement.style.setProperty('--overlay-bg-alpha', '${clampedAlpha}');
      if (typeof updateTransparencyClass === 'function') updateTransparencyClass();
    `);
  }
});

ipcMain.on('toggle-overlay-clickthrough', (event, type, clickthrough) => {
  const overlayWindow = getOverlayWindow(type);
  if (overlayWindow) {
    const locked = overlayState[type]?.locked || false;
    overlayWindow.setIgnoreMouseEvents(Boolean(locked && clickthrough), { forward: true });
  }
});

ipcMain.on('disable-hotkeys', () => {
  hotkeysSuspended = true;
});

ipcMain.on('enable-hotkeys', () => {
  hotkeysSuspended = false;
});

// Legacy aliases for backwards compatibility
ipcMain.on('suspend-hotkeys', () => {
  hotkeysSuspended = true;
});

ipcMain.on('resume-hotkeys', () => {
  hotkeysSuspended = false;
});

ipcMain.on('open-discord', () => {
  const { shell } = require('electron');
  shell.openExternal('https://discord.gg/A6VbBaRchn');
});

ipcMain.on('open-vdl', () => {
  const { shell } = require('electron');
  shell.openExternal('https://discord.gg/ydmbE7EVzX');
});

ipcMain.on('open-vdr', () => {
  const { shell } = require('electron');
  shell.openExternal('https://discord.gg/j8vwB5UqFD');
});

// OBS IPC: connect/disconnect, fetch scenes, and manage scene->overlay mapping
ipcMain.handle('obs-connect', async (event, config) => {
  try {
    await connectToOBS(config || {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('obs-disconnect', async () => {
  try {
    await disconnectOBS();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('obs-get-scenes', async () => {
  if (!obsClient) return { ok: false, error: 'Not connected' };
  try {
    const resp = await obsClient.call('GetSceneList');
    const scenes = (resp && resp.scenes) ? resp.scenes.map(s => s.sceneName || s.name || s) : [];
    return { ok: true, scenes };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('obs-get-mapping', () => {
  return { ok: true, mapping: getObsMapping() };
});

ipcMain.handle('obs-set-mapping', (event, mapping) => {
  try {
    store.set('obs.sceneMap', mapping || {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('windows-animation-status', async () => {
  try {
    return await queryWindowsAnimationsEnabled();
  } catch (err) {
    return { ok: false, enabled: false, canFix: true, error: String(err) };
  }
});

ipcMain.handle('enable-windows-animations', async () => {
  try {
    return await enableWindowsAnimations();
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('roblox-refresh', async () => {
  try {
    const status = await refreshRobloxIntegration();
    return { ok: true, ...status };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.on('roblox-config-updated', () => {
  refreshRobloxIntegration().catch(err => console.warn('Failed to refresh Roblox integration', err));
});

ipcMain.handle('queue-test-token', async () => {
  try {
    return await testQueueOverlayToken();
  } catch (err) {
    return { ok: false, message: String(err?.message || err || 'Queue token test failed.') };
  }
});

ipcMain.handle('ladder-fetch-player', async (event, payload = {}) => {
  try {
    const discordId = String(payload.discordId || '').trim();
    const serverId = String(payload.serverId || '').trim();
    const leaderboardId = String(payload.leaderboardId || '').trim();
    const apiUrl = String(payload.apiUrl || '').trim();

    if (!discordId || !serverId || !leaderboardId || !apiUrl) {
      return { ok: false, error: 'Missing ladder request parameters.' };
    }

    const result = await fetchSlugbotPlayer(discordId, serverId, leaderboardId, apiUrl);
    return result.ok ? result : { ok: false, error: result.error || 'Slugbot request failed.' };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || 'Ladder request failed.') };
  }
});

ipcMain.handle('simulate-update', async () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-checking');
    }

    await new Promise(resolve => setTimeout(resolve, 600));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', { version: '9.9.9-sim' });
    }

    let transferred = 0;
    const total = 18 * 1024 * 1024;
    while (transferred < total) {
      await new Promise(resolve => setTimeout(resolve, 260));
      transferred = Math.min(total, transferred + Math.round(Math.random() * 1024 * 1024));
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', {
          percent: Math.round((transferred / total) * 100),
          transferred,
          total,
          bytesPerSecond: 2 * 1024 * 1024,
        });
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', { version: '9.9.9-sim' });
    }

    return { ok: true };
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', { message: String(err?.message || err || 'Simulation failed') });
    }
    return { ok: false, error: String(err?.message || err || 'Simulation failed') };
  }
});

ipcMain.handle('check-for-updates', async () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-checking');
    return await checkLatestReleaseAndNotify();
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-error', { message: String(err?.message || err) });
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('install-update', async () => {
  try {
    return await downloadLatestInstallerAndLaunch();
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('get-release-notes-feed', async (event, { limit } = {}) => {
  try {
    const feed = await fetchReleaseNotesFeed(Number(limit) || 5);
    return { ok: true, feed };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('maps-ocr-list-window-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window'] });
  return sources
    .map(source => ({
      id: String(source.id || ''),
      name: String(source.name || ''),
      displayId: String(source.display_id || ''),
    }))
    .filter(source => source.name && !/^devtools$/i.test(source.name));
});

ipcMain.handle('maps-ocr-capture-display', async () => {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const thumbnailSize = {
    width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.size.height * display.scaleFactor)),
  };

  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  const displayId = String(display.id);
  const source = sources.find(item => String(item.display_id) === displayId) || sources[0];
  if (!source) throw new Error('No screen source available');

  const thumbnail = source.thumbnail;
  if (!thumbnail || thumbnail.isEmpty()) throw new Error('Captured screen image is empty');

  const size = thumbnail.getSize();
  return {
    id: source.id,
    name: source.name,
    dataUrl: thumbnail.toDataURL(),
    width: size.width,
    height: size.height,
  };
});

ipcMain.handle('maps-ocr-capture-window', async (event, targetName = 'roblox') => {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const thumbnailSize = {
    width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.size.height * display.scaleFactor)),
  };

  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize });
  const target = String(targetName || 'roblox').trim();
  const lowerTarget = target.toLowerCase();
  const source = sources.find(item => {
    const name = String(item.name || '').toLowerCase();
    if (!target || target === 'roblox') return /roblox/i.test(name);
    return name === lowerTarget || name.includes(lowerTarget);
  }) || sources[0];

  if (!source) throw new Error('No window source available');
  const thumbnail = source.thumbnail;
  if (!thumbnail || thumbnail.isEmpty()) throw new Error('Captured window image is empty');

  const size = thumbnail.getSize();
  return {
    id: source.id,
    name: source.name,
    dataUrl: thumbnail.toDataURL(),
    width: size.width,
    height: size.height,
  };
});

ipcMain.handle('maps-ocr-recognize', async (event, imageDataUrl) => {
  const result = await recognize(imageDataUrl, 'eng', {
    logger: () => {},
  });

  return {
    text: result?.data?.text || '',
    confidence: Number(result?.data?.confidence),
  };
});

// Forward preview-mode called from main renderer to overlay windows
ipcMain.on('ui-preview-mode', (event, enabled) => {
  Object.values(overlayWindows).forEach(w => { if (w) w.webContents.send('ui-preview-mode', enabled); });
});

// Forward ui-scale changes to overlay windows
ipcMain.on('ui-scale-changed', (event, scale) => {
  const s = Number(scale) || 1;
  Object.values(overlayWindows).forEach(w => {
    if (!w) return;
    try {
      w.webContents.send('ui-scale-changed', s);
    } catch (err) {
      console.warn('Failed sending ui-scale-changed to overlay', err);
    }
  });
});

// Save overlay screenshot on request from overlay window
ipcMain.on('overlay-screenshot', async (event) => {
  try {
    const sender = event.sender;
    const win = BrowserWindow.fromWebContents(sender);
    if (!win) return;
    const image = await win.capturePage();
    const buffer = image.toPNG();
    const destDir = path.join(app.getPath('pictures') || __dirname, 'vd-overlay-screenshots');
    fs.mkdirSync(destDir, { recursive: true });
    const filename = path.join(destDir, `overlay-${Date.now()}.png`);
    fs.writeFileSync(filename, buffer);
    sender.send('overlay-screenshot-saved', filename);
  } catch (err) {
    console.error('Failed to capture overlay screenshot', err);
    event.sender.send('overlay-screenshot-failed', String(err));
  }
});

// Build hotkey bindings used by the passive uiohook listener
function registerHotkeys() {
  ensureUiohookStarted();

  // Collect hotkey bindings from store and defaults
  const keys = Object.keys(HOTKEY_DEFAULTS);
  const bindings = {};
  keys.forEach(k => {
    const accel = store.get(`hotkeys.${k}`, HOTKEY_DEFAULTS[k]);
    if (accel) bindings[k] = accel;
  });

  // Reverse map to detect duplicates
  const accelToName = {};
  Object.entries(bindings).forEach(([name, accel]) => {
    if (!accel) return;
    if (!accelToName[accel]) accelToName[accel] = [];
    accelToName[accel].push(name);
  });

  // Warn about duplicates (do not register duplicates)
  Object.entries(accelToName).forEach(([accel, names]) => {
    if (names.length > 1) {
      console.warn(`Hotkey conflict for ${accel}: ${names.join(', ')} - skipping registration`);
      delete bindings[names[0]]; // Keep first mapping by default
    }
  });

  hotkeyBindings = Object.entries(bindings)
    .map(([name, accel]) => ({ name, accel, binding: parseHotkeyAccelerator(accel) }))
    .filter(item => item.binding);

  hotkeyBindings.forEach(item => {
    console.log(`Registered hotkey listener ${item.name} -> ${item.accel}`);
  });
}

app.whenReady().then(() => {
  createMainWindow();
  registerHotkeys();
  // Start Roblox watcher only if user enabled it in settings
  try {
    const robloxCfg = getRobloxConfig();
    if (robloxCfg.enabled) startRobloxWatcher();
  } catch (e) {
    console.warn('Failed to start Roblox watcher based on config', e);
  }
  // attempt to start a native gamepad bridge executable if present
  try {
    startGamepadBridge((channel, payload) => {
      if (mainWindow && mainWindow.webContents) mainWindow.webContents.send(channel, payload);
    });
  } catch (e) {
    console.warn('Failed to start gamepad bridge', e);
  }
});

app.on('window-all-closed', () => {
  if (uiohookStarted) {
    try {
      uIOhook.stop();
    } catch (error) {
      console.warn('Failed to stop uiohook listener', error);
    }
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
