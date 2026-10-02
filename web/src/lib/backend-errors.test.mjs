import assert from "node:assert/strict";
import test from "node:test";
import { isArchiveMissingError, localizeBackendError } from "./backend-errors.ts";

test("backend errors translate fixed text and preserve diagnostic details", () => {
  assert.equal(localizeBackendError("未授权"), "인증이 필요합니다");
  assert.equal(localizeBackendError("任务正在删除，无法发送新消息"), "작업을 삭제하는 중이라 새 메시지를 보낼 수 없습니다");
  assert.equal(localizeBackendError("保存失败: connection refused"), "저장 실패: connection refused");
  assert.equal(localizeBackendError("关联任务 #42 不存在"), "연결 작업 #42을(를) 찾을 수 없습니다");
  assert.equal(localizeBackendError("upstream: custom diagnostic"), "upstream: custom diagnostic");
  assert.equal(localizeBackendError(""), "");
  for (const key of ["__proto__", "constructor", "toString"]) assert.equal(localizeBackendError(key), key);
});

test("archive restoration detects original and localized missing responses", () => {
  assert.equal(isArchiveMissingError("归档不存在"), true);
  assert.equal(isArchiveMissingError(localizeBackendError("归档不存在")), true);
  assert.equal(isArchiveMissingError("아카이브 복원 진행 중"), false);
});

test("Object.prototype keys are not treated as mapped messages", () => {
  for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    assert.equal(localizeBackendError(key), key);
  }
});
