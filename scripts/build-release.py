"""Build and package all ARTEX release targets with their embedded Korean UI."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
import platform
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parent.parent
TARGETS = (("linux", "amd64"), ("linux", "arm64"), ("darwin", "amd64"),
           ("darwin", "arm64"), ("windows", "amd64"))


def run(command, **kwargs):
    return subprocess.run(command, check=True, **kwargs)


def add_file(archive, source, name, executable=False):
    info = zipfile.ZipInfo.from_file(source, name)
    info.create_system = 3
    info.external_attr = (0o100755 if executable else 0o100644) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    data = source.read_bytes()
    if source.suffix == ".sh":
        data = data.replace(b"\r\n", b"\n")
    elif source.suffix == ".bat":
        data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    archive.writestr(info, data)


def build_target(target, args, metadata):
    goos, goarch = target
    folder = f"artex-{args.version}-{goos}-{goarch}"
    binary_name = "artex.exe" if goos == "windows" else "artex"
    destination = args.output / f"{folder}.zip"
    if destination.exists():
        raise FileExistsError(f"배포 파일이 이미 있습니다: {destination}")
    with tempfile.TemporaryDirectory(prefix=f"build-{goos}-{goarch}-", dir=args.output) as temporary:
        binary = Path(temporary) / binary_name
        environment = {**os.environ, "CGO_ENABLED": "0", "GOOS": goos, "GOARCH": goarch}
        print(f"[{goos}/{goarch}] 빌드 시작", flush=True)
        run([args.go, "build", "-tags", "embedui", "-trimpath", "-ldflags",
             f"-s -w -buildid= -X main.version={args.version}", "-o", str(binary), "./cmd/artex"],
            cwd=ROOT, env=environment)
        target_metadata = {**metadata, "os": goos, "arch": goarch}
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            add_file(archive, binary, f"{folder}/{binary_name}", executable=True)
            starter = ROOT / ("start.bat" if goos == "windows" else "start.sh")
            add_file(archive, starter, f"{folder}/{starter.name}", executable=goos != "windows")
            if goos == "windows":
                for name in ("launcher.bat", "launcher.ps1"):
                    add_file(archive, ROOT / "scripts/windows-launcher" / name, f"{folder}/{name}")
                add_file(archive, ROOT / "scripts/windows-launcher/README.md", f"{folder}/실행-도우미.md")
            for name in ("README.md", "README.ko.md", "CHANGELOG.md", "LICENSE", "config.example.json"):
                add_file(archive, ROOT / name, f"{folder}/{name}")
            # Package only repository files, excluding local dependencies and caches.
            tracked = subprocess.check_output(
                ["git", "ls-files", "-z", "skills", "sidequestion", "docs"], cwd=ROOT
            ).decode("utf-8").split("\0")
            for relative in sorted(filter(None, tracked)):
                source = ROOT / relative
                add_file(archive, source, f"{folder}/{relative}", executable=source.suffix == ".sh")
            archive.writestr(f"{folder}/BUILD.json", json.dumps(target_metadata, ensure_ascii=False, indent=2) + "\n")
        # Check the actual archive, including executable permissions and platform metadata.
        with zipfile.ZipFile(destination) as archive:
            if archive.testzip() is not None:
                raise ValueError(f"압축 파일 검증 실패: {destination}")
            info = archive.getinfo(f"{folder}/{binary_name}")
            if not (info.external_attr >> 16) & 0o111:
                raise ValueError(f"실행 권한이 없습니다: {destination}")
            binary_bytes = archive.read(info)
            if binary_bytes[:4] != {"linux": b"\x7fELF", "darwin": b"\xcf\xfa\xed\xfe", "windows": b"MZ\x90\x00"}[goos]:
                raise ValueError(f"실행 파일 형식이 올바르지 않습니다: {destination}")
            if goos == "linux":
                machine = int.from_bytes(binary_bytes[18:20], "little")
                expected_machine = {"amd64": 62, "arm64": 183}[goarch]
            elif goos == "darwin":
                machine = int.from_bytes(binary_bytes[4:8], "little")
                expected_machine = {"amd64": 0x01000007, "arm64": 0x0100000C}[goarch]
            else:
                pe_offset = int.from_bytes(binary_bytes[60:64], "little")
                machine = int.from_bytes(binary_bytes[pe_offset + 4:pe_offset + 6], "little")
                expected_machine = 0x8664
            if machine != expected_machine:
                raise ValueError(f"실행 파일 아키텍처가 올바르지 않습니다: {destination}")
            native_os = {"win32": "windows", "darwin": "darwin", "linux": "linux"}.get(sys.platform)
            native_arch = {"amd64": "amd64", "x86_64": "amd64", "arm64": "arm64", "aarch64": "arm64"}.get(platform.machine().lower())
            if (goos, goarch) == (native_os, native_arch):
                # Run the packaged executable only on its matching host platform.
                extracted = Path(temporary) / ("packaged-artex.exe" if goos == "windows" else "packaged-artex")
                extracted.write_bytes(binary_bytes)
                extracted.chmod(0o755)
                run([str(extracted), "-h"], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        print(f"[{goos}/{goarch}] 빌드·패키지 검증 완료 ({destination.stat().st_size:,} bytes)", flush=True)
        return {**target_metadata, "file": destination.name, "sha256": digest,
                "size": destination.stat().st_size}


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="한국어 UI를 포함한 Linux·macOS·Windows 배포 파일을 빌드합니다.")
    parser.add_argument("--version", required=True, help="버전 번호 (예: 0.3.15)")
    parser.add_argument("--go", default=shutil.which("go"), help="Go 실행 파일 경로")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    parser.add_argument("--skip-frontend", action="store_true", help="검증된 server/webui/dist를 재사용합니다")
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    args.version = args.version.removeprefix("v")
    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        parser.error("자동 업데이트를 지원하려면 세 자리 버전 번호가 필요합니다")
    if not args.go:
        parser.error("Go 실행 파일을 찾지 못했습니다. PATH에 추가하거나 --go로 지정하세요")
    args.go = str(Path(args.go).resolve())
    if args.jobs < 1:
        parser.error("--jobs는 1 이상이어야 합니다")
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    if not args.skip_frontend:
        node = shutil.which("node")
        if not node or not (ROOT / "web/node_modules/next/dist/bin/next").exists():
            parser.error("Node.js와 프런트엔드 의존성이 필요합니다. web에서 npm ci를 먼저 실행하세요")
        run([node, "scripts/build-static.mjs"], cwd=ROOT / "web",
            env={**os.environ, "NEXT_PUBLIC_MOCK": "0"})
        embedded = ROOT / "server/webui/dist"
        if embedded.exists():
            # This fixed directory is exclusively generated frontend output.
            shutil.rmtree(embedded)
        shutil.copytree(ROOT / "web/out", embedded)
    if not (ROOT / "server/webui/dist/index.html").exists():
        parser.error("내장할 프런트엔드 빌드 결과가 없습니다")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    metadata = {"version": args.version, "commit": commit,
                "built_at": datetime.now(timezone.utc).isoformat(), "ui_language": "ko",
                "agent_docs_language": "upstream-original",
                "go": subprocess.check_output([args.go, "version"], text=True).strip()}
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        outputs = list(pool.map(lambda target: build_target(target, args, metadata), TARGETS))
    (args.output / "SHA256SUMS").write_text("".join(f"{x['sha256']}  {x['file']}\n" for x in outputs), encoding="utf-8")
    (args.output / "build-manifest.json").write_text(json.dumps(outputs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"배포 파일 {len(outputs)}개와 SHA256SUMS를 저장했습니다: {args.output}")


if __name__ == "__main__":
    main()
