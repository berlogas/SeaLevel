Add-Type -AssemblyName System.Drawing

$iconPng = "$PSScriptRoot\icon.png"

# Resize to different sizes
function Resize-Png {
    param($src, $dst, $size)
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'
    $srcBmp = [System.Drawing.Image]::FromFile($src)
    $g.DrawImage($srcBmp, 0, 0, $size, $size)
    $g.Dispose()
    $srcBmp.Dispose()
    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

Resize-Png -src $iconPng -dst "$PSScriptRoot\32x32.png" -size 32
Resize-Png -src $iconPng -dst "$PSScriptRoot\128x128.png" -size 128
Resize-Png -src $iconPng -dst "$PSScriptRoot\128x128@2x.png" -size 256

# Create ICO from 256x256 PNG
$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $iconPng).Path)
$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = [System.IO.FileStream]::new("$PSScriptRoot\icon.ico", [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$bmp.Dispose()

Write-Host "Icons created: 32x32, 128x128, 128x128@2x, icon.ico"
