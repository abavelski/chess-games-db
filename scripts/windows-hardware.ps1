function Get-BootstrapPlan {
    param([int]$LogicalProcessors, [int]$PhysicalCores, [double]$MemoryGiB, [object[]]$Gpus = @(), [switch]$CpuOnly)
    $threads = [Math]::Max(1, [Math]::Min(4, [Math]::Min($LogicalProcessors - 1, [Math]::Floor($PhysicalCores / 2))))
    $plan = [ordered]@{
        device = 'cpu'; backend = 'cpu'; threads = [int]$threads
        hash = $(if ($MemoryGiB -lt 8) { 64 } else { 128 })
        reason = 'CPU mode: no verified compatible NVIDIA GPU/driver.'
    }
    if ($CpuOnly) { $plan.reason = 'CPU mode requested.'; return [pscustomobject]$plan }
    # PyTorch uses GPU 0. Unknown cards/drivers deliberately stay on CPU.
    if ($Gpus.Count -gt 0) {
        $gpu = $Gpus[0]
        try {
            $capability = [double]::Parse([string]$gpu.compute_cap, [Globalization.CultureInfo]::InvariantCulture)
            $driver = [version]([string]$gpu.driver_version).Trim()
            $vram = [double]::Parse([string]$gpu.memory, [Globalization.CultureInfo]::InvariantCulture)
            # PyTorch 2.11 cu126 supports Maxwell through Hopper, including GTX 1070.
            # Use the conservative CUDA 12.6 GA Windows driver minimum.
            if ($capability -ge 5 -and $capability -lt 10 -and $driver -ge [version]'560.76' -and $vram -ge 2048) {
                $plan.device = 'cuda'; $plan.backend = 'cu126'
                $plan.reason = "CUDA 12.6 selected for $(([string]$gpu.name).Trim()); inference will be tested before enabling it."
            }
        } catch { $plan.reason = 'GPU details could not be verified; using CPU.' }
    }
    return [pscustomobject]$plan
}

function Get-BootstrapHardware {
    $cpu = @(Get-CimInstance Win32_Processor)
    $computer = Get-CimInstance Win32_ComputerSystem
    $gpus = @()
    $smi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    $smiPath = if ($smi) { $smi.Source } else { Join-Path $env:windir 'System32/nvidia-smi.exe' }
    if (Test-Path -LiteralPath $smiPath) {
        try {
            $rows = @(& $smiPath '--query-gpu=name,compute_cap,driver_version,memory.total' '--format=csv,noheader,nounits' 2>$null)
            if ($LASTEXITCODE -eq 0 -and $rows.Count -gt 0) {
                $gpus = @($rows | ConvertFrom-Csv -Header name,compute_cap,driver_version,memory)
            }
        } catch { $gpus = @() }
    }
    [pscustomobject]@{
        cpu = ($cpu.Name -join ', ')
        logicalProcessors = [int](($cpu | Measure-Object NumberOfLogicalProcessors -Sum).Sum)
        physicalCores = [int](($cpu | Measure-Object NumberOfCores -Sum).Sum)
        memoryGiB = [Math]::Round($computer.TotalPhysicalMemory / 1GB, 1)
        gpus = $gpus
        displayAdapters = @((Get-CimInstance Win32_VideoController).Name)
    }
}
