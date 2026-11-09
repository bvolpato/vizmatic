#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["faster-whisper", "soundfile", "scipy", "numpy"]
# ///
"""Transcribe each take of the voice on this machine, and show the words that differ from the script.

A voice engine can say a word in a way that a listener hears as another word, and an agent cannot
hear the take. Run this after each new take. The transcription model runs on this machine: the first
run downloads it from huggingface.co, and no sound is sent.

Usage: transcribe.py <folder> [scene or scene/beat ...]
With arguments, it checks only those beats, such as hook/3, and prints the full text that it heard."""
import difflib
import re

import film


def words(text):
    """The words of a text, without case and punctuation. A period stays only inside a number, such as 3.8,
    so that "page." and "page" are one word."""
    found = (word.strip(".") for word in re.findall(r"[a-z0-9.]+", text.lower().replace(",", "")))
    return [word for word in found if word]


def plain(text):
    """The text without the phoneme notes of the voice engine: "[Toto](/tˈOtO/)" becomes "Toto"."""
    return re.sub(r"\[([^\]]+)\]\(/[^)]*/\)", r"\1", text)


def spoken_forms(pronounce):
    """Each entry of the pronounce map, as words: what the script writes, and what the voice says for it.
    A transcript may write either one, and both are right."""
    return {tuple(words(plain(sub))): words(word) for word, sub in pronounce.items()}


def differences(said, heard, forms):
    """The runs of words where the transcript differs from the script. A written form in place of its spoken
    form is not a difference: the script says "800", the voice says "eight hundred", and both are heard right."""
    a, b = words(said), words(heard)
    found = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b).get_opcodes():
        if op != "equal" and forms.get(tuple(b[j1:j2])) != a[i1:i2] and forms.get(tuple(a[i1:i2])) != b[j1:j2]:
            found.append(f"{' '.join(a[i1:i2])!r} -> {' '.join(b[j1:j2])!r}")
    return found


def main(found, only, _options):
    import numpy as np
    import soundfile as sf
    from faster_whisper import WhisperModel
    from scipy.signal import resample_poly

    line = film.place(found.timing)
    only = set(only)
    for name in only:
        line.beat(name.split("/")[0], 0)
    forms = spoken_forms(found.script.get("pronounce", {}))
    model = WhisperModel("small.en", device="cpu", compute_type="int8")
    checked, wrong = 0, []
    for beat in line.beats:
        name = f"{beat.scene}/{beat.index}"
        if only and name not in only and beat.scene not in only:
            continue
        audio, rate = sf.read(found.root / "audio" / beat.take["wav"], dtype="float32")
        segments, _ = model.transcribe(resample_poly(audio, 16000, rate).astype(np.float32), beam_size=5, language="en")
        heard = " ".join(segment.text for segment in segments)
        differ = differences(beat.take["say"], heard, forms)
        checked += 1
        if differ:
            wrong.append(name)
        print(f"{name} {beat.take['duration']:.1f}s", "OK" if not differ else " | ".join(differ), flush=True)
        if only:
            print("   heard:", heard.strip(), flush=True)
    if wrong:
        film.verdict(f"{checked - len(wrong)} of {checked} takes say the words of the script, and {len(wrong)} differ: {', '.join(wrong)}. "
                     f"Read each difference: change the text or the pronounce map in script.json, then run: {found.next('voice')}")
    else:
        film.verdict(f"all {checked} takes say the words of the script. Next: {found.next('mix')}")


if __name__ == "__main__":
    film.run(main, "transcribe", "transcribe.py <folder> [scene or scene/beat ...]", words=True)
