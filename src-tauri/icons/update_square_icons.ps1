Add-Type -AssemblyName System.Drawing

$srcPng = "N:\Development\SeaLevel\image.png"
$iconDir = "N:\Development\SeaLevel\src-tauri\icons"

$srcImg = [System.Drawing.Image]::FromFile($srcPng)

# Update Square*Logo.png files
$sizes = @(107, 142, 150, 284, 30, 310, 44, 71, 89)

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.DrawImage($srcImg, 0, 0, $size, $size)
    $g.Dispose()
    $bmp.Save("$iconDir\Square${size}x${size}Logo.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Updated Square${size}x${size}Logo.png"
}

# Update StoreLogo
$bmp = New-Object System.Drawing.Bitmap(50, 50)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = 'HighQualityBicubic'
$g.DrawImage($srcImg, 0, 0, 50, 50)
$g.Dispose()
$bmp.Save("$iconDir\StoreLogo.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "Updated StoreLogo.png"

$srcImg.Dispose()
Write-Host "Done!"
