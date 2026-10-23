# Regenerates fusion.ico from packages/client/public/icon-512.png (the Fusion mark,
# same drawing as favicon.svg). Run from the repo root: powershell -File tools/release/assets/regen-ico.ps1
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path "packages/client/public/icon-512.png"))
$tmp = Join-Path $env:TEMP "fusion-ico-png"
New-Item -ItemType Directory -Force $tmp | Out-Null
$files = @()
foreach ($s in 16, 24, 32, 48, 64, 256) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $s, $s)
  $g.Dispose()
  $f = Join-Path $tmp "$s.png"
  $bmp.Save($f, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $files += $f
}
$src.Dispose()
node tools/release/assets/pack-ico.mjs tools/release/assets/fusion.ico @files
