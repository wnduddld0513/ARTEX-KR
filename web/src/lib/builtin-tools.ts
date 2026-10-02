// 백엔드가 DB에 심는 시스템 도구 설명/파라미터 안내를 화면 표시용 한국어로 바꾼다.
//
// DB 값(=모델이 보는 도구 설명)은 원본 저장소 그대로 두고, 화면에 그릴 때만 이 표를 쓴다.
// 표에 없는 도구, 사용자가 고친 문구(한자 없음)는 그대로 돌려준다.
const HAN = /\p{Script=Han}/u;

type ToolMeta = { description: string; params: Record<string, string> };

const TOOL_META: Record<string, ToolMeta> = {
  "add_company_scope": {
    description: "도메인/IP/CIDR/ICP 등록/기업 키워드를 특정 기업의 【점검 대상 범위】에 추가합니다. 도메인, 네트워크, ICP는 일치하는 점검 대상을 자동으로 귀속시키고, 키워드는 범위 힌트로만 Agent에게 제공됩니다.\n기업명은 고유합니다: company가 없으면 새로 만들고, 이미 있으면 재사용합니다(범위만 병합).\nscope는 한 줄에 하나씩이며 시스템이 자동으로 인식합니다: 루트 도메인 / URL / 단일 IP / CIDR 대역 / ICP 등록 / 기업 키워드.\n반드시 reason에 귀속 근거(whois/인증서/ASN 등)를 적어야 합니다.\n가드레일: 단독 TLD와 지나치게 넓은 대역은 거부합니다(IPv4 접두사는 /16-/32, IPv6 접두사는 /32-/128이어야 함). 잘못된 줄은 건너뛰고 errors에 반환합니다.",
    params: {
      "logo": "기업 아이콘 URL(선택, 새 기업 생성 시에만 적용)",
      "scope": "점검 대상 범위, 한 줄에 하나: 도메인 / URL / IP / CIDR / ICP 등록 / 기업 키워드",
      "reason": "귀속 근거(증거/출처), 반드시 입력",
      "company": "기업명(없으면 새로 생성, 있으면 재사용, 이름은 고유)",
    },
  },
  "add_hint": {
    description: "사람/메인 agent의 전략 힌트를 탐색 그래프에 추가합니다. planner가 다음에 탐색 계획을 생성할 때 이 힌트를 읽습니다.\n★일괄 처리를 권장합니다: 여러 힌트를 hints 배열에 담아 한 번에 제출하세요(개별 호출보다 왕복이 줄어듭니다). ids 배열을 반환하며 hints와 길이가 같고 순서도 같습니다(실패 항목 id=0, 상세 내용은 errors 참조). 단일 힌트는 hints를 생략하고 최상위 text에 바로 전달합니다.",
    params: {
      "text": "[단일] 힌트 내용, 예: '인증 후 인터페이스를 집중적으로 공략'",
      "hints": "【이것을 우선 사용】새로 추가할 힌트 배열, 순서대로 처리합니다. 각 요소의 필드는 아래 최상위 필드(text/asset_ids/traffic_refs)와 같습니다. 반환되는 ids는 이 배열과 길이가 같고 순서도 같습니다.",
      "hints.text": "힌트 내용",
      "hints.traffic_refs": "선택: 이미 검증되었고 이 힌트의 특정 취약점에 대응하는 트래픽 참조이며 순서를 유지합니다. 인계 후 report_finding에서 evidence_hint_id를 전달하면 이 참조들을 함께 전달할 수 있습니다.",
      "asset_ids": "앵커링할 점검 대상 id(선택, 0/1/여러 개)",
      "traffic_refs": "선택: 이미 검증되었고 이 힌트의 특정 취약점에 대응하는 트래픽 참조이며 순서를 유지합니다. 인계 후 report_finding에서 evidence_hint_id를 전달하면 이 참조들을 함께 전달할 수 있습니다.",
      "traffic_refs.note": "이 트래픽이 뒷받침하는 결론",
      "traffic_refs.role": "baseline / proof / verification / supporting",
      "traffic_refs.traffic_id": "실제 트래픽 ID",
    },
  },
  "add_intent": {
    description: "【탐색 방향】을 생성해 frontier에 기록하고 탐색 체인에 연결합니다. 탐색 계획은 열린 탐색 방향이며 고정된 유형이 아닙니다. summary에 무엇을 탐색/검증/활용할지 한 문장으로 자유롭게 설명합니다.\n★일괄 처리를 권장합니다: 한 라운드에서 선별한 여러 새 방향을 intents 배열에 담아 한 번에 제출하세요(개별 호출보다 왕복이 줄어듭니다). ids 배열을 반환하며 intents와 길이가 같고 순서도 같습니다(실패 항목 id=0, 상세 내용은 errors 참조). 단일 항목은 intents를 생략하고 최상위 summary에 바로 전달합니다.",
    params: {
      "intents": "【이것을 우선 사용】새로 추가할 탐색 방향 배열, 순서대로 처리합니다. 각 요소의 필드는 아래 최상위 필드(summary/asset_ids/parent_ids/priority)와 같습니다. 반환되는 ids는 이 배열과 길이가 같고 순서도 같습니다.",
      "summary": "[단일] 이 탐색 방향을 한 문장으로 설명합니다: 무엇을 하는지+왜. 방향이 명확하면 되고 점검 대상 id에 의존하지 않습니다.",
      "priority": "우선순위 0-10, 기본 5",
      "asset_ids": "이 방향이 테스트/공격할 【목표 점검 대상 id】(**가능한 한 전달**, 0/1/여러 개; list_assets가 반환한 점검 대상 id이며 탐색 노드 id가 아님): 이 탐색 방향이 겨냥하는 점검 대상(사이트/인터페이스/파라미터/호스트 등). 방향이 특정 점검 대상을 중심으로 하면 반드시 전달하세요. '이 탐색이 어떤 목표를 겨냥하는가'를 나타내는 구조적 표시로, 커버리지 중복 제거와 탐색 계획을 점검 대상 체인에 연결하는 데 사용됩니다. 순수 전역 정찰이고 구체적인 목표 점검 대상이 정말 없을 때만 비워 둡니다.",
      "parent_ids": "상위 앵커 id(선택, 0/1/여러 개): 이 방향이 어떤 【확인된 사실(fact)/발견(finding)】을 종합해 도출되었는지. **이미 존재하는 fact/finding 노드 id만 입력할 수 있고 탐색 계획/목표/힌트는 입력할 수 없습니다** — 탐색 계획은 반드시 확인된 지식에 앵커링되어야 하고, 발견이 계획을 이끌어야 하며 허공에서 계획을 세워서는 안 됩니다. 여러 사실이 함께 하나의 새 탐색 계획을 만들면 여러 개를 전달하고, 최상위의 완전히 새로운 정찰 방향은 비워 두세요(자동으로 작업 시작점 origin fact에 연결됩니다).",
    },
  },
  "add_task_hint": {
    description: "지정한 작업에 전략 힌트를 주입합니다(해당 작업의 planner가 다음 라운드에 탐색 계획을 생성할 때 읽습니다).\n★일괄 처리를 권장합니다: 여러 힌트를 hints 배열에 담아 한 번에 제출하세요(ids 배열을 반환하며 hints와 길이가 같고 순서도 같음, 실패 항목 id=0). 단일 힌트는 hints를 생략하고 최상위 text에 바로 전달합니다.",
    params: {
      "text": "[단일] 힌트 내용",
      "hints": "【이것을 우선 사용】힌트 배열, 각 요소의 필드는 최상위와 같습니다(text/asset_ids/traffic_refs).",
      "hints.text": "힌트 내용",
      "hints.traffic_refs": "선택: 이미 검증되었고 이 힌트의 특정 취약점에 대응하는 트래픽 참조이며 순서를 유지합니다. 인계 후 report_finding에서 evidence_hint_id를 전달하면 이 참조들을 함께 전달할 수 있습니다.",
      "task_id": "작업 id",
      "asset_ids": "앵커링할 점검 대상 id(선택, 0/1/여러 개; 해당 작업 내의 점검 대상 id)",
      "traffic_refs": "선택: 이미 검증되었고 이 힌트의 특정 취약점에 대응하는 트래픽 참조이며 순서를 유지합니다. 인계 후 report_finding에서 evidence_hint_id를 전달하면 이 참조들을 함께 전달할 수 있습니다.",
      "traffic_refs.note": "이 트래픽이 뒷받침하는 결론",
      "traffic_refs.role": "baseline / proof / verification / supporting",
      "traffic_refs.traffic_id": "실제 트래픽 ID",
    },
  },
  "add_task_scope": {
    description: "테스트 범위를 【이 작업】에 추가합니다. 이는 이 작업의 권한 경계이자 점검 대상 테스트 커버리지의 분모입니다.\nkind 지원: company(기업 전체 소유 점검 대상) / root_domain(전체 루트 도메인, 모든 하위 도메인 포함) / subdomain(정확한 단일 하위 도메인) / ip / cidr / icp / keyword.\n설명: worker가 하나씩 마주치는 호스트는 시스템이 【자동】으로 범위에 추가합니다(정확한 하위 도메인). 이 도구는 【직접 확대】할 때 사용합니다 — 전체 루트 도메인/기업 전체를 포함하거나 특정 하위 도메인/IP를 보충 지정할 때입니다.\nvalue: company는 기업명 또는 id(기업이 이미 존재해야 함), root_domain/subdomain은 도메인, ip/cidr은 IP 또는 대역, icp/keyword는 등록 번호 또는 기업 키워드를 전달합니다.\n반드시 reason에 근거를 적어야 합니다(감사 가능). 여러 항목은 entries 배열로 전달합니다.",
    params: {
      "kind": "[단일] company / root_domain / subdomain / ip / cidr / icp / keyword",
      "value": "[단일] 기업명 또는 id / 도메인 / IP / CIDR / ICP / 키워드",
      "reason": "추가 근거(감사용), 반드시 입력",
      "entries": "일괄: [{kind, value}]. kind∈company/root_domain/subdomain/ip/cidr/icp/keyword.",
    },
  },
  "bind_finding_traffic": {
    description: "이미 등록된 취약점에 검증된 실제 HTTP 트래픽을 추가로 바인딩합니다. finding_id에는 독립 취약점 레코드 ID를 사용하고 탐색 노드 ID를 전달하지 않습니다. 같은 배치의 참조는 전부 성공하거나 전부 실패하며, 중복 참조는 기존 설명을 덮어쓰지 않습니다. 추가 바인딩을 하면 기존 보고서가 업데이트 필요로 표시됩니다. 보충 트래픽을 위해 다시 탐지하거나 취약점을 중복 생성하지 마세요.",
    params: {
      "finding_id": "독립 취약점 레코드 ID, list_task_findings / get_task_node_detail의 finding_id 필드에서 읽습니다",
      "traffic_refs": "선택: 이미 검증되었고 이 힌트의 특정 취약점에 대응하는 트래픽 참조이며 순서를 유지합니다. 인계 후 report_finding에서 evidence_hint_id를 전달하면 이 참조들을 함께 전달할 수 있습니다.",
      "traffic_refs.note": "이 트래픽이 뒷받침하는 결론",
      "traffic_refs.role": "baseline / proof / verification / supporting",
      "traffic_refs.traffic_id": "실제 트래픽 ID",
    },
  },
  "create_custom_tool": {
    description: "【중요】플랫폼에 없는 도구를 설치했을 때 이 도구를 호출해 설치한 도구를 플랫폼에 넣으면 플랫폼에서 호출할 수 있습니다! 사용자 정의 도구(shell/command/script/http)를 생성합니다. shell=bash 환경 선언이며 key+description+agents만 있으면 되고 exec/schema는 필요하지 않습니다.",
    params: {
      "key": "도구 key(소문자로 시작, 영문/숫자/밑줄)",
      "exec": "실행 사양(shell 유형은 불필요): command→{command}; script→{code}; http→{method,url,headers,body,proxy,use_recording_proxy}",
      "kind": "shell | command | script(Python만) | http. shell=bash 환경 선언(모델에게 이 도구를 bash에서 바로 호출할 수 있다고 알려줄 뿐이며 exec/schema 불필요); 나머지 세 가지는 exec를 제공해야 합니다",
      "agents": "바인딩할 agent key(선택)",
      "schema": "파라미터 JSON-Schema(shell/command/script는 비워 둘 수 있음; http는 필수이며 properties를 포함해야 함)",
      "enabled": "사용 여부(기본 true)",
      "deferred": "지연 여부(shell 유형은 무효; command/script/http에서 자주 쓰지 않는 도구에만 켜세요)",
      "description": "모델에게 보낼 설명",
    },
  },
  "create_mcp": {
    description: "MCP 서버(stdio/http/sse)를 생성합니다. 생성 후에는 agent 가시성에 맞춰 해당 도구에 권한을 부여해야 합니다.",
    params: {
      "env": "환경 변수 {KEY:VALUE}",
      "url": "http/sse의 URL",
      "args": "명령 인수 배열",
      "name": "MCP 서버 이름",
      "command": "stdio의 시작 명령(예: npx)",
      "enabled": "사용 여부(기본 true)",
      "insecure": "http: TLS 인증서 검증 건너뛰기(자체 서명 인증서일 때 true, 기본 false)",
      "transport": "stdio | http / sse",
    },
  },
  "create_skill": {
    description: "새 skill을 생성합니다(SKILL.md 작성, agentskills.io 규격). name은 소문자/숫자/하이픈입니다.",
    params: {
      "name": "skill 이름(소문자로 시작, 영문/숫자/하이픈)",
      "description": "skill 설명(필수, 무엇을 하는지/언제 쓰는지 설명)",
      "instructions": "Markdown 본문 설명(선택)",
    },
  },
  "delete_assets_by_host": {
    description: "host를 기준으로 점검 대상을 정확히 삭제합니다: 해당 host의 도메인/하위 도메인과 그 아래의 서비스(service), 인터페이스(endpoint)를 삭제합니다.\nhost는 완전 일치(소문자, 공백 제거)이며 퍼지/와일드카드가 아닙니다.\n루트 도메인(예: example.com)을 전달하면 그 하위 도메인과 해당 서비스/인터페이스까지 함께 삭제되고, 하위 도메인(예: a.example.com)이나 IP를 전달하면 해당 host 자체와 그 서비스/인터페이스만 삭제됩니다.\n⚠️ 하드 삭제이며 전역 점검 대상 저장소(작업 간 공유)에 적용되고 되돌릴 수 없습니다.",
    params: {
      "host": "삭제할 host: 도메인/하위 도메인/IP. 완전 일치, 예: example.com 또는 a.example.com 또는 1.2.3.4",
    },
  },
  "expand_digest": {
    description: "콜드 digest 하나를 펼칩니다: 접혀 있던 멤버의 압축 목록(id/summary/state/confidence)을 반환하며 개요의 recent_facts/recent_done_intents와 같은 형태입니다. 특정 항목의 전체 상세/증거가 필요하면 node_detail(member_id)을 사용합니다.",
    params: {
      "id": "digest 노드 id(개요의 cold_digests에서 확인)",
    },
  },
  "get_finding_retest_context": {
    description: "현재 재검증 세션과 연결된 취약점 증거 스냅샷, 재검증 상태, 보충 설명, 현재 작업 규칙을 읽습니다. 파라미터가 없으며 이 세션만 읽을 수 있습니다.",
    params: {

    },
  },
  "get_finding_traffic": {
    description: "취약점에 이미 바인딩된 실제 트래픽 증거를 읽으며 캡처 스위치에 의존하지 않습니다. finding_id에는 report_finding JSON이 반환한 독립 취약점 레코드 ID를 사용합니다(첫 줄의 탐색 노드 ID가 아님). 먼저 binding_id를 전달하지 않으면 목록과 version을 가져옵니다. 빈 목록은 정상이며, TCP 등 비 HTTP 취약점이거나 아직 수집하지 않았을 때도 텍스트/명령 증거를 근거로 보고서를 작성할 수 있고 바인딩은 필수가 아닙니다. 바인딩이 있으면 binding_id, side(request/response), offset으로 본문을 구간별로 읽습니다. 보고서를 작성할 때 읽은 version을 evidence_version으로 update_finding_report에 전달하며, 그때 finding_id는 여전히 탐색 노드 ID를 사용합니다.",
    params: {
      "side": "request 또는 response, 기본 response",
      "binding_id": "목록에 있는 바인딩 ID, 생략하면 목록을 반환",
      "finding_id": "독립 취약점 레코드 ID",
    },
  },
  "get_task_graph": {
    description: "지정한 작업의 탐색 그래프 개요를 읽습니다(graph_overview 와 동일: 점검 대상 집계/frontier/발견/커버리지 등). task_id 로 작업을 지정합니다.",
    params: {
      "task_id": "작업 id",
    },
  },
  "get_task_node_detail": {
    description: "지정한 작업의 특정 탐색 그래프 노드 전체 내용(발견/사실/탐색 계획/목표: 요약 + 상세/증거/PoC)을 읽습니다. id 는 탐색 노드 id 입니다(report_finding 이 반환한 값 또는 list_task_findings 의 id 등). 취약점 보고서를 작성하기 전에 이 도구로 해당 취약점의 전체 증거를 가져옵니다.",
    params: {
      "id": "탐색 그래프 노드 id(점검 대상 id 아님)",
      "task_id": "작업 id",
    },
  },
  "get_task_worker_trace": {
    description: "지정한 작업의 특정 work(탐색 계획) 실행 과정을 확인합니다. get_task_worker_trace(task_id, intent_id) 로 단계 요약을 보고, 이어서 step_ids=[...] 를 함께 전달하면 해당 단계들의 전체 내용을 가져옵니다(한 번에 최대 5개, 초과분은 앞의 5개만 반환).",
    params: {
      "task_id": "작업 id",
      "step_ids": "선택: 전체 내용을 가져올 단계 id(한 번에 최대 5개, 초과분은 앞의 5개만 반환하고 나머지는 omitted_step_ids 에 나열됩니다)",
      "intent_id": "탐색 계획 id(해당 작업의 work)",
    },
  },
  "get_worker_output": {
    description: "이 작업 또는 직접 연관된 작업에 있는 특정 탐색 계획(work)의 최종 출력 결론을 가져옵니다. 연관 작업 결과에는 source_task_id/inherited=true 가 붙고 읽기 전용입니다. 정상 종료된 work 는 요약을 반환하고, 중단(stopped)되었거나 비정상 종료된 work 는 중단 시점까지의 마지막 출력을 반환합니다.",
    params: {
      "intent_id": "탐색 계획 id(= work 핸들)",
    },
  },
  "get_worker_trace": {
    description: "특정 탐색 계획(work)의 【실행 과정】을 조회합니다(get_worker_output 이 최종 결론만 제공하는 것과 다릅니다). 세 가지 사용법:\n① intent_id 만 전달 → 해당 work 의 각 단계 요약 스트림을 반환합니다(summary 100자 이하, step_id 포함; 동작 개요일 뿐 전체 출력은 포함하지 않습니다);\n② intent_id + q → 키워드가 적중한 단계 요약만 반환합니다(요약과 전체 출력에서 모두 검색; 여전히 summary 만 제공하므로 내용을 보려면 ③을 사용합니다);\n③ intent_id + step_ids → 해당 단계들의 전체 내용(detail)을 반환합니다. 한 번에 최대 5개까지 가져오며 초과분은 앞의 5개만 반환하고 가져오지 못한 것은 notice/omitted_step_ids 에 알려 줍니다.\n일반적인 흐름: 먼저 ①/②로 의심되는 단계의 step_id 를 찾은 뒤 ③으로 그 전체 출력을 가져옵니다. 사고(thinking) 단계는 포함하지 않습니다. 직접 연관된 작업의 과거 trace 도 지원하며, 그 결과에는 source_task_id/inherited=true 가 붙고 읽기 전용입니다.",
    params: {
      "q": "키워드: 요약/전체 출력에서 이 키워드가 적중한 단계만 반환합니다(선택, step_ids 와 함께 사용할 수 없음)",
      "limit": "요약 스트림/검색의 반환 상한(선택)",
      "step_ids": "전체 내용을 가져올 step_id(①/②의 반환값; 한 번에 최대 5개까지 가져오며 초과분은 앞의 5개만 반환하고 나머지는 omitted_step_ids 에 나열됩니다)",
      "intent_id": "탐색 계획 id(= work 핸들)",
    },
  },
  "goal_met": {
    description: "【전체 작업 즉시 종료】—— 작업의 【모든 목표가 실제로 달성되어 전체가 마무리되었음】을 확인했을 때만 호출합니다(작업 【전체】 완료에 주의하세요. 목표 하나/flag 하나/취약점 하나만 달성한 것은 【해당하지 않습니다】 —— 그런 경우에는 prove_goal 로 해당 목표를 표시하면 됩니다). ⚠️ 이 도구는 “이번 회차 계획을 끝내는” 용도가 아닙니다. 이번 회차에 파견할 새 탐색 계획이 없거나 worker 산출을 기다리는 상황이라면 【이번 회차를 그냥 끝내면 되며, 이 도구를 호출하지 마세요】(탐색 계획 0개는 완전히 정상입니다). 정상 판정은 prove_goal 로 목표를 하나씩 증명하는 것을 우선하고, goal_met 은 하나씩 증명하는 과정을 건너뛰고 전역에서 바로 마무리하는 수단입니다.",
    params: {
      "reason": "달성 사유(목표가 실제로 달성되었다는 증거여야 하며, “이번 회차에 새 방향이 없음” 같은 회차 종료 사유는 안 됩니다)",
    },
  },
  "graph_overview": {
    description: "(탐색 체인 그래프) 탐색 상황 요약: 점검 대상 집계, 인터페이스가 없는 사이트, frontier, 발견, hints(사람/메인 agent 의 전략 힌트로, 탐색 계획을 생성할 때 반드시 포함해야 합니다). 계획을 세울 때 먼저 호출합니다.",
    params: {

    },
  },
  "insert_assets": {
    description: "새로 발견한 점검 대상을 일괄 등록합니다. 한 번에 여러 타입을 함께 넣을 수 있습니다(type 은 열거형 참조).\n타입별 필수 필드: root_domain→domain; ip→ip(IPv4/IPv6 여야 하며 호스트명 불가); subdomain→domain; app→app_name; service(HTTP)→url; service(비 HTTP)→service_name+port(ip/domain 중 최소 하나 입력); endpoint→url+method. 나머지 필드의 의미는 각 설명을 참조하세요.\nauth/technologies/params 는 추가 병합(append)되며 기존 값을 덮어쓰지 않습니다.\n반환: {results:[{index,id,type}], errors:[{index,error}]}",
    params: {
      "assets": "점검 대상 배열이며, 각 요소가 점검 대상 레코드 하나에 대응합니다",
      "assets.ip": "IP 주소이며 IPv4/IPv6 주소여야 하고 호스트명은 입력할 수 없습니다(호스트명은 type=subdomain 의 domain 필드를 사용하세요); ip 타입 필수, service/endpoint 타입 선택이며 IP 연결에 사용합니다",
      "assets.icp": "ICP 등록 번호(선택)",
      "assets.url": "프로토콜과 포트를 포함한 전체 URL(HTTP 서비스 필수; service_type 은 자동으로 http 로 설정됩니다)",
      "assets.auth": "발견된 인증 정보 목록이며 각 항목은 type/username/password 등의 필드를 포함합니다(선택, 추가하며 덮어쓰지 않음)",
      "assets.port": "포트 번호(service 가 비 HTTP 일 때 필수)",
      "assets.type": "점검 대상 타입",
      "assets.domain": "루트 도메인 또는 서브도메인(root_domain/subdomain 필수)",
      "assets.method": "HTTP 메서드: GET/POST/PUT/PATCH/DELETE 등(endpoint 필수)",
      "assets.params": "요청 파라미터 목록이며 각 항목은 location(query/body/header/path)/name/value/type 을 포함합니다(선택, 추가하며 덮어쓰지 않음)",
      "assets.app_icp": "애플리케이션 ICP 등록(선택)",
      "assets.app_name": "애플리케이션 이름(app 타입 필수)",
      "assets.category": "애플리케이션 분류(선택)",
      "assets.bundle_id": "Bundle ID(app 타입 선택)",
      "assets.company_id": "소속 기업 id(app 타입 선택; app 은 scope 로 자동 귀속되지 않으므로 명시적으로 지정해야 합니다. id 는 add_company_scope 가 반환합니다)",
      "assets.open_ports": "열린 포트 목록(ip 타입 선택)",
      "assets.page_title": "페이지 <title> 내용(선택)",
      "assets.description": "애플리케이션 설명(선택)",
      "assets.record_type": "DNS 해석 타입: A/AAAA/CNAME/MX 등(subdomain 선택)",
      "assets.status_code": "HTTP 응답 상태 코드, 예: 200/301/403/404(선택)",
      "assets.favicon_mmh3": "favicon MMH3 해시(선택)",
      "assets.record_value": "DNS 해석 값 목록(subdomain 선택, 예: [\"1.2.3.4\",\"2.3.4.5\"])",
      "assets.service_name": "서비스 이름, 예: ssh/mysql/redis(service 가 비 HTTP 일 때 필수)",
      "assets.technologies": "핑거프린트/기술 스택 목록, 예: [\"Nginx\",\"Vue\",\"Bootstrap\"](선택)",
      "assets.bound_domains": "해당 IP 에 바인딩된 도메인 목록(ip 타입 선택)",
      "assets.content_length": "HTTP 응답 본문 바이트 수(선택)",
    },
  },
  "kill_work": {
    description: "실행 중인 탐색 계획(work) 하나를 종료합니다. 방향이 어긋났거나 무의미한 탐색을 중단할 때 사용합니다. 종료된 탐색 계획은 stopped 로 표시되며 자동으로 다시 배정되지 않습니다. 먼저 get_worker_output 으로 무엇을 하는지 확인한 뒤 결정하세요.",
    params: {
      "intent_id": "종료할 탐색 계획 id(= work 핸들)",
    },
  },
  "list_assets": {
    description: "점검 대상 저장소를 조회합니다. DSL 표현식 검색 또는 id/ids 로 직접 조회하며 페이징을 지원합니다. 【이 작업 및 직접 연관된 작업】의 테스트 범위에 있는 점검 대상만 반환합니다.\nDSL: field=value 부분 일치(ILIKE) | field==value 정확 일치 | field!=value 제외 | 숫자 필드는 > >= < <= 지원 | 단독 단어 = 전체 텍스트 부분 일치; AND/OR 조합(AND 우선순위 높음), 괄호로 그룹화 가능. 점검 대상 타입은 별도 type 파라미터를 사용하며 DSL 에 쓰지 않습니다.\nid/ids 를 전달하지 않으면 dsl 은 반드시 비어 있지 않아야 합니다(조건 없는 전체 조회는 허용되지 않습니다).\n사용 가능 필드: domain(루트/서브/서비스 도메인), root_domain, ip, url, page_title, icp, service_name, app_name, method(예: GET/POST), service_type(http|other), record_type(예: A/CNAME), technology(배열, =부분 일치 ==정확 일치), port/status_code/company_id(정수).\n예: status_code>=400 AND technology=shiro ; (port==80 OR port==443) AND technology=nginx",
    params: {
      "id": "단일 점검 대상 id 로 직접 조회(선택, dsl/type 과 함께 사용할 수 없음)",
      "dsl": "DSL 조회 표현식(문법/필드는 도구 설명 참조). id/ids 를 전달하지 않으면 반드시 비어 있지 않아야 합니다.",
      "ids": "여러 점검 대상 id 로 직접 조회(선택, dsl/type 과 함께 사용할 수 없음)",
      "type": "점검 대상 타입 필터: root_domain|ip|subdomain|app|service|endpoint(별도 필드이며 dsl 과 함께 사용할 수 있습니다; type 만으로는 조회할 수 없고 dsl 이 필요합니다)",
      "limit": "반환 상한, 기본 10(선택)",
      "offset": "페이징 오프셋, 기본 0(선택)",
    },
  },
  "list_companies": {
    description: "점검 대상 저장소의 【기업/회사】와 그 점검 대상 범위(scope), 귀속된 점검 대상 수를 나열합니다. 어떤 회사가 있는지 확인하거나 company_id 를 얻을 때 사용합니다(insert_assets 로 app 을 연결하거나, list_assets 를 company_id 로 필터링할 때 사용). 선택 사항인 search 로 회사명 부분 일치 필터(대소문자 구분 없음)를 적용할 수 있으며, 비워 두면 전체를 반환합니다.",
    params: {
      "search": "회사명 부분 일치 필터(선택, 대소문자 구분 없음); 비워 두면 전체 반환",
    },
  },
  "list_facts": {
    description: "이 작업 및 직접 연관된 작업의 【탐색 사실/결론】을 최신순으로 페이징하여 나열합니다(간략 형식: id+요약+상태, 요약이 너무 길면 잘리며 전체 내용은 node_detail(id) 로 확인). 파라미터는 모두 선택 사항입니다: limit(기본 20, 상한 100), before(커서, 이전 페이지에서 반환된 next_before 를 전달하면 더 오래된 페이지를 가져옵니다; 생략/0 = 최신 페이지), q(요약 키워드로 필터). 반환 {facts, total, has_more, next_before}: total 은 필터 후 전체 개수이며 has_more=true 이면 next_before 로 계속 페이징합니다. 연관 작업 항목에는 source_task_id/inherited=true 가 붙고 읽기 전용입니다. 취약점은 list_findings 를 보세요.",
    params: {
      "q": "사실 요약 키워드로 필터(대소문자 구분 없음); 생략 = 필터 없음",
      "limit": "반환 개수, 기본 20, 상한 100",
      "before": "페이징 커서: id 가 이 값보다 작은 더 오래된 사실만 반환합니다; 생략 또는 0 = 최신 페이지",
    },
  },
  "list_findings": {
    description: "이 작업 및 직접 연관된 작업의 【확인된 취약점】을 나열합니다(간략 형식: id+task_id+intent_id+vulnclass+severity+요약+상태). 연관 작업 항목에는 source_task_id/inherited=true 가 붙고 읽기 전용입니다. 여기에는 취약점만 포함되며, 일반 탐색 사실은 list_facts 를, 상세 내용은 node_detail(id) 를 사용합니다.",
    params: {

    },
  },
  "list_goals": {
    description: "이 작업의 목표 노드와 상태(open/met)를 나열하여 달성 여부를 판단합니다.",
    params: {

    },
  },
  "list_llm_profiles": {
    description: "사용 가능한 LLM 구성(profile)을 나열합니다: id, 이름, 모델, 형식, 현재 활성 구성 여부. id로 spawn_task의 llm_profile_id 파라미터에 하위 작업 전용 LLM을 지정할 수 있습니다(예: 정찰에는 저렴한 모델, 익스플로잇에는 강력한 모델). API Key는 포함하지 않습니다.",
    params: {

    },
  },
  "list_task_findings": {
    description: "지정한 작업의 확인된 취약점(flag/PoC 포함; 각 항목에 id/task_id/intent_id/vulnclass/severity/요약/상태 포함)을 읽습니다. task_id로 작업을 지정합니다.",
    params: {
      "task_id": "작업 id",
    },
  },
  "list_task_worker_traces": {
    description: "지정한 작업에서 실행된 work(탐색 계획)와 각 단계 수를 나열합니다. 어떤 work를 살펴볼 가치가 있는지 파악할 때 사용합니다(이후 get_task_worker_trace 사용).",
    params: {
      "task_id": "작업 id",
    },
  },
  "list_tasks": {
    description: "모든 작업(id/설명/목표/상태/실행 시간/상위 작업/LLM 구성)을 나열합니다. 오케스트레이션 agent가 이를 활용해 전체 상황을 파악하고, 어떤 작업이 너무 오래 정체되어 있는지, 각 작업이 어떤 LLM을 사용하는지 확인합니다. 실행 시간: 실행 중=생성→현재, 종료 상태=생성→마지막 활동(초). llm_profile: 작업의 planner/worker가 사용하는 구성 이름, (활성 구성)=전역 활성 구성을 따름.",
    params: {

    },
  },
  "list_untested_assets": {
    description: "【이 작업 및 직접 연관된 작업】 범위에서 아직 사실 앵커로 커버되지 않은 점검 대상을 조회합니다(연관 범위는 읽기 전용이며, 추가 점검 여부를 스스로 판단하기 위한 참고용으로, 결정을 대신하지 않습니다).\n선택적으로 점검 대상 유형으로 필터링할 수 있습니다: root_domain/subdomain/service/app/endpoint/ip.\n페이지네이션: page는 1부터 시작하고 page_size는 기본 10입니다. 반환: {assets:[{id,type,label}], total, page, page_size}. 작업 컨텍스트에서만 사용할 수 있습니다.",
    params: {
      "page": "페이지 번호, 1부터 시작(기본 1)",
      "type": "점검 대상 유형 필터(선택 사항): root_domain/subdomain/service/app/endpoint/ip",
      "page_size": "페이지당 개수(기본 10)",
    },
  },
  "node_detail": {
    description: "id로 이 작업 또는 직접 연관된 작업의 【탐색 그래프 노드】 전체 내용을 가져옵니다. 상속된 노드는 source_task_id/inherited=true를 가지며 읽기 전용입니다. list_facts/list_findings/graph_overview가 반환한 탐색 노드 id만 지정할 수 있으며, 점검 대상은 list_assets/asset_neighbors를 사용하세요.",
    params: {
      "id": "탐색 그래프 노드 id(점검 대상 id 아님)",
    },
  },
  "pause_task": {
    description: "지정한 작업을 일시 중지합니다(해당 작업의 planner/worker 루프를 중지).",
    params: {
      "task_id": "일시 중지할 작업 id",
    },
  },
  "prove_goal": {
    description: "어떤 발견/사실이 목표 달성을 입증한다고 판단할 때 호출합니다: 증거 노드를 목표 노드에 연결하고 목표를 met로 표시합니다.",
    params: {
      "reason": "이 증거가 해당 목표를 충족하는 이유",
      "goal_id": "목표 노드 id",
      "evidence_id": "그것을 입증하는 발견/사실 노드 id",
    },
  },
  "record_fact": {
    description: "탐색 【사실/결론】을 탐색 그래프에 기록하고, 이를 생성한 탐색 계획(intent_id)에 연결합니다. 지문/열거 등 【긍정 결론】과 '포트 닫힘'/'파라미터 주입 불가'/'로그인 진입점 미발견' 등 【부정 결론】을 포함한 탐색 결과를 기록하는 데 사용합니다.\n⚠️ 한 번의 탐색에서 나온 여러 관찰은 【하나의 사실로 요약】해야 하며, 여러 건으로 쪼개지 마세요. 하나의 사실로 합칠 수 있으면 최대한 하나의 사실로 표현하세요: summary=이번 결론에 대한 요약 한 문장, detail=관련 세부 사항(여러 구체 항목 포함 가능). 예: 지문 탐색 계획→하나의 사실 {summary:'X 사이트의 기술 스택과 응답 특성을 식별함', detail:'nginx 1.25 / Vue3 / 200 / title=.. / body_len=..'}, 상태 코드, 지문, 제목을 각각 한 건씩 기록하는 방식이 아닙니다. 하나의 탐색 계획은 보통 하나의 사실만 생성하며, 너무 잘게 쪼개면 그래프가 무한히 팽창합니다.\n★facts 배열은 서로 다른 결론을 한 번에 여러 건 기록할 때 사용합니다(각 항목에서 intent_id를 생략할 수 있으며, 생략하면 최상위 intent_id를 사용합니다). 반환되는 ids 배열은 facts와 길이가 같고 순서도 같습니다.\n⚠️ 도구 출력에서 【실제로 확인한】 결론만 기록하고, 추측으로 채우지 마세요. evidence와 confidence는 부정확한 결론이 그래프를 오염시키는 것을 방지합니다:\n  · evidence=이 결론을 뒷받침하는 【한 줄】 핵심 증거(명령 + 결론을 가장 잘 입증하는 한두 줄 출력), **반드시 간결하게** 작성하세요 — 세부 사항은 이미 detail에 있으므로 여기에 긴 출력을 다시 붙여 넣지 마세요.\n  · confidence=observed(출력에서 직접 확인) | inferred(현상에 근거해 추론).\n  · **부정 결론**(주입 불가/포트 닫힘/진입점 미발견 등)은 '관찰 + 잠정적 해석'만 기록하세요 — 실제로 무엇을 보았는지 서술하고, 이 방향을 포기할지는 planner가 전체 상황을 종합해 결정합니다. 반드시 evidence를 제공하고, 수단이 소진되지 않았거나 증거가 약한 경우(한 번만 탐색했거나 그렇게 보이는 경우 포함)는 inferred로 표시하며, 확실히 소진했고 직접 확인한 경우에만 observed로 표시하세요.",
    params: {
      "facts": "【서로 다른 결론이 여러 건일 때 사용】 사실 배열이며, 각 요소의 필드는 아래 최상위 필드와 같습니다(summary/detail/evidence/confidence/intent_id/asset_ids). intent_id를 생략하면 최상위 intent_id를 사용합니다. 반환되는 ids는 이 배열과 길이가 같고 순서도 같습니다.",
      "detail": "이 사실의 관련 세부 사항: 이번 탐색에서 나온 여러 관찰을 모두 여기에 작성합니다",
      "summary": "이번 탐색 결론에 대한 【요약 한 문장】(detail을 요약한 내용)",
      "evidence": "【한 줄】 핵심 증거: 명령 + 결론을 가장 잘 입증하는 한두 줄 출력. 반드시 간결하게 작성하고 긴 출력을 붙여 넣지 마세요(세부 사항은 detail에 작성).",
      "asset_ids": "관련 점검 대상 id(선택 사항, 0개/1개/여러 개): 이 사실이 어떤 점검 대상과 관련되는지",
      "intent_id": "이 사실을 생성한 탐색 계획 id(배정받은 탐색 계획이며, 일괄 기록 시 각 항목의 기본값으로 사용)",
      "confidence": "observed(출력에서 직접 확인) | inferred(현상에 근거해 추론). 부정 결론은 반드시 사실대로 표시하세요.",
    },
  },
  "record_finding_retest_result": {
    description: "현재 재검증 세션의 유일한 결론을 저장합니다. 원래 취약점 증거와 보고서는 변경되지 않습니다. 세션이 성공적으로 끝나고 결론이 fixed이면 시스템이 취약점 상태를 자동으로 '수정됨'으로 변경하며, 다른 결론은 기존 상태를 유지합니다. 이번에 실제로 확인한 증거를 반드시 제공해야 하며, 확인할 수 없을 때는 차단 원인을 명시하세요.",
    params: {
      "summary": "이번 재검증 결론 요약",
      "evidence": "Markdown: 이번에 실제로 수행한 단계, 관찰, 대조, 결론 근거를 작성합니다. 확인할 수 없으면 점검한 내용과 차단 원인을 나열합니다",
    },
  },
  "report_finding": {
    description: "확인된 취약점을 기록하며, evidence에 명령 출력, 로그 등 검증 가능한 증거를 제공합니다. 작업 컨텍스트에서는 현재 intent_id를 전달합니다. 반환되는 finding_id는 독립적인 취약점 기록 ID이고, finding_node_id는 탐색 노드 ID입니다(첫 줄에 해당 노드 번호가 유지됩니다).",
    params: {
      "name": "취약점 이름",
      "summary": "발견 요약",
      "evidence": "증거/PoC 텍스트",
      "severity": "critical|high|medium|low",
      "asset_ids": "영향받은 점검 대상 id",
      "intent_id": "현재 작업의 탐색 계획 id",
      "vulnclass": "취약점 분류",
      "traffic_refs": "선택 사항. HTTP/HTTPS 취약점은 먼저 검색하여 요청/응답이 실제로 취약점 결론을 뒷받침하는지 항목별로 확인한 뒤, 재현 순서대로 실제 ID를 기입하세요. TCP 등 비 HTTP 취약점이거나 트래픽을 수집하지 않았거나 정확한 기록을 찾을 수 없으면 생략하거나 []를 전달하세요. 보고는 차단되지 않으며, evidence에 사유를 설명하고 다른 검증 가능한 증거를 제공할 수 있습니다. ID를 추측하거나 도메인/시간으로 연관성을 추정하거나 단지 패킷을 채우기 위해 반복 탐색하지 마세요. 용도: baseline 정상 대조 / proof 취약점 증명 / verification 보충 검증 / supporting 보조 증거.",
      "traffic_refs.note": "해당 트래픽이 취약점 결론을 어떻게 뒷받침하는지",
      "traffic_refs.traffic_id": "traffic_search가 반환한 실제 트래픽 ID",
      "evidence_hint_id": "선택 사항: 이 작업에서 이 취약점에 대응하는 힌트 노드 ID이며, 해당 노드의 구조화된 traffic_refs를 자동으로 함께 가져옵니다. 상속된 힌트나 다른 취약점의 힌트는 참조할 수 없습니다",
    },
  },
  "search_all_worker_traces": {
    description: "【일반적으로 권장하지 않습니다. 시스템이 이미 대부분의 정보를 제공하기 때문입니다】 【이 작업의 다른 work 실행 과정】에서 키워드(q)로 검색합니다 — 특정 worker가 보았지만 fact에 기록하지 않은 것(특정 경로/token/오류 등)을 찾아내는 데 사용합니다. 자신의 탐색 계획에 속한 단계는 자동으로 제외됩니다(해당 내용은 이미 컨텍스트에 있습니다). 일치한 단계의 요약(summary≤100자)만 반환하며, 각 항목에 intent_id가 포함됩니다. 이를 바탕으로 get_worker_trace(intent_id, step_ids=[...])로 전체 내용을 가져오세요.",
    params: {
      "q": "키워드(모든 work 단계의 요약+전체 출력에서 검색)",
      "limit": "반환 최대 개수, 기본 100(선택 사항)",
    },
  },
  "search_task_worker_traces": {
    description: "지정한 작업에서 키워드로 모든 work의 실행 과정을 검색합니다(일치한 단계 요약 + intent_id 반환).",
    params: {
      "q": "검색 키워드",
      "task_id": "작업 id",
    },
  },
  "set_constraints": {
    description: "【이 작업】에 동작 규칙을 새로 추가해 탐색 경계를 정합니다: type=allow(허용되는 작업) 또는 deny(금지되는 작업)입니다.\n규칙=『어떤 작업을 할 수 있고/없는지』에 대한 규정이며(예: 『현재 포트만 점검하고 다른 포트는 스캔하지 않기』, 『운영 DB에 쓰기 작업 금지』, 『수동 정찰만 허용』), 목표도 아니고 공격 단계도 아닙니다.\n★일괄 처리를 우선하세요: 여러 건을 constraints 배열에 넣어 한 번에 제출하면 ids가 배열과 같은 길이·같은 순서로 반환됩니다(실패 항목은 id=0, 자세한 내용은 errors 참조). 단건이면 constraints를 생략하고 최상위 text/type을 바로 지정합니다.\n작업 목표/설명에【명시적으로 적힌】규칙만 등록하고 임의로 만들어 내지 마세요. 유형이 확실하지 않으면 deny(더 보수적)를 사용합니다.",
    params: {
      "text": "[단건] 동작 규칙 한 건의 내용",
      "type": "[단건] allow(허용) 또는 deny(금지)이며, 생략하면 deny로 처리합니다",
      "constraints": "【이것을 우선 사용】새로 추가할 동작 규칙 배열이며 순서대로 처리합니다. 각 요소: text(필수, 규칙 한 건) + type(allow|deny). ids는 이 배열과 같은 길이·같은 순서로 반환됩니다.",
    },
  },
  "set_goals": {
    description: "【이 작업】에 탐색 목표(goal)를 새로 추가합니다. 목표=최종적으로 산출하거나 검증할 수 있는 결과이며, 공격 단계나 정찰 동작이 아닙니다.\n★일괄 처리를 우선하세요: 여러 목표를 goals 배열에 넣어 한 번에 제출하면 ids가 배열과 같은 길이·같은 순서로 반환됩니다(실패 항목은 id=0, 자세한 내용은 errors 참조). 단건이면 goals를 생략하고 최상위 text를 바로 지정합니다.\nvulnclass는 선택 사항입니다: 대응하는 취약점 유형(예: SQLi/IDOR)이며, 비즈니스 로직 유형 목표는 비워 둡니다. 목표 달성 여부는 시스템이 판정해 met로 표시하고, 이 도구는 추가만 담당합니다.",
    params: {
      "text": "[단건] 독립적으로 검증 가능한 최종 목표",
      "goals": "【이것을 우선 사용】새로 추가할 목표 배열이며 순서대로 처리합니다. 각 요소: text(필수, 독립적으로 검증 가능한 최종 목표) + vulnclass(선택). ids는 이 배열과 같은 길이·같은 순서로 반환됩니다.",
      "vulnclass": "[단건] 대응하는 취약점 유형(명확한 경우), 예: SQLi/IDOR. 비즈니스 로직 목표는 비워 둘 수 있습니다",
    },
  },
  "spawn_task": {
    description: "하위 작업을 새로 만들고 탐색 엔진을 시작한 뒤 task_id를 반환합니다. 하나의 일(예: 문제 하나/목표 하나)을 별도 작업으로 분리해 배정할 때 사용합니다. parent_ref는 선택 사항입니다: 현재 오케스트레이션과 연결된 상위 작업 id를 넣어 부모-자식 관계를 만듭니다.",
    params: {
      "goal": "작업 목표(무엇을 달성할지)",
      "parent_ref": "선택 사항: 상위 작업 id(부모-자식 관계 생성)",
      "description": "작업 설명(짧은 제목)",
      "llm_profile_id": "선택 사항: 이 하위 작업의 planner/worker가 사용할 LLM 구성 id(list_llm_profiles 참조). 비워 두면 상위 작업을 상속하고, 그다음 전역 활성 구성을 따릅니다",
      "source_task_ids": "선택 사항: 읽기 전용으로 상속할 원본 작업 id 목록(최대 8개)입니다. 하위 작업은 이 작업들이 이미 확인한 점검 대상/결론을 읽기 전용으로 참조해 시작점으로 삼을 수 있습니다. parent_ref의 순수 부모-자식 포인터와 달리 내용을 상속합니다.",
      "timeout_seconds": "선택 사항: 작업 단위 제한 시간(초)입니다. 시간이 되면 정상 마무리를 트리거하고 timeout 종료 상태로 들어갑니다. 비워 두거나 0이면 시간 제한 없음",
      "seed_first_intent": "선택 사항: 간단한 작업에서 켤 수 있습니다. 생성할 때 시드 탐색 계획 한 건(내용=설명+목표)을 바로 내려보내 worker가 첫 planner를 기다리지 않고 곧바로 테스트를 시작하게 합니다. 기본값 false(표준대로 먼저 계획한 뒤 실행).",
      "plan_heartbeat_seconds": "선택 사항: planner 하트비트 트리거 간격(초)입니다. 직전 계획 라운드 종료/작업 시작 이후 이 값에 도달할 때까지 트리거가 없으면 계획 라운드를 한 번 트리거합니다(교착 상태 방지 + 실행 중인 worker를 깨워 감독). 비워 두거나 0이면 기본 600(10min)입니다.",
    },
  },
  "steer_work": {
    description: "실행 중인 탐색 계획(work) 하나에 교정 지시를 실시간으로 주입합니다. 중단하지 않고 기존 진행 상황도 잃지 않습니다: worker는 다음 동작 전에 지시를 받아 그에 맞게 조정합니다. 'X는 그만두고 Y에 집중' 같은【탐색 계획 내】교정에 사용하며, 방향 자체가 잘못됐다면 kill_work로 바꾼 뒤 새 탐색 계획을 내려보내야 합니다. 먼저 get_worker_output으로 무엇을 하는지 확인하는 것을 권장합니다.",
    params: {
      "message": "worker에게 줄 교정 지시이며, 무엇을 멈추고 무엇으로 전환할지 명확히 지정합니다",
      "intent_id": "교정할 탐색 계획 id(= work 핸들)",
    },
  },
  "traffic_blob": {
    description: "초대형 요청/응답 본문의 원문을 구간별로 읽습니다. traffic_get에서 '…[truncated] @blob sha256:<hash>'로 표시되는 부분이 여기에 저장되어 있으며, 해당 hash를 넘기면 전체 내용을 가져올 수 있습니다. 한 번에 최대 8KB를 반환하고 offset으로 이어서 읽습니다(반환 결과에 전체 길이가 표시됩니다). 백업 파일, 소스코드 유출, 대용량 JSON 내보내기 등 인라인 임계값을 넘는 응답을 훑어볼 때 적합합니다.",
    params: {
      "hash": "traffic_get에서 @blob sha256: 뒤에 오는 64자리 16진수 값",
      "length": "이번에 읽을 바이트 수이며 기본값이자 최댓값은 8192입니다",
      "offset": "시작 바이트 오프셋이며 기본값은 0입니다",
    },
  },
  "traffic_get": {
    description: "id로 이미 수집한 트래픽 한 건의 요청/응답 원문을 가져옵니다(너무 크면 잘립니다). traffic_search와 함께 사용하면 curl을 반복하지 않아도 됩니다.",
    params: {
      "id": "traffic_search가 반환한 id",
    },
  },
  "traffic_search": {
    description: "기록 프록시가 이미 수집한 점검 대상 트래픽을 조회합니다(host를 반드시 지정해야 하며, host만 지정하거나 host:포트 또는 전체 URL을 지원하고 추가로 URL 하위 문자열이나 본문 키워드로 필터링할 수 있습니다). 포트를 지정하면 해당 서비스의 트래픽만 반환해 같은 IP의 다른 포트 트래픽이 섞이지 않게 합니다. body_contains는 이미 수집한 요청/응답 헤더와 본문에서 전체 텍스트 검색을 수행하며 임의의 하위 문자열과 한글(최소 3자)을 지원합니다. 아주 가벼운 색인(id/method/url/status/resp_len)만 반환하고 응답 내용은 포함하지 않습니다. 결과가 비어 있지 않으면 반드시 traffic_get으로 요청/응답을 하나씩 확인하고, 현재 취약점을 실제로 뒷받침하는 ID를 bind_finding_traffic에 넘기세요. 기본적으로 3건만 반환하고 페이지당 최대 10건이며, 결과가 많으면 page로 넘깁니다.",
    params: {
      "host": "host로 필터링합니다(필수. 예: '107.172.96.177', '107.172.96.177:8082' 또는 'http://107.172.96.177:8082/path')",
      "page": "페이지 번호이며 0부터 시작하고 기본값은 0입니다(ts 내림차순으로 페이징)",
      "limit": "페이지당 건수이며 기본값은 3, 최댓값은 10입니다",
      "contains": "URL 하위 문자열 필터(선택. 예: 'api' / 'login')",
      "body_contains": "본문 전체 텍스트 검색(선택, 최소 3자). 요청/응답의 헤더와 본문을 대상으로 하며 예: 'password' / 'root:x:0' / '내부망 테스트'",
    },
  },
  "update_custom_tool": {
    description: "이미 있는 사용자 정의 도구를 key로 수정합니다.",
    params: {
      "key": "수정할 사용자 정의 도구 key",
      "exec": "실행 규격(shell 유형은 필요 없음): command→{command}; script→{code}; http→{method,url,headers,body,proxy,use_recording_proxy}",
      "kind": "shell | command | script(Python만) | http. shell=bash 환경 선언이며 모델에게 이 도구를 bash에서 바로 호출할 수 있다고 알려줄 뿐이고 exec/schema는 필요 없습니다. 나머지 세 가지는 exec를 제공해야 합니다",
      "agents": "연결할 agent key(선택)",
      "schema": "매개변수 JSON-Schema(shell/command/script는 비워 둘 수 있고, http는 필수이며 properties를 포함해야 합니다)",
      "enabled": "사용 여부(기본 true)",
      "deferred": "지연 여부(shell 유형은 무효이며, command/script/http에서 자주 쓰지 않는 도구에만 켭니다)",
      "description": "모델에게 보내는 설명",
    },
  },
  "update_finding_report": {
    description: "이미 등록한 취약점에【상세 보고서】를 작성하거나 갱신합니다(Markdown 전체 텍스트이며 이전 내용을 통째로 덮어씁니다). finding_id에는 report_finding이 반환한 id(\"finding recorded: <id>\"의 숫자)를 넘깁니다. 보고서에는 취약점 개요, 영향과 위험, 재현 절차, 증거/PoC, 수정 권고를 포함하는 것이 좋습니다.",
    params: {
      "report": "상세 보고서 전체 텍스트, Markdown 형식",
      "finding_id": "목표 취약점 id(report_finding이 반환한 id)",
      "evidence_version": "get_finding_traffic이 반환한 증거 version이며, 새 증거 변경을 보고서가 덮어쓰지 않도록 하는 데 사용합니다",
    },
  },
  "update_mcp": {
    description: "이미 있는 MCP 서버를 id로 수정합니다.",
    params: {
      "id": "수정할 MCP 서버 id",
      "env": "환경 변수 {KEY:VALUE}",
      "url": "http/sse의 URL",
      "args": "명령 인수 배열",
      "name": "MCP 서버 이름",
      "command": "stdio의 시작 명령(예: npx)",
      "enabled": "사용 여부(기본 true)",
      "insecure": "http: TLS 인증서 검증을 건너뜁니다(자체 서명 인증서일 때 true로 설정, 기본 false)",
      "transport": "stdio | http / sse",
    },
  },
  "update_skill_file": {
    description: "특정 skill 내부의 파일 하나를 작성하거나 덮어씁니다(기본 SKILL.md). 스킬 내용을 수정하거나 스크립트/참조를 추가할 때 사용합니다.",
    params: {
      "file": "상대 경로(선택, 기본 SKILL.md, 예: scripts/run.py)",
      "name": "skill 이름",
      "content": "파일 전체 내용",
    },
  },
};

