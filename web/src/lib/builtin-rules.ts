// 백엔드가 DB에 심는 내장 차단 규칙/점검 제외 대상의 원문을 화면 표시용 한국어로 바꾼다.
//
// DB 값(=에이전트가 보는 값)은 원본 저장소 그대로 두고, 화면에 그릴 때만 이 표를 쓴다.
// 표에 없는 문구(사용자가 만든 규칙, 사용자가 고친 이름)는 그대로 돌려준다.
const HAN = /\p{Script=Han}/u;

// 원문 규칙 이름 → 한국어 표시 이름.
const RULE_NAMES: Record<string, string> = {
  "[内置] 递归强制删除 rm -rf": "[内置] 재귀 강제 삭제 rm -rf",
  "[内置] 删除系统关键目录": "[内置] 시스템 핵심 디렉터리 삭제",
  "[内置] 磁盘格式化 mkfs": "[内置] 디스크 포맷 mkfs",
  "[内置] 覆写磁盘设备 dd": "[内置] 디스크 장치 덮어쓰기 dd",
  "[内置] Fork 炸弹": "[内置] Fork 폭탄",
  "[内置] 关机 / 重启": "[内置] 종료 / 재부팅",
  "[内置] 杀死全部进程": "[内置] 모든 프로세스 종료",
  "[内置] 磁盘擦除 shred / wipe": "[内置] 디스크 지우기 shred / wipe",
  "[内置] 清空防火墙规则": "[内置] 방화벽 규칙 비우기",
  "[内置] 破坏性系统命令": "[内置] 파괴적 시스템 명령",
  "[内置] curl / wget 发送 DELETE 请求": "[内置] curl / wget DELETE 요청 전송",
  "[内置] Python HTTP 客户端 DELETE（requests/httpx/aiohttp）": "[内置] Python HTTP 클라이언트 DELETE (requests/httpx/aiohttp)",
  "[内置] 脚本中声明 HTTP DELETE 方法（JS/通用）": "[内置] 스크립트에서 HTTP DELETE 메서드 선언 (JS/일반)",
  "[内置] 批量清空 / 清除接口路径": "[内置] 대량 비우기 / 제거 API 경로",
  "[内置] 数据外泄管道": "[内置] 데이터 유출 파이프",
  "[内置] 删除类接口路径": "[内置] 삭제 계열 API 경로",
};

// 원문 규칙 안내 문구 → 한국어 표시 문구.
const RULE_MESSAGES: Record<string, string> = {
  "禁止执行递归强制删除（rm -rf / rm --recursive），可能永久损坏系统或靶机环境": "재귀 강제 삭제(rm -rf / rm --recursive)를 금지합니다. 시스템이나 대상 환경이 영구적으로 손상될 수 있습니다.",
  "禁止删除系统关键路径": "시스템 핵심 경로 삭제를 금지합니다.",
  "禁止格式化磁盘（mkfs）": "디스크 포맷(mkfs)을 금지합니다.",
  "禁止使用 dd 覆写磁盘设备": "dd로 디스크 장치를 덮어쓰는 것을 금지합니다.",
  "禁止执行 Fork 炸弹": "Fork 폭탄 실행을 금지합니다.",
  "禁止执行关机或重启命令": "종료 또는 재부팅 명령 실행을 금지합니다.",
  "禁止 kill -9 -1 或 killall -9（杀死所有进程）": "kill -9 -1 또는 killall -9(모든 프로세스 종료) 실행을 금지합니다.",
  "禁止对磁盘设备执行 shred/wipe 擦除": "디스크 장치에 shred/wipe 지우기를 실행하는 것을 금지합니다.",
  "禁止清空防火墙规则（iptables -F / nft flush）": "방화벽 규칙 비우기(iptables -F / nft flush)를 금지합니다.",
  "破坏性命令被拒绝（rm -rf / / mkfs / dd / fork bomb / 关机重启 / 覆写磁盘设备）": "파괴적 명령이 거부되었습니다(rm -rf / / mkfs / dd / fork bomb / 종료·재부팅 / 디스크 장치 덮어쓰기).",
  "禁止执行 DROP 操作，可能不可逆地销毁数据库对象": "DROP 작업 실행을 금지합니다. 데이터베이스 객체가 되돌릴 수 없이 삭제될 수 있습니다.",
  "禁止执行 TRUNCATE，可能清空数据表所有数据": "TRUNCATE 실행을 금지합니다. 데이터 테이블의 모든 데이터가 비워질 수 있습니다.",
  "禁止执行 MongoDB drop 操作": "MongoDB drop 작업 실행을 금지합니다.",
  "禁止执行 Redis FLUSHALL / FLUSHDB，可能清空全部缓存数据": "Redis FLUSHALL / FLUSHDB 실행을 금지합니다. 전체 캐시 데이터가 비워질 수 있습니다.",
  "禁止通过 curl/wget 发送 HTTP DELETE 请求，可能删除目标系统数据": "curl/wget으로 HTTP DELETE 요청 전송을 금지합니다. 대상 시스템 데이터가 삭제될 수 있습니다.",
  "禁止使用 Python HTTP 客户端发送 DELETE 请求": "Python HTTP 클라이언트로 DELETE 요청 전송을 금지합니다.",
  "禁止在脚本中声明并发送 HTTP DELETE 请求": "스크립트에서 HTTP DELETE 요청을 선언하고 전송하는 것을 금지합니다.",
  "禁止调用批量清空或销毁类接口（/clear /wipe /flush /purge 等）": "대량 비우기 또는 삭제 계열 API(/clear /wipe /flush /purge 등) 호출을 금지합니다.",
  "疑似数据外泄管道被拒绝（命令输出经 curl/wget/nc 外传）": "데이터 유출 파이프로 의심되어 거부되었습니다(명령 출력이 curl/wget/nc로 외부 전송).",
  "禁止调用删除类接口（/delete /remove /unlink /erase 等），不论使用哪种 HTTP 方法——多数应用的删除接口用 GET/POST 就能触发，同样会真实删除目标数据": "삭제 계열 API(/delete /remove /unlink /erase 등) 호출을 금지합니다. 사용하는 HTTP 메서드와 무관하게, 대부분 애플리케이션의 삭제 API는 GET/POST로도 트리거되어 대상 데이터를 실제로 삭제합니다.",
};

