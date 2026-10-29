param(
  [Parameter(Mandatory=$true)][string]$Path,
  [Parameter(Mandatory=$true)][string]$Text,
  [Parameter(Mandatory=$true)][ValidateSet('ru', 'en')][string]$Language
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voice = if ($Language -eq 'en') { 'Microsoft Zira Desktop' } else { 'Microsoft Irina Desktop' }
  $speaker.SelectVoice($voice)
  if ($Language -eq 'en') { $speaker.Rate = -1 }
  $speaker.SetOutputToWaveFile($Path)
  $speaker.Speak($Text)
} finally { $speaker.Dispose() }
