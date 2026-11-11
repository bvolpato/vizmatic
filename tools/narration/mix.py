#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["numpy", "scipy", "soundfile"]
# ///
"""Lay the voice on the timeline of the film, and add a quiet pad and selected sound effects.

The voice stays on top: the pad from soundbed.py stays well under it, and rises only in a long pause
and where the film asks for a swell. The film gives its seed, its levels, its swells and its effects
in film.json, under "mix". The README of this folder describes each key.

It writes narration.wav for the render. An agent cannot hear the result, so it prints the levels and
writes the voice alone, the pad alone, and the mix before the loudness pass under stills/.

Usage: mix.py <folder>"""
import subprocess

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

import checks
import film
import soundbed

RATE = 48000
BELL = (659.25, 987.77, 1318.51)     # E5, B5, E6.
LOW_BELL = (329.63, 493.88, 659.25)  # The same bell, one octave lower.
CLEAR_VOICE = 18.0                   # Decibels that the pad must stay under the voice while the voice speaks.


def word_start(beat, word, last, where):
    """When the voice starts a word of one beat, in seconds from the start of the beat."""
    hits = [spoken["start"] for spoken in beat.take["words"] if spoken["text"].strip(".,:?").lower() == word.lower()]
    if not hits:
        said = " ".join(spoken["text"] for spoken in beat.take["words"])
        film.fail(f'{where}.word: the voice does not say "{word}" in beat {beat.index} of scene "{beat.scene}". It says: {said}')
    return hits[-1] if last else hits[0]


def anchor(spec, line, where):
    """A time in the film, in seconds, from one of three references: the film ("at", and a negative
    value counts from the end), the title card ("intro", a share of it), or a beat ("scene" and "beat",
    with "edge" for the end of its voice, or "word" for a word of it). "offset" moves the time."""
    if "at" in spec:
        base = spec["at"] if spec["at"] >= 0 else line.total + spec["at"]
    elif "intro" in spec:
        base = line.intro * spec["intro"]
    else:
        beat = line.beat(spec["scene"], spec.get("beat", 0))
        if "word" in spec:
            base = beat.start + word_start(beat, spec["word"], spec.get("last", False), where)
        else:
            base = beat.voice_end if spec.get("edge", "start") == "end" else beat.start
    return base + spec.get("offset", 0.0)


def lay_voice(root, line, samples):
    """The takes at their places, as one track with its peak at 0.89."""
    voice = np.zeros(samples, dtype=np.float32)
    for beat in line.beats:
        data, rate = sf.read(root / "audio" / beat.take["wav"], dtype="float32")
        if rate != RATE:
            data = resample_poly(data, RATE, rate).astype(np.float32)
        start = int(beat.start * RATE)
        voice[start:start + len(data)] += data[: max(0, samples - start)]
    return voice / np.abs(voice).max() * 0.89


def swell(seconds, center, width, db):
    """A rise of the pad around one moment: a bell curve that is `db` decibels under the voice at its top."""
    return 10 ** (db / 20) * np.exp(-((seconds - center) / width) ** 2)


def chime(samples, at, notes=BELL, gain=0.11, until=None):
    """A soft bell of three notes. With `until`, it fades over half a second and is silent from that time on."""
    out = np.zeros(samples, dtype=np.float32)
    start = int(at * RATE)
    length = min(samples - start, int(5 * RATE))
    t = np.arange(length) / RATE
    out[start:start + length] = soundbed.bell_samples(t, notes, gain)
    if until is not None:
        out[start:start + length] *= np.clip((until - (at + t)) / 0.5, 0, 1).astype(np.float32)
    return out


def default_swells(line, card):
    """Without a list in film.json: a swell under the title card, when the film has one, and under the last card.
    The last one starts a quarter of a second after the last word, so that the pad does not rise under the voice."""
    # The rise under the title card is as wide as the card allows, so that it is over when the first word starts.
    title = [{"intro": 0.5, "width": min(1.6, line.intro * 0.57)}] if line.intro > 0 else []
    last_word = {"scene": -1, "beat": -1, "edge": "end", "offset": 0.25}
    return title + [{"at": -2.4, "width": 1.6, "db": card + 1, "after": last_word}]


def default_chimes(line):
    """Without a list in film.json: a bell on the title card, when the film has one, and a fuller chord after the last word."""
    title = [{"at": 0.15, "gain": 0.075}] if line.intro > 0 else []
    return title + [{"scene": -1, "beat": -1, "edge": "end", "offset": 0.2, "gain": 0.1, "full": True}]