// 점검 제외 대상(자산 차단) 기본 규칙의 원문 설명 → 한국어 표시 설명.
const ASSET_RULE_NOTES: Record<string, string> = {
  "[内置] 政府网站 (.gov)": "[内置] 정부 사이트 (.gov)",
  "[内置] 政府网站 (.gov.cn)": "[内置] 정부 사이트 (.gov.cn)",
  "[内置] 教育网站 (.edu)": "[内置] 교육 기관 사이트 (.edu)",
  "[内置] 教育网站 (.edu.cn)": "[内置] 교육 기관 사이트 (.edu.cn)",
};

function mapText(table: Record<string, string>, value: string | undefined | null): string | undefined {
  if (typeof value !== 'string' || !value) return value ?? undefined;
  const hit = Object.hasOwn(table, value) ? table[value] : undefined;
  return hit ?? value;
}

// 차단 규칙 이름(승인 기록의 스냅샷 이름 포함)을 한국어로 바꾼다.
export function localizeRuleName(value: string | undefined | null): string | undefined {
  return mapText(RULE_NAMES, value);
}

// 차단 규칙 안내 문구를 한국어로 바꾼다.
export function localizeRuleMessage(value: string | undefined | null): string | undefined {
  return mapText(RULE_MESSAGES, value);
}

// 점검 제외 대상 규칙 설명을 한국어로 바꾼다.
export function localizeAssetRuleNote(value: string | undefined | null): string | undefined {
  return mapText(ASSET_RULE_NOTES, value);
}

// 차단 규칙 한 건의 표시 문구를 바꾼다(원본 필드·식별자는 그대로 유지).
// 화면 표시용 번역을 붙일 때 원문도 함께 실어 둔다. 편집 화면에서 값을 바꾸지 않고 저장하면
// 저장 경로가 이 원문을 다시 보내 DB의 원본(모델이 보는 문구)을 그대로 유지한다.
export function localizeInterceptRule<T extends { name?: string; message?: string }>(rule: T): T {
  const name = localizeRuleName(rule.name);
  const message = localizeRuleMessage(rule.message);
  if (name === rule.name && message === rule.message) return rule;
  return { ...rule, name: name ?? rule.name, message: message ?? rule.message, _original: { name: rule.name, message: rule.message } } as T;
}

// 점검 제외 대상 규칙 한 건의 표시 문구를 바꾼다.
export function localizeAssetInterceptRule<T extends { note?: string }>(rule: T): T {
  const note = localizeAssetRuleNote(rule.note);
  if (note === rule.note) return rule;
  return { ...rule, note: note ?? rule.note, _original: { note: rule.note } } as T;
}

export function localizeInterceptRules<T extends { name?: string; message?: string }>(rules: T[]): T[] {
  return rules.map((rule) => localizeInterceptRule(rule));
}

export function localizeAssetInterceptRules<T extends { note?: string }>(rules: T[]): T[] {
  return rules.map((rule) => localizeAssetInterceptRule(rule));
}

// 화면에 한자가 남아 있는지 확인할 때 쓰는 보조 검사(테스트용).
export function hasHanText(value: string | undefined | null): boolean {
  return typeof value === 'string' && HAN.test(value);
}
