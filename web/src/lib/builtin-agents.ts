// 실 백엔드(db/db.go, server/finding_retests.go)는 내장 agent의 이름/설명과 프롬프트 변수
// 카탈로그를 중국어로 seed 한다. 표시 직전에 여기서 한국어 메타데이터로 바꾼다.
//
// 원칙:
// - 읽기 전용 내장 에이전트만 번역한다. 수정 가능한 retester는 원래 seed 값과 정확히 같을 때만 번역한다.
//   사용자 지정 이름/설명과 이미 한국어로 바뀐 값은 그대로 둔다.
// - 실행에 쓰이는 프롬프트 본문(template_text)·도구 스키마·도구 설명은 번역하지 않는다.
//   여기서 다루는 것은 화면 표시용 메타데이터(이름/설명/변수 설명·예시)뿐이다.

import type { Agent, PromptVar } from "@/lib/types";

const HAN = /\p{Script=Han}/u;

type AgentMeta = { name: string; description: string };
type VarMeta = { description: string; example?: string };

// 표에서 own property만 조회한다. agent key나 변수명이 Object.prototype 상속 키
// ("__proto__", "constructor" 등)와 겹쳐도 엉뚱한 항목을 집어오지 않게 하기 위함이다.
function own<T>(table: Record<string, T>, key: string | undefined): T | undefined {
  if (!key || !Object.hasOwn(table, key)) return undefined;
  return table[key];
}

// 시스템이 seed 하는 내장 에이전트 메타데이터(키 기준).
const BUILTIN_AGENT_META: Record<string, AgentMeta> = {
  goals: {
    name: "목표 분석",
    description: "침투 테스트 목표를 각각 검증할 수 있는 세부 목표로 나눕니다.",
  },
  planner: {
    name: "플래너",
    description:
      "진행 상황과 목표 달성 여부를 확인하고, 아직 확인하지 않은 접근 방법을 탐색 계획에 추가합니다.",
  },
  mainagent: {
    name: "메인 에이전트",
    description: "진행 상황을 사용자에게 알리고, 사용자 요청을 탐색에 참고할 정보나 우선 처리할 계획으로 전달합니다.",
  },
  worker: {
    name: "실행 에이전트",
    description: "탐색 계획 하나를 실행하고, 확인한 사실과 취약점을 지식 그래프에 기록합니다.",
  },
  auto: {
    name: "자동 운영",
    description:
      "작업 생성·조회·일시중지와 점검 대상 관리를 돕습니다. 탐색에 참고할 정보를 전달하고 스킬, 사용자 정의 도구, MCP를 만들거나 수정할 수 있습니다.",
  },
  pentest: {
    name: "침투 테스트",
    description:
      "독립 침투 에이전트: 정찰→공격면 탐색→취약점 활용→검증→마무리까지 전 과정을 스스로 계획하고 실행하며 결과를 비판적으로 검증합니다.",
  },
  retester: {
    name: "취약점 재검증",
    description: "취약점 상세 화면에서 실행하면 기존 증거를 확인하고, 별도로 재검증한 결과를 저장합니다.",
  },
  reporter: {
    name: "보고서 작성",
    description:
      "취약점이 발견되면 자동으로 실행되어 증거와 실행 과정을 확인하고, Markdown 상세 보고서를 작성해 해당 취약점에 저장합니다.",
  },
};

// 백엔드가 seed 하는 원래 이름(원문). 이름이 이 값과 정확히 같을 때만 번역한다.
const SEED_NAMES: Record<string, string> = {
  goals: "目标拆解",
  planner: "规划",
  mainagent: "主",
  worker: "执行",
  auto: "Auto",
  pentest: "渗透测试",
  reporter: "报告撰写",
  retester: "漏洞复测",
};

// 사용자가 이름/설명을 바꿀 수 있는 시드 agent(원문 설명). 시드 값과 다르면 사용자 지정으로 본다.
const SEEDED_EDITABLE_DESCRIPTIONS: Record<string, string> = {
  retester: "从漏洞详情手动启动，读取原证据并保存独立复测结论。",
  reporter: "漏洞详细报告撰写：发现漏洞时自动触发，查取证据与执行过程后写 Markdown 报告并回写。",
};

// 모든 agent에 공통으로 붙는 전역 런타임 변수.
const GLOBAL_VAR_META: Record<string, VarMeta> = {
  Now: {
    description: "서버 현재 시각(실행할 때마다 실시간 갱신, 고정 시작 시각과 빼서 경과 시간을 판단할 수 있음)",
  },
  DataDir: {
    description:
      "서버 데이터 루트 디렉터리(모든 작업/대화 산출물의 루트, 각 에이전트는 그 아래 하위 디렉터리에 기록, 예: <DataDir>/<taskID>)",
  },
};

