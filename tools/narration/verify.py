#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Check the files of a film before a step: film.json, script.json, and the timing against the script.

Prints one line for each problem: the file, the field, what is wrong, and what is allowed. With --json,
it prints the particulars of the film with their defaults, for the command line of Vizmatic, and what a
build has to do: if the voice and the mix are current, and where each scene is in the film.

Usage: verify.py <folder> [--step <step>] [--json]"""
import dataclasses
import json

import checks
import film


def work(found):
    """What a build has to do before it renders: the voice when the script changed, and the mix when the
    timing or the mix of film.json changed. Each answer has the reason, which the build prints."""
    current, why = checks.voice_state(found.root, found.script, found.voice)
    state = {"voice": {"current": current, "why": why}, "mix": {"current": False, "why": "the voice is made first"}, "scenes": [], "gap": 0, "length": 0}
    timing = checks.usable_timing(found.root) if current else None
    if timing is not None:
        mixed, reason = film.mix_state(dataclasses.replace(found, timing=timing))
        line = film.place(timing)
        ends = {beat.scene: beat.until for beat in line.beats}
        state |= {
            "mix": {"current": mixed, "why": reason},
            "scenes": [{"id": scene, "start": start, "end": ends[scene]} for scene, start in line.scenes.items()],
            "gap": line.gap, "length": line.total,
        }
    return state


def main(found, _words, options):
    given = found.given
    if "--json" in options:
        print(json.dumps({
            "entry": given.get("entry", "film.ts"),
            "output": found.output,
            "look": given.get("look", "midnight"),
            "check": given.get("check", []),
            "render": {**checks.RENDER, **given.get("render", {})},
            "before": given.get("before", []),
            **work(found),
        }))
    else:
        film.verdict(f"film.json and script.json are right{', and the timing is current' if found.timing else ''}.")


if __name__ == "__main__":
    import sys
    step = sys.argv[sys.argv.index("--step") + 1] if "--step" in sys.argv[:-1] else "voice"
    if step not in checks.STEPS:
        raise SystemExit(f"verify: unknown step {step}. The steps are: {', '.join(checks.STEPS)}")
    film.run(main, step, "verify.py <folder> [--step <step>] [--json]", flags=("--json",), values=("--step",))
