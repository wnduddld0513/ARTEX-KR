import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const files = ["README.md", "README.ko.md", "CHANGELOG.md"];
const agentFiles = [];
function collect(directory, output = files) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file, output);
    else if (file.endsWith(".md")) output.push(file);
  }
}
// Agent instructions under skills/ use English; user documentation uses Korean.
for (const directory of ["docs", "sidequestion"]) collect(directory);
collect("skills", agentFiles);
const failures = [];
for (const file of [...files, ...agentFiles]) {
  const agentDoc = agentFiles.includes(file);
  let inCode = false;
  fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(`{3,}|~{3,})/.test(line)) { inCode = !inCode; return; }
    if (inCode) return;
    // Original identifiers and URLs in examples/links remain verbatim.
    const prose = line.replace(/`[^`]*`/g, "").replace(/\]\([^)]*\)/g, "]");
    const unexpected = agentDoc ? /[\p{Script=Han}\p{Script=Hangul}]/u : /\p{Script=Han}/u;
    if (unexpected.test(prose)) failures.push(`${file}:${i + 1}: ${line.slice(0, 180)}`);
  });
}
if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`문서 언어 검사 실패: ${failures.length}개 줄`);
  process.exitCode = 1;
} else {
  console.log(`한국어 문서 검사 통과: ${files.length}개 문서`);
  console.log(`영어 에이전트 문서 검사 통과: ${agentFiles.length}개 문서`);
}
