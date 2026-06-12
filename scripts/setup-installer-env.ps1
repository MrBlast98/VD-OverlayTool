param(
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\installer.env'),
  [string]$SupabaseUrl,
  [string]$LicenseValidateEndpoint
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $SupabaseUrl) {
  $SupabaseUrl = Read-Host 'Enter Supabase URL (https://...)'
}

if (-not $LicenseValidateEndpoint) {
  $LicenseValidateEndpoint = Read-Host 'Enter license validate endpoint URL (optional, press Enter to skip)'
}

$lines = @(
  "SUPABASE_URL=$SupabaseUrl"
)

if ($LicenseValidateEndpoint) {
  $lines += "LICENSE_VALIDATE_ENDPOINT=$LicenseValidateEndpoint"
}

$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
Set-Content -Path $OutputPath -Value $content -Encoding UTF8
Write-Host "Wrote installer env file to $OutputPath"
