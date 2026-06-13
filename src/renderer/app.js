const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const Store = require('electron-store');
const { PreciseTimer, formatMillisDynamic } = require('../shared/onevone');
let html2canvas = null;
try {
  html2canvas = require('html2canvas');
} catch (e) {
  console.warn('html2canvas is not available yet:', e?.message || e);
}
const store = new Store();

const MAP_OCR_DEFAULT_ZONE = {
  x: 14,
  y: 10,
  width: 72,
  height: 18,
};

// Persistent install identifier for this application instance. Stored in electron-store.
function getInstallId() {
  let id = store.get('install.id', null);
  if (!id) {
    try {
      id = (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    } catch (e) {
      id = `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
    }
    try { store.set('install.id', id); } catch (e) { /* ignore store write errors */ }
  }
  return id;
}

// Helper to extract activation device id from a license record returned by Supabase
function getKeyActivationId(keyRecord) {
  if (!keyRecord || typeof keyRecord !== 'object') return null;
  return keyRecord.activated_device_id || keyRecord.activated_device || null;
}

// Debug: log install id at startup so renderer console shows the helper is available
try {
  console.log('install id:', getInstallId());
} catch (e) {
  console.warn('getInstallId not available at startup:', e);
}

// Supabase configuration was previously embedded here; keys are now fetched via main process or env/store

// UI scale persisted setting: apply to document root for overlays and UI
let dpiScaleFactor = 1;
const initialUiScale = Number(store.get('ui.scale', 1)) || 1;
try {
  document.documentElement.style.setProperty('--ui-scale', initialUiScale);
} catch (e) {
  // document may not be ready in some contexts; set later when DOM is available
}

function applyUiScaleToDocument(scale) {
  const userScale = Number(scale) || 1;
  try {
    document.documentElement.style.setProperty('--ui-scale', userScale);
  } catch (e) {
    console.warn('Could not apply UI scale yet');
  }
  ipcRenderer.send('ui-scale-changed', userScale);
}

function setUiScale(scale) {
  const s = Number(scale) || 1;
  store.set('ui.scale', s);
  try {
    document.documentElement.style.setProperty('--overlay-opacity', store.get('overlay.alpha', 0.16));
  } catch (e) {
    console.warn('Could not set overlay opacity yet');
  }
  applyUiScaleToDocument(s);
}

function setDpiScaleFactor(scale) {
  const next = Number(scale) || 1;
  if (!Number.isFinite(next) || next <= 0) return;
  dpiScaleFactor = next;
  applyUiScaleToDocument(Number(store.get('ui.scale', 1)) || 1);
}

ipcRenderer.on('dpi-scale-changed', (event, scale) => {
  setDpiScaleFactor(scale);
});

// Show map preview modal
function showMapPreviewModal(imagePath) {
  const modal = document.getElementById('map-preview-modal');
  const img = document.getElementById('map-preview-image');
  if (modal && img) {
      // Normalize local filesystem paths to file:// URLs when needed
      try {
        if (imagePath && !/^\w+:\/\//.test(imagePath)) {
          imagePath = pathToFileURL(imagePath).href;
        }
      } catch (e) {
        // leave imagePath as-is on errors
      }

      img.src = imagePath || '';
      // Ensure preview image is fully visible regardless of overlay alpha setting
      img.style.opacity = '';
      modal.style.display = 'flex';
      // animate in
      modal.classList.remove('closing');
      requestAnimationFrame(() => modal.classList.add('open'));
  }
}

// Close map preview modal
function closeMapPreviewModal() {
  const modal = document.getElementById('map-preview-modal');
  if (!modal) return;
  // animate out then hide
  modal.classList.remove('open');
  modal.classList.add('closing');
  setTimeout(() => {
    modal.style.display = 'none';
    modal.classList.remove('closing');
  }, 220);
}

// Item preview modal (populated from game info items)
function showItemPreviewModal(itemName) {
  const modal = document.getElementById('item-preview-modal');
  const img = document.getElementById('item-preview-image');
  const title = document.getElementById('item-preview-title');
  const summary = document.getElementById('item-preview-summary');
  const detail = document.getElementById('item-preview-detail');
  if (!modal) return;
  const item = (Array.isArray(GAME_INFO_ITEMS) && GAME_INFO_ITEMS.find(i => i.name === itemName)) || null;
  if (item) {
    img.src = item.image || '';
    title.textContent = item.name || itemName;
    summary.textContent = item.summary || '';
    detail.textContent = item.detail || '';
  } else {
    img.src = '';
    title.textContent = itemName;
    summary.textContent = '';
    detail.textContent = '';
  }
  modal.style.display = 'flex';
  modal.classList.remove('closing');
  requestAnimationFrame(() => modal.classList.add('open'));
}

function closeItemPreviewModal() {
  const modal = document.getElementById('item-preview-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.classList.add('closing');
  setTimeout(() => {
    modal.style.display = 'none';
    modal.classList.remove('closing');
  }, 220);
}

// Open Discord invite link
function openDiscord() {
  try {
    console.log('openDiscord called');
    ipcRenderer.send('open-discord');
  } catch (err) {
    console.error('openDiscord error:', err);
  }
}

function openVDL() {
  try {
    console.log('openVDL called');
    ipcRenderer.send('open-vdl');
  } catch (err) {
    console.error('openVDL error:', err);
  }
}

function openVDR() {
  try {
    console.log('openVDR called');
    ipcRenderer.send('open-vdr');
  } catch (err) {
    console.error('openVDR error:', err);
  }
}

// Generate a random alphanumeric key (32 characters)
function generateRandomKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

// Show success message
function showSuccessMessage() {
  const successMsg = document.getElementById('success-message');
  successMsg.style.display = 'flex';
  
  // Auto-hide after 2 seconds
  setTimeout(() => {
    successMsg.style.display = 'none';
  }, 2000);
}

function copyTextToClipboard(text) {
  if (!text) return Promise.resolve(false);
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return Promise.resolve(ok);
}

function getUpdateSummaryText() {
  return state.startupUpdate.flowActive ? 'Update flow active' : 'Ready';
}

function getDiagnosticsSnapshot() {
  return {
    app: 'VD OverlayTools',
    version: store.get('app.version', null) || '1.0.0',
    installId: getInstallId(),
    accountType: 'premium',
    updateState: getUpdateSummaryText(),
    uiTheme: state.uiTheme,
    activeTab: state.activeTab,
    overlayCount: Object.values(state.overlays).filter(item => item.enabled).length,
    ladderStatus: state.ladder.fetchStatus || '',
    timestamp: new Date().toISOString(),
  };
}

async function refreshSettingsDiagnostics() {
  const installIdEl = document.getElementById('settings-install-id');
  const updateStateEl = document.getElementById('settings-update-state');
  if (installIdEl) installIdEl.textContent = getInstallId();
  if (updateStateEl) updateStateEl.textContent = getUpdateSummaryText();
}

async function handleCopyDebugInfo() {
  const statusEl = document.getElementById('settings-debug-status');
  const payload = JSON.stringify(getDiagnosticsSnapshot(), null, 2);
  const ok = await copyTextToClipboard(payload);
  if (statusEl) statusEl.textContent = ok ? 'Debug info copied.' : 'Copy failed.';
  if (ok) showSuccessMessage();
}

function renderReleaseNotesFeed(feed = []) {
  const container = document.getElementById('release-notes-feed');
  if (!container) return;
  if (!Array.isArray(feed) || !feed.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No release notes yet</div>
        <div>Once a release is published, the latest notes will appear here.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = feed.map(entry => {
    const title = escapeHtml(entry.version || entry.tag || 'Release');
    const date = entry.publishedAt ? new Date(entry.publishedAt).toLocaleDateString() : 'Unknown date';
    const badge = entry.prerelease ? 'Pre-release' : (entry.draft ? 'Draft' : 'Latest');
    const lines = Array.isArray(entry.bodyLines) ? entry.bodyLines : [];
    return `
      <div class="release-note-card">
        <div class="release-note-head">
          <div>
            <div class="release-note-title">${title}</div>
            <div class="release-note-meta">${escapeHtml(date)} • ${escapeHtml(badge)}</div>
          </div>
          ${entry.htmlUrl ? `<a class="btn sm" href="javascript:void(0)" data-open-release-url="${escapeHtml(entry.htmlUrl)}">Open</a>` : ''}
        </div>
        <div class="release-note-body">
          ${lines.length ? lines.map(line => `<div class="changelog-item"><span class="changelog-dot"></span><span>${escapeHtml(line)}</span></div>`).join('') : '<div class="empty-state"><div class="empty-state-title">No details published</div><div>This release does not include release note text.</div></div>'}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-open-release-url]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.getAttribute('data-open-release-url');
      if (!url) return;
      try {
        await ipcRenderer.invoke('open-external', url);
      } catch (e) {
        window.open(url, '_blank');
      }
    });
  });
}

async function loadReleaseNotesFeed() {
  const container = document.getElementById('release-notes-feed');
  if (container) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">Loading release notes</div>
        <div>Fetching the latest releases from GitHub.</div>
      </div>
    `;
  }

  try {
    const res = await ipcRenderer.invoke('get-release-notes-feed', { limit: 5 });
    if (!res || !res.ok) throw new Error(res?.error || 'Unable to load release notes');
    renderReleaseNotesFeed(res.feed || []);
  } catch (err) {
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">Release notes unavailable</div>
          <div>${escapeHtml(String(err?.message || err))}</div>
        </div>
      `;
    }
  }
}

const MAPS_DIR = path.join(__dirname, '../../assets/maps');

function formatMapName(fileName) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*(Clock|Hitta|Wip|Club\s+Wip)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function loadProvidedMaps(region = 'NA') {
  const mapsDir = region === 'EU' ? path.join(__dirname, '../../assets/maps/VDR') : path.join(__dirname, '../../assets/maps');
  if (!fs.existsSync(mapsDir)) return [];

  return fs.readdirSync(mapsDir)
    .filter(fileName => /\.(png|jpe?g|webp|gif)$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right))
    .map(fileName => ({
      name: formatMapName(fileName),
      filename: fileName,
      image: path.join(mapsDir, fileName),
      emoji: '🗺',
      tokens: buildMapTokens(formatMapName(fileName)),
    }));
}

function buildMapTokens(name) {
  const lower = name.toLowerCase();
  const parts = lower.split(' ').filter(Boolean);
  const tokens = [lower];
  // individual significant words
  const skip = ['hitta', 'clock', 'wip', 'club', 'the', 'a', 'an'];
  for (const p of parts) {
    if (!skip.includes(p)) tokens.push(p);
  }
  // consecutive pairs
  for (let i = 0; i < parts.length - 1; i++) {
    const pair = parts.slice(i, i + 2).join(' ');
    if (!tokens.includes(pair)) tokens.push(pair);
  }
  // name without clutter words
  const stripped = parts.filter(p => !skip.includes(p)).join(' ');
  if (stripped && !tokens.includes(stripped)) tokens.push(stripped);
  return tokens;
}

const KILLER_MODELS_DIR = path.join(__dirname, '../../assets/killers/full-models');
const KILLER_MODEL_ALIASES = {
  veil: ['Veil.png', 'The_Veil.png', 'veil.png', 'the_veil.png'],
  hidden: ['Hidden.png', 'The_Hidden.png', 'hidden.png', 'the_hidden.png', 'subject617.png'],
  jacket: ['Jacket.png', 'The_Masked.png', 'masked.png', 'the_masked.png', 'jacket.png'],
  abyss: ['The_Abysswalker.png', 'abysswalker.png', 'the_abysswalker.png', 'artorias.png'],
  jeff: ['The_Killer.png', 'Jeff.png', 'killer.png', 'the_killer.png', 'jeff.png'],
  jason: ['Jason.png', 'The_Slasher.png', 'slasher.png', 'the_slasher.png', 'jason.png'],
  cure: ['The Cure.png', 'cure.png', 'the_cure.png', 'scp049.png'],
  'the stalker michael myers': ['The_Stalker.png', 'stalker.png', 'the_stalker.png', 'michael.png'],
  'the killer jeff the killer': ['The_Killer.png', 'Jeff.png', 'killer.png', 'the_killer.png', 'jeff.png'],
  'the hidden subject 617': ['Hidden.png', 'The_Hidden.png', 'hidden.png', 'the_hidden.png', 'subject617.png'],
  'the abysswalker artorias': ['The_Abysswalker.png', 'abysswalker.png', 'the_abysswalker.png', 'artorias.png'],
  'the veil veil': ['Veil.png', 'The_Veil.png', 'veil.png', 'the_veil.png'],
  'the slasher jason': ['Jason.png', 'The_Slasher.png', 'slasher.png', 'the_slasher.png', 'jason.png'],
  'the masked jacket': ['Jacket.png', 'The_Masked.png', 'masked.png', 'the_masked.png', 'jacket.png'],
  'the cure scp 049': ['The Cure.png', 'cure.png', 'the_cure.png', 'scp049.png'],
};

function resolveKillerModelImage(killerName, fallbackImage) {
  if (!fs.existsSync(KILLER_MODELS_DIR)) return fallbackImage;

  const normalized = normalizeKillerName(killerName);
  const aliases = KILLER_MODEL_ALIASES[normalized] || [];
  for (const fileName of aliases) {
    const candidate = path.join(KILLER_MODELS_DIR, fileName);
    if (fs.existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }

  return fallbackImage;
}

const KILLERS = [
  { name: 'Veil', icon: '👁', image: resolveKillerModelImage('Veil', '') },
  { name: 'Hidden', icon: '🕶', image: resolveKillerModelImage('Hidden', '') },
  { name: 'Jacket', icon: '🧥', image: resolveKillerModelImage('Jacket', '') },
  { name: 'Abyss', icon: '🌑', image: resolveKillerModelImage('Abyss', '') },
  { name: 'Jeff', icon: '🔪', image: resolveKillerModelImage('Jeff', '') },
  { name: 'Jason', icon: '🪓', image: resolveKillerModelImage('Jason', '') },
  { name: 'Cure', icon: '⚕', image: resolveKillerModelImage('Cure', '') },
];

const FONTS = [
  { name: 'Cinzel', sample: 'Victory' },
  { name: 'Syne', sample: 'Victory' },
  { name: 'Courier New', sample: 'Victory' },
  { name: 'Georgia', sample: 'Victory' },
  { name: 'Impact', sample: 'VICTORY' },
  { name: 'Palatino', sample: 'Victory' },
  { name: 'Trebuchet MS', sample: 'Victory' },
  { name: 'Verdana', sample: 'Victory' },
];

// Icon helper: prefer SVG/PNG from several asset folders (perk icons, killer perk icons, killer models)
const ICON_SEARCH_DIRS = [
  path.join(__dirname, '../../assets/Perk icons'),
  path.join(__dirname, '../../assets/Killer perk icons'),
  path.join(__dirname, '../../assets/killers/full-models'),
  path.join(__dirname, '../../assets/icons'),
];

function createIconElement(name, size = 20) {
  const img = document.createElement('img');
  img.className = 'icon';
  img.width = size;
  img.height = size;
  img.alt = name;

  if (!name) return img;

  // build candidate base names: original, spaces->_, spaces->-
  const baseNames = [String(name).trim(), String(name).trim().replace(/\s+/g, '_'), String(name).trim().replace(/\s+/g, '-')];

  for (const dir of ICON_SEARCH_DIRS) {
    for (const base of baseNames) {
      // check SVG first
      const svgPath = path.join(dir, `${base}.svg`);
      if (fs.existsSync(svgPath)) {
        img.src = pathToFileURL(svgPath).href;
        return img;
      }

      // check PNG variants
      const png1 = path.join(dir, `${base}.png`);
      const png2 = path.join(dir, `${base}@2x.png`);
      const png3 = path.join(dir, `${base}@3x.png`);
      if (fs.existsSync(png1)) img.src = pathToFileURL(png1).href;
      const srcset = [];
      if (fs.existsSync(png2)) srcset.push(`${pathToFileURL(png2).href} 2x`);
      if (fs.existsSync(png3)) srcset.push(`${pathToFileURL(png3).href} 3x`);
      if (img.src) {
        if (srcset.length) img.setAttribute('srcset', srcset.join(', '));
        return img;
      }
    }
  }

  return img;
}

function resolveIconUrl(name) {
  if (!name) return null;
  const baseNames = [String(name).trim(), String(name).trim().replace(/\s+/g, '_'), String(name).trim().replace(/\s+/g, '-')];
  for (const dir of ICON_SEARCH_DIRS) {
    for (const base of baseNames) {
      const svgPath = path.join(dir, `${base}.svg`);
      if (fs.existsSync(svgPath)) return pathToFileURL(svgPath).href;
      const pngPath = path.join(dir, `${base}.png`);
      if (fs.existsSync(pngPath)) return pathToFileURL(pngPath).href;
    }
  }
  return null;
}

function getPerkIconHtml(perk) {
  const iconName = String(perk?.icon || perk?.name || '').trim();
  const icon = createIconElement(iconName, 34);
  icon.className = 'icon perk-icon-img';
  return icon.outerHTML;
}

window.createIconElement = createIconElement;

const GAME_INFO_ITEMS = [
  {
    name: 'Motion Tracker',
    image: 'https://trello.com/1/cards/699e2519a7ede6f29c24e9aa/attachments/699e256e52d803a1db7eb2e9/download/Motion%2BTracker.png',
    summary: 'Beeping tracker that ignores undetectable and gets more intense as the killer closes in.',
    detail: 'Range: 250 studs | Cost: 3000 screws',
  },
  {
    name: 'Flashlight',
    image: 'https://trello.com/1/cards/699e253218e9c1cfbd162c02/attachments/699e257aa48b966c9609da45/download/Flashlight.png',
    summary: 'A short-range blind tool that can flash the killer when aimed at their face.',
    detail: 'Range: 60 studs | Durability: 15 seconds',
  },
  {
    name: 'Bandage',
    image: 'https://trello.com/1/cards/699e2539cc4b8fc602030e6e/attachments/699e257f2e42b0126f62c33b/download/Bandage.png',
    summary: 'Self-heal item that restores 1.5 health states and keeps you in place while healing.',
    detail: 'Cost: 3500 screws | Full heal: 20 seconds',
  },
  {
    name: 'Parrying Dagger',
    image: 'https://trello.com/1/cards/699e2541a9c9dee0e6523eb2/attachments/699e2585f4dda9ad9e55a089/download/Parrying%2BDagger.png',
    summary: 'Guard stance tool that can stun a killer who physically hits into it.',
    detail: 'Cooldown: 50 seconds | Stun: 4 seconds',
  },
  {
    name: 'Adrenaline Shot',
    image: 'https://trello.com/1/cards/699e2549f8522186944f1b6e/attachments/699e258aa5431e93bee7ea2f/download/Adrenaline%2BShot.png',
    summary: 'A flexible clutch item that boosts movement when healthy and can stand you back up when dying.',
    detail: 'Cost: 5000 screws | Cooldown: 90 seconds',
  },
  {
    name: 'Twist of Fate',
    image: 'https://trello.com/1/cards/699e24ee965fddf1eca1e0db/attachments/699e256404ca279373b8c0d3/download/Twist%2Bof%2BFate.png',
    summary: 'A gamble item that can fire a hit-scan shot for a stun or backfire into damage.',
    detail: 'Cost: 7500 screws | Fire chance: 60%',
  },
];

const GAME_INFO_SURVIVOR_PERK_FAMILIES = [
  {
    name: 'Chase Perks',
    detail: 'Perks used to extend chase time, avoid hits, and hold strong loops longer.',
  },
  {
    name: 'Speed Perks',
    detail: 'Trello speed category perks that give movement bursts or consistent pace boosts.',
  },
  {
    name: 'Aura Perks',
    detail: 'Information perks that reveal killer or survivor positions for better decisions.',
  },
  {
    name: 'Healing Perks',
    detail: 'Strong sustain options that speed up resets and help teams stabilize after pressure.',
  },
  {
    name: 'Other Perks',
    detail: 'Utility perks for saves, wiggle, gate, team value, and endgame survivability.',
  },
];

const GAME_INFO_SURVIVOR_PERKS = {
  aura: [
    { name: 'Absolute Confidence', icon: 'Absolute_Confidence', summary: 'While in chase, reveals nearby survivor auras and grants them faster action speed.' },
    { name: 'Call Me Back', icon: 'Call_Me_Back', summary: 'After healing an ally, reveals their aura to you when they are hit by the killer.' },
    { name: 'Eyes of Heaven', icon: 'Eyes_Of_Heaven', summary: 'Reveals nearby pallets and windows to improve pathing and routing.' },
    { name: 'Hearing Aid', icon: 'Hearing_Aid', summary: 'Reveals killer aura after loud actions like pallet breaks and gen kicks.' },
  ],
  speed: [
    { name: 'Born in Blood', icon: 'Born_In_Blood', summary: 'Starting a heal on another survivor grants both of you a temporary speed boost.' },
    { name: 'Great Collapse', icon: 'Great_Collapse', summary: 'Pallet stunning the killer gives a short speed burst, then applies winded.' },
    { name: 'Perfect Landing', icon: 'Perfect_Landing', summary: 'Improves fall recovery and grants a movement boost after dropping from height.' },
    { name: 'Quick Recovery', icon: 'Quick_Recovery', summary: 'Rushed vaults trigger a brief speed burst, followed by winded cooldown.' },
  ],
  chase: [
    { name: 'Flowstate', icon: 'Flowstate', summary: 'Fast vaults are 20% quicker and then enter cooldown, enabling cleaner chase turns.' },
    { name: 'On Screen Fear', icon: 'On_Screen_Fear', summary: 'Inside terror radius and outside chase, gain movement and action speed boosts.' },
    { name: 'Snake Step', icon: 'Snake_Step', summary: 'Massively increases crouch speed, giving stealthy chase reposition options.' },
    { name: 'Time to Grow Up', icon: 'Time_To_Grow_Up', summary: 'Extends post-hit speed boost duration so you can make more distance.' },
  ],
  healing: [
    { name: 'Against All Odds', icon: 'Against_All_Odds', summary: 'Healing survivors from dying state grants a large healing speed bonus.' },
    { name: 'Enhanced Touch', icon: 'Enhanced_Touch', summary: 'Healing another survivor gives them temporary boosts to healing, repair, and speed.' },
    { name: 'Grab My Hand', icon: 'Grab_My_Hand', summary: 'Unhooking instantly grants a chunk of heal progress to the rescued survivor.' },
    { name: 'Pacifist', icon: 'Pacifist', summary: 'Increases healing speed but applies a generator repair speed penalty.' },
  ],
  other: [
    { name: 'Desperate', icon: 'Desperate', summary: 'Gain wiggle progress immediately when the killer picks you up.' },
    { name: 'Group Project', icon: 'Group_Project', summary: 'Nearby allies receive generator speed boosts that scale with survivor count.' },
    { name: 'High Karma', icon: 'High_Karma', summary: 'After unhooking, enables first-hook self-unhook conditions with anti-heal tradeoff.' },
    { name: 'Second Wind', icon: 'Second_Wind', summary: 'Extends endurance duration after being unspiked or self-unspiking.' },
  ],
};

const GAME_INFO_KILLERS = [
  {
    name: 'The Stalker / Michael Myers',
    image: 'https://trello.com/1/cards/698e18f0b29c0dabeaf996c9/attachments/699722b0836eb904d2921fcc/download/The_Stalker.png',
    summary: 'Base speed 18.7 studs per second with stalk-based pressure and Evil\'s Grasp bursts.',
    perks: [
      {
        name: 'Predator',
        icon: 'Predator',
        summary: 'After a chase ends, the survivor aura is revealed for 4 seconds on a 40/35/30 second cooldown.',
      },
      {
        name: 'Eternal Torment',
        icon: 'Eternal_Torment',
        summary: 'When you are stunned, the survivor that stunned you gains Vulnerable for 20/25/30 seconds.',
      },
      {
        name: 'Play With Your Food',
        icon: 'Play_With_Your_Food',
        summary: 'Chase endings grant tokens that increase your movement speed by 2/3/4%, up to 3 tokens.',
      },
    ],
    counter: 'Keep moving, deny free stalk time, and force bad angles before the dash starts.',
  },
  {
    name: 'The Killer / Jeff the Killer',
    image: 'https://trello.com/1/cards/698e1c2454a969e3f72af203/attachments/699722f799290e6b9f65a364/download/The_Killer.png',
    summary: 'A frenzy-based killer with chain pressure that gets faster as attacks land.',
    perks: [
      {
        name: 'Terror Spread',
        icon: 'Terror_Spread',
        summary: 'Whenever a generator is finished, survivors gain Winded for 20/30/40 seconds.',
      },
      {
        name: 'Sloppy Mess',
        icon: 'Sloppy_Mess',
        summary: 'After a basic hit, healing becomes 25/30/35% slower and blood pools appear twice as often.',
      },
      {
        name: 'Resentment Clinger',
        icon: 'Resentment_Clinger',
        summary: 'Spike a survivor to gain 2 tokens or get stunned to gain 1; each token boosts lunge duration by 30/40/50%.',
      },
    ],
    counter: 'Break line of sight early and avoid feeding chain hits in open space.',
  },
  {
    name: 'The Hidden / Subject 617',
    image: 'https://trello.com/1/cards/698e1c29c2646fab6de64c1e/attachments/699738cbd83e1eb243db8c51/download/The_Hidden.png',
    summary: 'Stillness grants invisibility and its dash plus leap punish predictable routes.',
    perks: [
      {
        name: 'Echo Location',
        icon: 'Echo_Location',
        summary: 'Kicking a generator reveals survivor auras within 70 studs for 3/4/5 seconds.',
      },
      {
        name: 'Enhanced Senses',
        icon: 'Enhanced_Senses',
        summary: 'Rushed actions reveal the survivor aura for 4/5/6 seconds with a 30 second cooldown.',
      },
      {
        name: 'Next in Line',
        icon: 'Next_In_Line',
        summary: 'Downing a survivor reveals the aura of the farthest survivor for 3/4/5 seconds.',
      },
    ],
    counter: 'Never stand still for long and keep changing direction when the dash is available.',
  },
  {
    name: 'The Abysswalker / Artorias',
    image: 'https://trello.com/1/cards/698e1c2e4d950a3a4b550705/attachments/699722fa20c9c1eedaaad723/download/The_Abysswalker.png',
    summary: 'A dash-and-burst killer that mixes a wide swing with ranged slowdown pressure.',
    perks: [
      {
        name: 'Corrupted Path',
        icon: 'Corrupted_Path',
        summary: 'Hitting a survivor makes them leave a trackable trail for 10/15/20 seconds.',
      },
      {
        name: 'Abyssal Covenant',
        icon: 'Abyssal_Covenant',
        summary: 'Generators at 50% can become corrupt, explode, and alert you, with up to 4 triggers per match.',
      },
      {
        name: 'Shadow Trace',
        icon: 'Shadow_Trace',
        summary: 'You gain Undetectable for 30/45/60 seconds at the start of the match.',
      },
    ],
    counter: 'Respect the windup and crouch the swing when you can read the line.' ,
  },
  {
    name: 'The Veil / Veil',
    image: 'https://trello.com/1/cards/698e1c336257879730f04174/attachments/699722fc3e7415d446c17486/download/The_Veil.png',
    summary: 'A spear wielder that swaps between melee and ranged pressure with wall phasing.',
    perks: [
      {
        name: 'Piercing Reverie',
        icon: 'Piercing_Reverie',
        summary: 'Hitting a survivor grants a token that can lock a generator, pause repair, and increase regression pressure.',
      },
      {
        name: 'Blood Between Worlds',
        icon: 'Blood_Between_Worlds',
        summary: 'Whenever a survivor loses a health state, the two most progressed generators regress faster for 16 seconds.',
      },
      {
        name: 'Echo Of The Void',
        icon: 'Echo_Of_The_Void',
        summary: 'Holding line of sight on a survivor for 1.5/1.2/0.9 seconds reveals their aura and blurs their vision.',
      },
    ],
    counter: 'Dodge the charge rhythm and force awkward throws before the spear can connect.',
  },
  {
    name: 'The Slasher / Jason',
    image: 'https://trello.com/1/cards/698e1c84ed716733d08a11cc/attachments/6997230582d61b96fac21bc1/download/The_Slasher.png',
    summary: 'A high-speed pursuit killer that can bully pallets and shift into a stealth state.',
    perks: [
      {
        name: 'Excitement',
        icon: 'Excitement',
        summary: 'Carrying a survivor grants a 10/15/20% speed boost and increases terror radius by 36 studs.',
      },
      {
        name: 'Brutal Strength',
        icon: 'Brutal_Strenght',
        summary: 'Break-type actions are 20/30/40% quicker, including generator kicks and pallet breaks.',
      },
      {
        name: 'Off-Screen Scare',
        icon: 'Off_Screen_Scare',
        summary: 'When not in chase, gain a 6/8/10% speed boost to help reposition and ambush.',
      },
    ],
    counter: 'Play around the pursuit window and do not overcommit near pallet chains.' ,
  },
  {
    name: 'The Masked / Jacket',
    image: 'https://trello.com/1/cards/698e1c8e4dc4c379a5b23060/attachments/69972306f34400dabf239772/download/The_Masked.png',
    summary: 'A mask-swapping killer with multiple trait modes, including undetectable and chainsaw pressure.',
    perks: [
      {
        name: 'Heavy Swing',
        icon: 'Hard_Swing',
        summary: 'When a survivor is damaged, they gain Winded for 10/15/20 seconds.',
      },
      {
        name: 'Combo Streak',
        icon: 'Combo_Streak',
        summary: 'Each basic hit grants a 5% speed boost for 11/12/13 seconds.',
      },
      {
        name: 'Crackdown',
        icon: 'Crackdown',
        summary: 'Generator kicks deal 3/6/9 extra charges of damage, making pressure much harder to ignore.',
      },
    ],
    counter: 'Track the mask swap and punish the slower change animation before the mode locks in.',
  },
  {
    name: 'The Cure / SCP-049',
    image: 'https://trello.com/1/cards/69be9480f1a2bfe46bc818a8/attachments/69c268199609c041d8a3a702/download/image-1_177x26_708x378.png',
    summary: 'Base speed 18.7 studs/s with pestilence flask pressure and infection-based zombies. Hold flask to slow survivors 30% and gain pallet break speed; infect survivors to create SCP-049-2 allies.',
    perks: [
      {
        name: 'Foundation Staff',
        icon: 'Foundation_Staff',
        summary: 'Gain a token for each survivor you infect; each token increases your pallet break and window vault speed by 3/4/5%.',
      },
      {
        name: 'Sustenance',
        icon: 'Sustenance',
        summary: 'Infected survivors heal 20/25/30% slower and your zombies gain 5% increased movement speed.',
      },
      {
        name: 'Desire for the Living',
        icon: 'Desire_For_The_Living',
        summary: 'When a survivor is infected, nearby zombies gain 10/15/20% increased chase speed for 10 seconds.',
      },
    ],
    counter: 'Avoid the flask projectile by breaking line of sight; manage infection status and coordinate with teammates to eliminate spawned zombies.',
  },
];

for (const killer of GAME_INFO_KILLERS) {
  killer.image = resolveKillerModelImage(killer.name, killer.image);
}

function normalizeKillerName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getKillerWikiInfo(killerName) {
  const normalizedName = normalizeKillerName(killerName);
  if (!normalizedName) return null;

  return GAME_INFO_KILLERS.find(killer => {
    const normalizedEntryName = normalizeKillerName(killer.name);
    return normalizedEntryName.includes(normalizedName) || normalizedName.includes(normalizedEntryName);
  }) || null;
}

function getWinstreakKillerData(killerName) {
  const killer = KILLERS.find(entry => entry.name === killerName) || KILLERS[0] || null;
  const wikiInfo = getKillerWikiInfo(killerName);

  return {
    name: killer?.name || killerName || 'Unknown',
    icon: killer?.icon || '◌',
    image: wikiInfo?.image || '',
  };
}

function normalizeSurvivorWinstreakStatsEntry(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  return {
    gamesWon: Math.max(0, parseInt(source.gamesWon, 10) || 0),
    pb: String(source.pb || ''),
    worldRecord: String(source.worldRecord || ''),
    twoOut: Math.max(0, parseInt(source.twoOut, 10) || 0),
    threeOut: Math.max(0, parseInt(source.threeOut, 10) || 0),
    fourOut: Math.max(0, parseInt(source.fourOut, 10) || 0),
  };
}

const GAME_INFO_BASIC = [
  { label: 'Sprint', value: '17 studs per second' },
  { label: 'Walk', value: '10 studs per second' },
  { label: 'Crouch', value: '6 studs per second' },
  { label: 'Crawl', value: '4 studs per second' },
  { label: 'Bit Speed Boost', value: '20% for 2 seconds' },
  { label: 'Vault / Unhook', value: 'Fast vaults can be as low as 0.5 seconds' },
];

const GAME_INFO_COUNTERS = [
  {
    title: 'Stealth pressure',
    detail: 'Do not stand still, keep camera movement active, and force the killer to commit before they gain free information.',
  },
  {
    title: 'Dash killers',
    detail: 'Break line of sight, fake one direction, and save pallets for when the dash actually has to end.',
  },
  {
    title: 'Ranged killers',
    detail: 'Use cover, crouch where it matters, and make them throw early instead of giving a clean line.',
  },
  {
    title: 'Pallet bullies',
    detail: 'Rotate early, keep a small buffer of strong tiles, and do not burn every pallet in the first chase.',
  },
];

const ALL_SURVIVOR_PERKS = Object.values(GAME_INFO_SURVIVOR_PERKS).flat();

function normalizeCatalogName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getWinstreakItemCatalog() {
  return GAME_INFO_ITEMS.map(item => ({
    type: 'item',
    name: item.name,
    image: item.image,
    summary: item.summary,
    detail: item.detail,
  }));
}

function getWinstreakPerkCatalog() {
  return ALL_SURVIVOR_PERKS.map(perk => ({
    type: 'perk',
    name: perk.name,
    image: perk.icon ? resolveIconUrl(perk.icon) : '',
    summary: perk.summary,
  }));
}

function getWinstreakCatalog() {
  return [...getWinstreakPerkCatalog(), ...getWinstreakItemCatalog()];
}

function createDefaultRulesets() {
  return [
    { id: 'standard', name: 'Standard', description: 'Standard 3-perk competitive ruleset.', perkSlots: 3, itemSlots: 1, allowDuplicates: true },
    { id: 'perk-only', name: 'Perk Only', description: '3 perks, no items.', perkSlots: 3, itemSlots: 0, allowDuplicates: true },
    { id: 'full-perks', name: 'Full Perks', description: '4 perks, 2 items (open tournament).', perkSlots: 4, itemSlots: 2, allowDuplicates: true },
  ];
}

function createDefaultTournamentSets() {
  return [
    { id: 'dbdleague', name: 'DBDLeague', description: 'Default competitive balance set with all slots enabled.' },
    { id: 'no-item-rules', name: 'No Item Rules', description: 'For tournaments that ban items but allow perk duplication.' },
    { id: 'double-item', name: 'Double Item', description: 'Two item slots for flexible tournament loadouts.' },
  ];
}

function createDefaultWinstreakBuilds() {
  return Array.from({ length: 3 }, (_, index) => ({
    id: index + 1,
    name: `Build ${index + 1}`,
    role: 'survivor',
    rulesetId: 'standard',
    tournamentSetId: 'dbdleague',
    notes: '',
    perks: [],
    items: [],
  }));
}

function normalizeWinstreakBuildEntry(entry, fallbackId) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const build = {
    id: Number(source.id || fallbackId || 1),
    name: String(source.name || `Build ${fallbackId || 1}`),
    role: source.role === 'killer' ? 'killer' : 'survivor',
    rulesetId: String(source.rulesetId || 'standard'),
    tournamentSetId: String(source.tournamentSetId || 'dbdleague'),
    notes: String(source.notes || ''),
    perks: Array.isArray(source.perks) ? source.perks.map(perk => String(perk)).filter(Boolean) : [],
    items: Array.isArray(source.items) ? source.items.map(item => String(item)).filter(Boolean) : [],
  };
  return build;
}

function normalizeWinstreakBuildState(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const builds = Array.isArray(source.builds) && source.builds.length
    ? source.builds.slice(0, 3).map((build, index) => normalizeWinstreakBuildEntry(build, index + 1))
    : createDefaultWinstreakBuilds();

  while (builds.length < 3) {
    builds.push(normalizeWinstreakBuildEntry({}, builds.length + 1));
  }

  return {
    activeBuildId: Number(source.activeBuildId || 1),
    selectedKiller: String(source.selectedKiller || KILLERS[0]?.name || 'Veil'),
    selectedBalanceId: String(source.selectedBalanceId || 'dbdleague'),
    searchMode: source.searchMode === 'items' || source.searchMode === 'all' ? source.searchMode : 'all',
    searchQuery: String(source.searchQuery || ''),
    builds,
    rulesets: Array.isArray(source.rulesets) && source.rulesets.length ? source.rulesets : createDefaultRulesets(),
    tournamentSets: Array.isArray(source.tournamentSets) && source.tournamentSets.length ? source.tournamentSets : createDefaultTournamentSets(),
  };
}

function getActiveWinstreakBuild() {
  return state.winstreakBuilds.builds.find(build => build.id === state.winstreakBuilds.activeBuildId) || state.winstreakBuilds.builds[0];
}

function persistWinstreakBuildsState() {
  store.set('winstreak.builds', state.winstreakBuilds);
}

function getSelectedWinstreakBalance() {
  return state.winstreakBuilds.tournamentSets.find(entry => entry.id === state.winstreakBuilds.selectedBalanceId) || state.winstreakBuilds.tournamentSets[0] || null;
}

function getBuildRuleset(build) {
  return state.winstreakBuilds.rulesets.find(entry => entry.id === build.rulesetId) || state.winstreakBuilds.rulesets[0] || null;
}

function getTournamentSet(build) {
  return state.winstreakBuilds.tournamentSets.find(entry => entry.id === build.tournamentSetId) || state.winstreakBuilds.tournamentSets[0] || null;
}

function getWinstreakBuildKiller() {
  const killerName = state.winstreakBuilds.selectedKiller || KILLERS[0]?.name || 'Veil';
  const killer = KILLERS.find(entry => entry.name === killerName) || KILLERS[0] || null;
  return {
    name: killer?.name || killerName,
    image: resolveKillerModelImage(killer?.name || killerName, killer?.image || ''),
    icon: killer?.icon || '◌',
  };
}

function getWinstreakBuildEntryMeta(entryName, type) {
  const catalogEntry = getWinstreakCatalog().find(entry => entry.name === entryName && entry.type === type) || null;
  return {
    name: catalogEntry?.name || entryName || '',
    image: catalogEntry?.image || '',
    summary: catalogEntry?.summary || '',
    type: type || 'perk',
  };
}

function renderWinstreakBuildSlot(entryName, type, index) {
  const meta = entryName ? getWinstreakBuildEntryMeta(entryName, type) : null;
  return `
    <div class="build-slot ${type} ${meta ? 'filled' : 'empty'}" data-slot-index="${index}" data-slot-type="${type}">
      ${meta ? `
        <img class="build-slot-image" src="${escapeHtml(meta.image || '')}" alt="${escapeHtml(meta.name)}" />
        <div class="build-slot-glow"></div>
      ` : `
        <span class="build-slot-plus">+</span>
      `}
    </div>
  `;
}

function renderWinstreakBuildRow(build, index, activeBuildId) {
  const ruleset = getBuildRuleset(build);
  const perkCount = ruleset?.perkSlots || 3;
  const itemCount = ruleset?.itemSlots || 1;
  const perkSlots = Array.from({ length: perkCount }, (_, slotIndex) => renderWinstreakBuildSlot(build.perks[slotIndex], 'perk', slotIndex)).join('');
  const itemSlots = Array.from({ length: itemCount }, (_, slotIndex) => renderWinstreakBuildSlot(build.items[slotIndex], 'item', slotIndex)).join('');
  const balance = getTournamentSet(build) || getSelectedWinstreakBalance();

  return `
    <button class="build-row ${build.id === activeBuildId ? 'active' : ''}" type="button" data-build-slot="${build.id}">
      <div class="build-row-header">
        <div>
          <div class="build-row-name">${escapeHtml(build.name || `Build ${index + 1}`)}</div>
          <div class="build-row-meta">${escapeHtml(build.role)} • ${escapeHtml(ruleset?.name || 'Standard')} • ${escapeHtml(balance?.name || 'DBDLeague')}</div>
        </div>
        <div class="build-row-stats">
          <span>${build.perks.length} perks</span>
          <span>${build.items.length} items</span>
          <span>${ruleset?.allowDuplicates ? 'Duplicates on' : 'Duplicates off'}</span>
        </div>
      </div>
      <div class="build-row-slots">
        <div class="build-row-slots-group perks">${perkSlots}</div>
        <div class="build-row-divider"></div>
        <div class="build-row-slots-group items">${itemSlots}</div>
      </div>
    </button>
  `;
}

const LADDER_FIXED_CONFIG = {
  serverId: '1442597802096984309',
  leaderboardId: '1v1s',
};

const state = {
  activeTab: 'dashboard',
  overlays: {
    onevone: {
      enabled: store.get('overlay.onevone.enabled', false),
      open: false,
      locked: store.get('overlay.onevone.locked', false),
      opacity: store.get('overlay.onevone.opacity', 100),
      alwaysOnTop: store.get('overlay.onevone.alwaysOnTop', true),
      transparent: store.get('overlay.onevone.transparent', false),
      clickthrough: store.get('overlay.onevone.clickthrough', true),
      backgroundAlpha: store.get('overlay.onevone.backgroundAlpha', 0.16),
    },
    maps: {
      enabled: store.get('overlay.maps.enabled', false),
      open: false,
      locked: store.get('overlay.maps.locked', false),
      opacity: store.get('overlay.maps.opacity', 100),
      alwaysOnTop: store.get('overlay.maps.alwaysOnTop', true),
      transparent: store.get('overlay.maps.transparent', false),
      clickthrough: store.get('overlay.maps.clickthrough', true),
      backgroundAlpha: store.get('overlay.maps.backgroundAlpha', 0.16),
    },
    fourvone: {
      enabled: store.get('overlay.fourvone.enabled', false),
      open: false,
      locked: store.get('overlay.fourvone.locked', false),
      opacity: store.get('overlay.fourvone.opacity', 100),
      alwaysOnTop: store.get('overlay.fourvone.alwaysOnTop', true),
      transparent: store.get('overlay.fourvone.transparent', false),
      clickthrough: store.get('overlay.fourvone.clickthrough', true),
      backgroundAlpha: store.get('overlay.fourvone.backgroundAlpha', 0.16),
    },
    queue: {
      enabled: store.get('overlay.queue.enabled', false),
      open: false,
      locked: store.get('overlay.queue.locked', false),
      opacity: store.get('overlay.queue.opacity', 100),
      alwaysOnTop: store.get('overlay.queue.alwaysOnTop', true),
      transparent: store.get('overlay.queue.transparent', false),
      clickthrough: store.get('overlay.queue.clickthrough', true),
      backgroundAlpha: store.get('overlay.queue.backgroundAlpha', 0.16),
    },
    winstreak: {
      enabled: store.get('overlay.winstreak.enabled', false),
      open: false,
      locked: store.get('overlay.winstreak.locked', false),
      opacity: store.get('overlay.winstreak.opacity', 100),
      alwaysOnTop: store.get('overlay.winstreak.alwaysOnTop', true),
      transparent: store.get('overlay.winstreak.transparent', false),
      clickthrough: store.get('overlay.winstreak.clickthrough', true),
      backgroundAlpha: store.get('overlay.winstreak.backgroundAlpha', 0.16),
    },
    ladder: {
      enabled: store.get('overlay.ladder.enabled', false),
      open: false,
      locked: store.get('overlay.ladder.locked', false),
      opacity: store.get('overlay.ladder.opacity', 100),
      alwaysOnTop: store.get('overlay.ladder.alwaysOnTop', true),
      transparent: store.get('overlay.ladder.transparent', false),
      clickthrough: store.get('overlay.ladder.clickthrough', true),
      backgroundAlpha: store.get('overlay.ladder.backgroundAlpha', 0.16),
    },
    bamboozle: {
      enabled: store.get('overlay.bamboozle.enabled', false),
      open: false,
      locked: store.get('overlay.bamboozle.locked', false),
      opacity: store.get('overlay.bamboozle.opacity', 100),
      alwaysOnTop: store.get('overlay.bamboozle.alwaysOnTop', true),
      transparent: store.get('overlay.bamboozle.transparent', false),
      clickthrough: store.get('overlay.bamboozle.clickthrough', true),
      backgroundAlpha: store.get('overlay.bamboozle.backgroundAlpha', 0.16),
    },
  },
  robloxIntegration: {
    enabled: store.get('roblox.enabled', false),
    placeId: store.get('roblox.placeId', '93978595733734'),
    closeOnExit: store.get('roblox.closeOnExit', true),
    onevone: store.get('roblox.selection.onevone', false),
    maps: store.get('roblox.selection.maps', true),
    queue: store.get('roblox.selection.queue', false),
    fourvone: store.get('roblox.selection.fourvone', false),
    winstreak: store.get('roblox.selection.winstreak', true),
  },
  windowsAnimations: {
    enabled: null,
    loading: true,
    fixing: false,
    popupVisible: false,
  },
  onevone: {
    // Start timers at zero by default to avoid random initial values.
    player1ElapsedMs: 0,
    player2ElapsedMs: 0,
    player1Seconds: 0,
    player2Seconds: 0,
    player1Score: store.get('onevone.player1Score', 0),
    player2Score: store.get('onevone.player2Score', 0),
    activeTimer: store.get('onevone.activeTimer', 1), // which timer is currently running
    timerRunning: false,
    player1Finished: false,
    player2Finished: false,
    player1Name: store.get('onevone.player1Name', 'Player 1'),
    player2Name: store.get('onevone.player2Name', 'Player 2'),
    autoscore: store.get('onevone.autoscore', false),
    winCondition: store.get('onevone.winCondition', 0),
    winAlert: store.get('onevone.winAlert', false),
  },
  maps: {
    region: store.get('maps.region', 'NA'),
    list: loadProvidedMaps(store.get('maps.region', 'NA')),
    selectedIndex: store.get('maps.selectedIndex', 0),
    timerDuration: store.get('maps.timerDuration', 180),
    timerSeconds: store.get('maps.timerDuration', 180),
    timerRunning: false,
    regionTransition: false,
    ocr: {
      enabled: !!store.get('maps.ocr.enabled', false),
      zone: normalizeMapOcrZone(store.get('maps.ocr.zone', null)),
      zones: store.get('maps.ocr.zones', {}),
      captureTarget: store.get('maps.ocr.captureTarget', 'roblox'),
      windowSources: [],
      calibrating: false,
      pauseUntil: 0,
      lastText: '',
      lastMatch: '',
      lastConfidence: null,
      status: 'OCR detection is off.',
    },
  },
  gameInfo1v1MapStarts: {
    selectedIndex: store.get('gameInfo1v1MapStarts.selectedIndex', 0),
  },
  fourvone: {
    teams: [
      { name: store.get('4v1.team0', 'Team Alpha'), score: 0 },
      { name: store.get('4v1.team1', 'Team Beta'), score: 0 },
    ],
    killerScore: 0,
    latestWincon: store.get('4v1.latestWincon', ''),
    lastStages: store.get('4v1.lastStages', ''),
    lastFreshes: store.get('4v1.lastFreshes', ''),
    selectedKiller: store.get('4v1.killer', 'Veil'),
    setLabel: store.get('4v1.setLabel', ''),
    currentSet: store.get('4v1.currentSet', 1),
    totalSets: store.get('4v1.totalSets', 2),
    nextSetKiller: store.get('4v1.nextSetKiller', ''),
    bestOf: store.get('4v1.bestOf', 3),
    favoriteKillers: store.get('4v1.favoriteKillers', []),
    favoriteTeams: store.get('4v1.favoriteTeams', []),
    recentKillers: store.get('4v1.recentKillers', []),
    style: store.get('4v1.style', 'default'),
  },
  queue: {
    apiToken: store.get('queue.apiToken', ''),
    channelId: store.get('queue.channelId', ''),
    serverId: store.get('queue.serverId', ''),
    title: store.get('queue.title', 'Queue'),
    maxVisible: store.get('queue.maxVisible', 8),
  },
  winstreak: {
    mode: store.get('winstreak.mode', 'killer'),
    selectedKiller: store.get('winstreak.killer', 'Veil'),
    style: normalizeWinstreakStyle(store.get('winstreak.style', 'fire')),
    survivorStyle: normalizeSurvivorWinstreakStyle(store.get('winstreak.survivorStyle', 'minimal')),
    wincon: store.get('winstreak.wincon', '2k+'),
    gamesWon: store.get('winstreak.gamesWon', 0),
    pb: store.get('winstreak.pb', ''),
    worldRecord: store.get('winstreak.worldRecord', ''),
    byKiller: store.get('winstreak.byKiller', {}),
    survivor: normalizeSurvivorWinstreakStatsEntry({
      gamesWon: store.get('winstreak.survivor.gamesWon', 0),
      pb: store.get('winstreak.survivor.pb', ''),
      worldRecord: store.get('winstreak.survivor.worldRecord', ''),
      twoOut: store.get('winstreak.survivor.twoOut', 0),
      threeOut: store.get('winstreak.survivor.threeOut', 0),
      fourOut: store.get('winstreak.survivor.fourOut', 0),
    }),
  },
  winstreakBuilds: normalizeWinstreakBuildState(store.get('winstreak.builds', null)),
  hotkeys: {
    onevoneTimer: store.get('hotkeys.onevoneTimer', 'F1'),
    onevoneStart: store.get('hotkeys.onevoneStart', null),
    onevonePause: store.get('hotkeys.onevonePause', null),
    onevoneReset: store.get('hotkeys.onevoneReset', null),
    onevoneSwitchTimer: store.get('hotkeys.onevoneSwitchTimer', 'Shift+F1'),
    onevoneAlwaysOnTop: store.get('hotkeys.onevoneAlwaysOnTop', 'Shift+F5'),
    mapsNext: store.get('hotkeys.mapsNext', 'F2'),
    mapsPrevious: store.get('hotkeys.mapsPrevious', 'F3'),
    mapsAlwaysOnTop: store.get('hotkeys.mapsAlwaysOnTop', 'F4'),
    mapsToggleRegion: store.get('hotkeys.mapsToggleRegion', 'F2'),
    winstreakNextKiller: store.get('hotkeys.winstreakNextKiller', null),
    winstreakAlwaysOnTop: store.get('hotkeys.winstreakAlwaysOnTop', null),
    overlayClose: store.get('hotkeys.overlayClose', 'Shift+F6'),
    bamboozleStart: store.get('hotkeys.bamboozleStart', null),
    bamboozlePause: store.get('hotkeys.bamboozlePause', null),
    bamboozleReset: store.get('hotkeys.bamboozleReset', null),
  },
  bg: {
    visualSrc: store.get('bg.visual', ''),
    audioSrc: store.get('bg.audio', ''),
    audioEnabled: store.get('bg.audioEnabled', true),
    audioVolume: store.get('bg.volume', 80),
  },
  uiTheme: store.get('ui.theme', 'dark'),
  selectedFont: store.get('font', 'Cinzel'),
  ladder: {
    username: store.get('ladder.username', ''),
    apiUrl: 'https://api.slugbot.xyz/pvplb',
    style: store.get('ladder.style', 'compact'),
    refreshInterval: store.get('ladder.refreshInterval', 60),
    lastUpdated: store.get('ladder.lastUpdated', 0),
    data: store.get('ladder.data', { name: '', elo: 0, wins: 0, losses: 0, matches: 0, winrate: 0, rank: '', avatar: '' }),
    serverId: LADDER_FIXED_CONFIG.serverId,
    leaderboardId: LADDER_FIXED_CONFIG.leaderboardId,
    playerDiscord: store.get('ladder.playerDiscord', store.get('ladder.player1Discord', '')),
    player1Discord: store.get('ladder.player1Discord', ''),
    opponentDiscord: store.get('ladder.opponentDiscord', ''),
    fetchStatus: store.get('ladder.fetchStatus', ''),
  },
    bamboozle: {
    image: store.get('bamboozle.image', ''),
    duration: store.get('bamboozle.duration', 16),
    running: false,
    remaining: 0,
    phase: 'up',
    timerId: null,
  },
  startupUpdate: {
    initialized: false,
    flowActive: false,
  },
};

// LADDER_FIXED_CONFIG is declared above `state` to ensure initialization order.

const timers = {
  onevone: null,
  maps: null,
  mapsRegionTransition: null,
  queue: null,
  ladder: null,
};

const onevoneTimers = {
  1: new PreciseTimer(),
  2: new PreciseTimer(),
};

onevoneTimers[1].setElapsedMs(state.onevone.player1ElapsedMs);
onevoneTimers[2].setElapsedMs(state.onevone.player2ElapsedMs);

function syncOnevoneTimerState() {
  state.onevone.player1ElapsedMs = Math.max(0, Math.floor(onevoneTimers[1].elapsedMs));
  state.onevone.player2ElapsedMs = Math.max(0, Math.floor(onevoneTimers[2].elapsedMs));
  state.onevone.player1Seconds = Math.floor(state.onevone.player1ElapsedMs / 1000);
  state.onevone.player2Seconds = Math.floor(state.onevone.player2ElapsedMs / 1000);
  store.set('onevone.player1ElapsedMs', state.onevone.player1ElapsedMs);
  store.set('onevone.player2ElapsedMs', state.onevone.player2ElapsedMs);
  store.set('onevone.player1Seconds', state.onevone.player1Seconds);
  store.set('onevone.player2Seconds', state.onevone.player2Seconds);
}

function getOnevoneActiveTimer() {
  return state.onevone.activeTimer === 2 ? 2 : 1;
}

function normalizeWinstreakStatsEntry(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  return {
    gamesWon: Math.max(0, parseInt(source.gamesWon, 10) || 0),
    pb: String(source.pb || ''),
    worldRecord: String(source.worldRecord || ''),
  };
}

function normalizeWinstreakStyle(style) {
  const value = String(style || '').toLowerCase();
  if (value === 'pill' || value === 'fire') return 'fire';
  if (value === 'card' || value === 'dark') return 'dark';
  if (value === 'banner' || value === 'ember') return 'ember';
  return 'fire';
}

function normalizeSurvivorWinstreakStyle(style) {
  const value = String(style || '').toLowerCase();
  if (value === 'minimal' || value === 'current') return 'minimal';
  if (value === 'compact' || value === 'badge') return 'compact';
  if (value === 'glow' || value === 'glow dot') return 'glow';
  if (value === 'ring' || value === 'best' || value === 'purple ring') return 'ring';
  if (value === 'progress' || value === 'progress streak' || value === 'progress bar') return 'progress';
  return 'minimal';
}

function ensureWinstreakStatsBucket(killerName) {
  const key = String(killerName || state.winstreak.selectedKiller || 'Veil');
  if (!state.winstreak.byKiller || typeof state.winstreak.byKiller !== 'object') {
    state.winstreak.byKiller = {};
  }

  if (!state.winstreak.byKiller[key]) {
    state.winstreak.byKiller[key] = normalizeWinstreakStatsEntry({ gamesWon: 0, pb: '', worldRecord: '' });
  } else {
    state.winstreak.byKiller[key] = normalizeWinstreakStatsEntry(state.winstreak.byKiller[key]);
  }

  return state.winstreak.byKiller[key];
}

function persistCurrentWinstreakStats() {
  const bucket = ensureWinstreakStatsBucket(state.winstreak.selectedKiller);
  bucket.gamesWon = Math.max(0, parseInt(state.winstreak.gamesWon, 10) || 0);
  bucket.pb = String(state.winstreak.pb || '');
  bucket.worldRecord = String(state.winstreak.worldRecord || '');
  store.set('winstreak.mode', state.winstreak.mode);
  store.set('winstreak.byKiller', state.winstreak.byKiller);

  // Legacy flat keys still mirror currently selected killer for backward compatibility.
  store.set('winstreak.gamesWon', bucket.gamesWon);
  store.set('winstreak.pb', bucket.pb);
  store.set('winstreak.worldRecord', bucket.worldRecord);
}

function persistSurvivorWinstreakStats() {
  const bucket = normalizeSurvivorWinstreakStatsEntry(state.winstreak.survivor);
  state.winstreak.survivor = bucket;
  store.set('winstreak.mode', state.winstreak.mode);
  store.set('winstreak.survivor.gamesWon', bucket.gamesWon);
  store.set('winstreak.survivor.pb', bucket.pb);
  store.set('winstreak.survivor.worldRecord', bucket.worldRecord);
  store.set('winstreak.survivor.twoOut', bucket.twoOut);
  store.set('winstreak.survivor.threeOut', bucket.threeOut);
  store.set('winstreak.survivor.fourOut', bucket.fourOut);
}

function loadWinstreakStatsForKiller(killerName) {
  const bucket = ensureWinstreakStatsBucket(killerName);
  state.winstreak.gamesWon = bucket.gamesWon;
  state.winstreak.pb = bucket.pb;
  state.winstreak.worldRecord = bucket.worldRecord;
}

function initializeWinstreakStats() {
  const selected = state.winstreak.selectedKiller || 'Veil';

  if (!state.winstreak.byKiller || typeof state.winstreak.byKiller !== 'object') {
    state.winstreak.byKiller = {};
  }

  // Migrate existing flat values to selected killer if no per-killer stats exist yet.
  if (!state.winstreak.byKiller[selected]) {
    state.winstreak.byKiller[selected] = normalizeWinstreakStatsEntry({
      gamesWon: state.winstreak.gamesWon,
      pb: state.winstreak.pb,
      worldRecord: state.winstreak.worldRecord,
    });
  }

  loadWinstreakStatsForKiller(selected);
  state.winstreak.survivor = normalizeSurvivorWinstreakStatsEntry(state.winstreak.survivor);
  persistCurrentWinstreakStats();
  persistSurvivorWinstreakStats();

}

initializeWinstreakStats();

function commitWinstreakStatsFromInputs(mode, inputs) {
  const activeMode = mode || state.winstreak.mode || 'killer';

  if (activeMode === 'survivor') {
    if (inputs.gamesWonInput) {
      state.winstreak.survivor.gamesWon = Math.max(0, parseInt(inputs.gamesWonInput.value, 10) || 0);
      inputs.gamesWonInput.value = state.winstreak.survivor.gamesWon;
    }
    if (inputs.pbInput) {
      state.winstreak.survivor.pb = String(inputs.pbInput.value || '').substring(0, 16);
      inputs.pbInput.value = state.winstreak.survivor.pb;
    }
    if (inputs.wrInput) {
      state.winstreak.survivor.worldRecord = String(inputs.wrInput.value || '').substring(0, 16);
      inputs.wrInput.value = state.winstreak.survivor.worldRecord;
    }
    if (inputs.twoOutInput) {
      state.winstreak.survivor.twoOut = Math.max(0, parseInt(inputs.twoOutInput.value, 10) || 0);
      inputs.twoOutInput.value = state.winstreak.survivor.twoOut;
    }
    persistSurvivorWinstreakStats();
  } else {
    if (inputs.gamesWonInput) {
      state.winstreak.gamesWon = Math.max(0, parseInt(inputs.gamesWonInput.value, 10) || 0);
      inputs.gamesWonInput.value = state.winstreak.gamesWon;
    }
    if (inputs.pbInput) {
      state.winstreak.pb = String(inputs.pbInput.value || '').substring(0, 16);
      inputs.pbInput.value = state.winstreak.pb;
    }
    if (inputs.wrInput) {
      state.winstreak.worldRecord = String(inputs.wrInput.value || '').substring(0, 16);
      inputs.wrInput.value = state.winstreak.worldRecord;
    }
    persistCurrentWinstreakStats();
  }

  pushOverlayUpdate('winstreak');
  reRenderTab('dashboard');
  reRenderTab('winstreak');
}

function setWinstreakMode(mode) {
  const nextMode = mode === 'survivor' ? 'survivor' : 'killer';
  if (state.winstreak.mode === nextMode) return;

  if (state.winstreak.mode === 'survivor') {
    persistSurvivorWinstreakStats();
  } else {
    persistCurrentWinstreakStats();
  }

  state.winstreak.mode = nextMode;
  store.set('winstreak.mode', nextMode);
  pushOverlayUpdate('winstreak');
  reRenderTab('winstreak');
}

function commitFourvoneFieldFromInput(input) {
  if (!input) return;

  const id = input.id || '';
  let shouldRender = false;

  if (id === 'fourvone-latest-wincon') {
    const value = (input.value || '').substring(0, 16);
    input.value = value;
    state.fourvone.latestWincon = value;
    store.set('4v1.latestWincon', value);
    shouldRender = true;
  } else if (id === 'fourvone-last-stages') {
    const value = (input.value || '').substring(0, 8);
    input.value = value;
    state.fourvone.lastStages = value;
    store.set('4v1.lastStages', value);
    shouldRender = true;
  } else if (id === 'fourvone-last-freshes') {
    const value = (input.value || '').substring(0, 8);
    input.value = value;
    state.fourvone.lastFreshes = value;
    store.set('4v1.lastFreshes', value);
    shouldRender = true;
  } else if (id === 'fourvone-set-label') {
    const value = (input.value || '').substring(0, 40);
    input.value = value;
    state.fourvone.setLabel = value;
    store.set('4v1.setLabel', value);
    shouldRender = true;
  } else if (id === 'fourvone-current-set') {
    const value = Math.max(1, parseInt(input.value, 10) || 1);
    input.value = value;
    state.fourvone.currentSet = value;
    store.set('4v1.currentSet', value);
    shouldRender = true;
  } else if (id === 'fourvone-total-sets') {
    const value = Math.max(1, parseInt(input.value, 10) || 2);
    input.value = value;
    state.fourvone.totalSets = value;
    store.set('4v1.totalSets', value);
    shouldRender = true;
  } else if (id === 'fourvone-next-set-killer') {
    const value = (input.value || '').substring(0, 32);
    input.value = value;
    state.fourvone.nextSetKiller = value;
    store.set('4v1.nextSetKiller', value);
    shouldRender = true;
  } else if (input.classList?.contains('team-name-input')) {
    const index = parseInt(input.dataset.teamidx, 10);
    if (!Number.isNaN(index) && state.fourvone.teams[index]) {
      const value = input.value.substring(0, 20);
      input.value = value;
      state.fourvone.teams[index].name = value;
      store.set(`4v1.team${index}`, value);
      shouldRender = true;
    }
  }

  if (!shouldRender) return;
  pushOverlayUpdate('fourvone');
  reRenderTab('fourvone');
}

function bindCommitOnEnterInput(inputId, commitFn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commitFn(input);
  });
}

// Track recently used killer
function trackRecentKiller(killerName) {
  const recent = state.fourvone.recentKillers;
  const idx = recent.indexOf(killerName);
  if (idx > -1) recent.splice(idx, 1);
  recent.unshift(killerName);
  if (recent.length > 3) recent.pop();
  store.set('4v1.recentKillers', recent);
}

// Export settings to JSON file
function exportSettings() {
  const settings = {
    onevone: {
      player1Name: state.onevone.player1Name,
      player2Name: state.onevone.player2Name,
    },
    fourvone: {
      teams: state.fourvone.teams.map(t => t.name),
      latestWincon: state.fourvone.latestWincon,
      lastStages: state.fourvone.lastStages,
      lastFreshes: state.fourvone.lastFreshes,
      selectedKiller: state.fourvone.selectedKiller,
      setLabel: state.fourvone.setLabel,
      currentSet: state.fourvone.currentSet,
      totalSets: state.fourvone.totalSets,
      nextSetKiller: state.fourvone.nextSetKiller,
      bestOf: state.fourvone.bestOf,
      favoriteKillers: state.fourvone.favoriteKillers,
      favoriteTeams: state.fourvone.favoriteTeams,
      style: state.fourvone.style,
    },
    overlays: {
      onevone: { opacity: state.overlays.onevone.opacity },
      maps: { opacity: state.overlays.maps.opacity },
      fourvone: { opacity: state.overlays.fourvone.opacity },
      queue: { opacity: state.overlays.queue.opacity },
      winstreak: { opacity: state.overlays.winstreak.opacity },
    },
    queue: {
      apiToken: state.queue.apiToken,
      channelId: state.queue.channelId,
      serverId: state.queue.serverId,
      title: state.queue.title,
      maxVisible: state.queue.maxVisible,
    },
    winstreak: {
      mode: state.winstreak.mode,
      selectedKiller: state.winstreak.selectedKiller,
      wincon: state.winstreak.wincon,
      gamesWon: state.winstreak.gamesWon,
      pb: state.winstreak.pb || '',
      worldRecord: state.winstreak.worldRecord || '',
      byKiller: state.winstreak.byKiller,
      survivor: state.winstreak.survivor,
    },
    hotkeys: {
      onevoneTimer: state.hotkeys.onevoneTimer,
      onevoneStart: state.hotkeys.onevoneStart,
      onevonePause: state.hotkeys.onevonePause,
      onevoneSwitchTimer: state.hotkeys.onevoneSwitchTimer,
      onevoneAlwaysOnTop: state.hotkeys.onevoneAlwaysOnTop,
      mapsNext: state.hotkeys.mapsNext,
      mapsPrevious: state.hotkeys.mapsPrevious,
      mapsAlwaysOnTop: state.hotkeys.mapsAlwaysOnTop,
      winstreakNextKiller: state.hotkeys.winstreakNextKiller,
      winstreakAlwaysOnTop: state.hotkeys.winstreakAlwaysOnTop,
    },
    selectedFont: state.selectedFont,
  };
  
  const dataStr = JSON.stringify(settings, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `vd-overlay-settings-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// Import settings from JSON file
function importSettings() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const settings = JSON.parse(event.target.result);
        
        if (settings.onevone) {
          state.onevone.player1Name = settings.onevone.player1Name || state.onevone.player1Name;
          state.onevone.player2Name = settings.onevone.player2Name || state.onevone.player2Name;
          store.set('onevone.player1Name', state.onevone.player1Name);
          store.set('onevone.player2Name', state.onevone.player2Name);
        }
        
        if (settings.fourvone) {
          if (settings.fourvone.teams) {
            settings.fourvone.teams.forEach((name, idx) => {
              if (idx < state.fourvone.teams.length) {
                state.fourvone.teams[idx].name = name;
                store.set(`4v1.team${idx}`, name);
              }
            });
          }
          if (settings.fourvone.latestWincon !== undefined) {
            state.fourvone.latestWincon = settings.fourvone.latestWincon;
            store.set('4v1.latestWincon', state.fourvone.latestWincon);
          }
          if (settings.fourvone.lastStages !== undefined) {
            state.fourvone.lastStages = settings.fourvone.lastStages;
            store.set('4v1.lastStages', state.fourvone.lastStages);
          }
          if (settings.fourvone.lastFreshes !== undefined) {
            state.fourvone.lastFreshes = settings.fourvone.lastFreshes;
            store.set('4v1.lastFreshes', state.fourvone.lastFreshes);
          }
          if (settings.fourvone.selectedKiller) {
            state.fourvone.selectedKiller = settings.fourvone.selectedKiller;
            store.set('4v1.killer', state.fourvone.selectedKiller);
          }
          if (settings.fourvone.setLabel !== undefined) {
            state.fourvone.setLabel = settings.fourvone.setLabel;
            store.set('4v1.setLabel', state.fourvone.setLabel);
          }
          if (settings.fourvone.currentSet !== undefined) {
            state.fourvone.currentSet = parseInt(settings.fourvone.currentSet, 10) || 1;
            store.set('4v1.currentSet', state.fourvone.currentSet);
          }
          if (settings.fourvone.totalSets !== undefined) {
            state.fourvone.totalSets = parseInt(settings.fourvone.totalSets, 10) || 2;
            store.set('4v1.totalSets', state.fourvone.totalSets);
          }
          if (settings.fourvone.nextSetKiller !== undefined) {
            state.fourvone.nextSetKiller = settings.fourvone.nextSetKiller;
            store.set('4v1.nextSetKiller', state.fourvone.nextSetKiller);
          }
          if (settings.fourvone.bestOf) {
            state.fourvone.bestOf = settings.fourvone.bestOf;
            store.set('4v1.bestOf', settings.fourvone.bestOf);
          }
          if (settings.fourvone.favoriteKillers) {
            state.fourvone.favoriteKillers = settings.fourvone.favoriteKillers;
            store.set('4v1.favoriteKillers', settings.fourvone.favoriteKillers);
          }
          if (settings.fourvone.favoriteTeams) {
            state.fourvone.favoriteTeams = settings.fourvone.favoriteTeams;
            store.set('4v1.favoriteTeams', settings.fourvone.favoriteTeams);
          }
          if (settings.fourvone.style) {
            state.fourvone.style = settings.fourvone.style;
            store.set('4v1.style', state.fourvone.style);
          }
        }
        
        if (settings.overlays) {
          if (settings.overlays.onevone?.opacity) state.overlays.onevone.opacity = settings.overlays.onevone.opacity;
          if (settings.overlays.maps?.opacity) state.overlays.maps.opacity = settings.overlays.maps.opacity;
          if (settings.overlays.fourvone?.opacity) state.overlays.fourvone.opacity = settings.overlays.fourvone.opacity;
          if (settings.overlays.queue?.opacity) state.overlays.queue.opacity = settings.overlays.queue.opacity;
          if (settings.overlays.winstreak?.opacity) state.overlays.winstreak.opacity = settings.overlays.winstreak.opacity;
          store.set('overlay.onevone.opacity', state.overlays.onevone.opacity);
          store.set('overlay.maps.opacity', state.overlays.maps.opacity);
          store.set('overlay.fourvone.opacity', state.overlays.fourvone.opacity);
          store.set('overlay.queue.opacity', state.overlays.queue.opacity);
          store.set('overlay.winstreak.opacity', state.overlays.winstreak.opacity);
        }

        if (settings.queue) {
          if (settings.queue.apiToken !== undefined) {
            state.queue.apiToken = String(settings.queue.apiToken || '');
            store.set('queue.apiToken', state.queue.apiToken);
          }
          if (settings.queue.channelId !== undefined) {
            state.queue.channelId = String(settings.queue.channelId || '');
            store.set('queue.channelId', state.queue.channelId);
          }
          if (settings.queue.serverId !== undefined) {
            state.queue.serverId = String(settings.queue.serverId || '');
            store.set('queue.serverId', state.queue.serverId);
          }
          if (settings.queue.title !== undefined) {
            state.queue.title = String(settings.queue.title || 'Queue');
            store.set('queue.title', state.queue.title);
          }
          if (settings.queue.maxVisible !== undefined) {
            state.queue.maxVisible = Math.max(1, parseInt(settings.queue.maxVisible, 10) || 8);
            store.set('queue.maxVisible', state.queue.maxVisible);
          }
        }

        if (settings.winstreak) {
          const hasByKillerImport = Boolean(settings.winstreak.byKiller && typeof settings.winstreak.byKiller === 'object');

          if (settings.winstreak.mode === 'survivor') {
            state.winstreak.mode = 'survivor';
          } else if (settings.winstreak.mode === 'killer') {
            state.winstreak.mode = 'killer';
          }
          store.set('winstreak.mode', state.winstreak.mode);

          if (settings.winstreak.style) {
            state.winstreak.style = normalizeWinstreakStyle(settings.winstreak.style);
            store.set('winstreak.style', state.winstreak.style);
          }
          if (settings.winstreak.survivorStyle) {
            state.winstreak.survivorStyle = normalizeSurvivorWinstreakStyle(settings.winstreak.survivorStyle);
            store.set('winstreak.survivorStyle', state.winstreak.survivorStyle);
          }

          if (settings.winstreak.selectedKiller) {
            state.winstreak.selectedKiller = settings.winstreak.selectedKiller;
            store.set('winstreak.killer', state.winstreak.selectedKiller);
          }
          if (settings.winstreak.wincon) {
            state.winstreak.wincon = settings.winstreak.wincon;
            store.set('winstreak.wincon', state.winstreak.wincon);
          }
          if (hasByKillerImport) {
            state.winstreak.byKiller = {};
            Object.entries(settings.winstreak.byKiller).forEach(([killer, stats]) => {
              state.winstreak.byKiller[killer] = normalizeWinstreakStatsEntry(stats);
            });
            store.set('winstreak.byKiller', state.winstreak.byKiller);
          }
          if (settings.winstreak.gamesWon !== undefined) {
            state.winstreak.gamesWon = parseInt(settings.winstreak.gamesWon, 10) || 0;
          }
          if (settings.winstreak.pb !== undefined) {
            state.winstreak.pb = String(settings.winstreak.pb || '');
          }
          if (settings.winstreak.worldRecord !== undefined) {
            state.winstreak.worldRecord = String(settings.winstreak.worldRecord || '');
          }
          if (settings.winstreak.survivor && typeof settings.winstreak.survivor === 'object') {
            state.winstreak.survivor = normalizeSurvivorWinstreakStatsEntry(settings.winstreak.survivor);
            persistSurvivorWinstreakStats();
          }

          if (hasByKillerImport) {
            loadWinstreakStatsForKiller(state.winstreak.selectedKiller);
          } else {
            // Import from legacy flat shape into currently selected killer.
            persistCurrentWinstreakStats();
          }
        }

        if (settings.hotkeys) {
          Object.entries(settings.hotkeys).forEach(([key, value]) => {
            state.hotkeys[key] = value || null;
            store.set(`hotkeys.${key}`, state.hotkeys[key]);
          });
          ipcRenderer.send('hotkeys-updated');
        }
        
        if (settings.selectedFont) {
          state.selectedFont = settings.selectedFont;
          store.set('font', settings.selectedFont);
        }
        
        renderAllTabs();
        showNotification('Settings imported successfully!');
      } catch (err) {
        showNotification('Failed to import settings. Invalid file format.', true);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// Show temporary notification
function showNotification(message, isError = false) {
  const notif = document.createElement('div');
  notif.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; padding: 12px 20px;
    background: ${isError ? '#c33' : '#66c'}; color: white; border-radius: 6px;
    font-size: 13px; z-index: 9999;
  `;
  notif.textContent = message;
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 3000);
}

// Helper function for confirmation dialogs
function showConfirmDialog(message, title = 'Confirm Action') {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: Arial, sans-serif;
    `;
    
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: #222; border: 2px solid #444; border-radius: 8px;
      padding: 20px; min-width: 400px; color: #fff; box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    `;
    
    const titleEl = document.createElement('h2');
    titleEl.textContent = title;
    titleEl.style.cssText = 'margin: 0 0 15px 0; color: #fff; font-size: 18px;';
    
    const messageEl = document.createElement('p');
    messageEl.textContent = message;
    messageEl.style.cssText = 'margin: 0 0 20px 0; color: #ccc; font-size: 14px;';
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      padding: 8px 16px; background: #444; color: #fff; border: 1px solid #555;
      border-radius: 4px; cursor: pointer; font-size: 13px;
    `;
    cancelBtn.onclick = () => {
      modal.remove();
      resolve(false);
    };
    
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Confirm';
    confirmBtn.style.cssText = `
      padding: 8px 16px; background: #c33; color: #fff; border: 1px solid #a22;
      border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold;
    `;
    confirmBtn.onclick = () => {
      modal.remove();
      resolve(true);
    };
    
    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(confirmBtn);
    
    dialog.appendChild(titleEl);
    dialog.appendChild(messageEl);
    dialog.appendChild(buttonContainer);
    modal.appendChild(dialog);
    document.body.appendChild(modal);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remaining = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remaining}`;
}

function getSelectedMap() {
  return state.maps.list[state.maps.selectedIndex] || state.maps.list[0] || null;
}

function setMapsRegion(region, shouldAnimate = true) {
  const nextRegion = String(region || 'NA').toUpperCase() === 'EU' ? 'EU' : 'NA';
  if (state.maps.region === nextRegion && state.maps.list.length) return;

  state.maps.region = nextRegion;
  state.maps.selectedIndex = 0;
  state.maps.list = loadProvidedMaps(nextRegion);
  syncMapOcrZoneFromSelectedMap();
  store.set('maps.region', nextRegion);
  store.set('maps.selectedIndex', 0);
  state.maps.regionTransition = Boolean(shouldAnimate);

  if (timers.mapsRegionTransition) clearTimeout(timers.mapsRegionTransition);
  timers.mapsRegionTransition = setTimeout(() => {
    state.maps.regionTransition = false;
  }, 320);

  pushOverlayUpdate('maps');
  reRenderTab('maps');
}

function setSelectedMapIndex(index) {
  if (!state.maps.list.length) return;

  const nextIndex = ((index % state.maps.list.length) + state.maps.list.length) % state.maps.list.length;
  state.maps.selectedIndex = nextIndex;
  syncMapOcrZoneFromSelectedMap();
  store.set('maps.selectedIndex', state.maps.selectedIndex);
  pushOverlayUpdate('maps');
  reRenderTab('maps');
}

function nextMap() {
  setSelectedMapIndex(state.maps.selectedIndex + 1);
}

function previousMap() {
  setSelectedMapIndex(state.maps.selectedIndex - 1);
}

let mapsOcrAutoScanTimer = null;
let mapsOcrWatchdogTimer = null;
let mapsOcrBusy = false;
let mapsOcrCalibrationSession = null;

function normalizeMapOcrZone(zone, fallbackZone = null) {
  const source = zone && typeof zone === 'object'
    ? zone
    : (fallbackZone && typeof fallbackZone === 'object' ? fallbackZone : null);
  if (!source) return null;
  const x = Number.isFinite(Number(source.x)) ? Number(source.x) : MAP_OCR_DEFAULT_ZONE.x;
  const y = Number.isFinite(Number(source.y)) ? Number(source.y) : MAP_OCR_DEFAULT_ZONE.y;
  const width = Number.isFinite(Number(source.width)) ? Number(source.width) : MAP_OCR_DEFAULT_ZONE.width;
  const height = Number.isFinite(Number(source.height)) ? Number(source.height) : MAP_OCR_DEFAULT_ZONE.height;

  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
    width: Math.max(8, Math.min(100, width)),
    height: Math.max(8, Math.min(100, height)),
  };
}

function getCurrentMapOcrKey(map = getSelectedMap()) {
  if (!map) return `${String(state.maps.region || 'NA').toUpperCase()}:default`;
  const region = String(state.maps.region || 'NA').toUpperCase();
  const identifier = String(map.filename || map.name || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${region}:${identifier || 'default'}`;
}

function getSavedMapOcrZone(map = getSelectedMap()) {
  const key = getCurrentMapOcrKey(map);
  const saved = state.maps.ocr.zones?.[key];
  return normalizeMapOcrZone(saved);
}

function setCurrentMapOcrZone(zone, map = getSelectedMap()) {
  const key = getCurrentMapOcrKey(map);
  const nextZone = normalizeMapOcrZone(zone, MAP_OCR_DEFAULT_ZONE);
  if (!nextZone) return;
  state.maps.ocr.zones[key] = nextZone;
  state.maps.ocr.zone = nextZone;
  updateMapsOcrStore();
}

function syncMapOcrZoneFromSelectedMap() {
  state.maps.ocr.zone = getSavedMapOcrZone();
}

function normalizeOcrText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function ocrSimilarity(a, b) {
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length < b.length ? a : b;
  if (longer.length === 0) return 1;
  const edits = [];
  for (let i = 0; i <= shorter.length; i++) edits[i] = [i];
  for (let j = 0; j <= longer.length; j++) edits[0][j] = j;
  for (let i = 1; i <= shorter.length; i++) {
    for (let j = 1; j <= longer.length; j++) {
      const cost = shorter[i - 1] === longer[j - 1] ? 0 : 1;
      edits[i][j] = Math.min(edits[i - 1][j] + 1, edits[i][j - 1] + 1, edits[i - 1][j - 1] + cost);
    }
  }
  const dist = edits[shorter.length][longer.length];
  return (longer.length - dist) / longer.length;
}

function findBestMapMatchFromText(text) {
  if (!text || !state.maps.list.length) return null;
  const cleaned = text.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!cleaned) return null;
  const words = cleaned.split(' ').filter(Boolean);
  let bestScore = 0;
  let bestMatch = null;
  for (const map of state.maps.list) {
    const mapName = map.name.toLowerCase();
    const tokens = map.tokens || [mapName];
    // direct substring
    if (mapName.includes(cleaned) || cleaned.includes(mapName)) {
      const score = Math.max(mapName.length, cleaned.length);
      if (score > bestScore) { bestScore = score; bestMatch = map; }
    }
    // token match (exact)
    for (const token of tokens) {
      if (cleaned.includes(token) || token.includes(cleaned)) {
        const score = Math.max(token.length, cleaned.length);
        if (score > bestScore) { bestScore = score; bestMatch = map; }
      }
    }
    // word overlap
    const mapWords = mapName.split(' ').filter(Boolean);
    const common = words.filter(w => mapWords.includes(w)).length;
    const wordScore = common / Math.max(words.length, mapWords.length);
    if (wordScore > bestScore) { bestScore = wordScore; bestMatch = map; }
    // fuzzy similarity on full text
    const sim = ocrSimilarity(cleaned, mapName);
    if (sim > bestScore) { bestScore = sim; bestMatch = map; }
  }
  const threshold = bestScore >= 0.5 ? 0.5 : 0;
  if (bestScore >= threshold && bestMatch) return bestMatch;
  // fallback: try matching without "hitta" / "clock" / "wip" noise
  const stripWords = ['hitta', 'clock', 'wip', 'club'];
  const stripped = words.filter(w => !stripWords.includes(w)).join(' ');
  if (stripped) {
    for (const map of state.maps.list) {
      const mapStripped = map.name.toLowerCase().split(' ').filter(w => !stripWords.includes(w)).join(' ');
      if (mapStripped.includes(stripped) || stripped.includes(mapStripped)) return map;
    }
  }
  return null;
}

function updateMapsOcrStore() {
  store.set('maps.ocr.enabled', !!state.maps.ocr.enabled);
  if (state.maps.ocr.zone) {
    store.set('maps.ocr.zone', state.maps.ocr.zone);
  } else {
    store.delete('maps.ocr.zone');
  }
  store.set('maps.ocr.zones', state.maps.ocr.zones);
  store.set('maps.ocr.captureTarget', state.maps.ocr.captureTarget);
}

function setMapsOcrEnabled(enabled) {
  state.maps.ocr.enabled = !!enabled;
  state.maps.ocr.status = state.maps.ocr.enabled ? 'OCR detection enabled.' : 'OCR detection is off.';
  updateMapsOcrStore();
  if (state.maps.ocr.enabled) {
    startMapsOcrAutoScan();
  } else {
    stopMapsOcrAutoScan();
  }
  reRenderTab('maps');
}

function startMapsOcrAutoScan() {
  if (mapsOcrAutoScanTimer) return;
  mapsOcrAutoScanTimer = setInterval(() => {
    runMapsOcrScan(true).catch(err => console.warn('Maps OCR auto-scan failed:', err));
  }, 6000);
  runMapsOcrScan(true).catch(err => console.warn('Maps OCR initial scan failed:', err));
}

function stopMapsOcrAutoScan() {
  if (mapsOcrAutoScanTimer) clearInterval(mapsOcrAutoScanTimer);
  mapsOcrAutoScanTimer = null;
  stopMapsOcrWatchdog();
}

function startMapsOcrWatchdog() {
  if (mapsOcrWatchdogTimer) return;
  stopMapsOcrAutoScan();
  mapsOcrWatchdogTimer = setInterval(() => {
    runMapsOcrWatchdog().catch(err => console.warn('Maps OCR watchdog failed:', err));
  }, 25000);
}

function stopMapsOcrWatchdog() {
  if (mapsOcrWatchdogTimer) clearInterval(mapsOcrWatchdogTimer);
  mapsOcrWatchdogTimer = null;
}

async function runMapsOcrWatchdog() {
  if (mapsOcrBusy || state.maps.ocr.calibrating) return;
  const frame = await captureMapsOcrImage().catch(() => null);
  if (!frame) return;
  const cropped = await cropImageToZone(frame.dataUrl, state.maps.ocr.zone).catch(() => null);
  if (!cropped) return;
  const scan = await ipcRenderer.invoke('maps-ocr-recognize', cropped).catch(() => null);
  if (!scan) return;
  const text = normalizeOcrText(scan?.text || '');
  if (!text) return;
  const confidence = Number(scan?.confidence);
  if (!Number.isFinite(confidence) || confidence < 25) return;
  const bestMatch = findBestMapMatchFromText(text);
  if (!bestMatch) return;
  const lastMatched = state.maps.ocr.lastMatch || '';
  // Only act if the map actually changed
  if (bestMatch.name === lastMatched) return;
  const nextIndex = state.maps.list.findIndex(map => map.name === bestMatch.name);
  if (nextIndex < 0) return;
  state.maps.selectedIndex = nextIndex;
  store.set('maps.selectedIndex', nextIndex);
  pushOverlayUpdate('maps');
  reRenderTab('maps');
  state.maps.ocr.lastMatch = bestMatch.name;
  state.maps.ocr.lastText = text;
}

async function captureMapsOcrImage() {
  const target = String(state.maps.ocr.captureTarget || 'roblox').trim();
  const safeTarget = !target || target === 'screen' ? 'roblox' : target;
  return ipcRenderer.invoke('maps-ocr-capture-window', safeTarget);
}

async function loadMapsOcrWindowSources() {
  try {
    const sources = await ipcRenderer.invoke('maps-ocr-list-window-sources');
    const robloxSources = Array.isArray(sources)
      ? sources.filter(source => /roblox/i.test(String(source.name || '')))
      : [];
    state.maps.ocr.windowSources = robloxSources;
    state.maps.ocr.captureTarget = 'roblox';
    return state.maps.ocr.windowSources;
  } catch (err) {
    console.warn('Failed to load OCR window sources', err);
    state.maps.ocr.windowSources = [];
    return [];
  }
}

async function cropImageToZone(dataUrl, zone) {
  if (!dataUrl) return null;
  const normalizedZone = normalizeMapOcrZone(zone);
  if (!normalizedZone) return null;

  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = dataUrl;
  });

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return null;

  const cropX = Math.max(0, Math.min(sourceWidth, Math.round((normalizedZone.x / 100) * sourceWidth)));
  const cropY = Math.max(0, Math.min(sourceHeight, Math.round((normalizedZone.y / 100) * sourceHeight)));
  const cropWidth = Math.max(1, Math.min(sourceWidth - cropX, Math.round((normalizedZone.width / 100) * sourceWidth)));
  const cropHeight = Math.max(1, Math.min(sourceHeight - cropY, Math.round((normalizedZone.height / 100) * sourceHeight)));

  const canvas = document.createElement('canvas');
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  // Preprocess for better OCR: grayscale + contrast boost
  const imageData = context.getImageData(0, 0, cropWidth, cropHeight);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const boosted = gray < 128 ? Math.max(0, gray - 30) : Math.min(255, gray + 30);
    const clamped = boosted < 60 ? 0 : (boosted > 180 ? 255 : boosted);
    data[i] = data[i + 1] = data[i + 2] = clamped;
  }
  context.putImageData(imageData, 0, 0);

  return canvas.toDataURL('image/png');
}

async function openMapsOcrCalibrationModal() {
  try {
    state.maps.ocr.calibrating = true;
    stopMapsOcrAutoScan();
    state.maps.ocr.captureTarget = 'roblox';
    updateMapsOcrStore();
    await loadMapsOcrWindowSources();
    const frame = await captureMapsOcrImage();
    let modal = document.getElementById('maps-ocr-calibration-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'maps-ocr-calibration-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:9999999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.8);backdrop-filter:blur(10px);';
      modal.innerHTML = `
        <div style="width:min(92vw,960px);max-height:90vh;display:flex;flex-direction:column;gap:12px;border-radius:20px;border:1px solid rgba(255,255,255,.12);background:#0b1220;box-shadow:0 24px 80px rgba(0,0,0,.45);padding:16px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div>
              <div style="font-size:18px;font-weight:700;">Map OCR Calibration</div>
              <div id="maps-ocr-calibration-hint" style="font-size:12px;color:#9aaab3;">Drag on the screenshot to snip the OCR area.</div>
            </div>
            <button type="button" id="maps-ocr-calibration-close" class="btn">Close</button>
          </div>
          <div style="position:relative;flex:1;min-height:0;overflow:auto;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:#050816;">
            <img id="maps-ocr-calibration-image" alt="OCR calibration screenshot" style="display:block;max-width:100%;height:auto;user-select:none;-webkit-user-drag:none;" />
            <div id="maps-ocr-calibration-selection" style="position:absolute;border:2px solid #76c5b6;background:rgba(118,197,182,.16);display:none;pointer-events:none;"></div>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
            <button type="button" id="maps-ocr-calibration-cancel" class="btn">Cancel</button>
            <button type="button" id="maps-ocr-calibration-save" class="btn primary">Save area</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }

    const image = document.getElementById('maps-ocr-calibration-image');
    const selection = document.getElementById('maps-ocr-calibration-selection');
    const saveBtn = document.getElementById('maps-ocr-calibration-save');
    const closeBtn = document.getElementById('maps-ocr-calibration-close');
    const cancelBtn = document.getElementById('maps-ocr-calibration-cancel');
    const hint = document.getElementById('maps-ocr-calibration-hint');
    if (!modal || !image || !selection || !saveBtn || !hint) return;

    const zone = getSavedMapOcrZone() || MAP_OCR_DEFAULT_ZONE;
    modal.style.display = 'flex';
    saveBtn.disabled = false;
    hint.textContent = 'Drag on the screenshot to snip the OCR area.';

    mapsOcrCalibrationSession = {
      imageWidth: frame.width,
      imageHeight: frame.height,
      selection: {
        x: Math.round((zone.x / 100) * frame.width),
        y: Math.round((zone.y / 100) * frame.height),
        width: Math.round((zone.width / 100) * frame.width),
        height: Math.round((zone.height / 100) * frame.height),
      },
      dragging: false,
      startX: 0,
      startY: 0,
    };

    const renderOverlay = () => {
      const session = mapsOcrCalibrationSession;
      if (!session) return;
      const imageRect = image.getBoundingClientRect();
      const stage = image.parentElement;
      const stageRect = stage ? stage.getBoundingClientRect() : imageRect;
      const scaleX = imageRect.width / session.imageWidth;
      const scaleY = imageRect.height / session.imageHeight;
      const next = session.selection;
      const offsetX = imageRect.left - stageRect.left;
      const offsetY = imageRect.top - stageRect.top;

      selection.style.display = 'block';
      selection.style.left = `${offsetX + (next.x * scaleX)}px`;
      selection.style.top = `${offsetY + (next.y * scaleY)}px`;
      selection.style.width = `${next.width * scaleX}px`;
      selection.style.height = `${next.height * scaleY}px`;
      hint.textContent = session.dragging ? 'Drag to define the OCR area.' : 'Drag on the screenshot to snip the OCR area.';
    };

    const updateFromPointer = event => {
      if (!mapsOcrCalibrationSession) return;
      const bounds = image.getBoundingClientRect();
      const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
      const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
      const relX = bounds.width ? x / bounds.width : 0;
      const relY = bounds.height ? y / bounds.height : 0;
      const nextSelection = {
        x: Math.round(Math.min(mapsOcrCalibrationSession.startX, relX * mapsOcrCalibrationSession.imageWidth)),
        y: Math.round(Math.min(mapsOcrCalibrationSession.startY, relY * mapsOcrCalibrationSession.imageHeight)),
        width: Math.round(Math.abs(relX * mapsOcrCalibrationSession.imageWidth - mapsOcrCalibrationSession.startX)),
        height: Math.round(Math.abs(relY * mapsOcrCalibrationSession.imageHeight - mapsOcrCalibrationSession.startY)),
      };
      if (nextSelection.width < 8) nextSelection.width = 8;
      if (nextSelection.height < 8) nextSelection.height = 8;
      mapsOcrCalibrationSession.selection = nextSelection;
      renderOverlay();
    };

    image.onmousedown = event => {
      if (!mapsOcrCalibrationSession) return;
      const bounds = image.getBoundingClientRect();
      const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
      const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
      mapsOcrCalibrationSession.dragging = true;
      mapsOcrCalibrationSession.startX = bounds.width ? (x / bounds.width) * mapsOcrCalibrationSession.imageWidth : 0;
      mapsOcrCalibrationSession.startY = bounds.height ? (y / bounds.height) * mapsOcrCalibrationSession.imageHeight : 0;
      mapsOcrCalibrationSession.selection = {
        x: Math.round(mapsOcrCalibrationSession.startX),
        y: Math.round(mapsOcrCalibrationSession.startY),
        width: 8,
        height: 8,
      };
      renderOverlay();
    };
    image.onmousemove = event => {
      if (!mapsOcrCalibrationSession?.dragging) return;
      updateFromPointer(event);
    };
    image.onmouseup = event => {
      if (!mapsOcrCalibrationSession) return;
      mapsOcrCalibrationSession.dragging = false;
      updateFromPointer(event);
      renderOverlay();
    };
    image.onmouseleave = event => {
      if (!mapsOcrCalibrationSession?.dragging) return;
      mapsOcrCalibrationSession.dragging = false;
      renderOverlay();
    };
    image.ondragstart = () => false;
    image.onload = () => renderOverlay();
    image.src = frame.dataUrl;

    selection.onclick = event => event.stopPropagation();
    selection.style.display = 'block';
    renderOverlay();

    const finish = () => {
      closeMapsOcrCalibrationModal();
      if (state.maps.ocr.enabled) startMapsOcrAutoScan();
      reRenderTab('maps');
    };

    saveBtn.onclick = () => {
      if (!mapsOcrCalibrationSession) return;
      const nextZone = {
        x: Math.round((mapsOcrCalibrationSession.selection.x / mapsOcrCalibrationSession.imageWidth) * 100),
        y: Math.round((mapsOcrCalibrationSession.selection.y / mapsOcrCalibrationSession.imageHeight) * 100),
        width: Math.round((mapsOcrCalibrationSession.selection.width / mapsOcrCalibrationSession.imageWidth) * 100),
        height: Math.round((mapsOcrCalibrationSession.selection.height / mapsOcrCalibrationSession.imageHeight) * 100),
      };
      setCurrentMapOcrZone(nextZone);
      finish();
    };
    closeBtn && (closeBtn.onclick = finish);
    cancelBtn && (cancelBtn.onclick = finish);
  } catch (err) {
    console.error('Failed to open OCR calibration modal:', err);
    const status = document.getElementById('maps-ocr-status');
    if (status) status.textContent = 'Unable to open calibration screen.';
  }
}

function closeMapsOcrCalibrationModal() {
  const modal = document.getElementById('maps-ocr-calibration-modal');
  if (modal) modal.style.display = 'none';
  mapsOcrCalibrationSession = null;
  state.maps.ocr.calibrating = false;
}

async function runMapsOcrScan(silent = false) {
  if (mapsOcrBusy) return null;
  if (state.maps.ocr.calibrating) return null;

  const statusEl = document.getElementById('maps-ocr-status');
  const resultEl = document.getElementById('maps-ocr-result');
  const confidenceEl = document.getElementById('maps-ocr-confidence');

  const now = Date.now();
  if (state.maps.ocr.pauseUntil && Number.isFinite(state.maps.ocr.pauseUntil) && state.maps.ocr.pauseUntil > now) {
    if (statusEl) statusEl.textContent = 'OCR paused to reduce load';
    return null;
  }

  mapsOcrBusy = true;
  try {
    if (!state.maps.ocr.zone) {
      const prompt = 'Calibrate the OCR area on a Roblox window before scanning.';
      state.maps.ocr.status = prompt;
      if (statusEl) statusEl.textContent = prompt;
      return null;
    }

    if (!state.maps.ocr.enabled && !silent) {
      if (statusEl) statusEl.textContent = 'OCR detection is off, but manual scan is allowed.';
    }

    if (statusEl) statusEl.textContent = silent ? 'Scanning map area...' : 'Capturing display for OCR...';
    const frame = await captureMapsOcrImage();
    const cropped = await cropImageToZone(frame.dataUrl, state.maps.ocr.zone);
    if (!cropped) throw new Error('OCR area is not calibrated yet');
    if (statusEl) statusEl.textContent = 'Running OCR on the selected area...';

    const scan = await ipcRenderer.invoke('maps-ocr-recognize', cropped);
    const text = normalizeOcrText(scan?.text || '');
    const confidence = Number(scan?.confidence);
    state.maps.ocr.lastText = text;
    state.maps.ocr.lastConfidence = Number.isFinite(confidence) ? Math.round(confidence) : null;
    state.maps.ocr.status = text ? 'OCR scan complete.' : 'OCR scan complete, but nothing readable was found.';

    if (resultEl) resultEl.textContent = text || 'No text detected';
    if (confidenceEl) confidenceEl.textContent = state.maps.ocr.lastConfidence != null ? `${state.maps.ocr.lastConfidence}% confidence` : 'No confidence yet';
    if (statusEl) statusEl.textContent = state.maps.ocr.status;

    // Skip low-confidence scans to avoid false matches
    if (text && confidence < 25) {
      if (statusEl) statusEl.textContent = `OCR confidence too low (${Math.round(confidence)}%), skipping match.`;
      state.maps.ocr.pauseUntil = Date.now() + 8000;
      return text;
    }

    const bestMatch = findBestMapMatchFromText(text);
    if (bestMatch) {
      const nextIndex = state.maps.list.findIndex(map => map.name === bestMatch.name);
      if (nextIndex >= 0 && nextIndex !== state.maps.selectedIndex) {
        state.maps.selectedIndex = nextIndex;
        store.set('maps.selectedIndex', nextIndex);
        pushOverlayUpdate('maps');
        reRenderTab('maps');
      }
      state.maps.ocr.lastMatch = bestMatch.name;
      if (statusEl) statusEl.textContent = `Matched ${bestMatch.name} from OCR.`;
      // Stop fast scanning, switch to slow watchdog for map changes
      startMapsOcrWatchdog();
    } else {
      state.maps.ocr.lastMatch = '';
      if (text) {
        state.maps.ocr.pauseUntil = Date.now() + 20000;
      } else {
        state.maps.ocr.pauseUntil = 0;
      }
    }

    return text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || 'Unknown OCR error');
    state.maps.ocr.status = `OCR failed: ${message}`;
    if (statusEl) statusEl.textContent = state.maps.ocr.status;
    return null;
  } finally {
    mapsOcrBusy = false;
  }
}

function applyUiTheme(theme) {
  state.uiTheme = 'dark';
  store.set('ui.theme', 'dark');
  document.body.classList.remove('theme-light');
  document.body.classList.add('theme-dark');
}

function bindFilePicker(inputId, sourceInputId, applyButtonId) {
  const picker = document.getElementById(inputId);
  const sourceInput = document.getElementById(sourceInputId);
  const applyButton = document.getElementById(applyButtonId);

  if (!picker || !sourceInput || !applyButton) return;

  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (!file) return;
    sourceInput.value = file.path || file.name || '';
    applyButton.click();
    picker.value = '';
  });
}

function getHotkey(name) {
  return state.hotkeys[name] || '';
}

function setHotkey(name, shortcut, tabId) {
  // Prevent duplicate accelerators across hotkeys
  const duplicate = Object.entries(state.hotkeys).find(([k, v]) => v && v === shortcut && k !== name);
  if (duplicate) {
    showNotification(`Hotkey ${shortcut} already assigned to ${duplicate[0]}`, true);
    return;
  }

  state.hotkeys[name] = shortcut;
  store.set(`hotkeys.${name}`, shortcut);
  ipcRenderer.send('hotkeys-updated');
  reRenderTab(tabId);
}

function formatHotkeyCapture(event, options = {}) {
  const allowCombo = options.allowCombo !== false;
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return '';

  const specialKeyMap = {
    ' ': 'Space',
    Escape: 'Esc',
    Esc: 'Esc',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
  };

  let key = specialKeyMap[event.key] || event.key;
  if (!key) return '';
  if (key.length === 1) key = key.toUpperCase();
  if (/^F\d{1,2}$/i.test(key)) key = key.toUpperCase();

  if (!allowCombo) {
    return key;
  }

  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

function bindHotkeyInputs() {
  document.querySelectorAll('[data-hotkey-setting]').forEach(input => {
    input.addEventListener('keydown', event => {
      event.preventDefault();

      if (event.key === 'Escape') {
        input.blur();
        return;
      }

      const settingKey = input.dataset.hotkeySetting;
      const tabId = input.dataset.hotkeyTab;

      if (event.key === 'Backspace' || event.key === 'Delete') {
        setHotkey(settingKey, '', tabId);
        return;
      }

      const shortcut = formatHotkeyCapture(event, {
        allowCombo: (input.dataset.hotkeySetting !== 'onevoneSwitchTimer' && input.dataset.hotkeySetting !== 'mapsToggleRegion'),
      });
      if (!shortcut) return;

      setHotkey(settingKey, shortcut, tabId);
      input.blur();
    });
  });
}

function isTypingInEditableField() {
  const active = document.activeElement;
  if (!active) return false;
  if (active.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
}

function bindHotkeyTypingGuards() {
  document.addEventListener('focusin', event => {
    const target = event.target;
    if (!target) return;
    if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
      // Use electronAPI if available, otherwise use ipcRenderer directly
      if (window.electronAPI) {
        window.electronAPI.disableHotkeys();
      } else {
        ipcRenderer.send('disable-hotkeys');
      }
    }
  });

  document.addEventListener('focusout', () => {
    const active = document.activeElement;
    const stillEditing = active && (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName));
    if (!stillEditing) {
      if (window.electronAPI) {
        window.electronAPI.enableHotkeys();
      } else {
        ipcRenderer.send('enable-hotkeys');
      }
    }
  });
}

function toFileUrl(filePath) {
  if (!filePath) return '';
  return pathToFileURL(filePath).href;
}

function overlayTitle(type) {
  return {
    onevone: '1v1 Timer Overlay - Reworked',
    maps: 'Map Overlay',
    fourvone: 'Scrim Overlay',
    queue: 'Queue Overlay',
    winstreak: 'Winstreak Overlay',
    bamboozle: 'Bamboozle Timer',
  }[type];
}

function overlayDescription(type) {
  return {
    onevone: 'Temporarily unavailable while the 1v1 timer flow is rebuilt.',
    maps: 'A full list of maps available for use.',
    fourvone: 'Killer vs team scrim board with live score and matchup.',
    queue: 'A live queue board powered by NeatQueue.',
    winstreak: 'Killer streak board with win condition and running wins total.',
    ladder: 'Ladder overlay showing ELO, winrate and matches from Slugbot.',
    bamboozle: 'Bamboozle perk cooldown timer — 16s window block countdown.',
  }[type];
}

function updateStatusBar() {
  const dot = document.querySelector('#overlay-statusbar .status-dot');
  const info = document.querySelector('#overlay-statusbar .status-info');
  if (dot) {
    const liveCount = Object.values(state.overlays).filter(item => item.open).length;
    dot.className = `status-dot ${liveCount > 0 ? 'live' : ''}`;
  }
  if (info) {
    info.textContent = `1V1 ${state.overlays.onevone.enabled ? 'EN' : 'DIS'} | MAPS ${state.overlays.maps.enabled ? 'EN' : 'DIS'} | SCR ${state.overlays.fourvone.enabled ? 'EN' : 'DIS'} | QUE ${state.overlays.queue.enabled ? 'EN' : 'DIS'} | WST ${state.overlays.winstreak.enabled ? 'EN' : 'DIS'} | LAD ${state.overlays.ladder.enabled ? 'EN' : 'DIS'} | BAM ${state.overlays.bamboozle.enabled ? 'EN' : 'DIS'}`;
  }
}

function pushOverlayUpdate(type) {
  const winstreakKiller = getWinstreakKillerData(state.winstreak.selectedKiller);
  const scrimKiller = getWinstreakKillerData(state.fourvone.selectedKiller);
  const payload = {
    type,
    font: state.selectedFont,
    onevone: {
      timerSeconds: state.onevone.timerSeconds,
      player1ElapsedMs: state.onevone.player1ElapsedMs,
      player2ElapsedMs: state.onevone.player2ElapsedMs,
      player1Seconds: state.onevone.player1Seconds,
      player2Seconds: state.onevone.player2Seconds,
      currentPlayer: state.onevone.currentPlayer,
      timerRunning: state.onevone.timerRunning,
      player1Name: state.onevone.player1Name,
      player2Name: state.onevone.player2Name,
      player1Score: state.onevone.player1Score,
      player2Score: state.onevone.player2Score,
      player1Finished: state.onevone.player1Finished,
      player2Finished: state.onevone.player2Finished,
      activeTimer: state.onevone.activeTimer,
    },
    maps: {
      list: state.maps.list,
      selectedIndex: state.maps.selectedIndex,
      timerSeconds: state.maps.timerSeconds,
      timerDuration: state.maps.timerDuration,
      timerRunning: state.maps.timerRunning,
    },
    fourvone: {
      style: state.fourvone.style,
      selectedKiller: state.fourvone.selectedKiller,
      killerName: scrimKiller.name,
      killerIcon: scrimKiller.icon,
      killerImage: scrimKiller.image,
      latestWincon: state.fourvone.latestWincon,
      lastStages: state.fourvone.lastStages,
      lastFreshes: state.fourvone.lastFreshes,
      setLabel: state.fourvone.setLabel,
      currentSet: state.fourvone.currentSet,
      totalSets: state.fourvone.totalSets,
      nextSetKiller: state.fourvone.nextSetKiller,
      killerScore: state.fourvone.killerScore,
      bestOf: state.fourvone.bestOf,
      teams: state.fourvone.teams.map(team => ({ ...team })),
    },
    queue: {
      title: state.queue.title,
      apiToken: state.queue.apiToken,
      channelId: state.queue.channelId,
      serverId: state.queue.serverId,
      maxVisible: state.queue.maxVisible,
    },
    winstreak: {
      mode: state.winstreak.mode,
      selectedKiller: state.winstreak.selectedKiller,
      style: state.winstreak.style,
      survivorStyle: state.winstreak.survivorStyle,
      killerName: winstreakKiller.name,
      killerIcon: winstreakKiller.icon,
      killerImage: winstreakKiller.image,
      wincon: state.winstreak.wincon,
      gamesWon: state.winstreak.gamesWon,
      pb: state.winstreak.pb || '',
      worldRecord: state.winstreak.worldRecord || '',
      survivor: state.winstreak.survivor,
    },
    ladder: {
      style: state.ladder.style,
      serverId: state.ladder.serverId,
      leaderboardId: state.ladder.leaderboardId,
      players: (state.ladder.data && state.ladder.data.players) || [],
    },
    bamboozle: {
      image: state.bamboozle.image,
      duration: state.bamboozle.duration,
      running: state.bamboozle.running,
      remaining: state.bamboozle.remaining,
      phase: state.bamboozle.phase,
    },
  };

  ipcRenderer.send('update-overlay', type, payload);
  updateStatusBar();
}

function startQueueRefreshTimer() {
  if (timers.queue) return;
  timers.queue = setInterval(() => {
    if (!state.overlays.queue.enabled && !state.overlays.queue.open) return;
    pushOverlayUpdate('queue');
  }, 5000);
}

function fetchLadderStats() {
  // Deprecated: use fetchLadderPlayer / fetchLadderPlayers
  return Promise.resolve(null);
}

function normalizeServerId(value) {
  let raw = String(value || '').trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parts = new URL(raw).pathname.split('/').filter(Boolean);
      const pivot = parts.findIndex(p => p.toLowerCase() === 'pvplb');
      if (pivot >= 0 && parts[pivot + 1]) raw = parts[pivot + 1];
    } catch (_) {
      // keep raw fallback
    }
  }
  return raw.replace(/[{}]/g, '').replace(/\D+/g, '');
}

function normalizeLeaderboardId(value) {
  // SlugBot leaderboard names are path segments, so strip whitespace and slashes.
  let raw = String(value || '').trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parts = new URL(raw).pathname.split('/').filter(Boolean);
      const pivot = parts.findIndex(p => p.toLowerCase() === 'pvplb');
      if (pivot >= 0 && parts[pivot + 2]) raw = parts[pivot + 2];
    } catch (_) {
      // keep raw fallback
    }
  }

  raw = raw
    .replace(/[{}]/g, '')
    .replace(/\s+/g, '')
    .replace(/\//g, '')
    .toLowerCase();

  // Common shorthand users enter from memory/docs.
  if (raw === '1v1') return '1v1s';
  return raw;
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

function extractDiscordAvatarUrl(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const directUrl = String(
    source.avatar_url ||
    source.avatarUrl ||
    source.discordAvatarUrl ||
    source.profileImageUrl ||
    source.profile_image_url ||
    source.image ||
    source.picture ||
    ''
  ).trim();
  if (directUrl) return directUrl;

  const user = source.user && typeof source.user === 'object' ? source.user : {};
  const nestedUrl = String(
    user.avatar_url ||
    user.avatarUrl ||
    user.discordAvatarUrl ||
    user.profileImageUrl ||
    user.image ||
    ''
  ).trim();
  if (nestedUrl) return nestedUrl;

  const seen = new WeakSet();
  const stack = [source];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const [key, value] of Object.entries(current)) {
      if (value && typeof value === 'object') {
        stack.push(value);
        continue;
      }
      if (typeof value !== 'string') continue;
      const text = value.trim();
      if (!text) continue;
      if (!/avatar|avatar_url|avatarurl|profileimage|picture|displayavatar/i.test(key) && !/^https?:\/\//i.test(text) && !text.startsWith('file:')) continue;
      if (/^https?:\/\//i.test(text) || text.startsWith('file:')) return text;
    }
  }

  const userId = String(source.user_id || source.userId || user.id || source.discord_id || source.discordId || '').trim();
  const avatarHash = String(source.avatar || source.avatarHash || user.avatar || user.avatarHash || '').trim();
  if (userId && avatarHash) {
    const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(avatarHash)}.${ext}?size=128`;
  }

  if (userId) {
    try {
      const idNum = BigInt(userId);
      const index = Number(idNum % 5n);
      return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    } catch (_) {
      return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }
  }

  return '';
}

async function fetchLadderPlayer(discordId) {
  const serverId = normalizeServerId(state.ladder.serverId || '');
  const leaderboardId = normalizeLeaderboardId(state.ladder.leaderboardId || '');
  const apiUrl = String(state.ladder.apiUrl || 'https://api.slugbot.xyz/pvplb').trim();
  if (!discordId || !serverId || !leaderboardId || !apiUrl) return null;

  const url = buildSlugbotPlayerUrl(apiUrl, serverId, leaderboardId, discordId);
  console.info('Fetching ladder player', { discordId, serverId, leaderboardId, url });

  try {
    const result = await ipcRenderer.invoke('ladder-fetch-player', {
      discordId,
      serverId,
      leaderboardId,
      apiUrl,
    });

    if (!result || !result.ok || !result.data) {
      throw new Error(result?.error || 'Slugbot request failed');
    }

    const json = result.data;
    // Expected shape: { displayName, rank, matchesPlayed, matchesWon, elo, points }
    const avatarUrl = extractDiscordAvatarUrl(json);
    return {
      name: json.displayName || json.name || String(discordId),
      elo: Number(json.elo || json.points || 0),
      rank: json.rank ?? '',
      matches: Number(json.matchesPlayed || 0),
      wins: Number(json.matchesWon || 0),
      losses: Math.max(0, (Number(json.matchesPlayed || 0) - Number(json.matchesWon || 0))),
      winrate: (json.matchesPlayed ? Math.round(((Number(json.matchesWon || 0) / Number(json.matchesPlayed)) * 100) * 100) / 100 : 0),
      avatar: avatarUrl,
      raw: json,
    };
  } catch (err) {
    const message = String(err?.message || err || 'Unknown error');
    state.ladder.fetchStatus = `Fetch failed (${leaderboardId}): ${message}`;
    store.set('ladder.fetchStatus', state.ladder.fetchStatus);
    console.warn('Failed to fetch ladder player', discordId, 'url:', url, err);
    return null;
  }
}

function fetchLadderPlayers() {
  // Support single-user mode via state.ladder.playerDiscord (preferred)
  const pPrimary = String(state.ladder.playerDiscord || state.ladder.player1Discord || '').trim();
  const pOpponent = String(state.ladder.opponentDiscord || '').trim();
  state.ladder.serverId = normalizeServerId(LADDER_FIXED_CONFIG.serverId) || LADDER_FIXED_CONFIG.serverId;
  state.ladder.leaderboardId = normalizeLeaderboardId(LADDER_FIXED_CONFIG.leaderboardId) || LADDER_FIXED_CONFIG.leaderboardId;

  if (!pPrimary) {
    state.ladder.fetchStatus = `No Discord player ID set for ${state.ladder.leaderboardId}`;
    store.set('ladder.fetchStatus', state.ladder.fetchStatus);
    console.warn('Ladder fetch skipped: no player Discord ID configured');
    pushOverlayUpdate('ladder');
    return Promise.resolve([]);
  }

  // Fetch primary player
  const p1Promise = fetchLadderPlayer(pPrimary);
  
  // Fetch opponent if provided
  const p2Promise = pOpponent ? fetchLadderPlayer(pOpponent) : Promise.resolve(null);

  return Promise.all([p1Promise, p2Promise]).then(([d1, d2]) => {
    const players = [];
    if (d1) players.push(d1);
    if (d2) players.push(d2);
    const previousPlayers = Array.isArray(state.ladder.data && state.ladder.data.players) ? state.ladder.data.players : [];
    const nextPlayers = players.length ? players : previousPlayers;
    if (players.length) {
      state.ladder.fetchStatus = `Fetched ${players.length} player${players.length > 1 ? 's' : ''} from ${state.ladder.leaderboardId}`;
      store.set('ladder.fetchStatus', state.ladder.fetchStatus);
    } else {
      state.ladder.fetchStatus = `No ladder player data returned for ${state.ladder.leaderboardId}`;
      store.set('ladder.fetchStatus', state.ladder.fetchStatus);
    }
    state.ladder.data = Object.assign({}, state.ladder.data || {}, { players: nextPlayers, fetchedAt: Date.now() });
    state.ladder.lastUpdated = Date.now();
    store.set('ladder.data', state.ladder.data);
    store.set('ladder.lastUpdated', state.ladder.lastUpdated);
    pushOverlayUpdate('ladder');
    return players;
  });

}


function startLadderRefreshTimer() {
  if (timers.ladder) return;
  const interval = Math.max(15, parseInt(state.ladder.refreshInterval, 10) || 60) * 1000;
  timers.ladder = setInterval(() => {
    if (!state.overlays.ladder.enabled && !state.overlays.ladder.open) return;
    fetchLadderPlayers();
  }, interval);
  // Do an immediate fetch once started
  fetchLadderPlayers();
}

function stopLadderRefreshTimer() {
  clearInterval(timers.ladder);
  timers.ladder = null;
}

function startOnevoneTimer(playerNum = 1) {
  const nextPlayer = playerNum === 2 ? 2 : 1;
  state.onevone.activeTimer = nextPlayer;
  store.set('onevone.activeTimer', state.onevone.activeTimer);

  const activeTimer = onevoneTimers[nextPlayer];
  if (!state.onevone.timerRunning) {
    activeTimer.start();
    state.onevone.timerRunning = true;
  }

  if (!timers.onevone) {
    timers.onevone = setInterval(() => {
      syncOnevoneTimerState();
      updateTimerDisplay('onevone');
    }, 100);
  }

  ipcRenderer.send('onevone-command', { command: 'start', player: nextPlayer });
  syncOnevoneTimerState();
  updateTimerDisplay('onevone');
  pushOverlayUpdate('onevone');
}

function stopOnevoneTimer() {
  clearInterval(timers.onevone);
  timers.onevone = null;
  onevoneTimers[1].pause();
  onevoneTimers[2].pause();
  state.onevone.timerRunning = false;
  ipcRenderer.send('onevone-command', { command: 'pause' });
  syncOnevoneTimerState();
  updateTimerDisplay('onevone');
  pushOverlayUpdate('onevone');
}

function resetOnevoneTimer() {
  clearInterval(timers.onevone);
  timers.onevone = null;
  onevoneTimers[1].reset();
  onevoneTimers[2].reset();
  state.onevone.player1ElapsedMs = 0;
  state.onevone.player2ElapsedMs = 0;
  state.onevone.player1Seconds = 0;
  state.onevone.player2Seconds = 0;
  state.onevone.player1Finished = false;
  state.onevone.player2Finished = false;
  state.onevone.timerRunning = false;
  state.onevone.activeTimer = 1;
  store.set('onevone.player1ElapsedMs', 0);
  store.set('onevone.player2ElapsedMs', 0);
  store.set('onevone.player1Seconds', 0);
  store.set('onevone.player2Seconds', 0);
  store.set('onevone.activeTimer', 1);
  ipcRenderer.send('onevone-command', { command: 'reset' });
  updateTimerDisplay('onevone');
  pushOverlayUpdate('onevone');
}

function switchOnevoneTimer() {
  const nextTimer = state.onevone.activeTimer === 1 ? 2 : 1;
  if (state.onevone.timerRunning) {
    onevoneTimers[state.onevone.activeTimer].pause();
    onevoneTimers[nextTimer].start();
  }
  state.onevone.activeTimer = nextTimer;
  store.set('onevone.activeTimer', state.onevone.activeTimer);
  ipcRenderer.send('onevone-command', { command: 'switch' });
  syncOnevoneTimerState();
  updateTimerDisplay('onevone');
  pushOverlayUpdate('onevone');
  reRenderTab('onevone');
}

function finishOnevonePlayer(playerNum) {
  const otherPlayer = playerNum === 1 ? 2 : 1;
  const playerKey = `player${playerNum}`;
  const otherPlayerKey = `player${otherPlayer}`;
  state.onevone[`${playerKey}Finished`] = true;
  store.set(`onevone.${playerKey}Finished`, true);

  if (state.onevone.timerRunning && !state.onevone[`${otherPlayerKey}Finished`]) {
    onevoneTimers[playerNum].pause();
    onevoneTimers[otherPlayer].start();
    state.onevone.activeTimer = otherPlayer;
    store.set('onevone.activeTimer', state.onevone.activeTimer);
    ipcRenderer.send('onevone-command', { command: 'finish', player: playerNum });
    syncOnevoneTimerState();
    updateTimerDisplay('onevone');
    pushOverlayUpdate('onevone');
    reRenderTab('onevone');
    return;
  }
  
  ipcRenderer.send('onevone-command', { command: 'finish', player: playerNum });
  if (state.onevone.player1Finished && state.onevone.player2Finished) {
    stopOnevoneTimer();
  }
  
  updateTimerDisplay('onevone');
  pushOverlayUpdate('onevone');
  reRenderTab('onevone');
}

function switchOnevonePlayer(playerNum) {
  state.onevone.currentPlayer = playerNum;
  store.set('onevone.currentPlayer', playerNum);
  reRenderTab('onevone');
  pushOverlayUpdate('onevone');
}

function startMapsTimer() {
  if (timers.maps) return;
  state.maps.timerRunning = true;
  timers.maps = setInterval(() => {
    if (state.maps.timerSeconds > 0) {
      state.maps.timerSeconds -= 1;
      updateTimerDisplay('maps');
      pushOverlayUpdate('maps');
    } else {
      stopMapsTimer();
    }
  }, 1000);
  updateTimerDisplay('maps');
  pushOverlayUpdate('maps');
}

function stopMapsTimer() {
  clearInterval(timers.maps);
  timers.maps = null;
  state.maps.timerRunning = false;
  updateTimerDisplay('maps');
  pushOverlayUpdate('maps');
}

function resetMapsTimer() {
  stopMapsTimer();
  state.maps.timerSeconds = state.maps.timerDuration;
  updateTimerDisplay('maps');
  pushOverlayUpdate('maps');
}

function updateTimerDisplay(type) {
  const section = state[type];
  if (type === 'onevone') {
    const timer1 = document.getElementById('onevone-timer-p1');
    const timer2 = document.getElementById('onevone-timer-p2');
    const active1 = section.activeTimer === 1 && section.timerRunning;
    const active2 = section.activeTimer === 2 && section.timerRunning;

    if (timer1) {
      timer1.textContent = formatMillisDynamic(section.player1ElapsedMs);
      // preserve other classes (e.g. timer-large) and only toggle running state
      timer1.classList.add('timer-display');
      timer1.classList.remove('running', 'warning', 'danger');
      if (active1) timer1.classList.add('running');
    }
    if (timer2) {
      timer2.textContent = formatMillisDynamic(section.player2ElapsedMs);
      timer2.classList.add('timer-display');
      timer2.classList.remove('running', 'warning', 'danger');
      if (active2) timer2.classList.add('running');
    }

    // No toggle or select buttons in the simplified UI; timers update only the displays.
    return;
  }

  const el = document.getElementById(`${type}-timer-display`);
  if (!el) return;

  el.textContent = formatTime(section.timerSeconds);
  
  el.className = 'timer-display';

  if (section.timerRunning) el.classList.add('running');
}

function setOverlayEnabled(type, enabled) {
  state.overlays[type].enabled = enabled;
  store.set(`overlay.${type}.enabled`, enabled);
  ipcRenderer.send('overlay-enable', type, enabled);
  reRenderTab('dashboard');
}

function openOverlay(type) {
  state.overlays[type].open = true;
  ipcRenderer.send('open-overlay', type);
  pushOverlayUpdate(type);
  reRenderTab('dashboard');
  reRenderTab(type);
}

async function refreshWindowsAnimationsStatus() {
  try {
    const result = await ipcRenderer.invoke('windows-animation-status');
    state.windowsAnimations.enabled = !!result?.enabled;
    state.windowsAnimations.loading = false;
    reRenderTab('dashboard');
    if (!state.windowsAnimations.enabled) {
      showWindowsAnimationsPopup();
    }
    return result;
  } catch (err) {
    state.windowsAnimations.enabled = false;
    state.windowsAnimations.loading = false;
    reRenderTab('dashboard');
    showWindowsAnimationsPopup();
    return { ok: false, enabled: false, error: String(err?.message || err || 'Failed to check Windows animations') };
  }
}

async function enableWindowsAnimations() {
  state.windowsAnimations.fixing = true;
  reRenderTab('dashboard');
  try {
    const result = await ipcRenderer.invoke('enable-windows-animations');
    if (result?.ok) {
      state.windowsAnimations.enabled = true;
      showNotification('Windows animation setting enabled.');
      await refreshWindowsAnimationsStatus();
      return result;
    }

    showNotification(result?.error || 'Could not enable Windows animations', true);
    return result;
  } catch (err) {
    showNotification('Could not enable Windows animations', true);
    return { ok: false, error: String(err?.message || err || 'Failed to enable Windows animations') };
  } finally {
    state.windowsAnimations.fixing = false;
    reRenderTab('dashboard');
  }
}

function showWindowsAnimationsPopup() {
  if (state.windowsAnimations.popupVisible) return;
  state.windowsAnimations.popupVisible = true;

  let modal = document.getElementById('windows-animations-popup');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'windows-animations-popup';
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.72);
      z-index: 10050;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    `;

    modal.innerHTML = `
      <div style="width: min(560px, 100%); background: #11131a; border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; box-shadow: 0 24px 60px rgba(0,0,0,0.45); padding: 24px; color: #eef2ff;">
        <div style="display:flex;align-items:flex-start;gap:14px;">
          <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#ff8b8b,#ff5d5d);display:flex;align-items:center;justify-content:center;font-size:24px;flex:0 0 auto;">!</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:20px;font-weight:800;letter-spacing:0.2px;margin-bottom:8px;">Windows animation setting is off</div>
            <div style="font-size:14px;line-height:1.6;color:#c8cfdd;">
              If <strong>Animate controls and elements inside windows</strong> is disabled, the overlays can flicker, duplicate, or disappear. Turn it on and the app will fix it for you.
            </div>
          </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:22px;flex-wrap:wrap;">
          <button class="btn" id="windows-animation-popup-dismiss">Not now</button>
          <button class="btn primary" id="windows-animation-popup-fix">Turn It On For Me</button>
        </div>
      </div>
    `;

    modal.addEventListener('click', event => {
      if (event.target === modal) {
        closeWindowsAnimationsPopup();
      }
    });

    document.body.appendChild(modal);
  }

  modal.style.display = 'flex';

  const dismissBtn = modal.querySelector('#windows-animation-popup-dismiss');
  const fixBtn = modal.querySelector('#windows-animation-popup-fix');

  if (dismissBtn && !dismissBtn._bound) {
    dismissBtn._bound = true;
    dismissBtn.addEventListener('click', () => {
      closeWindowsAnimationsPopup();
    });
  }

  if (fixBtn && !fixBtn._bound) {
    fixBtn._bound = true;
    fixBtn.addEventListener('click', async () => {
      await enableWindowsAnimations();
      closeWindowsAnimationsPopup();
    });
  }
}

function closeWindowsAnimationsPopup() {
  const modal = document.getElementById('windows-animations-popup');
  if (modal) modal.style.display = 'none';
  state.windowsAnimations.popupVisible = false;
}

function setRobloxSelection(type, selected) {
  if (!Object.prototype.hasOwnProperty.call(state.robloxIntegration, type)) return;
  state.robloxIntegration[type] = !!selected;
  store.set(`roblox.selection.${type}`, state.robloxIntegration[type]);
}

function getSelectedRobloxOverlays() {
  return Object.entries(state.robloxIntegration)
    .filter(([key, selected]) => key !== 'enabled' && key !== 'placeId' && key !== 'closeOnExit' && !!selected)
    .map(([type]) => type);
}

function saveRobloxIntegration() {
  store.set('roblox.enabled', state.robloxIntegration.enabled);
  store.set('roblox.placeId', state.robloxIntegration.placeId);
  store.set('roblox.closeOnExit', state.robloxIntegration.closeOnExit);
  ['onevone', 'maps', 'queue', 'fourvone', 'winstreak'].forEach(type => {
    store.set(`roblox.selection.${type}`, state.robloxIntegration[type]);
  });
  ipcRenderer.send('roblox-config-updated');
}

function testRobloxIntegration() {
  return ipcRenderer.invoke('roblox-test');
}

function closeOverlay(type) {
  state.overlays[type].open = false;
  ipcRenderer.send('close-overlay', type);
  reRenderTab('dashboard');
  reRenderTab(type);
}


function closeAllOverlays() {
  Object.keys(state.overlays).forEach(type => {
    if (state.overlays[type].open) {
      closeOverlay(type);
    }
  });
}

function openEnabledOverlaysForObs() {
  const overlayOrder = ['maps', 'queue', 'fourvone', 'winstreak'];

  overlayOrder.forEach(type => {
    if (!state.overlays[type]?.enabled) return;
    openOverlay(type);
  });
}
function toggleOverlayLock(type) {
  state.overlays[type].locked = !state.overlays[type].locked;
  store.set(`overlay.${type}.locked`, state.overlays[type].locked);
  ipcRenderer.send('toggle-overlay-lock', type, state.overlays[type].locked);
  reRenderTab('dashboard');
}

function toggleAlwaysOnTop(type) {
  state.overlays[type].alwaysOnTop = !state.overlays[type].alwaysOnTop;
  store.set(`overlay.${type}.alwaysOnTop`, state.overlays[type].alwaysOnTop);
  ipcRenderer.send('toggle-overlay-always-on-top', type, state.overlays[type].alwaysOnTop);
  reRenderTab('dashboard');
}

function toggleTransparentMode(type) {
  state.overlays[type].transparent = !state.overlays[type].transparent;
  store.set(`overlay.${type}.transparent`, state.overlays[type].transparent);
  ipcRenderer.send('toggle-overlay-transparent', type, state.overlays[type].transparent);
  reRenderTab('dashboard');
}

function toggleClickthrough(type) {
  state.overlays[type].clickthrough = !state.overlays[type].clickthrough;
  store.set(`overlay.${type}.clickthrough`, state.overlays[type].clickthrough);
  ipcRenderer.send('toggle-overlay-clickthrough', type, state.overlays[type].clickthrough);
  reRenderTab('dashboard');
}

function setWinstreakKiller(killerName) {
  const resolvedKiller = KILLERS.find(killer => killer.name === killerName) || KILLERS[0];
  if (!resolvedKiller) return;

  persistCurrentWinstreakStats();
  state.winstreak.mode = 'killer';
  store.set('winstreak.mode', state.winstreak.mode);
  state.winstreak.selectedKiller = resolvedKiller.name;
  store.set('winstreak.killer', state.winstreak.selectedKiller);
  loadWinstreakStatsForKiller(state.winstreak.selectedKiller);
  persistCurrentWinstreakStats();
  pushOverlayUpdate('winstreak');
  reRenderTab('dashboard');
  reRenderTab('winstreak');
}

function nextWinstreakKiller() {
  const currentIndex = KILLERS.findIndex(killer => killer.name === state.winstreak.selectedKiller);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % KILLERS.length : 0;
  const nextKiller = KILLERS[nextIndex];
  if (nextKiller) setWinstreakKiller(nextKiller.name);
}

function toggleWinstreakAlwaysOnTop() {
  toggleAlwaysOnTop('winstreak');
}
function renderDashboardTab() {
  let liveOverlayTypes = ['maps', 'fourvone'];
  
  const liveCards = liveOverlayTypes
    .map(type => {
      const overlay = state.overlays[type];
      const enableText = overlay.enabled ? 'Enabled' : 'Disabled';
      const detailLine = type === 'maps'
        ? `${getSelectedMap()?.name || 'No map selected'} | ${formatTime(state.maps.timerSeconds)}`
        : type === 'onevone'
          ? `Timer ${formatTime(state.onevone.timerSeconds)}`
          : `${state.fourvone.selectedKiller} vs ${state.fourvone.teams[0]?.name || 'Team'}`;

      return `
        <section class="overlay-card ${overlay.open ? 'live' : ''}">
          <div class="overlay-card-top">
            <div>
              <div class="overlay-card-title">${overlayTitle(type)}</div>
              <div class="overlay-card-subtitle">${overlayDescription(type)}</div>
            </div>
            <div class="status-pill ${overlay.enabled ? 'success' : 'muted'}">${enableText}</div>
          </div>
          <div class="overlay-card-meta">${detailLine}</div>
          <div class="overlay-card-actions">
            <button class="btn sm ${overlay.enabled ? 'success' : ''}" data-overlay-enable="${type}">
              ${overlay.enabled ? 'Disable' : 'Enable'}
            </button>
            <button class="btn sm primary" data-overlay-open="${type}">
              ${overlay.open ? 'Close' : 'Launch'}
            </button>
            <button class="btn sm ${overlay.locked ? 'danger' : ''}" data-overlay-lock="${type}" ${overlay.open ? '' : 'disabled'}>
              ${overlay.locked ? 'Unlock' : 'Lock'}
            </button>
            <button class="btn sm ${overlay.alwaysOnTop ? 'success' : ''}" data-overlay-always-on-top="${type}" ${overlay.open ? '' : 'disabled'}>
              ${overlay.alwaysOnTop ? 'Always Top' : 'Floating'}
            </button>
            <button class="btn sm ${overlay.transparent ? 'danger' : ''}" data-overlay-transparent="${type}" ${overlay.open ? '' : 'disabled'}>
              ${overlay.transparent ? 'Opaque' : 'Transparent'}
            </button>
            <button class="btn sm ${overlay.clickthrough ? 'success' : ''}" data-overlay-clickthrough="${type}" ${overlay.open ? '' : 'disabled'}>
              ${overlay.clickthrough ? 'Click-through' : 'Interactive'}
            </button>
          </div>
          <div class="overlay-card-transparency" style="display: flex; align-items: center; gap: 10px; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); ${overlay.open ? '' : 'opacity: 0.5;'}">
            <label style="font-size: 12px; white-space: nowrap; min-width: 90px;">Background:</label>
            <input type="range" class="overlay-bg-alpha-slider" data-overlay-type="${type}" min="0" max="100" value="${Math.round(overlay.backgroundAlpha * 100)}" style="flex: 1;" ${overlay.open ? '' : 'disabled'} />
            <span class="overlay-bg-alpha-value" style="min-width: 30px; text-align: right; font-size: 12px;">${Math.round(overlay.backgroundAlpha * 100)}%</span>
          </div>
        </section>
      `;

    }).join('');

    const survivor = (state.winstreak && state.winstreak.survivor) ? state.winstreak.survivor : { twoOut: 0, threeOut: 0, fourOut: 0 };

    return `
    <div class="tab-panel" id="tab-dashboard">
      <div class="page-header">
        <div class="page-branding">
          <div class="page-logo">VD OverlayTools</div>
          <div class="page-title-row">
            <div class="page-title">VD OverlayTools</div>
          </div>
          <div class="sponsor-banner sponsor-banner-vdl" style="background: linear-gradient(90deg, #2b1141 0%, #3a1760 50%, #2b1141 100%); border: 1px solid #8a2be2; border-left-width: 4px; border-radius: 10px; padding: 12px 14px; margin: 12px 0; display: inline-flex; align-items: center; justify-content: flex-start; gap: 12px; width: fit-content; max-width: 100%; box-shadow: 0 4px 14px rgba(20, 10, 30, 0.35); white-space: nowrap;">
            <div class="sponsor-text" style="color: #eadfff; font-size: 13px; letter-spacing: 0.5px; font-weight: 500;">Sponsored by <strong style="font-weight: 700; color: #ffffff;">Violence District League</strong></div>
            <button class="sponsor-btn vdl-btn" type="button" onclick="openVDL()" style="background: linear-gradient(135deg, #8a2be2 0%, #5c1fa5 100%); border: 1px solid #caa7ff; color: #ffffff; padding: 6px 14px; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; box-shadow: 0 2px 8px rgba(138, 43, 226, 0.35); transition: transform 0.2s ease, box-shadow 0.2s ease; letter-spacing: 0.5px;">VDL</button>
          </div>
          <div class="sponsor-banner sponsor-banner-vdr" style="background: linear-gradient(90deg, #1f0606 0%, #2f0a0a 50%, #1f0606 100%); border: 1px solid #8b0000; border-left-width: 4px; border-radius: 10px; padding: 12px 14px; margin: 12px 0; display: inline-flex; align-items: center; justify-content: flex-start; gap: 12px; width: fit-content; max-width: 100%; box-shadow: 0 4px 14px rgba(20, 10, 10, 0.35); white-space: nowrap;">
            <div class="sponsor-text" style="color: #ffd8d8; font-size: 13px; letter-spacing: 0.5px; font-weight: 500;">Sponsored by <strong style="font-weight: 700; color: #ffffff;">Violence District Ranked Indonesia</strong></div>
            <button class="sponsor-btn vdr-btn" type="button" onclick="openVDR()" style="background: linear-gradient(135deg, #8b0000 0%, #4d0000 100%); border: 1px solid #ffc1c1; color: #ffffff; padding: 6px 14px; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; box-shadow: 0 2px 8px rgba(139, 0, 0, 0.35); transition: transform 0.2s ease, box-shadow 0.2s ease; letter-spacing: 0.5px;">VDR</button>
          </div>
          <div class="page-subtitle">What do you wanna use today?</div>
        </div>
      </div>

      <div class="card dashboard-quick-starts">
        <div class="card-title">New here?</div>
        <div class="dashboard-quick-start-grid">
          <article class="dashboard-start-card dashboard-start-card-competitive">
            <div class="dashboard-start-kicker">New to competitive?</div>
            <div class="dashboard-start-title">Learn ladder rules and start positions</div>
            <div class="dashboard-start-text">Open the ladder rules first, then check the map start images for the 1v1 layouts.</div>
            <div class="dashboard-start-actions">
              <button class="btn" data-dashboard-tab="game-info-1v1-map-starts" data-dashboard-refresh="true">Map Starts</button>
            </div>
          </article>

          <article class="dashboard-start-card dashboard-start-card-vd">
            <div class="dashboard-start-kicker">New to VD?</div>
            <div class="dashboard-start-title">Start with the main wiki</div>
            <div class="dashboard-start-text">Use the wiki for the full game overview, items, killers, perks, and general info.</div>
            <div class="dashboard-start-actions">
              <button class="btn primary" data-dashboard-tab="game-info" data-dashboard-refresh="true">Open Wiki</button>
            </div>
          </article>
        </div>
      </div>

      <!-- Changelog moved to Settings tab -->
    </div>
  `;
}

function renderMapsTab() {
  const mapCards = state.maps.list.map((map, index) => `
    <button class="map-card ${state.maps.selectedIndex === index ? 'selected' : ''}" type="button" data-mapidx="${index}">
      <div class="map-thumb ${map.image ? '' : 'empty'}" ${map.image ? `style="background-image:url('${toFileUrl(map.image)}')"` : ''}>
        <span class="map-thumb-overlay">${escapeHtml(map.name)}</span>
      </div>
      <div class="map-name">${escapeHtml(map.name)}</div>
    </button>
  `).join('');

  const selectedMap = getSelectedMap();

  return `
    <div class="tab-panel ${state.maps.regionTransition ? 'maps-region-switching' : ''}" id="tab-maps">
      <div class="page-title">Map Overlay</div>
      <div class="page-subtitle">Pick a map and launch the overlay. No clock, no extras.</div>

      <div class="card compact-card">
        <div class="card-title">Region</div>
        <div class="form-row">
          <label>Map region</label>
          <select id="maps-region-select">
            <option value="NA" ${state.maps.region === 'NA' ? 'selected' : ''}>NA (VDL)</option>
            <option value="EU" ${state.maps.region === 'EU' ? 'selected' : ''}>EU (VDR)</option>
          </select>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Provided Maps</div>
        ${state.maps.list.length ? '' : '<div class="text-sm">No map images were found in assets/maps.</div>'}
        <div class="map-grid">${mapCards}</div>
      </div>

      <div class="card compact-card">
        <div class="card-title">Overlay</div>
        <div class="form-row">
          <label>Overlay Opacity</label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="range" id="maps-opacity" min="0" max="100" value="${state.overlays.maps.opacity}" style="flex: 1;" />
            <span id="maps-opacity-val" style="min-width: 35px; text-align: right;">${state.overlays.maps.opacity}%</span>
          </div>
        </div>
        <div class="form-row">
          <label>Background Transparency</label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="range" id="maps-bg-alpha" min="0" max="100" value="${Math.round(state.overlays.maps.backgroundAlpha * 100)}" style="flex: 1;" />
            <span id="maps-bg-alpha-val" style="min-width: 35px; text-align: right;">${Math.round(state.overlays.maps.backgroundAlpha * 100)}%</span>
          </div>
        </div>
        <div class="inline-switch-row">
          <span>Map overlay enabled</span>
          <label class="toggle"><input type="checkbox" id="maps-enabled" ${state.overlays.maps.enabled ? 'checked' : ''}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Always on top</span>
          <label class="toggle"><input type="checkbox" id="maps-always-on-top" ${state.overlays.maps.alwaysOnTop ? 'checked' : ''} ${state.overlays.maps.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Overlay locked</span>
          <label class="toggle"><input type="checkbox" id="maps-locked" ${state.overlays.maps.locked ? 'checked' : ''} ${state.overlays.maps.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Click-through (interactive when off)</span>
          <label class="toggle"><input type="checkbox" id="maps-clickthrough" ${state.overlays.maps.clickthrough ? 'checked' : ''} ${state.overlays.maps.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <button class="btn primary full mt-12" id="btn-map-open">${state.overlays.maps.open ? 'Close Overlay' : 'Launch Overlay'}</button>
      </div>

      <div class="card compact-card">
        <div class="card-title">OCR detection</div>
        <div class="inline-switch-row">
          <span>Enable OCR detection</span>
          <label class="toggle"><input type="checkbox" id="maps-ocr-enabled" ${state.maps.ocr.enabled ? 'checked' : ''}><span class="toggle-track"></span></label>
        </div>
        ${state.maps.ocr.enabled ? `
          <div class="form-row mt-8">
            <label>OCR capture target</label>
            <div style="display:flex;gap:8px;align-items:center;">
              <select id="maps-ocr-capture-target" style="flex:1;">
                <option value="roblox" ${state.maps.ocr.captureTarget === 'roblox' ? 'selected' : ''}>Roblox window only</option>
                ${(state.maps.ocr.windowSources || []).map(source => `<option value="${escapeHtml(source.name)}" ${state.maps.ocr.captureTarget === source.name ? 'selected' : ''}>${escapeHtml(source.name)}</option>`).join('')}
              </select>
              <button class="btn sm" id="maps-ocr-refresh-targets" type="button">Refresh</button>
            </div>
          </div>
          <div class="form-row">
            <label>OCR actions</label>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="btn primary" id="maps-ocr-manual-calibration" type="button">Manual Calibration</button>
              <button class="btn" id="maps-ocr-scan-now" type="button" ${state.maps.ocr.zone ? '' : 'disabled'}>Scan now</button>
              <button class="btn" id="maps-ocr-reset-zone" type="button">Reset suggested zone</button>
            </div>
          </div>
          <div class="card" style="margin-top:10px; padding:12px;">
            <div class="form-row" style="margin-top:0;">
              <label>Zone</label>
              <div id="maps-ocr-zone">${state.maps.ocr.zone ? `${state.maps.ocr.zone.x}% / ${state.maps.ocr.zone.y}% / ${state.maps.ocr.zone.width}% / ${state.maps.ocr.zone.height}%` : 'Not calibrated yet'}</div>
            </div>
            <div class="form-row">
              <label>Status</label>
              <div id="maps-ocr-status">${escapeHtml(state.maps.ocr.status)}</div>
            </div>
            <div class="form-row">
              <label>Confidence</label>
              <div id="maps-ocr-confidence">${state.maps.ocr.lastConfidence != null ? `${state.maps.ocr.lastConfidence}% confidence` : 'No confidence yet'}</div>
            </div>
            <div class="form-row">
              <label>Result</label>
              <div id="maps-ocr-result">${escapeHtml(state.maps.ocr.lastText || 'No text detected yet')}</div>
            </div>
          </div>
        ` : `
          <div class="text-sm" style="color:#999; margin-top:10px;">Turn OCR on to open the manual calibration tools for the map area.</div>
        `}
      </div>

      <div class="card">
        <div class="card-title">Hotkeys</div>
        <div class="form-row">
          <label>Next map</label>
          <input type="text" readonly data-hotkey-setting="mapsNext" data-hotkey-tab="maps" value="${escapeHtml(getHotkey('mapsNext'))}" placeholder="Press a shortcut" />
        </div>
        <div class="form-row">
          <label>Previous map</label>
          <input type="text" readonly data-hotkey-setting="mapsPrevious" data-hotkey-tab="maps" value="${escapeHtml(getHotkey('mapsPrevious'))}" placeholder="Press a shortcut" />
        </div>
        <div class="form-row">
          <label>Toggle region <span class="text-sm" style="color:var(--text3);">(single key)</span></label>
          <input type="text" readonly data-hotkey-setting="mapsToggleRegion" data-hotkey-tab="maps" value="${escapeHtml(getHotkey('mapsToggleRegion'))}" placeholder="Press a key" />
        </div>
        <div class="form-row">
          <label>Toggle always on top</label>
          <input type="text" readonly data-hotkey-setting="mapsAlwaysOnTop" data-hotkey-tab="maps" value="${escapeHtml(getHotkey('mapsAlwaysOnTop'))}" placeholder="Press a shortcut" />
        </div>
        <div class="text-sm mt-8">Click any field and press a new shortcut. Backspace clears the binding.</div>
      </div>
    </div>
  `;
}

function renderOnevoneTab() {
  const s = state.onevone;
  const p1Active = s.activeTimer === 1 && s.timerRunning;
  const p2Active = s.activeTimer === 2 && s.timerRunning;
  const allDone = s.player1Finished && s.player2Finished;

  const hotkeys = [
    { key: 'Ctrl+Shift+1', action: 'Start timer for Player 1' },
    { key: 'Ctrl+Shift+2', action: 'Start timer for Player 2' },
    { key: 'Ctrl+Shift+P', action: 'Pause / Resume' },
    { key: 'Ctrl+Shift+R', action: 'Reset timer' },
    { key: 'Ctrl+Shift+T', action: 'Switch active player' },
  ];

  return `
    <div class="tab-panel" id="tab-onevone">
      <div class="page-title">1v1 Timer</div>
      <div class="page-subtitle">Precision timer for 1v1 matches. Timer runs locally on the overlay at 30fps.</div>

      <div class="card">
        <div class="card-title">Players</div>
        <div class="grid-2">
          <div class="form-row">
            <label>Player 1 name</label>
            <input type="text" id="onevone-player1" maxlength="20" value="${escapeHtml(s.player1Name)}" />
          </div>
          <div class="form-row">
            <label>Player 2 name</label>
            <input type="text" id="onevone-player2" maxlength="20" value="${escapeHtml(s.player2Name)}" />
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Scores</div>
        <div class="grid-2">
          <div class="onevone-score-box">
            <div class="onevone-score-label">${escapeHtml(s.player1Name || 'Player 1')}</div>
            <div class="onevone-score-controls">
              <button class="btn sm" id="onevone-p1-score-dec">−</button>
              <span class="onevone-score-value" id="onevone-p1-score-val">${s.player1Score}</span>
              <button class="btn sm" id="onevone-p1-score-inc">+</button>
            </div>
            <div class="onevone-done-row">
              <label class="toggle"><input type="checkbox" id="onevone-p1-finished" ${s.player1Finished ? 'checked' : ''}><span class="toggle-track"></span></label>
              <span class="text-sm">Finished</span>
            </div>
          </div>
          <div class="onevone-score-box">
            <div class="onevone-score-label">${escapeHtml(s.player2Name || 'Player 2')}</div>
            <div class="onevone-score-controls">
              <button class="btn sm" id="onevone-p2-score-dec">−</button>
              <span class="onevone-score-value" id="onevone-p2-score-val">${s.player2Score}</span>
              <button class="btn sm" id="onevone-p2-score-inc">+</button>
            </div>
            <div class="onevone-done-row">
              <label class="toggle"><input type="checkbox" id="onevone-p2-finished" ${s.player2Finished ? 'checked' : ''}><span class="toggle-track"></span></label>
              <span class="text-sm">Finished</span>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Timer</div>
        <div class="onevone-tab-timers">
          <div class="onevone-tab-timer ${p1Active ? 'active' : ''}">
            <div class="onevone-tab-label">${escapeHtml(s.player1Name || 'P1')}</div>
            <div class="onevone-tab-time" id="onevone-timer-p1">${formatMillisDynamic(s.player1ElapsedMs)}</div>
            <div class="onevone-tab-sub">${s.player1Seconds}s</div>
          </div>
          <div class="onevone-tab-timer ${p2Active ? 'active' : ''}">
            <div class="onevone-tab-label">${escapeHtml(s.player2Name || 'P2')}</div>
            <div class="onevone-tab-time" id="onevone-timer-p2">${formatMillisDynamic(s.player2ElapsedMs)}</div>
            <div class="onevone-tab-sub">${s.player2Seconds}s</div>
          </div>
        </div>
        <div class="onevone-tab-actions">
          <button class="btn primary" id="onevone-start">${s.timerRunning ? 'Resume' : 'Start'}</button>
          <button class="btn secondary" id="onevone-pause" ${s.timerRunning ? '' : 'disabled'}>Pause</button>
          <button class="btn danger" id="onevone-reset">Reset</button>
          <button class="btn secondary" id="onevone-switch">Switch</button>
        </div>
        <div class="onevone-tab-status">
          ${s.timerRunning ? `Running: ${escapeHtml(s.activeTimer === 2 ? s.player2Name : s.player1Name)}` : allDone ? 'Both finished' : 'Paused'}
          &middot;
          P1 ${s.player1Finished ? 'done' : 'live'} / P2 ${s.player2Finished ? 'done' : 'live'}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Hotkeys</div>
        ${hotkeys.map(item => `
          <div class="toggle-row hotkey-row">
            <div>
              <div class="toggle-label">${item.action}</div>
            </div>
            <span class="hotkey-tag">${item.key}</span>
          </div>
        `).join('')}
      </div>

      <div class="card compact-card">
        <div class="card-title">Overlay</div>
        <div class="form-row">
          <label>Overlay Opacity</label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="range" id="onevone-opacity" min="0" max="100" value="${state.overlays.onevone.opacity}" style="flex: 1;" />
            <span id="onevone-opacity-val" style="min-width: 35px; text-align: right;">${state.overlays.onevone.opacity}%</span>
          </div>
        </div>
        <div class="form-row">
          <label>Background Transparency</label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="range" id="onevone-bg-alpha" min="0" max="100" value="${Math.round(state.overlays.onevone.backgroundAlpha * 100)}" style="flex: 1;" />
            <span id="onevone-bg-alpha-val" style="min-width: 35px; text-align: right;">${Math.round(state.overlays.onevone.backgroundAlpha * 100)}%</span>
          </div>
        </div>
        <div class="inline-switch-row">
          <span>1v1 overlay enabled</span>
          <label class="toggle"><input type="checkbox" id="onevone-enabled" ${state.overlays.onevone.enabled ? 'checked' : ''}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Overlay locked</span>
          <label class="toggle"><input type="checkbox" id="onevone-locked" ${state.overlays.onevone.locked ? 'checked' : ''} ${state.overlays.onevone.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Always on top</span>
          <label class="toggle"><input type="checkbox" id="onevone-always-on-top" ${state.overlays.onevone.alwaysOnTop ? 'checked' : ''} ${state.overlays.onevone.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Click-through</span>
          <label class="toggle"><input type="checkbox" id="onevone-clickthrough" ${state.overlays.onevone.clickthrough ? 'checked' : ''} ${state.overlays.onevone.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <button class="btn primary full mt-12" id="btn-onevone-open">${state.overlays.onevone.open ? 'Close Overlay' : 'Launch Overlay'}</button>
      </div>
    </div>
  `;
}

function renderFourvoneTab() {
  const killerCards = KILLERS.map(killer => `
    <div class="killer-card ${state.fourvone.selectedKiller === killer.name ? 'selected' : ''}" data-killer="${killer.name}">
      <div class="killer-art ${killer.image ? '' : 'fallback'}">
        ${killer.image ? `<img src="${escapeHtml(killer.image)}" alt="${escapeHtml(killer.name)}" />` : escapeHtml(killer.icon)}
      </div>
      <div class="killer-name">${killer.name}</div>
      <button class="killer-favorite-btn" data-killer-fav="${killer.name}" title="Add to favorites" style="position: absolute; top: 4px; right: 4px; background: ${state.fourvone.favoriteKillers.includes(killer.name) ? '#f39c12' : '#555'}; border: none; color: #fff; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px; padding: 0;">★</button>
    </div>
  `).join('');

  const favKillers = state.fourvone.favoriteKillers.length > 0 ? `
    <div class="favorite-quick-select">
      ${state.fourvone.favoriteKillers.map(killer => `
        <button class="btn sm favorite-killer-quick" data-killer-quick="${killer}" title="Select ${killer}">${killer}</button>
      `).join('')}
    </div>
  ` : '<div class="text-sm" style="color: #999;">Star a killer to add to favorites</div>';

  const favTeams = state.fourvone.favoriteTeams.length > 0 ? `
    <div class="favorite-quick-select">
      ${state.fourvone.favoriteTeams.map(team => `
        <button class="btn sm favorite-team-quick" data-team-quick="${team}" title="Select ${team}">${team}</button>
      `).join('')}
    </div>
  ` : '<div class="text-sm" style="color: #999;">Star team names to add to favorites</div>';

  const teamRows = state.fourvone.teams.map((team, index) => `
    <div class="team-row">
      <div class="team-row-label">Team ${index + 1}</div>
      <input type="text" class="team-name-input" maxlength="20" data-teamidx="${index}" value="${escapeHtml(team.name)}" />
      <button class="btn sm danger" data-team-dec="${index}">-</button>
      <div class="team-score-val" id="team-score-${index}">${team.score}</div>
      <button class="btn sm success" data-team-inc="${index}">+</button>
      <button class="team-favorite-btn" data-team-fav="${team.name}" data-team-fav-idx="${index}" title="Add to favorites" style="background: ${state.fourvone.favoriteTeams.includes(team.name) ? '#f39c12' : '#555'}; border: none; color: #fff; width: 28px; padding: 4px; border-radius: 4px; cursor: pointer; font-size: 12px;">★</button>
    </div>
  `).join('');

  const hotkeys = [
    { key: 'Coming soon', action: 'Team score and killer selection' },
  ];

  return `
    <div class="tab-panel" id="tab-fourvone">
      <div class="page-title">Scrim Overlay</div>
      <div class="page-subtitle">Configure killer versus team matchups for scrims.</div>

      <div class="card">
        <div class="card-title">Killer Select</div>
        <div class="killer-grid">${killerCards}</div>
      </div>

      <div class="card">
        <div class="card-title">Favorite Killers</div>
        ${favKillers}
      </div>

      <div class="card">
        <div class="card-title">Recent Killers</div>
        ${state.fourvone.recentKillers.length > 0 ? `
          <div class="favorite-quick-select">
            ${state.fourvone.recentKillers.map(killer => `
              <button class="btn sm favorite-killer-quick" data-killer-quick="${killer}" title="Select ${killer}">${killer}</button>
            `).join('')}
          </div>
        ` : '<div class="text-sm" style="color: #999;">Recently used killers will appear here</div>'}
      </div>

      <div class="card">
        <div class="card-title">Scrim Result</div>
        <div class="form-row">
          <label>Latest result (example: 4k2 or 9stg3f)</label>
          <input type="text" id="fourvone-latest-wincon" maxlength="16" value="${escapeHtml(state.fourvone.latestWincon)}" placeholder="Enter latest result" />
        </div>
        <div class="form-row">
          <label>Stages</label>
          <input type="text" id="fourvone-last-stages" maxlength="8" value="${escapeHtml(state.fourvone.lastStages)}" placeholder="9" />
        </div>
        <div class="form-row">
          <label>Freshes</label>
          <input type="text" id="fourvone-last-freshes" maxlength="8" value="${escapeHtml(state.fourvone.lastFreshes)}" placeholder="3" />
        </div>
        <div class="form-row">
          <label>Custom label</label>
          <input type="text" id="fourvone-set-label" maxlength="40" value="${escapeHtml(state.fourvone.setLabel)}" placeholder="VD RANKED / VDL RANKED" />
        </div>
        <div class="form-row">
          <label>Set progress</label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="number" id="fourvone-current-set" min="1" step="1" value="${Number(state.fourvone.currentSet) || 1}" style="width: 92px;" />
            <span style="color: #999; font-size: 12px;">of</span>
            <input type="number" id="fourvone-total-sets" min="1" step="1" value="${Number(state.fourvone.totalSets) || 2}" style="width: 92px;" />
          </div>
        </div>
        <div class="form-row">
          <label>Next set killer</label>
          <input type="text" id="fourvone-next-set-killer" maxlength="32" value="${escapeHtml(state.fourvone.nextSetKiller)}" placeholder="Veil" />
        </div>
        <div class="text-sm mt-8">Shown on the scrim overlay as the latest result, stages/freshes, current set, and next set.</div>
      </div>

      <div class="card">
        <div class="card-title">Overlay Style</div>
        <div class="form-row">
          <label>Look</label>
          <select id="fourvone-style-select">
            <option value="default" ${state.fourvone.style === 'default' ? 'selected' : ''}>Default</option>
            <option value="glass" ${state.fourvone.style === 'glass' ? 'selected' : ''}>Glass & smoke</option>
          </select>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Team Setup</div>
        ${teamRows}
        <button class="btn primary full mt-8" id="btn-swap-teams" style="margin-bottom: 8px;">↔ Swap Team 1 ↔ Team 2</button>
        <button class="btn danger full mt-8" id="btn-reset-teams">Reset All Scores</button>
      </div>

      <div class="card">
        <div class="card-title">Favorite Teams</div>
        ${favTeams}
      </div>

      <div class="card">
        <div class="card-title">Settings</div>
        <div class="form-row">
          <label>Overlay Opacity</label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="range" id="fourvone-opacity" min="0" max="100" value="${state.overlays.fourvone.opacity}" style="flex: 1;" />
            <span id="fourvone-opacity-val" style="min-width: 35px; text-align: right;">${state.overlays.fourvone.opacity}%</span>
          </div>
        </div>
        <div class="form-row">
          <label>Background Transparency</label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="range" id="fourvone-bg-alpha" min="0" max="100" value="${Math.round(state.overlays.fourvone.backgroundAlpha * 100)}" style="flex: 1;" />
            <span id="fourvone-bg-alpha-val" style="min-width: 35px; text-align: right;">${Math.round(state.overlays.fourvone.backgroundAlpha * 100)}%</span>
          </div>
        </div>
        <div class="inline-switch-row">
          <span>Scrim overlay enabled</span>
          <label class="toggle"><input type="checkbox" id="fourvone-enabled" ${state.overlays.fourvone.enabled ? 'checked' : ''}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Overlay locked</span>
          <label class="toggle"><input type="checkbox" id="fourvone-locked" ${state.overlays.fourvone.locked ? 'checked' : ''} ${state.overlays.fourvone.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Always on top</span>
          <label class="toggle"><input type="checkbox" id="fourvone-always-on-top" ${state.overlays.fourvone.alwaysOnTop ? 'checked' : ''} ${state.overlays.fourvone.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Click-through</span>
          <label class="toggle"><input type="checkbox" id="fourvone-clickthrough" ${state.overlays.fourvone.clickthrough ? 'checked' : ''} ${state.overlays.fourvone.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <button class="btn primary full mt-12" id="btn-fourvone-open">${state.overlays.fourvone.open ? 'Close Overlay' : 'Launch Overlay'}</button>
      </div>

      <div class="card">
        <div class="card-title">Hotkeys</div>
        ${hotkeys.map(item => `
          <div class="toggle-row hotkey-row">
            <div>
              <div class="toggle-label">${item.action}</div>
            </div>
            <span class="hotkey-tag">${item.key}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderQueueTab() {
  const queue = state.queue || {};

  return `
    <div class="tab-panel" id="tab-queue">
      <div class="page-title">Queue Overlay</div>
      <div class="page-subtitle">Live NeatQueue tracker for showing who is currently queued. Generate the API token with <strong>/webhooks generatetoken</strong> in your NeatQueue server.</div>

      <div class="card">
        <div class="card-title">Queue Setup</div>
        <div class="form-row">
          <label>Overlay title</label>
          <input type="text" id="queue-title" maxlength="40" value="${escapeHtml(queue.title || 'Queue')}" placeholder="Queue" />
        </div>
        <div class="form-row">
          <label>NeatQueue API token</label>
          <input type="password" id="queue-api-token" maxlength="256" value="${escapeHtml(queue.apiToken || '')}" placeholder="Paste your token here" />
        </div>
        <div class="grid-2">
          <div class="form-row">
            <label>Queue channel ID</label>
            <input type="text" id="queue-channel-id" maxlength="64" value="${escapeHtml(queue.channelId || '')}" placeholder="Channel ID" />
          </div>
          <div class="form-row">
            <label>Server ID (optional)</label>
            <input type="text" id="queue-server-id" maxlength="64" value="${escapeHtml(queue.serverId || '')}" placeholder="Server ID" />
          </div>
        </div>
        <div class="form-row">
          <label>Visible players</label>
          <input type="number" id="queue-max-visible" min="3" max="12" step="1" value="${Number(queue.maxVisible) || 8}" />
        </div>
        <div class="text-sm" style="margin-top: 8px; color: #999;">Use the API token from <strong>/webhooks generatetoken</strong>, not your Discord bot token. If you only have a server ID, the overlay will use the server players endpoint. If you have a queue channel ID, it uses the queue channel endpoint.</div>
        <div class="form-row" style="margin-top: 14px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <button class="btn secondary" id="btn-queue-test">Test Token</button>
          <div id="queue-test-status" class="text-sm" style="color: #9aa4b2;">Checks the stored token against your current queue IDs.</div>
        </div>
      </div>

      <div class="card compact-card">
        <div class="card-title">Overlay</div>
        <div class="form-row">
          <label>Overlay Opacity</label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="range" id="queue-opacity" min="0" max="100" value="${state.overlays.queue.opacity}" style="flex: 1;" />
            <span id="queue-opacity-val" style="min-width: 35px; text-align: right;">${state.overlays.queue.opacity}%</span>
          </div>
        </div>
        <div class="form-row">
          <label>Background Transparency</label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="range" id="queue-bg-alpha" min="0" max="100" value="${Math.round(state.overlays.queue.backgroundAlpha * 100)}" style="flex: 1;" />
            <span id="queue-bg-alpha-val" style="min-width: 35px; text-align: right;">${Math.round(state.overlays.queue.backgroundAlpha * 100)}%</span>
          </div>
        </div>
        <div class="inline-switch-row">
          <span>Queue overlay enabled</span>
          <label class="toggle"><input type="checkbox" id="queue-enabled" ${state.overlays.queue.enabled ? 'checked' : ''}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Overlay locked</span>
          <label class="toggle"><input type="checkbox" id="queue-locked" ${state.overlays.queue.locked ? 'checked' : ''} ${state.overlays.queue.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Always on top</span>
          <label class="toggle"><input type="checkbox" id="queue-always-on-top" ${state.overlays.queue.alwaysOnTop ? 'checked' : ''} ${state.overlays.queue.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Click-through</span>
          <label class="toggle"><input type="checkbox" id="queue-clickthrough" ${state.overlays.queue.clickthrough ? 'checked' : ''} ${state.overlays.queue.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <button class="btn primary full mt-12" id="btn-queue-open">${state.overlays.queue.open ? 'Close Overlay' : 'Launch Overlay'}</button>
      </div>

      <div class="card">
        <div class="card-title">Live Preview</div>
        <div class="text-sm dashboard-copy">The overlay will show the current queue list and refresh automatically while it is open.</div>
      </div>
    </div>
  `;
}

function renderWinstreakTab() {
  const survivor = state.winstreak.survivor || {};
  const survivorMode = state.winstreak.mode === 'survivor';

  return `
    <div class="tab-panel" id="tab-winstreak">
      <div class="page-title">Winstreak Overlay</div>
      <div class="page-subtitle">Advanced streak board for killer or survivor runs with a clean built-in art block.</div>

      <div class="card compact-card">
        <div class="card-title">Streak Setup</div>
        <div class="form-row">
          <label>Streak type</label>
          <select id="winstreak-mode-tab">
            <option value="killer" ${!survivorMode ? 'selected' : ''}>Killer</option>
            <option value="survivor" ${survivorMode ? 'selected' : ''}>Survivor</option>
          </select>
        </div>

        ${survivorMode ? `
        <div class="text-sm" style="margin-bottom: 12px; color: #999;">Survivor mode uses a clean built-in emblem instead of a photo so the overlay stays simple and readable.</div>
        <div class="form-row">
          <label>Overlay style</label>
          <select id="winstreak-survivor-style-tab">
            <option value="minimal" ${state.winstreak.survivorStyle === 'minimal' ? 'selected' : ''}>Minimal (current)</option>
            <option value="compact" ${state.winstreak.survivorStyle === 'compact' ? 'selected' : ''}>Compact badge</option>
            <option value="glow" ${state.winstreak.survivorStyle === 'glow' ? 'selected' : ''}>Glow dot</option>
            <option value="ring" ${state.winstreak.survivorStyle === 'ring' ? 'selected' : ''}>Purple ring</option>
            <option value="progress" ${state.winstreak.survivorStyle === 'progress' ? 'selected' : ''}>Progress streak</option>
          </select>
        </div>
        <div class="grid-2">
          <div class="form-row">
            <label>Survivor wins</label>
            <input type="number" id="winstreak-survivor-games-won-tab" min="0" step="1" value="${survivor.gamesWon || 0}" />
          </div>
          <div class="form-row">
            <label>Personal best (PB)</label>
            <input type="text" id="winstreak-survivor-pb-tab" maxlength="16" value="${escapeHtml(survivor.pb || '')}" placeholder="e.g. 12" />
          </div>
        </div>
        <div class="grid-2">
          <div class="form-row">
            <label>World record (WR)</label>
            <input type="text" id="winstreak-survivor-wr-tab" maxlength="16" value="${escapeHtml(survivor.worldRecord || '')}" placeholder="e.g. 25" />
          </div>
          <div class="form-row">
            <label>2 survivors out</label>
            <input type="number" id="winstreak-survivor-two-out-tab" min="0" step="1" value="${survivor.twoOut || 0}" />
          </div>
        </div>
        ` : `
        <div class="grid-2">
          <div class="form-row">
            <label>Killer</label>
            <select id="winstreak-killer-tab">
              ${KILLERS.map(killer => `<option value="${escapeHtml(killer.name)}" ${state.winstreak.selectedKiller === killer.name ? 'selected' : ''}>${escapeHtml(killer.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <label>Win condition</label>
            <select id="winstreak-wincon-tab">
              ${['2k+', '3k+'].map(value => `<option value="${value}" ${state.winstreak.wincon === value ? 'selected' : ''}>${value}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <label>Overlay style</label>
          <select id="winstreak-style-tab">
            <option value="fire" ${state.winstreak.style === 'fire' ? 'selected' : ''}>Fire (animated)</option>
            <option value="dark" ${state.winstreak.style === 'dark' ? 'selected' : ''}>Dark (minimal)</option>
            <option value="ember" ${state.winstreak.style === 'ember' ? 'selected' : ''}>Ember (wide)</option>
          </select>
        </div>
        <div class="form-row">
          <label>Games won</label>
          <input type="number" id="winstreak-games-won-tab" min="0" step="1" value="${state.winstreak.gamesWon}" />
        </div>
        <div class="form-row">
          <label>Personal best (PB)</label>
          <input type="text" id="winstreak-pb-tab" maxlength="16" value="${escapeHtml(state.winstreak.pb || '')}" placeholder="e.g. 12" />
        </div>
        <div class="form-row">
          <label>World record (WR)</label>
          <input type="text" id="winstreak-wr-tab" maxlength="16" value="${escapeHtml(state.winstreak.worldRecord || '')}" placeholder="e.g. 25" />
        </div>
        `}
        <div class="grid-2">
          <button class="btn primary full" id="btn-winstreak-open-tab">${state.overlays.winstreak.open ? 'Close Winstreak' : 'Launch Winstreak'}</button>
          <button class="btn full" id="btn-winstreak-reset-tab">Reset Counter</button>
        </div>
        <div class="text-sm mt-8">Killer mode keeps the old setup. Survivor mode swaps to a clean emblem and the new out-count stats.</div>
      </div>

      <div class="card">
        <div class="card-title">Overlay</div>
        <div class="form-row">
          <label>Overlay Opacity</label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="range" id="winstreak-opacity" min="0" max="100" value="${state.overlays.winstreak.opacity}" style="flex: 1;" />
            <span id="winstreak-opacity-val" style="min-width: 35px; text-align: right;">${state.overlays.winstreak.opacity}%</span>
          </div>
        </div>
        <div class="form-row">
          <label>Background Transparency</label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="range" id="winstreak-bg-alpha" min="0" max="100" value="${Math.round(state.overlays.winstreak.backgroundAlpha * 100)}" style="flex: 1;" />
            <span id="winstreak-bg-alpha-val" style="min-width: 35px; text-align: right;">${Math.round(state.overlays.winstreak.backgroundAlpha * 100)}%</span>
          </div>
        </div>
        <div class="inline-switch-row">
          <span>Winstreak overlay enabled</span>
          <label class="toggle"><input type="checkbox" id="winstreak-enabled" ${state.overlays.winstreak.enabled ? 'checked' : ''}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Overlay locked</span>
          <label class="toggle"><input type="checkbox" id="winstreak-locked" ${state.overlays.winstreak.locked ? 'checked' : ''} ${state.overlays.winstreak.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Always on top</span>
          <label class="toggle"><input type="checkbox" id="winstreak-always-on-top" ${state.overlays.winstreak.alwaysOnTop ? 'checked' : ''} ${state.overlays.winstreak.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <div class="inline-switch-row">
          <span>Click-through</span>
          <label class="toggle"><input type="checkbox" id="winstreak-clickthrough" ${state.overlays.winstreak.clickthrough ? 'checked' : ''} ${state.overlays.winstreak.open ? '' : 'disabled'}><span class="toggle-track"></span></label>
        </div>
        <button class="btn primary full mt-12" id="btn-winstreak-open">${state.overlays.winstreak.open ? 'Close Overlay' : 'Launch Overlay'}</button>
      </div>

      <div class="card">
        <div class="card-title">Hotkeys</div>
        <div class="toggle-row hotkey-row">
          <div>
            <div class="toggle-label">Next killer</div>
            <div class="toggle-desc">Cycles through the Winstreak killer list</div>
          </div>
          <input type="text" readonly data-hotkey-setting="winstreakNextKiller" data-hotkey-tab="winstreak" value="${escapeHtml(getHotkey('winstreakNextKiller'))}" placeholder="Press a shortcut" />
        </div>
        <div class="toggle-row hotkey-row">
          <div>
            <div class="toggle-label">Toggle always on top</div>
            <div class="toggle-desc">Pins the Winstreak overlay above other windows</div>
          </div>
          <input type="text" readonly data-hotkey-setting="winstreakAlwaysOnTop" data-hotkey-tab="winstreak" value="${escapeHtml(getHotkey('winstreakAlwaysOnTop'))}" placeholder="Press a shortcut" />
        </div>
      </div>
    </div>
  `;
}

function renderStatsTab() {
  const survivor = state.winstreak.survivor || normalizeSurvivorWinstreakStatsEntry({});
  const killerEntries = Object.entries(state.winstreak.byKiller || {}).map(([name, stats]) => ({
    name,
    stats: stats || normalizeWinstreakStatsEntry({}),
  })).sort((a, b) => (b.stats.gamesWon || 0) - (a.stats.gamesWon || 0));
  const selectedKiller = state.winstreak.selectedKiller || 'Veil';
  const selectedKillerStats = state.winstreak.byKiller[selectedKiller] || normalizeWinstreakStatsEntry({});

  return `
    <div class="tab-panel" id="tab-stats">
      <div class="page-title">Stats</div>
      <div class="page-subtitle">Survivor and killer winstreak tracking with quick summaries and leaderboard-style history.</div>

      <div class="grid-2">
        <div class="card">
          <div class="card-title">Survivor Winstreaks</div>
          ${(survivor.gamesWon || survivor.pb || survivor.worldRecord || survivor.twoOut || survivor.threeOut || survivor.fourOut)
            ? ''
            : `<div class="empty-state"><div class="empty-state-title">No survivor stats yet</div><div>Start tracking wins in the Winstreak tab and your summary will appear here.</div></div>`}
          <div class="info-basic-grid">
            <div class="info-basic-item"><span>Games won</span><strong>${survivor.gamesWon || 0}</strong></div>
            <div class="info-basic-item"><span>PB</span><strong>${escapeHtml(survivor.pb || '0')}</strong></div>
            <div class="info-basic-item"><span>WR</span><strong>${escapeHtml(survivor.worldRecord || '0')}</strong></div>
            <div class="info-basic-item"><span>2 out</span><strong>${survivor.twoOut || 0}</strong></div>
            <div class="info-basic-item"><span>3 out</span><strong>${survivor.threeOut || 0}</strong></div>
            <div class="info-basic-item"><span>4 out</span><strong>${survivor.fourOut || 0}</strong></div>
          </div>
          <div class="text-sm dashboard-copy mt-12">This tab is driven by the same survivor streak data used in the main Winstreak tab.</div>
        </div>

        <div class="card">
          <div class="card-title">Killer Winstreaks</div>
          <div class="form-row">
            <label>Selected killer</label>
            <select id="stats-killer-select">
              ${KILLERS.map(killer => `<option value="${escapeHtml(killer.name)}" ${selectedKiller === killer.name ? 'selected' : ''}>${escapeHtml(killer.name)}</option>`).join('')}
            </select>
          </div>
          <div class="info-basic-grid">
            <div class="info-basic-item"><span>Games won</span><strong>${selectedKillerStats.gamesWon || 0}</strong></div>
            <div class="info-basic-item"><span>PB</span><strong>${escapeHtml(selectedKillerStats.pb || '0')}</strong></div>
            <div class="info-basic-item"><span>WR</span><strong>${escapeHtml(selectedKillerStats.worldRecord || '0')}</strong></div>
            <div class="info-basic-item"><span>Mode</span><strong>${escapeHtml(state.winstreak.mode || 'killer')}</strong></div>
          </div>
          ${killerEntries.length ? '' : '<div class="empty-state" style="margin-top:12px;"><div class="empty-state-title">No killer stats yet</div><div>Add your first killer wins in the Winstreak tab and they will appear here.</div></div>'}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Killer Winstreak Leaderboard</div>
        <div class="stats-table">
          <div class="stats-table-row stats-table-head"><span>Killer</span><span>Wins</span><span>PB</span><span>WR</span></div>
          ${killerEntries.length ? killerEntries.map(entry => `
            <div class="stats-table-row ${entry.name === selectedKiller ? 'is-selected' : ''}">
              <span>${escapeHtml(entry.name)}</span>
              <span>${entry.stats.gamesWon || 0}</span>
              <span>${escapeHtml(entry.stats.pb || '0')}</span>
              <span>${escapeHtml(entry.stats.worldRecord || '0')}</span>
            </div>
          `).join('') : '<div class="empty-state"><div class="empty-state-title">Leaderboard is empty</div><div>Save killer streak data to see it populate here.</div></div>'}
        </div>
      </div>
    </div>
  `;
}

function renderWinstreakBuildsTab() {
  const activeBuild = getActiveWinstreakBuild();
  const selectedKiller = getWinstreakBuildKiller();
  const selectedBalance = getSelectedWinstreakBalance() || createDefaultTournamentSets()[0];
  const buildRuleset = activeBuild ? getBuildRuleset(activeBuild) : null;
  const query = normalizeCatalogName(state.winstreakBuilds.searchQuery || '');
  const searchMode = state.winstreakBuilds.searchMode || 'all';
  const catalog = getWinstreakCatalog().filter(entry => {
    if (searchMode === 'perks' && entry.type !== 'perk') return false;
    if (searchMode === 'items' && entry.type !== 'item') return false;
    if (!query) return true;
    return normalizeCatalogName(entry.name).includes(query) || normalizeCatalogName(entry.summary || '').includes(query);
  });
  const perkCatalog = catalog.filter(entry => entry.type === 'perk');
  const itemCatalog = catalog.filter(entry => entry.type === 'item');
  const buildSummary = activeBuild ? `${activeBuild.perks.length} perks • ${activeBuild.items.length} items` : '0 perks • 0 items';
  const buildRows = state.winstreakBuilds.builds.map((slot, index) => renderWinstreakBuildRow(slot, index, activeBuild?.id)).join('');
  const lastUpdated = new Date().toLocaleString('en-US', { hour12: false });

  const renderEntryChips = (entries, type) => entries.map((entryName, index) => {
    const entryData = getWinstreakBuildEntryMeta(entryName, type);
    return `
      <button class="build-chip" type="button" data-build-remove="${type}" data-build-remove-index="${index}" data-build-id="${activeBuild?.id || 1}">
        <span>${escapeHtml(entryData.name || entryName)}</span>
        <span class="build-chip-remove">×</span>
      </button>
    `;
  }).join('');

  const renderCatalogCards = entries => entries.map(entry => `
    <button class="build-catalog-card" type="button" data-build-add="${entry.type}" data-build-name="${escapeHtml(entry.name)}" data-build-image="${escapeHtml(entry.image || '')}" data-build-summary="${escapeHtml(entry.summary || '')}">
      <div class="build-catalog-thumb" style="background-image:url('${escapeHtml(entry.image || '')}')"></div>
      <div class="build-catalog-copy">
        <div class="build-catalog-name">${escapeHtml(entry.name)}</div>
        <div class="build-catalog-summary">${escapeHtml(entry.summary || '')}</div>
      </div>
    </button>
  `).join('');

  return `
    <div class="tab-panel" id="tab-winstreak-builds">
      <div class="page-title">Winstreak Builds</div>
      <div class="page-subtitle">Build four survivor loadouts with duplicate perks or items, then export the full board as a tournament-ready image.</div>

      <div class="card build-hero">
        <div class="build-hero-copy">
          <div class="build-hero-label">Survivor Builds</div>
          <div class="build-hero-title">Selected Balance: <strong>${escapeHtml(selectedBalance?.name || 'DBDLeague')}</strong></div>
          <div class="build-hero-title">Selected Killer: <strong>${escapeHtml(selectedKiller.name)}</strong></div>
          <div class="build-hero-meta">Duplicate perks/items: <strong>${buildRuleset?.allowDuplicates ? 'Yes' : 'No'}</strong></div>
        </div>
        <div class="build-hero-selects">
          <div class="form-row">
            <label>Balance</label>
            <select id="build-balance-select">
              ${state.winstreakBuilds.tournamentSets.map(set => `<option value="${escapeHtml(set.id)}" ${state.winstreakBuilds.selectedBalanceId === set.id ? 'selected' : ''}>${escapeHtml(set.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <label>Killer</label>
            <select id="build-killer-select">
              ${KILLERS.map(killer => `<option value="${escapeHtml(killer.name)}" ${state.winstreakBuilds.selectedKiller === killer.name ? 'selected' : ''}>${escapeHtml(killer.name)}</option>`).join('')}
            </select>
          </div>
          <div class="build-hero-pill">Build time: ${escapeHtml(lastUpdated)}</div>
        </div>
      </div>

      <div class="card build-export-stage" id="winstreak-builds-export">
        <img class="build-export-killer" src="${escapeHtml(selectedKiller.image || '')}" alt="${escapeHtml(selectedKiller.name)}" />
        <div class="build-export-overlay"></div>
        <div class="build-export-topbar">
          <div>
            <div class="build-export-small">Selected Balance: <strong>${escapeHtml(selectedBalance?.name || 'DBDLeague')}</strong></div>
            <div class="build-export-small">Selected Killer: <strong>${escapeHtml(selectedKiller.name)}</strong></div>
          </div>
          <div class="build-export-small build-export-right">Image Date: ${escapeHtml(lastUpdated)} UTC<br/>Build valid at time of image generation</div>
        </div>
        <div class="build-export-board">
          ${buildRows}
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-title">Active Build</div>
          <div class="build-active-summary">${escapeHtml(activeBuild?.name || 'Build 1')} • ${buildSummary}</div>
          <div class="grid-2 mt-12">
            <div class="form-row">
              <label>Build name</label>
              <input type="text" id="build-name" value="${escapeHtml(activeBuild?.name || '')}" />
            </div>
            <div class="form-row">
              <label>Role</label>
              <select id="build-role">
                <option value="survivor" ${activeBuild?.role === 'survivor' ? 'selected' : ''}>Survivor</option>
                <option value="killer" ${activeBuild?.role === 'killer' ? 'selected' : ''}>Killer</option>
              </select>
            </div>
          </div>
          <div class="grid-2">
            <div class="form-row">
              <label>Ruleset</label>
              <select id="build-ruleset">
                ${state.winstreakBuilds.rulesets.map(ruleset => `<option value="${escapeHtml(ruleset.id)}" ${activeBuild?.rulesetId === ruleset.id ? 'selected' : ''}>${escapeHtml(ruleset.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-row">
              <label>Tournament set</label>
              <select id="build-tournament-set">
                ${state.winstreakBuilds.tournamentSets.map(set => `<option value="${escapeHtml(set.id)}" ${activeBuild?.tournamentSetId === set.id ? 'selected' : ''}>${escapeHtml(set.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <label>Notes</label>
            <textarea id="build-notes" rows="4" placeholder="Match notes, flex picks, tournament reminders">${escapeHtml(activeBuild?.notes || '')}</textarea>
          </div>
          <div class="grid-2 mt-12">
            <button class="btn primary" id="btn-build-export-json">Export JSON</button>
            <button class="btn" id="btn-build-import-json">Import JSON</button>
          </div>
          <div class="grid-2 mt-8">
            <button class="btn" id="btn-build-export-image">Export Image</button>
            <button class="btn" id="btn-build-save">Save Build</button>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Build Library</div>
          <div class="build-grid-4">${state.winstreakBuilds.builds.map(slot => `
            <button class="btn build-select-btn ${slot.id === activeBuild?.id ? 'active' : ''}" type="button" data-build-slot="${slot.id}">Build ${slot.id}</button>
          `).join('')}</div>
          <button class="btn mt-8" id="btn-clear-all-builds" style="color:var(--danger);">Clear all builds</button>
          <div class="grid-2 mt-12">
            <div class="form-row">
              <label>New ruleset name</label>
              <input type="text" id="custom-ruleset-name" placeholder="Tournament ruleset" />
            </div>
            <div class="form-row">
              <label>Perk slots</label>
              <input type="number" id="custom-ruleset-perks" min="0" max="8" value="3" />
            </div>
          </div>
          <div class="grid-2">
            <div class="form-row">
              <label>Item slots</label>
              <input type="number" id="custom-ruleset-items" min="0" max="8" value="2" />
            </div>
            <div class="form-row">
              <label>Allow duplicates</label>
              <select id="custom-ruleset-duplicates">
                <option value="true" ${buildRuleset?.allowDuplicates !== false ? 'selected' : ''}>Yes</option>
                <option value="false" ${buildRuleset?.allowDuplicates === false ? 'selected' : ''}>No</option>
              </select>
            </div>
          </div>
          <div class="grid-2 mt-8">
            <button class="btn" id="btn-save-custom-ruleset">Save Ruleset</button>
            <button class="btn" id="btn-export-rulesets">Export Rulesets</button>
          </div>
          <div class="grid-2 mt-8">
            <div class="form-row">
              <label>New tournament set</label>
              <input type="text" id="custom-set-name" placeholder="Tournament set" />
            </div>
            <div class="form-row">
              <label>Description</label>
              <input type="text" id="custom-set-description" placeholder="Rules for this tournament set" />
            </div>
          </div>
          <div class="grid-2 mt-8">
            <button class="btn" id="btn-save-custom-set">Save Tournament Set</button>
            <button class="btn" id="btn-export-tournament-sets">Export Sets</button>
          </div>
          <div class="grid-2 mt-8">
            <button class="btn" id="btn-import-rulesets">Import Rulesets</button>
            <button class="btn" id="btn-import-tournament-sets">Import Sets</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Search Catalog</div>
        <div class="grid-2">
          <div class="form-row">
            <label>Search</label>
            <input type="text" id="build-search" value="${escapeHtml(state.winstreakBuilds.searchQuery || '')}" placeholder="Search survivor perks or items" />
          </div>
          <div class="form-row">
            <label>Filter</label>
            <div class="build-filter-row">
              <button class="btn ${searchMode === 'perks' ? 'primary' : ''}" type="button" data-build-filter="perks">Perks</button>
              <button class="btn ${searchMode === 'items' ? 'primary' : ''}" type="button" data-build-filter="items">Items</button>
              <button class="btn ${searchMode === 'all' ? 'primary' : ''}" type="button" data-build-filter="all">All</button>
            </div>
          </div>
        </div>
        <div class="grid-2 mt-12">
          <div>
            <div class="card-title small">Perks</div>
            <div class="build-catalog-grid">${renderCatalogCards(perkCatalog)}</div>
          </div>
          <div>
            <div class="card-title small">Items</div>
            <div class="build-catalog-grid">${renderCatalogCards(itemCatalog)}</div>
          </div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-title">Selected Perks</div>
          <div class="build-chip-row">${renderEntryChips(activeBuild?.perks || [], 'perk') || '<div class="empty-state"><div class="empty-state-title">No perks selected yet</div><div>Choose perks from the catalog on the right to build this loadout.</div></div>'}</div>
        </div>
        <div class="card">
          <div class="card-title">Selected Items</div>
          <div class="build-chip-row">${renderEntryChips(activeBuild?.items || [], 'item') || '<div class="empty-state"><div class="empty-state-title">No items selected yet</div><div>Pick one or more items from the catalog for this build.</div></div>'}</div>
        </div>
      </div>
    </div>
  `;
}

function renderSettingsTab() {
  return `
    <div class="tab-panel" id="tab-settings">
      <div class="page-title">Settings</div>
      <div class="page-subtitle">Preferences, licensing, diagnostics, and application updates.</div>

      <div class="card settings-hero-card">
        <div class="settings-hero-copy">
          <div class="card-title">About</div>
          <div class="text-sm dashboard-copy"></div>
        </div>
        <div class="settings-hero-grid">
          <div class="settings-stat"><span class="settings-stat-label">Version</span><span id="settings-version" class="settings-stat-value">${store.get('app.version', null) || '1.0.0'}</span></div>
          <div class="settings-stat"><span class="settings-stat-label">Install ID</span><span id="settings-install-id" class="settings-stat-value mono">${getInstallId()}</span></div>
          <div class="settings-stat"><span class="settings-stat-label">Update state</span><span id="settings-update-state" class="settings-stat-value">${getUpdateSummaryText()}</span></div>
        </div>
        <div class="settings-hero-actions">
          <button class="btn primary" id="btn-copy-debug-info">Copy debug info</button>
        </div>
        <div id="settings-debug-status" class="settings-status-line muted"></div>
      </div>

      <div class="card">
        <div class="card-title">Import / Export</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <button class="btn primary" id="btn-export-settings">Export Settings</button>
          <button class="btn" id="btn-import-settings">Import Settings</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Change Notes</div>
        <div id="release-notes-feed" class="settings-release-feed">
          <div class="empty-state">
            <div class="empty-state-title">Loading release notes</div>
            <div>Fetching the latest releases from GitHub.</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Application Updates</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <div class="text-sm" id="update-status" style="color:#d8dde6;">Idle</div>
          <div id="update-spinner" class="update-spinner" aria-hidden="true" style="display:none;width:18px;height:18px"></div>
        </div>
        <div style="margin-top:8px;">
          <div class="progress" id="update-progress" style="height:10px;background:rgba(255,255,255,0.04);border-radius:6px;overflow:hidden;">
            <div id="update-progress-bar" style="width:0%;height:100%;background:var(--accent);"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="btn sm primary" id="btn-check-updates">Check for updates</button>
            <button class="btn sm" id="btn-install-update" disabled>Install update</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindSettingsTab() {
  const statusEl = document.getElementById('update-status');
  const progressBar = document.getElementById('update-progress-bar');
  const spinnerEl = document.getElementById('update-spinner');
  const checkBtn = document.getElementById('btn-check-updates');
  const installBtn = document.getElementById('btn-install-update');

  refreshSettingsDiagnostics();
  loadReleaseNotesFeed();

  document.getElementById('btn-check-updates')?.addEventListener('click', async () => {
    if (statusEl) statusEl.textContent = 'Checking for updates...';
    if (spinnerEl) { spinnerEl.style.display = 'block'; spinnerEl.classList.add('spinning'); }
    if (checkBtn) checkBtn.disabled = true;
    if (installBtn) installBtn.disabled = true;
    try {
      await ipcRenderer.invoke('check-for-updates');
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Update check failed';
      if (checkBtn) checkBtn.disabled = false;
    }
  });

  document.getElementById('btn-install-update')?.addEventListener('click', async () => {
    if (statusEl) statusEl.textContent = 'Installing update...';
    // user clicked install — clean up UI (spinner/check) before install occurs
    try {
      if (spinnerEl) { spinnerEl.classList.remove('show-check'); spinnerEl.classList.remove('success'); spinnerEl.style.display = 'none'; }
      if (progressBar) { progressBar.classList.remove('complete'); progressBar.style.width = '0%'; }
      if (installBtn) installBtn.disabled = true;
      await ipcRenderer.invoke('install-update');
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Install failed';
      if (checkBtn) checkBtn.disabled = false;
      if (spinnerEl) spinnerEl.style.display = 'none';
    }
  });

  ipcRenderer.on('update-checking', () => {
    if (statusEl) statusEl.textContent = 'Checking for updates...';
    if (spinnerEl) { spinnerEl.style.display = 'block'; spinnerEl.classList.add('spinning'); }
    if (progressBar) progressBar.style.width = '0%';
    if (installBtn) installBtn.disabled = true;
  });

  ipcRenderer.on('update-available', (event, info) => {
    if (statusEl) statusEl.textContent = `Update available: ${info.version || ''}`;
    if (checkBtn) checkBtn.disabled = true;
    if (installBtn) installBtn.disabled = false;
  });

  ipcRenderer.on('update-download-progress', (event, data) => {
    const percent = Math.round(data.percent || 0);
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (statusEl) statusEl.textContent = `Downloading: ${(data.transferred/1024/1024).toFixed(2)} MB / ${(data.total/1024/1024).toFixed(2)} MB (${percent}%)`;
    if (spinnerEl) { spinnerEl.style.display = 'block'; spinnerEl.classList.add('spinning'); }
  });

  ipcRenderer.on('update-downloaded', (event, info) => {
    if (statusEl) statusEl.textContent = `Downloaded ${info.version || ''}. Ready to install.`;
    if (installBtn) installBtn.disabled = false;
    if (checkBtn) checkBtn.disabled = false;
    if (progressBar) {
      progressBar.style.width = '100%';
      progressBar.classList.add('complete');
    }
    if (spinnerEl) {
      // morph spinner into success check and keep visible until user installs
      spinnerEl.classList.remove('spinning');
      spinnerEl.classList.add('success');
      // show check after a short delay for a smooth transition
      setTimeout(() => spinnerEl.classList.add('show-check'), 140);
      // do not auto-hide; leave the success visible until the user clicks Install
    }
  });

  ipcRenderer.on('update-error', (event, err) => {
    if (statusEl) statusEl.textContent = `Update error: ${err?.message || err}`;
    if (checkBtn) checkBtn.disabled = false;
    if (spinnerEl) { spinnerEl.classList.remove('spinning'); spinnerEl.style.display = 'none'; }
  });

}

// Post-update setup modal bindings
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btn-launch-setup') {
    const wizard = document.getElementById('setup-wizard');
    if (wizard) wizard.style.display = 'block';
  }
  if (e.target && e.target.id === 'setup-next-1') {
    document.getElementById('setup-step-1').style.display = 'none';
    document.getElementById('setup-step-2').style.display = '';
  }
  if (e.target && e.target.id === 'setup-back-2') {
    document.getElementById('setup-step-2').style.display = 'none';
    document.getElementById('setup-step-1').style.display = '';
  }
  if (e.target && e.target.id === 'setup-next-2') {
    document.getElementById('setup-step-2').style.display = 'none';
    document.getElementById('setup-step-3').style.display = '';
  }
  if (e.target && e.target.id === 'setup-back-3') {
    document.getElementById('setup-step-3').style.display = 'none';
    document.getElementById('setup-step-2').style.display = '';
  }
  if (e.target && e.target.id === 'setup-finish') {
    const enableFour = document.getElementById('setup-enable-fourvone').checked;
    const enableWin = document.getElementById('setup-enable-winstreak').checked;
    const enableLadder = document.getElementById('setup-enable-ladder').checked;
    // persist choices
    try { store.set('setup.pendingOverlays', { fourvone: enableFour, winstreak: enableWin, ladder: enableLadder }); } catch (e) {}
    // close wizard and open overlay configuration tab
    const wizard = document.getElementById('setup-wizard'); if (wizard) wizard.style.display = 'none';
    activateTab('fourvone');
  }
  if (e.target && e.target.id === 'setup-close') {
    const wizard = document.getElementById('setup-wizard'); if (wizard) wizard.style.display = 'none';
  }
});

function renderBgTab() {
  return `
    <div class="tab-panel" id="tab-backgrounds">
      <div class="page-title">Backgrounds</div>
      <div class="page-subtitle">Visual and audio background controls.</div>

      <div class="card">
        <div class="card-title">Theme Presets</div>
        <div class="grid-2">
          <button class="btn primary" id="btn-theme-dark">Dark Only</button>
        </div>
        <div class="text-sm mt-8">The app now runs in dark mode only.</div>
      </div>

      <div class="card">
        <div class="card-title">Visual Background</div>
        <div class="form-row">
          <label>Image / Video Path</label>
          <input type="text" id="bg-visual-src" value="${escapeHtml(state.bg.visualSrc)}" placeholder="C:/path/to/background.png" />
        </div>
        <div class="grid-2">
          <button class="btn sm primary" id="btn-bg-visual-apply">Apply Visual</button>
          <button class="btn sm" id="btn-bg-visual-browse">Browse PC</button>
        </div>
        <div id="bg-preview" class="bg-preview">
          <!-- Preview of current visual background will appear here -->
        </div>
        <input type="file" id="bg-visual-file" class="hidden-file-input" accept="image/*,video/*" />
      </div>

        <div class="card">
          <div class="card-title">UI Scale & Preview</div>
          <div class="form-row">
            <label>UI Scale</label>
            <div style="display:flex;align-items:center;gap:12px">
              <input type="range" id="ui-scale-slider" min="75" max="150" step="5" value="${Math.round((Number(store.get('ui.scale', 1)) || 1) * 100)}" />
              <div id="ui-scale-val" style="min-width:56px;text-align:left">${(Number(store.get('ui.scale',1))||1).toFixed(2)}x</div>
              <button class="btn sm" id="btn-ui-scale-reset">Reset</button>
            </div>
          </div>
          <div class="inline-switch-row mt-8">
            <span>Preview safe-zone grid</span>
            <label class="toggle"><input type="checkbox" id="ui-preview-mode" ${document.body.classList.contains('preview-mode') ? 'checked' : ''}><span class="toggle-track"></span></label>
          </div>
        </div>

      <div class="card">
        <div class="card-title">Audio Background</div>
        <div class="inline-switch-row">
          <span>Background audio</span>
          <label class="toggle"><input type="checkbox" id="audio-toggle" ${state.bg.audioEnabled ? 'checked' : ''}><span class="toggle-track"></span></label>
        </div>
        <div class="form-row mt-12">
          <label>Audio File Path</label>
          <input type="text" id="bg-audio-src" value="${escapeHtml(state.bg.audioSrc)}" placeholder="C:/path/to/audio.mp3" />
        </div>
        <div class="inline-switch-row">
          <span>Volume</span>
          <div class="audio-vol">
            <input type="range" id="audio-volume" min="0" max="100" value="${state.bg.audioVolume}" />
            <span class="vol-value" id="vol-display">${state.bg.audioVolume}%</span>
          </div>
        </div>
        <div class="grid-2">
          <button class="btn sm primary mt-12" id="btn-bg-audio-apply">Apply Audio</button>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn sm mt-12" id="btn-bg-audio-browse">Browse PC</button>
            <button class="btn sm mt-12" id="btn-bg-audio-play">Play</button>
          </div>
        </div>
        <input type="file" id="bg-audio-file" class="hidden-file-input" accept="audio/*" />
      </div>

      

      <div class="card">
        <div class="card-title">Integrations</div>
        <div class="text-sm">OBS and Roblox integration controls have been removed.</div>
      </div>
    </div>
  `;
}

function renderFontsTab() {
  const cards = FONTS.map(font => `
    <div class="font-preview-card ${state.selectedFont === font.name ? 'selected' : ''}" data-font="${font.name}">
      <div class="font-preview-sample" style="font-family:'${font.name}'">${font.sample}</div>
      <div class="font-preview-name">${font.name}</div>
    </div>
  `).join('');

  return `
    <div class="tab-panel" id="tab-fonts">
      <div class="page-title">Font System</div>
      <div class="page-subtitle">Choose the face used by the overlays.</div>
      <div class="card">
        <div class="card-title">Select Overlay Font</div>
        <div class="grid-3">${cards}</div>
        <div class="mt-16 text-sm">Selected: <span style="font-family:'${state.selectedFont}'">${state.selectedFont}</span></div>
      </div>
    </div>
  `;
}

function renderCreditsTab() {
  return `
    <div class="tab-panel" id="tab-credits">
      <div class="page-title">Credits</div>
      <div class="page-subtitle">Acknowledgements & thanks.</div>

      <div class="card credits-hero">
        <div class="credits-hero-inner">
          <h3 class="credits-title">VD OverlayTools</h3>
          <p class="credits-lead">has gone through countless redesigns, reworks, improvements, and refinements to become what it is today.</p>
          <div class="credits-body">
            <p>Every feature, overlay, animation, and quality-of-life update was built with the goal of creating the best possible experience for competitive players.</p>
            <p>This project would not be where it is without the incredible support, feedback, patience, and ideas from the community. Thank you to everyone who tested features, reported issues, shared suggestions, and continued supporting the project throughout its development.</p>
            <p>A special thank you to my beautiful girlfriend for the constant motivation, support, and encouragement during every stage of development. Your belief in me helped push this project further than I ever imagined.</p>
            <p>VD OverlayTools was built with passion, dedication, and the support of an amazing community. ❤️</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderGameInfoTab() {
  const itemCards = GAME_INFO_ITEMS.map(item => `
    <article class="info-media-card">
      <button class="info-media-thumb info-media-thumb-button" type="button" data-item-preview="${escapeHtml(item.name)}" aria-label="Open ${escapeHtml(item.name)} item details" style="background-image:url('${item.image}')"></button>
      <div class="info-media-copy">
        <div class="info-media-title">${escapeHtml(item.name)}</div>
        <div class="info-media-text">${escapeHtml(item.summary)}</div>
        <div class="info-media-detail">${escapeHtml(item.detail)}</div>
      </div>
    </article>
  `).join('');

  const perkFamilyCards = GAME_INFO_SURVIVOR_PERK_FAMILIES.map(family => `
    <article class="info-mini-card">
      <div class="info-mini-title">${escapeHtml(family.name)}</div>
      <div class="info-mini-text">${escapeHtml(family.detail)}</div>
    </article>
  `).join('');

  const killerCards = GAME_INFO_KILLERS.map(killer => `
    <article class="info-killer-card">
      <div class="info-killer-image" style="background-image:url('${killer.image}')"></div>
      <div class="info-killer-body">
        <div class="info-killer-title">${escapeHtml(killer.name)}</div>
        <div class="info-killer-summary">${escapeHtml(killer.summary)}</div>
        <div class="info-killer-subtitle">Leveling Perks</div>
        <div class="pill-list">
          ${killer.perks.map(perk => `<span class="pill">${escapeHtml(perk.name)}</span>`).join('')}
        </div>
        <div class="info-killer-counter">Counter: ${escapeHtml(killer.counter)}</div>
      </div>
    </article>
  `).join('');

  const counterCards = GAME_INFO_COUNTERS.map(counter => `
    <article class="info-mini-card">
      <div class="info-mini-title">${escapeHtml(counter.title)}</div>
      <div class="info-mini-text">${escapeHtml(counter.detail)}</div>
    </article>
  `).join('');

  return `
    <div class="tab-panel" id="tab-game-info">
      <div class="game-info-hero card">
        <div class="game-info-hero-copy">
          <div class="info-kicker">Game Info</div>
          <div class="page-title">Unofficial Violence District Wiki</div>
          <div class="page-subtitle">A competitive asymmetrical survival game where survivors use items, perks, and map knowledge to outplay killers.</div>
          <div class="text-sm dashboard-copy">This section pulls from the public Trello wiki and highlights the core systems, the most useful items, killer kits, and common counterplay.</div>
        </div>
        <div class="game-info-hero-image" style="background-image:url('https://trello.com/1/cards/699e2519a7ede6f29c24e9aa/attachments/699e256e52d803a1db7eb2e9/download/Motion%2BTracker.png')"></div>
      </div>

      <div class="card">
        <div class="card-title">Basic Information</div>
        <div class="info-basic-grid">
          ${GAME_INFO_BASIC.map(item => `
            <div class="info-basic-item">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-title">What The Game Is</div>
        <div class="info-intro-grid">
          <div class="info-mini-card info-intro-card">
            <div class="info-mini-title">Overview</div>
            <div class="info-mini-text">Survivors manage pressure with movement, healing, information, and clutch tools while killers use unique powers to force mistakes and secure downs.</div>
          </div>
          <div class="info-mini-card info-intro-card">
            <div class="info-mini-title">Core Loop</div>
            <div class="info-mini-text">Learn the map, read the killer, spend items well, and keep your team alive long enough to escape or win the round.</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Items</div>
        <div class="info-media-grid">${itemCards}</div>
      </div>

      <div class="card">
        <div class="card-title">Survivor Perks</div>
        <div class="info-intro-grid">${perkFamilyCards}</div>
      </div>

      <div class="card">
        <div class="card-title">Killer Perks And Kits</div>
        <div class="info-killer-grid">${killerCards}</div>
      </div>

      <div class="card">
        <div class="card-title">Counters</div>
        <div class="info-intro-grid">${counterCards}</div>
      </div>
    </div>
  `;
}

function renderGameInfoKillersTab() {
  const killerCards = GAME_INFO_KILLERS.map(killer => `
    <article class="info-killer-card">
      <div class="info-killer-image" style="background-image:url('${killer.image}')"></div>
      <div class="info-killer-body">
        <div class="info-killer-title">${escapeHtml(killer.name)}</div>
        <div class="info-killer-summary">${escapeHtml(killer.summary)}</div>
        <div class="info-killer-counter">Counter: ${escapeHtml(killer.counter)}</div>
      </div>
    </article>
  `).join('');

  return `
    <div class="tab-panel" id="tab-game-info-killers">
      <div class="card game-info-hero">
        <div class="game-info-hero-copy">
          <div class="info-kicker">Game Info / Killers</div>
          <div class="page-title">Killers</div>
          <div class="page-subtitle">Core killer kits, play patterns, and the easiest way to think about each one.</div>
        </div>
        <div class="game-info-hero-image" style="background-image:url('${GAME_INFO_KILLERS[0].image}')"></div>
      </div>

      <div class="card">
        <div class="card-title">Killer Roster</div>
        <div class="info-killer-grid">${killerCards}</div>
      </div>
    </div>
  `;
}

function renderGameInfoKillerPerksTab() {
  const killerSections = GAME_INFO_KILLERS.map(killer => `
    <article class="info-killer-section">
      <div class="info-killer-section-media" style="background-image:url('${killer.image}')"></div>
      <div class="info-killer-section-body">
        <div class="info-killer-title">${escapeHtml(killer.name)}</div>
        <div class="info-killer-summary">${escapeHtml(killer.summary)}</div>
        <div class="info-killer-subtitle">Perks</div>
        <div class="info-perk-stack">
          ${killer.perks.map(perk => `
            <div class="info-perk-row">
              <div class="info-perk-icon">${getPerkIconHtml(perk)}</div>
              <div class="info-perk-copy">
                <div class="info-perk-name">${escapeHtml(perk.name)}</div>
                <div class="info-perk-summary">${escapeHtml(perk.summary)}</div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="info-killer-counter">Counter: ${escapeHtml(killer.counter)}</div>
      </div>
    </article>
  `).join('');

  return `
    <div class="tab-panel" id="tab-game-info-killer-perks">
      <div class="card game-info-hero">
        <div class="game-info-hero-copy">
          <div class="info-kicker">Game Info / Killers / Perks</div>
          <div class="page-title">Perks</div>
          <div class="page-subtitle">Every killer gets their own spot, with perk explanations and visual anchors from the wiki.</div>
        </div>
        <div class="game-info-hero-image" style="background-image:url('${GAME_INFO_KILLERS[0].image}')"></div>
      </div>

      <div class="card">
        <div class="card-title">Killer Sections</div>
        <div class="info-killer-section-grid">${killerSections}</div>
      </div>
    </div>
  `;
}

function renderGameInfoSurvivorsTab() {
  const itemCards = GAME_INFO_ITEMS.slice(0, 4).map(item => `
    <article class="info-media-card">
      <button class="info-media-thumb info-media-thumb-button" type="button" data-item-preview="${escapeHtml(item.name)}" aria-label="Open ${escapeHtml(item.name)} item details" style="background-image:url('${item.image}')"></button>
      <div class="info-media-copy">
        <div class="info-media-title">${escapeHtml(item.name)}</div>
        <div class="info-media-text">${escapeHtml(item.summary)}</div>
      </div>
    </article>
  `).join('');

  const renderPerkCategory = (title, perks) => `
    <div class="card">
      <div class="card-title">${escapeHtml(title)}</div>
      <div class="info-perk-grid">
        ${perks.map(perk => `
          <div class="perk-card">
            <div class="perk-icon">${getPerkIconHtml(perk)}</div>
            <div class="perk-copy">
              <div class="perk-name">${escapeHtml(perk.name)}</div>
              <div class="perk-summary">${escapeHtml(perk.summary)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  return `
    <div class="tab-panel" id="tab-game-info-survivors">
      <div class="card game-info-hero">
        <div class="game-info-hero-copy">
          <div class="info-kicker">Game Info / Survivors</div>
          <div class="page-title">Survivors</div>
          <div class="page-subtitle">Pulled from the Unofficial Violence District wiki categories for survivor play.</div>
        </div>
        <div class="game-info-hero-image" style="background-image:url('https://trello.com/1/cards/699e2519a7ede6f29c24e9aa/attachments/699e256e52d803a1db7eb2e9/download/Motion%2BTracker.png')"></div>
      </div>

      <div class="card">
        <div class="card-title">Basic Information</div>
        <div class="info-basic-grid">
          ${GAME_INFO_BASIC.map(item => `
            <div class="info-basic-item">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Survivor Items</div>
        <div class="info-media-grid">${itemCards}</div>
      </div>

      ${renderPerkCategory('Aura / Info Perks', GAME_INFO_SURVIVOR_PERKS.aura)}
      ${renderPerkCategory('Speed Perks', GAME_INFO_SURVIVOR_PERKS.speed)}
      ${renderPerkCategory('Chase Perks', GAME_INFO_SURVIVOR_PERKS.chase)}
      ${renderPerkCategory('Healing Perks', GAME_INFO_SURVIVOR_PERKS.healing)}
      ${renderPerkCategory('Other Utility Perks', GAME_INFO_SURVIVOR_PERKS.other)}
    </div>
  `;
}

function renderGameInfoSurvivorPerksTab() {
  const familyCards = GAME_INFO_SURVIVOR_PERK_FAMILIES.map(family => `
    <article class="info-mini-card">
      <div class="info-mini-title">${escapeHtml(family.name)}</div>
      <div class="info-mini-text">${escapeHtml(family.detail)}</div>
    </article>
  `).join('');

  const renderPerkCategory = (title, perks) => `
    <div class="card">
      <div class="card-title">${escapeHtml(title)}</div>
      <div class="info-perk-grid">
        ${perks.map(perk => `
          <div class="perk-card">
            <div class="perk-icon">${getPerkIconHtml(perk)}</div>
            <div class="perk-copy">
              <div class="perk-name">${escapeHtml(perk.name)}</div>
              <div class="perk-summary">${escapeHtml(perk.summary)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  return `
    <div class="tab-panel" id="tab-game-info-survivor-perks">
      <div class="card game-info-hero">
        <div class="game-info-hero-copy">
          <div class="info-kicker">Game Info / Survivors / Perks</div>
          <div class="page-title">Survivor Perks</div>
          <div class="page-subtitle">Category view from the wiki: Aura, Speed, Chase, Healing, and Other perks.</div>
        </div>
        <div class="game-info-hero-image" style="background-image:url('https://trello.com/1/cards/699e253218e9c1cfbd162c02/attachments/699e257aa48b966c9609da45/download/Flashlight.png')"></div>
      </div>

      <div class="card">
        <div class="card-title">Perk Families</div>
        <div class="info-intro-grid">${familyCards}</div>
      </div>

      ${renderPerkCategory('Aura Perks', GAME_INFO_SURVIVOR_PERKS.aura)}
      ${renderPerkCategory('Speed Perks', GAME_INFO_SURVIVOR_PERKS.speed)}
      ${renderPerkCategory('Chase Perks', GAME_INFO_SURVIVOR_PERKS.chase)}
      ${renderPerkCategory('Healing Perks', GAME_INFO_SURVIVOR_PERKS.healing)}
      ${renderPerkCategory('Other Perks', GAME_INFO_SURVIVOR_PERKS.other)}
    </div>
  `;
}

function renderGameInfoMapsTab() {
  const mapCards = state.maps.list.length
    ? state.maps.list.map(map => `
      <article class="info-media-card">
        <div class="info-media-thumb" style="background-image:url('${toFileUrl(map.image)}')"></div>
        <div class="info-media-copy">
          <div class="info-media-title">${escapeHtml(map.name)}</div>
        </div>
      </article>
    `).join('')
    : '<div class="text-sm">No map images were found in assets/maps.</div>';

  return `
    <div class="tab-panel" id="tab-game-info-maps">
      <div class="card game-info-hero">
        <div class="game-info-hero-copy">
          <div class="info-kicker">Game Info / Maps</div>
          <div class="page-title">Map Starts</div>
          <div class="page-subtitle">Where the action happens, with the currently available map pool shown below.</div>
        </div>
        <div class="game-info-hero-image" style="background-image:url('${state.maps.list[0] ? toFileUrl(state.maps.list[0].image) : 'https://trello.com/1/cards/699e2519a7ede6f29c24e9aa/attachments/699e256e52d803a1db7eb2e9/download/Motion%2BTracker.png'}')"></div>
      </div>

      <div class="card">
        <div class="card-title">Available Maps</div>
        <div class="info-media-grid">${mapCards}</div>
      </div>
    </div>
  `;
}



const ONEVONE_STARTS_DIR = path.join(__dirname, '../../assets/1v1 starts');

const ONEVONE_START_IMAGE_ALIASES = {
  cabin: ['Cabin1.png', 'Cabin2.png'],
  'woodview cabin': ['Cabin1.png', 'Cabin2.png'],
  woodviewcabin: ['Cabin1.png', 'Cabin2.png'],
  'bay harbor': ['Bay Harbor1.png', 'Bay Harbor2.png'],
  bayharbor: ['Bay Harbor1.png', 'Bay Harbor2.png'],
  village: ['Village1.png', 'Village2.png'],
  mercy: ['Mercy1.png', 'Mercy2.png'],
  'mercy hospital': ['Mercy1.png', 'Mercy2.png'],
  mercyhospital: ['Mercy1.png', 'Mercy2.png'],
};

const ONEVONE_START_MATCHERS = [
  { key: 'cabin', terms: ['cabin', 'woodview cabin', 'woodviewcabin', 'woodview'] },
  { key: 'bay harbor', terms: ['bay harbor', 'bayharbor'] },
  { key: 'village', terms: ['village'] },
  { key: 'mercy', terms: ['mercy', 'mercy hospital', 'mercyhospital'] },
];

function normalizeMapStartKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\d+$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function get1v1StartMapKey(map) {
  if (!map) return null;

  const candidates = [
    normalizeMapStartKey(map.name),
    normalizeMapStartKey(path.parse(map.filename || '').name),
  ];

  for (const matcher of ONEVONE_START_MATCHERS) {
    if (candidates.some(candidate => matcher.terms.some(term => candidate.includes(term) || term.includes(candidate)))) {
      return matcher.key;
    }
  }

  return null;
}

function get1v1MapStartImages(map) {
  const startKey = get1v1StartMapKey(map);
  if (!startKey) return [];

  const aliases = ONEVONE_START_IMAGE_ALIASES[startKey] || [];

  return aliases
    .map(fileName => path.join(ONEVONE_STARTS_DIR, fileName))
    .filter(filePath => fs.existsSync(filePath));
}

function renderGameInfo1v1MapStartsTab() {
  const mapList = state.maps.list.filter(map => Boolean(get1v1StartMapKey(map)));
  const selectedIndex = mapList.length ? Math.max(0, Math.min(state.gameInfo1v1MapStarts.selectedIndex || 0, mapList.length - 1)) : 0;
  const selectedMap = mapList[selectedIndex] || null;
  const selectedImages = get1v1MapStartImages(selectedMap);

  const selectorCards = mapList.length
    ? mapList.map((map, index) => {
        const isActive = index === selectedIndex;
        const images = get1v1MapStartImages(map);
        const thumb = images[0] || '';
        const startKey = get1v1StartMapKey(map);

        return `
          <button class="map-start-selector-card ${isActive ? 'active' : ''}" type="button" data-1v1-start-select="${index}">
            <div class="map-start-selector-thumb ${thumb ? 'has-image' : 'empty'}" ${thumb ? `style="background-image:url('${toFileUrl(thumb)}')"` : ''}></div>
            <div class="map-start-selector-copy">
              <div class="map-start-selector-title">${escapeHtml(map.name)}</div>
              <div class="map-start-selector-subtitle">${escapeHtml(startKey ? `${startKey.toUpperCase()} start set` : 'Start set')}</div>
            </div>
          </button>
        `;
      }).join('')
    : '<div class="text-sm">No maps were found in assets/maps yet.</div>';

  const previewShots = selectedMap && selectedImages.length
    ? selectedImages.map((imagePath, index) => `
         <div class="map-start-preview-shot ${index === 0 ? 'primary' : 'secondary'}" style="background-image:url('${toFileUrl(imagePath)}')" data-map-preview-image="${toFileUrl(imagePath)}" role="button" tabindex="0"></div>
      `).join('')
    : '';

  return `
    <div class="tab-panel" id="tab-game-info-1v1-map-starts">
      <div class="card game-info-hero">
        <div class="game-info-hero-copy">
          <div class="info-kicker">Game Info / 1v1 Map Starts</div>
          <div class="page-title">1v1 Map Starts</div>
          <div class="page-subtitle">Use this as reference as where to start on maps for 1v1s.</div>
        </div>
        <div class="game-info-hero-image" style="background-image:url('${selectedImages[0] ? toFileUrl(selectedImages[0]) : selectedMap ? toFileUrl(selectedMap.image) : 'https://trello.com/1/cards/699e2519a7ede6f29c24e9aa/attachments/699e256e52d803a1db7eb2e9/download/Motion%2BTracker.png'}')"></div>
      </div>

      <div class="card">
        <div class="card-title">Choose a Map</div>
        <div class="map-start-selector-grid">${selectorCards}</div>
      </div>

      ${selectedMap ? `
      <div class="card map-start-focus-card">
        <div class="map-start-focus-header">
          <div>
            <div class="card-title">${escapeHtml(selectedMap.name)}</div>
            <div class="text-sm">Opening positions for the selected map.</div>
          </div>
        </div>
        <div class="map-start-preview-shell ${selectedImages.length === 1 ? 'single' : ''}">
          ${previewShots || '<div class="map-start-empty-state">No start images found for this map yet.</div>'}
        </div>
      </div>
      ` : ''}
    </div>
  `;
}

function bindGameInfo1v1MapStartsTab() {
  document.querySelectorAll('[data-1v1-start-select]').forEach(button => {
    button.addEventListener('click', () => {
      const nextIndex = Number(button.dataset['1v1StartSelect']);
      if (Number.isNaN(nextIndex)) return;
      state.gameInfo1v1MapStarts.selectedIndex = nextIndex;
      store.set('gameInfo1v1MapStarts.selectedIndex', nextIndex);
      reRenderTab('game-info-1v1-map-starts');
    });
  });

    // Add click handlers for preview image zooming
    document.querySelectorAll('[data-map-preview-image]').forEach(shot => {
      shot.addEventListener('click', () => {
        const imagePath = shot.dataset.mapPreviewImage;
        if (imagePath) showMapPreviewModal(imagePath);
      });
      shot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const imagePath = shot.dataset.mapPreviewImage;
          if (imagePath) showMapPreviewModal(imagePath);
        }
      });
    });
}

function render1v1HotkeysTab() {
  const hotkeys = [
    { key: getHotkey('onevoneStart') || 'Unassigned', action: 'Start Player 1 Stopwatch' },
    { key: getHotkey('onevoneSwitchTimer') || 'Unassigned', action: 'Swap to Other Stopwatch' },
    { key: getHotkey('onevonePause') || 'Unassigned', action: 'Pause Active Stopwatch' },
    { key: getHotkey('onevoneTimer') || 'Unassigned', action: 'Toggle Active Stopwatch' },
  ];

  return `
    <div class="tab-panel" id="tab-hotkeys-1v1">
      <div class="page-title">1v1 Hotkeys</div>
      <div class="page-subtitle">Shortcuts for the dual stopwatch overlay.</div>
      <div class="card">
        ${hotkeys.map(item => `
          <div class="toggle-row hotkey-row">
            <div>
              <div class="toggle-label">${item.action}</div>
              <div class="toggle-desc">1v1-only shortcut</div>
            </div>
            <span class="hotkey-tag">${item.key}</span>
          </div>
        `).join('')}
      </div>
      <div class="card">
        <div class="card-title">Notes</div>
        <div class="text-sm dashboard-copy">Start Player 1, swap to Player 2 when the handoff happens, and pause the active stopwatch if needed.</div>
      </div>
    </div>
  `;
}

function renderMapsHotkeysTab() {
  const hotkeys = [
    { key: getHotkey('mapsNext') || 'Unassigned', action: 'Next map' },
    { key: getHotkey('mapsPrevious') || 'Unassigned', action: 'Previous map' },
    { key: getHotkey('mapsAlwaysOnTop') || 'Unassigned', action: 'Toggle always on top' },
  ];

  return `
    <div class="tab-panel" id="tab-hotkeys-maps">
      <div class="page-title">Map Hotkeys</div>
      <div class="page-subtitle">Shortcuts for the map overlay.</div>
      <div class="card">
        ${hotkeys.map(item => `
          <div class="toggle-row hotkey-row">
            <div>
              <div class="toggle-label">${item.action}</div>
              <div class="toggle-desc">Map-only shortcut</div>
            </div>
            <span class="hotkey-tag">${item.key}</span>
          </div>
        `).join('')}
      </div>
      <div class="card">
        <div class="card-title">Notes</div>
        <div class="text-sm dashboard-copy">Use the map-specific bindings for selection and launch controls.</div>
      </div>
    </div>
  `;
}

function render4v1HotkeysTab() {
  const hotkeys = [
    { key: 'Coming soon', action: 'Team score and killer selection' },
  ];

  return `
    <div class="tab-panel" id="tab-hotkeys-4v1">
      <div class="page-title">Tournament Hotkeys</div>
      <div class="page-subtitle">Shortcuts for the tournament overlay.</div>
      <div class="card">
        ${hotkeys.map(item => `
          <div class="toggle-row hotkey-row">
            <div>
              <div class="toggle-label">${item.action}</div>
              <div class="toggle-desc">4v1-only shortcut</div>
            </div>
            <span class="hotkey-tag">${item.key}</span>
          </div>
        `).join('')}
      </div>
      <div class="card">
        <div class="card-title">Notes</div>
        <div class="text-sm dashboard-copy">Use the 4v1-specific bindings for team scoring and killer selection.</div>
      </div>
    </div>
  `;
}

function renderAllTabs() {
  const content = document.getElementById('content');
  
  content.innerHTML = Object.values(TAB_RENDERERS).map(renderer => renderer()).join('');
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
  document.getElementById(`tab-${state.activeTab}`)?.classList.add('active');
  
  Object.values(TAB_BINDERS).forEach(binder => {
    try {
      binder();
    } catch (err) {
      console.error(`Failed to bind tab ${tabId}:`, err);
    }
  });
  updateTimerDisplay('onevone');
  updateTimerDisplay('maps');
  updateStatusBar();
}

function reRenderTab(tabId) {
  const panel = document.getElementById(`tab-${tabId}`);
  if (!panel) return;

  const isActive = panel.classList.contains('active');
  const fragment = document.createElement('div');
  fragment.innerHTML = TAB_RENDERERS[tabId]();
  const nextPanel = fragment.firstElementChild;
  if (!isActive) {
    panel.replaceWith(nextPanel);
    TAB_BINDERS[tabId]?.();
    updateTimerDisplay('onevone');
    updateTimerDisplay('maps');
    updateStatusBar();
    return;
  }

  panel.classList.add('refreshing-out');
  setTimeout(() => {
    nextPanel.classList.add('active', 'refreshing-in');
    panel.replaceWith(nextPanel);
    TAB_BINDERS[tabId]?.();
    updateTimerDisplay('onevone');
    updateTimerDisplay('maps');
    updateStatusBar();
  }, 150);
}

function initTabs() {
  document.querySelectorAll('.nav-btn').forEach(button => {
    button.addEventListener('click', () => {
      activateTab(button.dataset.tab, button);
    });
  });
}

const _navOrder = ['dashboard','onevone','maps','fourvone','winstreak','ladder','bamboozle','stats','winstreak-builds','game-info','backgrounds','fonts','settings','credits'];

function activateTab(tab, activeButton = document.querySelector(`[data-tab="${tab}"]`)) {
  const prev = state.activeTab;
  document.querySelectorAll('.nav-btn').forEach(item => item.classList.remove('active'));
  activeButton?.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
  const panel = document.getElementById(`tab-${tab}`);
  if (panel) {
    panel.classList.add('active');
    // Directional animation
    panel.classList.remove('slide-left', 'slide-right');
    const prevIdx = _navOrder.indexOf(prev);
    const nextIdx = _navOrder.indexOf(tab);
    if (prevIdx >= 0 && nextIdx >= 0) {
      panel.classList.add(nextIdx > prevIdx ? 'slide-left' : 'slide-right');
    }
  }
  state.activeTab = tab;
}

function initSidebarGroups() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // Allow multiple sidebar groups to be open simultaneously — do not auto-close siblings.

  sidebar.querySelectorAll('.nav-group').forEach(group => {
    group.classList.remove('open');
  });

  // Click listeners on headers to toggle/navigate
  sidebar.querySelectorAll('.nav-group-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // Check if chevron or child of chevron was clicked
      const chevronClicked = e.target.closest('.nav-chevron');
      
      const group = header.closest('.nav-group');
      if (!group) return;

      // If this header has a data-tab, it's for navigation
      if (header.dataset.tab && !chevronClicked) {
        const tab = header.dataset.tab;
        activateTab(tab, header);
      }

      // Otherwise, toggle the group expansion (do not close other groups)
      e.stopPropagation();
      const isNowOpen = group.classList.toggle('open');
      header.setAttribute('aria-expanded', isNowOpen ? 'true' : 'false');
    });
  });

  // Initialize aria-expanded state
  sidebar.querySelectorAll('.nav-group-header').forEach(header => {
    const group = header.closest('.nav-group');
    if (group) {
      header.setAttribute('aria-expanded', group.classList.contains('open') ? 'true' : 'false');
    }
  });
}


function bindDashboardTab() {
  document.getElementById('btn-export-settings')?.addEventListener('click', () => {
    exportSettings();
    showNotification('Settings exported successfully!');
  });

  document.getElementById('btn-import-settings')?.addEventListener('click', () => {
    importSettings();
  });

  document.getElementById('btn-enable-windows-animations')?.addEventListener('click', async () => {
    await enableWindowsAnimations();
  });

  document.getElementById('btn-check-windows-animations')?.addEventListener('click', async () => {
    await refreshWindowsAnimationsStatus();
  });

  document.querySelectorAll('[data-dashboard-tab]').forEach(button => {
    button.addEventListener('click', () => {
      const tab = button.dataset.dashboardTab;
      activateTab(tab);
      if (button.dataset.dashboardRefresh === 'true') {
        reRenderTab(tab);
      }
    });
  });

  document.querySelectorAll('[data-overlay-enable]').forEach(button => {
    button.addEventListener('click', () => setOverlayEnabled(button.dataset.overlayEnable, !state.overlays[button.dataset.overlayEnable].enabled));
  });

  document.querySelectorAll('[data-overlay-open]').forEach(button => {
    button.addEventListener('click', () => {
      const type = button.dataset.overlayOpen;
      if (state.overlays[type].open) closeOverlay(type);
      else openOverlay(type);
    });
  });

  document.querySelectorAll('[data-overlay-lock]').forEach(button => {
    button.addEventListener('click', () => toggleOverlayLock(button.dataset.overlayLock));
  });
  document.querySelectorAll('[data-overlay-always-on-top]').forEach(button => {
    button.addEventListener('click', () => toggleAlwaysOnTop(button.dataset.overlayAlwaysOnTop));
  });

  document.querySelectorAll('[data-overlay-transparent]').forEach(button => {
    button.addEventListener('click', () => toggleTransparentMode(button.dataset.overlayTransparent));
  });

  document.querySelectorAll('[data-overlay-clickthrough]').forEach(button => {
    button.addEventListener('click', () => toggleClickthrough(button.dataset.overlayClickthrough));
  });

  document.querySelectorAll('.overlay-bg-alpha-slider').forEach(slider => {
    slider.addEventListener('input', event => {
      const type = event.target.dataset.overlayType;
      const value = parseInt(event.target.value, 10) / 100;
      state.overlays[type].backgroundAlpha = value;
      store.set(`overlay.${type}.backgroundAlpha`, value);
      event.target.parentElement.querySelector('.overlay-bg-alpha-value').textContent = `${Math.round(value * 100)}%`;
      ipcRenderer.send('update-overlay-background-alpha', type, value);
    });
  });

}
function bindOnevoneTab() {

  bindCommitOnEnterInput('onevone-player1', input => {
    const name = (input.value || 'Player 1').substring(0, 20);
    state.onevone.player1Name = name;
    input.value = name;
    store.set('onevone.player1Name', state.onevone.player1Name);
    pushOverlayUpdate('onevone');
    reRenderTab('onevone');
  });

  bindCommitOnEnterInput('onevone-player2', input => {
    const name = (input.value || 'Player 2').substring(0, 20);
    state.onevone.player2Name = name;
    input.value = name;
    store.set('onevone.player2Name', state.onevone.player2Name);
    pushOverlayUpdate('onevone');
    reRenderTab('onevone');
  });

  // Score controls
  function adjustScore(pnum, delta) {
    const key = `player${pnum}Score`;
    state.onevone[key] = Math.max(0, state.onevone[key] + delta);
    store.set(`onevone.${key}`, state.onevone[key]);
    pushOverlayUpdate('onevone');
    reRenderTab('onevone');
  }

  document.getElementById('onevone-p1-score-inc')?.addEventListener('click', () => adjustScore(1, 1));
  document.getElementById('onevone-p1-score-dec')?.addEventListener('click', () => adjustScore(1, -1));
  document.getElementById('onevone-p2-score-inc')?.addEventListener('click', () => adjustScore(2, 1));
  document.getElementById('onevone-p2-score-dec')?.addEventListener('click', () => adjustScore(2, -1));

  // Finished checkboxes
  document.getElementById('onevone-p1-finished')?.addEventListener('change', event => {
    if (event.target.checked) finishOnevonePlayer(1);
    else reRenderTab('onevone');
  });
  document.getElementById('onevone-p2-finished')?.addEventListener('change', event => {
    if (event.target.checked) finishOnevonePlayer(2);
    else reRenderTab('onevone');
  });

  // Timer actions
  document.getElementById('onevone-start')?.addEventListener('click', () => {
    startOnevoneTimer(state.onevone.activeTimer);
    reRenderTab('onevone');
  });

  document.getElementById('onevone-pause')?.addEventListener('click', () => {
    stopOnevoneTimer();
    reRenderTab('onevone');
  });

  document.getElementById('onevone-reset')?.addEventListener('click', () => {
    resetOnevoneTimer();
    reRenderTab('onevone');
  });

  document.getElementById('onevone-switch')?.addEventListener('click', () => {
    switchOnevoneTimer();
  });

  document.getElementById('onevone-opacity')?.addEventListener('input', event => {
    state.overlays.onevone.opacity = parseInt(event.target.value, 10);
    store.set('overlay.onevone.opacity', state.overlays.onevone.opacity);
    document.getElementById('onevone-opacity-val').textContent = state.overlays.onevone.opacity + '%';
    ipcRenderer.send('update-overlay-opacity', 'onevone', state.overlays.onevone.opacity);
  });

  document.getElementById('onevone-bg-alpha')?.addEventListener('input', event => {
    state.overlays.onevone.backgroundAlpha = parseInt(event.target.value, 10) / 100;
    store.set('overlay.onevone.backgroundAlpha', state.overlays.onevone.backgroundAlpha);
    document.getElementById('onevone-bg-alpha-val').textContent = Math.round(state.overlays.onevone.backgroundAlpha * 100) + '%';
    ipcRenderer.send('update-overlay-background-alpha', 'onevone', state.overlays.onevone.backgroundAlpha);
  });

  document.getElementById('onevone-clickthrough')?.addEventListener('change', event => {
    if (!state.overlays.onevone.open) return;
    state.overlays.onevone.clickthrough = event.target.checked;
    store.set('overlay.onevone.clickthrough', state.overlays.onevone.clickthrough);
    ipcRenderer.send('toggle-overlay-clickthrough', 'onevone', state.overlays.onevone.clickthrough);
  });

  document.getElementById('onevone-enabled')?.addEventListener('change', event => {
    setOverlayEnabled('onevone', event.target.checked);
  });

  document.getElementById('onevone-locked')?.addEventListener('change', event => {
    if (!state.overlays.onevone.open) return;
    state.overlays.onevone.locked = event.target.checked;
    store.set('overlay.onevone.locked', state.overlays.onevone.locked);
    ipcRenderer.send('toggle-overlay-lock', 'onevone', state.overlays.onevone.locked);
  });

  document.getElementById('onevone-always-on-top')?.addEventListener('change', event => {
    if (!state.overlays.onevone.open) return;
    state.overlays.onevone.alwaysOnTop = event.target.checked;
    store.set('overlay.onevone.alwaysOnTop', state.overlays.onevone.alwaysOnTop);
    ipcRenderer.send('toggle-overlay-always-on-top', 'onevone', state.overlays.onevone.alwaysOnTop);
  });

  document.getElementById('btn-onevone-open')?.addEventListener('click', () => {
    if (state.overlays.onevone.open) closeOverlay('onevone');
    else openOverlay('onevone');
  });

  bindHotkeyInputs();
}

function bindMapsTab() {
  document.getElementById('maps-region-select')?.addEventListener('change', event => {
    setMapsRegion(event.target.value, true);
  });

  document.querySelectorAll('[data-mapidx]').forEach(card => {
    card.addEventListener('click', () => {
      state.maps.selectedIndex = parseInt(card.dataset.mapidx, 10);
      store.set('maps.selectedIndex', state.maps.selectedIndex);
      pushOverlayUpdate('maps');
      reRenderTab('maps');
    });
  });

  document.getElementById('btn-maps-toggle')?.addEventListener('click', () => {
    if (state.maps.timerRunning) stopMapsTimer();
    else startMapsTimer();
    reRenderTab('maps');
  });

  document.getElementById('btn-maps-reset')?.addEventListener('click', () => {
    resetMapsTimer();
    reRenderTab('maps');
  });

  bindCommitOnEnterInput('maps-duration', input => {
    state.maps.timerDuration = parseInt(input.value, 10) || 180;
    state.maps.timerSeconds = state.maps.timerDuration;
    input.value = state.maps.timerDuration;
    store.set('maps.timerDuration', state.maps.timerDuration);
    resetMapsTimer();
    reRenderTab('maps');
  });

  document.getElementById('maps-opacity')?.addEventListener('input', event => {
    state.overlays.maps.opacity = parseInt(event.target.value, 10);
    store.set('overlay.maps.opacity', state.overlays.maps.opacity);
    document.getElementById('maps-opacity-val').textContent = state.overlays.maps.opacity + '%';
    ipcRenderer.send('update-overlay-opacity', 'maps', state.overlays.maps.opacity);
  });

  document.getElementById('maps-bg-alpha')?.addEventListener('input', event => {
    state.overlays.maps.backgroundAlpha = parseInt(event.target.value, 10) / 100;
    store.set('overlay.maps.backgroundAlpha', state.overlays.maps.backgroundAlpha);
    document.getElementById('maps-bg-alpha-val').textContent = Math.round(state.overlays.maps.backgroundAlpha * 100) + '%';
    ipcRenderer.send('update-overlay-background-alpha', 'maps', state.overlays.maps.backgroundAlpha);
  });

  document.getElementById('maps-ocr-capture-target')?.addEventListener('change', event => {
    state.maps.ocr.captureTarget = String(event.target.value || 'roblox');
    if (!state.maps.ocr.captureTarget || state.maps.ocr.captureTarget === 'screen') {
      state.maps.ocr.captureTarget = 'roblox';
    }
    updateMapsOcrStore();
  });

  document.getElementById('maps-ocr-refresh-targets')?.addEventListener('click', async () => {
    await loadMapsOcrWindowSources();
    reRenderTab('maps');
  });

  document.getElementById('maps-ocr-manual-calibration')?.addEventListener('click', async () => {
    await openMapsOcrCalibrationModal();
  });

  document.getElementById('maps-ocr-scan-now')?.addEventListener('click', async () => {
    await runMapsOcrScan(false);
  });

  document.getElementById('maps-ocr-enabled')?.addEventListener('change', event => {
    setMapsOcrEnabled(event.target.checked);
  });

  document.getElementById('maps-ocr-reset-zone')?.addEventListener('click', () => {
    const key = getCurrentMapOcrKey();
    delete state.maps.ocr.zones[key];
    state.maps.ocr.zone = null;
    state.maps.ocr.lastText = '';
    state.maps.ocr.lastMatch = '';
    state.maps.ocr.lastConfidence = null;
    state.maps.ocr.status = 'OCR calibration cleared.';
    stopMapsOcrAutoScan();
    updateMapsOcrStore();
    reRenderTab('maps');
  });

  document.getElementById('btn-map-open')?.addEventListener('click', () => {
    if (state.overlays.maps.open) closeOverlay('maps');
    else openOverlay('maps');
  });

  document.getElementById('maps-enabled')?.addEventListener('change', event => {
    setOverlayEnabled('maps', event.target.checked);
  });

  document.getElementById('maps-locked')?.addEventListener('change', event => {
    if (!state.overlays.maps.open) return;
    state.overlays.maps.locked = event.target.checked;
    store.set('overlay.maps.locked', state.overlays.maps.locked);
    ipcRenderer.send('toggle-overlay-lock', 'maps', state.overlays.maps.locked);
  });

  document.getElementById('maps-always-on-top')?.addEventListener('change', event => {
    if (!state.overlays.maps.open) return;
    state.overlays.maps.alwaysOnTop = event.target.checked;
    store.set('overlay.maps.alwaysOnTop', state.overlays.maps.alwaysOnTop);
    ipcRenderer.send('toggle-overlay-always-on-top', 'maps', state.overlays.maps.alwaysOnTop);
  });

  document.getElementById('maps-clickthrough')?.addEventListener('change', event => {
    if (!state.overlays.maps.open) return;
    state.overlays.maps.clickthrough = event.target.checked;
    store.set('overlay.maps.clickthrough', state.overlays.maps.clickthrough);
    ipcRenderer.send('toggle-overlay-clickthrough', 'maps', state.overlays.maps.clickthrough);
  });

  bindHotkeyInputs();
}

function bindFourvoneTab() {
  // Killer selection and favorites
  document.querySelectorAll('[data-killer]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.killer-favorite-btn')) return; // Don't select when clicking favorite
      state.fourvone.selectedKiller = card.dataset.killer;
      trackRecentKiller(card.dataset.killer);
      store.set('4v1.killer', state.fourvone.selectedKiller);
      pushOverlayUpdate('fourvone');
      reRenderTab('fourvone');
    });
  });

  // Killer favorite buttons
  document.querySelectorAll('[data-killer-fav]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const killer = btn.dataset.killerFav;
      const favs = state.fourvone.favoriteKillers;
      const idx = favs.indexOf(killer);
      if (idx > -1) {
        favs.splice(idx, 1);
      } else {
        favs.push(killer);
      }
      store.set('4v1.favoriteKillers', favs);
      reRenderTab('fourvone');
    });
  });

  // Quick select favorite killers
  document.querySelectorAll('[data-killer-quick]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.fourvone.selectedKiller = btn.dataset.killerQuick;
      trackRecentKiller(btn.dataset.killerQuick);
      store.set('4v1.killer', state.fourvone.selectedKiller);
      pushOverlayUpdate('fourvone');
      reRenderTab('fourvone');
    });
  });

  // Quick select favorite teams
  document.querySelectorAll('[data-team-quick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const teamName = btn.dataset.teamQuick;
      state.fourvone.teams[0].name = teamName;
      store.set('4v1.team0', teamName);
      pushOverlayUpdate('fourvone');
      reRenderTab('fourvone');
    });
  });

  // Team favorite buttons
  document.querySelectorAll('[data-team-fav]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const teamName = btn.dataset.teamFav;
      const favs = state.fourvone.favoriteTeams;
      const idx = favs.indexOf(teamName);
      if (idx > -1) {
        favs.splice(idx, 1);
      } else {
        favs.push(teamName);
      }
      store.set('4v1.favoriteTeams', favs);
      reRenderTab('fourvone');
    });
  });

  const commitFourvoneOnEnter = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commitFourvoneFieldFromInput(event.target);
  };

  document.getElementById('fourvone-latest-wincon')?.addEventListener('keydown', commitFourvoneOnEnter);
  document.getElementById('fourvone-last-stages')?.addEventListener('keydown', commitFourvoneOnEnter);
  document.getElementById('fourvone-last-freshes')?.addEventListener('keydown', commitFourvoneOnEnter);
  document.getElementById('fourvone-set-label')?.addEventListener('keydown', commitFourvoneOnEnter);
  document.getElementById('fourvone-current-set')?.addEventListener('keydown', commitFourvoneOnEnter);
  document.getElementById('fourvone-total-sets')?.addEventListener('keydown', commitFourvoneOnEnter);
  document.getElementById('fourvone-next-set-killer')?.addEventListener('keydown', commitFourvoneOnEnter);

  document.querySelectorAll('.team-name-input').forEach(input => {
    input.addEventListener('keydown', commitFourvoneOnEnter);
  });

  document.querySelectorAll('[data-team-inc]').forEach(button => {
    button.addEventListener('click', () => {
      const index = parseInt(button.dataset.teamInc, 10);
      state.fourvone.teams[index].score += 1;
      document.getElementById(`team-score-${index}`).textContent = state.fourvone.teams[index].score;
      pushOverlayUpdate('fourvone');
    });
  });

  document.querySelectorAll('[data-team-dec]').forEach(button => {
    button.addEventListener('click', () => {
      const index = parseInt(button.dataset.teamDec, 10);
      if (state.fourvone.teams[index].score > 0) {
        state.fourvone.teams[index].score -= 1;
        document.getElementById(`team-score-${index}`).textContent = state.fourvone.teams[index].score;
        pushOverlayUpdate('fourvone');
      }
    });
  });

  document.getElementById('btn-reset-teams')?.addEventListener('click', async () => {
    const confirmed = await showConfirmDialog(
      'This will reset all team and killer scores to 0. This action cannot be undone.',
      'Reset All Scores?'
    );
    
    if (confirmed) {
      state.fourvone.teams.forEach((team, index) => {
        team.score = 0;
        const scoreEl = document.getElementById(`team-score-${index}`);
        if (scoreEl) scoreEl.textContent = '0';
      });
      pushOverlayUpdate('fourvone');
    }
  });

  document.getElementById('fourvone-enabled')?.addEventListener('change', event => {
    setOverlayEnabled('fourvone', event.target.checked);
  });

  document.getElementById('fourvone-locked')?.addEventListener('change', event => {
    if (!state.overlays.fourvone.open) return;
    state.overlays.fourvone.locked = event.target.checked;
    store.set('overlay.fourvone.locked', state.overlays.fourvone.locked);
    ipcRenderer.send('toggle-overlay-lock', 'fourvone', state.overlays.fourvone.locked);
  });

  document.getElementById('btn-fourvone-open')?.addEventListener('click', () => {
    if (state.overlays.fourvone.open) closeOverlay('fourvone');
    else openOverlay('fourvone');
  });

  document.getElementById('btn-swap-teams')?.addEventListener('click', () => {
    const temp = { ...state.fourvone.teams[0] };
    state.fourvone.teams[0].name = state.fourvone.teams[1].name;
    state.fourvone.teams[0].score = state.fourvone.teams[1].score;
    state.fourvone.teams[1].name = temp.name;
    state.fourvone.teams[1].score = temp.score;
    store.set('4v1.team0', state.fourvone.teams[0].name);
    store.set('4v1.team1', state.fourvone.teams[1].name);
    pushOverlayUpdate('fourvone');
    reRenderTab('fourvone');
  });

  document.getElementById('fourvone-opacity')?.addEventListener('input', event => {
    state.overlays.fourvone.opacity = parseInt(event.target.value, 10);
    store.set('overlay.fourvone.opacity', state.overlays.fourvone.opacity);
    document.getElementById('fourvone-opacity-val').textContent = state.overlays.fourvone.opacity + '%';
    ipcRenderer.send('update-overlay-opacity', 'fourvone', state.overlays.fourvone.opacity);
  });

  document.getElementById('fourvone-bg-alpha')?.addEventListener('input', event => {
    state.overlays.fourvone.backgroundAlpha = parseInt(event.target.value, 10) / 100;
    store.set('overlay.fourvone.backgroundAlpha', state.overlays.fourvone.backgroundAlpha);
    document.getElementById('fourvone-bg-alpha-val').textContent = Math.round(state.overlays.fourvone.backgroundAlpha * 100) + '%';
    ipcRenderer.send('update-overlay-background-alpha', 'fourvone', state.overlays.fourvone.backgroundAlpha);
  });

  document.getElementById('fourvone-always-on-top')?.addEventListener('change', event => {
    state.overlays.fourvone.alwaysOnTop = !!event.target.checked;
    store.set('overlay.fourvone.alwaysOnTop', state.overlays.fourvone.alwaysOnTop);
    ipcRenderer.send('toggle-overlay-always-on-top', 'fourvone', state.overlays.fourvone.alwaysOnTop);
    reRenderTab('dashboard');
  });

  document.getElementById('fourvone-clickthrough')?.addEventListener('change', event => {
    state.overlays.fourvone.clickthrough = !!event.target.checked;
    store.set('overlay.fourvone.clickthrough', state.overlays.fourvone.clickthrough);
    ipcRenderer.send('toggle-overlay-clickthrough', 'fourvone', state.overlays.fourvone.clickthrough);
    reRenderTab('dashboard');
  });

  document.getElementById('fourvone-style-select')?.addEventListener('change', event => {
    state.fourvone.style = event.target.value;
    store.set('4v1.style', state.fourvone.style);
    pushOverlayUpdate('fourvone');
    reRenderTab('fourvone');
  });

}

function bindQueueTab() {
  const syncQueueSetting = (key, value) => {
    state.queue[key] = value;
    store.set(`queue.${key}`, value);
    pushOverlayUpdate('queue');
  };

  bindCommitOnEnterInput('queue-title', input => syncQueueSetting('title', String(input.value || '').substring(0, 40) || 'Queue'));
  bindCommitOnEnterInput('queue-api-token', input => syncQueueSetting('apiToken', String(input.value || '')));
  bindCommitOnEnterInput('queue-channel-id', input => syncQueueSetting('channelId', String(input.value || '')));
  bindCommitOnEnterInput('queue-server-id', input => syncQueueSetting('serverId', String(input.value || '')));
  bindCommitOnEnterInput('queue-max-visible', input => syncQueueSetting('maxVisible', Math.max(3, Math.min(12, parseInt(input.value, 10) || 8))));

  document.getElementById('queue-enabled')?.addEventListener('change', event => setOverlayEnabled('queue', event.target.checked));
  document.getElementById('queue-locked')?.addEventListener('change', event => {
    if (!state.overlays.queue.open) return;
    state.overlays.queue.locked = event.target.checked;
    store.set('overlay.queue.locked', state.overlays.queue.locked);
    ipcRenderer.send('toggle-overlay-lock', 'queue', state.overlays.queue.locked);
  });
  document.getElementById('queue-always-on-top')?.addEventListener('change', event => {
    if (!state.overlays.queue.open) return;
    state.overlays.queue.alwaysOnTop = event.target.checked;
    store.set('overlay.queue.alwaysOnTop', state.overlays.queue.alwaysOnTop);
    ipcRenderer.send('toggle-overlay-always-on-top', 'queue', state.overlays.queue.alwaysOnTop);
  });
  document.getElementById('queue-clickthrough')?.addEventListener('change', event => {
    if (!state.overlays.queue.open) return;
    state.overlays.queue.clickthrough = event.target.checked;
    store.set('overlay.queue.clickthrough', state.overlays.queue.clickthrough);
    ipcRenderer.send('toggle-overlay-clickthrough', 'queue', state.overlays.queue.clickthrough);
  });
  document.getElementById('btn-queue-open')?.addEventListener('click', () => {
    if (state.overlays.queue.open) closeOverlay('queue');
    else openOverlay('queue');
  });

  document.getElementById('btn-queue-test')?.addEventListener('click', async () => {
    const status = document.getElementById('queue-test-status');
    const button = document.getElementById('btn-queue-test');
    if (status) status.textContent = 'Testing token...';
    if (button) button.disabled = true;

    try {
      const result = await ipcRenderer.invoke('queue-test-token');
      if (status) {
        status.textContent = result?.ok ? result.message : (result?.message || 'Token test failed.');
        status.style.color = result?.ok ? '#65d26e' : '#ff8b8b';
      }
    } catch (err) {
      if (status) {
        status.textContent = String(err?.message || err || 'Token test failed.');
        status.style.color = '#ff8b8b';
      }
    } finally {
      if (button) button.disabled = false;
    }
  });

  document.getElementById('queue-opacity')?.addEventListener('input', event => {
    state.overlays.queue.opacity = parseInt(event.target.value, 10);
    store.set('overlay.queue.opacity', state.overlays.queue.opacity);
    document.getElementById('queue-opacity-val').textContent = state.overlays.queue.opacity + '%';
    ipcRenderer.send('update-overlay-opacity', 'queue', state.overlays.queue.opacity);
  });

  document.getElementById('queue-bg-alpha')?.addEventListener('input', event => {
    state.overlays.queue.backgroundAlpha = parseInt(event.target.value, 10) / 100;
    store.set('overlay.queue.backgroundAlpha', state.overlays.queue.backgroundAlpha);
    document.getElementById('queue-bg-alpha-val').textContent = Math.round(state.overlays.queue.backgroundAlpha * 100) + '%';
    ipcRenderer.send('update-overlay-background-alpha', 'queue', state.overlays.queue.backgroundAlpha);
  });
}

function bindWinstreakTab() {
  document.getElementById('winstreak-mode-tab')?.addEventListener('change', event => {
    setWinstreakMode(event.target.value);
  });

  document.getElementById('winstreak-killer-tab')?.addEventListener('change', event => {
    setWinstreakKiller(event.target.value);
  });

  document.getElementById('winstreak-style-tab')?.addEventListener('change', event => {
    state.winstreak.style = normalizeWinstreakStyle(event.target.value);
    store.set('winstreak.style', state.winstreak.style);
    pushOverlayUpdate('winstreak');
    reRenderTab('winstreak');
  });

  document.getElementById('winstreak-survivor-style-tab')?.addEventListener('change', event => {
    state.winstreak.survivorStyle = normalizeSurvivorWinstreakStyle(event.target.value);
    store.set('winstreak.survivorStyle', state.winstreak.survivorStyle);
    pushOverlayUpdate('winstreak');
    reRenderTab('winstreak');
  });

  bindCommitOnEnterInput('winstreak-wincon-tab', input => {
    state.winstreak.wincon = input.value;
    store.set('winstreak.wincon', state.winstreak.wincon);
    pushOverlayUpdate('winstreak');
    reRenderTab('winstreak');
  });

  const commitTabFields = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const survivorMode = state.winstreak.mode === 'survivor';
    commitWinstreakStatsFromInputs(state.winstreak.mode, survivorMode ? {
      gamesWonInput: document.getElementById('winstreak-survivor-games-won-tab'),
      pbInput: document.getElementById('winstreak-survivor-pb-tab'),
      wrInput: document.getElementById('winstreak-survivor-wr-tab'),
      twoOutInput: document.getElementById('winstreak-survivor-two-out-tab'),
    } : {
      gamesWonInput: document.getElementById('winstreak-games-won-tab'),
      pbInput: document.getElementById('winstreak-pb-tab'),
      wrInput: document.getElementById('winstreak-wr-tab'),
    });
  };

  [
    'winstreak-games-won-tab',
    'winstreak-pb-tab',
    'winstreak-wr-tab',
    'winstreak-survivor-games-won-tab',
    'winstreak-survivor-pb-tab',
    'winstreak-survivor-wr-tab',
    'winstreak-survivor-two-out-tab',
  ].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', commitTabFields);
  });

  document.getElementById('btn-winstreak-open-tab')?.addEventListener('click', () => {
    if (state.overlays.winstreak.open) closeOverlay('winstreak');
    else openOverlay('winstreak');
  });

  document.getElementById('btn-winstreak-reset-tab')?.addEventListener('click', () => {
    if (state.winstreak.mode === 'survivor') {
      state.winstreak.survivor = normalizeSurvivorWinstreakStatsEntry({ gamesWon: 0, pb: '', worldRecord: '', twoOut: 0, threeOut: 0, fourOut: 0 });
      persistSurvivorWinstreakStats();
    } else {
      state.winstreak.gamesWon = 0;
      persistCurrentWinstreakStats();
    }
    pushOverlayUpdate('winstreak');
    reRenderTab('winstreak');
  });

  document.getElementById('winstreak-opacity')?.addEventListener('input', event => {
    state.overlays.winstreak.opacity = parseInt(event.target.value, 10);
    store.set('overlay.winstreak.opacity', state.overlays.winstreak.opacity);
    document.getElementById('winstreak-opacity-val').textContent = state.overlays.winstreak.opacity + '%';
    ipcRenderer.send('update-overlay-opacity', 'winstreak', state.overlays.winstreak.opacity);
  });

  document.getElementById('winstreak-bg-alpha')?.addEventListener('input', event => {
    state.overlays.winstreak.backgroundAlpha = parseInt(event.target.value, 10) / 100;
    store.set('overlay.winstreak.backgroundAlpha', state.overlays.winstreak.backgroundAlpha);
    document.getElementById('winstreak-bg-alpha-val').textContent = Math.round(state.overlays.winstreak.backgroundAlpha * 100) + '%';
    ipcRenderer.send('update-overlay-background-alpha', 'winstreak', state.overlays.winstreak.backgroundAlpha);
  });

  document.getElementById('winstreak-always-on-top')?.addEventListener('change', event => {
    state.overlays.winstreak.alwaysOnTop = !!event.target.checked;
    store.set('overlay.winstreak.alwaysOnTop', state.overlays.winstreak.alwaysOnTop);
    ipcRenderer.send('toggle-overlay-always-on-top', 'winstreak', state.overlays.winstreak.alwaysOnTop);
    reRenderTab('dashboard');
  });

  document.getElementById('winstreak-clickthrough')?.addEventListener('change', event => {
    state.overlays.winstreak.clickthrough = !!event.target.checked;
    store.set('overlay.winstreak.clickthrough', state.overlays.winstreak.clickthrough);
    ipcRenderer.send('toggle-overlay-clickthrough', 'winstreak', state.overlays.winstreak.clickthrough);
    reRenderTab('dashboard');
  });

  document.getElementById('winstreak-enabled')?.addEventListener('change', event => {
    setOverlayEnabled('winstreak', event.target.checked);
  });

  document.getElementById('winstreak-locked')?.addEventListener('change', event => {
    if (!state.overlays.winstreak.open) return;
    state.overlays.winstreak.locked = event.target.checked;
    store.set('overlay.winstreak.locked', state.overlays.winstreak.locked);
    ipcRenderer.send('toggle-overlay-lock', 'winstreak', state.overlays.winstreak.locked);
  });

  document.getElementById('btn-winstreak-open')?.addEventListener('click', () => {
    if (state.overlays.winstreak.open) closeOverlay('winstreak');
    else openOverlay('winstreak');
  });

  bindHotkeyInputs();
}

function bindStatsTab() {
  document.getElementById('stats-killer-select')?.addEventListener('change', event => {
    const killerName = String(event.target.value || 'Veil');
    state.winstreak.selectedKiller = killerName;
    store.set('winstreak.killer', killerName);
    reRenderTab('stats');
    reRenderTab('winstreak');
  });
}

function bindWinstreakBuildsTab() {
  const updateActiveBuild = (key, value) => {
    const build = getActiveWinstreakBuild();
    if (!build) return;
    build[key] = value;
    persistWinstreakBuildsState();
    reRenderTab('winstreak-builds');
    reRenderTab('stats');
  };

  document.querySelectorAll('[data-build-slot]').forEach(button => {
    button.addEventListener('click', () => {
      state.winstreakBuilds.activeBuildId = Number(button.dataset.buildSlot) || 1;
      persistWinstreakBuildsState();
      reRenderTab('winstreak-builds');
    });
  });

  document.querySelectorAll('[data-build-add]').forEach(button => {
    button.addEventListener('click', () => {
      const build = getActiveWinstreakBuild();
      if (!build) return;
      const entryType = button.dataset.buildAdd;
      const entryName = button.dataset.buildName;
      if (entryType === 'perk') build.perks.push(entryName);
      if (entryType === 'item') build.items.push(entryName);
      persistWinstreakBuildsState();
      reRenderTab('winstreak-builds');
    });
  });

  document.querySelectorAll('[data-build-remove]').forEach(button => {
    button.addEventListener('click', () => {
      const build = getActiveWinstreakBuild();
      if (!build) return;
      const entryType = button.dataset.buildRemove;
      const index = Number(button.dataset.buildRemoveIndex);
      if (entryType === 'perk' && index >= 0) build.perks.splice(index, 1);
      if (entryType === 'item' && index >= 0) build.items.splice(index, 1);
      persistWinstreakBuildsState();
      reRenderTab('winstreak-builds');
    });
  });

  document.getElementById('build-name')?.addEventListener('change', event => updateActiveBuild('name', String(event.target.value || 'Build 1').slice(0, 40)));
  document.getElementById('build-role')?.addEventListener('change', event => updateActiveBuild('role', event.target.value === 'killer' ? 'killer' : 'survivor'));
  document.getElementById('build-ruleset')?.addEventListener('change', event => updateActiveBuild('rulesetId', String(event.target.value || 'standard')));
  document.getElementById('build-tournament-set')?.addEventListener('change', event => updateActiveBuild('tournamentSetId', String(event.target.value || 'dbdleague')));
  document.getElementById('build-notes')?.addEventListener('change', event => updateActiveBuild('notes', String(event.target.value || '').slice(0, 600)));

  document.getElementById('build-killer-select')?.addEventListener('change', event => {
    state.winstreakBuilds.selectedKiller = String(event.target.value || KILLERS[0]?.name || 'Veil');
    persistWinstreakBuildsState();
    reRenderTab('winstreak-builds');
  });

  document.getElementById('build-balance-select')?.addEventListener('change', event => {
    state.winstreakBuilds.selectedBalanceId = String(event.target.value || 'dbdleague');
    persistWinstreakBuildsState();
    reRenderTab('winstreak-builds');
  });

  document.getElementById('build-search')?.addEventListener('input', event => {
    state.winstreakBuilds.searchQuery = String(event.target.value || '');
    persistWinstreakBuildsState();
    reRenderTab('winstreak-builds');
  });

  document.querySelectorAll('[data-build-filter]').forEach(button => {
    button.addEventListener('click', () => {
      state.winstreakBuilds.searchMode = button.dataset.buildFilter || 'perks';
      persistWinstreakBuildsState();
      reRenderTab('winstreak-builds');
    });
  });

  document.getElementById('btn-build-save')?.addEventListener('click', () => {
    persistWinstreakBuildsState();
    showNotification('Build saved.');
  });

  document.getElementById('btn-clear-all-builds')?.addEventListener('click', () => {
    state.winstreakBuilds.builds = createDefaultWinstreakBuilds();
    state.winstreakBuilds.activeBuildId = 1;
    persistWinstreakBuildsState();
    reRenderTab('winstreak-builds');
    showNotification('All builds cleared.');
  });

  document.getElementById('btn-build-export-json')?.addEventListener('click', () => {
    const payload = {
      version: 1,
      builds: state.winstreakBuilds.builds,
      rulesets: state.winstreakBuilds.rulesets,
      tournamentSets: state.winstreakBuilds.tournamentSets,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `winstreak-builds-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('btn-build-import-json')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = event => {
        try {
          const parsed = JSON.parse(String(event.target?.result || '{}'));
          state.winstreakBuilds = normalizeWinstreakBuildState(parsed);
          persistWinstreakBuildsState();
          reRenderTab('winstreak-builds');
          showNotification('Builds imported.');
        } catch (err) {
          showNotification('Failed to import builds.', true);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  });

  document.getElementById('btn-save-custom-ruleset')?.addEventListener('click', () => {
    const name = String(document.getElementById('custom-ruleset-name')?.value || '').trim();
    if (!name) return showNotification('Add a ruleset name first.', true);
    const id = normalizeCatalogName(name).replace(/\s+/g, '-') || `ruleset-${Date.now()}`;
    const next = state.winstreakBuilds.rulesets.filter(entry => entry.id !== id);
    next.unshift({
      id,
      name,
      description: `${name} tournament ruleset`,
      perkSlots: Math.max(0, Number(document.getElementById('custom-ruleset-perks')?.value || 3)),
      itemSlots: Math.max(0, Number(document.getElementById('custom-ruleset-items')?.value || 2)),
      allowDuplicates: String(document.getElementById('custom-ruleset-duplicates')?.value || 'true') === 'true',
    });
    state.winstreakBuilds.rulesets = next;
    persistWinstreakBuildsState();
    reRenderTab('winstreak-builds');
  });

  document.getElementById('btn-save-custom-set')?.addEventListener('click', () => {
    const name = String(document.getElementById('custom-set-name')?.value || '').trim();
    if (!name) return showNotification('Add a tournament set name first.', true);
    const id = normalizeCatalogName(name).replace(/\s+/g, '-') || `set-${Date.now()}`;
    const next = state.winstreakBuilds.tournamentSets.filter(entry => entry.id !== id);
    next.unshift({
      id,
      name,
      description: String(document.getElementById('custom-set-description')?.value || '').trim() || `${name} tournament set`,
    });
    state.winstreakBuilds.tournamentSets = next;
    persistWinstreakBuildsState();
    reRenderTab('winstreak-builds');
  });

  const exportJsonArray = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById('btn-export-rulesets')?.addEventListener('click', () => {
    exportJsonArray(state.winstreakBuilds.rulesets, `winstreak-rulesets-${Date.now()}.json`);
  });

  document.getElementById('btn-export-tournament-sets')?.addEventListener('click', () => {
    exportJsonArray(state.winstreakBuilds.tournamentSets, `winstreak-tournament-sets-${Date.now()}.json`);
  });

  document.getElementById('btn-import-rulesets')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = event => {
        try {
          const parsed = JSON.parse(String(event.target?.result || '[]'));
          state.winstreakBuilds.rulesets = Array.isArray(parsed) ? parsed : Array.isArray(parsed.rulesets) ? parsed.rulesets : createDefaultRulesets();
          persistWinstreakBuildsState();
          reRenderTab('winstreak-builds');
        } catch (err) {
          showNotification('Failed to import rulesets.', true);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  });

  document.getElementById('btn-import-tournament-sets')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = event => {
        try {
          const parsed = JSON.parse(String(event.target?.result || '[]'));
          state.winstreakBuilds.tournamentSets = Array.isArray(parsed) ? parsed : Array.isArray(parsed.tournamentSets) ? parsed.tournamentSets : createDefaultTournamentSets();
          persistWinstreakBuildsState();
          reRenderTab('winstreak-builds');
        } catch (err) {
          showNotification('Failed to import tournament sets.', true);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  });

  document.getElementById('btn-build-export-image')?.addEventListener('click', async () => {
    const exportNode = document.getElementById('winstreak-builds-export');
    if (!exportNode) return;
    if (!html2canvas) {
      showNotification('Image export requires html2canvas. Install dependencies first.', true);
      return;
    }
    try {
      const canvas = await html2canvas(exportNode, {
        backgroundColor: '#06070a',
        scale: Math.max(2, window.devicePixelRatio || 2),
        useCORS: true,
      });
      const link = document.createElement('a');
      link.download = `winstreak-builds-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Failed to export build image:', err);
      showNotification('Failed to export image.', true);
    }
  });
}

function bindBgTab() {
  document.getElementById('btn-theme-dark')?.addEventListener('click', () => {
    applyUiTheme('dark');
    reRenderTab('backgrounds');
  });

  document.getElementById('btn-bg-visual-apply')?.addEventListener('click', () => {
    state.bg.visualSrc = document.getElementById('bg-visual-src').value;
    store.set('bg.visual', state.bg.visualSrc);
    applyBackgroundVisual();
    pushOverlayUpdate('maps');
  });

  document.getElementById('btn-bg-visual-browse')?.addEventListener('click', () => {
    document.getElementById('bg-visual-file')?.click();
  });

  document.getElementById('audio-toggle')?.addEventListener('change', event => {
    state.bg.audioEnabled = event.target.checked;
    store.set('bg.audioEnabled', state.bg.audioEnabled);
    pushOverlayUpdate('maps');
  });

  document.getElementById('audio-volume')?.addEventListener('input', event => {
    state.bg.audioVolume = parseInt(event.target.value, 10);
    document.getElementById('vol-display').textContent = `${state.bg.audioVolume}%`;
    store.set('bg.volume', state.bg.audioVolume);
    pushOverlayUpdate('maps');
  });

  document.getElementById('btn-bg-audio-apply')?.addEventListener('click', () => {
    state.bg.audioSrc = document.getElementById('bg-audio-src').value;
    store.set('bg.audio', state.bg.audioSrc);
    applyBackgroundAudio();
    pushOverlayUpdate('maps');
  });

  document.getElementById('btn-bg-audio-browse')?.addEventListener('click', () => {
    document.getElementById('bg-audio-file')?.click();
  });

  bindFilePicker('bg-visual-file', 'bg-visual-src', 'btn-bg-visual-apply');
  bindFilePicker('bg-audio-file', 'bg-audio-src', 'btn-bg-audio-apply');

  // wire play button
  document.getElementById('btn-bg-audio-play')?.addEventListener('click', () => {
    toggleAudioPlayback();
  });

  // UI scale slider wiring
  const uiSlider = document.getElementById('ui-scale-slider');
  const uiVal = document.getElementById('ui-scale-val');
  const resetBtn = document.getElementById('btn-ui-scale-reset');
  const previewToggle = document.getElementById('ui-preview-mode');

  if (uiSlider && uiVal) {
    uiSlider.addEventListener('input', event => {
      const val = parseInt(event.target.value, 10) || 100;
      const scale = (val / 100);
      uiVal.textContent = scale.toFixed(2) + 'x';
      setUiScale(scale);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const defaultVal = 100;
      document.getElementById('ui-scale-slider').value = defaultVal;
      document.getElementById('ui-scale-val').textContent = '1.00x';
      setUiScale(1);
    });
  }

  if (previewToggle) {
    previewToggle.addEventListener('change', event => {
      const enabled = !!event.target.checked;
      document.body.classList.toggle('preview-mode', enabled);
      store.set('ui.previewMode', enabled);
      // notify overlay windows to show/hide preview grid if needed
      ipcRenderer.send('ui-preview-mode', enabled);
    });
  }

  // overlay appearance controls
  const fullToggle = document.getElementById('overlay-full-transparent-toggle');
  const alphaSlider = document.getElementById('overlay-alpha-slider');
  const alphaVal = document.getElementById('overlay-alpha-val');
  if (fullToggle) {
    fullToggle.addEventListener('change', event => {
      const enabled = !!event.target.checked;
      const alpha = enabled ? 0 : Number(document.getElementById('overlay-alpha-slider').value) || 0.14;
      store.set('overlay.alpha', alpha);
      ipcRenderer.send('overlay-set-alpha', alpha);
      if (alphaVal) alphaVal.textContent = Number(alpha).toFixed(2);
    });
  }
  
  if (alphaSlider) {
    alphaSlider.addEventListener('input', event => {
      const val = Number(event.target.value) || 0;
      if (alphaVal) alphaVal.textContent = val.toFixed(2);
      store.set('overlay.alpha', val);
      ipcRenderer.send('overlay-set-alpha', val);
      // update toggle if slider moved to zero
      if (fullToggle) fullToggle.checked = (val <= 0);
    });
  }

  // OBS and Roblox integration UI/controls removed per user preference.
}

// Background & audio helpers
function initBackgroundElements() {
  if (!document.getElementById('app-bg')) {
    const bg = document.createElement('div');
    bg.id = 'app-bg';
    document.body.insertBefore(bg, document.body.firstChild);
    console.log('Created app-bg element');
  }

  if (!document.getElementById('app-bg-video')) {
    const v = document.createElement('video');
    v.id = 'app-bg-video';
    v.style.display = 'none';
    v.autoplay = true;
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    document.body.insertBefore(v, document.getElementById('app-bg'));
    console.log('Created app-bg-video element');
  }

  if (!document.getElementById('app-audio')) {
    const a = document.createElement('audio');
    a.id = 'app-audio';
    a.loop = true;
    a.autoplay = false;
    document.body.appendChild(a);
    console.log('Created app-audio element');
  }

  applyBackgroundVisual();
  applyBackgroundAudio();
  // Apply selected font on startup so UI reflects stored setting
  try { applySelectedFont(); } catch (e) { /* noop if function not yet defined */ }
}
function applySelectedFont() {
  const f = state.selectedFont || 'Cinzel';
  const root = document.documentElement;
  // Set CSS variables used by the stylesheet
  root.style.setProperty('--font-main', `'${f}', sans-serif`);
  root.style.setProperty('--font-display', `'${f}', serif`);
  root.style.setProperty('--font-mono', `'${f}', monospace`);
  // Also set body font directly for immediate effect
  try {
    document.body.style.fontFamily = `'${f}', sans-serif`;
  } catch (e) {
    // ignore
  }
}

function filePathToUrl(p) {
  try { return pathToFileURL(p).href; } catch (e) { return p; }
}

function applyBackgroundVisual() {
  const bgSrc = state.bg.visualSrc || '';
  const bgEl = document.getElementById('app-bg');
  const vid = document.getElementById('app-bg-video');
  if (!bgEl || !vid) {
    console.warn('Background elements not found', { bgEl: !!bgEl, vid: !!vid });
    return;
  }
  document.documentElement.classList.toggle('has-custom-bg', !!bgSrc);
  document.body.classList.toggle('has-custom-bg', !!bgSrc);
  bgEl.style.backgroundImage = '';
  vid.pause(); vid.removeAttribute('src'); vid.style.display = 'none';
  if (!bgSrc) {
    bgEl.style.background = '';
    console.log('No background source set');
    return;
  }
  console.log('Applying background:', bgSrc);
  const lc = bgSrc.toLowerCase();
  const videoExts = ['.mp4', '.webm', '.ogg', '.mov', '.m4v'];
  const isVideo = videoExts.some(ext => lc.endsWith(ext));
  const url = filePathToUrl(bgSrc);
  console.log('Background URL:', url, 'isVideo:', isVideo);
  if (isVideo) {
    vid.src = url; vid.style.display = 'block'; vid.play().catch(() => {});
    bgEl.style.background = 'transparent';
    const preview = document.getElementById('bg-preview');
    if (preview) {
      preview.innerHTML = '';
      const pv = document.createElement('video');
      pv.src = url; pv.autoplay = true; pv.loop = true; pv.muted = true;
      pv.style.width = '100%'; pv.style.height = '100%'; pv.style.objectFit = 'cover';
      preview.appendChild(pv);
      pv.play().catch(()=>{});
    }
  } else {
    bgEl.style.backgroundImage = `url('${url}')`;
    bgEl.style.backgroundSize = 'cover';
    bgEl.style.backgroundPosition = 'center center';
    bgEl.style.backgroundRepeat = 'no-repeat';
    console.log('Background image set with inline styles');
    const preview = document.getElementById('bg-preview');
    if (preview) {
      preview.innerHTML = '';
      const img = document.createElement('img');
      img.src = url; img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'cover';
      preview.appendChild(img);
    }
  }
}

function renderLadderTab() {
  return `
    <div class="tab-panel" id="tab-ladder">
      <div class="page-title">Ladder Overlay</div>
      <div class="page-subtitle">Display Slugbot ladder stats (ELO, winrate, losses).</div>

      <div class="card ladder-rework-card">
        <div class="ladder-rework-label">Under Rework</div>
        <div class="ladder-rework-title">This ladder overlay category is currently being reworked.</div>
        <div class="ladder-rework-copy">Check the VD OverlayTools Discord for more updates while we build the new version.</div>
        <div class="ladder-rework-pill">Animated placeholder active</div>
      </div>

      <!-- Account card hidden per user request -->

      <!-- Overlay style card hidden per user request -->
    </div>
  `;
}

function bindLadderTab() {
  const refreshInput = document.getElementById('ladder-refresh');
  const openBtn = document.getElementById('btn-ladder-open');
  const fetchBtn = document.getElementById('btn-ladder-fetch');
  const playerInput = document.getElementById('ladder-player');
  const opponentInput = document.getElementById('ladder-opponent');
  const transparencySlider = document.getElementById('ladder-transparency');
  const transparencyValue = document.getElementById('ladder-transparency-value');

  if (playerInput) {
    let debounce = null;
    const doSaveAndFetch = () => {
      state.ladder.playerDiscord = playerInput.value;
      // Backwards compatibility
      state.ladder.player1Discord = playerInput.value;
      store.set('ladder.playerDiscord', state.ladder.playerDiscord);
      store.set('ladder.player1Discord', state.ladder.player1Discord);
      fetchLadderPlayers().then(() => reRenderTab('ladder'));
    };
    playerInput.addEventListener('change', () => { clearTimeout(debounce); debounce = setTimeout(doSaveAndFetch, 600); });
    playerInput.addEventListener('blur', () => { clearTimeout(debounce); doSaveAndFetch(); });
    playerInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { clearTimeout(debounce); doSaveAndFetch(); } });
  }

  if (opponentInput) {
    let debounce = null;
    const doSaveAndFetch = () => {
      state.ladder.opponentDiscord = opponentInput.value;
      store.set('ladder.opponentDiscord', state.ladder.opponentDiscord);
      fetchLadderPlayers().then(() => reRenderTab('ladder'));
    };
    opponentInput.addEventListener('change', () => { clearTimeout(debounce); debounce = setTimeout(doSaveAndFetch, 600); });
    opponentInput.addEventListener('blur', () => { clearTimeout(debounce); doSaveAndFetch(); });
    opponentInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { clearTimeout(debounce); doSaveAndFetch(); } });
  }

  if (transparencySlider) {
    transparencySlider.addEventListener('input', (e) => {
      const value = Number(e.target.value);
      state.overlays.ladder.opacity = value;
      store.set('overlay.ladder.opacity', value);
      if (transparencyValue) transparencyValue.textContent = value + '%';
      // Send to overlay if it's open
      if (state.overlays.ladder.open) {
        ipcRenderer.send('overlay-opacity-update', 'ladder', value);
      }
    });
  }

  state.ladder.style = 'avatar';
  store.set('ladder.style', state.ladder.style);
  if (refreshInput) refreshInput.addEventListener('change', () => { state.ladder.refreshInterval = Number(refreshInput.value || 60); store.set('ladder.refreshInterval', state.ladder.refreshInterval); stopLadderRefreshTimer(); startLadderRefreshTimer(); });
  if (openBtn) openBtn.addEventListener('click', async () => {
    state.overlays.ladder.open = true; state.overlays.ladder.enabled = true; store.set('overlay.ladder.enabled', true);
    // Open overlay window FIRST so it's ready to receive data
    ipcRenderer.send('open-overlay', 'ladder');
    // Then fetch and send data to the newly opened window
    await new Promise(resolve => setTimeout(resolve, 100)); // Give window time to open
    await fetchLadderPlayers();
    startLadderRefreshTimer();
    updateStatusBar();
    reRenderTab('dashboard');
  });
  if (fetchBtn) fetchBtn.addEventListener('click', () => { fetchLadderPlayers().then(() => reRenderTab('ladder')); });

}

async function applyBackgroundAudio() {
  const audioEl = document.getElementById('app-audio');
  if (!audioEl) return;
  const src = state.bg.audioSrc || '';
  if (!src || !state.bg.audioEnabled) { try { audioEl.pause(); } catch(e){}; audioEl.removeAttribute('src'); return; }
  const url = filePathToUrl(src);
  if (audioEl.src !== url) audioEl.src = url;
  audioEl.volume = (state.bg.audioVolume || 80) / 100;
  try {
    await audioEl.play();
    const _btn = document.getElementById('btn-bg-audio-play');
    if (_btn) _btn.textContent = 'Pause';
  } catch (e) {
    console.warn('Audio play blocked:', e);
    const _btn2 = document.getElementById('btn-bg-audio-play');
    if (_btn2) _btn2.textContent = 'Play';
  }
}

function toggleAudioPlayback() {
  const audioEl = document.getElementById('app-audio');
  if (!audioEl) return;
  if (!audioEl.src) {
    applyBackgroundAudio();
    return;
  }
  if (audioEl.paused) {
    audioEl.play().then(() => { document.getElementById('btn-bg-audio-play').textContent = 'Pause'; }).catch(e => { console.warn('Play failed', e); });
  } else {
    audioEl.pause();
    document.getElementById('btn-bg-audio-play').textContent = 'Play';
  }
}

function renderBamboozleTab() {
  const bam = state.bamboozle;
  return `<div class="tab-panel" id="tab-bamboozle">
    <div class="card">
      <h2>Bamboozle Timer</h2>
      <p class="help-text">A ${bam.duration}-second countdown overlay for The Bamboozle perk. Upload the Bamboozle perk icon and launch the overlay — it will show the image and count down when started.</p>

      <div class="overlay-controls-card">
        <h3>Controls</h3>
        <div class="form-group">
          <label>Bamboozle Perk Image</label>
          <div class="bam-image-preview" id="bam-image-preview">
            ${bam.image ? `<img src="${bam.image}" alt="Bamboozle icon">` : '<span style="color:#888">No image selected</span>'}
          </div>
          <input type="file" id="bam-image-input" accept="image/*" style="margin-top:4px">
          <button class="btn btn-sm" id="bam-clear-image" style="margin-top:4px">Clear Image</button>
        </div>
        <div class="form-group">
          <label>Countdown Duration (seconds)</label>
          <input type="number" id="bam-duration" class="form-input" value="${bam.duration}" min="1" max="120" style="width:80px">
        </div>
        <div class="form-group">
          <label>Timer State</label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-primary" id="bam-start-btn" ${bam.running ? 'disabled' : ''}>Start</button>
            <button class="btn btn-secondary" id="bam-pause-btn" ${bam.running ? '' : 'disabled'}>Pause</button>
            <button class="btn btn-sm" id="bam-reset-btn">Reset</button>
            <span id="bam-status-text" style="margin-left:8px">${bam.running ? bam.remaining.toFixed(1) + 's' : bam.remaining > 0 ? 'Paused ' + bam.remaining.toFixed(1) + 's' : 'READY'}</span>
          </div>
        </div>
      </div>

      <div class="overlay-settings-card">
        <h3>Overlay Settings</h3>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="bam-enabled" ${state.overlays.bamboozle.enabled ? 'checked' : ''}>
            Launch with overlays
          </label>
        </div>
        <div class="form-group">
          <label>Opacity</label>
          <input type="range" id="bam-opacity" min="10" max="100" value="${state.overlays.bamboozle.opacity}">
          <span id="bam-opacity-val">${state.overlays.bamboozle.opacity}%</span>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="bam-locked" ${state.overlays.bamboozle.locked ? 'checked' : ''}>
            Locked
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="bam-clickthrough" ${state.overlays.bamboozle.clickthrough ? 'checked' : ''}>
            Click-through
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="bam-alwaysontop" ${state.overlays.bamboozle.alwaysOnTop ? 'checked' : ''}>
            Always on top
          </label>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="bam-transparent" ${state.overlays.bamboozle.transparent ? 'checked' : ''}>
            Transparent background
          </label>
        </div>
        <div>
          <button class="btn btn-primary" id="bam-launch-btn">Launch Overlay</button>
          <button class="btn btn-sm" id="bam-close-btn">Close Overlay</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Hotkeys</div>
        <div class="form-row">
          <label>Start / Resume</label>
          <input type="text" readonly data-hotkey-setting="bamboozleStart" data-hotkey-tab="bamboozle" value="${escapeHtml(getHotkey('bamboozleStart'))}" placeholder="Press a shortcut" />
        </div>
        <div class="form-row">
          <label>Pause</label>
          <input type="text" readonly data-hotkey-setting="bamboozlePause" data-hotkey-tab="bamboozle" value="${escapeHtml(getHotkey('bamboozlePause'))}" placeholder="Press a shortcut" />
        </div>
        <div class="form-row">
          <label>Reset</label>
          <input type="text" readonly data-hotkey-setting="bamboozleReset" data-hotkey-tab="bamboozle" value="${escapeHtml(getHotkey('bamboozleReset'))}" placeholder="Press a shortcut" />
        </div>
        <div class="text-sm mt-8">Click any field and press a new shortcut. Backspace clears the binding.</div>
      </div>
    </div>
  </div>`;
}

function bindBamboozleTab() {
  const bam = state.bamboozle;

  function updateStatusLine() {
    const st = document.getElementById('bam-status-text');
    if (!st) return;
    if (bam.running) {
      st.textContent = bam.remaining.toFixed(1) + 's';
    } else if (bam.remaining > 0) {
      st.textContent = 'Paused ' + bam.remaining.toFixed(1) + 's';
    } else {
      st.textContent = 'READY';
    }
  }

  function updateBamBtns() {
    const sb = document.getElementById('bam-start-btn');
    const pb = document.getElementById('bam-pause-btn');
    if (sb) sb.disabled = bam.running;
    if (pb) pb.disabled = !bam.running;
  }

  window.__bamStart = function() {
    if (bam.running) return;
    if (bam.remaining <= 0) {
      bam.remaining = bam.duration;
    }
    bam.running = true;
    updateBamBtns();
    pushOverlayUpdate('bamboozle');
    ipcRenderer.send('bamboozle-command', { action: 'start', remaining: bam.remaining, duration: bam.duration, image: bam.image });
    const tick = 0.05;
    bam.timerId = setInterval(() => {
      bam.remaining = Math.max(0, bam.remaining - tick);
      updateStatusLine();
      if (bam.remaining <= 0) {
        bam.running = false;
        if (bam.timerId) { clearInterval(bam.timerId); bam.timerId = null; }
        updateBamBtns();
        updateStatusLine();
        pushOverlayUpdate('bamboozle');
        ipcRenderer.send('bamboozle-command', { action: 'complete' });
      }
    }, 50);
  };

  window.__bamPause = function() {
    bam.running = false;
    if (bam.timerId) { clearInterval(bam.timerId); bam.timerId = null; }
    updateBamBtns();
    updateStatusLine();
    ipcRenderer.send('bamboozle-command', { action: 'pause', remaining: bam.remaining });
  };

  window.__bamReset = function() {
    window.__bamPause();
    bam.remaining = 0;
    updateStatusLine();
    pushOverlayUpdate('bamboozle');
    ipcRenderer.send('bamboozle-command', { action: 'reset' });
  };

  function startTimer() { window.__bamStart(); }
  function pauseTimer() { window.__bamPause(); }

  // Image upload
  const imgInput = document.getElementById('bam-image-input');
  if (imgInput) {
    imgInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        bam.image = ev.target.result;
        store.set('bamboozle.image', bam.image);
        const preview = document.getElementById('bam-image-preview');
        if (preview) preview.innerHTML = `<img src="${bam.image}" alt="Bamboozle icon">`;
        pushOverlayUpdate('bamboozle');
      };
      reader.readAsDataURL(file);
    });
  }

  // Clear image
  const clearBtn = document.getElementById('bam-clear-image');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      bam.image = '';
      store.set('bamboozle.image', '');
      const preview = document.getElementById('bam-image-preview');
      if (preview) preview.innerHTML = '<span style="color:#888">No image selected</span>';
      const fi = document.getElementById('bam-image-input');
      if (fi) fi.value = '';
    });
  }

  // Duration
  const durInput = document.getElementById('bam-duration');
  if (durInput) {
    durInput.addEventListener('change', () => {
      bam.duration = Math.max(1, parseInt(durInput.value) || 16);
      store.set('bamboozle.duration', bam.duration);
    });
  }

  // Start
  const startBtn = document.getElementById('bam-start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      startTimer();
    });
  }

  // Pause
  const pauseBtn = document.getElementById('bam-pause-btn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      pauseTimer();
    });
  }

  // Reset
  const resetBtn = document.getElementById('bam-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', window.__bamReset);
  }

  // Overlay controls
  const enabledChk = document.getElementById('bam-enabled');
  if (enabledChk) {
    enabledChk.addEventListener('change', () => {
      state.overlays.bamboozle.enabled = enabledChk.checked;
      store.set('overlay.bamboozle.enabled', enabledChk.checked);
      updateStatusBar();
    });
  }

  const opacitySlider = document.getElementById('bam-opacity');
  if (opacitySlider) {
    opacitySlider.addEventListener('input', () => {
      state.overlays.bamboozle.opacity = parseInt(opacitySlider.value);
      store.set('overlay.bamboozle.opacity', state.overlays.bamboozle.opacity);
      document.getElementById('bam-opacity-val').textContent = opacitySlider.value + '%';
      const ov = ipcRenderer.send('update-overlay-opacity', 'bamboozle', state.overlays.bamboozle.opacity);
    });
  }

  const lockedChk = document.getElementById('bam-locked');
  if (lockedChk) {
    lockedChk.addEventListener('change', () => {
      state.overlays.bamboozle.locked = lockedChk.checked;
      store.set('overlay.bamboozle.locked', lockedChk.checked);
      ipcRenderer.send('toggle-overlay-lock', 'bamboozle', lockedChk.checked);
    });
  }

  const clickthroughChk = document.getElementById('bam-clickthrough');
  if (clickthroughChk) {
    clickthroughChk.addEventListener('change', () => {
      state.overlays.bamboozle.clickthrough = clickthroughChk.checked;
      store.set('overlay.bamboozle.clickthrough', clickthroughChk.checked);
      ipcRenderer.send('toggle-overlay-clickthrough', 'bamboozle', clickthroughChk.checked);
    });
  }

  const aotChk = document.getElementById('bam-alwaysontop');
  if (aotChk) {
    aotChk.addEventListener('change', () => {
      state.overlays.bamboozle.alwaysOnTop = aotChk.checked;
      store.set('overlay.bamboozle.alwaysOnTop', aotChk.checked);
      ipcRenderer.send('toggle-overlay-always-on-top', 'bamboozle', aotChk.checked);
    });
  }

  const transparentChk = document.getElementById('bam-transparent');
  if (transparentChk) {
    transparentChk.addEventListener('change', () => {
      state.overlays.bamboozle.transparent = transparentChk.checked;
      store.set('overlay.bamboozle.transparent', transparentChk.checked);
      ipcRenderer.send('toggle-overlay-transparent', 'bamboozle', transparentChk.checked);
    });
  }

  document.getElementById('bam-launch-btn')?.addEventListener('click', () => {
    ipcRenderer.send('open-overlay', 'bamboozle');
    setTimeout(() => pushOverlayUpdate('bamboozle'), 300);
  });

  document.getElementById('bam-close-btn')?.addEventListener('click', () => {
    ipcRenderer.send('close-overlay', 'bamboozle');
  });
}

function bindFontsTab() {
  document.querySelectorAll('[data-font]').forEach(card => {
    card.addEventListener('click', () => {
      state.selectedFont = card.dataset.font;
      store.set('font', state.selectedFont);
      applySelectedFont();
      pushOverlayUpdate('onevone');
      pushOverlayUpdate('maps');
      pushOverlayUpdate('fourvone');
      reRenderTab('fonts');
    });
  });
}

function bindHotkeysTab() {
  // No-op for now; hotkey bindings handled by main process
}

function bindGameInfoTab() {
  document.querySelectorAll('[data-item-preview]').forEach(button => {
    button.addEventListener('click', () => {
      const itemName = button.dataset.itemPreview;
      if (itemName) showItemPreviewModal(itemName);
    });

    button.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      const itemName = button.dataset.itemPreview;
      if (itemName) showItemPreviewModal(itemName);
    });
  });
}

const TAB_RENDERERS = {
  dashboard: renderDashboardTab,
  onevone: renderOnevoneTab,
  maps: renderMapsTab,
  fourvone: renderFourvoneTab,
  queue: renderQueueTab,
  winstreak: renderWinstreakTab,
  stats: renderStatsTab,
  'winstreak-builds': renderWinstreakBuildsTab,
  ladder: renderLadderTab,
  credits: renderCreditsTab,
  'game-info': renderGameInfoTab,
  'game-info-killers': renderGameInfoKillersTab,
  'game-info-killer-perks': renderGameInfoKillerPerksTab,
  'game-info-survivors': renderGameInfoSurvivorsTab,
  'game-info-survivor-perks': renderGameInfoSurvivorPerksTab,
  'game-info-maps': renderGameInfoMapsTab,
  'game-info-1v1-map-starts': renderGameInfo1v1MapStartsTab,
  backgrounds: renderBgTab,
  fonts: renderFontsTab,
  settings: renderSettingsTab,
  bamboozle: renderBamboozleTab,
};

const TAB_BINDERS = {
  dashboard: bindDashboardTab,
  onevone: bindOnevoneTab,
  maps: bindMapsTab,
  fourvone: bindFourvoneTab,
  queue: bindQueueTab,
  winstreak: bindWinstreakTab,
  stats: bindStatsTab,
  'winstreak-builds': bindWinstreakBuildsTab,
  ladder: bindLadderTab,
  credits: function() { /* no-op binder for credits */ },
  'game-info': bindGameInfoTab,
  'game-info-killers': bindGameInfoTab,
  'game-info-killer-perks': bindGameInfoTab,
  'game-info-survivors': bindGameInfoTab,
  'game-info-survivor-perks': bindGameInfoTab,
  'game-info-maps': bindGameInfoTab,
  'game-info-1v1-map-starts': bindGameInfo1v1MapStartsTab,
  backgrounds: bindBgTab,
  fonts: bindFontsTab,
  settings: bindSettingsTab,
  bamboozle: bindBamboozleTab,
};

document.addEventListener('DOMContentLoaded', () => {
  initBackgroundElements();
  showMainApp();
});

// Show main app
function showMainApp() {
  document.getElementById('app').style.display = 'flex';
  
  applyUiTheme(state.uiTheme);
  requestAnimationFrame(() => {
    try {
      bindHotkeyTypingGuards();
      renderAllTabs();
      initTabs();
      initSidebarGroups();
      // ensure credits tab binding exists
      document.querySelectorAll('[data-tab]')?.forEach(btn => {
        if (btn.dataset.tab === 'credits') btn.addEventListener('click', () => activateTab('credits', btn));
      });
        // If the main process flagged a post-update install, show setup modal
        try {
          const post = store.get('post_update_install', false);
          if (post) {
            // show the full setup wizard after update
            try {
              const wizard = document.getElementById('setup-wizard');
              if (wizard) wizard.style.display = 'block';
            } catch (e) { /* ignore */ }
            // clear the flag so it doesn't show again
            try { store.delete('post_update_install'); } catch (e) { /* ignore */ }
          }
        } catch (e) { console.warn('Failed to read post update flag', e); }
      startQueueRefreshTimer();
        // Apply any pending overlay choices from the setup wizard
        try {
          const pending = store.get('setup.pendingOverlays', null);
          if (pending && typeof pending === 'object') {
            Object.keys(pending).forEach(k => {
              const val = !!pending[k];
              try {
                store.set(`overlay.${k}.enabled`, val);
              } catch (e) {}
              if (state.overlays && state.overlays[k]) state.overlays[k].enabled = val;
            });
            try { store.delete('setup.pendingOverlays'); } catch (e) {}
          }
        } catch (e) { /* ignore */ }

        activateTab(state.activeTab || 'dashboard');
        beginStartupUpdateFlow();
      refreshWindowsAnimationsStatus();
    } catch (err) {
      console.error('Failed to finish app initialization after login:', err);
      activateTab('dashboard');
    }
  });
}

function ensureStartupUpdateOverlayBindings() {
  if (state.startupUpdate.initialized) return;
  state.startupUpdate.initialized = true;

  const overlay = document.getElementById('startup-update-overlay');
  const statusEl = document.getElementById('startup-update-status');
  const actionsEl = document.getElementById('startup-update-actions');
  const progressBar = document.getElementById('startup-update-progress-bar');
  const updateNowBtn = document.getElementById('btn-startup-update-now');
  const updateLaterBtn = document.getElementById('btn-startup-update-later');

  const hideOverlay = () => {
    if (overlay) overlay.style.display = 'none';
    document.body.classList.remove('update-flow-active');
    state.startupUpdate.flowActive = false;
  };

  const showOverlay = () => {
    if (overlay) overlay.style.display = 'flex';
    document.body.classList.add('update-flow-active');
    state.startupUpdate.flowActive = true;
  };

  updateLaterBtn?.addEventListener('click', () => {
    hideOverlay();
  });

  updateNowBtn?.addEventListener('click', async () => {
    if (statusEl) statusEl.textContent = 'Downloading latest setup...';
    if (actionsEl) actionsEl.style.display = 'none';
    try {
      await ipcRenderer.invoke('install-update');
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Update download failed';
      if (actionsEl) actionsEl.style.display = 'flex';
    }
  });

  ipcRenderer.on('update-checking', () => {
    showOverlay();
    if (statusEl) statusEl.textContent = 'Checking For Updates..';
    if (actionsEl) actionsEl.style.display = 'none';
    if (progressBar) progressBar.style.width = '0%';
  });

  ipcRenderer.on('update-available', (event, info) => {
    showOverlay();
    if (statusEl) statusEl.textContent = `Update found${info?.version ? `: ${info.version}` : ''}`;
    if (actionsEl) actionsEl.style.display = 'flex';
  });

  ipcRenderer.on('update-not-available', () => {
    if (statusEl) statusEl.textContent = 'Up to date';
    setTimeout(hideOverlay, 180);
  });

  ipcRenderer.on('update-download-progress', (event, data) => {
    showOverlay();
    const transferred = Number(data?.transferred || 0);
    const total = Number(data?.total || 0);
    const percent = Math.round(data?.percent || 0);
    if (statusEl) {
      const transferredMb = (transferred / 1024 / 1024).toFixed(2);
      const totalMb = total > 0 ? (total / 1024 / 1024).toFixed(2) : '0.00';
      statusEl.textContent = `Downloading setup... ${transferredMb} MB / ${totalMb} MB (${percent}%)`;
    }
    if (progressBar) progressBar.style.width = `${percent}%`;
  });

  ipcRenderer.on('update-downloaded', () => {
    if (statusEl) statusEl.textContent = 'Installing downloaded setup...';
    if (progressBar) progressBar.style.width = '100%';
    if (actionsEl) actionsEl.style.display = 'none';
  });

  ipcRenderer.on('update-error', (event, err) => {
    if (statusEl) statusEl.textContent = `Update error: ${err?.message || err}`;
    if (actionsEl) actionsEl.style.display = 'flex';
    document.body.classList.remove('update-flow-active');
  });

  state.startupUpdate.hideOverlay = hideOverlay;
  state.startupUpdate.showOverlay = showOverlay;
}

function beginStartupUpdateFlow() {
  ensureStartupUpdateOverlayBindings();
  const overlay = document.getElementById('startup-update-overlay');
  const statusEl = document.getElementById('startup-update-status');
  const actionsEl = document.getElementById('startup-update-actions');
  const progressBar = document.getElementById('startup-update-progress-bar');

  if (overlay) overlay.style.display = 'flex';
  document.body.classList.add('update-flow-active');
  state.startupUpdate.flowActive = true;
  if (statusEl) statusEl.textContent = 'Checking For Updates..';
  if (actionsEl) actionsEl.style.display = 'none';
  if (progressBar) progressBar.style.width = '0%';

  ipcRenderer.invoke('check-for-updates').catch(err => {
    if (statusEl) statusEl.textContent = `Update check failed: ${err?.message || err}`;
    if (actionsEl) actionsEl.style.display = 'flex';
  });
}

ipcRenderer.on('overlay-data', (event, payload) => {
  // Handle overlay updates if needed
});

ipcRenderer.on('request-overlay-data', (event, type) => {
  pushOverlayUpdate(type);
});

ipcRenderer.on('hotkey', (event, scope, action) => {
  if (isTypingInEditableField()) return;

  if (scope === 'maps') {
    if (action === 'next-map') {
      nextMap();
      return;
    }

    if (action === 'previous-map') {
      previousMap();
      return;
    }

    if (action === 'always-on-top-toggle') {
      toggleAlwaysOnTop('maps');
    }
    
    if (action === 'toggle-region') {
      setMapsRegion(state.maps.region === 'NA' ? 'EU' : 'NA', true);
      return;
    }
    return;
  }

  if (scope === 'onevone') {
    if (action === 'timer-toggle') {
      if (state.onevone.timerRunning) stopOnevoneTimer();
      else startOnevoneTimer(1);
      reRenderTab('onevone');
      return;
    }

    if (action === 'timer-start') {
      if (!state.onevone.timerRunning) startOnevoneTimer(1);
      reRenderTab('onevone');
      return;
    }

    if (action === 'timer-pause') {
      if (state.onevone.timerRunning) stopOnevoneTimer();
      reRenderTab('onevone');
      return;
    }

    if (action === 'switch-timer') {
      switchOnevoneTimer();
      return;
    }

    if (action === 'timer-reset') {
      resetOnevoneTimer();
      reRenderTab('onevone');
      return;
    }

    if (action === 'always-on-top-toggle') {
      toggleAlwaysOnTop('onevone');
      return;
    }
    return;
  }

  if (scope === 'bamboozle') {
    if (action === 'timer-start') {
      if (state.overlays.bamboozle.enabled) openOverlay('bamboozle');
      window.__bamStart();
    } else if (action === 'timer-pause') window.__bamPause();
    else if (action === 'timer-reset') window.__bamReset();
    return;
  }

  if (scope !== 'winstreak') return;

  if (action === 'next-killer') {
    nextWinstreakKiller();
    return;
  }

  if (action === 'always-on-top-toggle') {
    toggleWinstreakAlwaysOnTop();
    return;
  }
});

// Expose functions used by inline onclick handlers in index.html
window.openDiscord = openDiscord;
window.openVDL = openVDL;
window.openVDR = openVDR;
window.showMapPreviewModal = showMapPreviewModal;
window.closeMapPreviewModal = closeMapPreviewModal;

/* =============================================
   POLISH UPGRADES — JS FEATURES
   ============================================= */

// Tab order for directional animation

// --- 2. Toast notification system ---
let _toastContainer = null;
function ensureToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.createElement('div');
    _toastContainer.className = 'toast-container';
    document.body.appendChild(_toastContainer);
  }
  return _toastContainer;
}
function showToast(message, type = 'info', duration = 3500, action = null) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = { success: '✓', error: '✕', info: '●' };
  toast.innerHTML = `
    <span class="toast-icon ${type}">${icons[type] || '●'}</span>
    <span class="toast-body">${message}</span>
    ${action ? `<button class="toast-action">${action.label}</button>` : ''}
    <button class="toast-close">✕</button>
  `;
  container.appendChild(toast);
  if (action) {
    toast.querySelector('.toast-action')?.addEventListener('click', () => {
      action.onClick();
      toast.classList.add('exiting');
      setTimeout(() => toast.remove(), 240);
    });
  }
  toast.querySelector('.toast-close')?.addEventListener('click', () => {
    toast.classList.add('exiting');
    setTimeout(() => toast.remove(), 240);
  });
  if (duration > 0) {
    setTimeout(() => {
      if (toast.isConnected) {
        toast.classList.add('exiting');
        setTimeout(() => toast.remove(), 240);
      }
    }, duration);
  }
  return toast;
}

// --- 3. Number counting animation ---
function animateCountUp(el, target, duration = 600) {
  const start = performance.now();
  const initial = parseFloat(el.textContent) || 0;
  const delta = target - initial;
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(initial + delta * eased);
    el.classList.add('pop');
    if (t < 1) requestAnimationFrame(tick);
    else setTimeout(() => el.classList.remove('pop'), 340);
  }
  requestAnimationFrame(tick);
}

// --- 4. Scroll-triggered animations ---
let _scrollObserver = null;
function initScrollAnimations() {
  if (_scrollObserver) return;
  _scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        _scrollObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.scroll-animate').forEach(el => _scrollObserver.observe(el));
}
function observeScrollAnimations() {
  if (!_scrollObserver) initScrollAnimations();
  document.querySelectorAll('.scroll-animate:not(.visible)').forEach(el => _scrollObserver.observe(el));
}

// --- 5. Particle system ---
let _particleInterval = null;
function startParticles(count = 20) {
  stopParticles();
  let container = document.getElementById('particle-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'particle-container';
    container.className = 'particle-container';
    container.style.display = 'none';
    document.body.appendChild(container);
  }
  container.style.display = 'block';
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 1 + Math.random() * 3;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDuration = (6 + Math.random() * 8) + 's';
    p.style.animationDelay = (Math.random() * 10) + 's';
    p.style.opacity = 0.2 + Math.random() * 0.3;
    container.appendChild(p);
  }
}
function stopParticles() {
  if (_particleInterval) { clearInterval(_particleInterval); _particleInterval = null; }
  const container = document.getElementById('particle-container');
  if (container) { container.style.display = 'none'; container.innerHTML = ''; }
}

// --- 6. Custom cursor ---
let _cursorEnabled = false;
let _cursorEl = null;
let _cursorDot = null;
function toggleCustomCursor(enable) {
  _cursorEnabled = enable;
  document.body.classList.toggle('custom-cursor-enabled', enable);
  if (enable) {
    if (!_cursorEl) {
      _cursorEl = document.createElement('div'); _cursorEl.id = 'custom-cursor';
      _cursorDot = document.createElement('div'); _cursorDot.id = 'custom-cursor-dot';
      document.body.appendChild(_cursorEl); document.body.appendChild(_cursorDot);
    }
    const move = (e) => {
      _cursorEl.style.left = e.clientX + 'px'; _cursorEl.style.top = e.clientY + 'px';
      _cursorDot.style.left = e.clientX + 'px'; _cursorDot.style.top = e.clientY + 'px';
    };
    const over = (e) => { if (e.target.closest('button,a,.btn,.nav-btn,.card')) _cursorEl.classList.add('hovering'); };
    const out = () => _cursorEl.classList.remove('hovering');
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    _cursorEl._cleanup = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
    };
  } else {
    if (_cursorEl && _cursorEl._cleanup) _cursorEl._cleanup();
    if (_cursorEl) { _cursorEl.remove(); _cursorEl = null; }
    if (_cursorDot) { _cursorDot.remove(); _cursorDot = null; }
  }
}

// --- 7. Skeleton loading helpers ---
function showSkeleton(container, type = 'card', count = 3) {
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    if (type === 'card') s.className = 'skeleton skeleton-card';
    else if (type === 'text') s.className = 'skeleton skeleton-text';
    else if (type === 'title') s.className = 'skeleton skeleton-title';
    else if (type === 'avatar') s.className = 'skeleton skeleton-avatar';
    else s.className = 'skeleton';
    container.appendChild(s);
  }
}
function hideSkeleton(container, content) {
  if (!container) return;
  container.innerHTML = content || '';
}

// --- 8. Sidebar toggle ---
function initSidebarToggle() {
  let toggle = document.getElementById('sidebar-toggle');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.id = 'sidebar-toggle';
    toggle.innerHTML = '◀';
    toggle.title = 'Toggle sidebar';
    document.getElementById('sidebar')?.appendChild(toggle);
  }
  toggle.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
    toggle.innerHTML = document.body.classList.contains('sidebar-collapsed') ? '▶' : '◀';
  });
}

// --- 9. Command palette (Ctrl+K) ---
let _commandPalette = null;
function ensureCommandPalette() {
  if (_commandPalette) return;
  _commandPalette = document.createElement('div');
  _commandPalette.className = 'command-overlay';
  _commandPalette.innerHTML = `
    <div class="command-palette">
      <input class="command-input" placeholder="Search tabs, actions..." autofocus />
      <div class="command-results"></div>
    </div>
  `;
  _commandPalette.addEventListener('click', (e) => { if (e.target === _commandPalette) closeCommandPalette(); });
  document.body.appendChild(_commandPalette);
  const input = _commandPalette.querySelector('.command-input');
  input.addEventListener('input', () => filterCommands(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCommandPalette();
    if (e.key === 'ArrowDown') { e.preventDefault(); moveCommandSelection(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveCommandSelection(-1); }
    if (e.key === 'Enter') { e.preventDefault(); executeCommandSelection(); }
  });
}
const _commandItems = [
  { label: 'Dashboard', tab: 'dashboard' },
  { label: '1v1 Timer', tab: 'onevone' },
  { label: 'Map Overlay', tab: 'maps' },
  { label: 'Scrim Overlay', tab: 'fourvone' },
  { label: 'Winstreak Overlay', tab: 'winstreak' },
  { label: 'Ladder Overlay', tab: 'ladder' },
  { label: 'Winstreak Stats', tab: 'stats' },
  { label: 'Winstreak Builds', tab: 'winstreak-builds' },
  { label: 'Wiki', tab: 'game-info' },
  { label: 'Backgrounds', tab: 'backgrounds' },
  { label: 'Fonts', tab: 'fonts' },
  { label: 'Settings', tab: 'settings' },
  { label: 'Credits', tab: 'credits' },
  { label: 'Toggle Sidebar', action: () => document.getElementById('sidebar-toggle')?.click() },
];
let _commandSelectionIdx = -1;
function openCommandPalette() {
  ensureCommandPalette();
  _commandPalette.classList.add('open');
  const input = _commandPalette.querySelector('.command-input');
  input.value = '';
  input.focus();
  filterCommands('');
}
function closeCommandPalette() {
  if (!_commandPalette) return;
  _commandPalette.classList.remove('open');
}
function filterCommands(query) {
  const results = _commandPalette.querySelector('.command-results');
  const q = query.toLowerCase();
  const filtered = _commandItems.filter(item => item.label.toLowerCase().includes(q));
  if (filtered.length === 0) {
    results.innerHTML = '<div class="command-empty">No results found</div>';
    _commandSelectionIdx = -1;
    return;
  }
  results.innerHTML = filtered.map((item, i) =>
    `<div class="command-item${i === 0 ? ' selected' : ''}" data-idx="${i}">
      <span>${item.label}</span>
      ${item.tab ? '<span class="shortcut-hint">Tab</span>' : ''}
    </div>`
  ).join('');
  _commandSelectionIdx = 0;
  results.querySelectorAll('.command-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      const item = filtered[idx];
      if (item) executeCommand(item);
    });
  });
}
function moveCommandSelection(dir) {
  const items = _commandPalette.querySelectorAll('.command-item');
  if (!items.length) return;
  items.forEach(i => i.classList.remove('selected'));
  _commandSelectionIdx = Math.max(0, Math.min(_commandSelectionIdx + dir, items.length - 1));
  items[_commandSelectionIdx]?.classList.add('selected');
  items[_commandSelectionIdx]?.scrollIntoView({ block: 'nearest' });
}
function executeCommandSelection() {
  const items = _commandPalette.querySelectorAll('.command-item');
  const selected = items[_commandSelectionIdx];
  if (!selected) return;
  const idx = parseInt(selected.dataset.idx);
  const q = _commandPalette.querySelector('.command-input').value.toLowerCase();
  const filtered = _commandItems.filter(item => item.label.toLowerCase().includes(q));
  executeCommand(filtered[idx]);
}
function executeCommand(item) {
  closeCommandPalette();
  if (item.tab) {
    const btn = document.querySelector(`.nav-btn[data-tab="${item.tab}"]`);
    if (btn) btn.click();
    else activateTab(item.tab);
  } else if (item.action) {
    item.action();
  }
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    if (_commandPalette?.classList.contains('open')) closeCommandPalette();
    else openCommandPalette();
  }
  if (e.key === 'Escape') closeCommandPalette();
});

// --- 10. Settings search ---
function initSettingsSearch() {
  const settingsPanel = document.getElementById('tab-settings');
  if (!settingsPanel) return;
  const searchWrap = document.createElement('div');
  searchWrap.className = 'settings-search';
  searchWrap.innerHTML = `
    <span class="settings-search-icon">🔍</span>
    <input class="settings-search-input" placeholder="Search settings..." />
  `;
  settingsPanel.prepend(searchWrap);
  const input = searchWrap.querySelector('input');
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    const groups = settingsPanel.querySelectorAll('.card');
    let hasResults = false;
    groups.forEach(card => {
      const text = card.textContent.toLowerCase();
      const matches = text.includes(q);
      card.style.display = matches || !q ? '' : 'none';
      if (matches) hasResults = true;
    });
    let noResults = settingsPanel.querySelector('.settings-no-results');
    if (!hasResults && q) {
      if (!noResults) {
        noResults = document.createElement('div');
        noResults.className = 'settings-no-results';
        settingsPanel.appendChild(noResults);
      }
      noResults.textContent = `No settings match "${q}"`;
    } else if (noResults) {
      noResults.remove();
    }
  });
}

// --- 11. Undo snackbar ---
function showSnackbar(message, actionLabel, onAction, duration = 5000) {
  const existing = document.querySelector('.snackbar');
  if (existing) existing.remove();
  const snack = document.createElement('div');
  snack.className = 'snackbar';
  snack.innerHTML = `
    <span>${message}</span>
    <button class="snackbar-action">${actionLabel}</button>
  `;
  document.body.appendChild(snack);
  snack.querySelector('.snackbar-action')?.addEventListener('click', () => {
    if (onAction) onAction();
    snack.classList.add('exiting');
    setTimeout(() => snack.remove(), 200);
  });
  if (duration > 0) {
    setTimeout(() => {
      if (snack.isConnected) {
        snack.classList.add('exiting');
        setTimeout(() => snack.remove(), 200);
      }
    }, duration);
  }
  return snack;
}

// --- 12. Ripple effect on buttons ---
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn.primary, .btn.danger');
  if (!btn || btn.disabled) return;
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement('span');
  const size = Math.max(rect.width, rect.height);
  ripple.style.cssText = `
    position: absolute; inset: 0; border-radius: inherit; overflow: hidden; pointer-events: none;
    background: rgba(255,255,255,0.15); width: ${size}px; height: ${size}px;
    left: ${e.clientX - rect.left - size/2}px; top: ${e.clientY - rect.top - size/2}px;
    transform: scale(0); animation: rippleEffect 500ms ease-out forwards;
  `;
  btn.style.position = 'relative';
  btn.style.overflow = 'hidden';
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 500);
});
// Add ripple keyframes if not in CSS
if (!document.getElementById('ripple-style')) {
  const style = document.createElement('style');
  style.id = 'ripple-style';
  style.textContent = `@keyframes rippleEffect { to { transform: scale(3); opacity: 0; } }`;
  document.head.appendChild(style);
}

// --- 13. Keyboard shortcut hints ---
function addShortcutHint(el, shortcut) {
  if (!el) return;
  const hint = document.createElement('span');
  hint.className = 'shortcut-hint';
  hint.textContent = shortcut;
  el.appendChild(hint);
}

// --- 14. Staggered entrance for overlay cards ---
function applyStaggeredEntrance(container) {
  if (!container) return;
  container.classList.add('stagger-enter');
  setTimeout(() => container.classList.remove('stagger-enter'), 500);
}

// --- 15. Context-aware tab accents ---
function setTabAccent(tab) {
  document.body.dataset.tab = tab || '';
}

// --- 16. Hover preview tooltips ---
function showHoverPreview(el, content) {
  let preview = document.getElementById('hover-preview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'hover-preview';
    preview.className = 'hover-preview';
    document.body.appendChild(preview);
  }
  preview.innerHTML = content;
  preview.classList.add('visible');
  const rect = el.getBoundingClientRect();
  preview.style.left = Math.min(rect.left, window.innerWidth - preview.offsetWidth - 8) + 'px';
  preview.style.top = (rect.bottom + 8) + 'px';
}
function hideHoverPreview() {
  const preview = document.getElementById('hover-preview');
  if (preview) preview.classList.remove('visible');
}

// --- 17. Init all polish features ---
function initPolishFeatures() {
  initSidebarToggle();
  initSettingsSearch();
  startParticles(15);
  initScrollAnimations();
  observeScrollAnimations();
  // Override activateTab to set tab accent
  const _origActivate = activateTab;
  activateTab = function(tab, btn) {
    _origActivate.call(this, tab, btn);
    setTabAccent(tab);
  };
  setTabAccent(state.activeTab);
  // Add keyboard shortcut hints on nav buttons
  document.querySelectorAll('[data-tab]').forEach(btn => {
    const tab = btn.dataset.tab;
    if (['dashboard','onevone','maps','settings'].includes(tab)) {
      // Could add shortcut hints here if desired
    }
  });
}

// --- 18. Global search bar ---
function initGlobalSearch() {
  const input = document.getElementById('global-search-input');
  const dropdown = document.getElementById('global-search-results');
  if (!input || !dropdown) return;

  const searchableItems = [
    // Tabs
    { label: 'Dashboard', cat: 'tab', icon: '◌', tab: 'dashboard' },
    { label: '1v1 Timer', cat: 'tab', icon: '⚔', tab: 'onevone' },
    { label: 'Map Overlay', cat: 'tab', icon: '🗺', tab: 'maps' },
    { label: 'Scrim Overlay', cat: 'tab', icon: '⚡', tab: 'fourvone' },
    { label: 'Winstreak Overlay', cat: 'tab', icon: '◍', tab: 'winstreak' },
    { label: 'Ladder Overlay', cat: 'tab', icon: '★', tab: 'ladder' },
    { label: 'Winstreak Stats', cat: 'tab', icon: '◍', tab: 'stats' },
    { label: 'Winstreak Builds', cat: 'tab', icon: '✦', tab: 'winstreak-builds' },
    { label: 'Wiki', cat: 'tab', icon: '✦', tab: 'game-info' },
    { label: 'Backgrounds', cat: 'tab', icon: '◧', tab: 'backgrounds' },
    { label: 'Fonts', cat: 'tab', icon: 'Aa', tab: 'fonts' },
    { label: 'Settings', cat: 'tab', icon: '⚙', tab: 'settings' },
    { label: 'Credits', cat: 'tab', icon: '✦', tab: 'credits' },
    // Settings items
    { label: 'Overlay Settings', cat: 'setting', icon: '⚙', tab: 'settings' },
    { label: 'Hotkey Bindings', cat: 'setting', icon: '⌨', tab: 'settings' },
    { label: 'Theme Options', cat: 'setting', icon: '◧', tab: 'backgrounds' },
    { label: 'Font Settings', cat: 'setting', icon: 'Aa', tab: 'fonts' },
    // Actions
    { label: 'Toggle Sidebar', cat: 'action', icon: '≡', action: 'toggleSidebar' },
    { label: 'Open Command Palette', cat: 'action', icon: '⌨', action: 'openCommandPalette' },
    { label: 'Clear All Builds', cat: 'action', icon: '✕', action: 'clearBuilds' },
  ];

  let selectedIdx = -1;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { dropdown.classList.remove('open'); return; }
    const results = searchableItems.filter(item =>
      item.label.toLowerCase().includes(q) || item.cat.includes(q)
    );
    if (!results.length) {
      dropdown.innerHTML = '<div class="global-search-empty">No results found</div>';
      dropdown.classList.add('open');
      selectedIdx = -1;
      return;
    }
    dropdown.innerHTML = results.map((item, i) =>
      `<div class="global-search-item${i === 0 ? ' selected' : ''}" data-idx="${i}" data-tab="${item.tab || ''}" data-action="${item.action || ''}">
        <span class="gs-icon">${item.icon}</span>
        <span>${escapeHtml(item.label)}</span>
        <span class="gs-category">${item.cat}</span>
      </div>`
    ).join('');
    dropdown.classList.add('open');
    selectedIdx = 0;
  });

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.global-search-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, items.length - 1); updateSearchSelection(items); }
    if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); updateSearchSelection(items); }
    if (e.key === 'Enter' && selectedIdx > -1) { e.preventDefault(); activateSearchItem(items[selectedIdx]); }
    if (e.key === 'Escape') { dropdown.classList.remove('open'); input.blur(); }
  });

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.global-search-item');
    if (item) activateSearchItem(item);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#global-search-wrap')) dropdown.classList.remove('open');
  });

  function updateSearchSelection(items) {
    items.forEach((el, i) => el.classList.toggle('selected', i === selectedIdx));
    items[selectedIdx]?.scrollIntoView({ block: 'nearest' });
  }

  function activateSearchItem(el) {
    const tab = el.dataset.tab;
    const action = el.dataset.action;
    dropdown.classList.remove('open');
    input.value = '';
    if (action === 'toggleSidebar') { toggleSidebar(); return; }
    if (action === 'openCommandPalette') { openCommandPalette?.(); return; }
    if (action === 'clearBuilds') { clearAllWinstreakBuilds?.(); return; }
    if (tab) activateTab(tab);
  }
}

// --- 19. Context menu system ---
function initContextMenu() {
  const menu = document.getElementById('context-menu');
  if (!menu) return;
  document.addEventListener('contextmenu', (e) => {
    // Check if right-clicking on a build card or other actionable element
    const buildCard = e.target.closest('.build-card, .winstreak-build-card');
    if (buildCard) {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, buildCard);
    }
  });
  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('open')) return;
    if (!e.target.closest('.context-menu')) {
      menu.classList.remove('open');
    }
  });
}
function showContextMenu(x, y, target) {
  const menu = document.getElementById('context-menu');
  if (!menu) return;
  menu.innerHTML = '';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  const items = [
    { label: 'Edit Build', icon: '✎', action: () => { /* tab switch to builds */ } },
    { label: 'Duplicate', icon: '⧉', action: () => { /* duplicate logic */ } },
    { label: 'Share', icon: '↗', action: () => { /* share logic */ } },
    { type: 'separator' },
    { label: 'Delete', icon: '✕', className: 'danger', action: () => { /* delete logic */ } },
  ];
  items.forEach(item => {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      menu.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
    el.className = 'context-menu-item' + (item.className ? ' ' + item.className : '');
    el.innerHTML = `<span>${item.icon || ''}</span><span>${item.label}</span>`;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      menu.classList.remove('open');
      if (item.action) item.action();
    });
    menu.appendChild(el);
  });
  menu.classList.add('open');
}

// --- 19. Quick toolbar ---
function initQuickToolbar() {
  const toolbar = document.getElementById('quick-toolbar');
  if (!toolbar) return;
  // Quick toolbar will be shown/hidden by tab-specific logic
}

// --- 20. Offline indicator ---
function initOfflineIndicator() {
  const el = document.getElementById('offline-indicator');
  if (!el) return;
  window.addEventListener('online', () => el.classList.remove('show'));
  window.addEventListener('offline', () => el.classList.add('show'));
  if (!navigator.onLine) el.classList.add('show');
}

// --- 21. Memory display (periodic update) ---
function initMemoryDisplay() {
  const container = document.querySelector('.memory-display');
  if (!container) return;
  function updateMemory() {
    if (window.process && window.process.getProcessMemoryInfo) {
      window.process.getProcessMemoryInfo().then(info => {
        const mb = (info.privateBytes / 1024 / 1024).toFixed(1);
        container.textContent = `${mb} MB`;
      }).catch(() => {});
    }
  }
  updateMemory();
  setInterval(updateMemory, 30000);
}

// --- 22. Notification sound toggle ---
function initNotificationSoundToggle() {
  const toggle = document.querySelector('.sound-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const enabled = toggle.dataset.enabled !== 'false';
    const next = !enabled;
    toggle.dataset.enabled = String(next);
    toggle.querySelector('.sound-icon').textContent = next ? '🔔' : '🔕';
    store.set('notification-sound', next);
  });
}

// --- 23. Accent picker ---
function initAccentPicker() {
  const wrap = document.querySelector('.accent-picker-wrap');
  if (!wrap) return;
  const swatches = wrap.querySelectorAll('.accent-swatch');
  swatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      swatches.forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      const color = swatch.dataset.color || '#7f95ff';
      document.documentElement.style.setProperty('--accent', color);
      store.set('accent-color', color);
    });
  });
}

// --- 24. Font preview cards ---
function initFontPreview() {
  document.querySelectorAll('.font-preview-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.font-preview-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const font = card.dataset.font || 'Inter';
      document.documentElement.style.setProperty('--font-body', font);
      store.set('font-family', font);
    });
  });
}

// --- 25. Wallpaper picker ---
function initWallpaperPicker() {
  const inputs = document.querySelectorAll('.wallpaper-picker input[type="file"]');
  inputs.forEach(input => {
    input.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        document.documentElement.style.setProperty('--wallpaper', `url("${dataUrl}")`);
        store.set('wallpaper', dataUrl);
      };
      reader.readAsDataURL(file);
    });
  });
}

// --- 26. Scheduled tasks UI ---
function initScheduledTasks() {
  document.querySelectorAll('.scheduled-task .st-toggle').forEach(toggle => {
    toggle.addEventListener('change', (e) => {
      const task = e.target.closest('.scheduled-task');
      if (!task) return;
      const taskId = task.dataset.taskId;
      if (taskId) {
        store.set(`scheduled-task-${taskId}`, e.target.checked);
      }
    });
  });
}

// --- 27. Drag-drop for build cards ---
function initDragDrop() {
  document.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.build-card, .winstreak-build-card');
    if (!card) return;
    card.classList.add('drag-ghost');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.buildId || '');
  });
  document.addEventListener('dragend', (e) => {
    const card = e.target.closest('.build-card, .winstreak-build-card');
    if (card) card.classList.remove('drag-ghost');
  });
  document.addEventListener('dragover', (e) => {
    const dropZone = e.target.closest('.build-drop-zone');
    if (dropZone) {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    }
  });
  document.addEventListener('dragleave', (e) => {
    const dropZone = e.target.closest('.build-drop-zone');
    if (dropZone) dropZone.classList.remove('drag-over');
  });
  document.addEventListener('drop', (e) => {
    const dropZone = e.target.closest('.build-drop-zone');
    if (!dropZone) return;
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const buildId = e.dataTransfer.getData('text/plain');
    if (buildId) {
      const builds = store.get('winstreak.builds', []);
      const idx = builds.findIndex(b => b.id === buildId);
      if (idx > -1) {
        const [item] = builds.splice(idx, 1);
        const dropIdx = Number(dropZone.dataset.index || builds.length);
        builds.splice(dropIdx, 0, item);
        store.set('winstreak.builds', builds);
      }
    }
  });
}

// --- 28. Init all additional features ---
// Theme switching (light, dark, hc, amoled)
function setAppTheme(theme) {
  const valid = ['dark', 'light', 'hc', 'amoled', 'cbf'];
  if (!valid.includes(theme)) theme = 'dark';
  document.body.className = document.body.className
    .split(' ').filter(c => !c.startsWith('theme-')).join(' ');
  if (theme !== 'dark') document.body.classList.add('theme-' + theme);
  store.set('ui.theme', theme);
  if (typeof reRenderTab === 'function') reRenderTab('settings');
}

// Toggle sidebar collapsed state
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed');
  store.set('sidebar.collapsed', sidebar.classList.contains('collapsed'));
}

// Clear all winstreak builds
function clearAllWinstreakBuilds() {
  if (!confirm('Clear all winstreak builds?')) return;
  state.winstreakBuilds = [];
  store.set('winstreak.builds', []);
  if (typeof reRenderTab === 'function') reRenderTab('winstreak-builds');
}

function initAdditionalFeatures() {
  initGlobalSearch();
  initContextMenu();
  initQuickToolbar();
  initOfflineIndicator();
  initMemoryDisplay();
  initNotificationSoundToggle();
  initAccentPicker();
  initFontPreview();
  initWallpaperPicker();
  initScheduledTasks();
  initDragDrop();
}

// Init polish after original DOMContentLoaded runs
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initPolishFeatures, 150);
  setTimeout(initAdditionalFeatures, 300);
}, { once: true });
