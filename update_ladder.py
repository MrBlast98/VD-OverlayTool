#!/usr/bin/env python3
import re

# Read the file
with open('src/renderer/overlay.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the renderLadder function
old_pattern = r'function renderLadder\(\) \{[^}]*function renderQueue\(\) \{'

new_code = '''function renderLadder() {
      const payload = getData() || {};
      const ladder = payload.ladder || {};
      const cfg = ladder || {};
      const players = Array.isArray(cfg.players) ? cfg.players : [];
      const single = players[0] || {};
      const name = single.displayName || single.name || '';
      const elo = Number(single.elo || 0);
      const wins = Number(single.matchesWon || single.wins || 0);
      const losses = Number(single.matchesLost || single.losses || 0);
      const matches = Number(single.matchesPlayed || single.matches || wins + losses);
      const winrate = matches > 0 ? Math.round((wins / matches) * 100) : 0;
      const rank = single.rank || '';
      const avatar = single.avatar || '';

      // Generate win/loss badges (max 5 shown)
      const recentMatches = single.recentMatches || [];
      const badges = recentMatches.slice(0, 5).map(match => 
        `<div class="ladder-badge-item ${match.won ? 'won' : 'lost'}">${match.won ? 'W' : 'L'}</div>`
      ).join('');

      const fallbackBadges = Array(5).fill(0).map(() => 
        `<div class="ladder-badge-item neutral">-</div>`
      ).join('');

      return `
        <section class="overlay-shell ov-ladder ladder-card">
          <div class="safe-zone"></div>
          <div class="ladder-card-wrap">
            <div class="ladder-card-left">
              <div class="ladder-card-avatar">
                ${avatar ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(name)}" />` : `<div class="ladder-card-avatar-initial">${escapeHtml((name || '?').charAt(0).toUpperCase())}</div>`}
              </div>
            </div>
            <div class="ladder-card-right">
              <div class="ladder-card-header">
                <div class="ladder-card-name">${escapeHtml(name)}</div>
                ${rank ? `<div class="ladder-card-rank">Rank ${escapeHtml(String(rank))}</div>` : ''}
              </div>
              <div class="ladder-card-elo">${escapeHtml(String(elo))} ELO</div>
              <div class="ladder-card-badges">
                ${badges || fallbackBadges}
              </div>
              <div class="ladder-card-stats">
                <div class="ladder-card-stat">
                  <span class="label">WINRATE</span>
                  <span class="value">${winrate}%</span>
                </div>
                <div class="ladder-card-stat">
                  <span class="label">${escapeHtml(String(matches))} MATCHES</span>
                  <span class="value">—</span>
                </div>
                <div class="ladder-card-stat">
                  <span class="label">WINS</span>
                  <span class="value">${wins}</span>
                </div>
              </div>
              <div class="ladder-card-bar">
                <div class="ladder-card-bar-fill" style="width: ${Math.max(0, Math.min(100, winrate))}%"></div>
              </div>
            </div>
          </div>
        </section>
      `;
    }

    function renderQueue() {'''

# Replace the function - match more context
match = re.search(
    r'(    function renderLadder\(\) \{.*?    \})\s*(    function renderQueue\(\) \{)',
    content,
    re.DOTALL
)

if match:
    content = content[:match.start(1)] + '''    function renderLadder() {
      const payload = getData() || {};
      const ladder = payload.ladder || {};
      const cfg = ladder || {};
      const players = Array.isArray(cfg.players) ? cfg.players : [];
      const single = players[0] || {};
      const name = single.displayName || single.name || '';
      const elo = Number(single.elo || 0);
      const wins = Number(single.matchesWon || single.wins || 0);
      const losses = Number(single.matchesLost || single.losses || 0);
      const matches = Number(single.matchesPlayed || single.matches || wins + losses);
      const winrate = matches > 0 ? Math.round((wins / matches) * 100) : 0;
      const rank = single.rank || '';
      const avatar = single.avatar || '';

      // Generate win/loss badges (max 5 shown)
      const recentMatches = single.recentMatches || [];
      const badges = recentMatches.slice(0, 5).map(match => 
        `<div class="ladder-badge-item ${match.won ? 'won' : 'lost'}">${match.won ? 'W' : 'L'}</div>`
      ).join('');

      const fallbackBadges = Array(5).fill(0).map(() => 
        `<div class="ladder-badge-item neutral">-</div>`
      ).join('');

      return `
        <section class="overlay-shell ov-ladder ladder-card">
          <div class="safe-zone"></div>
          <div class="ladder-card-wrap">
            <div class="ladder-card-left">
              <div class="ladder-card-avatar">
                ${avatar ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(name)}" />` : `<div class="ladder-card-avatar-initial">${escapeHtml((name || '?').charAt(0).toUpperCase())}</div>`}
              </div>
            </div>
            <div class="ladder-card-right">
              <div class="ladder-card-header">
                <div class="ladder-card-name">${escapeHtml(name)}</div>
                ${rank ? `<div class="ladder-card-rank">Rank ${escapeHtml(String(rank))}</div>` : ''}
              </div>
              <div class="ladder-card-elo">${escapeHtml(String(elo))} ELO</div>
              <div class="ladder-card-badges">
                ${badges || fallbackBadges}
              </div>
              <div class="ladder-card-stats">
                <div class="ladder-card-stat">
                  <span class="label">WINRATE</span>
                  <span class="value">${winrate}%</span>
                </div>
                <div class="ladder-card-stat">
                  <span class="label">${escapeHtml(String(matches))} MATCHES</span>
                  <span class="value">—</span>
                </div>
                <div class="ladder-card-stat">
                  <span class="label">WINS</span>
                  <span class="value">${wins}</span>
                </div>
              </div>
              <div class="ladder-card-bar">
                <div class="ladder-card-bar-fill" style="width: ${Math.max(0, Math.min(100, winrate))}%"></div>
              </div>
            </div>
          </div>
        </section>
      `;
    }

    ''' + content[match.end(1):]
    
    # Write the file back
    with open('src/renderer/overlay.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Updated renderLadder function successfully")
else:
    print("ERROR: Could not find renderLadder function")
