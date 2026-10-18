# Windows-only WMI deletion smoke test for a file that must be removed after a launcher exits.
$ErrorActionPreference = "Stop"
$directory = Join-Path $env:RUNNER_TEMP ("engines-wmi-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $directory | Out-Null
$target = Join-Path $directory "parked.exe"
Set-Content -LiteralPath $target -Value "test" -NoNewline
$target64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($target))
$script = "`$file=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$target64'));for(`$i=0;`$i -lt 40;`$i++){Remove-Item -LiteralPath `$file -Force -ErrorAction SilentlyContinue;if(-not(Test-Path -LiteralPath `$file)){exit 0};Start-Sleep -Milliseconds 250};exit 1"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
$powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$commandLine = '"{0}" -NoProfile -ExecutionPolicy Bypass -NonInteractive -EncodedCommand {1}' -f $powershell, $encoded
$created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine }
if ($created.ReturnValue -ne 0) { throw "WMI failed to start the deferred-removal process: $($created.ReturnValue)" }
for ($attempt = 0; $attempt -lt 40; $attempt++) {
  if (-not (Test-Path -LiteralPath $target)) { break }
  Start-Sleep -Milliseconds 250
}
if (Test-Path -LiteralPath $target) { throw "WMI did not remove the parked file: $target" }
Remove-Item -LiteralPath $directory -Force -ErrorAction SilentlyContinue
