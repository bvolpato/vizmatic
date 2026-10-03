#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["fonttools==4.60.1", "brotli==1.1.0"]
# ///

from pathlib import Path

from fontTools.ttLib import TTFont


root = Path(__file__).resolve().parent.parent
destination = root / "assets" / "site-fonts"
destination.mkdir(parents=True, exist_ok=True)

for name in ("Inter-Regular", "Inter-SemiBold", "Inter-Bold", "JetBrainsMono-Regular"):
    font = TTFont(root / "assets" / "fonts" / f"{name}.ttf", recalcTimestamp=False)
    font.flavor = "woff2"
    font.save(destination / f"{name}.woff2")
    font.close()
