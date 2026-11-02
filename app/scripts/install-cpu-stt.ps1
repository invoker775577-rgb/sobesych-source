param(
  [string]$Target = (Join-Path $PSScriptRoot '..\vendor\local-stt-cpu'),
  [ValidateSet('base', 'small', 'large-v3-turbo')][string]$Model = 'large-v3-turbo'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Target = [IO.Path]::GetFullPath($Target)
$release = Join-Path $Target 'cpu\Release'
New-Item -ItemType Directory -Force -Path $release | Out-Null

function Download-Verified($url, $file, $hash) {
  if ((Test-Path -LiteralPath $file) -and (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -eq $hash) { return }
  $partial = "$file.download"
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $partial -TimeoutSec 600
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $hash) { throw 'Downloaded speech component checksum mismatch' }
    Move-Item -LiteralPath $partial -Destination $file -Force
  } finally {
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
  }
}

$archivePath = Join-Path $Target 'whisper-cpu.zip'
Download-Verified 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-blas-bin-x64.zip' $archivePath 'FFE5B47CA8E53A7677949F23A9C4641BBEC4EEE8A5714C3D14B67BB8D7B24A78'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $names = @{}
  foreach ($entry in $archive.Entries) {
    if ($entry.Name -ne 'whisper-server.exe' -and $entry.Name -notlike '*.dll') { continue }
    if ($names.ContainsKey($entry.Name)) { throw 'Ambiguous speech component in archive' }
    $names[$entry.Name] = $true
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $release $entry.Name), $true)
  }
  if (!$names.ContainsKey('whisper-server.exe')) { throw 'CPU speech server is missing from archive' }
} finally { $archive.Dispose() }

$hash = switch ($Model) {
  'base' { '422F1AE452ADE6F30A004D7E5C6A43195E4433BC370BF23FAC9CC591F01A8898' }
  'small' { 'AE85E4A935D7A567BD102FE55AFC16BB595BDB618E11B2FC7591BC08120411BB' }
  'large-v3-turbo' { '394221709CD5AD1F40C46E6031CA61BCE88931E6E088C188294C6D5A55FFA7E2' }
}
$modelFile = if ($Model -eq 'large-v3-turbo') { 'ggml-large-v3-turbo-q5_0.bin' } else { "ggml-$Model-q5_1.bin" }
$destination = Join-Path $Target $modelFile
$existing = Join-Path $PSScriptRoot "..\vendor\local-stt\$modelFile"
if (!(Test-Path -LiteralPath $destination) -and (Test-Path -LiteralPath $existing) -and (Get-FileHash -LiteralPath $existing -Algorithm SHA256).Hash -eq $hash) {
  Copy-Item -LiteralPath $existing -Destination $destination
}
$revision = if ($Model -eq 'large-v3-turbo') { '5359861c739e955e79d9a303bcbc70fb988958b1' } else { 'f281eb45af861ab5e5297d23694b7d46e090c02c' }
Download-Verified "https://huggingface.co/ggerganov/whisper.cpp/resolve/$revision/$modelFile" $destination $hash
Write-Output "Verified CPU speech runtime and model: $Model"