def pad_level(voice, seconds, line, levels, swells):
    """How loud the pad is over time, as a share of the level of the voice, and where the voice speaks."""
    level, spoke = soundbed.level(voice, RATE, levels["under"], levels["pause"])
    placed = []
    for index, spec in enumerate(swells):
        where = f"film.json: mix.swells[{index}]"
        center = anchor(spec, line, where)
        rise = swell(seconds, center, spec.get("width", 2.0), spec.get("db", levels["card"]))
        if "after" in spec:
            # The swell must not start under the last words, so it is cut before this time.
            rise = rise * (seconds > anchor(spec["after"], line, f'{where} "after"'))
        level = np.maximum(level, rise)
        placed.append(center)
    # The pad fades in over the first 1.5 seconds and out over the last 2.
    level *= np.clip(seconds / 1.5, 0, 1) * np.clip((line.total - seconds) / 2.0, 0, 1)
    return level, spoke, placed


def bells(samples, line, chimes):
    """All the chimes as one track, and the time of each. A chime with "full" gets a second, lower bell."""
    track, placed = np.zeros(samples, dtype=np.float32), []
    for index, spec in enumerate(chimes):
        where = f"film.json: mix.chimes[{index}]"
        at = anchor(spec, line, where)
        until = anchor(spec["until"], line, f'{where} "until"') if "until" in spec else None
        if not 0 <= at < line.total:
            film.fail(f"{where}: the chime is at {at:.2f} s, and the film is {line.total:.2f} s long. Give a time inside the film")
        if until is not None and until - at < 1.0:
            film.fail(f"{where}: the chime starts at {at:.2f} s and must be silent from {until:.2f} s. A bell needs one second to ring")
        bell = chime(samples, at, tuple(spec.get("notes", BELL)), spec.get("gain", 0.11), until)
        if until is not None and until < line.total:
            assert np.abs(bell[int(until * RATE):]).max() == 0, "the bell is silent from the time that the film gives"
        track = track + bell
        if spec.get("full"):
            # The last card gets a fuller chord: the same bell, and one an octave lower.
            track = track + chime(samples, at + 0.03, LOW_BELL, 0.07)
        placed.append((at, until))
    return track, placed


def effects(samples, line, entries):
    """Place each procedural clip with its own gain and cutoff, in the order that the author gives."""
    track, placed = np.zeros(samples, dtype=np.float32), []
    for index, spec in enumerate(entries):
        where = f"film.json: mix.effects[{index}]"
        at = anchor(spec, line, where)
        until = anchor(spec["until"], line, f'{where} "until"') if "until" in spec else None
        if not 0 <= at < line.total:
            film.fail(f"{where}: the effect is at {at:.2f} s, and the film is {line.total:.2f} s long. Give a time inside the film")
        if until is not None and until <= at:
            film.fail(f"{where}: the effect starts at {at:.2f} s and must be silent from {until:.2f} s. Give an until time after the start")
        start = int(at * RATE)
        end = int(min(line.total, until) * RATE) if until is not None else samples
        clip = soundbed.sound_effect(spec["sound"], RATE)[:max(0, end - start)].copy()
        clip *= spec.get("gain", checks.SOUND_EFFECTS[spec["sound"]]["gain"])
        # A cut fades only this clip. It must not change effects that already occupy the track.
        if len(clip) and end - start <= len(clip):
            fade = min(len(clip), int(0.02 * RATE))
            clip[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32) if fade > 1 else 0
        track[start:start + len(clip)] += clip
        placed.append((at, until))
    return track, placed


def write_sound(root, mix, voice, bed):
    """The mix at -16 LUFS for the render, and the three tracks that a check can read."""
    stills = root / "stills"
    stills.mkdir(exist_ok=True)
    sf.write(stills / "mix-raw.wav", mix, RATE, subtype="PCM_24")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(stills / "mix-raw.wav"), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", str(RATE), "-c:a", "pcm_s24le", str(root / "narration.wav")], check=True)
    sf.write(stills / "voice-only.wav", voice, RATE, subtype="PCM_16")
    sf.write(stills / "bed-only.wav", bed, RATE, subtype="PCM_24")


