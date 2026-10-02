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
    name: "목표 분해기",
    description: "침투 작업 목표를 서로 독립적이고 검증 가능한 하위 목표로 분해합니다.",
  },
  planner: {
    name: "플래너",
    description:
      "상황과 목표 달성 여부를 확인하고, 아직 탐색하지 않은 새 방향이 있을 때 탐색 계획을 보충합니다(작업당 하나의 계획 루프).",
  },
  mainagent: {
    name: "메인 에이전트",
    description: "사용자와 에이전트 간 인터페이스: 진행 상황을 관찰하고 사용자 요청을 힌트 또는 우선순위가 높은 탐색 계획으로 반영합니다.",
  },
  worker: {
    name: "실행 에이전트",
    description: "의도를 하나 받아 실행하고, 발견한 사실·취약점을 지식 그래프에 기록한 뒤 멈춥니다.",
  },
  auto: {
    name: "자동 운영",
    description:
      "플랫폼 운영 도우미: 도구로 작업(생성/조회/일시중지/힌트 제공)과 자산을 관리하고, 스킬·사용자 정의 도구·MCP를 생성·수정할 수 있습니다.",
  },
  pentest: {
    name: "침투 테스트",
    description:
      "독립 침투 에이전트: 정찰→공격면 탐색→취약점 활용→검증→마무리까지 전 과정을 스스로 계획하고 실행하며 결과를 비판적으로 검증합니다.",
  },
  retester: {
    name: "취약점 재검증",
    description: "취약점 상세에서 수동으로 시작해 원 증거를 읽고 독립적인 재검증 결론을 저장합니다.",
  },
};

// 모든 agent에 공통으로 붙는 전역 런타임 변수.
const GLOBAL_VAR_META: Record<string, VarMeta> = {
  Now: {
    description: "서버 현재 시각(실행할 때마다 실시간 갱신, 고정 시작 시각과 빼서 경과 시간을 판단할 수 있음)",
  },
  DataDir: {
    description:
      "서버 데이터 루트 디렉터리(모든 작업/대화 산출물의 루트, 각 agent는 그 아래 하위 디렉터리에 기록, 예: <DataDir>/<taskID>)",
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
    Goal: { description: "작업 총목표", example: "example.com 관리자 권한 획득" },
    AssetSummary: { description: "자산 개수/유형 분포 요약(선택)", example: "domain:3 ip:5 site:2" },
  },
  mainagent: {
    Goal: { description: "현재 작업 목표", example: "example.com 관리자 권한 획득" },
    AssetSummary: { description: "초기 상황 요약(선택)", example: "domain:3 ip:5" },
    FindingsSummary: { description: "확인된 취약점 요약(선택)", example: "high:1 medium:2" },
  },
  worker: {
    ProxyAddr: { description: "트래픽 기록용 프록시 주소(프롬프트의 if 조건으로 안내 문구 선택)", example: "127.0.0.1:8080" },
    WorkerName: { description: "worker 자기 식별(선택)", example: "worker-1" },
  },
};

type AgentLike = { key?: string; name?: string; description?: string; builtin?: boolean };

// localizeAgentMeta는 내장 agent의 이름/설명만 한국어로 바꾼다.
// 한자가 없는 값(이미 번역됐거나 사용자가 바꾼 값)은 그대로 둔다.
export function localizeAgentMeta<T extends AgentLike>(agent: T): T {
  const meta = own(BUILTIN_AGENT_META, agent?.key);
  if (!meta) return agent;
  // retester는 사용자가 수정할 수 있으므로 원래 seed 값과 정확히 같을 때만 옮긴다.
  const retester = agent.key === "retester";
  if (!agent.builtin && !retester) return agent;
  const translateName = retester ? /^漏洞复测$/u.test(agent.name ?? "") : HAN.test(agent.name ?? "");
  const translateDescription = retester
    ? /^从漏洞详情手动启动，读取原证据并保存独立复测结论。$/u.test(agent.description ?? "")
    : HAN.test(agent.description ?? "");
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
export function localizeAgentDetail<T extends { agent: Agent; variables?: PromptVar[] }>(detail: T): T {
  const agent = localizeAgentMeta(detail.agent);
  const variables = localizePromptVars(detail.agent?.key, detail.variables ?? []);
  if (agent === detail.agent && variables === detail.variables) return detail;
  return { ...detail, agent, variables };
}
