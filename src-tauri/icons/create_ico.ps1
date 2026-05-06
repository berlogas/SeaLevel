Add-Type -AssemblyName System.Drawing

$srcPng = "$PSScriptRoot\icon.png"
$dstIco = "$PSScriptRoot\icon.ico"

# Create proper ICO manually
$png = [System.Drawing.Image]::FromFile((Resolve-Path $srcPng).Path)
$mem = New-Object System.IO.MemoryStream

# ICO header
$writer = New-Object System.IO.BinaryWriter($mem)
$writer.Write([UInt16]0)      # Reserved
$writer.Write([UInt16]1)      # Type: 1 = ICO
$writer.Write([UInt16]1)      # Number of images

# Convert PNG to ICO format
$pngStream = New-Object System.IO.MemoryStream
$png.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngStream.ToArray()

# ICONDIRENTRY
$writer.Write([byte]0)        # Width (0 = 256)
$writer.Write([byte]0)       # Height (0 = 256)
$writer.Write([byte]0)        # Color palette
$writer.Write([byte]0)        # Reserved
$writer.Write([UInt16]1)      # Color planes
$writer.Write([UInt16]32)     # Bits per pixel
$writer.Write([UInt32]$pngBytes.Length)  # Size of image data
$writer.Write([UInt32]22)     # Offset to image data (6 + 16 = 22)

# Image data (PNG)
$writer.Write($pngBytes)

$mem.Position = 0
[System.IO.File]::WriteAllBytes($dstIco, $mem.ToArray())

$writer.Dispose()
$mem.Dispose()
$pngStream.Dispose()
$png.Dispose()

Write-Host "icon.ico created successfully"
