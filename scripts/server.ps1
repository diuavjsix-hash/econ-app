param(
    [ValidateSet('menu', 'start', 'stop', 'status')]
    [string]$Action = 'menu',
    [ValidateRange(1, 65535)]
    [int]$Port = 5173,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskServerScript = Join-Path $PSScriptRoot 'dev-server.mjs'
$taskLocal = Join-Path $taskRoot '.local'
$taskStatePath = Join-Path $taskLocal 'server.json'
$taskOutputPath = Join-Path $taskLocal 'server.stdout.log'
$taskErrorPath = Join-Path $taskLocal 'server.stderr.log'

function Find-ServerNode {
    if ($env:ECON_NODE) {
        $candidates = @($env:ECON_NODE)
    } else {
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        $candidates = @(
            $(if ($nodeCommand) { $nodeCommand.Source }),
            (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'),
            $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'nodejs\node.exe' }),
            $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe' })
        )
    }
    foreach ($candidate in $candidates) {
        if (!$candidate -or !(Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        $version = & $candidate --version 2>$null
        if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 20) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw 'Node.js 20+ was not found. Install Node.js or set ECON_NODE to the full node.exe path.'
}

function Read-ServerState {
    if (!(Test-Path -LiteralPath $taskStatePath)) { return $null }
    $state = Get-Content -LiteralPath $taskStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (!$state.pid -or !$state.startedAt -or !$state.port -or $state.script -ne $taskServerScript) {
        throw "Invalid server record: $taskStatePath"
    }
    return $state
}

function Get-ManagedServer($State) {
    if (!$State) { return $null }
    $serverProcess = Get-Process -Id $State.pid -ErrorAction SilentlyContinue
    if (!$serverProcess -or $serverProcess.StartTime.ToUniversalTime().Ticks.ToString() -ne $State.startedAt) {
        return $null
    }
    $details = Get-CimInstance Win32_Process -Filter "ProcessId = $($State.pid)"
    $argumentPattern = '^\s*(?:"[^"]+"|\S+)\s+"' + [regex]::Escape($taskServerScript) + '"\s*$'
    if ($details.Name -ne 'node.exe' -or $details.CommandLine -notmatch $argumentPattern) { return $null }
    return $serverProcess
}

function Remove-ServerState {
    if (Test-Path -LiteralPath $taskStatePath) { Remove-Item -LiteralPath $taskStatePath }
}

function Open-ServerBrowser([int]$ServerPort) {
    if (!$NoBrowser) {
        try { Start-Process "http://127.0.0.1:$ServerPort/" }
        catch { Write-Host "Open http://127.0.0.1:$ServerPort/ in your browser." }
    }
}

function Invoke-ServerAction([string]$Command) {
    New-Item -ItemType Directory -Path $taskLocal -Force | Out-Null
    # Keep one stable lock file; exclusive access serializes simultaneous button launches.
    $lock = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while (!$lock) {
        try {
            $lock = [IO.File]::Open((Join-Path $taskLocal 'server.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
        } catch [IO.IOException] {
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Another server action is still running. Try again shortly.' }
            Start-Sleep -Milliseconds 150
        }
    }
    try {
        $state = Read-ServerState
        $serverProcess = Get-ManagedServer $state
        if (!$serverProcess) { Remove-ServerState }
        switch ($Command) {
            'status' {
                if ($serverProcess) { Write-Host "Running: http://127.0.0.1:$($state.port)/ (PID $($state.pid))" }
                else { Write-Host 'Stopped.' }
            }
            'stop' {
                if (!$serverProcess) { Write-Host 'Already stopped.'; return }
                # Recheck both creation time and exact script argument before terminating a PID.
                $serverProcess = Get-ManagedServer $state
                if ($serverProcess) {
                    Stop-Process -Id $serverProcess.Id -ErrorAction Stop
                    if (!$serverProcess.WaitForExit(5000)) { throw 'Server did not stop within 5 seconds.' }
                }
                Remove-ServerState
                Write-Host 'Server stopped.'
            }
            'start' {
                if ($serverProcess) {
                    Write-Host "Already running: http://127.0.0.1:$($state.port)/"
                    Open-ServerBrowser $state.port
                    return
                }
                $nodePath = Find-ServerNode
                $previousPort = $env:PORT
                try {
                    $env:PORT = $Port.ToString()
                    $serverProcess = Start-Process -FilePath $nodePath -ArgumentList ('"' + $taskServerScript + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput $taskOutputPath -RedirectStandardError $taskErrorPath -PassThru
                } finally { $env:PORT = $previousPort }
                try {
                    $state = @{
                        pid = $serverProcess.Id
                        startedAt = $serverProcess.StartTime.ToUniversalTime().Ticks.ToString()
                        port = $Port
                        script = $taskServerScript
                    }
                    $state | ConvertTo-Json | Set-Content -LiteralPath $taskStatePath -Encoding UTF8
                    $deadline = [DateTime]::UtcNow.AddSeconds(10)
                    $ready = $false
                    while ([DateTime]::UtcNow -lt $deadline) {
                        $serverProcess.Refresh()
                        if ($serverProcess.HasExited) { break }
                        $output = Get-Content -LiteralPath $taskOutputPath -Raw -ErrorAction SilentlyContinue
                        if ($output -and $output.Contains("Econ Studio: http://127.0.0.1:$Port")) {
                            try {
                                $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 1
                                if ($response.StatusCode -eq 200) { $ready = $true; break }
                            } catch { }
                        }
                        Start-Sleep -Milliseconds 150
                    }
                    if (!$ready) {
                        $errorOutput = Get-Content -LiteralPath $taskErrorPath -Raw -ErrorAction SilentlyContinue
                        if ($errorOutput -match 'EADDRINUSE') { throw "Port $Port is occupied. Stop the other server or use -Port 5174." }
                        throw "Server failed to start. See $taskErrorPath"
                    }
                    Write-Host "Server started: http://127.0.0.1:$Port/"
                } catch {
                    $serverProcess.Refresh()
                    if (!$serverProcess.HasExited) { $serverProcess.Kill(); $serverProcess.WaitForExit(5000) | Out-Null }
                    Remove-ServerState
                    throw
                }
                Open-ServerBrowser $Port
            }
        }
    } finally { $lock.Dispose() }
}

function Show-ServerMenu {
    while ($true) {
        Write-Host "`nEcon Studio - Local server"
        Invoke-ServerAction 'status'
        Write-Host '1. Start / Open browser'
        Write-Host '2. Stop'
        Write-Host '3. Status'
        Write-Host '0. Exit menu (keep server running)'
        $choice = Read-Host 'Select'
        try {
            switch ($choice) {
                '1' { Invoke-ServerAction 'start' }
                '2' { Invoke-ServerAction 'stop' }
                '3' { Invoke-ServerAction 'status' }
                '0' { return }
                default { Write-Host 'Choose 0, 1, 2 or 3.' }
            }
        } catch { Write-Host $_.Exception.Message -ForegroundColor Red }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        if ($Action -eq 'menu') { Show-ServerMenu }
        else { Invoke-ServerAction $Action }
    } catch {
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
}
