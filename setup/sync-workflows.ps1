<#
.SYNOPSIS
  Push the committed qa-fleet main to every runner repo listed in ~/.qa-fleet/fleet.json (keeps the 5 runners identical).
.EXAMPLE
  .\setup\sync-workflows.ps1 -DryRun
#>
param(
  [string] $Config = $(if ($env:QA_FLEET_CONFIG) { $env:QA_FLEET_CONFIG } else { Join-Path $HOME '.qa-fleet\fleet.json' }),
  [switch] $DryRun
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repos = node -e "const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(c.runners.filter(r=>r.enabled!==false).map(r=>r.repo).join('\n'))" $Config
Push-Location $root
try {
  if (git status --porcelain) { throw 'commit the qa-fleet changes first' }
  $sha = git rev-parse --short HEAD
  gh auth setup-git
  foreach ($r in ($repos -split "`n" | Where-Object { $_ })) {
    if ($DryRun) { Write-Host "DRY: push $sha -> $r main"; continue }
    git push "https://github.com/$r.git" 'HEAD:refs/heads/main'
    if ($LASTEXITCODE) { Write-Warning "push to $r failed" } else { Write-Host "$r <- $sha" }
  }
} finally { Pop-Location }
