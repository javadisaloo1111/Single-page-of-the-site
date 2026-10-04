#!/usr/bin/env python3
"""Create a clean, installable Chrome Extension source archive."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "VocaType-Chrome-Extension.zip"
ARCHIVE_ROOT = "vocatyp-extension"
FILES = [
    "manifest.json",
    "background.js",
    "content.js",
    "shared.js",
    "offscreen.html",
    "offscreen.js",
    "webspeech-engine.js",
    "popup.html",
    "popup.css",
    "popup.js",
    "options.html",
    "options.css",
    "options.js",
    "README.md",
    "LICENSE",
    "package.json",
    "scripts/check-extension.mjs",
    "scripts/package-extension.py",
    "tests/manifest.test.mjs",
    "tests/text-processing.test.mjs",
    "tests/voice-commands.test.mjs",
    "tests/webspeech-engine.test.mjs",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
]

for relative in FILES:
    path = (ROOT / relative).resolve()
    if ROOT not in path.parents or not path.is_file():
        raise SystemExit(f"Required package file is missing or outside the project: {relative}")
if any(Path(name).name == ".env" for name in FILES):
    raise SystemExit("Refusing to package a live .env file")

temporary = OUTPUT.with_name(OUTPUT.name + ".tmp")
try:
    with ZipFile(temporary, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in FILES:
            archive.write(ROOT / relative, f"{ARCHIVE_ROOT}/{relative}")
    temporary.replace(OUTPUT)
finally:
    temporary.unlink(missing_ok=True)

print(f"Created {OUTPUT.name} ({OUTPUT.stat().st_size:,} bytes, {len(FILES)} files)")
