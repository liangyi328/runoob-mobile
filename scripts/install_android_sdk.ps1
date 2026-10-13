# 安装 Android 命令行工具（无需 Android Studio）
# 用法: powershell -ExecutionPolicy Bypass -File scripts\install_android_sdk.ps1
$ErrorActionPreference = "Stop"

$SdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME }
           else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }

$CmdlineVersion = "11076708"  # commandlinetools 最新版标识
$ToolsUrl = "https://dl.google.com/android/repository/commandlinetools-win-${CmdlineVersion}_latest.zip"
$TempZip = Join-Path $env:TEMP "cmdline-tools.zip"

Write-Host "==> Android SDK 安装脚本" -ForegroundColor Cyan
Write-Host "    目标目录: $SdkRoot"

# 1. 下载
if (-not (Test-Path $TempZip)) {
    Write-Host "`n[1/4] 下载 Android 命令行工具 (~130MB) …" -ForegroundColor Yellow
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $ToolsUrl -OutFile $TempZip -UseBasicParsing -TimeoutSec 600
    } catch {
        Write-Host "下载失败: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "可手动下载后放到: $TempZip" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "`n[1/4] 已存在下载包，跳过" -ForegroundColor Green
}

# 2. 解压
Write-Host "[2/4] 解压到 $SdkRoot …" -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $SdkRoot | Out-Null
$Extract = Join-Path $SdkRoot "cmdline-tools"
New-Item -ItemType Directory -Force -Path $Extract | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
    [System.IO.Compression.ZipFile]::ExtractToDirectory($TempZip, $Extract)
} catch {
    Write-Host "解压失败（可能已存在）: $($_.Exception.Message)" -ForegroundColor DarkYellow
}
# 官方 zip 内是 cmdline-tools/bin，需要整理成 cmdline-tools/latest/bin
if (Test-Path (Join-Path $Extract "cmdline-tools")) {
    $latest = Join-Path $Extract "latest"
    if (Test-Path $latest) { Remove-Item $latest -Recurse -Force }
    Move-Item (Join-Path $Extract "cmdline-tools") $latest -Force
}

$SdkManager = Join-Path $Extract "latest\bin\sdkmanager.bat"
if (-not (Test-Path $SdkManager)) {
    Write-Host "✗ 未找到 sdkmanager: $SdkManager" -ForegroundColor Red
    exit 1
}

# 3. 接受许可 + 安装组件
Write-Host "[3/4] 安装 platform-tools / platforms;android-34 / build-tools;34.0.0 (~600MB) …" -ForegroundColor Yellow
Write-Host "     这一步需要几分钟，请不要关闭窗口" -ForegroundColor DarkYellow

$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot

# 自动接受许可
$yes = "y`n" * 20
$yes | & $SdkManager --licenses --sdk_root=$SdkRoot 2>&1 | Out-Null

& $SdkManager --sdk_root=$SdkRoot `
    "platform-tools" `
    "platforms;android-34" `
    "build-tools;34.0.0" 2>&1 | ForEach-Object { $_ }

# 4. 写环境变量
Write-Host "[4/4] 写入用户环境变量 ANDROID_HOME …" -ForegroundColor Yellow
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", $SdkRoot, "User")
[System.Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", $SdkRoot, "User")

Write-Host "`n==> 完成！" -ForegroundColor Green
Write-Host "    ANDROID_HOME = $SdkRoot" -ForegroundColor White
Write-Host "`n请重新打开一个终端，然后运行：" -ForegroundColor Cyan
Write-Host "    python scripts\build_apk.py" -ForegroundColor White
Write-Host "`n（当前窗口的环境变量可能需要重开 PowerShell 才生效）" -ForegroundColor DarkYellow
