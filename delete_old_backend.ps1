# Delete old Python backend files
Write-Host "Deleting old backend files..."

if (Test-Path "python-scraper") {
    Remove-Item -Path "python-scraper" -Recurse -Force
    Write-Host "✓ Deleted python-scraper directory"
} else {
    Write-Host "✗ python-scraper not found"
}

if (Test-Path "chrome_sessions") {
    Remove-Item -Path "chrome_sessions" -Recurse -Force
    Write-Host "✓ Deleted chrome_sessions directory"
} else {
    Write-Host "✗ chrome_sessions not found"
}

if (Test-Path "BACKEND_SETUP.md") {
    Remove-Item -Path "BACKEND_SETUP.md" -Force
    Write-Host "✓ Deleted BACKEND_SETUP.md"
} else {
    Write-Host "✗ BACKEND_SETUP.md not found"
}

if (Test-Path "session_data.json") {
    Remove-Item -Path "session_data.json" -Force
    Write-Host "✓ Deleted session_data.json"
} else {
    Write-Host "✗ session_data.json not found"
}

if (Test-Path "session_data_gr8790_7911bd773633b133.json") {
    Remove-Item -Path "session_data_gr8790_7911bd773633b133.json" -Force
    Write-Host "✓ Deleted session_data_gr8790_7911bd773633b133.json"
} else {
    Write-Host "✗ session_data_gr8790_7911bd773633b133.json not found"
}

Write-Host "`nCleanup complete!"

