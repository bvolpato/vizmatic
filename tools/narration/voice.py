#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "kokoro==0.9.4",
#   "soundfile",
#   "numpy",
#   "en-core-web-sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
# ]
# ///
"""Make the voice of script.json with Kokoro, on this machine. Writes one WAV for each beat under
audio/, and timing.json with the time of each word, so that the film can follow the voice.

No text of the script leaves this machine. A run that makes a take asks huggingface.co for the files of
the voice model, and downloads them the first time. With HF_HUB_OFFLINE=1 it asks nothing, once the
files are on the disk. A take is kept by the hash of its voice, its speed and its text, so a second run
makes only the beats that changed, and a run that makes no take does not load the model.

Usage: voice.py <folder>"""
import functools
import hashlib
import json
import re
import sys

import checks
import film

RATE = 24000
BREATH = 0.17  # Seconds of silence between two sentences of one beat.


@functools.cache
def model():
    """The voice model. It loads for the first take that is not on disk, so a run that changes no beat is fast."""
    print("voice: loading the voice model. It asks huggingface.co for the model files, and sends no text of the script.", file=sys.stderr, flush=True)
    from kokoro import KPipeline
    return KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")


def synthesize(text, voice):
    """Speak one beat. Returns the samples and the time of each word, in seconds from the start of the beat."""
    import numpy as np
    audio, words, offset = [], [], 0.0
    for result in model()(text, voice=voice["name"], speed=voice["speed"], split_pattern=r"(?<=[.?!])\s+"):
        chunk = np.asarray(result.audio, dtype=np.float32)
        for token in result.tokens or []:
            if token.start_ts is not None and token.end_ts is not None and re.search(r"\w", token.text):
                words.append({"text": token.text, "start": round(offset + token.start_ts, 3), "end": round(offset + token.end_ts, 3)})
        breath = np.zeros(int(BREATH * RATE), dtype=np.float32)
        audio += [chunk, breath]
        offset += (len(chunk) + len(breath)) / RATE
    # The last breath is not part of the take.
    return np.concatenate(audio[:-1]), words


def take_key(voice, text):
    """The name of a take on disk: the voice, its speed and the text. A change of one of them is a new take."""
    return hashlib.sha1(f"{voice['name']}|{voice['speed']}|{text}".encode()).hexdigest()[:12]


def kept_take(wav, side):
    """The word times and the length of a take that is whole on the disk, or None. A take that a run left
    half written, such as an empty file, is not a take: it is made again."""
    try:
        info = json.loads(side.read_text())
        whole = wav.stat().st_size > checks.EMPTY_WAV and isinstance(info["words"], list) and info["duration"] > 0
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return info if whole else None


def take(root, scene_id, index, text, voice):
    """The WAV of one beat and its word times, and if it was made now. A take that is on disk is not made again."""
    wav = root / "audio" / f"{scene_id}-{index}-{take_key(voice, text)}.wav"
    side = wav.with_suffix(".json")
    made = kept_take(wav, side) is None
    if made:
        try:
            data, words = synthesize(text, voice)
        except Exception as error:  # The voice engine has many ways to fail, and each must be one line.
            film.fail(f'the voice "{voice["name"]}" could not speak {scene_id}/{index}: {type(error).__name__}: {str(error).splitlines()[0].rstrip(".") if str(error) else "no message"}. '
                      'Check voice.name in film.json. Offline, the model files must be on the disk')
        import soundfile as sf
        sf.write(wav, data, RATE, subtype="PCM_16")
        film.write_json(side, {"words": words, "duration": len(data) / RATE})
    return wav.name, json.loads(side.read_text()), made


def main(found, _words, _options):
    root, voice = found.root, found.voice
    header, scenes = checks.outline(found.script, voice)
    (root / "audio").mkdir(exist_ok=True)
    out = {**header, "fingerprint": checks.fingerprint(header, scenes), "scenes": []}
    new = 0
    for scene in scenes:
        beats = []
        for index, beat in enumerate(scene["beats"]):
            wav, info, made = take(root, scene["id"], index, beat["text"], voice)
            new += made
            beats.append({"wav": wav, "say": beat["say"], "text": beat["text"], "duration": info["duration"], "hold": beat["hold"], "words": info["words"]})
            print(scene["id"], index, round(info["duration"], 2), flush=True)
        out["scenes"].append({"id": scene["id"], "title": scene["title"], "beats": beats})
    film.write_json(root / "timing.json", out)
    takes = [beat for scene in out["scenes"] for beat in scene["beats"]]
    seconds = sum(beat["duration"] + beat["hold"] for beat in takes)
    print("total", round(seconds, 1))
    film.verdict(f"{len(takes)} takes, {new} new, {seconds:.1f} s of voice. timing.json is written. Next: {found.next('transcribe') if new else found.next('mix')}")


if __name__ == "__main__":
    film.run(main, "voice", "voice.py <folder>")
