# Auto push to GitHub, enable Pages, print APK instructions.
# Usage: .\push-and-deploy.ps1 -Repo "owner/repo"
# Pure ASCII: Windows PowerShell 5.1 reads UTF-8-without-BOM as GBK,
# which corrupts multi-byte chars and breaks parsing. So this file is ASCII only.

param(
    [Parameter(Mandatory = $true)]
    [string]$Repo
)

$ErrorActionPreference = "Stop"
$git = "F:\Program Files\Git\cmd\git.exe"
# $PSScriptRoot avoids hardcoding the Chinese path; PS5.1 would mis-decode it.
$projDir = $PSScriptRoot

function Say($msg, $color = "White") {
    Write-Host "[runoob] $msg" -ForegroundColor $color
}

Say "=== Push & Deploy: Runoob Mobile ===" Cyan

# --- normalize repo ---
$Repo = $Repo -replace '^https?://github\.com/', '' -replace '\.git$', '' -replace '/$', ''
if ($Repo -notmatch '^[^/]+/[^/]+$') {
    Say "ERROR: expect owner/repo, e.g. liangyi328/runoob-mobile" Red
    exit 1
}
$parts = $Repo -split '/'
$owner = $parts[0]
$name = $parts[1]
Say "Target repo: https://github.com/$owner/$name" White

Set-Location $projDir

# --- commit if dirty ---
$oldPref2 = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$dirty = & $git status --porcelain 2>$null
$ErrorActionPreference = $oldPref2

if ($dirty) {
    Say "Working tree has changes, committing..." Yellow
    & $git add -A 2>$null
    & $git commit -m "chore: sync before deploy" 2>$null | Out-Null
}

# --- ask token ---
Say "" White
Say "Need a GitHub Token (SSH key not linked, using HTTPS)." Yellow
Say "Create at: https://github.com/settings/tokens  ->  check 'repo' scope" DarkGray
$secure = Read-Host "Paste GitHub Token (hidden)" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not $token) { Say "ERROR: no token provided" Red; exit 1 }

$hdr = @{
    Authorization = "Bearer $token"
    Accept        = "application/vnd.github+json"
    "User-Agent"  = "ps1"
}

# --- step 1: verify token ---
Say "[1/5] Verifying token..." Yellow
try {
    $me = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $hdr -TimeoutSec 20
    Say "      Logged in as: $($me.login)" Green
} catch {
    Say "ERROR: token invalid or network failed: $($_.Exception.Message)" Red
    exit 1
}

# --- step 2: ensure repo exists ---
Say "[2/5] Checking repo..." Yellow
try {
    $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$name" -Headers $hdr -TimeoutSec 20
    Say "      Repo exists (visibility: $($r.visibility))" Green
} catch {
    Say "      Not found, creating public repo..." Yellow
    try {
        $body = @{ name = $name; description = "Runoob offline PWA"; private = $false; auto_init = $false } | ConvertTo-Json
        Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Method Post -Headers $hdr -Body $body -TimeoutSec 30 | Out-Null
        Say "      Created" Green
        Start-Sleep -Seconds 3
    } catch {
        Say "ERROR: create failed: $($_.Exception.Message)" Red
        Say "       Create an EMPTY repo named '$name' at https://github.com/new then rerun." DarkGray
        Say "       Important: do NOT check README / .gitignore / license." DarkGray
        exit 1
    }
}

# --- step 3: push ---
Say "[3/5] Pushing to main..." Yellow
$remoteUrl = "https://$($me.login):$token@github.com/$owner/$name.git"

# git does NOT read the IE/WinINET proxy that PowerShell uses automatically,
# so it hangs on port 443 while PowerShell succeeds. Adopt the system proxy.
$proxyApplied = $false
try {
    $reg = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -ErrorAction Stop
    if ($reg.ProxyEnable -eq 1 -and $reg.ProxyServer) {
        $px = $reg.ProxyServer
        if ($px -notmatch '^https?://') { $px = "http://$px" }
        & $git config --global http.proxy $px 2>$null
        & $git config --global https.proxy $px 2>$null
        $proxyApplied = $true
        Say "      system proxy applied: $px" DarkGray
    }
} catch {}

