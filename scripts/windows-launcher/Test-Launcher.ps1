$ErrorActionPreference = 'Stop'

function Assert($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
$tokens = $null; $errors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'launcher.ps1'), [ref]$tokens, [ref]$errors)
Assert ($errors.Count -eq 0) 'PowerShell syntax error'
# Load functions without executing the interactive entry point or touching an install.
foreach ($node in $tree.EndBlock.Statements) {
    if ($node -is [Management.Automation.Language.FunctionDefinitionAst]) {
        . ([scriptblock]::Create($node.Extent.Text))
    }
}
Initialize-ConsoleHost
$temp = Join-Path ([IO.Path]::GetTempPath()) ('artex-launcher-test-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $temp
try {
    $script:configPath = Join-Path $temp 'config.json'
    $config = Read-Configuration
    $config | Add-Member -NotePropertyName custom -NotePropertyValue ([pscustomobject]@{ original = 'unchanged' })
    $config.database.password = 'test-secret-123'
    Save-Configuration $config
    $loaded = Read-Configuration
    Assert ($loaded.database.password -ceq 'test-secret-123') 'Password did not round trip'
    $loaded.database.password = 'replacement-secret'
    Save-Configuration $loaded
    $saved = Read-Configuration
    Assert ($saved.custom.original -ceq 'unchanged') 'Custom configuration changed'
    $backup = [IO.File]::ReadAllText($script:configPath + '.launcher-backup') | ConvertFrom-Json
    Assert ($backup.database.password -ceq 'test-secret-123') 'Backup missing previous configuration'
    Assert ([ArtexLauncher.Screen]::Fit('한글ABC', 6) -ceq '한글AB') 'Korean display width incorrect'
    Assert ([ArtexLauncher.Screen]::Fit('한글', 3) -ceq '한 ') 'Partial wide character displayed'
    $log = Join-Path $temp 'session.log'
    $process = [ArtexLauncher.ServerProcess]::new($log, [string[]]@('test-secret-123'))
    $process.Add('password=test-secret-123 token=hidden-token')
    $process.Add(([char]27 + '[31mtest-secret-123'))
    for ($i = 0; $i -lt 2100; $i++) { $process.Add("line $i") }
    Assert ($process.Snapshot().Count -eq 2000) 'Log buffer is unbounded'
    $process.Dispose()
    $content = [IO.File]::ReadAllText($log)
    Assert (!$content.Contains('test-secret-123')) 'Password leaked into log'
    Assert (!$content.Contains('hidden-token')) 'Token leaked into log'
    Assert (!$content.Contains([char]27)) 'Terminal escape was not removed'
    Assert ($content.Contains('line 0') -and $content.Contains('line 2099')) 'Full log lost history'
    # Verify stdout/stderr draining under load and the restart exit-code protocol.
    $exe = Join-Path $temp 'mock.exe'
    Add-Type -TypeDefinition @'
using System;
public class MockServer {
    public static int Main(string[] args) {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        for (int i = 0; i < 500; i++) {
            Console.WriteLine("stdout " + i);
            Console.Error.WriteLine("stderr " + i);
        }
        return 75;
    }
}
'@ -OutputAssembly $exe -OutputType ConsoleApplication
    $process = [ArtexLauncher.ServerProcess]::new((Join-Path $temp 'process.log'), [string[]]@())
    $process.Start($exe, $temp, $script:configPath, '127.0.0.1:18999')
    $deadline = [DateTime]::Now.AddSeconds(10)
    while ($process.Running -and [DateTime]::Now -lt $deadline) { Start-Sleep -Milliseconds 50 }
    Assert (!$process.Running) 'Child process stalled'
    Assert ($process.ExitCode -eq 75) 'Restart exit code lost'
    $process.Dispose()
    $lines = [IO.File]::ReadAllLines((Join-Path $temp 'process.log'))
    Assert ($lines.Count -eq 1000) 'stdout/stderr were not fully drained'
    Write-Output 'PASS: config preservation, backup, Korean width, secret masking, bounded logs, child process and restart code'
} finally {
    if ($process) { $process.Dispose() }
    $resolved = [IO.Path]::GetFullPath($temp)
    $allowed = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\artex-launcher-test-'
    if (!$resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected test cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
