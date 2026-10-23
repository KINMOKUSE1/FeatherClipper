[CmdletBinding()]
param(
    [ValidateSet('Edge', 'Chrome')]
    [string]$Browser,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Vid2Notes\extension'),
    [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'
$markerName = '.vid2notes-install'
$markerText = 'Vid2Notes managed extension directory'

function Find-Browser([string]$Name) {
    $relative = if ($Name -eq 'Edge') { 'Microsoft\Edge\Application\msedge.exe' } else { 'Google\Chrome\Application\chrome.exe' }
    foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA) | Where-Object { $_ }) {
        $candidate = Join-Path $base $relative
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    $executable = if ($Name -eq 'Edge') { 'msedge.exe' } else { 'chrome.exe' }
    foreach ($hive in @('HKCU:', 'HKLM:')) {
        $key = Get-Item -LiteralPath "$hive\Software\Microsoft\Windows\CurrentVersion\App Paths\$executable" -ErrorAction SilentlyContinue
        if ($key) {
            $candidate = $key.GetValue('')
            if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
        }
    }
    return $null
}

function Initialize-InstallerTerminal {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Vid2NotesTerminal {
    [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int handle);
    [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr handle, out uint mode);
    [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr handle, uint mode);
}
'@
    $script:escape = [char]27
    $script:terminalHandle = [Vid2NotesTerminal]::GetStdHandle(-11)
    $script:originalMode = [uint32]0
    $script:useAnsi = [Vid2NotesTerminal]::GetConsoleMode($script:terminalHandle, [ref]$script:originalMode) -and
        [Vid2NotesTerminal]::SetConsoleMode($script:terminalHandle, ($script:originalMode -bor 4))
    if ($script:useAnsi) {
        $script:previousEncoding = [Console]::OutputEncoding
        [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    }
    $script:interactive = $script:useAnsi -and -not [Console]::IsInputRedirected
    $light = [Console]::BackgroundColor -in @([ConsoleColor]::White, [ConsoleColor]::Gray)
    $script:tones = if ($light) {
        @{ accent = '151;97;24'; muted = '99;106;116'; success = '58;117;81' }
    } else {
        @{ accent = '224;174;95'; muted = '151;160;172'; success = '147;192;161' }
    }
}

function Write-InstallerText([string]$Text = '', [string]$Tone = '', [switch]$NoNewline) {
    if ($script:useAnsi) {
        $style = if ($Tone -eq 'bold') { '1' } elseif ($Tone) { '38;2;' + $script:tones[$Tone] } else { '0' }
        $value = "$script:escape[${style}m$Text$script:escape[0m"
        if ($NoNewline) { [Console]::Write($value) } else { [Console]::WriteLine($value) }
    } else {
        $colors = @{ accent = 'DarkYellow'; muted = 'Gray'; success = 'Green' }
        if ($colors.ContainsKey($Tone)) { Write-Host $Text -ForegroundColor $colors[$Tone] -NoNewline:$NoNewline }
        else { Write-Host $Text -NoNewline:$NoNewline }
    }
}

function Write-InstallerIntro {
    Write-InstallerText
    if (-not $script:useAnsi) {
        Write-InstallerText "  Vid2Notes  v$($manifest.version)"
        Write-InstallerText '  浏览器扩展安装助手' 'muted'
        Write-InstallerText
        return
    }
    # A purpose-built 20 x 20 terminal penguin, not a resampled PNG.
    $pixels = @(
        '........dd..........', '.......dggd.........', '......dggggd........', '.....dggggggd.......',
        '...dggwwwggwwwggd...', '...dggwwwwwwwwggd...', '...dgwwkkwwkkwwgd...', '...dgwwkkwwkkwwgd...',
        '...dgwwwwyywwwwgd...', '...dggwwyyyywwggd...', '...dgggwwwwwwgggd...', '...dggwwwwwwwwggd...',
        '..dgsggwwwwwwggsgd..', '..dggsgwwwwwwgsggd..', '..dgggwwwwwwwwgggd..', '..ddggwwwwwwwwggdd..',
        '...dggwwwwwwwwggd...', '...dgggwwwwwwgggd...', '...dggggddddggggd...', '...dddddd..dddddd...'
    )
    $palette = @{ d = '70;83;102'; g = '108;122;141'; s = '159;171;186'; w = '252;243;224'; k = '30;35;43'; y = '228;167;64' }
    for ($row = 0; $row -lt 20; $row += 2) {
        $line = New-Object Text.StringBuilder
        [void]$line.Append('  ')
        for ($col = 0; $col -lt 20; $col++) {
            $top = [string]$pixels[$row][$col]; $bottom = [string]$pixels[$row + 1][$col]
            $part = if ($top -eq '.' -and $bottom -eq '.') { "$script:escape[0m " }
                elseif ($top -eq '.') { "$script:escape[49m$script:escape[38;2;$($palette[$bottom])m▄" }
                elseif ($bottom -eq '.') { "$script:escape[49m$script:escape[38;2;$($palette[$top])m▀" }
                else { "$script:escape[38;2;$($palette[$top])m$script:escape[48;2;$($palette[$bottom])m▀" }
            [void]$line.Append($part)
        }
        [Console]::Write("$line$script:escape[0m")
        switch ($row) {
            4 { Write-InstallerText '    Vid2Notes' 'bold' -NoNewline; Write-InstallerText "  v$($manifest.version)" 'muted' -NoNewline }
            8 { Write-InstallerText '    浏览器扩展安装助手' 'muted' -NoNewline }
        }
        Write-InstallerText
    }
    Write-InstallerText
}

function Clear-InstallerBlock([int]$Rows) {
    if ($script:interactive) { [Console]::Write("$script:escape[${Rows}F$script:escape[J") }
}

function Read-InstallerKey { [Console]::ReadKey($true) }

function Select-InstallerBrowser($Options) {
    $selected = 0
    if (-not $script:interactive) {
        Write-InstallerText '  ◆ 选择浏览器' 'accent'
        for ($i = 0; $i -lt $Options.Count; $i++) { Write-InstallerText ("    [{0}] {1}" -f ($i + 1), $Options[$i].Name) }
        do {
            $choice = Read-Host '  输入编号，Enter 默认选择第一项'
            if (-not $choice) { return $Options[0].Name }
            $number = 0
        } until ([int]::TryParse($choice, [ref]$number) -and $number -ge 1 -and $number -le $Options.Count)
        return $Options[$number - 1].Name
    }
    while ($true) {
        Write-InstallerText '  │' 'muted'
        Write-InstallerText '  ◆ 选择浏览器' 'accent'
        for ($i = 0; $i -lt $Options.Count; $i++) {
            if ($i -eq $selected) { Write-InstallerText "  │  ● $($Options[$i].Name)" 'accent' }
            else { Write-InstallerText "  │  ○ $($Options[$i].Name)" 'muted' }
        }
        Write-InstallerText '  │' 'muted'
        Write-InstallerText '  └ ↑/↓ 选择 · Enter 确认 · Esc 退出' 'muted'
        $key = Read-InstallerKey
        Clear-InstallerBlock ($Options.Count + 4)
        switch ($key.Key) {
            'UpArrow' { $selected = ($selected + $Options.Count - 1) % $Options.Count }
            'DownArrow' { $selected = ($selected + 1) % $Options.Count }
            'Enter' { return $Options[$selected].Name }
            'Escape' { return $null }
            default {
                $number = 0
                if ([int]::TryParse([string]$key.KeyChar, [ref]$number) -and $number -ge 1 -and $number -le $Options.Count) {
                    return $Options[$number - 1].Name
                }
            }
        }
    }
}

function Copy-InstallerFiles {
    $arguments = @($source, $target, '/MIR', '/XJ', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XF', $markerName)
    if (-not $script:interactive) { & robocopy.exe @arguments | Out-Null; return $LASTEXITCODE }
    $worker = New-Object Diagnostics.Process
    $worker.StartInfo.FileName = (Get-Command robocopy.exe).Source
    $worker.StartInfo.Arguments = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $worker.StartInfo.UseShellExecute = $false; $worker.StartInfo.CreateNoWindow = $true
    $worker.StartInfo.RedirectStandardOutput = $true; $worker.StartInfo.RedirectStandardError = $true
    try {
        [void]$worker.Start()
        $output = $worker.StandardOutput.ReadToEndAsync(); $errors = $worker.StandardError.ReadToEndAsync()
        $frames = @('◒', '◐', '◓', '◑'); $frame = 0
        while (-not $worker.WaitForExit(100)) {
            [Console]::Write("`r$script:escape[2K")
            Write-InstallerText "  $($frames[$frame % 4]) 正在准备扩展文件" 'accent' -NoNewline
            $frame++
        }
        $worker.WaitForExit()
        $output.GetAwaiter().GetResult() | Out-Null; $errors.GetAwaiter().GetResult() | Out-Null
        [Console]::Write("`r$script:escape[2K")
        return $worker.ExitCode
    } finally { $worker.Dispose() }
}

try {
    $source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\extension')).TrimEnd('\')
    $manifestPath = Join-Path $source 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw '请完整解压安装包，再运行“安装.cmd”' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.name -ne 'Vid2Notes') { throw '安装包中的扩展信息不匹配' }

    $target = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
    $comparison = [StringComparison]::OrdinalIgnoreCase
    if ($target -eq [IO.Path]::GetPathRoot($target).TrimEnd('\') -or $target.Equals($source, $comparison) -or
        $target.StartsWith($source + '\', $comparison) -or $source.StartsWith($target + '\', $comparison)) {
        throw '安装目录不能是磁盘根目录、源码目录或源码的上级及下级目录'
    }
    $marker = Join-Path $target $markerName
    $updating = $false
    if (Test-Path -LiteralPath $target) {
        $directory = Get-Item -LiteralPath $target -Force
        if (-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw '安装目录必须是普通文件夹'
        }
        if (Get-ChildItem -LiteralPath $target -Force | Select-Object -First 1) {
            if (-not (Test-Path -LiteralPath $marker -PathType Leaf) -or [IO.File]::ReadAllText($marker).Trim() -ne $markerText) {
                throw '目标文件夹已有其他文件，请使用空文件夹或之前由安装助手创建的目录'
            }
            $updating = $true
        }
    }

    $browserPath = $null
    if (-not $PrepareOnly) {
        Initialize-InstallerTerminal
        Write-InstallerIntro
        $available = @('Edge', 'Chrome') | ForEach-Object {
            $path = Find-Browser $_
            if ($path) { [pscustomobject]@{ Name = $_; Path = $path } }
        }
        $available = @($available)
        if (-not $available.Count) { throw '没有找到 Chrome 或 Edge，请先安装浏览器' }
        if (-not $Browser) {
            if ($available.Count -eq 1) { $Browser = $available[0].Name }
            else { $Browser = Select-InstallerBrowser $available }
            if (-not $Browser) { Write-InstallerText '  └ 已取消安装' 'muted'; exit 0 }
        }
        $browserPath = ($available | Where-Object Name -eq $Browser | Select-Object -First 1).Path
        if (-not $browserPath) { throw "没有找到 $Browser，请选择已安装的浏览器" }
    }

    if (-not $PrepareOnly) { Write-InstallerText "  ◇ 浏览器  $Browser" 'muted' }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    [IO.File]::WriteAllText($marker, $markerText)
    # Mirror only the checked empty/owned directory; updates remove obsolete extension files.
    $copyExit = Copy-InstallerFiles
    if ($copyExit -ge 8) { throw "复制扩展文件失败（代码 $copyExit），请重新运行安装助手" }
    if ($PrepareOnly) { Write-Host "Vid2Notes $($manifest.version) 已准备好"; Write-Host "扩展目录：$target" }
    if ($PrepareOnly) { exit 0 }

    Write-InstallerText '  ◇ 扩展文件已准备好' 'success'
    $url = if ($Browser -eq 'Edge') { 'edge://extensions/' } else { 'chrome://extensions/' }
    try { Set-Clipboard -Value $url; $clipboardMessage = '地址已复制' }
    catch { $clipboardMessage = '请复制地址' }
    Write-InstallerText '  │' 'muted'
    Write-InstallerText '  ◆ 在浏览器打开扩展管理页' 'accent'
    Write-InstallerText "  │  $url"
    Write-InstallerText "  │  $clipboardMessage · Ctrl+L → Ctrl+V → Enter" 'muted'
    Write-InstallerText '  │' 'muted'
    Write-InstallerText '  └ 打开后回到这里，按 Enter 继续' 'muted'
    # Chromium filters privileged URLs from command-line launches.
    Start-Process -FilePath $browserPath -ArgumentList @('--new-window', 'about:blank')
    if ($script:interactive) {
        do { $key = Read-InstallerKey } until ($key.Key -in @('Enter', 'Escape'))
        if ($key.Key -eq 'Escape') { Write-InstallerText '  └ 已退出指引，扩展文件已保留' 'muted'; exit 0 }
        Clear-InstallerBlock 6
    } else { Read-Host '  打开管理页后按 Enter 继续' | Out-Null }
    Write-InstallerText '  ◇ 继续加载扩展' 'muted'
    try { Set-Clipboard -Value $target; $clipboardMessage = '扩展目录已复制' }
    catch { $clipboardMessage = '请复制下方目录' }
    Write-InstallerText '  │' 'muted'
    Write-InstallerText '  ◆ 在管理页加载扩展' 'accent'
    Write-InstallerText "  │  $clipboardMessage" 'success'
    Write-InstallerText "  │  $target"
    Write-InstallerText '  │'
    Write-InstallerText '  │  开启开发者模式 → 加载解压缩的扩展'
    Write-InstallerText '  │  粘贴目录，按 Enter 进入，再点“选择文件夹”' 'muted'
    if ($updating) { Write-InstallerText '  │  已加载过此目录：点击“重新加载”' 'muted' }
    Write-InstallerText '  │' 'muted'
    Write-InstallerText '  └ 浏览器确认加载后，即可开始使用' 'muted'
    Write-InstallerText
    exit 0
} catch {
    Write-Host ("  × 安装未完成：{0}" -f $_.Exception.Message) -ForegroundColor Red
    exit 1
}

finally {
    if ($script:useAnsi) {
        [Console]::Write("$script:escape[0m")
        [void][Vid2NotesTerminal]::SetConsoleMode($script:terminalHandle, $script:originalMode)
        [Console]::OutputEncoding = $script:previousEncoding
    }
}
