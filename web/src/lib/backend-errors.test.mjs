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

test("update stream messages translate while retaining filenames and diagnostics", () => {
  assert.equal(localizeBackendError("校验 SHA256…"), "SHA256으로 파일을 검증하는 중…");
  assert.equal(localizeBackendError("下载中 3 MB / 9 MB"), "다운로드 중: 3 MB / 9 MB");
  assert.equal(localizeBackendError("下载 artex.zip（9 MB）…"), "artex.zip 다운로드 중(9 MB)…");
  assert.equal(localizeBackendError("仓库 wnduddld0513/ARTEX-KR 尚未发布任何正式版本"), "wnduddld0513/ARTEX-KR 저장소에 아직 정식 릴리스가 없습니다");
  assert.equal(localizeBackendError("落盘失败: disk full"), "파일을 저장하지 못했습니다: disk full");
});

test("Object.prototype keys are not treated as mapped messages", () => {
  for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    assert.equal(localizeBackendError(key), key);
  }
});