type SchemaLike = Record<string, unknown> & {
  properties?: Record<string, Record<string, unknown> & { items?: { properties?: Record<string, Record<string, unknown>> } }>;
};

// localizeToolSchema는 DB에서 온 파라미터 설명 중 아직 한자로 남아 있는 값만 한국어로 바꾼다.
// 구조(이름/타입/필수 여부/기본값)는 건드리지 않는다.
function localizeToolSchema(schema: SchemaLike | undefined, meta: ToolMeta): SchemaLike | undefined {
  if (!schema || !schema.properties) return schema;
  let next: SchemaLike | undefined;
  const ensure = () => {
    if (!next) next = { ...schema, properties: { ...schema.properties } };
    return next;
  };
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (!prop) continue;
    const text = typeof prop.description === 'string' ? prop.description : '';
    const translated = meta.params[name];
    if (translated && HAN.test(text)) {
      ensure().properties![name] = { ...prop, description: translated };
    }
    const subProps = prop.items && prop.items.properties;
    if (subProps) {
      for (const [sub, subProp] of Object.entries(subProps)) {
        if (!subProp) continue;
        const subText = typeof subProp.description === 'string' ? subProp.description : '';
        const subTranslated = meta.params[`${name}.${sub}`];
        if (subTranslated && HAN.test(subText)) {
          const current = ensure().properties![name] as { items?: { properties?: Record<string, Record<string, unknown>> } };
          ensure().properties![name] = {
            ...current,
            items: { ...current.items, properties: { ...(current.items?.properties ?? {}), [sub]: { ...subProp, description: subTranslated } } },
          };
        }
      }
    }
  }
  return next ?? schema;
}

