[CmdletBinding()]
param(
    [string]$InstallDir,
    [ValidateRange(1024, 65535)][int]$Port = 8787,
    [switch]$Help,
    [switch]$Check,
    [switch]$Preview
)
$ErrorActionPreference = 'Stop'
if ($Help) {
    Write-Output 'ARTEX-KR 실행 도우미'
    Write-Output 'launcher.bat [-InstallDir 폴더] [-Port 8787] [-Check] [-Preview]'
    Write-Output '  -Check    설치 파일과 설정 형식 확인 (서버 실행·설정 변경 없음)'
    Write-Output '  -Preview  예시 데이터로 실행 화면 보기 (서버 실행·설정 변경 없음)'
    exit 0
}

function Initialize-ConsoleHost {
    Add-Type -TypeDefinition @'
// Windows PowerShell 5.1 compatible; no downloaded runtime or packages required.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace ArtexLauncher {
    public sealed class Row {
        public string Text;
        public ConsoleColor Color;
        public Row(string text, ConsoleColor color) { Text = text; Color = color; }
    }

    public static class Screen {
        static string[] previous = new string[0];
        static int oldWidth, oldHeight;
        public static int Width { get { return Math.Max(1, Console.WindowWidth - 1); } }
        public static int Height { get { return Math.Max(1, Console.WindowHeight - 1); } }
        public static string Fit(string text, int width) {
            var result = new StringBuilder();
            int used = 0;
            var elements = StringInfo.GetTextElementEnumerator(text ?? "");
            while (elements.MoveNext()) {
                string element = elements.GetTextElement();
                int c = char.ConvertToUtf32(element, 0);
                if (c < 32 || (c >= 127 && c < 160)) continue;
                int cells = (c >= 0x1100 && (c <= 0x115f || c == 0x2329 || c == 0x232a ||
                    (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
                    (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe10 && c <= 0xfe6f) ||
                    (c >= 0xff01 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || c >= 0x1f300)) ? 2 : 1;
                if (used + cells > width) break;
                result.Append(element); used += cells;
            }
            return result.ToString() + new string(' ', Math.Max(0, width - used));
        }
        public static void Draw(Row[] rows) {
            try {
                int w = Width, h = Height;
                if (oldWidth != w || oldHeight != h) {
                    Console.Clear(); previous = new string[h]; oldWidth = w; oldHeight = h;
                }
                Console.CursorVisible = false;
                for (int y = 0; y < h; y++) {
                    Row row = y < rows.Length ? rows[y] : new Row("", ConsoleColor.Gray);
                    string text = Fit(row.Text, w);
                    string key = ((int)row.Color).ToString() + text;
                    if (previous[y] == key) continue;
                    Console.SetCursorPosition(0, y);
                    Console.ForegroundColor = row.Color;
                    Console.Write(text); previous[y] = key;
                }
            } catch (ArgumentOutOfRangeException) { oldWidth = 0; }
        }
        public static void Reset() { previous = new string[0]; oldWidth = 0; }
    }

    public sealed class ServerProcess : IDisposable {
        readonly object gate = new object();
        readonly List<string> lines = new List<string>();
        readonly string[] secrets;
        StreamWriter writer;
        IntPtr process;
        int processId;
        Task outputTask, errorTask;
        AnonymousPipeServerStream outputPipe, errorPipe;
        public string LogPath { get; private set; }
        public string LogError { get; private set; }
        public bool Running { get { return process != IntPtr.Zero && WaitForSingleObject(process, 0) == 258; } }
        public int ExitCode { get { uint code; return process != IntPtr.Zero && GetExitCodeProcess(process, out code) ? (int)code : -1; } }
        public int Id { get { return processId; } }
        public ServerProcess(string logPath, string[] sensitive) {
            LogPath = logPath; secrets = sensitive ?? new string[0];
            writer = new StreamWriter(logPath, true, new UTF8Encoding(false)); writer.AutoFlush = true;
        }
        public void Add(string value) {
            if (String.IsNullOrWhiteSpace(value)) return;
            value = Regex.Replace(value, @"\x1B\[[0-?]*[ -/]*[@-~]", "");
            value = Regex.Replace(value, @"[\x00-\x08\x0B-\x1F\x7F]", "");
            foreach (string secret in secrets) if (!String.IsNullOrEmpty(secret)) value = value.Replace(secret, "[숨김]");
            value = Regex.Replace(value, @"(?i)(password|token|authorization)(\s*[=:]\s*)\S+", "$1$2[숨김]");
            lock (gate) {
                lines.Add(value);
                if (lines.Count > 2000) lines.RemoveRange(0, lines.Count - 2000);
                try { if (writer != null) writer.WriteLine(value); }
                catch (IOException) { LogError = "로그 파일을 저장할 수 없습니다. 디스크 공간을 확인하세요."; }
            }
        }
        public string[] Snapshot() { lock (gate) { return lines.ToArray(); } }
        Task Drain(AnonymousPipeServerStream pipe) {
            return Task.Run(delegate {
                try {
                    using (pipe) using (var reader = new StreamReader(pipe, Encoding.UTF8)) {
                        string line;
                        while ((line = reader.ReadLine()) != null) Add(line);
                    }
                } catch (IOException) { } catch (ObjectDisposedException) { }
            });
        }
        void Finish() {
            if (process == IntPtr.Zero) return;
            if (outputTask != null && !outputTask.Wait(2000)) outputPipe.Dispose();
            if (errorTask != null && !errorTask.Wait(2000)) errorPipe.Dispose();
            CloseHandle(process); process = IntPtr.Zero;
        }
        public void Start(string binary, string directory, string config, string address) {
            if (Running) throw new InvalidOperationException("Server is already running");
            Finish();
            var stdout = new AnonymousPipeServerStream(PipeDirection.In, HandleInheritability.Inheritable);
            var stderr = new AnonymousPipeServerStream(PipeDirection.In, HandleInheritability.Inheritable);
            outputPipe = stdout; errorPipe = stderr;
            using (var stdin = new AnonymousPipeServerStream(PipeDirection.Out, HandleInheritability.Inheritable)) {
                var start = new StartupInfo(); start.Size = Marshal.SizeOf(typeof(StartupInfo));
                start.Flags = 0x100; // STARTF_USESTDHANDLES
                start.Input = stdin.ClientSafePipeHandle.DangerousGetHandle();
                start.Output = stdout.ClientSafePipeHandle.DangerousGetHandle();
                start.Error = stderr.ClientSafePipeHandle.DangerousGetHandle();
                var environment = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
                    environment[(string)entry.Key] = (string)entry.Value;
                environment["ARTEX_CONFIG"] = config; environment.Remove("ARTEX_PG_DSN");
                var block = new StringBuilder();
                foreach (var pair in environment) block.Append(pair.Key).Append('=').Append(pair.Value).Append('\0');
                block.Append('\0');
                IntPtr env = Marshal.StringToHGlobalUni(block.ToString());
                try {
                    ProcessInfo info;
                    // A distinct console process group lets Ctrl+Break reach only this server.
                    if (!CreateProcess(binary, new StringBuilder("\"" + binary + "\" -addr " + address),
                        IntPtr.Zero, IntPtr.Zero, true, 0x600, env, directory, ref start, out info))
                        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                    process = info.Process; processId = (int)info.ProcessId; CloseHandle(info.Thread);
                    stdout.DisposeLocalCopyOfClientHandle(); stderr.DisposeLocalCopyOfClientHandle();
                    stdin.DisposeLocalCopyOfClientHandle();
                    outputTask = Drain(stdout); errorTask = Drain(stderr);
                } catch { stdout.Dispose(); stderr.Dispose(); throw; }
                finally { Marshal.FreeHGlobal(env); }
            }
        }
        public void Stop() {
            if (!Running) return;
            GenerateConsoleCtrlEvent(1, (uint)processId);
            if (WaitForSingleObject(process, 8000) == 258) {
                Add("[launcher] 종료 대기 시간이 지나 서버를 강제로 종료합니다.");
                TerminateProcess(process, 1); WaitForSingleObject(process, 5000);
            }
        }
        public void Dispose() {
            Stop();
            Finish();
            lock (gate) { if (writer != null) { writer.Dispose(); writer = null; } }
        }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct StartupInfo {
            public int Size; public string Reserved, Desktop, Title;
            public uint X, Y, Width, Height, Columns, Rows, Fill, Flags;
            public short Show, ReservedSize; public IntPtr ReservedBytes, Input, Output, Error;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct ProcessInfo { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CreateProcess(string app, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
            bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo info);
        [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
        [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr handle, uint code);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GenerateConsoleCtrlEvent(uint type, uint group);
    }

    public static class Control {
        delegate bool Handler(uint type);
        static Handler handler = delegate(uint type) { return type == 0; };
        [DllImport("kernel32.dll")] static extern bool SetConsoleCtrlHandler(Handler handler, bool add);
        public static void Install() { SetConsoleCtrlHandler(handler, true); }
        public static void Remove() { SetConsoleCtrlHandler(handler, false); }
    }
}

'@
}

function Find-Installation {
    if ($InstallDir) { return (Resolve-Path -LiteralPath $InstallDir).Path }
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'artex.exe')) { return $PSScriptRoot }
    throw 'artex.exe가 있는 폴더에 도우미 파일을 넣거나 -InstallDir로 설치 폴더를 지정하세요.'
}

function Read-Configuration {
    if (Test-Path -LiteralPath $script:configPath) {
        $value = [IO.File]::ReadAllText($script:configPath) | ConvertFrom-Json
        if (!$value -or !$value.database) { throw 'config.json에 database 설정이 없습니다.' }
        return $value
    }
    return [pscustomobject]@{ database = [pscustomobject]@{
        host = '127.0.0.1'; port = 5432; user = 'postgres'; password = ''; dbname = 'artex'; sslmode = 'disable'
    }; skill_dir = '' }
}

function Save-Configuration($Value) {
    $temporary = $script:configPath + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 50), [Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $script:configPath) {
            [IO.File]::Replace($temporary, $script:configPath, $script:configPath + '.launcher-backup')
        } else { [IO.File]::Move($temporary, $script:configPath) }
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
}

function New-Page([string]$Title, [string]$Subtitle) {
    $script:rows = [Collections.Generic.List[ArtexLauncher.Row]]::new()
    Add-Row '  A R T E X  /  KR' Cyan
    Add-Row '  LOCAL CONSOLE' DarkGray
    Add-Row ('  ' + ('─' * [Math]::Max(1, [ArtexLauncher.Screen]::Width - 4))) DarkCyan
    Add-Row ('  ' + $Title) White
    Add-Row ('  ' + $Subtitle) DarkGray
    Add-Row ''
}
function Add-Row([string]$Text = '', [ConsoleColor]$Color = 'Gray') {
    $script:rows.Add([ArtexLauncher.Row]::new($Text, $Color))
}
function Show-Page([string]$Footer = '↑ ↓ 선택   Enter 확인   Esc 돌아가기') {
    $height = [ArtexLauncher.Screen]::Height
    if ($script:rows.Count -gt $height - 2) { $script:rows.RemoveRange([Math]::Max(0, $height - 2), $script:rows.Count - [Math]::Max(0, $height - 2)) }
    while ($script:rows.Count -lt $height - 2) { Add-Row '' }
    Add-Row ('  ' + ('─' * [Math]::Max(1, [ArtexLauncher.Screen]::Width - 4))) DarkCyan
    Add-Row ('  ' + $Footer) DarkGray
    [ArtexLauncher.Screen]::Draw($script:rows.ToArray())
}
function Read-Key { return [Console]::ReadKey($true) }
function Select-Action([string]$Title, [string]$Subtitle, [string[]]$Options, [string[]]$Details = @()) {
    $selected = 0
    while ($true) {
        New-Page $Title $Subtitle
        foreach ($detail in $Details) { Add-Row ('  ' + $detail) }
        Add-Row ''
        for ($i = 0; $i -lt $Options.Count; $i++) {
            if ($i -eq $selected) { Add-Row ('  > ' + $Options[$i]) Cyan }
            else { Add-Row ('    ' + $Options[$i]) Gray }
        }
        Show-Page
        $key = Read-Key
        switch ($key.Key) {
            UpArrow { $selected = ($selected + $Options.Count - 1) % $Options.Count }
            DownArrow { $selected = ($selected + 1) % $Options.Count }
            Enter { return $selected }
            Escape { return -1 }
        }
        if ([int]$key.KeyChar -eq 3) { return -1 }
    }
}
function Read-Field([string]$Title, [string]$Subtitle, [string]$Label, [string[]]$Details = @(), [switch]$Secret, [int]$Min = 0, [switch]$AllowEmpty) {
    $value = ''; $errorText = ''
    while ($true) {
        New-Page $Title $Subtitle
        foreach ($detail in $Details) { Add-Row ('  ' + $detail) }
        Add-Row ''
        Add-Row ('  ' + $Label) White
        $shown = if ($Secret) { '*' * [Math]::Min(50, $value.Length) } else { $value }
        Add-Row ('  > ' + $shown + '_') Cyan
        Add-Row ''; Add-Row ('  ' + $errorText) Yellow
        Show-Page 'Enter 확인   Esc 취소'
        $key = Read-Key
        if ($key.Key -eq 'Escape' -or [int]$key.KeyChar -eq 3) { return $null }
        if ($key.Key -eq 'Enter') {
            if (($AllowEmpty -and !$value) -or $value.Length -ge $Min) { return $value }
            $errorText = "최소 ${Min}자 이상 입력해 주세요."
        } elseif ($key.Key -eq 'Backspace') {
            if ($value.Length) { $value = $value.Substring(0, $value.Length - 1) }
        } elseif (![char]::IsControl($key.KeyChar) -and $value.Length -lt 512) { $value += $key.KeyChar }
    }
}
function Configure-Database {
    $db = $script:config.database
    if ($db.dsn) {
        [void](Select-Action '데이터베이스 연결' '연결 문자열 설정을 사용하고 있습니다.' @('돌아가기') @('연결 문자열은 config.json에서 수정할 수 있습니다.'))
        return $false
    }
    $hint = if ($db.password) { 'Enter를 누르면 저장된 연결 비밀번호를 유지합니다.' } else { 'PostgreSQL 설치 때 정한 비밀번호를 입력하세요.' }
    $password = Read-Field '01 / 데이터베이스 연결' 'PostgreSQL에 접속할 때 사용하는 비밀번호입니다.' 'PostgreSQL 비밀번호' @(
        ('서버  {0}:{1}  /  DB  {2}' -f $db.host, $db.port, $db.dbname), ('사용자  ' + $db.user), '', $hint
    ) -Secret -Min 1 -AllowEmpty:([bool]$db.password)
    if ($null -eq $password) { return $false }
    if ($password) {
        $db | Add-Member -NotePropertyName password -NotePropertyValue $password -Force
        Save-Configuration $script:config
    }
    $password = $null
    return $true
}
function Get-AuthStatus {
    return Invoke-RestMethod -Uri ($script:url + '/api/auth/status') -TimeoutSec 2 -UseBasicParsing
}
function Setup-Login {
    $status = Get-AuthStatus
    if ($status.initialized) { $script:loginStatus = '설정됨 · 브라우저에서 기존 비밀번호로 로그인'; return }
    while ($true) {
        $password = Read-Field '02 / ARTEX 로그인 설정' '브라우저에서 ARTEX에 로그인할 때 사용할 비밀번호입니다.' '새 ARTEX 비밀번호' @(
            '로그인 계정  ARTEX', '8자 이상 입력하세요. 한글 포함 시 UTF-8 기준 최대 72바이트입니다.'
        ) -Secret -Min 8
        if ($null -eq $password) { $script:loginStatus = '미설정 · 브라우저에서 설정 가능'; return }
        if ([Text.Encoding]::UTF8.GetByteCount($password) -gt 72) {
            [void](Select-Action '비밀번호가 너무 깁니다' 'UTF-8 기준 72바이트 이내로 입력해 주세요.' @('다시 입력'))
            continue
        }
        $again = Read-Field '02 / ARTEX 로그인 설정' '같은 비밀번호를 한 번 더 입력해 주세요.' '비밀번호 확인' -Secret -Min 8
        if ($null -eq $again) { continue }
        if ($password -cne $again) {
            [void](Select-Action '비밀번호가 일치하지 않습니다' '비밀번호를 다시 입력해 주세요.' @('다시 입력'))
            continue
        }
        try {
            $body = [Text.Encoding]::UTF8.GetBytes((@{ password = $password } | ConvertTo-Json -Compress))
            $null = Invoke-RestMethod -Method Post -Uri ($script:url + '/api/auth/init') -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 10 -UseBasicParsing
            $script:loginStatus = '설정 완료 · 계정 ARTEX'
            return
        } catch {
            $script:loginStatus = '설정 실패 · 브라우저에서 다시 시도하세요'
            return
        } finally { $password = $null; $again = $null; $body = $null }
    }
}

function Show-Monitor([string]$State, [string[]]$Lines, [bool]$OnlyErrors, [int]$Offset, [int]$Horizontal = 0) {
    New-Page '실행 상태' '화면은 고정되고 최근 로그만 갱신됩니다.'
    Add-Row ('  ● ' + $State) $(if ($State -eq '실행 중') { 'Green' } else { 'Yellow' })
    Add-Row ('  웹 주소  ' + $script:url) Cyan
    Add-Row ('  로그인  ' + $script:loginStatus)
    Add-Row ''
    $filterLabel = if ($OnlyErrors) { '오류·경고' } else { '전체' }
    $scrollLabel = if ($Offset) { '이전 기록' } else { '실시간' }
    Add-Row ("  LOGS  /  $filterLabel  /  $scrollLabel") White
    Add-Row ('  ' + ('─' * [Math]::Max(1, [ArtexLauncher.Screen]::Width - 4))) DarkGray
    $capacity = [Math]::Max(1, [ArtexLauncher.Screen]::Height - 14)
    $visible = @($Lines | Where-Object { !$OnlyErrors -or $_ -match '(?i)error|fatal|panic|warn|fail|오류|실패|경고' })
    $end = [Math]::Max(0, $visible.Count - $Offset)
    $begin = [Math]::Max(0, $end - $capacity)
    if (!$visible.Count) { Add-Row '  표시할 로그가 없습니다.' DarkGray }
    for ($i = $begin; $i -lt $end; $i++) {
        $line = $visible[$i]
        $color = if ($line -match '(?i)error|fatal|panic|fail|오류|실패') { 'Red' } elseif ($line -match '(?i)warn|경고') { 'Yellow' } else { 'Gray' }
        if ($Horizontal -gt 0) { $line = $line.Substring([Math]::Min($Horizontal, $line.Length)) }
        Add-Row ('  ' + $line) $color
    }
    Show-Page 'B 웹 열기  L 로그 파일  F 필터  ↑↓/←→ 스크롤  End 최신  Q 종료'
}

function Run-Server {
    # Never attach to or stop a pre-existing server.
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start() } catch {
        [void](Select-Action '포트가 사용 중입니다' "127.0.0.1:$Port 에서 다른 프로그램이 실행 중입니다." @('돌아가기') @('기존 ARTEX 창을 종료하거나 -Port로 다른 포트를 지정하세요.'))
        return
    } finally { $listener.Stop() }
    $logDir = Join-Path $script:installation 'launcher-logs'
    $null = New-Item -ItemType Directory -Path $logDir -Force
    $logFile = Join-Path $logDir ('session-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.log')
    $script:server = [ArtexLauncher.ServerProcess]::new($logFile, [string[]]@([string]$script:config.database.password, [string]$script:config.database.dsn))
    $script:loginStatus = '확인 중'
    $onlyErrors = $false; $offset = 0; $horizontal = 0
    $ready = $false; $setupDone = $false; $attempts = 0; $delay = 1
    $nextProbe = [DateTime]::MinValue; $restartAt = [DateTime]::MaxValue
    try {
        $script:server.Start((Join-Path $script:installation 'artex.exe'), $script:installation, $script:configPath, "127.0.0.1:$Port")
        [ArtexLauncher.Control]::Install()
        while ($true) {
            $state = if ($ready) { '실행 중' } else { '시작 중' }
            if (!$script:server.Running) {
                $ready = $false
                if ($script:server.ExitCode -eq 0) { $state = '종료됨' }
                elseif ($attempts -ge 5) { $state = '시작 실패 · 연결 설정과 로그를 확인하세요' }
                else {
                    if ($restartAt -eq [DateTime]::MaxValue) {
                        if ($script:server.ExitCode -eq 75) { $delay = 1 }
                        $restartAt = [DateTime]::Now.AddSeconds($delay)
                        $script:server.Add("[launcher] 종료 코드 $($script:server.ExitCode). $delay 초 후 다시 시작합니다.")
                        $delay = [Math]::Min(30, $delay * 2)
                    }
                    $state = '다시 시작 대기 중 · Q로 종료'
                    if ([DateTime]::Now -ge $restartAt) {
                        $attempts++; $restartAt = [DateTime]::MaxValue
                        $script:server.Start((Join-Path $script:installation 'artex.exe'), $script:installation, $script:configPath, "127.0.0.1:$Port")
                    }
                }
            } elseif ([DateTime]::Now -ge $nextProbe) {
                $nextProbe = [DateTime]::Now.AddSeconds(3)
                try {
                    $auth = Get-AuthStatus
                    $ready = $true; $attempts = 0; $delay = 1
                    if (!$setupDone) {
                        Setup-Login
                        $setupDone = $true
                    }
                } catch { $ready = $false }
            }
            $lines = $script:server.Snapshot()
            if ($script:server.LogError) { $state = $script:server.LogError }
            Show-Monitor $state $lines $onlyErrors $offset $horizontal
            if ([Console]::KeyAvailable) {
                $key = Read-Key
                if ($key.Key -eq 'Q' -or [int]$key.KeyChar -eq 3) { break }
                switch ($key.Key) {
                    B { Start-Process $script:url }
                    L { Start-Process notepad.exe -ArgumentList ('"' + $logFile + '"') }
                    F { $onlyErrors = !$onlyErrors; $offset = 0 }
                    UpArrow { $offset = [Math]::Min([Math]::Max(0, $lines.Count - 1), $offset + 1) }
                    DownArrow { $offset = [Math]::Max(0, $offset - 1) }
                    PageUp { $offset = [Math]::Min([Math]::Max(0, $lines.Count - 1), $offset + 10) }
                    PageDown { $offset = [Math]::Max(0, $offset - 10) }
                    LeftArrow { $horizontal = [Math]::Max(0, $horizontal - 10) }
                    RightArrow { $horizontal += 10 }
                    End { $offset = 0; $horizontal = 0 }
                }
            }
            Start-Sleep -Milliseconds 100
        }
    } finally {
        New-Page '서버 종료 중' '연결과 저장 파일을 정리하고 있습니다.'
        Show-Page '잠시 기다려 주세요.'
        $script:server.Dispose(); $script:server = $null
    }
}