// 내장 agent의 프롬프트 변수 카탈로그(키 → 변수명).
const BUILTIN_VAR_META: Record<string, Record<string, VarMeta>> = {
  goals: {
    EngagementDescription: {
      description: "작업 설명(테스트 대상/배경)",
      example: "example.com 사이트 테스트",
    },
  },
  planner: {
    Goal: { description: "작업 전체 목표", example: "example.com 관리자 권한 획득" },
    AssetSummary: { description: "점검 대상 개수/유형 분포 요약(선택)", example: "domain:3 ip:5 site:2" },
  },
  mainagent: {
    Goal: { description: "현재 작업 목표", example: "example.com 관리자 권한 획득" },
    AssetSummary: { description: "초기 상황 요약(선택)", example: "domain:3 ip:5" },
    FindingsSummary: { description: "확인된 취약점 요약(선택)", example: "high:1 medium:2" },
  },
  worker: {
    ProxyAddr: { description: "트래픽 기록용 프록시 주소(프롬프트의 if 조건으로 안내 문구 선택)", example: "127.0.0.1:8080" },
    WorkerName: { description: "워커 식별 이름(선택)", example: "worker-1" },
  },
};

type AgentLike = { key?: string; name?: string; description?: string; builtin?: boolean };

// localizeAgentMeta는 내장 agent의 이름/설명만 한국어로 바꾼다.
// 한자가 없는 값(이미 번역됐거나 사용자가 바꾼 값)은 그대로 둔다.
export function localizeAgentMeta<T extends AgentLike>(agent: T): T {
  const meta = own(BUILTIN_AGENT_META, agent?.key);
  if (!meta) return agent;
  // 사용자가 수정할 수 있는 시드 agent(retester/reporter)는 원래 seed 값과 정확히 같을 때만 옮긴다.
  const editableSeed = own(SEEDED_EDITABLE_DESCRIPTIONS, agent.key);
  if (!agent.builtin && editableSeed === undefined) return agent;
  const seedName = own(SEED_NAMES, agent.key);
  // 읽기 전용 내장 agent는 원래 이름 그대로일 때만(라틴 시드 이름 포함), 편집 가능한
  // 시드 agent는 시드 이름과 시드 설명이 그대로일 때만 번역한다.
  const translateName =
    editableSeed === undefined ? HAN.test(agent.name ?? "") || agent.name === seedName : agent.name === seedName;
  const translateDescription =
    editableSeed === undefined ? HAN.test(agent.description ?? "") : agent.description === editableSeed;
  const name = translateName ? meta.name : agent.name;
  const description = translateDescription ? meta.description : agent.description;
  if (name === agent.name && description === agent.description) return agent;
  return { ...agent, name, description } as T;
}

export function localizeAgentMetas<T extends AgentLike>(agents: T[]): T[] {
  return agents.map((agent) => localizeAgentMeta(agent));
}

// localizePromptVars는 내장 agent 카탈로그와 전역 변수의 설명/예시만 한국어로 바꾼다.
// 사용자 정의 agent의 변수는 건드리지 않는다.
export function localizePromptVars<T extends { name: string; description?: string; example?: string }>(
  agentKey: string | undefined,
  vars: T[],
): T[] {
  return vars.map((item) => {
    const meta = own(own(BUILTIN_VAR_META, agentKey) ?? {}, item.name) ?? own(GLOBAL_VAR_META, item.name);
    if (!meta) return item;
    const description = item.description && HAN.test(item.description) ? meta.description : item.description;
    const example = meta.example !== undefined && item.example && HAN.test(item.example) ? meta.example : item.example;
    if (description === item.description && example === item.example) return item;
    return { ...item, description, example };
  });
}

// localizeAgentDetail은 상세 응답의 agent 메타데이터와 변수 목록을 함께 변환한다.
// prompt / versions.template_text 등 실행에 쓰이는 본문은 그대로 둔다.
// 프롬프트 버전 메모는 백엔드가 심는 표시용 라벨이라 화면에서만 한국어로 바꾼다.
const PROMPT_VERSION_NOTES: Record<string, string> = {
  内置默认: "기본 제공값",
  恢复为内置默认: "기본 제공값으로 복원",
};

export function localizeAgentDetail<
  T extends { agent: Agent; variables?: PromptVar[]; versions?: Array<{ note?: string }> },
>(detail: T): T {
  const agent = localizeAgentMeta(detail.agent);
  const variables = localizePromptVars(detail.agent?.key, detail.variables ?? []);
  let versions = detail.versions;
  if (detail.versions) {
    const source = detail.versions;
    const mapped = source.map((ver) => {
      const note = own(PROMPT_VERSION_NOTES, ver.note);
      return !note || note === ver.note ? ver : { ...ver, note };
    });
    if (mapped.some((ver, index) => ver !== source[index])) versions = mapped as T["versions"];
  }
  if (agent === detail.agent && variables === detail.variables && versions === detail.versions) return detail;
  return { ...detail, agent, variables, versions };
}
