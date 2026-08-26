# Generates build/icon.ico (multi-size) and build/icon.png from vector-like drawing.
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$outIco = Join-Path $PSScriptRoot '..\build\icon.ico'
$outPng = Join-Path $PSScriptRoot '..\build\icon.png'

function New-IconBitmap {
  param([int]$Size)
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  # background: rounded rect with vertical gradient
  $r = [Math]::Max(2, [int]($Size * 0.22))
  $edge = $Size - 1
  $rect = New-Object System.Drawing.Rectangle -ArgumentList 0, 0, $edge, $edge
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc(($rect.Right - $d), $rect.Y, $d, $d, 270, 90)
  $path.AddArc(($rect.Right - $d), ($rect.Bottom - $d), $d, $d, 0, 90)
  $path.AddArc($rect.X, ($rect.Bottom - $d), $d, $d, 90, 90)
  $path.CloseFigure()

  $c1 = [System.Drawing.Color]::FromArgb(255, 124, 92, 255)
  $c2 = [System.Drawing.Color]::FromArgb(255, 58, 134, 255)
  $p1 = New-Object System.Drawing.Point -ArgumentList 0, 0
  $p2 = New-Object System.Drawing.Point -ArgumentList 0, $Size
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $p1, $p2, $c1, $c2
  $g.FillPath($brush, $path)

  # subtle inner glow line
  $pen = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::FromArgb(70, 255, 255, 255)), ([float][Math]::Max(1, [int]($Size / 64)))
  $g.DrawPath($pen, $path)

  # text "OX"
  if ($Size -ge 24) {
    $fontSize = [float]($Size * 0.46)
    $font = New-Object System.Drawing.Font -ArgumentList 'Segoe UI', $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $white = [System.Drawing.Brushes]::White
    $textRect = New-Object System.Drawing.RectangleF -ArgumentList ([float]0), ([float]($Size * -0.02)), ([float]$Size), ([float]$Size)
    $g.DrawString('OX', $font, $white, $textRect, $fmt)
    $font.Dispose()
    $fmt.Dispose()
  }

  $g.Dispose()
  return $bmp
}

$sizes = @(256, 128, 64, 48, 32, 16)

# PNG export (512 via upscale-free: draw at 256 then save; use largest size for png at 256)
$pngBmp = New-IconBitmap 256
$pngBmp.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBmp.Dispose()

# ICO container with multiple images
$fs = [System.IO.File]::Create($outIco)
$bw = New-Object System.IO.BinaryWriter -ArgumentList $fs

$count = $sizes.Count
# ICONDIR
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$count)

$bitmaps = @()
foreach ($s in $sizes) { $bitmaps += ,(New-IconBitmap $s) }

$offset = 6 + 16 * $count
foreach ($i in 0..($count - 1)) {
  $bmp = $bitmaps[$i]
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBytes = $ms.ToArray()
  $ms.Dispose()

  $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $bw.Write([Byte]$dim)          # width
  $bw.Write([Byte]$dim)          # height
  $bw.Write([Byte]0)             # palette
  $bw.Write([Byte]0)             # reserved
  $bw.Write([UInt16]1)           # planes
  $bw.Write([UInt16]32)          # bpp
  $bw.Write([UInt32]$pngBytes.Length)
  $bw.Write([UInt32]$offset)
  $offset += $pngBytes.Length
}
foreach ($bmp in $bitmaps) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bw.Write($ms.ToArray())
  $ms.Dispose()
  $bmp.Dispose()
}
$bw.Flush(); $bw.Close(); $fs.Close()

Write-Host "icon.ico (multi-size) and icon.png written to build/"
