# 拿到 repo 地址后，一键完成「关联远程 -> 推送 -> 启用 Pages -> 打印结果」
# 用法: .\push-and-deploy.ps1 -Repo "owner/repo"
#     或: .\push-and-deploy.ps1 -Repo "https://github.com/owner/repo"
# 前置: 需要 GitHub Token（因为 SSH 公钥未关联），脚本会提示输入，不会回显也不会留存到文件

param(
    [Parameter(Mandatory = $true)]
    [string]$Repo
)

$ErrorActionPreference = "Stop"
$git = "F:\Program Files\Git\cmd\git.exe"

Write-Host "==> 菜鸟教程手机学习版 · 一键推送部署" -ForegroundColor Cyan

# --- 规范化 repo ---
$Repo = $Repo -replace '^https?://github\.com/', '' -replace '\.git$', '' -replace '/$', ''
if ($Repo -notmatch '^[^/]+/[^/]+$') {
    Write-Host "✗ 格式应为 owner/repo，例如: liangyi/runoob-mobile" -ForegroundColor Red
    exit 1
}
$owner, $name = $Repo -split '/'
Write-Host "    目标仓库: https://github.com/$owner/$name" -ForegroundColor White

# --- 检查工作区干净 ---
$dirty = & $git status --porcelain 2>&1
if ($dirty) {
    Write-Host "`n有未提交改动，先提交…" -ForegroundColor Yellow
    & $git add -A
    & $git commit -m "chore: 同步更新" | Out-Null
}

# --- 询问 Token ---
Write-Host ""
Write-Host "需要一个 GitHub Token（SSH 密钥未关联，走 HTTPS）。" -ForegroundColor Yellow
Write-Host "创建地址: https://github.com/settings/tokens  -> 勾选 repo 权限" -ForegroundColor DarkGray
Write-Host "也可以复用你之前给 DSH 配置过的那个 token。" -ForegroundColor DarkGray
$secure = Read-Host "请粘贴 GitHub Token (输入不回显)" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not $token) { Write-Host "✗ 未提供 Token" -ForegroundColor Red; exit 1 }

# --- 校验 Token 并获取登录名 ---
Write-Host "`n[1/5] 校验 Token …" -ForegroundColor Yellow
try {
    $hdr = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json"; "User-Agent" = "ps1" }
    $me = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $hdr -TimeoutSec 20
    Write-Host "      已登录为: $($me.login)" -ForegroundColor Green
} catch {
    Write-Host "✗ Token 无效或网络失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# --- 若仓库不存在则自动创建 ---
Write-Host "[2/5] 检查仓库是否存在 …" -ForegroundColor Yellow
$exists = $true
try {
    $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$name" -Headers $hdr -TimeoutSec 20
    Write-Host "      仓库已存在（$($r.visibility)）" -ForegroundColor Green
} catch {
    $exists = $false
    Write-Host "      仓库不存在，尝试创建（公开）…" -ForegroundColor Yellow
    try {
        $body = @{ name = $name; description = "菜鸟教程手机学习版 - 183章离线PWA"; private = $false; auto_init = $false } | ConvertTo-Json
        Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Method Post -Headers $hdr -Body $body -TimeoutSec 30 | Out-Null
        Write-Host "      ✓ 已创建" -ForegroundColor Green
        Start-Sleep -Seconds 2
        $exists = $true
    } catch {
        Write-Host "✗ 创建失败: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  请手动在 https://github.com/new 创建名为 '$name' 的空仓库后重跑本脚本" -ForegroundColor DarkGray
        exit 1
    }
}

# --- 推送 ---
Write-Host "[3/5] 推送代码到 main …" -ForegroundColor Yellow
$remoteUrl = "https://$($me.login):$token@github.com/$owner/$name.git"
$existing = & $git remote get-url origin 2>&1
if ($LASTEXITCODE -eq 0) { & $git remote set-url origin $remoteUrl | Out-Null }
else { & $git remote add origin $remoteUrl | Out-Null }

& $git push -u origin main 2>&1 | ForEach-Object { "      $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ 推送失败" -ForegroundColor Red
    exit 1
}
Write-Host "      ✓ 推送成功" -ForegroundColor Green

# --- 启用 Pages ---
Write-Host "[4/5] 启用 GitHub Pages (源: main 分支 /docs 目录) …" -ForegroundColor Yellow
$pagesBody = '{"source":{"branch":"main","path":"/docs"}}'
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$name/pages" `
        -Method Post -Headers $hdr -Body $pagesBody -TimeoutSec 30 | Out-Null
    Write-Host "      ✓ Pages 已启用" -ForegroundColor Green
} catch {
    if ($_.Exception.Message -match "409|already exists") {
        try {
            Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$name/pages" `
                -Method Put -Headers $hdr -Body $pagesBody -TimeoutSec 30 | Out-Null
            Write-Host "      ✓ Pages 配置已更新" -ForegroundColor Green
        } catch { Write-Host "      ! Pages 可能已配置: $($_.Exception.Message)" -ForegroundColor DarkYellow }
    } else {
        Write-Host "      ! 自动启用失败: $($_.Exception.Message)" -ForegroundColor DarkYellow
        Write-Host "        手动启用: Settings → Pages → Source 选 'Deploy from a branch' → main /docs" -ForegroundColor DarkGray
    }
}

# --- 清理 token（从 remote url 里移除，避免明文留存） ---
& $git remote set-url origin "https://github.com/$owner/$name.git" | Out-Null

# --- 等待部署 ---
$pagesUrl = "https://$owner.github.io/$name/"
Write-Host "[5/5] 等待首次部署生效（约 30-90 秒）…" -ForegroundColor Yellow
Write-Host ""
Write-Host "================ 完成 ================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Pages 地址:  $pagesUrl" -ForegroundColor White
Write-Host "  Actions:     https://github.com/$owner/$name/actions" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  下一步 —— 用 PWABuilder 生成 APK：" -ForegroundColor Cyan
Write-Host "    1. 浏览器打开  https://www.pwabuilder.com/" -ForegroundColor White
Write-Host "    2. 输入框粘贴上面的 Pages 地址，点 Start" -ForegroundColor White
Write-Host "    3. 右上角 Package For Stores → Android → Generate" -ForegroundColor White
Write-Host "    4. 包名建议填: com.$($owner.ToLower()).runoob" -ForegroundColor White
Write-Host "    5. 下载 zip，解开就是签名好的 .apk，丢到手机安装" -ForegroundColor White
Write-Host ""

Start-Sleep -Seconds 20
Write-Host "自动检测 Pages 是否可访问 …" -ForegroundColor Yellow
$OK = $false
for ($i = 1; $i -le 10; $i++) {
    try {
        $r = Invoke-WebRequest -Uri $pagesUrl -UseBasicParsing -TimeoutSec 15
        if ($r.StatusCode -eq 200) { Write-Host "  ✓ $pagesUrl 已可访问 (HTTP 200)" -ForegroundColor Green; $OK = $true; break }
    } catch {}
    Write-Host "    第 $i 次探测未就绪，再等 15 秒…" -ForegroundColor DarkGray
    Start-Sleep -Seconds 15
}
if (-not $OK) {
    Write-Host "  暂未就绪，可能还在部署队列。请稍后手动访问上面地址确认。" -ForegroundColor DarkYellow
}
