# build-binary.ps1 — 构建「单文件」可执行程序（Windows / PowerShell）
#
# 等价于 scripts/build-binary.sh：把前端产物、data/*.json 与图集全部内嵌进一个 Go 二进制，
# 直接运行即可同时提供 Web 前端（/ /assets/* /data/*）与后端（/api/* /healthz），
# 不需要 Node、不需要 Docker、不依赖任何外部静态文件。
#
# 用法（在仓库根目录，或任意位置指定脚本路径）：
#   .\scripts\build-binary.ps1                       # 为当前系统构建 → dist\tswui.exe
#   .\scripts\build-binary.ps1 -GOOS linux -GOARCH arm64   # 交叉编译 Linux ARM64
#   .\scripts\build-binary.ps1 -Out dist\trweb.exe    # 自定义输出路径
#   .\scripts\build-binary.ps1 -Version 1.2.3         # 指定版本号（默认取 git describe）
#   .\scripts\build-binary.ps1 -SkipWeb               # 复用已有 web\dist，跳过 npm build
#   .\scripts\build-binary.ps1 -Smoke                 # 构建后启动一次并探测 /healthz 与 /
#
# 版本号注入 -X main.version；用 `.\dist\tswui.exe -version` 与 `GET /healthz` 查看。
#
# 运行（默认 :8080，TShock 默认 http://127.0.0.1:7878）：
#   .\dist\tswui.exe
#   $env:LISTEN=':9000'; $env:TSHOCK_URL='http://192.168.1.10:7878'; .\dist\tswui.exe
#
# 说明：
# - 内嵌资源由 server/main.go 的 //go:embed all:internal/webdist 提供，因此构建前
#   必须把 web\dist 与仓库 data\ 拷入 server\internal\webdist（本脚本负责）。
# - data\ 一律以仓库根目录为唯一来源；web\public\data 符号链接已移除
#   （改为 Vite 插件 + Docker `COPY data/ /data/`，Windows 上不再有符号链接坑）。

[CmdletBinding()]
param(
  [string]$GOOS = $env:GOOS,
  [string]$GOARCH = $env:GOARCH,
  [string]$Out,
  [string]$Version = $env:VERSION,
  [switch]$SkipWeb,
  [switch]$Smoke,
  [int]$SmokePort = 18099
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

function Die([string]$Message) {
  Write-Host "错误：$Message" -ForegroundColor Red
  exit 1
}

function Require-Cmd([string]$Name, [string]$Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { Die "未找到 $Name，$Hint" }
}

function Join-Root([string]$Relative) { Join-Path $Root $Relative }

Require-Cmd 'go' '请先安装 Go 1.27+（https://go.dev/dl/）'

$hostGoos = (& go env GOHOSTOS).Trim()
$hostGoarch = (& go env GOHOSTARCH).Trim()
if (-not $GOOS) { $GOOS = $hostGoos }
if (-not $GOARCH) { $GOARCH = $hostGoarch }
if (-not $Out) {
  if ($GOOS -eq 'windows') { $Out = 'dist\tswui.exe' } else { $Out = 'dist/tswui' }
}
$OutAbs = if ([System.IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Root $Out }

# 版本号：优先 -Version / $env:VERSION，其次 git describe（无 git / 无 tag 时回退 dev）。
if (-not $Version) {
  if (Get-Command git -ErrorAction SilentlyContinue) {
    $v = (& git -C $Root describe --tags --always --dirty 2>$null)
    if ($LASTEXITCODE -eq 0 -and $v) { $Version = $v.Trim() }
  }
  if (-not $Version) { $Version = 'dev' }
}

Write-Host "==> 目标平台 $GOOS/$GOARCH（宿主 $hostGoos/$hostGoarch），版本 $Version"

# ── 1. 生成数据自检 ─────────────────────────────────────────────
# 生成数据随仓库提交；若被删或未生成，这里提前失败并给出生成命令。
$required = @(
  'data\items.json', 'data\prefixes.json', 'data\commands.json', 'data\meta.json',
  'data\items-atlas.json', 'data\items-atlas.png',
  'data\player-atlas.json', 'data\player-atlas.png',
  'data\recipes.json', 'data\item-stats.json',
  'data\item-tips.zh-Hans.json', 'data\item-tips.en-US.json',
  'data\loc.zh-Hans.json', 'data\loc.en-US.json'
)
$missing = @($required | Where-Object { -not (Test-Path (Join-Root $_)) })
if ($missing.Count -gt 0) {
  Write-Host '错误：缺少生成数据：' -ForegroundColor Red
  $missing | ForEach-Object { Write-Host "  $_" }
  Write-Host '  请先执行（部分需要 dotnet 9 / python3-Pillow）：'
  Write-Host '    node tools/gen-data.mjs && python3 tools/gen-atlas.py && python3 tools/gen-player-atlas.py'
  Write-Host '    bash tools/gen-game-data.sh'
  exit 1
}

# ── 2. 前端构建 ────────────────────────────────────────────────
if ($SkipWeb) {
  if (-not (Test-Path (Join-Root 'web\dist\index.html'))) {
    Die 'web\dist\index.html 不存在，去掉 -SkipWeb 重新构建'
  }
  Write-Host '==> 跳过前端构建（复用 web\dist）'
} else {
  Require-Cmd 'npm' '请先安装 Node 24+（https://nodejs.org/）'
  if (-not (Test-Path (Join-Root 'web\node_modules'))) {
    Write-Host '==> 安装前端依赖'
    Push-Location (Join-Root 'web')
    try {
      & npm install --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { Die 'npm install 失败' }
    } finally { Pop-Location }
  }
  Write-Host '==> 构建前端（web\dist）'
  Push-Location (Join-Root 'web')
  try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { Die 'npm run build 失败' }
  } finally { Pop-Location }
}

# ── 3. 把前端产物 + data 放进 server\internal\webdist ───────────
$wd = Join-Root 'server\internal\webdist'
Write-Host '==> 准备内嵌资源 server\internal\webdist'
New-Item -ItemType Directory -Force -Path $wd | Out-Null
# 清空旧产物，保留 .gitkeep（占位文件，保证目录存在且 git 不报删除）
Get-ChildItem -Force -Path $wd | Where-Object { $_.Name -ne '.gitkeep' } | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path (Join-Root 'web\dist') '*') -Destination $wd -Recurse -Force
# data\ 以仓库根为唯一来源，覆盖 dist 里可能来自符号链接的副本
$wdData = Join-Path $wd 'data'
if (Test-Path $wdData) { Remove-Item -Recurse -Force $wdData }
New-Item -ItemType Directory -Force -Path $wdData | Out-Null
Copy-Item -Path (Join-Path (Join-Root 'data') '*') -Destination $wdData -Recurse -Force

