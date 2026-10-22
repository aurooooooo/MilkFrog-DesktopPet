Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!ifndef APP_VERSION
  !define APP_VERSION "0.4.1"
!endif
!ifndef ROOT
  !define ROOT ".."
!endif
!define APP_KEY "Software\MilkFrogRust"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MilkFrogRust"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define LOGIN_NAME "MilkFrog DesktopPet"

Name "MilkFrog 奶蛙桌宠（Rust）"
OutFile "${ROOT}\dist\MilkFrog-${APP_VERSION}-rust-setup-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\MilkFrog"
InstallDirRegKey HKCU "${APP_KEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetOverwrite on
ShowInstDetails show
ShowUninstDetails show
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "MilkFrog 奶蛙桌宠（Rust）"
VIAddVersionKey /LANG=2052 "FileDescription" "MilkFrog 奶蛙桌宠安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "MilkFrog contributors"

!define MUI_ICON "${ROOT}\assets\icon.ico"
!define MUI_UNICON "${ROOT}\assets\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\MilkFrog.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动奶蛙桌宠"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${ROOT}\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Var PreviousInstallDir

!macro CheckPetClosed PREFIX
Function ${PREFIX}CheckPetClosed
  retry:
  System::Call 'kernel32::OpenMutexW(i 0x100000, i 0, w "Local\MilkFrog.Native.DesktopPet") p.r0'
  ${If} $0 != 0
    System::Call 'kernel32::CloseHandle(p r0)'
    IfSilent cancel
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "请先从系统托盘退出正在运行的 Rust 版奶蛙，再点击重试。" IDRETRY retry
    cancel:
    SetErrorLevel 2
    Abort
  ${EndIf}
FunctionEnd
!macroend
!insertmacro CheckPetClosed ""
!insertmacro CheckPetClosed "un."

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "此安装包需要 64 位 Windows。"
    Abort
  ${EndIf}
  SetRegView 64
  SetShellVarContext current
  ReadRegStr $PreviousInstallDir HKCU "${APP_KEY}" "InstallLocation"
  Call CheckPetClosed
FunctionEnd

Function un.onInit
  SetRegView 64
  SetShellVarContext current
  Call un.CheckPetClosed
FunctionEnd

Section "奶蛙桌宠" Main
  Call CheckPetClosed
  SetOutPath "$INSTDIR"
  ClearErrors
  File /oname=MilkFrog.exe "${ROOT}\dist\MilkFrog-${APP_VERSION}-rust-x64.exe"
  File /oname=ThirdPartyLicenses.txt "${ROOT}\dist\MilkFrog-${APP_VERSION}-licenses.txt"
  File /oname=LICENSE.txt "${ROOT}\LICENSE"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "无法写入所选目录，请选择当前用户可写的安装位置。"
    SetErrorLevel 1
    Abort
  ${EndIf}
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\MilkFrog"
  CreateShortcut "$SMPROGRAMS\MilkFrog\奶蛙桌宠.lnk" "$INSTDIR\MilkFrog.exe"
  CreateShortcut "$SMPROGRAMS\MilkFrog\卸载奶蛙桌宠.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\奶蛙桌宠.lnk" "$INSTDIR\MilkFrog.exe"

  ; Preserve an installed Rust startup item across upgrades / directory changes.
  ; Portable or Electron startup entries are only changed by the app's own toggle.
  ${If} $PreviousInstallDir != ""
    ReadRegStr $0 HKCU "${RUN_KEY}" "${LOGIN_NAME}"
    ${If} $0 == '$\"$PreviousInstallDir\MilkFrog.exe$\"'
      WriteRegStr HKCU "${RUN_KEY}" "${LOGIN_NAME}" '$\"$INSTDIR\MilkFrog.exe$\"'
    ${EndIf}
  ${EndIf}
  WriteRegStr HKCU "${APP_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "MilkFrog 奶蛙桌宠（Rust）"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "MilkFrog contributors"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\MilkFrog.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Call un.CheckPetClosed
  ReadRegStr $0 HKCU "${RUN_KEY}" "${LOGIN_NAME}"
  ${If} $0 == '$\"$INSTDIR\MilkFrog.exe$\"'
    DeleteRegValue HKCU "${RUN_KEY}" "${LOGIN_NAME}"
  ${EndIf}
  Delete "$DESKTOP\奶蛙桌宠.lnk"
  Delete "$SMPROGRAMS\MilkFrog\奶蛙桌宠.lnk"
  Delete "$SMPROGRAMS\MilkFrog\卸载奶蛙桌宠.lnk"
  RMDir "$SMPROGRAMS\MilkFrog"
  Delete "$INSTDIR\MilkFrog.exe"
  Delete "$INSTDIR\ThirdPartyLicenses.txt"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  ReadRegStr $0 HKCU "${APP_KEY}" "InstallLocation"
  ${If} $0 == $INSTDIR
    DeleteRegKey HKCU "${APP_KEY}"
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ${EndIf}
  ; User settings and video cache in APPDATA are deliberately retained.
SectionEnd
