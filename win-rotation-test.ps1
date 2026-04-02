# HowinLens Windows Rotation Test

$credsA = '{"claudeAiOauth":{"accessToken":"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","refreshToken":"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","expiresAt":1775169902877,"scopes":["user:file_upload","user:inference","user:mcp_servers","user:profile","user:sessions:claude_code"],"subscriptionType":"team","rateLimitTier":"default_raven"}}'

$credsB = '{"claudeAiOauth":{"accessToken":"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","refreshToken":"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","expiresAt":1775170005345,"scopes":["user:file_upload","user:inference","user:mcp_servers","user:profile","user:sessions:claude_code"],"subscriptionType":"team","rateLimitTier":"default_raven"}}'

$metaA = @{accountUuid='0280ee77-10db-454d-8baa-9e2ffeb32988';emailAddress='ai1@howincloud.com';organizationUuid='be5d7037-dd46-43cb-9207-2192f11a38ac';displayName='HOWIN TEAM AI 1';organizationName='Howincloud';organizationRole='user'}

$metaB = @{accountUuid='7f5c6bf6-d051-4a7b-b6b4-eeb02c65eda8';emailAddress='ai4@howincloud.com';organizationUuid='be5d7037-dd46-43cb-9207-2192f11a38ac';displayName='HOWIN TEAM AI 4';organizationName='Howincloud';organizationRole='user'}

$credFile = "$env:USERPROFILE\.claude\.credentials.json"
$metaFile = "$env:USERPROFILE\.claude.json"

function Write-Creds($creds, $meta) {
    [System.IO.File]::WriteAllText($credFile, $creds)
    $j = Get-Content $metaFile | ConvertFrom-Json
    $j.oauthAccount = $meta
    $j | ConvertTo-Json -Depth 10 | Set-Content $metaFile
}

Write-Host "========================================"
Write-Host "Windows Rotation Test"
Write-Host "========================================"

Write-Host ""
Write-Host "=== STEP 1: Write Account A (ai1@) ==="
Write-Creds $credsA $metaA
Write-Host "auth status:"
claude auth status
Write-Host "API test:"
claude -p "say APPLE"

Write-Host ""
Write-Host "=== STEP 2: Swap to Account B (ai4@) ==="
Write-Creds $credsB $metaB
Write-Host "auth status:"
claude auth status
Write-Host "API test:"
claude -p "say BANANA"

Write-Host ""
Write-Host "=== STEP 3: Swap back to Account A ==="
Write-Creds $credsA $metaA
Write-Host "auth status:"
claude auth status
Write-Host "API test:"
claude -p "say CHERRY"

Write-Host ""
Write-Host "========================================"
Write-Host "DONE"
Write-Host "========================================"
