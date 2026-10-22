param([ValidateSet('check','test','build','clippy','fmt')][string]$Action='build')
$ErrorActionPreference='Stop'
$petRoot=Split-Path $PSScriptRoot -Parent
$petLocalTools=Join-Path (Split-Path $petRoot -Parent) '.native-toolchain'
if(Test-Path -LiteralPath $petLocalTools){
  $petLink=Get-ChildItem -LiteralPath $petLocalTools -Filter link.exe -Recurse | Select-Object -First 1
  $petCrt=Get-ChildItem -LiteralPath $petLocalTools -Filter libcmt.lib -Recurse | Where-Object {$_.Directory.Name -eq 'x64'} | Select-Object -First 1
  if($petLink -and $petCrt){
    $env:PATH=$petLink.Directory.FullName+';'+$env:PATH
    $petSdkRoot=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Lib'
    $petSdk=Get-ChildItem -LiteralPath $petSdkRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
    $env:LIB=$petCrt.Directory.FullName+';'+(Join-Path $petSdk.FullName 'ucrt\x64')+';'+(Join-Path $petSdk.FullName 'um\x64')+';'+$env:LIB
  }
}
$env:RUSTFLAGS='-C target-feature=+crt-static'
if($Action -eq 'fmt'){cargo fmt --manifest-path (Join-Path $petRoot 'rust\Cargo.toml')}
elseif($Action -eq 'clippy'){cargo clippy --offline --manifest-path (Join-Path $petRoot 'rust\Cargo.toml') --all-targets -- -D warnings}
else{cargo $Action --offline --release --manifest-path (Join-Path $petRoot 'rust\Cargo.toml')}
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
