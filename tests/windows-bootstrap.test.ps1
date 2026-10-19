$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts/windows-hardware.ps1')

function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -ne $Expected) { throw "$Message : expected $Expected, got $Actual" }
}
$gtx1070 = [pscustomobject]@{ name = 'GeForce GTX 1070'; compute_cap = '6.1'; driver_version = '581.80'; memory = '8192' }
$plan = Get-BootstrapPlan -LogicalProcessors 4 -PhysicalCores 2 -MemoryGiB 8 -Gpus @($gtx1070)
Assert-Equal $plan.backend 'cu126' 'GTX 1070 uses Pascal-compatible PyTorch'
Assert-Equal $plan.device 'cuda' 'GPU acceleration enabled'
Assert-Equal $plan.threads 1 'Leave CPU capacity for the desktop'

$gtx1070.driver_version = '550.00'
$plan = Get-BootstrapPlan -LogicalProcessors 4 -PhysicalCores 2 -MemoryGiB 4 -Gpus @($gtx1070)
Assert-Equal $plan.device 'cpu' 'Old NVIDIA driver falls back to CPU'
Assert-Equal $plan.hash 64 'Small RAM uses a smaller Stockfish cache'

$gtx1070.driver_version = '581.80'
$plan = Get-BootstrapPlan -LogicalProcessors 12 -PhysicalCores 6 -MemoryGiB 32 -Gpus @($gtx1070) -CpuOnly
Assert-Equal $plan.backend 'cpu' 'CPU override wins over hardware detection'

$unknown = [pscustomobject]@{ name = 'Unknown'; compute_cap = 'N/A'; driver_version = 'N/A'; memory = 'N/A' }
$plan = Get-BootstrapPlan -LogicalProcessors 1 -PhysicalCores 1 -MemoryGiB 4 -Gpus @($unknown)
Assert-Equal $plan.device 'cpu' 'Unparseable GPU metadata stays safe'
Assert-Equal $plan.threads 1 'Single-core machines retain at least one engine thread'

$newGpu = [pscustomobject]@{ name = 'Future GPU'; compute_cap = '12.0'; driver_version = '600.00'; memory = '16384' }
$plan = Get-BootstrapPlan -LogicalProcessors 64 -PhysicalCores 32 -MemoryGiB 64 -Gpus @($newGpu)
Assert-Equal $plan.backend 'cpu' 'Do not install an incompatible legacy CUDA wheel on a newer GPU'
Assert-Equal $plan.threads 4 'Cap CPU engine load'

$plan = Get-BootstrapPlan -LogicalProcessors 8 -PhysicalCores 4 -MemoryGiB 16
Assert-Equal $plan.device 'cpu' 'No NVIDIA GPU uses CPU'
Assert-Equal $plan.threads 2 'Use half the physical cores'

$repo = Split-Path $PSScriptRoot -Parent
foreach ($file in @('prepare-windows-bootstrap.ps1', 'windows-bootstrap-setup.ps1', 'windows-hardware.ps1')) {
    $parseErrors = $null
    [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $repo "scripts/$file"), [ref]$null, [ref]$parseErrors)
    if ($parseErrors) { throw ($parseErrors | Out-String) }
}
Write-Host 'Windows bootstrap hardware selection and PowerShell syntax checks passed.'
