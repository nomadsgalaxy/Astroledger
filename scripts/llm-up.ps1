# Spin up the Ollama container on demand and pull the configured model if missing.
$ErrorActionPreference = 'Stop'

$model = $env:LLM_MODEL
if (-not $model) { $model = 'qwen2.5:14b-instruct-q4_K_M' }

Write-Host "Starting Ollama (GPU)…" -ForegroundColor Cyan
docker compose --profile llm up -d ollama | Out-Null

# Wait until the API responds.
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri 'http://localhost:11434/api/tags' -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { break }
    } catch { Start-Sleep -Milliseconds 500 }
}

Write-Host "Checking model: $model" -ForegroundColor Cyan
$tags = (Invoke-RestMethod -Uri 'http://localhost:11434/api/tags').models | ForEach-Object { $_.name }
if ($tags -notcontains $model) {
    Write-Host "Pulling $model (one-time, several GB)…" -ForegroundColor Yellow
    docker exec astroledger-ollama ollama pull $model
} else {
    Write-Host "Model already present." -ForegroundColor Green
}

Write-Host "Ready: http://localhost:11434" -ForegroundColor Green
