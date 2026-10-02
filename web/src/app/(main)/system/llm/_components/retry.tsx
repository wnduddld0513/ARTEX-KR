"use client";

// LLM 重试配置的共用件：五层重试各自的「次数 + 间隔」。
//
// 五层从内到外：建连(SDK) → 空响应(SDK) → 同 provider 安全窗口 → 轮询熔断 → 意图重跑。
// 前三层跟着端点走，所以每个模型配置都能覆盖全局默认；后两层是进程级的，只有全局一份。
//
// 所有输入都遵循同一套「留空 = 不配置」语义，与后端 db.RetryRule 一致：
//   次数   空/0 = 用内置默认 | -1 = 关闭这层重试 | >0 = 用这个次数
//   间隔   空/0 = 用这层原本的指数退避 | >0 = 改用这个固定毫秒间隔

import * as React from "react";

import { Loader2Icon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { LLMRetryOverride, LLMRetryPolicy, LLMRetryRule } from "@/lib/types";

export const ZERO_RULE: LLMRetryRule = { attempts: 0, interval_ms: 0 };
export const ZERO_OVERRIDE: LLMRetryOverride = {
  connect: ZERO_RULE,
  empty: ZERO_RULE,
  stream: ZERO_RULE,
};
const ZERO_POLICY: LLMRetryPolicy = {
  ...ZERO_OVERRIDE,
  breaker: ZERO_RULE,
  intent: ZERO_RULE,
};

type LayerMeta = {
  title: string;
  /** 这层重试发生在哪、由谁执行 */
  where: string;
  /** 什么样的错误会走到这层——具体到状态码，别让人猜 */
  trigger: string;
  /** 长得像但【不】走这层的错误，省得填了没反应还以为是 bug */
  skips?: string;
  desc: string;
  attemptsLabel: string;
  /** 次数留空时的默认值，用于占位符 */
  defAttempts: number;
  /** 间隔留空时的默认策略，用于占位符 */
  defInterval: string;
  /** 次数填 -1 的含义 */
  offHint: string;
};

export const RETRY_LAYERS = {
  connect: {
    title: "연결 재시도",
    where: "SDK · 200 응답을 받기 전",
    trigger:
      "연결되지 않거나 아직 200을 받지 못한 경우: 연결 리셋 / 읽기·쓰기 타임아웃 / DNS 실패 등 네트워크 계층 오류, 그리고 HTTP 408, 429, 500, 502, 503, 504.",
    skips: "나머지 상태 코드(400 / 401 / 403 / 404 / 413 / 422 등)는 재시도해도 결과가 달라지지 않는 거부이므로 그대로 상위 계층으로 전달합니다.",
    desc: "같은 요청을 그대로 다시 보냅니다. 스트림이 시작된 뒤(200을 받은 뒤) 중간에 끊기면 이 계층이 처리하지 않습니다.",
    attemptsLabel: "재시도 횟수",
    defAttempts: 3,
    defInterval: "0.5s→1s→2s 지수(최대 8s)",
    offHint: "-1 = 재시도하지 않고 실패 시 즉시 상위로 전달",
  },
  empty: {
    title: "빈 응답 재시도",
    where: "SDK · openai 형식만",
    trigger:
      "HTTP 200에 finish_reason이 정상 stop인데 응답 전체에 콘텐츠 블록이 하나도 없는 경우입니다. 게이트웨이 빈 프레임, 사고 필드 누락, 샘플링 오류가 모두 이렇게 나타납니다.",
    skips: "max_tokens로 잘려서 내용이 없는 경우는 해당하지 않습니다(그건 출력 상한을 올려야 해결되며, 재전송하면 같은 결과만 반복됩니다).",
    desc: "전체 프롬프트를 다시 보내므로 컨텍스트가 길면 비용이 큽니다. 횟수는 크게 잡지 마세요.",
    attemptsLabel: "재시도 횟수",
    defAttempts: 2,
    defInterval: "0.5s→1s→2s 지수(최대 8s)",
    offHint: "-1 = 빈 응답을 그대로 전달",
  },
  stream: {
    title: "동일 제공자 안전 구간 재시도",
    where: "ARTEX 자체 · 출력 전달 전",
    trigger:
      "스트림이 열린 뒤(200 수신)에만 문제가 생긴 경우: 연결 중간 끊김, 제공자 과부하, 스트림 내 429 / 5xx 오류 이벤트 — 그리고 아직 호출자에게 전달된 토큰이 하나도 없을 때.",
    skips:
      "할당량 소진(402 / insufficient_quota, 순환 호출이 설정 교체를 담당), 컨텍스트 초과(413 / context length, 압축 담당), 400 / 401 / 403 / 404 / 422처럼 재시도해도 달라지지 않는 거부는 모두 재시도하지 않습니다.",
    desc: "같은 설정에서 같은 요청을 다시 보냅니다. 아직 출력을 전달하지 않았으므로 다시 보내도 모델 출력이나 도구 실행이 중복되지 않습니다.",
    attemptsLabel: "재시도 횟수",
    defAttempts: 2,
    defInterval: "0.5s→1s 지수(최대 4s)",
    offHint: "-1 = 스트림이 끊기면 바로 상위 탐색 계획 재실행으로 전달",
  },
  breaker: {
    title: "순환 호출 차단",
    where: "ARTEX 자체 · 프로세스 단위, 전역 1개",
    trigger:
      "일시적 실패(429, 5xx, 네트워크 오류)가 연속으로 임계치에 도달하면 차단합니다. 잔액 부족(402), 키 만료(401 / 403), 모델 없음(404)처럼 재시도해도 달라지지 않는 실패는 임계치와 무관하게 첫 번째에 바로 차단합니다.",
    skips: "한 번 성공하면 카운트가 초기화되므로 간헐적으로 불안정한 설정이 누적되어 차단되는 일은 없습니다.",
    desc: "차단되면 쿨다운에 들어가고, 쿨다운 동안 순환 호출에서 이 설정을 건너뜁니다. 상태는 DB에 저장되어 재시작해도 유지됩니다.",
    attemptsLabel: "연속 실패 몇 회에 차단",
    defAttempts: 3,
    defInterval: "1min→5min→30min 단계",
    offHint: "-1 = 일시적 실패는 절대 차단하지 않음(재시도해도 달라지지 않는 실패는 차단)",
  },
  intent: {
    title: "탐색 계획 재실행",
    where: "ARTEX 자체 · 프로세스 단위, 전역 1개",
    trigger:
      "앞의 계층들이 모두 처리하지 못한 경우입니다. 실행 에이전트(worker)가 model_error로 끝난 상황, 즉 내부 재시도를 모두 소진했거나 스트림이 출력을 전달하기 시작한 뒤 끊긴 경우입니다(그때는 다시 보내는 것이 안전하지 않아 전체를 다시 실행해야 합니다).",
    skips: "할당량 소진은 순환 호출이 설정을 교체해 처리하므로 여기서 다시 실행하지 않습니다. 작업이 일시중지 / 종료 / 마무리 단계에 들어가면 즉시 실행을 양보하고 백오프 시간을 차지하지 않습니다.",
    desc: "탐색 계획 전체를 처음부터 다시 실행합니다. 가장 바깥 계층이므로 한 번 재실행하면 안쪽 계층들의 횟수가 다시 곱해집니다.",
    attemptsLabel: "재실행 횟수",
    defAttempts: 2,
    defInterval: "고정 3s",
    offHint: "-1 = 재실행하지 않고 해당 탐색 계획을 바로 실행 오류 상태로 처리",
  },
} satisfies Record<string, LayerMeta>;

type LayerKey = keyof typeof RETRY_LAYERS;

/** 毫秒的人话，只用于在输入框旁边回显，免得数零。 */
function humanMs(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(2))}s`;
  return `${Number((ms / 60_000).toFixed(2))}min`;
}

/** 受控数字输入：空串 ↔ 0，中间态（"-"、"1e"）原样留在本地，不打扰父级。 */
function NumField({
  id,
  value,
  onChange,
  placeholder,
  min,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  placeholder: string;
  min: number;
}) {
  const [text, setText] = React.useState(value === 0 ? "" : String(value));
  // 父级换了一整套值（读取到策略、切换配置）时跟上；自己敲字时不会走到这里，
  // 因为那时 value 已经等于本地文本 parse 后的结果。
  React.useEffect(() => {
    const incoming = value === 0 ? "" : String(value);
    setText((cur) => (Number(cur || 0) === value ? cur : incoming));
  }, [value]);
  return (
    <Input
      id={id}
      type="number"
      min={min}
      className="w-28 shrink-0"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        onChange(e.target.value.trim() === "" || !Number.isFinite(n) ? 0 : Math.trunc(n));
      }}
    />
  );
}

/** 一层重试的两个旋钮。idPrefix 用来在同一页出现多次时保住 label 的 htmlFor。 */
export function RetryRuleFields({
  layer,
  idPrefix,
  value,
  onChange,
  compact,
}: {
  layer: LayerKey;
  idPrefix: string;
  value: LLMRetryRule;
  onChange: (r: LLMRetryRule) => void;
  /** true = 配置抽屉里的紧凑版：省掉展开说明，只留「什么错误会走到这层」这一句 */
  compact?: boolean;
}) {
  const meta = RETRY_LAYERS[layer];
  const human = humanMs(value.interval_ms);
  return (
    <div className={compact ? "grid gap-2" : "grid gap-3 rounded-lg border p-3"}>
      <div className="grid gap-0.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <Label className="text-sm">{meta.title}</Label>
          <span className="text-muted-foreground text-xs">{meta.where}</span>
        </div>
        {/* 哪些错误会走到这层，具体到状态码——填了旋钮却看不到效果，多半是错误压根不落在这层。 */}
        <p className="text-muted-foreground text-xs">
          <span className="font-medium text-foreground">트리거</span>:{meta.trigger}
        </p>
        {!compact && meta.skips && (
          <p className="text-muted-foreground text-xs">
            <span className="font-medium text-foreground">이 계층을 타지 않는 오류</span>:{meta.skips}
          </p>
        )}
        {!compact && <p className="text-muted-foreground text-xs">{meta.desc}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${layer}-n`} className="text-muted-foreground text-xs">
            {meta.attemptsLabel}
          </Label>
          <NumField
            id={`${idPrefix}-${layer}-n`}
            min={-1}
            value={value.attempts}
            placeholder={`기본 ${meta.defAttempts}`}
            onChange={(n) => onChange({ ...value, attempts: n })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${layer}-ms`} className="text-muted-foreground text-xs">
            간격 ms
          </Label>
          <NumField
            id={`${idPrefix}-${layer}-ms`}
            min={0}
            value={value.interval_ms}
            placeholder="기본 백오프"
            onChange={(n) => onChange({ ...value, interval_ms: n })}
          />
          <span className="text-muted-foreground text-xs">{human ? `고정 ${human}` : meta.defInterval}</span>
        </div>
      </div>
      {!compact && <p className="text-muted-foreground text-xs">비워두면 기본값을 사용합니다. {meta.offHint}</p>}
    </div>
  );
}

/** 模型配置抽屉里的三层覆盖（跟着端点走的那三层）。 */
export function ProfileRetryFields({
  value,
  onChange,
}: {
  value: LLMRetryOverride;
  onChange: (o: LLMRetryOverride) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="grid gap-0.5">
        <Label className="text-sm">재시도 재정의</Label>
        <p className="text-muted-foreground text-xs">
          이 설정에만 적용되며 '재시도와 백오프'의 전역 기본값을 덮어씁니다. 각 칸을 비우면 전역 설정을 따르고, 횟수에 -1을 넣으면 이 계층 재시도를 끄고, 간격을 채우면 고정 간격으로 지수 백오프를 대체합니다. 차단과 탐색 계획 재실행은 프로세스 단위라 전역 페이지에서만 조정할 수 있습니다.
        </p>
      </div>
      {(["connect", "empty", "stream"] as const).map((k) => (
        <div key={k} className="border-t pt-3 first:border-t-0 first:pt-0">
          <RetryRuleFields
            compact
            layer={k}
            idPrefix="pf"
            value={value[k]}
            onChange={(r) => onChange({ ...value, [k]: r })}
          />
        </div>
      ))}
    </div>
  );
}

/** 「重试与退避」tab：五层的全局默认值。 */
export function RetryPolicyPanel() {
  const [policy, setPolicy] = React.useState<LLMRetryPolicy>(ZERO_POLICY);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const p = await api.llmRetryPolicy();
      setPolicy({ ...ZERO_POLICY, ...p });
    } catch (e) {
      toast.error(`재시도 정책을 불러오지 못했습니다: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      // 后端会把越界值夹回区间并回传，直接用回传值刷新，所见即所存。
      const saved = await api.saveLLMRetryPolicy(policy);
      setPolicy({ ...ZERO_POLICY, ...saved });
      toast.success("저장되어 즉시 적용됩니다(실행 중인 이번 호출은 이전 파라미터를 계속 사용)");
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const set = (k: LayerKey) => (r: LLMRetryRule) => setPolicy((p) => ({ ...p, [k]: r }));

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-10 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" /> 재시도 정책 불러오는 중…
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-muted-foreground text-xs leading-relaxed">
        모델 호출 실패는 안쪽에서 바깥쪽으로 다섯 계층의 재시도를 거칩니다:
        <span className="text-foreground"> 연결 → 빈 응답 → 동일 제공자 안전 구간 → 순환 호출 차단 → 탐색 계획 재실행</span>
        . 안쪽을 모두 소진해야 바깥 계층으로 넘어가므로 횟수는{" "}
        <span className="text-foreground">곱해집니다</span>{" "}
         — 각 계층을 모두 최대로 올리면 일시적 장애 한 번에 수십 건의 요청이 소모될 수 있습니다. 모두 비워두면 현재 기본값이 적용되며, 이 페이지가 없던 때와 동작이 완전히 같습니다. 앞의 세 계층은 각 모델 설정에서 개별적으로 재정의할 수 있습니다.
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(RETRY_LAYERS) as LayerKey[]).map((k) => (
          <RetryRuleFields key={k} layer={k} idPrefix="gl" value={policy[k]} onChange={set(k)} />
        ))}
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          저장
        </Button>
        <Button variant="outline" onClick={() => setPolicy(ZERO_POLICY)} disabled={saving}>
          모두 기본값으로 복원
        </Button>
      </div>
    </div>
  );
}
