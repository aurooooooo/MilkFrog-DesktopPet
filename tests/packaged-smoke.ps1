$ErrorActionPreference = 'Stop'
$petRoot = Split-Path -Parent $PSScriptRoot
$petTestData = Join-Path $petRoot '.test-runtime\packaged-portable'
New-Item -ItemType Directory -Path $petTestData -Force | Out-Null
'{"settingsVersion":2,"scale":0.65,"muted":true,"accessory":null,"gameMode":false}' | Set-Content -LiteralPath (Join-Path $petTestData 'settings.json') -Encoding utf8
$petVersion = (Get-Content -LiteralPath (Join-Path $petRoot 'package.json') -Raw | ConvertFrom-Json).version
$petLaunch = Start-Process -FilePath (Join-Path $petRoot "dist\MilkFrog-$petVersion-portable-x64.exe") -ArgumentList ('--user-data-dir="' + $petTestData + '"') -WindowStyle Hidden -PassThru
$petOwned = @()
function Read-PetChildren {
    $petAll = @()
    $petParents = @([uint32]$petLaunch.Id)
    for ($petDepth = 0; $petDepth -lt 4 -and $petParents.Count -gt 0; $petDepth++) {
        $petNext = @()
        foreach ($petParent in $petParents) {
            $petChildren = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $petParent")
            $petAll += $petChildren
            $petNext += @($petChildren | ForEach-Object { [uint32]$_.ProcessId })
        }
        $petParents = $petNext
    }
    return $petAll
}
try {
    $petDeadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        Start-Sleep -Seconds 3
        $petOwned = @(Read-PetChildren)
        if ($petLaunch.HasExited) { throw "Portable exited early: $($petLaunch.ExitCode)" }
    } until (($petOwned.Name -contains 'MilkFrog.Input.exe') -or [DateTime]::UtcNow -gt $petDeadline)
    $petOwned | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $petRoot '.test-artifacts\packaged-processes.json')
    if (-not ($petOwned.Name -contains 'MilkFrog.Input.exe')) { throw 'Portable input helper was not started within 45 seconds' }
    $petOwned | Select-Object ProcessId,ParentProcessId,Name
} finally {
    foreach ($petProcess in $petOwned) {
        if ($petProcess.Name -eq 'MilkFrog.DesktopPet.exe') {
            $petWindow = Get-Process -Id $petProcess.ProcessId -ErrorAction SilentlyContinue
            if ($petWindow -and $petWindow.MainWindowHandle -ne 0) { [void]$petWindow.CloseMainWindow() }
        }
    }
}
if (-not $petLaunch.WaitForExit(10000)) { throw 'Portable wrapper did not exit after window closed' }
Start-Sleep -Seconds 1
$petRemaining = @($petOwned | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
if ($petRemaining.Count -gt 0) { throw 'Portable app left child processes behind' }
'Passed: portable EXE starts with its input helper and exits without orphan processes.'