// localizeTool은 시스템 도구 한 건의 표시 문구를 한국어로 바꾼다.
// key/enabled/agents 등 동작에 쓰이는 값은 그대로 둔다.
// 화면 표시용 번역을 붙일 때 원문도 함께 실어 둔다. 편집 화면에서 값을 바꾸지 않고 저장하면
// 저장 경로가 이 원문을 다시 보내 DB의 원본(모델이 보는 문구)을 그대로 유지한다.
export type ToolDisplayOrigin = { description?: string; schema?: SchemaLike };

export function localizeTool<T extends { key: string; description?: string; schema?: SchemaLike }>(tool: T): T {
  const meta = Object.hasOwn(TOOL_META, tool.key) ? TOOL_META[tool.key] : undefined;
  if (!meta) return tool;
  const description = meta.description && HAN.test(tool.description ?? '') ? meta.description : tool.description;
  const schema = localizeToolSchema(tool.schema, meta);
  if (description === tool.description && schema === tool.schema) return tool;
  return { ...tool, description, schema, _original: { description: tool.description, schema: tool.schema } } as unknown as T;
}

export function localizeTools<T extends { key: string; description?: string; schema?: SchemaLike }>(tools: T[]): T[] {
  return tools.map((tool) => localizeTool(tool));
}

// 화면에 한자가 남아 있는지 확인할 때 쓰는 보조 검사(테스트용).
export function hasHanToolText(value: string | undefined | null): boolean {
  return typeof value === 'string' && HAN.test(value);
}
