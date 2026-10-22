$ErrorActionPreference='Stop'
$petRoot=Split-Path $PSScriptRoot -Parent
$petMatch=Select-String -LiteralPath (Join-Path $petRoot 'rust\Cargo.toml') -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1
$petVersion=$petMatch.Matches[0].Groups[1].Value
$petPortable=Join-Path $petRoot "dist\MilkFrog-$petVersion-rust-x64.exe"
if(-not (Test-Path -LiteralPath $petPortable)){
  & (Join-Path $PSScriptRoot 'build-rust.ps1')
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
}
$petCache=Join-Path (Split-Path $petRoot -Parent) '.builder-cache\nsis'
$petNsis=Get-Command makensis.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if(-not $petNsis -and (Test-Path -LiteralPath $petCache)){
  $petNsis=Get-ChildItem -LiteralPath $petCache -Filter makensis.exe -Recurse | Where-Object {$_.Directory.Name -ne 'Bin'} | Select-Object -First 1 -ExpandProperty FullName
}
if(-not $petNsis){throw 'NSIS 3 is required. Install NSIS or add makensis.exe to PATH.'}
& $petNsis '/V3' '/INPUTCHARSET' 'UTF8' "/DAPP_VERSION=$petVersion" "/DROOT=$petRoot" (Join-Path $petRoot 'build\rust-installer.nsi')
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$petNames=@("MilkFrog-$petVersion-rust-x64.exe","MilkFrog-$petVersion-rust-setup-x64.exe")
$petLines=foreach($petName in $petNames){
  $petFile=Join-Path $petRoot "dist\$petName"
  $petHash=(Get-FileHash -LiteralPath $petFile -Algorithm SHA256).Hash.ToLowerInvariant()
  "$petHash  $petName"
}
[System.IO.File]::WriteAllText((Join-Path $petRoot "dist\SHA256SUMS-$petVersion-rust.txt"),($petLines -join "`n")+"`n",[System.Text.Encoding]::ASCII)
Get-Item -LiteralPath (Join-Path $petRoot "dist\MilkFrog-$petVersion-rust-setup-x64.exe") | Select-Object FullName,Length
