#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["fonttools==4.60.1", "skia-pathops==0.8.0.post2"]
# [tool.uv]
# required-version = ">=0.9.17"
# exclude-newer = "P7D"
# ///
"""Cut the static Source Serif 4 fonts that `font: 'text-serif'` uses.

The stage engine reads static TrueType fonts, so it cannot use the variable fonts directly.
Optical size 24 keeps the fine strokes visible when a 1080p film plays at phone size.
Overlaps are removed because `write()` traces each contour, and an overlap would show as a line.

Run: uv run scripts/build-stage-fonts.py SourceSerif4.ttf SourceSerif4-Italic.ttf

The inputs are these variable fonts from google/fonts at commit 08dc85da6bca7ae308a6f1d38d0b137465646071:
ofl/sourceserif4/SourceSerif4[opsz,wght].ttf and ofl/sourceserif4/SourceSerif4-Italic[opsz,wght].ttf
"""

import argparse
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import OverlapMode, instantiateVariableFont

OUT = Path(__file__).resolve().parent.parent / "assets" / "fonts"
AXES = {"opsz": 24, "wght": 400}


def cut(source: str, name: str) -> None:
    font = instantiateVariableFont(
        TTFont(source, recalcTimestamp=False),
        AXES,
        overlap=OverlapMode.REMOVE_AND_IGNORE_ERRORS,
    )
    font.save(OUT / f"{name}.ttf")
    print(f"{name}.ttf: {(OUT / f'{name}.ttf').stat().st_size} bytes")


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("roman", help="SourceSerif4[opsz,wght].ttf")
parser.add_argument("italic", help="SourceSerif4-Italic[opsz,wght].ttf")
args = parser.parse_args()
cut(args.roman, "SourceSerif4-24pt-Regular")
cut(args.italic, "SourceSerif4-24pt-Italic")