# ── 4. 编译单文件 ──────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path (Split-Path $OutAbs) | Out-Null
Write-Host "==> 编译 $Out（CGO_ENABLED=0，静态）"

$savedGoos = $env:GOOS
$savedGoarch = $env:GOARCH
$savedCgo = $env:CGO_ENABLED
try {
  $env:CGO_ENABLED = '0'
  $env:GOOS = $GOOS
  $env:GOARCH = $GOARCH
  Push-Location (Join-Root 'server')
  try {
    & go build -trimpath -ldflags "-s -w -X main.version=$Version" -o $OutAbs .
    if ($LASTEXITCODE -ne 0) { Die 'go build 失败' }
  } finally { Pop-Location }
} finally {
  $env:GOOS = $savedGoos
  $env:GOARCH = $savedGoarch
  $env:CGO_ENABLED = $savedCgo
}

$size = (Get-Item $OutAbs).Length
Write-Host ("==> 完成：{0}  （{1} MB / {2} 字节）" -f $Out, [math]::Round($size / 1MB), $size)

# ── 5. 可选冒烟测试（仅当目标平台 == 宿主平台）────────────────
if ($Smoke) {
  if ($GOOS -ne $hostGoos -or $GOARCH -ne $hostGoarch) {
    Write-Host "==> 跳过冒烟测试（$GOOS/$GOARCH 无法在 $hostGoos/$hostGoarch 上直接运行）"
  } else {
    Write-Host "==> 冒烟测试 http://127.0.0.1:$SmokePort"
    $savedListen = $env:LISTEN
    $savedLogLevel = $env:LOG_LEVEL
    $logFile = Join-Path $env:TEMP 'tswui-smoke.log'
    $proc = $null
    try {
      $env:LISTEN = ":$SmokePort"
      $env:LOG_LEVEL = 'warn'
      $proc = Start-Process -FilePath $OutAbs -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err"
      $ready = $false
      for ($i = 0; $i -lt 40; $i++) {
        try {
          $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$SmokePort/healthz" -TimeoutSec 2
          if ($r.StatusCode -eq 200) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 250 }
      }
      if (-not $ready) {
        Get-Content $logFile -ErrorAction SilentlyContinue | Write-Host
        Die '健康检查未通过'
      }
      $rootCode = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$SmokePort/" -TimeoutSec 5).StatusCode
      $health = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$SmokePort/healthz" -TimeoutSec 5).Content
      Write-Host "  /healthz $health"
      Write-Host "  / HTTP $rootCode"
    } finally {
      if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
      $env:LISTEN = $savedListen
      $env:LOG_LEVEL = $savedLogLevel
    }
  }
}

Write-Host "==> 运行：$Out  （默认监听 :8080，可用 `$env:LISTEN / `$env:TSHOCK_URL 等环境变量覆盖）"
