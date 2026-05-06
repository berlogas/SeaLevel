Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap(256,256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(26,82,118))
$g.SmoothingMode = 'AntiAlias'

# Фон - синий круг
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(52,152,219))
$g.FillEllipse($brush, 20, 20, 216, 216)

# Волны
$brush2 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(93,173,226))
for($i=0; $i -lt 3; $i++) {
    $y = 140 + $i * 30
    $g.FillEllipse($brush2, $y, (130 - $i * 10), 200, 60)
}

# Уровень - желтая линия
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(244,208,63), 6)
$g.DrawLine($pen, 100, 60, 100, 200)

# Точки на концах линии
$brush3 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(244,208,63))
$g.FillEllipse($brush3, 88, 50, 24, 24)
$g.FillEllipse($brush3, 88, 186, 24, 24)

$g.Dispose()
$bmp.Save("$PSScriptRoot\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host "icon.png created"
