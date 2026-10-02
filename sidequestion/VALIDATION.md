# `/btw` 검증 기록

날짜: 2026-09-10. 브랜치: `codex/btw-side-question`. 베이스라인: `8dae851b9b622f2ff2631f332fde9719d0b16fba`.

독립 PostgreSQL 테스트 DB와 데이터 디렉터리를 썼고, 실제 모델 자격 증명은 독립 테스트 환경에만 주입했으며 코드나 이 기록에는 쓰지 않았고 제품 기본 모델도 바꾸지 않았습니다. Go 1.26.3, norma v0.3.6, Next.js 16.2.9.

실제 모델 대화, 반환 객체, 엔지니어링 단언과 Qwen 원본 심사 텍스트는 [validation-2026-09-10.json](validation-2026-09-10.json)에 저장되어 있고, 그 안에 API 자격 증명은 없습니다.

## 엔지니어링 점검

| 범위 | 결과 | 증거 |
| --- | --- | --- |
| 구조화 메시지, 도구 파라미터 깊은 복사 | 통과 | `TestCheckpointDeepCopyAndBoundaries` |
| 요약 / 압축 요청이 덮어쓰지 않음, 전체 응답과 종료 상태 발행, 반쪽 응답 제외 | 통과 | `TestCheckpointDeepCopyAndBoundaries`, `TestSnapshotExcludesPartialStreamAndSelectsPoolMember` |
| 실제 모델 풀 멤버 신원 | 통과 | `TestSnapshotExcludesPartialStreamAndSelectsPoolMember` |
| 도구 짝, 20쌍 재생, 예산 절단과 초과 오류 | 통과 | `TestBuildRequestCompactionToolPairingAndBudget` |
| 메인/사이드 병렬, 양방향 취소 격리 | 통과 | 블로킹 Provider, `TestMainSideConcurrencyAndIndependentCancellation` |
| 도구 미실행, 스트리밍 / 비스트리밍, 실패 시 기존 사용량 | 통과 | `TestServiceNoToolsAndUsageOnFailure` |
| 실제 norma ChatAgent + 로컬 Read 도구, 메인 transcript / 활동 격리 | 통과 | `TestSideActualChatCheckpointToolResultAndTranscriptIsolation`, 스트리밍·비스트리밍 하위 케이스 |
| 저장, 페이징, 멱등, 재시작 후 부분 답변 유지 | 통과 | `TestSideHistoryIdempotencyPagingAndRecovery` |
| 비우기와 늦은 쓰기 경합, 상위 리소스 삭제, 버전 비교 | 통과 | `TestSideClearLateWritersAndDeletedParent` |
| MainAgent / Worker 아카이브와 복구, v1/v2/v3 | 통과 | `TestSideTaskArchiveVersions` |
| 세 가지 상위 인터페이스, 인증, 리소스 귀속, Worker 논리 삭제 | 통과 | `TestSideHTTPGlobalLimitTaskWorkerAndDeletion`, `TestSideCheckpointPersistsBeforeAdmissionAndRestart` |
| 사용 중인 메인 세션에서도 사이드 가능, 독립 SSE 재연결 / 끊기, 취소, 비우기 | 통과 | `TestSideHTTPBusyIsolationClearAndReconnect` |
| 상위 세션당 1 / 전역 4 동시성 | 통과 | 위의 `TestSideHTTP…` 케이스 두 개 |
| 제출 전 스냅샷 저장, 재시작 후 이어 묻기, 예전 세션의 스냅샷 위조 불가 | 통과 | `TestSideCheckpointPersistsBeforeAdmissionAndRestart` |
| 캐시된 설정이 삭제되거나 모델이 바뀌면 계속 거부 | 통과 | `TestSideRejectsDeletedOrChangedCachedProfile` |
| 아카이브 전에 취소하고 최종 답변·사용량 저장을 기다림 | 통과 | `TestSideTaskDrainPersistsBeforeArchive` |
| 스트리밍 소비자가 일찍 취소해도 사용량을 한 번만 기록하고 사이드에 귀속 | 통과 | `TestSideUsageRecordedOnceOnConsumerCancellation` |
| 재시작으로 자동 복구된 Worker / deadline 실행 컨텍스트가 새 스냅샷을 계속 발행 | 통과 | `TestSideRestoredWorkerRuntimePublishesNewCheckpoint` |
| 관련 패키지 race 검사 | 통과 | 아래 명령 |
| TypeScript와 프로덕션 빌드 | 통과 | `npx tsc --noEmit`, `npm run build` |
| 새 프런트엔드 모듈 Biome | 통과 | `biome check`, 새 모듈 3개 |