def report(line, levels, mix, voice, bed, level, spoke, track, parts, swells, chimes, named=False):
    """Print the levels, because nobody hears the mix before the film is rendered."""
    rms = soundbed.decibels
    quiet = ~spoke & (level >= 10 ** (levels["pause"] / 20) * 0.98)
    print(f"film {line.total:.2f}s  beats {len(line.beats)}  peak {np.abs(mix).max():.3f}")
    print(f"voice RMS while speaking {rms(voice[spoke]):.1f} dB; bed RMS under voice {rms(bed[spoke, 0]):.1f} dB; gap {rms(voice[spoke]) - rms(bed[spoke, 0]):.1f} dB")
    if line.intro > 0:
        intro = int(line.intro * RATE)
        print(f"intro: bed RMS {rms(bed[:intro, 0]):.1f} dB, {'effect' if named else 'chime'} peak {np.abs(track[:intro]).max():.3f}")
    long_pauses = f"{rms(bed[quiet, 0]):.1f} dB" if quiet.any() else "none"
    print(f"bed RMS in long pauses {long_pauses}; {'effects' if named else 'chimes'} at {', '.join(f'{at:.2f}s' for at, _ in chimes)}; swells at {', '.join(f'{at:.2f}s' for at in swells)}")
    for at, until in chimes:
        if until is not None and named:
            print(f"the effect of {at:.2f}s is silent from {until:.2f}s")
        elif until is not None:
            # What sounds under the words that follow the bell: the voice, the pad at its usual level, and no bell.
            a, b = int((until + 0.5) * RATE), int((until + 1.0) * RATE)
            print(f"the bell of {at:.2f}s is silent from {until:.2f}s; from {until + 0.5:.2f}s to {until + 1.0:.2f}s, voice RMS {rms(voice[a:b]):.1f} dB, bed RMS {rms(bed[a:b, 0]):.1f} dB, bell peak {np.abs(track[a:b]).max():.4f}")
    lengths = [end - start for start, end, _, _ in parts]
    print(f"pad: {len(parts)} chords, {min(lengths):.1f} to {max(lengths):.1f} s each; " + " ".join(chord for _, _, chord, _ in parts))


def main(found, _words, _options):
    root = found.root
    line = film.place(found.timing)
    settings = found.mix
    levels = settings["levels"]
    samples = int(line.total * RATE)
    voice = lay_voice(root, line, samples)

    # The pad has no loop: the chord changes where a beat starts, a seeded random walk picks each chord,
    # and each scene has its own texture.
    parts = soundbed.plan(line.total, [beat.start for beat in line.beats], list(line.scenes.values()), seed=settings["seed"])
    pad = soundbed.pad(line.total, RATE, parts)
    seconds = np.arange(samples, dtype=np.float32) / RATE
    swells = settings["swells"] if settings["swells"] is not None else default_swells(line, levels["card"])
    level, spoke, swell_times = pad_level(voice, seconds, line, levels, swells)
    bed = pad * (level * 10 ** (soundbed.decibels(voice[spoke]) / 20))[:, None]

    named = settings["effects"] is not None
    if named:
        track, chime_times = effects(samples, line, settings["effects"])
    else:
        chimes = settings["chimes"] if settings["chimes"] is not None else default_chimes(line)
        track, chime_times = bells(samples, line, chimes)
    # The voice is the same in both channels. The pad differs between them, and the bells are a little quieter at the right.
    mix = np.stack([voice + bed[:, 0] + track, voice + bed[:, 1] + track * 0.92], axis=1)
    peak = np.abs(mix).max()
    if peak > 0.97:
        mix = mix / peak * 0.97
    write_sound(root, mix, voice, bed)
    # A build reads this record, and leaves a mix that is made from the timing and the film.json of now.
    film.write_mix_record(found)
    report(line, levels, mix, voice, bed, level, spoke, track, parts, swell_times, chime_times, named)
    under = soundbed.decibels(voice[spoke]) - soundbed.decibels(bed[spoke, 0])
    summary = f"narration.wav is written: {line.total:.2f} s, {len(line.beats)} takes, the pad {under:.1f} dB under the voice."
    if under < CLEAR_VOICE:
        film.verdict(f"{summary} That is too near: under {CLEAR_VOICE} dB the pad covers the voice. Lower mix.levels.under, or move a swell away from the voice, and mix again.")
    else:
        film.verdict(f"{summary} Next: {found.next('check', '--motion')}")


if __name__ == "__main__":
    film.run(main, "mix", "mix.py <folder>")