# Probe reachability before pushing; if still unreachable, try disabling proxy.
$reach = & $git ls-remote "https://github.com/$owner/$name.git" 2>$null
$reachCode = $LASTEXITCODE
if ($reachCode -ne 0) {
    if ($proxyApplied) {
        Say "      proxy path failed, retrying direct..." DarkGray
        & $git config --global --unset http.proxy 2>$null
        & $git config --global --unset https.proxy 2>$null
        $reach = & $git ls-remote "https://github.com/$owner/$name.git" 2>$null
        if ($LASTEXITCODE -eq 0) { Say "      direct path works" DarkGray }
    }
}
if ($reachCode -ne 0 -and $proxyApplied) {
    # restore proxy if direct also failed (leave as-is for user visibility)
    & $git config --global http.proxy $px 2>$null
    & $git config --global https.proxy $px 2>$null
}

# 'git remote get-url origin' writes to stderr when absent, which trips
# ErrorActionPreference=Stop. Use 'git remote' listing instead, inside a
# temporarily relaxed preference. ErrorActionPreference is scoped to this file,
# so changing it here cannot leak to the caller.
$oldPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$remotesRaw = & $git remote 2>$null
$ErrorActionPreference = $oldPref

$remotes = @()
if ($remotesRaw) {
    $remotes = @($remotesRaw | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
}
if ($remotes -contains "origin") {
    & $git remote set-url origin $remoteUrl 2>$null
    Say "      remote origin updated" DarkGray
} else {
    & $git remote add origin $remoteUrl 2>$null
    Say "      remote origin added" DarkGray
}

# git often writes progress to stderr; merge it so nothing trips Stop.
$pushLog = & $git push -u origin main 2>&1
$pushCode = $LASTEXITCODE
$pushLog | ForEach-Object { Say "      $_" DarkGray }
if ($pushCode -ne 0) {
    Say "ERROR: push failed" Red
    Say "       If rejected by non-empty repo (README/.gitignore), recreate EMPTY repo," DarkGray
    Say "       or force: git push -u origin main --force" DarkGray
    exit 1
}
Say "      Pushed" Green

# --- step 4: enable pages ---
Say "[4/5] Enabling GitHub Pages (branch main, path /docs)..." Yellow
$pagesBody = '{"source":{"branch":"main","path":"/docs"}}'
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$name/pages" `
        -Method Post -Headers $hdr -Body $pagesBody -TimeoutSec 30 | Out-Null
    Say "      Pages enabled" Green
} catch {
    if ($_.Exception.Message -match "409|already exists") {
        try {
            Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$name/pages" `
                -Method Put -Headers $hdr -Body $pagesBody -TimeoutSec 30 | Out-Null
            Say "      Pages config updated" Green
        } catch { Say "      WARN: $($_.Exception.Message)" DarkYellow }
    } else {
        Say "      WARN: auto-enable failed: $($_.Exception.Message)" DarkYellow
        Say "            Manual: Settings -> Pages -> Source = Deploy from a branch -> main /docs" DarkGray
    }
}

# --- scrub token from remote url ---
& $git remote set-url origin "https://github.com/$owner/$name.git" | Out-Null

# --- step 5: wait ---
$pagesUrl = "https://$owner.github.io/$name/"
Say "[5/5] Waiting for Pages deployment..." Yellow
Say "" White
Say "================ DONE ================" Cyan
Say "" White
Say "  Pages URL : $pagesUrl" White
Say "  Actions   : https://github.com/$owner/$name/actions" DarkGray
Say "" White
Say "  NEXT - generate APK with PWABuilder:" Cyan
Say "    1. Open https://www.pwabuilder.com/" White
Say "    2. Paste the Pages URL above, click Start" White
Say "    3. Top-right 'Package For Stores' -> Android -> Generate" White
Say "    4. Package name: com.$($owner.ToLower()).runoob" White
Say "    5. Download zip, unzip -> signed .apk ready to install" White
Say "" White

Start-Sleep -Seconds 20
Say "Probing Pages availability..." Yellow
$OK = $false
for ($i = 1; $i -le 10; $i++) {
    try {
        $r = Invoke-WebRequest -Uri $pagesUrl -UseBasicParsing -TimeoutSec 15
        if ($r.StatusCode -eq 200) {
            Say "  LIVE: $pagesUrl (HTTP 200)" Green
            $OK = $true
            break
        }
    } catch {}
    Say "     attempt $i not ready, retry in 15s..." DarkGray
    Start-Sleep -Seconds 15
}
if (-not $OK) {
    Say "  Not live yet. May still be queued. Open the URL manually later." DarkYellow
}