버릴 수 있는 별도 데이터베이스에 `ARTEX_PG_DSN`을 설정한 뒤 자동화 점검을 재현할 수 있습니다(운영 DB를 가리키지 마세요):

```sh
go test -race ./agent ./db ./server ./sidequestion ./llmrec ./llmpool \
  -run 'Test(Side|Checkpoint|Snapshot|BuildRequest|Service|MainSide|CaptureRun|TaskArchive|CompleteForwards|StopIntent|CancelIntent)' -count=1
cd web
npx tsc --noEmit
npx biome check src/lib/side-questions.ts src/hooks/use-side-questions.ts src/components/side-question-workspace.tsx
npm run build
```

전체 Go 회귀가 모두 초록은 아닙니다: `server` 패키지에는 임시 디렉터리 정리 단계에서 실패하는 기존 테스트가 둘 있고, 둘 다 `TempDir RemoveAll … directory not empty`를 냅니다:

- `TestInheritedActivityDetailAndRelationDeletion`
- `TestTaskMetadataPatchReturnsRenameAndPin`

위의 수정되지 않은 베이스라인에서 소스를 내보내 같은 격리 환경에서 `server` 패키지를 다시 돌려도 이 두 정리 실패가 재현됩니다. 베이스라인 실행에서는 `TestCoreTaskLifecyclePG`의 목표 노드 수 단언 실패도 나타났고, 최종 수정 후 `server` 회귀에는 그 단언 실패가 없었습니다. 다른 패키지는 통과했고, 이번 사이드 질문 관련 케이스와 race 검사도 통과했습니다. 베이스라인 문제를 이번 수용 통과로 표시하지 않았고, 문제를 숨기려고 기존 단언을 고치지도 않았습니다.

Next.js 빌드 출력에는 이미 있던 다중 lockfile / workspace root 추론 경고가 나옵니다. 빌드는 완료됐고 모든 페이지가 생성됐습니다.

## 브라우저 점검

Codex In-app Browser로 독립 로컬 Go 서비스와 Next.js 개발 서버에 연결했습니다. 데스크톱과 390 × 844 좁은 화면에서 아래 조작을 수행하며 스크린샷과 브라우저 로그를 확인했습니다:

- 일반 채팅이 실행 중일 때 `/btw`를 입력하면 메인 내용과 사이드가 동시에 표시됨; 데스크톱 사이드 패널 정상.
- 연속 추가 질문; 사이드를 중지하면 이미 생성된 부분이 남고 메인 흐름은 계속됨.
- 패널을 닫아도 요청은 계속되고, 다시 열면 완료된 답변이 복구됨; 페이지를 새로고침한 뒤 빈 `/btw`로 이력이 복구됨.
- 좁은 화면 Drawer의 입력, 버튼, 이력과 닫기 동작이 정상이고 가로 오버플로 없음.
- 비우기는 확인 대화상자를 쓰고, 비운 뒤 이력이 사라지며 메인 transcript와 스냅샷은 유지됨.
- 작업 MainAgent와 Worker 둘에 각각 질문하고 전환했으며, Agent 라벨과 이력이 섞이지 않음.
- 블로킹 로컬 모델 픽스처로 Worker를 계속 실행시켜 두고 Worker 메인 입력창에서 `/btw`를 제출했으며, 사이드를 중지한 뒤에도 Worker가 실시간 실행과 자기 일시정지 버튼을 계속 보여주고 사이드는 부분 답변을 저장함.
- 브라우저 오류 / 경고 로그가 비어 있음.

제어 가능한 픽스처로 동시성 타이밍을 정확히 검증했고, 실제 모델의 출력 속도에 의존하지 않았습니다. 디버깅 중 Worker 런타임 점검 두 번은 유효한 동시성 창을 만들지 못했고(작업 종료 / 답변이 일찍 끝남), 픽스처를 고친 뒤 다시 해서 통과했습니다. 이 초기 조작은 유효 통과로 기록하지 않았습니다.

## 실제 모델 대화

