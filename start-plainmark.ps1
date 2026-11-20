# Launches PlainMark v2 locally without unsigned .exe builds (Windows Smart App Control safe).
# 1. Starts FastAPI backend on 127.0.0.1:4985 if not already listening.
# 2. Opens Edge in standalone desktop app mode (--app=http://127.0.0.1:4985).
param(
    [int]$Port = 4985,
    [string]$DataDir = ""
)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$backendDir = Join-Path $repoRoot 'backend'
$venvPython = Join-Path $backendDir '.venv\Scripts\python.exe'
$url = "http://127.0.0.1:$Port"
$healthUrl = "$url/api/health"
$logDir = Join-Path $env:LOCALAPPDATA 'PlainMark'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-BackendAlive {
    try {
        $resp = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1 -ErrorAction Stop
        return ($resp.status -eq 'ok')
    } catch {
        return $false
    }
}

if (-not (Test-BackendAlive)) {
    if (-not (Test-Path $venvPython)) {
        throw "Backend venv not found at $venvPython. Run: uv sync --directory `"$backendDir`""
    }
    if ($DataDir) {
        $env:PLAINMARK_DATA_DIR = $DataDir
    }
    $env:PLAINMARK_PORT = "$Port"

    $stdoutLog = Join-Path $logDir 'backend.out.log'
    $stderrLog = Join-Path $logDir 'backend.err.log'

    Start-Process -FilePath $venvPython `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$Port") `
        -WorkingDirectory $backendDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog

    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 200
        if (Test-BackendAlive) {
            $ready = $true
            break
        }
    }
    if (-not $ready) {
        throw "PlainMark backend failed to start on $url. Check $stderrLog"
    }
}

$edgeCandidates = @(
    "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$edgeExe = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($edgeExe) {
    $profileDir = Join-Path $logDir 'EdgeApp'
    Start-Process -FilePath $edgeExe -ArgumentList @(
        "--app=$url",
        "--user-data-dir=$profileDir",
        "--window-size=1280,840"
    )
} else {
    Start-Process $url
}
