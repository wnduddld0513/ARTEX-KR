import assert from "node:assert/strict";
import test from "node:test";
import { localizeAgentMeta } from "./builtin-agents.ts";

test("builtin metadata translates without replacing editable agent content", () => {
  assert.equal(localizeAgentMeta({ key: "goals", builtin: true, name: "目标拆解" }).name, "목표 분해기");
  assert.equal(localizeAgentMeta({ key: "retester", builtin: false, name: "漏洞复测" }).name, "취약점 재검증");
  const customized = { key: "retester", builtin: false, name: "我的复测", description: "自定义说明" };
  assert.equal(localizeAgentMeta(customized), customized);
  const custom = { key: "custom", builtin: false, name: "中文名称" };
  assert.equal(localizeAgentMeta(custom), custom);
  const prototype = { key: "constructor", builtin: true, name: "中文名称" };
  assert.equal(localizeAgentMeta(prototype), prototype);
});
