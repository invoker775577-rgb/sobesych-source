!include LogicLib.nsh
!include FileFunc.nsh

!ifndef BUILD_UNINSTALLER
; This must run before System.dll (including the installer's mutex plug-in).
Function SobesychProbeTemporaryDirectory
  Exch $0
  Push $1
  Push $2
  Push $3
  StrCpy $3 "failed"
  ClearErrors
  FileOpen $1 "$0\sobesych-write-probe.tmp" w
  IfErrors probe_done
  StrCpy $2 0
  probe_write:
    FileWrite $1 "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    IfErrors probe_close
    IntOp $2 $2 + 1
    IntCmp $2 4096 0 probe_write
    StrCpy $3 "ok"
  probe_close:
  FileClose $1
  Delete "$0\sobesych-write-probe.tmp"
  probe_done:
  StrCpy $0 $3
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

!macro preInit
  InitPluginsDir
  Push "$PLUGINSDIR"
  Call SobesychProbeTemporaryDirectory
  Pop $0
  ${If} $0 != "ok"
    MessageBox MB_OK|MB_ICONSTOP "Sobesych cannot write setup files to the Windows temporary folder.$\r$\nFree disk space and check folder access / Windows Security protection history.$\r$\nThe installed application has not been removed." /SD IDOK
    SetErrorLevel 74
    Quit
  ${EndIf}
!macroend

!macro SobesychCheckInstallSpace DIRECTORY REQUIRED_BYTES
  System::Call 'kernel32::GetDiskFreeSpaceExW(w "${DIRECTORY}", *l .r0, p 0, p 0)i.r1'
  ${If} $1 == 0
    MessageBox MB_OK|MB_ICONSTOP "Sobesych cannot check free disk space. Check access to the temporary and installation folders. The installed application has not been removed." /SD IDOK
    SetErrorLevel 74
    Quit
  ${EndIf}
  System::Int64Op $0 < ${REQUIRED_BYTES}
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Sobesych setup needs 4 GB of free space for temporary files and installation.$\r$\nFree disk space, then run setup again.$\r$\nThe installed application has not been removed." /SD IDOK
    SetErrorLevel 75
    Quit
  ${EndIf}
!macroend

!macro SobesychPreserveGpu SOURCE DESTINATION
  Push $2
  Push $3
  ${If} ${FileExists} "${SOURCE}\cuda\Release\whisper-server.exe"
  ${AndIf} ${FileExists} "${SOURCE}\cuda\Release\cublas64_11.dll"
  ${AndIf} ${FileExists} "${SOURCE}\cuda\Release\cublasLt64_11.dll"
    ${If} ${FileExists} "${DESTINATION}\cuda\Release\whisper-server.exe"
    ${AndIf} ${FileExists} "${DESTINATION}\cuda\Release\cublas64_11.dll"
    ${AndIf} ${FileExists} "${DESTINATION}\cuda\Release\cublasLt64_11.dll"
    ${AndIf} ${FileExists} "${DESTINATION}\cuda\Release\ggml-cuda.dll"
    ${AndIf} ${FileExists} "${DESTINATION}\cuda\Release\ggml.dll"
    ${AndIf} ${FileExists} "${DESTINATION}\cuda\Release\ggml-base.dll"
    ${AndIf} ${FileExists} "${DESTINATION}\cuda\Release\whisper.dll"
    ${AndIf} ${FileExists} "${DESTINATION}\cuda\Release\cudart64_110.dll"
      ; A complete external pack already exists. Do not overwrite user data.
    ${Else}
      ${GetParent} "${DESTINATION}" $2
      CreateDirectory "$2"
      StrCpy $3 ""
      ${If} ${FileExists} "${DESTINATION}\*.*"
        GetTempFileName $3 "$2"
        Delete "$3"
        ClearErrors
        Rename "${DESTINATION}" "$3"
        ${If} ${Errors}
          MessageBox MB_OK|MB_ICONSTOP "Sobesych cannot preserve an incomplete speech package. Close Sobesych and retry. No installed files have been removed." /SD IDOK
          SetErrorLevel 76
          Quit
        ${EndIf}
      ${EndIf}
      ClearErrors
      Rename "${SOURCE}" "${DESTINATION}"
      ${If} ${Errors}
        ${If} $3 != ""
          Rename "$3" "${DESTINATION}"
        ${EndIf}
        MessageBox MB_OK|MB_ICONSTOP "Sobesych could not preserve its NVIDIA speech package.$\r$\nClose Sobesych and retry setup. The installed application has not been removed." /SD IDOK
        SetErrorLevel 76
        Quit
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $3
  Pop $2
!macroend

!macro SobesychPreserveModel SOURCE DESTINATION
  ; Copy before uninstall, retaining the working source even if setup is canceled.
  ${If} ${FileExists} "${SOURCE}\ggml-large-v3-turbo-q5_0.bin"
  ${AndIfNot} ${FileExists} "${DESTINATION}\ggml-large-v3-turbo-q5_0.bin"
    CreateDirectory "${DESTINATION}"
    ClearErrors
    CopyFiles /SILENT "${SOURCE}\ggml-large-v3-turbo-q5_0.bin" "${DESTINATION}\ggml-large-v3-turbo-q5_0.bin.copying"
    ${If} ${Errors}
      Delete "${DESTINATION}\ggml-large-v3-turbo-q5_0.bin.copying"
      MessageBox MB_OK|MB_ICONSTOP "Sobesych could not preserve its speech model. Check free space and folder access. The installed application has not been removed." /SD IDOK
      SetErrorLevel 76
      Quit
    ${EndIf}
    ClearErrors
    Rename "${DESTINATION}\ggml-large-v3-turbo-q5_0.bin.copying" "${DESTINATION}\ggml-large-v3-turbo-q5_0.bin"
    ${If} ${Errors}
      Delete "${DESTINATION}\ggml-large-v3-turbo-q5_0.bin.copying"
      SetErrorLevel 76
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  ; Both checks precede uninstallOldVersion. Never remove a working app first.
  CreateDirectory "$INSTDIR"
  !insertmacro SobesychCheckInstallSpace "$TEMP" 4294967296
  !insertmacro SobesychCheckInstallSpace "$INSTDIR" 4294967296
  !ifdef APP_ID
    !if "${APP_ID}" == "local.sobesych.app"
      !insertmacro SobesychPreserveModel "$INSTDIR\resources\local-stt" "$APPDATA\Sobesych\local-stt"
      !insertmacro SobesychPreserveGpu "$INSTDIR\resources\local-stt" "$APPDATA\Sobesych\local-stt"
    !endif
  !endif
!macroend

!macro SobesychRemoveDuplicateModel INSTALLED CACHE
  ; Only after payload installation: a canceled setup must leave the old app usable.
  ${If} ${FileExists} "${INSTALLED}\ggml-large-v3-turbo-q5_0.bin"
  ${AndIf} ${FileExists} "${INSTALLED}\cpu\Release\whisper-server.exe"
    Delete "${CACHE}\ggml-large-v3-turbo-q5_0.bin"
  ${EndIf}
!macroend

!macro customInstall
  !ifdef APP_ID
    !if "${APP_ID}" == "local.sobesych.app"
      !insertmacro SobesychRemoveDuplicateModel "$INSTDIR\resources\local-stt" "$APPDATA\Sobesych\local-stt"
    !endif
  !endif
!macroend
!endif
