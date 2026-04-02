# Install HowinLens client as a startup task with auto-restart
$taskName = "HowinLens Client"
$nodeExe = "node.exe"
$scriptPath = "$env:USERPROFILE\.howinlens\client\main.js"

$action = New-ScheduledTaskAction -Execute $nodeExe -Argument $scriptPath
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Seconds 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "HowinLens background client" -Force
Write-Host "HowinLens client installed as startup task with auto-restart"
