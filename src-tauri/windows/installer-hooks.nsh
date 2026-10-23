; In-app updates launch this installer and then quit izumi. Shutting down (libmpv, WebView2) can
; outlast the installer's fixed 500 ms wait after its kill, so overwriting izumi.exe failed with a
; "file in use" Retry prompt. Wait until Windows releases the old executable first; past the limit
; the installer's own running-app check kills it as before.
!macro NSIS_HOOK_PREINSTALL
  ${If} $UpdateMode = 1
  ${AndIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R9 0
    ${Do}
      ClearErrors
      ; "a" opens for writing without truncating; a running image refuses write access.
      FileOpen $R8 "$INSTDIR\${MAINBINARYNAME}.exe" a
      ${IfNot} ${Errors}
        FileClose $R8
        ${Break}
      ${EndIf}
      Sleep 100
      IntOp $R9 $R9 + 1
    ${LoopUntil} $R9 >= 150 ; ~15 s
  ${EndIf}
!macroend
