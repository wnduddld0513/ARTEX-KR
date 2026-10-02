export const mentionKinds = [
  { kind: "finding", label: "취약점", alias: "finding", legacy: "漏洞" },
  { kind: "asset", label: "점검 대상", alias: "asset", legacy: "资产" },
  { kind: "company", label: "기업", alias: "company", legacy: "企业" },
  { kind: "endpoint", label: "API", alias: "api", legacy: "接口" },
  { kind: "ip", label: "IP", alias: "ip", legacy: "IP" },
  { kind: "app", label: "애플리케이션", alias: "app", legacy: "应用" },
  { kind: "root_domain", label: "도메인", alias: "domain", legacy: "域名" },
  { kind: "subdomain", label: "하위 도메인", alias: "subdomain", legacy: "子域名" },
  { kind: "service", label: "서비스", alias: "service", legacy: "服务" },
] as const;

export type MentionKind = (typeof mentionKinds)[number]["kind"];
export interface ChatMention {
  kind: MentionKind;
  id: number;
  label: string;
  description: string;
}

export function activeMention(value: string, caret: number) {
  const before = value.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start < 0 || (start > 0 && /[\w.+/-]/.test(before[start - 1]))) return null;
  const query = before.slice(start + 1);
  if (/[[\]\r\n@]/.test(query) || query.length > 220) return null;
  return { start, end: caret, query };
}

export function mentionSearch(query: string) {
  const text = query.trimStart().toLowerCase();
  for (const item of mentionKinds) {
    for (const alias of [item.label.toLowerCase(), item.alias, item.legacy, ...(item.kind === "asset" ? ["자산"] : [])]) {
      if (text === alias || text.startsWith(`${alias} `) || (/[^a-z]/.test(alias) && text.startsWith(alias))) {
        return { kind: item.kind, query: query.trimStart().slice(alias.length).trim(), categories: [] };
      }
    }
  }
  const categories = mentionKinds.filter(
    (item) => item.label.toLowerCase().startsWith(text) || item.alias.startsWith(text) || item.legacy.startsWith(text),
  );
  return { kind: "" as const, query: query.trim(), categories };
}

export function mentionToken(item: ChatMention) {
  const kind = mentionKinds.find((entry) => entry.kind === item.kind)?.label ?? "점검 대상";
  const label = item.label
    .replace(/[[\]]/g, (char) => (char === "[" ? "（" : "）"))
    .replace(/\s+/g, " ")
    .slice(0, 100);
  return `@[${kind}#${item.id} ${label}]`;
}

export function selectedMentions(value: string) {
  return [...value.matchAll(/@\[(취약점|점검 대상|자산|기업|API|IP|애플리케이션|도메인|하위 도메인|서비스|漏洞|资产|企业|接口|应用|域名|子域名|服务)#([0-9]+)(?: ([^\]\r\n]*))?\]/g)].map(
    (match) => ({
      token: match[0],
      label: `${mentionKinds.find((item) => item.label === match[1] || item.legacy === match[1] || (item.kind === "asset" && match[1] === "자산"))?.label ?? match[1]} #${match[2]}${match[3] ? ` · ${match[3]}` : ""}`,
      start: match.index,
    }),
  );
}
