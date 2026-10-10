param([string]$InstallDir)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = '选择已有的 Vid2Notes 本地转写安装目录'
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw '已取消 GPU 安装。' }
    $InstallDir = $picker.SelectedPath
}
$homePath = [System.IO.Path]::GetFullPath($InstallDir.Trim('"'))
$uv = Join-Path $homePath 'tools\uv.exe'
$python = Join-Path $homePath '.venv\Scripts\python.exe'
$configPath = Join-Path $homePath 'config.json'
if (-not (Test-Path $uv) -or -not (Test-Path $python) -or -not (Test-Path $configPath)) {
    throw '所选目录不是已安装的 Vid2Notes 本地转写组件。'
}

$env:UV_CACHE_DIR = Join-Path $homePath 'cache\uv'
$env:UV_HTTP_TIMEOUT = '600'
$env:UV_HTTP_RETRIES = '5'
$env:UV_CONCURRENT_DOWNLOADS = '1'
$env:TEMP = Join-Path $homePath 'tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
Write-Host 'Installing optional NVIDIA CUDA 12 cuBLAS and cuDNN 9 into the selected folder...'
& $uv pip install --python $python 'nvidia-cublas-cu12>=12,<13' 'nvidia-cudnn-cu12>=9,<10'
if ($LASTEXITCODE -ne 0) { throw 'GPU libraries could not be installed. CPU transcription is unchanged.' }

$libraries = Join-Path $homePath '.venv\Lib\site-packages\nvidia'
foreach ($name in @('cublas64_12.dll', 'cudnn64_9.dll')) {
    if (-not (Get-ChildItem $libraries -Filter $name -File -Recurse | Select-Object -First 1)) {
        throw "GPU library $name was not found. CPU transcription is unchanged."
    }
}
$serverSource = Join-Path $PSScriptRoot 'server.py'
$serverTarget = Join-Path $homePath 'server.py'
if (-not [string]::Equals([System.IO.Path]::GetFullPath($serverSource), [System.IO.Path]::GetFullPath($serverTarget), [System.StringComparison]::OrdinalIgnoreCase)) {
    Copy-Item $serverSource $serverTarget -Force
}
$startSource = Join-Path $PSScriptRoot 'start-local-asr.cmd'
$startTarget = Join-Path $homePath '启动本地转写.cmd'
if (Test-Path $startSource) { Copy-Item $startSource $startTarget -Force }
elseif (-not (Test-Path $startTarget)) { throw 'The local service launcher was not found.' }
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$config | Add-Member -NotePropertyName gpu_enabled -NotePropertyValue $true -Force
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'GPU acceleration enabled. Close the old service window and restart 启动本地转写.cmd.'
Write-Host 'The service will test the GPU before transcription and use CPU if the GPU cannot run.'
