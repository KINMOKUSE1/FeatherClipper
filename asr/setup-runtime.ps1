param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [ValidateSet('cpu', 'gpu', 'online')][string]$Mode = 'cpu',
    [Parameter(Mandatory = $true)][string]$ResultFile
)
# Inno Setup supplies the directory and mode; this worker has no interactive prompts.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONUTF8 = '1'

function Step([int]$Number) { Write-Output "STEP|$Number" }
function Run([string]$Program, [string[]]$Arguments) {
    $command = Get-Command $Program -CommandType Application -ErrorAction Stop
    # Package managers also use stderr for progress in Windows PowerShell.
    $ErrorActionPreference = 'Continue'
    & $command.Source @Arguments 2>&1 | ForEach-Object { Write-Output "$_" }
    if ($LASTEXITCODE -ne 0) { throw "运行命令失败（退出码 $LASTEXITCODE），请查看上方日志" }
}

try {
    if (-not [System.IO.Path]::IsPathRooted($InstallDir)) { throw '请选择完整的安装目录路径' }
    $installRoot = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
    if ($installRoot -eq [System.IO.Path]::GetPathRoot($installRoot).TrimEnd('\')) { throw '请在磁盘中选择一个文件夹，不要直接安装到磁盘根目录' }
    $marker = Join-Path $installRoot '.vid2notes-asr'
    $configPath = Join-Path $installRoot 'config.json'
    $existing = (Test-Path -LiteralPath $configPath) -and (Test-Path -LiteralPath (Join-Path $installRoot 'server.py'))
    if ((Test-Path -LiteralPath $installRoot) -and -not (Test-Path -LiteralPath $marker) -and -not $existing -and
        (Get-ChildItem -LiteralPath $installRoot -Force | Select-Object -First 1)) {
        throw '请选择空文件夹，或已有的 Vid2Notes 本地转写安装目录'
    }
    $config = $null
    if (Test-Path -LiteralPath $configPath) {
        try { $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
        catch { throw '无法读取原连接配置，请检查安装目录中的 config.json' }
    }
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    [System.IO.File]::WriteAllText($marker, 'Vid2Notes local transcription')
    foreach ($name in @('tools', 'python', 'cache', 'tmp', 'model')) {
        New-Item -ItemType Directory -Path (Join-Path $installRoot $name) -Force | Out-Null
    }
    $env:UV_UNMANAGED_INSTALL = Join-Path $installRoot 'tools'
    $env:UV_CACHE_DIR = Join-Path $installRoot 'cache\uv'
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $installRoot 'python'
    $env:UV_PYTHON_BIN_DIR = Join-Path $installRoot 'python\bin'
    $env:UV_NO_MODIFY_PATH = '1'
    $env:UV_PYTHON_PREFERENCE = 'only-managed'
    $env:UV_HTTP_TIMEOUT = '600'
    $env:UV_HTTP_RETRIES = '5'
    $env:UV_CONCURRENT_DOWNLOADS = '1'
    $env:HF_HOME = Join-Path $installRoot 'cache\huggingface'
    $env:TEMP = Join-Path $installRoot 'tmp'
    $env:TMP = $env:TEMP
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    Step 1
    $uv = Join-Path $installRoot 'tools\uv.exe'
    if (-not (Test-Path -LiteralPath $uv)) {
        $uvInstaller = Join-Path $installRoot 'tmp\uv-install.ps1'
        Invoke-WebRequest 'https://astral.sh/uv/install.ps1' -UseBasicParsing -OutFile $uvInstaller
        Run 'powershell.exe' @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $uvInstaller)
    }
    if (-not (Test-Path -LiteralPath $uv)) { throw '运行环境下载工具未安装成功' }
    Step 2
    Run $uv @('python', 'install', '3.12', '--install-dir', $env:UV_PYTHON_INSTALL_DIR, '--no-bin')
    $python = Join-Path $installRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $python)) { Run $uv @('venv', (Join-Path $installRoot '.venv'), '--python', '3.12') }
    Step 3
    if ($Mode -eq 'online') { Run $uv @('pip', 'install', '--python', $python, 'av>=11,<20') }
    else { Run $uv @('pip', 'install', '--python', $python, 'faster-whisper==1.2.1', 'huggingface-hub>=0.25,<2') }
    Step 4
    if ($Mode -ne 'online') {
        Run $python @((Join-Path $PSScriptRoot 'download_model.py'), (Join-Path $installRoot 'model'))
        foreach ($name in @('config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt')) {
            if (-not (Test-Path -LiteralPath (Join-Path $installRoot "model\$name"))) { throw "模型文件不完整：$name" }
        }
    }
    Step 5
    if ($Mode -eq 'gpu') {
        Run $uv @('pip', 'install', '--python', $python, 'nvidia-cublas-cu12>=12,<13', 'nvidia-cudnn-cu12>=9,<10')
        $libraries = Join-Path $installRoot '.venv\Lib\site-packages\nvidia'
        foreach ($name in @('cublas64_12.dll', 'cudnn64_9.dll')) {
            if (-not (Get-ChildItem -LiteralPath $libraries -Filter $name -File -Recurse | Select-Object -First 1)) {
                throw "GPU 运行库不完整：$name"
            }
        }
    }
    Step 6
    if ($Mode -eq 'online') { Run $python @('-c', 'import av') }
    else { Run $python @('-c', 'import faster_whisper, huggingface_hub') }
    if (-not $config) { $config = [PSCustomObject]@{ token = '' } }
    if ([string]::IsNullOrWhiteSpace($config.token)) {
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $config | Add-Member -NotePropertyName token -NotePropertyValue ([System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()) -Force
    }
    $config | Add-Member -NotePropertyName gpu_enabled -NotePropertyValue ($Mode -eq 'gpu') -Force
    [System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
    # Return the connection code privately to the wizard, never to its log.
    [System.IO.File]::WriteAllText($ResultFile, $config.token, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output 'DONE'
    exit 0
} catch {
    Write-Output "ERROR|$($_.Exception.Message)"
    exit 1
}
