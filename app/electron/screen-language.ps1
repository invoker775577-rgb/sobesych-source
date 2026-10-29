$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$ocrType = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$resultType = [Windows.Media.Ocr.OcrResult, Windows.Media.Ocr, ContentType = WindowsRuntime]
$decoderType = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$bitmapType = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and
    $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1
} | Select-Object -First 1

function Await-Result($Operation, [Type]$ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.GetAwaiter().GetResult()
}

$stream = $null
$writer = $null
$bitmap = $null
try {
    $languages = @($ocrType::AvailableRecognizerLanguages)
    # Prepare the recognizer while the user selects a region; no pixels arrive yet.
    $language = $languages | Where-Object { $_.LanguageTag -match '^ru(?:-|$)' } | Select-Object -First 1
    if (-not $language) { $language = $languages | Where-Object { $_.LanguageTag -match '^en(?:-|$)' } | Select-Object -First 1 }
    if (-not $language) { throw 'No supported recognizer' }
    $engine = $ocrType::TryCreateFromLanguage($language)
    if (-not $engine) { throw 'Recognizer unavailable' }
    [Console]::Out.WriteLine('{"ready":true}')
    [Console]::Out.Flush()
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $bytes = [Convert]::FromBase64String($payload.image)
    if ($bytes.Length -gt 4MB) { throw 'Image too large' }
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $writer = New-Object Windows.Storage.Streams.DataWriter($stream.GetOutputStreamAt(0))
    $writer.WriteBytes($bytes)
    $null = Await-Result $writer.StoreAsync() ([UInt32])
    $writer.DetachStream() | Out-Null
    $stream.Seek(0)
    $decoder = Await-Result ($decoderType::CreateAsync($stream)) $decoderType
    if ($decoder.PixelWidth -gt $ocrType::MaxImageDimension -or $decoder.PixelHeight -gt $ocrType::MaxImageDimension) { throw 'Image dimensions too large' }
    $bitmap = Await-Result ($decoder.GetSoftwareBitmapAsync()) $bitmapType
    $result = Await-Result ($engine.RecognizeAsync($bitmap)) $resultType
    @{ lines = @($result.Lines | Select-Object -First 6 | ForEach-Object { $_.Text }) } | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine('Local OCR unavailable.')
    exit 1
} finally {
    if ($bitmap) { $bitmap.Dispose() }
    if ($writer) { $writer.Dispose() }
    if ($stream) { $stream.Dispose() }
}
