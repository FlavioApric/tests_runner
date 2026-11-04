<#
.SYNOPSIS
  Create one public qa-fleet runner repo in a GitHub organisation and register it in ~/.qa-fleet/fleet.json.
.DESCRIPTION
  Run it once per organisation (5 orgs = about 100 parallel jobs). YOU run it: it asks for the secrets,
  nothing is stored in a repo. Needs: gh (logged in as the org owner), git, node.
  Steps: create <Org>/<Name> (public), push this qa-fleet folder to it, set secrets and variables,
  add the runner (with its dispatch PAT) to fleet.json.
.EXAMPLE
  .\setup\new-runner.ps1 -Org my-qa-org-1 -Sources me/private-app
.EXAMPLE
  .\setup\new-runner.ps1 -Org my-qa-org-2 -Sources me/private-app,me/other-app -SkipSecrets STRIPE_TEST_KEY
#>
param(
  [Parameter(Mandatory)] [string] $Org,
  [Parameter(Mandatory)] [string[]] $Sources,          # private repos this runner may test (vars.ALLOWED_SOURCES)
  [string] $Name = 'tests_runner',
  [string[]] $ExtraSecrets = @('STRIPE_TEST_KEY'),  # asked one by one, Enter = skip (never Claude credentials: Claude runs only locally)
  [string] $Config = $(if ($env:QA_FLEET_CONFIG) { $env:QA_FLEET_CONFIG } else { Join-Path $HOME '.qa-fleet\fleet.json' }),
  [int] $MaxParallel = 20,
  [switch] $DryRun
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repo = "$Org/$Name"
function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Run([string]$exe, [string[]]$a) { if ($DryRun) { Write-Host "DRY: $exe $($a -join ' ')"; return } & $exe @a; if ($LASTEXITCODE) { throw "$exe failed ($LASTEXITCODE)" } }
function Ask([string]$label) {
  $s = Read-Host -AsSecureString $label
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function SetSecret([string]$n, [string]$v) {
  if ($DryRun) { Write-Host "DRY: gh secret set $n -R $repo"; return }
  $v | gh secret set $n -R $repo; if ($LASTEXITCODE) { throw "gh secret set $n failed" }
}

# the public recipient key (the private one stays in identity.key next to fleet.json)
$idPath = Join-Path (Split-Path -Parent $Config) 'identity.key'
if (-not (Test-Path $idPath)) { throw "no $idPath : run first  node $root\cli\fleet.mjs keygen" }
$recipient = node -e "const s=require('fs').readFileSync(process.argv[1],'utf8').trim().split(':');process.stdout.write('qafpub1:'+s[2])" $idPath
if ($recipient -notmatch '^qafpub1:[A-Za-z0-9_-]{43}$') { throw "cannot derive the public key from $idPath" }

Step "create public repo $repo"
gh repo view $repo *> $null
if ($LASTEXITCODE) { Run gh @('repo', 'create', $repo, '--public', '--description', 'qa-fleet runner (workflow_dispatch only, results are encrypted)') } else { Write-Host "exists" }

Step "push the runner code (main)"
Push-Location $root
try {
  if (-not $DryRun -and (git status --porcelain)) { throw "commit the qa-fleet changes first: the runner gets the committed main" }
  Run gh @('auth', 'setup-git')
  Run git @('push', "https://github.com/$repo.git", 'HEAD:refs/heads/main')
} finally { Pop-Location }

Step "Actions: allow only actions pinned to a SHA is enforced in the workflow; making sure Actions is enabled"
Run gh @('api', '-X', 'PUT', "repos/$repo/actions/permissions", '-F', 'enabled=true', '-f', 'allowed_actions=all')
# fork PR workflows never run here: the only trigger is workflow_dispatch

Step "secrets"
Write-Host "SOURCE_REPO_TOKEN = fine-grained PAT, READ-ONLY Contents on: $($Sources -join ', ')"
$t = Ask 'SOURCE_REPO_TOKEN'
if (-not $t) { throw 'SOURCE_REPO_TOKEN is required' }
SetSecret 'SOURCE_REPO_TOKEN' $t; $t = $null
foreach ($n in $ExtraSecrets) {
  $v = Ask "$n (Enter = skip)"
  if ($v) { SetSecret $n $v } else { Write-Host "skipped $n" }
  $v = $null
}

Step "variables"
Run gh @('variable', 'set', 'FLEET_RECIPIENT', '-R', $repo, '--body', $recipient)
Run gh @('variable', 'set', 'ALLOWED_SOURCES', '-R', $repo, '--body', ($Sources -join ','))

Step "dispatch token for fleet.json"
Write-Host "Fine-grained PAT owned by $Org, repo $repo only: Actions read+write, Metadata read, Secrets read, Variables read."
$pat = Ask 'dispatch PAT'
if (-not $pat) { throw 'dispatch PAT is required' }
if ($DryRun) { Write-Host "DRY: add $repo to $Config"; return }
New-Item -ItemType Directory -Force (Split-Path -Parent $Config) | Out-Null
$env:QAF_PAT = $pat; $pat = $null
node -e @"
const fs=require('fs'),p=process.argv[1],repo=process.argv[2],max=+process.argv[3],src=process.argv[4].split(',')
const c=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{runners:[],sources:{}}
c.runners=(c.runners||[]).filter(r=>r.repo!==repo)
c.runners.push({name:repo.split('/')[0],repo,token:process.env.QAF_PAT,maxParallel:max})
c.sources=c.sources||{}
for(const s of src){const k=s.split('/')[1];if(!c.sources[k])c.sources[k]={repo:s}}
fs.writeFileSync(p,JSON.stringify(c,null,1))
console.log('fleet.json: '+c.runners.length+' runner(s)')
"@ $Config $repo $MaxParallel ($Sources -join ',')
Remove-Item Env:QAF_PAT
Step "check"
node "$root\cli\fleet.mjs" status