try {
    if (!$Preview) {
        $script:installation = Find-Installation
        if (!(Test-Path -LiteralPath (Join-Path $script:installation 'artex.exe'))) { throw '선택한 폴더에 artex.exe가 없습니다.' }
        $script:configPath = Join-Path $script:installation 'config.json'
        $script:config = Read-Configuration
    }
    if ($Check) { Write-Output "설치·설정 확인 완료: $script:installation"; exit 0 }
    if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { throw '대화형 터미널에서 launcher.bat를 실행하세요. 검사만 하려면 -Check를 사용하세요.' }
    Initialize-ConsoleHost
    $script:oldTitle = [Console]::Title
    $script:oldColor = [Console]::ForegroundColor
    $script:oldControl = [Console]::TreatControlCAsInput
    [Console]::Title = 'ARTEX-KR | 로컬 콘솔'
    [Console]::TreatControlCAsInput = $true
    $script:uiStarted = $true
    $script:url = "http://127.0.0.1:$Port"
    if ($Preview) {
        $script:loginStatus = '설정됨 · 브라우저에서 기존 비밀번호로 로그인'
        $demo = @('[12:30:01] [config] 설정 파일을 불러왔습니다.', '[12:30:01] [database] PostgreSQL 연결 완료', '[12:30:02] [auth] 기존 로그인 설정을 사용합니다.', '[12:30:02] [server] ARTEX 서버가 준비되었습니다.', '[12:30:03] [경고] 예시 경고 · F를 누르면 오류·경고만 표시합니다.')
        $filter = $false
        do {
            Show-Monitor '실행 중' $demo $filter 0
            $key = Read-Key
            if ($key.Key -eq 'F') { $filter = !$filter }
        } until ($key.Key -eq 'Q' -or $key.Key -eq 'Escape' -or [int]$key.KeyChar -eq 3)
    } else {
        $done = $false
        while (!$done) {
            $configured = [bool]($script:config.database.password -or $script:config.database.dsn)
            $dbState = if ($configured) { '저장된 연결 설정 사용' } else { '연결 비밀번호 설정 필요' }
            $choice = Select-Action '시작하기' '설정을 확인하고 로컬 서버를 실행하세요.' @('서버 시작', 'PostgreSQL 연결 설정', '종료') @(
                ('웹 주소       ' + $script:url), ('데이터베이스  ' + $dbState), '', 'ARTEX 로그인 설정은 서버 연결 후 별도 화면에서 안내합니다.'
            )
            switch ($choice) {
                0 { if ($configured -or (Configure-Database)) { Run-Server } }
                1 { $null = Configure-Database }
                default { $done = $true }
            }
        }
    }
} catch {
    if ($script:uiStarted) {
        New-Page '실행할 수 없습니다' '아래 내용을 확인한 뒤 다시 실행해 주세요.'
        Add-Row ('  ' + $_.Exception.Message) Red
        Show-Page '아무 키나 누르면 종료합니다.'
        $null = Read-Key
    } else { Write-Error $_ -ErrorAction Continue }
    exit 1
} finally {
    if ($script:server) { $script:server.Dispose() }
    if ($script:uiStarted) {
        [ArtexLauncher.Control]::Remove()
        [Console]::TreatControlCAsInput = $script:oldControl
        [Console]::ForegroundColor = $script:oldColor
        [Console]::CursorVisible = $true
        [Console]::Title = $script:oldTitle
        [Console]::Clear()
    }
}
