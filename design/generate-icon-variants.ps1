param([switch]$ApplyBold)

Add-Type -AssemblyName System.Drawing

$designRoot = Join-Path (Get-Location) 'design'
$sourcePath = Join-Path $designRoot 'icon-sprout-book-pixel-original.png'
$source = [System.Drawing.Bitmap]::FromFile($sourcePath)
$cyan = [System.Drawing.Color]::FromArgb(255, 0, 184, 209)
$lightCyan = [System.Drawing.Color]::FromArgb(255, 145, 243, 242)

function New-Variant([int]$left, [int]$right, [bool]$fullerSprout) {
  $result = [System.Drawing.Bitmap]::new(32, 32, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for ($y = 0; $y -lt 32; $y++) {
    for ($x = $left; $x -le $right; $x++) {
      $sourceX = 6 + [int][Math]::Round(($x - $left) * 18.0 / ($right - $left))
      $color = $source.GetPixel($sourceX, $y)
      if ($color.A -gt 0) { $result.SetPixel($x, $y, $color) }
    }
  }
  if ($fullerSprout) {
    $extra = [System.Collections.Generic.List[object]]::new()
    for ($y = 2; $y -le 8; $y++) {
      for ($x = 1; $x -lt 31; $x++) {
        $color = $result.GetPixel($x, $y)
        if ($color.A -gt 0 -and $color.G -gt 140 -and $color.R -lt 170) {
          foreach ($dx in @(-1, 1)) {
            $targetX = $x + $dx
            if ($targetX -ge 1 -and $targetX -le 30 -and $result.GetPixel($targetX, $y).A -eq 0) {
              $extra.Add(@($targetX, $y, $cyan))
            }
          }
        }
      }
    }
    foreach ($entry in $extra) { $result.SetPixel($entry[0], $entry[1], $entry[2]) }
    for ($y = 3; $y -le 5; $y++) {
      foreach ($x in @(11, 12, 21, 22)) {
        if ($result.GetPixel($x, $y).A -gt 0) { $result.SetPixel($x, $y, $lightCyan) }
      }
    }
  }
  return $result
}

function Save-Scaled([System.Drawing.Bitmap]$bitmap, [string]$name) {
  $smallPath = Join-Path $designRoot "icon-variant-$name-32.png"
  $largePath = Join-Path $designRoot "icon-variant-$name-128.png"
  $bitmap.Save($smallPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $large = [System.Drawing.Bitmap]::new(128, 128, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($large)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $graphics.DrawImage($bitmap, [System.Drawing.Rectangle]::new(0, 0, 128, 128), [System.Drawing.Rectangle]::new(0, 0, 32, 32), [System.Drawing.GraphicsUnit]::Pixel)
  $graphics.Dispose()
  $large.Save($largePath, [System.Drawing.Imaging.ImageFormat]::Png)
  $large.Dispose()
}

$variants = @(
  @{ Name = 'balanced'; Label = 'A  Balanced'; Image = (New-Variant 4 27 $false) },
  @{ Name = 'bold'; Label = 'B  Bold'; Image = (New-Variant 2 29 $false) },
  @{ Name = 'sprout'; Label = 'C  Sprout'; Image = (New-Variant 3 28 $true) }
)
foreach ($variant in $variants) { Save-Scaled $variant.Image $variant.Name }

$sheet = [System.Drawing.Bitmap]::new(1200, 570, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.Clear([System.Drawing.Color]::FromArgb(248, 250, 255))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$font = [System.Drawing.Font]::new('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
$smallFont = [System.Drawing.Font]::new('Segoe UI', 10)
$ink = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(28, 42, 79))
$muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(89, 103, 139))
$white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$dark = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(32, 40, 72))
$border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(216, 225, 244))
$all = @(@{ Label = 'Current'; Image = $source }) + $variants
for ($i = 0; $i -lt $all.Count; $i++) {
  $entry = $all[$i]
  $x0 = 20 + $i * 295
  $g.FillRectangle($white, $x0, 20, 275, 530)
  $g.DrawRectangle($border, $x0, 20, 275, 530)
  $g.DrawString($entry.Label, $font, $ink, ($x0 + 20), 38)
  $g.DrawString('128 px display', $smallFont, $muted, ($x0 + 20), 81)
  $g.DrawImage($entry.Image, [System.Drawing.Rectangle]::new(($x0 + 73), 105, 128, 128), [System.Drawing.Rectangle]::new(0, 0, 32, 32), [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString('48 px', $smallFont, $muted, ($x0 + 27), 265)
  $g.DrawString('32 px', $smallFont, $muted, ($x0 + 109), 265)
  $g.DrawString('16 px', $smallFont, $muted, ($x0 + 188), 265)
  foreach ($sample in @(@(35, 48), @(115, 32), @(200, 16))) {
    $g.DrawImage($entry.Image, [System.Drawing.Rectangle]::new(($x0 + $sample[0]), 295, $sample[1], $sample[1]), [System.Drawing.Rectangle]::new(0, 0, 32, 32), [System.Drawing.GraphicsUnit]::Pixel)
  }
  $g.FillRectangle($dark, ($x0 + 20), 370, 235, 150)
  $g.DrawString('Dark toolbar', $smallFont, $white, ($x0 + 34), 385)
  $g.DrawImage($entry.Image, [System.Drawing.Rectangle]::new(($x0 + 43), 420, 64, 64), [System.Drawing.Rectangle]::new(0, 0, 32, 32), [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawImage($entry.Image, [System.Drawing.Rectangle]::new(($x0 + 136), 433, 32, 32), [System.Drawing.Rectangle]::new(0, 0, 32, 32), [System.Drawing.GraphicsUnit]::Pixel)
}
$previewPath = Join-Path $designRoot 'icon-variants-preview.png'
$sheet.Save($previewPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $sheet.Dispose(); $font.Dispose(); $smallFont.Dispose(); $ink.Dispose(); $muted.Dispose(); $white.Dispose(); $dark.Dispose(); $border.Dispose()
if ($ApplyBold) {
  $bold = ($variants | Where-Object Name -eq 'bold').Image
  Copy-Item -LiteralPath (Join-Path $designRoot 'icon-variant-bold-32.png') -Destination (Join-Path $designRoot 'icon-sprout-book-pixel-master.png') -Force
  $iconRoot = Join-Path (Get-Location) 'extension/icons'
  foreach ($size in @(16, 32, 48, 128)) {
    $target = Join-Path $iconRoot "icon$size.png"
    if ($size -eq 32) { Copy-Item -LiteralPath (Join-Path $designRoot 'icon-variant-bold-32.png') -Destination $target -Force; continue }
    if ($size -eq 128) { Copy-Item -LiteralPath (Join-Path $designRoot 'icon-variant-bold-128.png') -Destination $target -Force; continue }
    $export = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $canvas = [System.Drawing.Graphics]::FromImage($export)
    $canvas.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $canvas.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $canvas.DrawImage($bold, [System.Drawing.Rectangle]::new(0, 0, $size, $size), [System.Drawing.Rectangle]::new(0, 0, 32, 32), [System.Drawing.GraphicsUnit]::Pixel)
    $canvas.Dispose()
    $export.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    $export.Dispose()
  }
  Write-Output 'Applied bold variant to extension icons'
}
foreach ($variant in $variants) { $variant.Image.Dispose() }
$source.Dispose()
Write-Output "Created $previewPath"