우선 `grok-4.6`을 탐지했고, OpenAI 호환 인터페이스는 `http://127.0.0.1:12580/tingly/openai`입니다. 탐지 HTTP 200, 반환 모델명 `grok-4.6`과 `READY`, 2.82초. 첫 후보가 사용 가능해서 Tingly `glm`이나 지푸(Zhipu) `glm-5.3` 대체 체인은 켜지 않았고, 이 두 대체 서비스는 이번에 검증하지 않았습니다.

| 시나리오 | 실제 결과 |
| --- | --- |
| 메인 세션이 실행 중일 때 점검 대상·목표·표식 질문 | `redhaze.top`, 첫 페이지 읽기와 목표 요약, `BTW-REAL-0910` 반환; 사이드 완료, 16.97초 |
| 메인이 첫 페이지 읽기를 끝낸 뒤 도구 근거 질문 | WebFetch 200, curl 리다이렉트 301 → 302 → 200, 페이지 제목을 정확히 인용; 7.24초 |
| 사이드가 Bash로 테스트 파일 생성을 요구 | 실행을 거부했고 대상 파일이 만들어지지 않음; 7.74초 |
| 완료된 사이드는 메인 컨텍스트를 바꾸지 않음 | 메인 transcript SHA-256이 메인 활동 기록과 일치; 사이드 도구 실행 횟수 0 |
| Go 서비스를 실제로 중지 / 재시작한 뒤 이어 묻기 | 앞선 사이드 이력 3건을 유지하고, 저장된 스냅샷에서 점검 대상·표식·제목을 바로 답변했으며 메인 Agent를 재실행하지 않음 |
| 새 세션에서 Grok 비스트리밍 설정 사용 | 점검 대상과 `ATOMIC-0910`을 정확히 답변; 사용량 반환·저장: input 11734, output 138, cache_read 11520 |

점검 대상 사례의 메인 세션은 WebFetch와 Bash/curl로 공개 첫 페이지를 읽었고, 착지 페이지는 `https://id.redhaze.top/home`, 제목은 `红幕科技 RedHaze Group · 全球综合集团门户`(한국어로 옮기면 "레드헤이즈 그룹 · 글로벌 종합 그룹 포털")입니다. Bash는 응답을 로컬 테스트 파일에 임시로 저장했고 원격에 쓰지는 않았습니다. 이 사실과 "사이드가 도구를 실행하지 않았다"는 항목은 따로 검증했습니다.

메인 transcript 검증값: `e7e61f135a4a120954b539f357e8c4205d7d5cd7460dcaf3dc0fd066463e1d00`.

**사용량 제한:** Tingly의 Grok 스트리밍 응답은 usage를 돌려주지 않았습니다. 별도로 `stream_options.include_usage=true`를 직접 보내 확인했고, HTTP 200, 데이터 프레임 12개, usage 프레임 0개였습니다. 그래서 스트리밍 테스트의 0은 엔드포인트가 사용량을 제공하지 않았다는 뜻이며, 과금이 없었다는 뜻이 아닙니다. 비스트리밍 사용량과 픽스처의 실패 / 취소 사용량은 모두 정확히 저장됐습니다.

## Qwen 심사

심사 모델 `qwen-flash`, OpenAI 호환 인터페이스 `https://dashscope.aliyuncs.com/compatible-mode/v1`, HTTP 200. 앞의 실제 사이드 대화 3건, 메인 세션 도구 근거와 엔지니어링 단언을 제공했고 `verdict: accept`, `concerns: []`를 반환했으며, 답변이 점검 대상·표식·페이지 읽기 증거와 일치한다고 보고 사이드의 도구 거부가 제약 조건에 맞는다고 판단했습니다. 심사 사용량: prompt 6625, completion 312, total 6937.

이번 Qwen 심사 범위에는 나중에 추가된 서비스 재시작과 비스트리밍 테스트가 들어가지 않았습니다. Qwen이 말한 "쓰기 없음"은 범위가 넓습니다: 메인 세션의 curl이 실제로 로컬 응답 임시 파일을 만들었고, 이는 위에 분명히 기록했습니다. 동시성, 도구 실행 0회와 transcript 격리는 엔지니어링 단언으로 판정했고, 모델 심사는 답변 품질 평가를 보조하는 데만 썼습니다.
