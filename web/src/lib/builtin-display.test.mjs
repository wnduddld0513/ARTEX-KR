import assert from "node:assert/strict";
import test from "node:test";
import { hasHanToolText, localizeTool } from "./builtin-tools.ts";
import { localizeAssetInterceptRule, localizeInterceptRule, localizeRuleName } from "./builtin-rules.ts";

// 백엔드(DB)가 중국어로 심는 문구는 그대로 두고, 화면 표시용 한국어가 적용되는지 확인한다.
test("system tool description and params localize without mutating the source", () => {
  const source = {
    key: "pause_task",
    description: "暂停指定任务(停止其 planner/worker 循环)。",
    schema: { type: "object", properties: { task_id: { type: "string", description: "要暂停的任务 id" } } },
  };
  const localized = localizeTool(source);
  assert.equal(hasHanToolText(localized.description), false);
  assert.equal(hasHanToolText(localized.schema.properties.task_id.description), false);
  assert.match(localized.schema.properties.task_id.description, /작업/);
  assert.equal(localized.key, "pause_task");
  assert.equal(localized.schema.properties.task_id.type, "string");
  assert.equal(source.description, "暂停指定任务(停止其 planner/worker 循环)。");
  assert.equal(source.schema.properties.task_id.description, "要暂停的任务 id");
});

test("user-edited tool text and unknown tools stay untouched", () => {
  const edited = { key: "pause_task", description: "작업을 일시중지합니다.", schema: { properties: {} } };
  assert.equal(localizeTool(edited), edited);
  const custom = { key: "my_custom_tool", description: "自定义说明", schema: { properties: {} } };
  assert.equal(localizeTool(custom), custom);
});

test("builtin intercept rules localize by original text", () => {
  const rule = localizeInterceptRule({
    id: 1,
    name: "[内置] 递归强制删除 rm -rf",
    message: "禁止删除系统关键路径",
    action: "deny",
  });
  assert.equal(rule.name, "[内置] 재귀 강제 삭제 rm -rf");
  assert.equal(rule.message, "시스템 핵심 경로 삭제를 금지합니다.");
  assert.equal(rule.action, "deny");
  assert.equal(rule.id, 1);
  assert.equal(localizeRuleName("[内置] 用户自定义规则"), "[内置] 用户自定义规则");
  assert.equal(localizeRuleName(undefined), undefined);
});

test("asset intercept rule notes localize only for builtin seeds", () => {
  assert.equal(localizeAssetInterceptRule({ note: "[内置] 政府网站 (.gov)" }).note, "[内置] 정부 사이트 (.gov)");
  const custom = { note: "우리 회사 제외 대상" };
  assert.equal(localizeAssetInterceptRule(custom), custom);
});
