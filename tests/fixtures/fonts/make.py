# /// script
# requires-python = ">=3.12"
# dependencies = ["fonttools==4.60.1"]
# ///
"""Make the fonts that tests/stage-fonts.test.ts reads. Each glyph of operators.otf uses some Type 2 operators.
fontTools draws the same glyphs for operators.json, so the test compares two readers. Usage: uv run make.py"""
import json
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.psCharStrings import T2CharString
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

here = Path(__file__).parent
PROGRAMS = {
    ".notdef": [500, "endchar"],
    "A": [100, 50, 0, "rmoveto", 300, 0, 0, 400, -300, 0, "rlineto", "endchar"],
    "B": [-20, 100, "hmoveto", 200, 100, -50, 150, "hlineto", 120, 30, 40, 60, 70, 20, "rrcurveto", "endchar"],
    "C": [60, "vmoveto", 200, 80, 60, "vlineto", 40, 50, 60, 70, 80, 90, 30, 20, "rcurveline", 10, 20, 30, 40, 50, 60, 70, 80, "rlinecurve", "endchar"],
    "D": [0, 0, "rmoveto", 15, 50, 60, 70, 80, "vvcurveto", 12, 40, 50, 60, 70, 30, 20, 10, 25, "hhcurveto", "endchar"],
    "E": [0, 0, "rmoveto", 50, 40, 60, 70, 20, 30, 40, 50, 9, "vhcurveto", 50, 40, 60, 70, 11, "hvcurveto", "endchar"],
    "F": [0, 100, "rmoveto", 40, 50, 20, 60, 60, 50, 40, "hflex", 30, 10, 40, 20, 50, 60, 40, -25, 30, "hflex1", "endchar"],
    "G": [0, 100, "rmoveto", 30, 5, 40, 15, 50, 3, 50, -4, 40, -12, 30, "flex1", 30, 5, 40, 15, 50, 3, 50, -4, 40, -12, 30, -7, 50, "flex", "endchar"],
    "H": [10, 20, 30, 40, "hstemhm", 15, 25, "hintmask", bytes([0b11100000]), 0, 0, "rmoveto", -107, "callsubr", -107, "callgsubr", "endchar"],
}


def builder(ttf):
    made = FontBuilder(1000, isTTF=ttf)
    made.setupGlyphOrder(list(PROGRAMS))
    made.setupCharacterMap({ord(name): name for name in PROGRAMS if len(name) == 1})
    return made


def finish(made, name):
    made.setupHorizontalMetrics({glyph: (500 + 10 * i, 0) for i, glyph in enumerate(PROGRAMS)})
    made.setupHorizontalHeader(ascent=800, descent=-200)
    made.setupNameTable({"familyName": name, "styleName": "Regular"})
    made.setupOS2()
    made.setupPost()
    return made


otf = builder(False)
strings = {name: T2CharString(program=list(program)) for name, program in PROGRAMS.items()}
otf.setupCFF("Operators-Regular", {}, strings, {})
top = otf.font["CFF "].cff.topDictIndex[0]
from fontTools.cffLib import SubrsIndex  # noqa: E402
top.Private.Subrs = SubrsIndex()
top.Private.Subrs.append(T2CharString(program=[200, 0, "rlineto", "return"]))
otf.font["CFF "].cff.GlobalSubrs.append(T2CharString(program=[0, 300, -200, 0, "rlineto", "return"]))
finish(otf, "Operators").save(here / "operators.otf")

font, expected = TTFont(here / "operators.otf"), {}
for name in PROGRAMS:
    if len(name) > 1: continue
    pen = RecordingPen()
    font.getGlyphSet()[name].draw(pen)
    rings, ring = [], None
    for kind, points in pen.value:
        if kind == "moveTo": ring = [list(points[0])]
        elif kind == "lineTo":
            (x0, y0), (x1, y1) = ring[-1], points[0]
            ring += [[x0 + (x1 - x0) / 3, y0 + (y1 - y0) / 3], [x0 + (x1 - x0) * 2 / 3, y0 + (y1 - y0) * 2 / 3], [x1, y1]]
        elif kind == "curveTo": ring += [list(p) for p in points]
        elif kind in ("closePath", "endPath"): rings.append(ring)
    expected[name] = {"advance": font["hmtx"][name][0], "contours": [[v for p in ring for v in p] for ring in rings]}
(here / "operators.json").write_text(json.dumps(expected) + "\n")

# A TrueType font with one square, so that a test can tell which of two files a name gives.
ttf = builder(True)
glyphs = {}
for name in PROGRAMS:
    pen = TTGlyphPen(None)
    pen.moveTo((0, 0)); pen.lineTo((0, 700)); pen.lineTo((700, 700)); pen.lineTo((700, 0)); pen.closePath()
    glyphs[name] = pen.glyph()
ttf.setupGlyf(glyphs)
finish(ttf, "Square").save(here / "square.ttf")
