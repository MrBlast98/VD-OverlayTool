# Read the file
$filePath = "src/renderer/overlay.html"
$content = Get-Content $filePath -Raw

# Find the insertion point (after existing ladder styles)
$insertAfter = ".ladder-full-col { flex:1; display:flex; gap:12px; align-items:center }`n    .ladder-full-col .ladder-avatar { width:120px; height:120px }"

$newCSS = @'

    /* New Ladder Card Design */
    .ladder-card { 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      padding: 0;
    }

    .ladder-card-wrap {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 24px;
      align-items: center;
      padding: 20px 28px;
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(20, 25, 35, 0.96), rgba(15, 18, 28, 0.94));
      border: 1px solid rgba(100, 150, 200, 0.12);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
      min-width: min(560px, 96vw);
      color: var(--overlay-text);
    }

    .ladder-card-left {
      display: flex;
      justify-content: center;
    }

    .ladder-card-avatar {
      width: 92px;
      height: 92px;
      border-radius: 50%;
      background: radial-gradient(circle at 30% 30%, rgba(100, 150, 200, 0.15), rgba(15, 18, 28, 0.6));
      border: 1px solid rgba(100, 150, 200, 0.18);
      display: grid;
      place-items: center;
      overflow: hidden;
      box-shadow: 0 0 0 8px rgba(100, 150, 200, 0.06), 0 8px 28px rgba(0, 0, 0, 0.3);
    }

    .ladder-card-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .ladder-card-avatar-initial {
      font-size: 42px;
      font-weight: 900;
      color: #fff;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
    }

    .ladder-card-right {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }

    .ladder-card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      justify-content: space-between;
    }

    .ladder-card-name {
      color: #fff;
      font-size: 28px;
      font-weight: 900;
      letter-spacing: 0.5px;
    }

    .ladder-card-rank {
      color: rgba(200, 220, 255, 0.9);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 1px;
      text-transform: uppercase;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(100, 150, 200, 0.18);
      background: rgba(100, 150, 200, 0.08);
      white-space: nowrap;
    }

    .ladder-card-elo {
      color: #fff;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 0.3px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .ladder-card-badges {
      display: flex;
      gap: 6px;
      margin: 4px 0;
    }

    .ladder-badge-item {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.5px;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }

    .ladder-badge-item.won {
      background: rgba(100, 200, 100, 0.18);
      color: #64c864;
      border-color: rgba(100, 200, 100, 0.25);
      box-shadow: 0 0 12px rgba(100, 200, 100, 0.15);
    }

    .ladder-badge-item.lost {
      background: rgba(200, 100, 100, 0.18);
      color: #ff7070;
      border-color: rgba(200, 100, 100, 0.25);
      box-shadow: 0 0 12px rgba(200, 100, 100, 0.15);
    }

    .ladder-badge-item.neutral {
      background: rgba(255, 255, 255, 0.04);
      color: rgba(255, 255, 255, 0.36);
      border-color: rgba(255, 255, 255, 0.08);
    }

    .ladder-card-stats {
      display: flex;
      gap: 32px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(100, 150, 200, 0.08);
    }

    .ladder-card-stat {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .ladder-card-stat .label {
      color: rgba(200, 220, 255, 0.58);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 1.2px;
      text-transform: uppercase;
    }

    .ladder-card-stat .value {
      color: #fff;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }

    .ladder-card-bar {
      height: 8px;
      border-radius: 999px;
      background: rgba(100, 150, 200, 0.08);
      overflow: hidden;
      border: 1px solid rgba(100, 150, 200, 0.12);
      margin-top: 8px;
    }

    .ladder-card-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #64b4ff, #a0d8ff);
      border-radius: inherit;
      box-shadow: 0 0 12px rgba(100, 180, 255, 0.3);
      transition: width 800ms cubic-bezier(0.22, 0.9, 0.28, 1);
      will-change: width;
    }
'@

# Find the insertion point
$insertIndex = $content.LastIndexOf(".ladder-full-col .ladder-avatar { width:120px; height:120px }")
if ($insertIndex -eq -1) {
    Write-Output "ERROR: Could not find insertion point"
    exit 1
}

# Find the end of this line
$lineEnd = $content.IndexOf("`n", $insertIndex)
if ($lineEnd -eq -1) {
    Write-Output "ERROR: Could not find end of insertion point line"
    exit 1
}

# Insert the new CSS
$newContent = $content.Substring(0, $lineEnd + 1) + $newCSS + $content.Substring($lineEnd + 1)

# Write back
$newContent | Set-Content $filePath -Encoding UTF8
Write-Output "Added ladder card CSS styles"
