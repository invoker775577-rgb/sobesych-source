param([string]$Target = (Join-Path $PSScriptRoot '..\vendor\local-stt'), [switch]$EngineOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$windowsModules = Join-Path $PSHOME 'Modules'
$env:PSModulePath = @($windowsModules, $env:PSModulePath, (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')) -join ';'
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
Import-Module Microsoft.PowerShell.Archive -ErrorAction Stop
$Target = [IO.Path]::GetFullPath($Target)
$release = Join-Path $Target 'cuda\Release'
New-Item -ItemType Directory -Force -Path $Target | Out-Null

$model = Join-Path $Target 'ggml-large-v3-turbo-q5_0.bin'
$required = @(
  $model,
  (Join-Path $release 'whisper-server.exe'),
  (Join-Path $release 'whisper.dll'),
  (Join-Path $release 'ggml.dll'),
  (Join-Path $release 'ggml-base.dll'),
  (Join-Path $release 'ggml-cuda.dll'),
  (Join-Path $release 'cudart64_110.dll'),
  (Join-Path $release 'cublas64_11.dll'),
  (Join-Path $release 'cublasLt64_11.dll')
)
if (($required | Where-Object { !($EngineOnly -and $_ -eq $model) -and !(Test-Path -LiteralPath $_) }).Count -eq 0) {
  if ($EngineOnly -or (Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash -eq '394221709CD5AD1F40C46E6031CA61BCE88931E6E088C188294C6D5A55FFA7E2') {
    Write-Output "Local STT ready: $Target"
    exit 0
  }
}

function Download-Verified($url, $file, $hash) {
  if (!(Test-Path -LiteralPath $file) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $hash) {
    $partial = "$file.download"
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $partial -TimeoutSec 600
      if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $hash) { throw 'Downloaded speech component checksum mismatch' }
      Move-Item -LiteralPath $partial -Destination $file -Force
    } finally {
      if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    }
  }
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $hash) { throw "Checksum failed: $file" }
}

if (!$EngineOnly) {
  Download-Verified 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin?download=true' $model '394221709CD5AD1F40C46E6031CA61BCE88931E6E088C188294C6D5A55FFA7E2'
}

$cudaZip = Join-Path $Target 'whisper-cuda.zip'
Download-Verified 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-cublas-11.8.0-bin-x64.zip' $cudaZip '1776668730F5594A0B15F930225779E863DD8280397F9EE7C6E47CCF82BBB203'
Expand-Archive -LiteralPath $cudaZip -DestinationPath (Join-Path $Target 'cuda') -Force

$meta = Invoke-RestMethod 'https://pypi.org/pypi/nvidia-cublas-cu11/11.11.3.6/json'
$wheel = $meta.urls | Where-Object { $_.filename -match 'win_amd64' } | Select-Object -First 1
if (!$wheel) { throw 'Windows cuBLAS package not found' }
$cublasZip = Join-Path $Target 'cublas.zip'
Download-Verified $wheel.url $cublasZip '6AB12B1302BEF8AC1FF4414EDD1C059E57F4833ABEF9151683FB8F4DE25900BE'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($cublasZip)
try {
  foreach ($name in @('cublas64_11.dll', 'cublasLt64_11.dll')) {
    $entry = $archive.Entries | Where-Object { $_.Name -eq $name } | Select-Object -First 1
    if (!$entry) { throw "Missing $name in cuBLAS package" }
    $destination = Join-Path $release $name
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
  }
} finally { $archive.Dispose() }
Write-Output "Local STT ready: $Target"
foreach ($archivePath in @($cudaZip, $cublasZip)) {
  if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
}
