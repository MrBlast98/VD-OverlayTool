param(
  [string]$ProjectRef
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $ProjectRef) {
  Write-Host 'Usage: .\scripts\push-supabase-migrations.ps1 -ProjectRef <supabase-project-ref>'
  exit 1
}

Write-Host 'Pushing Supabase migrations'
npx supabase db push --project-ref $ProjectRef
