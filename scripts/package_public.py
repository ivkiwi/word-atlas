#!/usr/bin/env python3
"""Export the public repository from a strict allowlist and scan every file.

    python3 scripts/package_public.py --out /tmp/word-atlas-public

Never reads .local/, environment files or credential stores, except that it may
compare file contents against secrets passed via ATLAS_SECRET_FILES so that an
exact leaked key is caught. Matched content is never printed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT_MARKER = ".word-atlas-export"
EXPORT_OWNER = b"word-atlas-public-export\n"
TOP = {
    "README.md", "README.en.md", "LICENSE", "CONTENT_LICENSE.md", "CONTRIBUTING.md", "SECURITY.md",
    ".gitignore", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "index.html",
}
SCRIPTS = {"check-atlas.mjs", "check-russian-ui.mjs", "render-cards.mjs", "record-demo.mjs", "package_public.py"}
ATLAS_SCRIPTS = {"common.py", "gen_text.py", "gen_images.py", "gen_brand.py", "gen_word_audio.py", "gen_sentence_audio.py", "gen_sfx.py", "gen_galaxy_audio.sh", "fix_blocked.py", "build_atlas.py", "build_ru.py", "test_build_ru.py", "build_sfx.py"}
TEXT = {".ts", ".tsx", ".css", ".svg", ".md", ".json", ".jsonl", ".mjs", ".js", ".py", ".html", ".csv", ".yml", ".webmanifest", ""}
PATTERNS = {
    "API credential pattern": re.compile(rb"\b(?:sk[_-][A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|xi-[A-Za-z0-9]{20,})\b"),
    "private home path": re.compile(rb"(?:/Users/|/home/)[A-Za-z0-9_.-]+/|[A-Za-z]:\\Users\\"),
    "private key material": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "credential in URL": re.compile(rb"https?://[^/\s:@]+:[^/\s@]{4,}@"),
    # Assembled at runtime so this file does not match its own pattern.
    "private dataset marker": re.compile("|".join(["private-ielts" + "-atlas", "/local" + "/media/", r"\.local" + "/media-map"]).encode()),
}


def allowed(rel: Path) -> bool:
    p = rel.parts
    name = rel.as_posix()
    if any(x in {".local", ".git", "node_modules", "dist", "output", "__pycache__", ".claude", ".playwright-cli"} or x.startswith(".env") for x in p):
        return False
    if len(p) == 1:
        return name in TOP
    if p[0] == "src":
        return rel.suffix in {".ts", ".tsx", ".css", ".svg"}
    if p[0] == "scripts":
        return (len(p) == 2 and p[1] in SCRIPTS) or (len(p) == 3 and p[1] == "atlas" and p[2] in ATLAS_SCRIPTS)
    if p[0] == "docs":
        return (len(p) == 2 and rel.suffix == ".md") or (len(p) == 3 and p[1] == "assets" and rel.suffix in {".jpg", ".png", ".gif", ".webp", ".mp4"})
    if p[0] == "data":
        return (len(p) == 2 and p[1] in {"word-atlas.json", "word-atlas.csv", "word-atlas.ru.json", "word-atlas.ru.csv", "README.md"}) or (len(p) == 3 and p[1] == "ru" and re.fullmatch(r"part-\d{2}\.jsonl", p[2]) is not None)
    if name in {".github/workflows/check.yml", ".github/workflows/pages.yml"}:
        return True
    if p[0] == "public":
        inner = p[1:]
        if len(inner) == 1:
            return inner[0] in {"favicon.svg", "manifest.webmanifest", "icon-512.png", "robots.txt", "sw.js"}
        if inner[0] == "sfx":
            return len(inner) == 2 and rel.suffix == ".mp3"
        if inner[0] == "brand":
            return len(inner) == 2 and rel.suffix in {".webp", ".jpg"}
        if inner[0] == "atlas":
            sub = inner[1:]
            if sub == ("index.json",):
                return True
            if len(sub) == 2 and sub[0] == "entries":
                return re.fullmatch(r"\d+\.json", sub[1]) is not None
            if len(sub) == 2 and sub[0] in {"img", "thumb"}:
                return rel.suffix == ".webp"
            if len(sub) == 3 and sub[0] == "audio" and sub[1] in {"uk", "us", "ex", "ex2"}:
                return rel.suffix == ".mp3"
    return False


def secrets() -> list[bytes]:
    out = []
    for f in filter(None, os.environ.get("ATLAS_SECRET_FILES", "").split(os.pathsep)):
        for line in Path(f).read_text(errors="ignore").splitlines():
            v = line.split("=", 1)[-1].strip()
            if len(v) >= 16 and not v.startswith("http"):
                out.append(v.encode())
    return out


def self_test() -> int:
    import tempfile
    import unittest
    from unittest.mock import patch

    class ExportSafetyTest(unittest.TestCase):
        def setUp(self):
            tmp = tempfile.TemporaryDirectory(prefix="wa-store-export-")
            self.addCleanup(tmp.cleanup)
            self.base = Path(tmp.name).resolve()
            self.root = self.base / "project"
            self.root.mkdir()
            (self.root / "README.md").write_text("public source")
            root_patch = patch.dict(globals(), ROOT=self.root)
            root_patch.start()
            self.addCleanup(root_patch.stop)
            env_patch = patch.dict(os.environ, ATLAS_SECRET_FILES="")
            env_patch.start()
            self.addCleanup(env_patch.stop)

        def test_rejects_project_ancestors_and_descendants(self):
            sibling = self.base / "sibling.txt"
            sibling.write_text("keep sibling")
            (self.base / "PUBLIC_MANIFEST.json").write_text("{}")
            for out in (self.base, self.root, self.root / "export"):
                with self.subTest(out=out.name):
                    self.assertEqual(main(["--out", str(out)]), 2)
                    self.assertEqual((self.root / "README.md").read_text(), "public source")
                    self.assertEqual(sibling.read_text(), "keep sibling")

        def test_rejects_unrelated_nonempty_directory(self):
            out = self.base / "unrelated"
            out.mkdir()
            (out / ".git").mkdir()
            (out / "important.txt").write_text("keep file")
            self.assertEqual(main(["--out", str(out)]), 2)
            self.assertEqual((out / "important.txt").read_text(), "keep file")

        def test_resolves_symlink_before_checking_ancestors(self):
            alias = self.base / "ancestor-link"
            alias.symlink_to(self.base, target_is_directory=True)
            self.assertEqual(main(["--out", str(alias)]), 2)
            self.assertTrue((self.root / "README.md").is_file())

        def test_exports_new_empty_and_previous_export_directories(self):
            for name in ("new", "empty"):
                with self.subTest(name=name):
                    out = self.base / name
                    if name == "empty":
                        out.mkdir()
                    self.assertEqual(main(["--out", str(out)]), 0)
                    self.assertEqual((out / "README.md").read_text(), "public source")
                    self.assertEqual(json.loads((out / "PUBLIC_MANIFEST.json").read_text())["files"], 1)
                    (out / ".git").mkdir()
                    (out / ".git" / "sentinel").write_text("keep git")
                    (out / "old.txt").write_text("old export")
                    self.assertEqual(main(["--out", str(out)]), 0)
                    self.assertFalse((out / "old.txt").exists())
                    self.assertEqual((out / ".git" / "sentinel").read_text(), "keep git")

        def test_scan_failure_can_retry_in_the_same_new_or_previous_export(self):
            for previous in (False, True):
                with self.subTest(previous=previous):
                    out = self.base / ("previous-failed" if previous else "new-failed")
                    if previous:
                        self.assertEqual(main(["--out", str(out)]), 0)
                        (out / ".git").mkdir()
                        (out / ".git" / "sentinel").write_text("keep git")
                    blocked = self.root / "LICENSE"
                    blocked.write_text("sk-" + "x" * 24)
                    self.assertEqual(main(["--out", str(out)]), 1)
                    self.assertTrue((out / "README.md").is_file())
                    self.assertFalse((out / "LICENSE").exists())
                    if previous:
                        self.assertEqual((out / ".git" / "sentinel").read_text(), "keep git")
                    blocked.write_text("public license")
                    self.assertEqual(main(["--out", str(out)]), 0)
                    self.assertEqual((out / "LICENSE").read_text(), "public license")
                    manifest = json.loads((out / "PUBLIC_MANIFEST.json").read_text())
                    self.assertEqual({item["path"] for item in manifest["items"]}, {"README.md", "LICENSE"})
                    if previous:
                        self.assertEqual((out / ".git" / "sentinel").read_text(), "keep git")

        def test_ownership_marker_cannot_bypass_path_safety(self):
            (self.base / EXPORT_MARKER).write_bytes(EXPORT_OWNER)
            self.assertEqual(main(["--out", str(self.base)]), 2)
            self.assertEqual((self.root / "README.md").read_text(), "public source")
            out = self.base / "unrelated-marker"
            out.mkdir()
            (out / "important.txt").write_text("keep file")
            marker = out / EXPORT_MARKER
            marker.write_text("not an export")
            self.assertEqual(main(["--out", str(out)]), 2)
            self.assertEqual((out / "important.txt").read_text(), "keep file")
            marker.unlink()
            outside = self.base / "outside.txt"
            outside.write_text("keep outside")
            marker.symlink_to(outside)
            (out / "PUBLIC_MANIFEST.json").write_text("{}")
            self.assertEqual(main(["--out", str(out)]), 2)
            self.assertEqual(outside.read_text(), "keep outside")
            self.assertEqual((out / "important.txt").read_text(), "keep file")

    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(ExportSafetyTest))
    return 0 if result.wasSuccessful() else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    action = ap.add_mutually_exclusive_group(required=True)
    action.add_argument("--out")
    action.add_argument("--self-test", action="store_true")
    a = ap.parse_args(argv)
    if a.self_test:
        return self_test()
    out = Path(a.out).resolve()
    if out == ROOT or ROOT in out.parents or out in ROOT.parents:
        print("refusing to export inside the project or over a project ancestor")
        return 2
    marker = out / EXPORT_MARKER
    if marker.is_symlink():
        print("refusing a symlinked export marker")
        return 2
    owned = marker.is_file() and marker.read_bytes() == EXPORT_OWNER
    if out.exists() and (not out.is_dir() or (any(out.iterdir()) and not (out / "PUBLIC_MANIFEST.json").is_file() and not owned)):
        print("refusing to replace a non-empty directory without an export manifest or ownership marker")
        return 2
    keep_git = (out / ".git").exists()
    out.mkdir(parents=True, exist_ok=True)
    # shortcut: rebuild in place with a retry marker; stage exports if atomic publication is needed.
    marker.write_bytes(EXPORT_OWNER)
    for child in out.iterdir():
        if child.name in {".git", EXPORT_MARKER}:
            continue
        shutil.rmtree(child) if child.is_dir() else child.unlink()
    exact = secrets()
    files, problems, total = [], [], 0
    for path in sorted(ROOT.rglob("*")):
        if path.is_symlink():
            continue
        rel = path.relative_to(ROOT)
        if not path.is_file() or not allowed(rel):
            continue
        data = path.read_bytes()
        if path.suffix in TEXT:
            hits = [label for label, rx in PATTERNS.items() if rx.search(data)]
            if any(s in data for s in exact):
                hits.append("exact secret match")
            if hits:
                problems.append(f"{rel}: {', '.join(hits)}")
                continue
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(data)
        files.append({"path": rel.as_posix(), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        total += len(data)
    if problems:
        print("blocked files:\n  " + "\n  ".join(problems))
        return 1
    (out / "PUBLIC_MANIFEST.json").write_text(json.dumps({"files": len(files), "bytes": total, "items": files}, indent=0))
    print(json.dumps({"out": out.name, "files": len(files), "megabytes": round(total / 1e6, 1), "kept_git": keep_git}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
