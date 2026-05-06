Add-Type -AssemblyName System.Drawing

$srcPng = "N:\Development\SeaLevel\image.png"
$iconDir = "N:\Development\SeaLevel\src-tauri\icons"

# Load source image
$srcImg = [System.Drawing.Image]::FromFile($srcPng)

# Create sizes function
function Create-SizeIcon {
    param($srcImg, $size, $dstPath)
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.Clear([System.Drawing.Color]::FromArgb(26, 82, 118))  # Fallback bg
    $g.DrawImage($srcImg, 0, 0, $size, $size)
    $g.Dispose()
    $bmp.Save($dstPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

# Create PNGs of different sizes
Create-SizeIcon -srcImg $srcImg -size 32 -dstPath "$iconDir\32x32.png"
Create-SizeIcon -srcImg $srcImg -size 128 -dstPath "$iconDir\128x128.png"
Create-SizeIcon -srcImg $srcImg -size 256 -dstPath "$iconDir\128x128@2x.png"
Create-SizeIcon -srcImg $srcImg -size 256 -dstPath "$iconDir\icon.png"

$srcImg.Dispose()

# Create ICO from 256x256 PNG
$png256 = [System.Drawing.Image]::FromFile("$iconDir\icon.png")
$mem = New-Object System.IO.MemoryStream

$writer = New-Object System.IO.BinaryWriter($mem)
$writer.Write([UInt16]0)      # Reserved
$writer.Write([UInt16]1)      # Type: ICO
$writer.Write([UInt16]1)      # Number of images

$pngStream = New-Object System.IO.MemoryStream
$png256.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngStream.ToArray()

$writer.Write([byte]0)        # Width (0 = 256)
$writer.Write([byte]0)        # Height (0 = 256)
$writer.Write([byte]0)        # Color palette
$writer.Write([byte]0)        # Reserved
$writer.Write([UInt16]1)      # Color planes
$writer.Write([UInt16]32)     # Bits per pixel
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)

$writer.Write($pngBytes)

$mem.Position = 0
[System.IO.File]::WriteAllBytes("$iconDir\icon.ico", $mem.ToArray())

$writer.Dispose()
$mem.Dispose()
$pngStream.Dispose()
$png256.Dispose()

Write-Host "Icons created from image.png"
