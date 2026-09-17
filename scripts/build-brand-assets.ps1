# Build Qomicex Harness brand assets from the two source SVGs in brand/source.
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI,
# which mangles CJK literals.
#
# The source SVGs are NOT vector art: each is an SVG wrapper around several
# base64-embedded PNG layers. This script extracts those layers, then derives
# every shipped asset from the two layers named in $MARK_LAYER and $LOCKUP_LAYER.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$ws      = 'D:\Qomicex.Harness'
$brand   = Join-Path $ws 'brand'
$src     = Join-Path $brand 'source'
$layers  = Join-Path $src 'layers'
$iconDir = Join-Path $brand 'icon'
$markDir = Join-Path $brand 'mark'
$lockDir = Join-Path $brand 'lockup'
$candDir = Join-Path $brand 'candidates'
New-Item -ItemType Directory -Force -Path $src, $layers, $iconDir, $markDir, $lockDir, $candDir | Out-Null

# The complete artwork. The other shared layers are partial exports: mark-layer5
# covers 41.7% of its canvas while mark-layer1 covers 71.5%, and lockup-layer1
# covers 14.1% against 30% for lockup-layer2.
$MARK_LAYER   = 'mark-layer1-501x625.png'
$LOCKUP_LAYER = 'lockup-layer2-2161x520.png'

# ---------- 1. classify the source SVGs by declared width ----------
$svgs = @(Get-ChildItem -LiteralPath $src -Filter *.svg -File)
if ($svgs.Count -eq 0) { throw "No .svg found in $src" }
$info = foreach ($f in $svgs) {
  $head = (Get-Content -Raw -LiteralPath $f.FullName).Substring(0, 400)
  $m = [regex]::Match($head, '<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"')
  [pscustomobject]@{ File = $f; W = [double]$m.Groups[1].Value; H = [double]$m.Groups[2].Value }
}
$markSrc   = ($info | Sort-Object W | Select-Object -First 1).File
$lockupSrc = ($info | Sort-Object W -Descending | Select-Object -First 1).File
Write-Host "[1] sources: mark=$($markSrc.Name)  lockup=$($lockupSrc.Name)"

# ---------- 2. extract every embedded raster layer ----------
function Get-Layers([string]$svgPath, [string]$stem) {
  $c = Get-Content -Raw -LiteralPath $svgPath
  $ms = [regex]::Matches($c, 'data:img/png;base64,([A-Za-z0-9+/=]+)')
  $n = 0
  foreach ($m in $ms) {
    $bytes = [Convert]::FromBase64String($m.Groups[1].Value)
    $w = [System.BitConverter]::ToUInt32(($bytes[16..19])[3..0], 0)
    $h = [System.BitConverter]::ToUInt32(($bytes[20..23])[3..0], 0)
    $n++
    $name = '{0}-layer{1}-{2}x{3}.png' -f $stem, $n, $w, $h
    $full = Join-Path $layers $name
    [IO.File]::WriteAllBytes($full, $bytes)
    [pscustomobject]@{ Index = $n; Path = $full; Name = $name; W = [int]$w; H = [int]$h; Bytes = $bytes.Length }
  }
}
$all = @()
$all += Get-Layers (Join-Path $src 'qomicex-mark.svg')   'mark'
$all += Get-Layers (Join-Path $src 'qomicex-lockup.svg') 'lockup'
Write-Host "[2] extracted $($all.Count) embedded layers -> brand/source/layers"

# ---------- 3. resolve the two chosen layers ----------
function Resolve-Layer([string]$name) {
  $hit = $all | Where-Object { $_.Name -eq $name } | Select-Object -First 1
  if (-not $hit) { throw "chosen layer not found among extracted layers: $name" }
  return $hit
}
$markLayer   = Resolve-Layer $MARK_LAYER
$lockupLayer = Resolve-Layer $LOCKUP_LAYER
Write-Host "[3] mark   = $($markLayer.Name) ($($markLayer.W)x$($markLayer.H))"
Write-Host "    lockup = $($lockupLayer.Name) ($($lockupLayer.W)x$($lockupLayer.H))"

# ---------- 4. render helpers ----------
function New-Square([string]$inPath, [int]$size, [double]$contentRatio) {
  $img = [System.Drawing.Image]::FromFile($inPath)
  $side = [int][Math]::Round($size * $contentRatio)
  $scale = [Math]::Min($side / $img.Width, $side / $img.Height)
  $dw = [int][Math]::Round($img.Width * $scale)
  $dh = [int][Math]::Round($img.Height * $scale)
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.DrawImage($img, [int](($size - $dw) / 2), [int](($size - $dh) / 2), $dw, $dh)
  $g.Dispose(); $img.Dispose()
  return $bmp
}

