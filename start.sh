#!/bin/sh
# ARTEX 데몬 시작 스크립트(Linux / macOS / Docker ENTRYPOINT)
#
# 사용법:
#   ./start.sh                       포그라운드 실행(Ctrl-C로 중지)
#   nohup ./start.sh >artex.log 2>&1 &   백그라운드 상주
#   ./start.sh -addr :9000           추가 인수는 그대로 artex에 전달
#
# 하는 일은 하나뿐입니다: artex를 실행하고, 프로세스가 끝나면 종료 코드에 따라 다시 띄울지 판단합니다.
#
#   0      사용자 정상 중지    → 루프 종료
#   75     재시작 요청         → 즉시 다시 실행(페이지에서 업데이트 또는 롤백 클릭)
#   기타   비정상 종료         → 대기 후 다시 실행(1→2→4…최대 60초)
#
# 여기서 다운로드, SHA256 검증, 교체를 하지 않는 것은 의도된 설계입니다: 그 로직을 sh와 bat에
# 두 번 구현해야 하는데, 하필 가장 실수하면 안 되는 부분입니다. 실행되지 않는 바이너리로
# 교체되면 이 스크립트가 그 바이너리를 계속 다시 띄울 뿐이고, 사용자는 서버에 직접 들어가
# 수동으로 복구해야 합니다. 그래서 검증/교체는 전부 Go(selfupdate 패키지)에 두고 artex가 시작할 때 직접 처리하며, 스크립트는 단순하게 유지합니다.
set -u

cd "$(dirname "$0")" || exit 1

BIN=./artex
[ -x "$BIN" ] || { echo "[artex] 실행 파일을 찾을 수 없습니다: $BIN" >&2; exit 1; }

RESTART_CODE=75
MAX_DELAY=60

child=0
stopping=0

# 중지 신호를 artex 본체로 전달합니다.
#
# Docker에서는 필수입니다: docker stop은 SIGTERM을 PID 1(이 스크립트)에만 보내고
# 자식 프로세스에는 보내지 않습니다. 전달하지 않으면 artex가 신호를 받지 못해 정상 종료를
# 하지 못하고 10초 뒤 SIGKILL로 강제 종료되어, 실행 중이던 작업이 중간에 끊깁니다.
forward() {
	stopping=1
	if [ "$child" -ne 0 ]; then
		kill -TERM "$child" 2>/dev/null || true
	fi
}
trap forward INT TERM

delay=1
while :; do
	"$BIN" "$@" &
	child=$!

	# 시그널이 wait를 중단시키면 반환값이 128보다 큽니다. 이때 자식 프로세스는 아직 정상 종료 중이므로,
	# 한 번 더 wait해야 실제 종료 코드를 얻을 수 있습니다.
	wait "$child"
	code=$?
	if [ "$code" -gt 128 ]; then
		wait "$child"
		code=$?
	fi
	child=0

	if [ "$stopping" -eq 1 ]; then
		echo "[artex] 종료되었습니다"
		exit 0
	fi

	case "$code" in
		0)
			echo "[artex] 정상 종료되었습니다"
			exit 0
			;;
		"$RESTART_CODE")
			# 업데이트/롤백 준비 완료: 다시 실행하면 artex가 시작할 때 교체를 마칩니다(selfupdate.Bootstrap 참고).
			echo "[artex] 새 버전을 적용하기 위해 다시 시작합니다…"
			delay=1
			;;
		*)
			echo "[artex] 오류로 종료되었습니다(코드=$code). ${delay}초 후 다시 시작합니다" >&2
			sleep "$delay"
			delay=$((delay * 2))
			[ "$delay" -gt "$MAX_DELAY" ] && delay=$MAX_DELAY
			;;
	esac
done
