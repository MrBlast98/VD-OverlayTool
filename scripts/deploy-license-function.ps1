param(
  [string]$ProjectRef,
  [string]$FunctionName = 'license-validate'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $ProjectRef) {
  Write-Host 'Usage: .\scripts\deploy-license-function.ps1 -ProjectRef <supabase-project-ref>'
  exit 1
}

Write-Host "Deploying Supabase function: $FunctionName"
npx supabase functions deploy $FunctionName --project-ref $ProjectRef
