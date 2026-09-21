param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$projectDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runtimeDir = Join-Path $projectDir '.local/wiki-editor'
$runtimeFile = Join-Path $runtimeDir 'runtime.json'
$running = $false
if (Test-Path -LiteralPath $runtimeFile) {
    try {
        $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
        if ($runtime.url -match '^http://127\.0\.0\.1:88[0-9]{2}$') {
            $health = Invoke-RestMethod -Uri ($runtime.url + '/api/health') -TimeoutSec 2
            $running = $health.app -eq 'ellan-wiki-editor' -and $health.root -eq $projectDir
        }
    } catch { $running = $false }
}
if (-not $running) {
    $node = (Get-Command node -ErrorAction Stop).Source
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $process = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $PSScriptRoot 'server.mjs') + '"') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'out.log') -RedirectStandardError (Join-Path $runtimeDir 'error.log')
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 250
        if (Test-Path -LiteralPath $runtimeFile) {
            $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
            if ($runtime.pid -eq $process.Id) { $running = $true; break }
        }
        if ($process.HasExited) { break }
    }
    if (-not $running) { throw "Editor failed to start. See $runtimeDir/error.log" }
}
if (-not $NoOpen) { Start-Process $runtime.url }
Write-Output $runtime.url
