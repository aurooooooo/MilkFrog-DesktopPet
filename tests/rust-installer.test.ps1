$ErrorActionPreference='Stop'
$petRoot=Split-Path $PSScriptRoot -Parent
$petInstallDir=[System.IO.Path]::GetFullPath((Join-Path $petRoot '.test-artifacts\rust-installer'))
$petTestRoot=[System.IO.Path]::GetFullPath((Join-Path $petRoot '.test-artifacts'))+[System.IO.Path]::DirectorySeparatorChar
if(-not $petInstallDir.StartsWith($petTestRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Installer test path must stay inside workspace artifacts'}
$petAppKey='HKCU:\Software\MilkFrogRust'
$petUninstallKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MilkFrogRust'
$petDesktopLink=Join-Path ([Environment]::GetFolderPath('Desktop')) '奶蛙桌宠.lnk'
$petMenuDir=Join-Path ([Environment]::GetFolderPath('Programs')) 'MilkFrog'
foreach($petPath in @($petAppKey,$petUninstallKey,$petInstallDir,$petDesktopLink,$petMenuDir)){
  if(Test-Path -LiteralPath $petPath){throw "Refusing to overwrite existing installation or shortcut: $petPath"}
}
$petRunKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$petRunBefore=(Get-ItemProperty -LiteralPath $petRunKey -Name 'MilkFrog DesktopPet' -ErrorAction SilentlyContinue).'MilkFrog DesktopPet'
$petSettings=Join-Path $env:APPDATA 'MilkFrogRust\settings.json'
$petSettingsBefore=if(Test-Path -LiteralPath $petSettings){(Get-FileHash -LiteralPath $petSettings).Hash}else{$null}
$petInstalled=$false
try{
  $petSetup=Join-Path $petRoot 'dist\MilkFrog-0.4.0-rust-setup-x64.exe'
  $petInstall=Start-Process -FilePath $petSetup -ArgumentList '/S',"/D=$petInstallDir" -WindowStyle Hidden -PassThru -Wait
  if($petInstall.ExitCode -ne 0){throw "Installer exited with $($petInstall.ExitCode)"}
  $petInstalled=$true
  $petExe=Join-Path $petInstallDir 'MilkFrog.exe'
  $petOriginal=Join-Path $petRoot 'dist\MilkFrog-0.4.0-rust-x64.exe'
  if((Get-FileHash -LiteralPath $petExe).Hash -ne (Get-FileHash -LiteralPath $petOriginal).Hash){throw 'Installed executable differs from validated Rust binary'}
  foreach($petPath in @($petDesktopLink,(Join-Path $petMenuDir '奶蛙桌宠.lnk'),(Join-Path $petMenuDir '卸载奶蛙桌宠.lnk'),(Join-Path $petInstallDir 'ThirdPartyLicenses.txt'),(Join-Path $petInstallDir 'Uninstall.exe'))){
    if(-not(Test-Path -LiteralPath $petPath)){throw "Missing installed file: $petPath"}
  }
  $petShell=New-Object -ComObject WScript.Shell
  if($petShell.CreateShortcut($petDesktopLink).TargetPath -ne $petExe){throw 'Desktop shortcut has wrong target'}
  if((Get-ItemProperty -LiteralPath $petUninstallKey).InstallLocation -ne $petInstallDir){throw 'Windows uninstall registration has wrong directory'}
  $petRunAfter=(Get-ItemProperty -LiteralPath $petRunKey -Name 'MilkFrog DesktopPet' -ErrorAction SilentlyContinue).'MilkFrog DesktopPet'
  if($petRunBefore -ne $petRunAfter){throw 'Installer unexpectedly changed startup settings'}
}finally{
  $petUninstaller=Join-Path $petInstallDir 'Uninstall.exe'
  if(Test-Path -LiteralPath $petUninstaller){
    $petUninstall=Start-Process -FilePath $petUninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
    if($petUninstall.ExitCode -ne 0){throw "Uninstaller exited with $($petUninstall.ExitCode)"}
    $petDeadline=[DateTime]::UtcNow.AddSeconds(15)
    while(((Test-Path -LiteralPath $petInstallDir) -or (Test-Path -LiteralPath $petUninstallKey)) -and [DateTime]::UtcNow -lt $petDeadline){Start-Sleep -Milliseconds 100}
  }
}
if(-not $petInstalled){throw 'Installation did not complete'}
foreach($petPath in @($petAppKey,$petUninstallKey,$petInstallDir,$petDesktopLink,$petMenuDir)){
  if(Test-Path -LiteralPath $petPath){throw "Uninstaller left a registered file or directory: $petPath"}
}
$petRunAfter=(Get-ItemProperty -LiteralPath $petRunKey -Name 'MilkFrog DesktopPet' -ErrorAction SilentlyContinue).'MilkFrog DesktopPet'
if($petRunBefore -ne $petRunAfter){throw 'Uninstall changed an unrelated startup value'}
$petSettingsAfter=if(Test-Path -LiteralPath $petSettings){(Get-FileHash -LiteralPath $petSettings).Hash}else{$null}
if($petSettingsBefore -ne $petSettingsAfter){throw 'Install/uninstall changed user settings'}
$petResult=@{passed=$true;installedBinaryMatches=$true;desktopAndStartMenuShortcuts=$true;uninstallRegistration=$true;uninstallCleanup=$true;startupUnchanged=$true;settingsUnchanged=$true}
$petResult | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $petRoot '.test-artifacts\rust-installer-result.json') -Encoding utf8
$petResult | ConvertTo-Json
