<#
.SYNOPSIS
  Deploys the Starfish Foundry-governance sidecar (azure/bicep/sidecar-container-app.bicep) as a real,
  working TEST environment in your own Azure subscription.

.DESCRIPTION
  This is not a review-only script -- steps 3 onward create real, billable Azure resources (a resource
  group if it does not already exist, a Container Registry, a Key Vault, a Storage Account/File Share,
  a Log Analytics workspace, a Managed Identity, and a Container App). Run with -DryRun first to see
  exactly what it would do without touching anything.

  What it does, in order:
    1. Confirms the Azure CLI is installed and you are logged in (prompts `az login` if not).
    2. Creates the resource group (if missing).
    3. Creates a Container Registry and builds the sidecar image into it via `az acr build` (a cloud
       build -- this does NOT require Docker Desktop or any local container runtime). This runs the
       repo's own documented two-step build (azure/sidecar/build.mjs, then the Dockerfile) exactly as
       azure/sidecar/Dockerfile's own header comment specifies.
    4. Creates an RBAC-authorization Key Vault, generates two fresh random bearer tokens (for the
       "worker" and "operator" actors azure/sidecar/entrypoint.mjs expects), and stores them as the
       STARFISH_TOKENS_JSON secret. The plaintext tokens are also written to a local, gitignored file
       so you can actually call the deployed sidecar afterward.
    5. Seeds a minimal, safe test governed root locally (one low-risk test tool, one test agent, via
       azure/sidecar/foundry-seed.mjs -- see that file's own header for why this deliberately ships an
       empty policies.json and is still safe).
    6. Deploys the Bicep template itself, using Microsoft's public "containerapps-helloworld" image as
       a placeholder for the required `appImage` parameter (there is no real customer app for a pure
       test environment -- see the README section this script ships with for why that is the right
       placeholder and how to swap in a real app image later).
    7. Grants the deployed identity "AcrPull" on the registry and "Key Vault Secrets User" on the vault
       (both deliberately left OUT of the Bicep template itself -- see the template's own comments).
    8. Uploads the locally-seeded governed root to the Azure Files share the sidecar mounts at /data.
    9. Restarts the Container App revision so it picks up the now-resolvable Key Vault secret and the
       now-present seeded root, then tails the sidecar container's logs so you can see it actually boot.

  Idempotent where practical (existing resource group / registry / vault are reused, not recreated),
  but this is a first-of-its-kind script for a real deployment -- read the output of a -DryRun run
  before doing a real one, same as Apply-ServeFix.ps1's own standing advice.

.PARAMETER RepoRoot
  Path to your Starfish checkout. Defaults to the path used throughout this engagement.

.PARAMETER ResourceGroup
  Azure resource group to create/use. Defaults to "starfish-test" so it is obviously separate from
  your existing CCDAIPLedger and rg-wavefront-dev groups.

.PARAMETER Location
  Azure region. Defaults to "canadacentral" to match your existing resource groups.

.PARAMETER NamePrefix
  Prefix for every resource this creates. Defaults to "starfish-test". Keep it short -- some derived
  resource names (storage account, ACR) have tight length limits.

.PARAMETER SubscriptionId
  Defaults to the one subscription found on your account ("Azure subscription 1",
  c04215e0-32b4-43c1-92c9-38bea71643f7) -- the one the Founders Hub activity feed evidence pointed to
  as the sponsored subscription. Override if you want this on a different one.

.PARAMETER SkipBuild
  Skip the npm ci / build.mjs / az acr build steps and reuse whatever image tag already exists in the
  registry at $NamePrefix-acr / starfish-sidecar:test. Use this on a re-run after the first successful
  build, to save several minutes.

.PARAMETER DryRun
  Print every step and every az/node command this would run, without executing anything that creates,
  modifies, or deletes an Azure resource or a local file.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = "C:\Users\swhol\Documents\Github\Starfish",
    [string]$ResourceGroup = "starfish-test",
    [string]$Location = "canadacentral",
    [string]$NamePrefix = "starfish-test",
    [string]$SubscriptionId = "c04215e0-32b4-43c1-92c9-38bea71643f7",
    [switch]$SkipBuild,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

# ---------------------------------------------------------------------------
# Native-command wrappers (same pattern Apply-ServeFix.ps1 uses, and for the
# same reason: PowerShell 7.3+'s $PSNativeCommandUseErrorActionPreference can
# turn a native command's stderr+exit-code combination into a terminating
# exception independent of stream redirection -- disabling the preference
# variable alone was proven NOT sufficient during that script's own debugging).
# ---------------------------------------------------------------------------
function Invoke-Native {
    param([Parameter(Mandatory)][string]$FilePath, [string[]]$ArgumentList = @())
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $global:LASTNATIVEEXIT = 0
    $result = @()
    try {
        $result = & $FilePath @ArgumentList 2>&1 | ForEach-Object { $_.ToString() }
        $global:LASTNATIVEEXIT = $LASTEXITCODE
    } catch {
        if ($_.Exception -and $_.Exception.Message) { $result = @($_.Exception.Message) }
        $global:LASTNATIVEEXIT = 1
    } finally {
        $ErrorActionPreference = $prevEap
    }
    return $result
}

function Invoke-NativeVisible {
    param([Parameter(Mandatory)][string]$FilePath, [string[]]$ArgumentList = @())
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $global:LASTNATIVEEXIT = 0
    try {
        & $FilePath @ArgumentList
        $global:LASTNATIVEEXIT = $LASTEXITCODE
    } catch {
        Write-Info "(native command reported: $($_.Exception.Message))"
        $global:LASTNATIVEEXIT = 1
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Format-RedactedArgs {
    # Found on a real run: this script's own command-echo printed a live storage account key straight to
    # the terminal (--account-key is followed by the raw key value) -- and from there into anything that
    # gets copy-pasted for troubleshooting, including back into this chat. Redact the value that follows
    # any flag that takes a secret, in the DISPLAYED command only -- the real, unredacted args are still
    # what actually gets passed to az.
    #
    # Found immediately AFTER writing that fix, by actually testing it rather than assuming it worked:
    # a function whose ONLY declared parameter is named $Args is a real, documented PowerShell footgun --
    # $args is the automatic variable for a function's unbound arguments, and when a function has nothing
    # else to bind, the explicit parameter silently loses whatever was passed to it, both by name
    # (-Args @(...)) and positionally, confirmed directly: `param([string[]]$Args)` called either way
    # always returns empty from inside the function. The net effect was every "  > az ..." / "  [DRYRUN]"
    # log line collapsing to just "az" with no arguments at all -- not a security problem (arguably it
    # over-redacted), but it made every progress line in this script useless. Renamed the parameter to
    # $ArgList (Invoke-Az's OWN $Args parameter below does NOT have this problem -- verified separately --
    # because it has other declared parameters alongside it; only a function whose sole parameter is named
    # Args hits this).
    param([string[]]$ArgList)
    $secretFlags = @('--account-key', '--value', '--password', '--client-secret', '--sas-token', '--connection-string')
    $out = @()
    $redactNext = $false
    foreach ($a in $ArgList) {
        if ($redactNext) { $out += '<redacted>'; $redactNext = $false; continue }
        $out += $a
        if ($secretFlags -contains $a) { $redactNext = $true }
    }
    return $out
}

function Invoke-Az {
    param(
        [Parameter(Mandatory)][string[]]$Args,
        [switch]$IgnoreError,
        [switch]$Visible
    )
    $display = "az " + ((Format-RedactedArgs -ArgList $Args) -join ' ')
    if ($DryRun) {
        Write-Host "  [DRYRUN] $display" -ForegroundColor DarkGray
        return @()
    }
    Write-Host "  > $display" -ForegroundColor DarkGray
    if ($Visible) {
        Invoke-NativeVisible -FilePath 'az' -ArgumentList $Args
        $out = @()
    } else {
        $out = Invoke-Native -FilePath 'az' -ArgumentList $Args
    }
    if ($global:LASTNATIVEEXIT -ne 0 -and -not $IgnoreError) {
        Write-Host ($out -join "`n") -ForegroundColor Red
        throw "az $($Args[0]) failed (exit $($global:LASTNATIVEEXIT)) -- see output above."
    }
    return $out
}

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Info($msg) { Write-Host $msg -ForegroundColor Gray }
function Write-Ok($msg)   { Write-Host $msg -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host $msg -ForegroundColor Yellow }

if ($DryRun) { Write-Warn2 "DRY RUN -- nothing will actually be created, changed, or uploaded." }

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------
Write-Step "1. Preflight: Azure CLI"

$azVersionRaw = Invoke-Native -FilePath 'az' -ArgumentList @('version', '-o', 'tsv')
if ($global:LASTNATIVEEXIT -ne 0) {
    Write-Host "Azure CLI (az) was not found on PATH." -ForegroundColor Red
    Write-Host "Install it from https://aka.ms/installazurecliwindows, restart your terminal, and re-run this script." -ForegroundColor Red
    exit 1
}
Write-Ok "az CLI found."

$accountRaw = Invoke-Native -FilePath 'az' -ArgumentList @('account', 'show', '-o', 'json')
if ($global:LASTNATIVEEXIT -ne 0) {
    Write-Warn2 "Not logged in -- launching 'az login' (a browser window should open)."
    Invoke-Az -Args @('login') -Visible | Out-Null
}

Write-Step "1b. Selecting subscription $SubscriptionId"
Invoke-Az -Args @('account', 'set', '--subscription', $SubscriptionId) | Out-Null
Write-Ok "Subscription set."

# ---------------------------------------------------------------------------
# 1c. Resource providers -- registered here, upfront, rather than found out the hard way partway through.
# On a subscription that has never used one of these services before (plausible for a fresh Founders Hub
# subscription that has, so far, only ever talked to Cognitive Services/Foundry), the first create against
# an unregistered provider fails -- this is idempotent and fast if already registered, so always run it.
# ---------------------------------------------------------------------------
Write-Step "1c. Ensuring required resource providers are registered"
$requiredProviders = @('Microsoft.App', 'Microsoft.ContainerRegistry', 'Microsoft.ManagedIdentity', 'Microsoft.KeyVault', 'Microsoft.Storage', 'Microsoft.OperationalInsights', 'Microsoft.Authorization')
foreach ($ns in $requiredProviders) {
    if (-not $DryRun) {
        Invoke-Az -Args @('provider', 'register', '--namespace', $ns) -IgnoreError | Out-Null
    } else {
        Write-Host "  [DRYRUN] az provider register --namespace $ns" -ForegroundColor DarkGray
    }
}
Write-Info "Registration requested for all required providers (may still be finishing in the background for a brand-new subscription -- if a later step fails with a registration-related error, wait a minute and re-run; every step in this script is safe to re-run)."

# ---------------------------------------------------------------------------
# 2. Resource group
# ---------------------------------------------------------------------------
Write-Step "2. Resource group '$ResourceGroup' in $Location"
Invoke-Az -Args @('group', 'create', '--name', $ResourceGroup, '--location', $Location) -IgnoreError | Out-Null
Write-Ok "Resource group ready."

# ---------------------------------------------------------------------------
# 3. Container registry + sidecar image build
# ---------------------------------------------------------------------------
$acrNameRaw = ($NamePrefix -replace '[^a-zA-Z0-9]', '') + 'acr'
$acrCandidate = $acrNameRaw.ToLower().Substring(0, [Math]::Min(50, $acrNameRaw.Length))

Write-Step "3. Container registry '$acrCandidate'"
$acrName = $null
if ($DryRun) {
    $acrName = $acrCandidate
    Write-Host "  [DRYRUN] az acr create --name $acrCandidate ..." -ForegroundColor DarkGray
} else {
    $existingAcr = Invoke-Native -FilePath 'az' -ArgumentList @('acr', 'show', '--name', $acrCandidate, '-o', 'json')
    if ($global:LASTNATIVEEXIT -eq 0) {
        $acrName = $acrCandidate
        Write-Info "Registry '$acrName' already exists -- reusing it."
    } else {
        # NOTE: earlier revision of this step used -IgnoreError here, which silently swallowed the actual
        # az CLI error text on a genuine creation failure (not just a "name already exists" case) -- the
        # first real run hit exactly that: acr create failed silently, then acr build failed two steps
        # later with a confusing "resource ... could not be found" instead of the real cause. Fixed: no
        # -IgnoreError now, every create is verified by re-checking existence, and a real failure's actual
        # output is shown before this throws, instead of being hidden.
        $attempt = $acrCandidate
        for ($i = 0; $i -lt 3; $i++) {
            Write-Host "  > az acr create --name $attempt --resource-group $ResourceGroup --sku Basic --admin-enabled false" -ForegroundColor DarkGray
            $createOut = Invoke-Native -FilePath 'az' -ArgumentList @('acr', 'create', '--name', $attempt, '--resource-group', $ResourceGroup, '--sku', 'Basic', '--admin-enabled', 'false')
            if ($global:LASTNATIVEEXIT -eq 0) { $acrName = $attempt; break }
            $createOutText = ($createOut -join "`n")
            if ($createOutText -match 'already in use|is not available|NameNotAvailable|already exists') {
                $suffix = -join ((48..57) + (97..122) | Get-Random -Count 4 | ForEach-Object { [char]$_ })
                $attempt = ($acrCandidate.Substring(0, [Math]::Min(42, $acrCandidate.Length)) + $suffix)
                Write-Warn2 "Registry name collision (ACR names are globally unique across all of Azure) -- retrying as '$attempt'."
            } else {
                Write-Host $createOutText -ForegroundColor Red
                throw "az acr create failed for a reason other than a name collision -- see the real output above. A common first-time cause is the Microsoft.ContainerRegistry resource provider not yet being registered on this subscription; try 'az provider register --namespace Microsoft.ContainerRegistry --wait' and re-run this script (it is safe to re-run -- every step so far is idempotent)."
            }
        }
        if (-not $acrName) { throw "Could not create a Container Registry after 3 attempts -- pick a different -NamePrefix and re-run." }
    }
}
$acrLoginServer = "$acrName.azurecr.io"
Write-Ok "Registry ready: $acrLoginServer"

if ($SkipBuild) {
    Write-Info "SkipBuild set -- assuming $acrLoginServer/starfish-sidecar:test already exists from a prior run."
} else {
    Write-Step "3b. Building sidecar image (node build.mjs, then az acr build -- cloud build, no local Docker needed)"
    if (-not (Test-Path $RepoRoot)) {
        throw "RepoRoot '$RepoRoot' does not exist."
    }
    Push-Location $RepoRoot
    try {
        if (-not $DryRun) {
            if (-not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
                Write-Info "node_modules missing -- running npm ci first (this can take a few minutes)."
                Invoke-NativeVisible -FilePath 'npm' -ArgumentList @('ci')
                if ($global:LASTNATIVEEXIT -ne 0) { throw "npm ci failed." }
            } else {
                Write-Info "node_modules already present -- skipping npm ci."
            }
            Write-Info "Bundling sidecar entrypoint (azure/sidecar/build.mjs)..."
            Invoke-NativeVisible -FilePath 'node' -ArgumentList @('azure/sidecar/build.mjs')
            if ($global:LASTNATIVEEXIT -ne 0) { throw "node azure/sidecar/build.mjs failed." }
            if (-not (Test-Path 'azure/sidecar/dist/sidecar.mjs')) {
                throw "azure/sidecar/dist/sidecar.mjs was not produced -- check the build.mjs output above."
            }
        } else {
            Write-Host "  [DRYRUN] npm ci (if node_modules missing)" -ForegroundColor DarkGray
            Write-Host "  [DRYRUN] node azure/sidecar/build.mjs" -ForegroundColor DarkGray
        }

    } finally {
        Pop-Location
    }

    # Found on TWO real runs now: `az acr build`'s context upload walked into node_modules and crashed
    # with WinError 1921 ("the name of the file cannot be resolved") on a repeating
    # "@starfish/desktop/app/node_modules/@starfish/desktop/app/..." path -- a self-referential
    # symlink/junction this repo's npm workspaces produce on Windows. A `.dockerignore` excluding
    # node_modules was tried first and did NOT fix it -- the log line right before the crash
    # ("...based on default ignore rules") shows az acr build's context-archiver walks the ENTIRE tree
    # to enumerate it before applying any ignore pattern, so it still descends into the cyclic
    # node_modules symlink and crashes before .dockerignore's exclusion is ever consulted. That is a
    # real limitation of az acr build's context-packaging on Windows, not something a `.dockerignore`
    # line can work around.
    #
    # Real fix: never give it the repo root as the build context at all. azure/sidecar/Dockerfile only
    # COPYs one file (azure/sidecar/dist/sidecar.mjs, already-bundled, dependency-free -- see the
    # Dockerfile's own header comment for why it deliberately runs no npm/esbuild itself), so the build
    # context only needs to contain that one file at that one relative path. Stage a minimal, throwaway
    # context directory with just that -- it never touches node_modules, so the crash cannot happen.
    if (-not $DryRun) {
        $buildContextDir = Join-Path ([System.IO.Path]::GetTempPath()) ("starfish-acr-context-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
        $contextDistDir = Join-Path $buildContextDir 'azure\sidecar\dist'
        New-Item -ItemType Directory -Path $contextDistDir -Force | Out-Null
        Copy-Item -Path (Join-Path $RepoRoot 'azure\sidecar\Dockerfile') -Destination (Join-Path $buildContextDir 'azure\sidecar\Dockerfile') -Force
        Copy-Item -Path (Join-Path $RepoRoot 'azure\sidecar\dist\sidecar.mjs') -Destination (Join-Path $contextDistDir 'sidecar.mjs') -Force
        Write-Info "Staged a minimal build context (Dockerfile + the bundled sidecar.mjs only, no node_modules) at $buildContextDir"
        try {
            Write-Info "Building and pushing the image via ACR Tasks..."
            Invoke-Az -Args @('acr', 'build', '--registry', $acrName, '--image', 'starfish-sidecar:test', '--file', (Join-Path $buildContextDir 'azure\sidecar\Dockerfile'), $buildContextDir) -Visible
        } finally {
            Remove-Item -Path $buildContextDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "  [DRYRUN] would stage a minimal build context (Dockerfile + sidecar.mjs only) and run az acr build against it" -ForegroundColor DarkGray
    }
    Write-Ok "Sidecar image built: $acrLoginServer/starfish-sidecar:test"
}

# ---------------------------------------------------------------------------
# 4. Key Vault + bearer tokens
# ---------------------------------------------------------------------------
$vaultName = $null
$vaultCandidate = (($NamePrefix -replace '[^a-zA-Z0-9-]', '') + '-kv').ToLower()
$vaultCandidate = $vaultCandidate.Substring(0, [Math]::Min(24, $vaultCandidate.Length))

Write-Step "4. Key Vault '$vaultCandidate'"
if ($DryRun) {
    $vaultName = $vaultCandidate
    Write-Host "  [DRYRUN] az keyvault create --name $vaultCandidate ..." -ForegroundColor DarkGray
} else {
    $existing = Invoke-Native -FilePath 'az' -ArgumentList @('keyvault', 'show', '--name', $vaultCandidate, '-o', 'json')
    if ($global:LASTNATIVEEXIT -eq 0) {
        $vaultName = $vaultCandidate
        Write-Info "Vault '$vaultName' already exists -- reusing it."
    } else {
        $attempt = $vaultCandidate
        for ($i = 0; $i -lt 3; $i++) {
            Invoke-Az -Args @('keyvault', 'create', '--name', $attempt, '--resource-group', $ResourceGroup, '--location', $Location, '--enable-rbac-authorization', 'true') -IgnoreError | Out-Null
            $check = Invoke-Native -FilePath 'az' -ArgumentList @('keyvault', 'show', '--name', $attempt, '-o', 'json')
            if ($global:LASTNATIVEEXIT -eq 0) { $vaultName = $attempt; break }
            $suffix = -join ((48..57) + (97..122) | Get-Random -Count 4 | ForEach-Object { [char]$_ })
            $attempt = ($vaultCandidate.Substring(0, [Math]::Min(19, $vaultCandidate.Length)) + '-' + $suffix)
            Write-Warn2 "Vault name collision (Key Vault names are globally unique across all of Azure) -- retrying as '$attempt'."
        }
        if (-not $vaultName) { throw "Could not create a Key Vault after 3 attempts -- pick a different -NamePrefix and re-run." }
    }
}
Write-Ok "Vault: $vaultName"

# Found on a real run: this vault is created with -enable-rbac-authorization true (needed later so the
# deployed identity can be granted "Key Vault Secrets User" -- see step 7), but that also means *writing*
# the tokens secret right now, as yourself, needs an explicit RBAC data-plane role too -- being Owner (or
# even Contributor) on the subscription is NOT enough. Built-in Owner's role definition grants `actions:
# ["*"]` but no `dataActions` at all, and an RBAC-enabled vault's secret operations are dataActions --
# confirmed by the real 403 this hit ("ForbiddenByRbac", Action 'Microsoft.KeyVault/vaults/secrets/
# setSecret/action', Assignment: (not found)). Grant yourself Key Vault Secrets Officer before trying to
# write anything.
Write-Step "4a2. Granting yourself Key Vault Secrets Officer on $vaultName (needed to write the secret below, even as Owner)"
if (-not $DryRun) {
    $callerObjectId = (Invoke-Native -FilePath 'az' -ArgumentList @('ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv')) -join ''
    if ($callerObjectId) {
        $vaultIdForRbac = (Invoke-Native -FilePath 'az' -ArgumentList @('keyvault', 'show', '--name', $vaultName, '--query', 'id', '-o', 'tsv')) -join ''
        Invoke-Az -Args @('role', 'assignment', 'create', '--assignee-object-id', $callerObjectId, '--assignee-principal-type', 'User', '--role', 'Key Vault Secrets Officer', '--scope', $vaultIdForRbac) -IgnoreError | Out-Null
        Write-Info "Granted (or already had) Key Vault Secrets Officer. RBAC can take a couple minutes to propagate -- the next step retries on Forbidden rather than failing immediately."
    } else {
        Write-Warn2 "Could not determine your signed-in user's object id (are you logged in as a service principal rather than a user account?) -- if the secret-set step below still fails with Forbidden, grant yourself 'Key Vault Secrets Officer' on $vaultName manually in the Portal and re-run."
    }
} else {
    Write-Host "  [DRYRUN] would grant yourself Key Vault Secrets Officer on $vaultName" -ForegroundColor DarkGray
}

Write-Step "4b. Generating test bearer tokens"
$workerToken = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
$operatorToken = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
$tokensObj = [ordered]@{ worker = $workerToken; operator = $operatorToken }
$tokensJson = ($tokensObj | ConvertTo-Json -Compress)

if (-not $DryRun) {
    # Found on a real run: entrypoint.mjs booted, read the secret, and failed with "STARFISH_TOKENS_JSON
    # is not valid JSON" -- the secret WAS set (no error from the command below), but its actual value in
    # Key Vault was mangled. Root cause: passing a string containing embedded double quotes
    # ({"worker":"...","operator":"..."}) as a native command-line argument via PowerShell's `&` call
    # operator is not reliable -- how PowerShell re-quotes an argument for the underlying Win32 argv
    # differs across PowerShell versions and can silently drop or alter the embedded quotes, so what
    # actually reached az (and got stored) was not the JSON string constructed above. Fixed by writing the
    # JSON to a temp file and using `--file` instead of `--value` -- this passes the exact bytes through a
    # file read, with no argv quoting involved at all.
    $tokensTempFile = Join-Path ([System.IO.Path]::GetTempPath()) ("starfish-tokens-" + [guid]::NewGuid().ToString('N').Substring(0, 8) + ".json")
    Set-Content -Path $tokensTempFile -Value $tokensJson -NoNewline -Encoding ascii
    try {
        $secretSetOk = $false
        $maxAttempts = 8
        for ($i = 1; $i -le $maxAttempts; $i++) {
            $setOut = Invoke-Native -FilePath 'az' -ArgumentList @('keyvault', 'secret', 'set', '--vault-name', $vaultName, '--name', 'starfish-tokens-json', '--file', $tokensTempFile)
            if ($global:LASTNATIVEEXIT -eq 0) { $secretSetOk = $true; break }
            $setOutText = ($setOut -join "`n")
            if ($setOutText -match 'Forbidden|ForbiddenByRbac' -and $i -lt $maxAttempts) {
                Write-Warn2 "Attempt $i/$maxAttempts`: still Forbidden (RBAC still propagating) -- waiting 15s and retrying..."
                Start-Sleep -Seconds 15
            } else {
                Write-Host $setOutText -ForegroundColor Red
                throw "az keyvault secret set failed (exit $($global:LASTNATIVEEXIT)) -- see output above."
            }
        }
        if (-not $secretSetOk) { throw "Could not write the tokens secret after $maxAttempts attempts -- RBAC propagation is taking longer than usual; wait a couple minutes and re-run (this step is idempotent)." }
        # Verify what actually landed, not just that the command exited 0 -- exactly the class of gap that
        # caused this bug to go undetected until the container's own JSON.parse caught it.
        $verifyOut = (Invoke-Native -FilePath 'az' -ArgumentList @('keyvault', 'secret', 'show', '--vault-name', $vaultName, '--name', 'starfish-tokens-json', '--query', 'value', '-o', 'tsv')) -join ''
        try { $null = $verifyOut | ConvertFrom-Json } catch { throw "Wrote the secret, but re-reading it back shows it is STILL not valid JSON (got: $verifyOut) -- something beyond argv-quoting is mangling it; do not proceed, this needs a look before the container will ever boot." }
        Write-Ok "Verified: the secret now stored in Key Vault is valid JSON."
    } finally {
        Remove-Item -Path $tokensTempFile -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "  [DRYRUN] az keyvault secret set --vault-name $vaultName --name starfish-tokens-json --file <temp-file>" -ForegroundColor DarkGray
}

$tokensLocalPath = Join-Path $RepoRoot 'azure\.local-test-tokens.json'
if (-not $DryRun) {
    # -Encoding ascii, not utf8 -- same BOM landmine as the seed config below; this file is plain ASCII
    # (hex tokens), so ascii avoids ever writing a BOM in the first place. Nothing currently parses this
    # file as JSON downstream, but no reason to leave it broken for whatever eventually does.
    Set-Content -Path $tokensLocalPath -Value ($tokensObj | ConvertTo-Json) -Encoding ascii
    $gitignorePath = Join-Path $RepoRoot '.gitignore'
    $ignoreLine = 'azure/.local-test-tokens.json'
    if (Test-Path $gitignorePath) {
        $existingIgnore = Get-Content $gitignorePath -Raw
        if ($existingIgnore -notmatch [regex]::Escape($ignoreLine)) {
            Add-Content -Path $gitignorePath -Value "`n# Starfish test-deploy: local plaintext copy of the Key Vault sidecar tokens, never commit`n$ignoreLine`n"
        }
    } else {
        Set-Content -Path $gitignorePath -Value "$ignoreLine`n"
    }
    Write-Ok "Tokens written to $tokensLocalPath (added to .gitignore -- do not commit this file)."
} else {
    Write-Host "  [DRYRUN] would write plaintext tokens to $tokensLocalPath and ensure it is gitignored" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 5. Seed a minimal test governed root locally
# ---------------------------------------------------------------------------
Write-Step "5. Seeding a minimal test governed root"
$seedRoot = Join-Path $RepoRoot 'azure\.local-seed-root'
$seedConfigPath = Join-Path $RepoRoot 'azure\.local-seed-config.json'
$seedConfig = @{
    operator = 'foundry-operator'
    tools    = @(@{ id = 'test.echo'; category = 'read'; riskTier = 'low' })
    agents   = @(@{ id = 'test-agent' })
}

if (-not $DryRun) {
    # Check for foundry-seed.mjs's own completion marker (.starfish-init.lock, written LAST, deliberately,
    # after every other file), not just that the directory exists -- a directory that exists but was never
    # fully seeded (e.g. this script was interrupted mid-seed on an earlier run) would otherwise be
    # silently treated as "already done" forever, and every file after whatever point it stopped at would
    # just be permanently missing.
    if (Test-Path (Join-Path $seedRoot '.starfish-init.lock')) {
        Write-Info "Seed root already exists at $seedRoot (foundry-seed.mjs refuses to re-seed an initialized root) -- reusing it as-is."
    } else {
        if (Test-Path $seedRoot) {
            Write-Warn2 "$seedRoot exists but was never fully seeded (.starfish-init.lock is missing) -- removing it and re-seeding from scratch."
            Remove-Item -Path $seedRoot -Recurse -Force
        }
        New-Item -ItemType Directory -Path $seedRoot -Force | Out-Null
        # -Encoding utf8 (not utf8NoBOM/ascii) writes a UTF-8 BOM on Windows PowerShell -- and Node's
        # JSON.parse does NOT strip a leading BOM, so foundry-seed.mjs's own `JSON.parse(readFileSync(...))`
        # failed with "Unexpected token" (the literal BOM byte) reading this exact file on a real run. Same
        # root cause, same fix, as the earlier STARFISH_TOKENS_JSON-via-Key-Vault bug: use -Encoding ascii, since this
        # config is always plain ASCII (tool ids, categories, risk tiers), which never writes a BOM at all.
        ($seedConfig | ConvertTo-Json -Depth 5) | Set-Content -Path $seedConfigPath -Encoding ascii
        Push-Location $RepoRoot
        try {
            Invoke-NativeVisible -FilePath 'node' -ArgumentList @('azure/sidecar/foundry-seed.mjs', '--root', $seedRoot, '--config', $seedConfigPath)
            if ($global:LASTNATIVEEXIT -ne 0) { throw "foundry-seed.mjs failed (exit $($global:LASTNATIVEEXIT)) -- see output above." }
        } finally {
            Pop-Location
        }
    }
    # Verify what actually landed, not just that the command exited 0 -- found on a real run that a prior
    # (pre-fix) version of this script proceeded straight to the upload step with a $seedRoot that turned
    # out to be completely empty, and the exit-code check alone did not catch it.
    if (-not (Test-Path (Join-Path $seedRoot '.starfish-init.lock'))) {
        $found = Get-ChildItem -Path $seedRoot -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
        $foundText = if ($found) { $found -join ', ' } else { '(nothing -- the directory is completely empty)' }
        throw "foundry-seed.mjs reported success but $seedRoot has no .starfish-init.lock afterward -- it did not actually seed anything. Contents found: $foundText. Delete $seedRoot by hand and re-run with more output visible, or run 'node azure/sidecar/foundry-seed.mjs --root $seedRoot --config $seedConfigPath' yourself from the repo root to see the real error."
    }
    Write-Ok "Seed root ready at $seedRoot (1 test tool, 1 test agent, empty policies.json -- see foundry-seed.mjs header for why that is safe)."
} else {
    Write-Host "  [DRYRUN] node azure/sidecar/foundry-seed.mjs --root $seedRoot --config <generated-config>" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 6. Deploy the Bicep template
# ---------------------------------------------------------------------------
$storageAccountName = (($NamePrefix -replace '[^a-zA-Z0-9]', '') + 'audit').ToLower()
$storageAccountName = $storageAccountName.Substring(0, [Math]::Min(24, $storageAccountName.Length))
$fileShareName = 'starfish-audit-data'
$appImagePlaceholder = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
$keyVaultUri = "https://$vaultName.vault.azure.net/"

$bicepPath = Join-Path $RepoRoot 'azure\bicep\sidecar-container-app.bicep'
if (-not (Test-Path $bicepPath)) { throw "Bicep template not found at $bicepPath" }

$deployArgs = @(
    'deployment', 'group', 'create',
    '--resource-group', $ResourceGroup,
    '--template-file', $bicepPath,
    '--parameters',
    "namePrefix=$NamePrefix",
    "location=$Location",
    "sidecarImage=$acrLoginServer/starfish-sidecar:test",
    "sidecarRegistryServer=$acrLoginServer",
    "appImage=$appImagePlaceholder",
    "keyVaultUri=$keyVaultUri",
    "auditStorageAccountName=$storageAccountName",
    "auditFileShareName=$fileShareName",
    '-o', 'json'
)

# Found on a real run: a genuine chicken-and-egg, not a bug in this script or the template. The Container
# App's Key Vault secret reference AND its ACR pull both authenticate via the user-assigned managed
# identity this SAME deployment creates -- so a single `az deployment group create` cannot both create
# that identity and have the container app successfully use it in one pass, because the identity has no
# RBAC grants yet at the moment the container app tries to start. Confirmed by the real error: every other
# resource (Log Analytics, the Container Apps environment, storage account, file share, the identity
# itself) deployed fine; only the container app's revision failed, specifically on
# "Unable to get value using Managed identity ... for secret starfish-tokens-json". Microsoft's own
# documented pattern for this exact shape (identity + Key Vault reference created in the same template) is
# deploy once, grant RBAC to what got created, then deploy again -- so that is what this does.
Write-Step "6. Deploying sidecar-container-app.bicep -- pass 1 of 2 (expected to fail on the container app step)"
Write-Info "appImage placeholder: $appImagePlaceholder (see README section below for why, and how to swap in your own app image later)"
Write-Info "sidecarImage: $acrLoginServer/starfish-sidecar:test"
if (-not $DryRun) {
    Invoke-Az -Args $deployArgs -Visible -IgnoreError | Out-Null
} else {
    Write-Host "  [DRYRUN] az deployment group create ... (pass 1 -- expected to partially fail; see the note above this step)" -ForegroundColor DarkGray
}

$identityPrincipalId = $null
if (-not $DryRun) {
    $identityPrincipalId = (Invoke-Native -FilePath 'az' -ArgumentList @('identity', 'show', '--name', "$NamePrefix-identity", '--resource-group', $ResourceGroup, '--query', 'principalId', '-o', 'tsv')) -join ''
    if (-not $identityPrincipalId) {
        throw "Pass 1 did not even create the managed identity -- that is NOT the expected chicken-and-egg failure (which only affects the container app step); check the error output above for a different root cause."
    }
    Write-Ok "Identity created: principalId $identityPrincipalId"
} else {
    Write-Host "  [DRYRUN] would read identityPrincipalId via az identity show" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 7. Grant RBAC (deliberately not in the Bicep template -- see its own comments)
# ---------------------------------------------------------------------------
Write-Step "7. Granting AcrPull + Key Vault Secrets User to the deployed identity"
if (-not $DryRun) {
    $acrId = (Invoke-Native -FilePath 'az' -ArgumentList @('acr', 'show', '--name', $acrName, '--query', 'id', '-o', 'tsv')) -join ''
    $vaultId = (Invoke-Native -FilePath 'az' -ArgumentList @('keyvault', 'show', '--name', $vaultName, '--query', 'id', '-o', 'tsv')) -join ''
    Invoke-Az -Args @('role', 'assignment', 'create', '--assignee-object-id', $identityPrincipalId, '--assignee-principal-type', 'ServicePrincipal', '--role', 'AcrPull', '--scope', $acrId) -IgnoreError | Out-Null
    Invoke-Az -Args @('role', 'assignment', 'create', '--assignee-object-id', $identityPrincipalId, '--assignee-principal-type', 'ServicePrincipal', '--role', 'Key Vault Secrets User', '--scope', $vaultId) -IgnoreError | Out-Null
    Write-Info "RBAC granted. Waiting 45s for propagation before the real (pass 2) deployment..."
    Start-Sleep -Seconds 45
} else {
    Write-Host "  [DRYRUN] would grant AcrPull on the registry and Key Vault Secrets User on the vault" -ForegroundColor DarkGray
}

Write-Step "8. Deploying sidecar-container-app.bicep -- pass 2 of 2 (the real attempt)"
if (-not $DryRun) {
    Invoke-Az -Args $deployArgs -Visible | Out-Null
    Write-Ok "Deployment succeeded."
} else {
    Write-Host "  [DRYRUN] az deployment group create ... (pass 2)" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 9. Upload the seeded governed root to the Azure Files share
# ---------------------------------------------------------------------------
Write-Step "9. Uploading seeded governed root to the /data file share"
if (-not $DryRun) {
    $storageKey = (Invoke-Native -FilePath 'az' -ArgumentList @('storage', 'account', 'keys', 'list', '--account-name', $storageAccountName, '--resource-group', $ResourceGroup, '--query', '[0].value', '-o', 'tsv')) -join ''
    if (-not $storageKey) { throw "Could not retrieve the storage account key for $storageAccountName." }

    # Found on a real run: `az storage file upload-batch` exited 0 (no error, nothing to catch), but the
    # container then failed with "registry missing: /data/governed-root/governance/tools.json" -- the file
    # genuinely never landed. This matches a known real limitation of upload-batch against Azure Files: it
    # does not reliably auto-create every level of a nested destination directory tree before uploading
    # into it, and can silently skip files whose parent directory never got created, without failing the
    # overall batch. Fixed by doing this explicitly instead: create every directory on the share first, in
    # top-down order (so a parent always exists before its children are created or files uploaded into
    # them), then upload every file individually -- deterministic, no reliance on upload-batch's own
    # directory-creation behavior at all.
    $relDirs = Get-ChildItem -Path $seedRoot -Recurse -Directory |
        ForEach-Object { $_.FullName.Substring($seedRoot.Length + 1).Replace('\', '/') } |
        Sort-Object { ($_ -split '/').Count }, { $_ }
    Invoke-Az -Args @('storage', 'directory', 'create', '--account-name', $storageAccountName, '--account-key', $storageKey, '--share-name', $fileShareName, '--name', 'governed-root') -IgnoreError | Out-Null
    foreach ($relDir in $relDirs) {
        Invoke-Az -Args @('storage', 'directory', 'create', '--account-name', $storageAccountName, '--account-key', $storageKey, '--share-name', $fileShareName, '--name', "governed-root/$relDir") -IgnoreError | Out-Null
    }
    $files = Get-ChildItem -Path $seedRoot -Recurse -File
    foreach ($f in $files) {
        $relPath = $f.FullName.Substring($seedRoot.Length + 1).Replace('\', '/')
        Invoke-Az -Args @('storage', 'file', 'upload', '--account-name', $storageAccountName, '--account-key', $storageKey, '--share-name', $fileShareName, '--source', $f.FullName, '--path', "governed-root/$relPath") | Out-Null
    }
    Write-Ok "Uploaded $($files.Count) files across $($relDirs.Count + 1) directories."

    # Verify what actually landed, not just that every command exited 0 -- exactly the class of gap that
    # let the upload-batch failure go undetected until the container's own error caught it.
    $verifyExists = (Invoke-Native -FilePath 'az' -ArgumentList @('storage', 'file', 'exists', '--account-name', $storageAccountName, '--account-key', $storageKey, '--share-name', $fileShareName, '--path', 'governed-root/governance/tools.json', '--query', 'exists', '-o', 'tsv')) -join ''
    if ($verifyExists -ne 'True') {
        throw "Uploaded the seed root, but governed-root/governance/tools.json is still not present on the share afterward -- something did not land. Re-run this script (every step here is idempotent), or inspect the share directly: az storage file list --account-name $storageAccountName --account-key <key> --share-name $fileShareName --path governed-root -o table"
    }
    Write-Ok "Verified: governed-root/governance/tools.json is present on the share."
} else {
    Write-Host "  [DRYRUN] would create the directory structure and upload $seedRoot to the $fileShareName/governed-root path on $storageAccountName, file by file, then verify" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 10. Restart the revision and tail the sidecar's logs
# ---------------------------------------------------------------------------
Write-Step "10. Restarting the Container App revision and checking the sidecar boots"
$appName = "$NamePrefix-app"
if (-not $DryRun) {
    Write-Info "Waiting 10s before restarting (RBAC already propagated before pass 2 above)..."
    Start-Sleep -Seconds 10
    $revisionName = (Invoke-Native -FilePath 'az' -ArgumentList @('containerapp', 'revision', 'list', '--name', $appName, '--resource-group', $ResourceGroup, '--query', '[0].name', '-o', 'tsv')) -join ''
    if ($revisionName) {
        Invoke-Az -Args @('containerapp', 'revision', 'restart', '--name', $appName, '--resource-group', $ResourceGroup, '--revision', $revisionName) -IgnoreError | Out-Null
        Write-Info "Restarted revision $revisionName. Waiting 20s, then tailing sidecar logs (Ctrl+C to stop watching -- the app keeps running)..."
        Start-Sleep -Seconds 20
        Invoke-NativeVisible -FilePath 'az' -ArgumentList @('containerapp', 'logs', 'show', '--name', $appName, '--resource-group', $ResourceGroup, '--container', 'starfish-sidecar', '--tail', '30')
    } else {
        Write-Warn2 "Could not find a revision to restart -- check 'az containerapp revision list --name $appName -g $ResourceGroup' yourself."
    }
} else {
    Write-Host "  [DRYRUN] would restart the container app revision and tail starfish-sidecar's logs" -ForegroundColor DarkGray
}

Write-Step "Done"
if (-not $DryRun) {
    Write-Ok "Resource group: $ResourceGroup"
    Write-Ok "Registry: $acrLoginServer"
    Write-Ok "Key Vault: $vaultName"
    Write-Ok "Container App: $appName"
    Write-Ok "Local test tokens: $tokensLocalPath (do not commit)"
    Write-Info "Look for 'Starfish sidecar listening on http://127.0.0.1:8787' in the log tail above."
    Write-Info "If the sidecar container is still crash-looping, it is almost always one of: RBAC not yet"
    Write-Info "propagated (wait a couple minutes, then 'az containerapp revision restart' again), or the"
    Write-Info "seeded root upload landing at the wrong path on the file share (check STARFISH_ROOT=/data/governed-root"
    Write-Info "against what actually got uploaded)."
}
