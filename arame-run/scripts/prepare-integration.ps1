$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
$envPath = Join-Path $projectRoot ".env"
if (-not (Test-Path $envPath)) {
  throw "Crie .env local copiando .env.example e preenchendo SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY."
}

$values = @{}
foreach ($line in Get-Content $envPath) {
  if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') {
    $values[$matches[1]] = $matches[2].Trim().Trim('"')
  }
}

$baseUrl = $values["SUPABASE_URL"]
$anonKey = $values["SUPABASE_ANON_KEY"]
$serviceKey = $values["SUPABASE_SERVICE_ROLE_KEY"]
if ([string]::IsNullOrWhiteSpace($baseUrl) -or
    [string]::IsNullOrWhiteSpace($anonKey) -or
    [string]::IsNullOrWhiteSpace($serviceKey)) {
  throw "SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios no .env local."
}
try {
  $uri = [Uri]$baseUrl
} catch {
  throw "SUPABASE_URL no .env nao e uma URL valida."
}
if ($uri.Scheme -ne "http" -or $uri.Host -notin @("127.0.0.1", "localhost")) {
  throw "Por seguranca, este script aceita somente Supabase local em localhost/127.0.0.1."
}

function Invoke-ApiJson {
  param(
    [string]$Url,
    [string]$ApiKey,
    [string]$Bearer,
    [string]$Method = "GET",
    [object]$Body = $null,
    [string]$Prefer = ""
  )
  $headers = @{
    apikey = $ApiKey
    Authorization = "Bearer $Bearer"
  }
  if ($Prefer) { $headers["Prefer"] = $Prefer }
  $parameters = @{
    Uri = $Url
    Method = $Method
    Headers = $headers
    TimeoutSec = 20
  }
  if ($null -ne $Body) {
    $parameters["ContentType"] = "application/json"
    $parameters["Body"] = ConvertTo-Json -InputObject $Body -Depth 8 -Compress
  }
  return Invoke-RestMethod @parameters
}

$testAccounts = @(
  @{ email = "arame-run-primary-test@example.invalid"; role = "primary" },
  @{ email = "arame-run-secondary-test@example.invalid"; role = "read_only" }
)
$tokens = @{}
$users = @()

try {
  $directory = Invoke-ApiJson -Url "$baseUrl/auth/v1/admin/users?page=1&per_page=1000" `
    -ApiKey $serviceKey -Bearer $serviceKey
  foreach ($account in $testAccounts) {
    $user = $directory.users | Where-Object { $_.email -eq $account.email } | Select-Object -First 1
    $password = ([Guid]::NewGuid().ToString("N") + "Aa1!")
    if ($null -eq $user) {
      $user = Invoke-ApiJson -Url "$baseUrl/auth/v1/admin/users" `
        -ApiKey $serviceKey -Bearer $serviceKey -Method "POST" `
        -Body @{ email = $account.email; password = $password; email_confirm = $true }
    } else {
      $user = Invoke-ApiJson -Url "$baseUrl/auth/v1/admin/users/$($user.id)" `
        -ApiKey $serviceKey -Bearer $serviceKey -Method "PUT" `
        -Body @{ password = $password; email_confirm = $true }
    }
    if (-not $user.id) { throw "Auth nao retornou o identificador da conta ficticia." }
    $users += @{ id = $user.id; email = $account.email; role = $account.role }
    $login = Invoke-ApiJson -Url "$baseUrl/auth/v1/token?grant_type=password" `
      -ApiKey $anonKey -Bearer $anonKey -Method "POST" `
      -Body @{ email = $account.email; password = $password }
    if (-not $login.access_token) { throw "Auth nao retornou uma sessao de teste." }
    $tokens[$account.role] = $login.access_token
  }

  foreach ($user in $users) {
    $profile = @{
      user_id = $user.id
      email = $user.email
      role = $user.role
      is_active = $true
      created_by = $null
    }
    Invoke-ApiJson -Url "$baseUrl/rest/v1/admin_profiles?on_conflict=user_id" `
      -ApiKey $serviceKey -Bearer $serviceKey -Method "POST" -Body $profile `
      -Prefer "resolution=merge-duplicates,return=minimal" | Out-Null
  }
} catch {
  throw "Nao foi possivel preparar usuarios ficticios no Supabase local. Confira se migrations, Auth e funcoes estao ativos; nenhum endpoint externo foi chamado."
}

if ([string]::IsNullOrWhiteSpace($values["RATE_LIMIT_SECRET"])) {
  $bytes = New-Object byte[] 32
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $random.GetBytes($bytes)
  $random.Dispose()
  $values["RATE_LIMIT_SECRET"] = [Convert]::ToBase64String($bytes)
}
$values["ARAME_RUN_TEST_MODE"] = "local"
$values["ARAME_RUN_TEST_PRIMARY_TOKEN"] = $tokens["primary"]
$values["ARAME_RUN_TEST_SECONDARY_TOKEN"] = $tokens["read_only"]
$values["ARAME_RUN_TEST_EDITION_ID"] = "26000000-0000-4000-8000-000000000026"

$lines = foreach ($key in ($values.Keys | Sort-Object)) { "$key=$($values[$key])" }
Set-Content -Path $envPath -Value $lines -Encoding UTF8
Write-Host "Contas ficticias locais preparadas. Tokens salvos somente em .env (ignorado pelo Git)."
Write-Host "Execute npm run test:integration antes de expirar a sessao (aproximadamente 1 hora)."
