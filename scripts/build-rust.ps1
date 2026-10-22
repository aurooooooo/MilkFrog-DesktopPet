$ErrorActionPreference='Stop'
$petRoot=Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'rust.ps1') build
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$petMatch=Select-String -LiteralPath (Join-Path $petRoot 'rust\Cargo.toml') -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1
$petVersion=$petMatch.Matches[0].Groups[1].Value
$petDist=Join-Path $petRoot 'dist'
New-Item -ItemType Directory -Path $petDist -Force | Out-Null
$petName="MilkFrog-$petVersion-rust-x64.exe"
$petExe=Join-Path $petDist $petName
Copy-Item -LiteralPath (Join-Path $petRoot 'rust\target\release\milkfrog.exe') -Destination $petExe
Copy-Item -LiteralPath (Join-Path $petRoot 'rust\THIRD-PARTY-NOTICES.txt') -Destination (Join-Path $petDist "MilkFrog-$petVersion-licenses.txt")
$petHash=(Get-FileHash -LiteralPath $petExe -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $petDist "SHA256SUMS-$petVersion-rust.txt"),"$petHash  $petName`n",[System.Text.Encoding]::ASCII)
Get-Item -LiteralPath $petExe | Select-Object FullName,Length
