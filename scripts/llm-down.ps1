$ErrorActionPreference = 'Stop'
Write-Host "Stopping Ollama container (frees VRAM)…" -ForegroundColor Cyan
docker compose --profile llm stop ollama | Out-Null
Write-Host "Stopped." -ForegroundColor Green
