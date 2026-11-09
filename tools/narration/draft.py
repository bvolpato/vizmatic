#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Write a draft of the timing from script.json, without the voice model.

The times are estimates: each word gets a share of the time of its beat by its length. Use a draft to
lay out the scenes before the first voice, or on a machine that has no voice model. A cue on a phrase
works as it does with the measured voice.

A draft never replaces a measured timing. When timing.json holds the measured voice, the draft goes to
timing.draft.json, and the film imports that file while the voice of the new script does not exist.

Usage: draft.py <folder>"""
import json
import re

import checks
import film

# The letters that the voice says in one second at speed 1, without the spaces. Measured on the voice
# af_heart: on three films of 12 to 15 minutes, the draft was within 3% of the measured length.
CHARACTERS_PER_SECOND = 11.6
PAUSE = 0.17  # The same breath between sentences as the voice step.


def plain(text):
    """The text without the phoneme notes of the voice engine: "[Toto](/tˈOtO/)" becomes "Toto"."""
    return re.sub(r"\[([^\]]+)\]\(/[^)]*/\)", r"\1", text)


def draft_take(beat, speed):
    """One beat with estimated word times. A word is a run of characters without a space."""
    words, now = [], 0.0
    for sentence in re.split(r"(?<=[.?!])\s+", plain(beat["text"])):
        for word in sentence.split():
            length = max(0.12, len(word) / CHARACTERS_PER_SECOND / speed)
            if re.search(r"\w", word):
                words.append({"text": word, "start": round(now, 3), "end": round(now + length, 3)})
            now += length
        now += PAUSE
    return {"say": beat["say"], "text": beat["text"], "duration": round(max(0.3, now - PAUSE), 3), "hold": beat["hold"], "words": words, **({"cues": beat["cues"]} if "cues" in beat else {})}


def measured_timing(root):
    """True when timing.json holds a measured voice, which a draft must not replace."""
    path = root / "timing.json"
    try:
        return path.exists() and not json.loads(path.read_text()).get("draft")
    except (json.JSONDecodeError, AttributeError):
        return False


def main(found, _words, _options):
    header, scenes = checks.outline(found.script, found.voice)
    out = {"draft": True, **header, "fingerprint": checks.fingerprint(header, scenes), "scenes": []}
    for scene in scenes:
        out["scenes"].append({"id": scene["id"], "title": scene["title"], "beats": [draft_take(beat, found.voice["speed"]) for beat in scene["beats"]]})
    kept = measured_timing(found.root)
    target = "timing.draft.json" if kept else "timing.json"
    (found.root / target).write_text(json.dumps(out) + "\n")
    total = sum(beat["duration"] + beat["hold"] for scene in out["scenes"] for beat in scene["beats"])
    summary = f"{target} is written: a draft of {len(out['scenes'])} scenes, about {total:.1f} s of voice."
    if kept:
        # The steps of the build read timing.json, so a film on the draft file is checked with the plain check.
        film.verdict(f"{summary} timing.json holds the measured voice and was left as it is. To lay out scenes on the draft, import ./timing.draft.json in the film file, and check it with: vizmatic check <film file>")
    else:
        film.verdict(f"{summary} The voice step replaces it. Next: {found.next('check')}")


if __name__ == "__main__":
    film.run(main, "draft", "draft.py <folder>")
