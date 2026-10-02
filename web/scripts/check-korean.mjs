import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const untranslated = [];
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { scan(file); continue; }
    if (!/\.[jt]sx?$/.test(file) || file.includes(".test.")) continue;
    // These modules intentionally keep original backend strings for exact matching
    // (error mapping, chat history tokens, DB seed metadata), so they are skipped here.
    if (["backend-errors.ts", "chat-mentions.ts", "builtin-agents.ts", "builtin-rules.ts"].includes(entry.name)) continue;
    const source = fs.readFileSync(file, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
        const text = ts.isJsxText(node) ? node.getText(ast).trim() : node.text;
        if (/\p{Script=Han}/u.test(text) || /^zh-(?:CN|TW)$/i.test(text)) {
          const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
          untranslated.push(`${path.relative(root, file)}:${line + 1}: ${text.replace(/\s+/g, " ").slice(0, 160)}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
}
scan(root);
if (untranslated.length) {
  console.error(untranslated.join("\n"));
  console.error(`미번역 문자열: ${untranslated.length}개`);
  process.exitCode = 1;
} else {
  console.log("한국어 UI 검사 통과: 중국어 문자열이 없습니다.");
}
