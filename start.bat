@echo off
rem 콘솔을 UTF-8로 전환합니다. 그렇지 않으면 이 파일의 한글이 GBK 터미널에서 깨집니다.
chcp 65001 >nul 2>&1
rem ARTEX 데몬 시작 스크립트(Windows)
rem
rem 사용법:
rem   start.bat                  포그라운드 실행(Ctrl-C로 중지)
rem   start.bat -addr :9000      추가 인수는 그대로 artex에 전달
rem
rem 하는 일은 하나뿐입니다: artex.exe를 실행하고, 프로세스가 끝나면 종료 코드에 따라 다시 띄울지 판단합니다.
rem
rem   0      사용자 정상 중지 -> 루프 종료
rem   75     재시작 요청      -> 즉시 다시 실행(페이지에서 업데이트 또는 롤백 클릭)
rem   기타   비정상 종료      -> 대기 후 다시 실행(1->2->4…최대 60초)
rem
rem 다운로드, SHA256 검증, 교체는 여기서 하지 않고 전부 artex가 시작할 때 직접 처리합니다
rem (selfupdate 패키지). 스크립트는 단순하게 유지하며, 자세한 설명은 start.sh 상단을 참고하세요.

setlocal enabledelayedexpansion
cd /d "%~dp0"

set "BIN=artex.exe"
if not exist "%BIN%" (
	echo [artex] 실행 파일을 찾을 수 없습니다: %BIN% 1>&2
	exit /b 1
)

set "RESTART_CODE=75"
set "MAX_DELAY=60"
set /a delay=1

:loop
"%BIN%" %*
set "code=!ERRORLEVEL!"

if "!code!"=="0" (
	echo [artex] 정상 종료되었습니다
	exit /b 0
)

if "!code!"=="%RESTART_CODE%" (
	rem 업데이트/롤백 준비 완료: 다시 실행하면 artex가 시작할 때 교체를 마칩니다.
	echo [artex] 새 버전을 적용하기 위해 다시 시작합니다…
	set /a delay=1
	goto loop
)

echo [artex] 오류로 종료되었습니다^(코드=!code!^). !delay!초 후 다시 시작합니다 1>&2
rem 리디렉션된 콘솔에서는 timeout이 실패하므로 ping으로 대체합니다(N초 대기에는 N+1회 필요).
set /a pings=!delay!+1
ping -n !pings! 127.0.0.1 >nul 2>&1
set /a delay=!delay!*2
if !delay! gtr %MAX_DELAY% set /a delay=%MAX_DELAY%
goto loop
