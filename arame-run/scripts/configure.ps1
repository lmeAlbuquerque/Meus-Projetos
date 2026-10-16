$ErrorActionPreference = "Stop"

$url = Read-Host "Supabase project URL (https://....supabase.co)"
$key = Read-Host "Supabase anon/publishable key (nao use service_role)"
if ($url -notmatch '^https://[A-Za-z0-9-]+\.supabase\.co/?$') {
  throw "URL invalida. Use a URL HTTPS do seu projeto Supabase."
}
if ([string]::IsNullOrWhiteSpace($key) -or $key -match 'service_role|sb_secret') {
  throw "Informe somente a chave publica anon/publishable."
}
$projectRoot = Split-Path $PSScriptRoot -Parent
$envPath = Join-Path $projectRoot ".env"
$examplePath = Join-Path $projectRoot ".env.example"
if (Test-Path $envPath) {
  $lines = @(Get-Content $envPath)
} else {
  $lines = @(Get-Content $examplePath)
}

$values = @{
  SUPABASE_URL = $url.TrimEnd("/")
  SUPABASE_ANON_KEY = $key
}
foreach ($name in $values.Keys) {
  $pattern = "^\s*$name\s*=.*$"
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) {
      $lines[$i] = "$name=$($values[$name])"
      $found = $true
    }
  }
  if (-not $found) { $lines += "$name=$($values[$name])" }
}

$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($envPath, [string[]]$lines, $utf8WithoutBom)
Write-Host "Configuracao salva em .env. O servidor local expoe somente URL e chave publica."
Write-Host "Reinicie npm run dev para carregar a configuracao."
