# Wave 0 verify (Windows). Run from repo root after `npm install`.
Write-Host "Project Starfish - Wave 0 verify" -ForegroundColor Cyan
node scripts/verify/wave0.mjs
exit $LASTEXITCODE
