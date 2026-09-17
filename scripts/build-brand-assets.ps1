# Build Qomicex Harness brand assets: extract embedded raster layers, generate .png/.ico/.icns icon set.
# ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI, which mangles CJK literals.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$ws      = 'D:\Qomicex.Harness'
$brand   = Join-Path $ws 'brand'
$src     = Join-Path $brand 'source'
$layers  = Join-Path $src 'layers'
$iconDir = Join-Path $brand 'icon'
$candDir = Join-Path $brand 'candidates'
New-Item -ItemType Directory -Force -Path $src, $layers, $iconDir, $candDir | Out-Null

# ---------- 1. take the source SVGs from brand/source and classify them by declared width ----------
$svgs = @(Get-ChildItem -LiteralPath $src -Filter *.svg -File)
if ($svgs.Count -eq 0) { throw "No .svg found in $src" }
$info = foreach ($f in $svgs) {
  $head = (Get-Content -Raw -LiteralPath $f.FullName).Substring(0, 400)
  $m = [regex]::Match($head, '<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"')
  [pscustomobject]@{ File = $f; W = [double]$m.Groups[1].Value; H = [double]$m.Groups[2].Value }
}
$markSrc   = ($info | Sort-Object W | Select-Object -First 1).File
$lockupSrc = ($info | Sort-Object W -Descending | Select-Object -First 1).File
Write-Host "[1] source SVGs in brand/source  (mark=$($markSrc.Name), lockup=$($lockupSrc.Name))"

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

# ---------- 3. pick the mark: the layer shared by BOTH source files, near-square, largest area ----------
# pixel signature: coarse alpha+color downsample, robust to re-export differences
function Get-PixelSignature([string]$p) {
  $img = [System.Drawing.Image]::FromFile($p)
  $bmp = New-Object System.Drawing.Bitmap $img
  $w = $bmp.Width; $h = $bmp.Height
  $sb = New-Object System.Text.StringBuilder
  for ($gy = 0; $gy -lt 24; $gy++) {
    for ($gx = 0; $gx -lt 24; $gx++) {
      $px = $bmp.GetPixel([int]($gx * $w / 24), [int]($gy * $h / 24))
      [void]$sb.Append(([int]($px.A / 32))).Append(([int]($px.R / 48))).Append(([int]($px.G / 48))).Append(([int]($px.B / 48))).Append(',')
    }
  }
  $bmp.Dispose(); $img.Dispose()
  return $sb.ToString()
}

$bySig = @{}
foreach ($l in $all) {
  $sig = Get-PixelSignature $l.Path
  if (-not $bySig.ContainsKey($sig)) { $bySig[$sig] = @() }
  $bySig[$sig] += $l
}
$shared = $bySig.Values | Where-Object {
  (($_ | ForEach-Object { $_.Name.Split('-')[0] }) | Sort-Object -Unique).Count -gt 1
}
$markCandidate = $shared |
  ForEach-Object { $_[0] } |
  Where-Object { $_.H -gt 0 -and (($_.W / $_.H) -ge 0.8) -and (($_.W / $_.H) -le 1.25) } |
  Sort-Object -Property @{Expression={$_.W * $_.H}} -Descending |
  Select-Object -First 1

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

# candidate comparison sheets (so a human can confirm which layer is the real mark)
foreach ($l in ($all | Where-Object { $_.W -ge 64 })) {
  $bmp = New-Square $l.Path 512 0.9
  $bmp.Save((Join-Path $candDir ("cand-{0}.png" -f $l.Name)), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Save((Join-Path $candDir ("cand-{0}" -f $l.Name)), [System.Drawing.Imaging.ImageFormat]::Png)
}
Write-Host "[4] candidate squares -> brand/candidates"

# ---------- 5. icon set ----------
$sizes = 16, 24, 32, 48, 64, 128, 256, 512, 1024
$png = @{}
foreach ($s in $sizes) {
  $bmp = New-Square $markCandidate.Path $s 0.86
  $p = Join-Path $iconDir ("icon-{0}.png" -f $s)
  $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
  $png[$s] = $p
  $bmp.Dispose()
}
Copy-Item -LiteralPath $png[1024] -Destination (Join-Path $iconDir 'icon.png') -Force
Write-Host "[5] PNG icon set: $($sizes -join ', ')"

# ---------- 6. .ico (PNG-compressed entries) ----------
$icoSizes = 16, 24, 32, 48, 64, 128, 256
$entries = foreach ($s in $icoSizes) { [pscustomobject]@{ Size = $s; Bytes = [IO.File]::ReadAllBytes($png[$s]) } }
$entries = @($entries)
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
Write-Host "[6] icon.ico ($($icoSizes -join ', '))"

# ---------- 7. .icns (modern PNG chunk types, big-endian) ----------
$icnsChunks = @(
  @{ Type = 'ic11'; Size = 32 }, @{ Type = 'ic12'; Size = 64 },
  @{ Type = 'ic07'; Size = 128 }, @{ Type = 'ic13'; Size = 256 },
  @{ Type = 'ic14'; Size = 512 }, @{ Type = 'ic08'; Size = 256 },
  @{ Type = 'ic09'; Size = 512 }, @{ Type = 'ic10'; Size = 1024 }
)
# ICNS is big-endian: build the byte array by hand instead of BinaryWriter (which is little-endian).
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
Write-Host "[7] icon.icns ($total bytes)"
Write-Host "[7] icon.icns ($total bytes)"

# ---------- 8. record what was produced ----------
$report = [pscustomobject]@{
  markSource = $markCandidate.Name
  markSize   = "$($markCandidate.W)x$($markCandidate.H)"
  layers     = @($all | ForEach-Object { [pscustomobject]@{ file = $_.Name; w = $_.W; h = $_.H } })
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $brand 'assets.json') -Encoding UTF8
Write-Host "[8] brand/assets.json written"
Write-Host ''
Write-Host "DONE -> $brand"
