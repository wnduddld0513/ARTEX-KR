import assert from "node:assert/strict";
import test from "node:test";
import { localizeAgentMeta } from "./builtin-agents.ts";
import { localizeAgentDetail } from "./builtin-agents.ts";

test("builtin metadata translates without replacing editable agent content", () => {
  assert.equal(localizeAgentMeta({ key: "goals", builtin: true, name: "目标拆解" }).name, "목표 분석");
  assert.equal(localizeAgentMeta({ key: "retester", builtin: false, name: "漏洞复测" }).name, "취약점 재검증");
  assert.equal(localizeAgentMeta({ key: "reporter", builtin: false, name: "报告撰写" }).name, "보고서 작성");
  assert.equal(localizeAgentMeta({ key: "auto", builtin: true, name: "Auto" }).name, "자동 운영");
  const editedReporter = { key: "reporter", builtin: false, name: "나만의 보고서", description: "사용자 설명" };
  assert.equal(localizeAgentMeta(editedReporter), editedReporter);
  const customized = { key: "retester", builtin: false, name: "我的复测", description: "自定义说明" };
  assert.equal(localizeAgentMeta(customized), customized);
  const custom = { key: "custom", builtin: false, name: "中文名称" };
  assert.equal(localizeAgentMeta(custom), custom);
  const prototype = { key: "constructor", builtin: true, name: "中文名称" };
  assert.equal(localizeAgentMeta(prototype), prototype);
});

test("prompt version notes localize while the prompt body stays original", () => {
  const detail = {
    agent: { key: "planner", builtin: true, name: "规划" },
    variables: [],
    versions: [{ version: 2, ts: "", note: "内置默认", template_text: "中文提示词" }],
  };
  const localized = localizeAgentDetail(detail);
  assert.equal(localized.versions[0].note, "기본 제공값");
  assert.equal(localized.versions[0].template_text, "中文提示词");
  assert.equal(detail.versions[0].note, "内置默认");
  const custom = {
    agent: { key: "planner", builtin: true, name: "플래너", description: "이미 한국어" },
    variables: [],
    versions: [{ version: 1, ts: "", note: "내가 쓴 메모", template_text: "x" }],
  };
  const localizedCustom = localizeAgentDetail(custom);
  assert.equal(localizedCustom.agent.name, "플래너");
  assert.equal(localizedCustom.versions[0].note, "내가 쓴 메모");
});
