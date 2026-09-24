$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$nonSystem = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -ne $env:SystemDrive.TrimEnd(':') } | Select-Object -First 1
$suggestion = if ($nonSystem) { Join-Path $nonSystem.Root 'CourseCove-ASR' } else { Join-Path $env:USERPROFILE 'CourseCove-ASR' }
Write-Host 'Course Cove optional local transcription installer'
Write-Host 'Choose a folder with several GB free. The model, Python, packages and caches will stay there.'
try {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = '选择本地转写组件的安装目录（建议非系统盘）'
    $picker.ShowNewFolderButton = $true
    $picker.SelectedPath = if ($nonSystem) { $nonSystem.Root } else { $env:USERPROFILE }
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw '已取消安装。' }
    $chosen = $picker.SelectedPath
} catch {
    if ($_.Exception.Message -eq '已取消安装。') { throw }
    $chosen = Read-Host "Install folder [$suggestion]"
    if ([string]::IsNullOrWhiteSpace($chosen)) { $chosen = $suggestion }
}
$chosen = $chosen.Trim('"')
if (-not [System.IO.Path]::IsPathRooted($chosen)) { throw 'Please enter an absolute folder path.' }
$homePath = [System.IO.Path]::GetFullPath($chosen)
if ($homePath -eq [System.IO.Path]::GetPathRoot($homePath)) { $homePath = Join-Path $homePath 'CourseCove-ASR' }
New-Item -ItemType Directory -Path $homePath -Force | Out-Null
foreach ($name in @('tools', 'python', 'cache', 'tmp', 'model')) {
    New-Item -ItemType Directory -Path (Join-Path $homePath $name) -Force | Out-Null
}

$env:UV_UNMANAGED_INSTALL = Join-Path $homePath 'tools'
$env:UV_CACHE_DIR = Join-Path $homePath 'cache\uv'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $homePath 'python'
$env:UV_PYTHON_BIN_DIR = Join-Path $homePath 'python\bin'
$env:UV_NO_MODIFY_PATH = '1'
$env:UV_PYTHON_PREFERENCE = 'only-managed'
$env:HF_HOME = Join-Path $homePath 'cache\huggingface'
$env:TEMP = Join-Path $homePath 'tmp'
$env:TMP = $env:TEMP

$uv = Join-Path $homePath 'tools\uv.exe'
if (-not (Test-Path $uv)) {
    Write-Host 'Downloading the Python installer...'
    $installer = Join-Path $homePath 'tmp\uv-install.ps1'
    Invoke-WebRequest 'https://astral.sh/uv/install.ps1' -OutFile $installer
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
    if ($LASTEXITCODE -ne 0) { throw 'Could not install uv.' }
}
if (-not (Test-Path $uv)) { throw 'uv.exe was not found in the chosen folder.' }

Write-Host 'Installing isolated Python 3.12...'
& $uv python install 3.12 --install-dir $env:UV_PYTHON_INSTALL_DIR --no-bin
if ($LASTEXITCODE -ne 0) { throw 'Python installation failed.' }
& $uv venv (Join-Path $homePath '.venv') --python 3.12
if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment.' }
$python = Join-Path $homePath '.venv\Scripts\python.exe'
& $uv pip install --python $python 'faster-whisper==1.2.1' 'huggingface-hub>=0.25,<2'
if ($LASTEXITCODE -ne 0) { throw 'Transcription packages could not be installed.' }

Copy-Item (Join-Path $PSScriptRoot 'server.py') (Join-Path $homePath 'server.py') -Force
Copy-Item (Join-Path $PSScriptRoot 'start-local-asr.cmd') (Join-Path $homePath '启动本地转写.cmd') -Force
& $python (Join-Path $PSScriptRoot 'download_model.py') (Join-Path $homePath 'model')
if ($LASTEXITCODE -ne 0) { throw 'Model download failed. Rerun the installer to continue.' }

$configPath = Join-Path $homePath 'config.json'
if (Test-Path $configPath) {
    $token = (Get-Content $configPath -Raw | ConvertFrom-Json).token
} else {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    [System.IO.File]::WriteAllText($configPath, (@{ token = $token } | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
}
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    $gpuChoice = Read-Host 'NVIDIA GPU detected. Install optional GPU libraries (about 1.3 GB) here? [Y/n]'
    if ($gpuChoice -notmatch '^[Nn]') {
        try { & (Join-Path $PSScriptRoot 'enable-gpu.ps1') -InstallDir $homePath }
        catch { Write-Warning "GPU setup failed; CPU transcription remains available. $($_.Exception.Message)" }
    }
}
Write-Host "`nInstalled at: $homePath"
Write-Host 'Start the local service with 启动本地转写.cmd, then paste this code into Course Cove:'
Write-Host $token
