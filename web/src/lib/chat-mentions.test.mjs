import assert from "node:assert/strict";
import test from "node:test";
import { activeMention, mentionSearch, mentionToken, selectedMentions } from "./chat-mentions.ts";

test("mention trigger supports Chinese and cursor placement without hijacking email", () => {
  assert.equal(activeMention("user@example.com", 16), null);
  assert.equal(activeMention("已选 @[漏洞#1 X]", 12), null);
  assert.deepEqual(activeMention("查看@漏洞 后面的文字", 5), { start: 2, end: 5, query: "漏洞" });
  assert.equal(activeMention("@漏洞\n下一行", 8), null);
});

test("categories, Chinese aliases, IP and keyword search", () => {
  assert.equal(mentionSearch("").categories.length, 9);
  assert.equal(mentionSearch("漏").categories[0].kind, "finding");
  assert.equal(mentionSearch("漏洞").kind, "finding");
  assert.equal(mentionSearch("漏洞SQL注入").query, "SQL注入");
  assert.equal(mentionSearch("ip 192.0.2.1").kind, "ip");
  assert.equal(mentionSearch("接口 GET /api").query, "GET /api");
  assert.equal(mentionSearch("acme.com").kind, "");
});

test("tokens roundtrip labels and removing one reference preserves its neighbors", () => {
  const first = mentionToken({ kind: "finding", id: 12, label: "标题[1]\n描述" });
  const second = mentionToken({ kind: "ip", id: 13, label: "192.0.2.1" });
  const value = `分析 ${first} 和 ${second}`;
  const selected = selectedMentions(value);
  assert.equal(selected.length, 2);
  assert.equal(selected[0].label, "취약점 #12 · 标题（1） 描述");
  const next = value.slice(0, selected[0].start) + value.slice(selected[0].start + selected[0].token.length);
  assert.equal(selectedMentions(next)[0].token, second);
});

test("Korean search and tokens preserve references and legacy history", () => {
  const value = "확인 @취약점";
  assert.deepEqual(activeMention(value, value.length), { start: 3, end: value.length, query: "취약점" });
  assert.equal(mentionSearch("취약점 SQL").kind, "finding");
  assert.equal(mentionSearch("취약점 SQL").query, "SQL");
  assert.equal(mentionSearch("하위 도메인 example.com").kind, "subdomain");
  const token = mentionToken({ kind: "finding", id: 12, label: "검증 대상" });
  assert.equal(token, "@[취약점#12 검증 대상]");
  assert.equal(selectedMentions(token)[0].label, "취약점 #12 · 검증 대상");
  assert.equal(selectedMentions("@[漏洞#12 기존 기록]")[0].label, "취약점 #12 · 기존 기록");
  assert.equal(mentionSearch("점검 대상 example.com").kind, "asset");
  assert.equal(mentionSearch("자산 example.com").kind, "asset");
  const assetToken = mentionToken({ kind: "asset", id: 7, label: "example.com" });
  assert.equal(assetToken, "@[점검 대상#7 example.com]");
  assert.equal(selectedMentions(assetToken)[0].label, "점검 대상 #7 · example.com");
  assert.equal(selectedMentions("@[자산#7 기존 기록]")[0].label, "점검 대상 #7 · 기존 기록");
  assert.equal(selectedMentions("@[资产#7 기존 기록]")[0].label, "점검 대상 #7 · 기존 기록");
});