function New-Contain([string]$inPath, [int]$targetW, [int]$targetH) {
  $img = [System.Drawing.Image]::FromFile($inPath)
  $scale = [Math]::Min($targetW / $img.Width, $targetH / $img.Height)
  $dw = [int][Math]::Round($img.Width * $scale)
  $dh = [int][Math]::Round($img.Height * $scale)
  $bmp = New-Object System.Drawing.Bitmap($targetW, $targetH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.DrawImage($img, [int](($targetW - $dw) / 2), [int](($targetH - $dh) / 2), $dw, $dh)
  $g.Dispose(); $img.Dispose()
  return $bmp
}

# ---------- 5. candidate comparison squares ----------
Get-ChildItem $candDir -File -ErrorAction SilentlyContinue | Remove-Item -Force
foreach ($l in ($all | Where-Object { $_.W -ge 64 })) {
  $bmp = New-Square $l.Path 512 0.9
  $bmp.Save((Join-Path $candDir ("cand-{0}" -f $l.Name)), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
Write-Host "[5] candidate squares -> brand/candidates"

# ---------- 6. application icon set ----------
$sizes = 16, 24, 32, 48, 64, 128, 256, 512, 1024
$png = @{}
foreach ($s in $sizes) {
  $bmp = New-Square $markLayer.Path $s 0.86
  $p = Join-Path $iconDir ("icon-{0}.png" -f $s)
  $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
  $png[$s] = $p
  $bmp.Dispose()
}
Copy-Item -LiteralPath $png[1024] -Destination (Join-Path $iconDir 'icon.png') -Force
Write-Host "[6] PNG icon set: $($sizes -join ', ')"

# ---------- 7. in-app mark sizes (sidebar and hero) ----------
$markSizes = 20, 24, 28, 32, 48, 64, 96, 128, 256
foreach ($s in $markSizes) {
  $bmp = New-Square $markLayer.Path $s 0.94
  $bmp.Save((Join-Path $markDir ("qomicex-mark-{0}.png" -f $s)), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
Write-Host "[7] in-app mark set: $($markSizes -join ', ')"

# ---------- 8. lockup (horizontal logo) ----------
$lockTargetH = 256
$lockTargetW = [int][Math]::Round($lockupLayer.W * ($lockTargetH / $lockupLayer.H))
$bmp = New-Contain $lockupLayer.Path $lockTargetW $lockTargetH
$bmp.Save((Join-Path $lockDir 'qomicex-lockup.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Copy-Item -LiteralPath $lockupLayer.Path -Destination (Join-Path $lockDir ("qomicex-lockup-{0}x{1}.png" -f $lockupLayer.W, $lockupLayer.H)) -Force
Write-Host "[8] lockup -> brand/lockup (${lockTargetW}x${lockTargetH} plus full resolution)"

# ---------- 9. .ico (PNG-compressed entries) ----------
$icoSizes = 16, 24, 32, 48, 64, 128, 256
$entries = @(foreach ($s in $icoSizes) { [pscustomobject]@{ Size = $s; Bytes = [IO.File]::ReadAllBytes($png[$s]) } })
$msIco = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($msIco)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$entries.Count)
$offset = 6 + (16 * $entries.Count)
foreach ($e in $entries) {
  $dim = if ($e.Size -ge 256) { 0 } else { $e.Size }
  $bw.Write([byte]$dim); $bw.Write([byte]$dim)
  $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32)
  $bw.Write([uint32]$e.Bytes.Length); $bw.Write([uint32]$offset)
  $offset += $e.Bytes.Length
}
foreach ($e in $entries) { $bw.Write($e.Bytes) }
$bw.Flush()
[IO.File]::WriteAllBytes((Join-Path $iconDir 'icon.ico'), $msIco.ToArray())
$bw.Dispose(); $msIco.Dispose()
Write-Host "[9] icon.ico ($($icoSizes -join ', '))"

# ---------- 10. .icns (PNG chunk types, big-endian) ----------
$icnsChunks = @(
  @{ Type = 'ic11'; Size = 32 }, @{ Type = 'ic12'; Size = 64 },
  @{ Type = 'ic07'; Size = 128 }, @{ Type = 'ic13'; Size = 256 },
  @{ Type = 'ic14'; Size = 512 }, @{ Type = 'ic08'; Size = 256 },
  @{ Type = 'ic09'; Size = 512 }, @{ Type = 'ic10'; Size = 1024 }
)
$body = New-Object System.Collections.Generic.List[byte]
foreach ($ch in $icnsChunks) {
  $data = [IO.File]::ReadAllBytes($png[$ch.Size])
  $len = $data.Length + 8
  foreach ($b in [Text.Encoding]::ASCII.GetBytes($ch.Type)) { $body.Add($b) }
  $body.Add([byte](($len -shr 24) -band 0xFF))
  $body.Add([byte](($len -shr 16) -band 0xFF))
  $body.Add([byte](($len -shr 8) -band 0xFF))
  $body.Add([byte]($len -band 0xFF))
  foreach ($b in $data) { $body.Add($b) }
}
$total = 8 + $body.Count
$arr = New-Object byte[] $total
[Text.Encoding]::ASCII.GetBytes('icns').CopyTo($arr, 0)
$arr[4] = [byte](($total -shr 24) -band 0xFF)
$arr[5] = [byte](($total -shr 16) -band 0xFF)
$arr[6] = [byte](($total -shr 8) -band 0xFF)
$arr[7] = [byte]($total -band 0xFF)
$body.CopyTo($arr, 8)
[IO.File]::WriteAllBytes((Join-Path $iconDir 'icon.icns'), $arr)
Write-Host "[10] icon.icns ($total bytes)"

# ---------- 11. record what was produced ----------
$report = [pscustomobject]@{
  markLayer   = $markLayer.Name
  markSize    = "$($markLayer.W)x$($markLayer.H)"
  lockupLayer = $lockupLayer.Name
  lockupSize  = "$($lockupLayer.W)x$($lockupLayer.H)"
  layers      = @($all | ForEach-Object { [pscustomobject]@{ file = $_.Name; w = $_.W; h = $_.H } })
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $brand 'assets.json') -Encoding UTF8
Write-Host "[11] brand/assets.json written"
Write-Host ''
Write-Host "DONE -> $brand"