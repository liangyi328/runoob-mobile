# Auto push to GitHub, enable Pages, print APK instructions.
# Usage: .\push-and-deploy.ps1 -Repo "owner/repo"
# Pure ASCII: Windows PowerShell 5.1 reads UTF-8-without-BOM as GBK,
# which corrupts multi-byte chars and breaks parsing.

param(
    [Parameter(Mandatory = $true)]
    [string]$Repo
)

# PS 5.1 + ErrorActionPreference=Stop turns git's stderr progress lines into
# NativeCommandError records and aborts mid-push. git writes a lot on stderr,
# so run everything in Continue mode and check $LASTEXITCODE explicitly.
$ErrorActionPreference = "Continue"

$git = "F:\Program Files\Git\cmd\git.exe"
# $PSScriptRoot avoids hardcoding the Chinese path; PS5.1 would mis-decode it.
$projDir = $PSScriptRoot

# Never hang on a terminal username prompt; Credential Manager handles auth.
$env:GIT_TERMINAL_PROMPT = "0"

function Say($msg, $color = "White") {
    Write-Host "[runoob] $msg" -ForegroundColor $color
}

function Run-Git {
    # Returns git output as plain strings (stderr merged), sets $script:lastCode.
    $out = & $git @args 2>&1 | ForEach-Object { "$_" }
    $script:lastCode = $LASTEXITCODE
    return $out
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
$dirty = Run-Git status --porcelain
if ($lastCode -eq 0 -and $dirty) {
    Say "Working tree has changes, committing..." Yellow
    Run-Git add -A | Out-Null
    Run-Git commit -m "chore: sync before deploy" | Out-Null
}

# --- token: used ONLY for REST API (repo check / pages enable). ---
# git push uses Windows Credential Manager, so no token lands in .git/config.
Say "" White
Say "Token is used ONLY for GitHub REST API calls." Yellow
Say "git push itself uses Windows Credential Manager (no token in URLs)." DarkGray
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

# --- step 3: push via Credential Manager ---
Say "[3/5] Pushing (Credential Manager, no token in URL)..." Yellow

# git does NOT read the IE/WinINET proxy that PowerShell uses automatically,
# so adopt the system proxy for git.
$px = $null
try {
    $reg = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -ErrorAction Stop
    if ($reg.ProxyEnable -eq 1 -and $reg.ProxyServer) {
        $px = $reg.ProxyServer
        if ($px -notmatch '^https?://') { $px = "http://$px" }
        Run-Git config --global http.proxy $px | Out-Null
        Run-Git config --global https.proxy $px | Out-Null
        Say "      system proxy applied: $px" DarkGray
    }
} catch {}

# tolerate slow uploads behind proxies (fixes RPC failed / HTTP 408)
Run-Git config --global http.postBuffer 524288000 | Out-Null
Run-Git config --global http.version HTTP/1.1 | Out-Null
Run-Git config --global http.lowSpeedLimit 0 | Out-Null
Run-Git config --global http.lowSpeedTime 300 | Out-Null

# keep origin pointing at the CLEAN url (no token inside)
$remotes = Run-Git remote
if ($lastCode -ne 0) { $remotes = @() }
if (@($remotes) -contains "origin") {
    Run-Git remote set-url origin "https://github.com/$owner/$name.git" | Out-Null
    Say "      remote origin updated (clean url)" DarkGray
} else {
    Run-Git remote add origin "https://github.com/$owner/$name.git" | Out-Null
    Say "      remote origin added (clean url)" DarkGray
}

# probe reachability
$null = Run-Git ls-remote "https://github.com/$owner/$name.git"
if ($lastCode -ne 0) {
    Say "      WARN: cannot reach github.com via git (proxy/network)." DarkYellow
    Say "            Push will likely fail; check Clash node or try direct." DarkYellow
}

$pushLog = Run-Git push -u origin main
$pushCode = $lastCode
$pushLog | ForEach-Object { if ($_) { Say "      $_" DarkGray } }
if ($pushCode -ne 0) {
    Say "ERROR: push failed" Red
    Say "       'workflow scope' rejected  => remove .github/workflows from repo" DarkGray
    Say "       'Authentication failed'    => run: git push  (refresh credentials)" DarkGray
    Say "       'HTTP 408 / RPC failed'    => switch Clash node, or push direct" DarkGray
    exit 1
}
Say "      Pushed" Green

# --- step 4: enable pages (Deploy from a branch: main /docs) ---
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

# --- step 5: wait ---
$pagesUrl = "https://$owner.github.io/$name/"
Say "[5/5] Waiting for Pages deployment..." Yellow
Say "" White
Say "================ DONE ================" Cyan
Say "" White
Say "  Pages URL : $pagesUrl" White
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
