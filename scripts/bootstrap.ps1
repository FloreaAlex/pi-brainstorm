# Requires -RunAsAdministrator if execution policy is restricted, though we try to just run.

Write-Host "Bootstrap pi-brainstorm"
Write-Host "======================="

# Verify git
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ git is not installed. Please install git first." -ForegroundColor Red
    exit 1
}
Write-Host "✓ git is installed" -ForegroundColor Green

# Verify node and npm
if (!(Get-Command node -ErrorAction SilentlyContinue) -or !(Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "❌ node or npm is not installed." -ForegroundColor Red
    Write-Host "  Please install Node.js."
    exit 1
}
Write-Host "✓ node and npm are installed" -ForegroundColor Green

Write-Host ""
Write-Host "Running npm install..."
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ npm install failed." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Starting wizard..."
npm run wizard

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ npm run wizard failed." -ForegroundColor Red
    exit $LASTEXITCODE
}
