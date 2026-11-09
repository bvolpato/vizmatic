"""The sound bed of a narrated film: a quiet pad, and its level under the voice.

The pad has no loop. It changes chord where the narration starts a new beat, takes each chord
from a palette by a seeded random walk, and changes its texture at each scene. `mix.py` gives
the seed and the levels of the film. Everything is synthesized here: no sample is read."""
import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.signal import butter, sosfilt

STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def hz(note):
    """The frequency of a note such as A2, in equal temperament with A4 at 440 Hz."""
    return 440.0 * 2 ** ((STEP[note[0]] + 12 * (int(note[1:]) + 1) - 69) / 12)


# Chords of C major, bass first. The notes are sines, and two sines closer than a minor third
# sound rough, so each voicing keeps its notes at least that far apart.
PALETTE = {
    "Am": "A2 E3 A3 C4 E4",
    "Am7": "A2 E3 G3 C4 E4",
    "F": "F2 C3 F3 A3 C4",
    "Fmaj7": "F2 C3 A3 C4 E4",
    "C": "C3 G3 C4 E4 G4",
    "Cmaj7": "C3 G3 B3 E4 G4",
    "G": "G2 D3 G3 B3 D4",
    "Em": "E3 B3 E4 G4 B4",
    "Dm": "D3 A3 D4 F4 A4",
}
# How loud each of the five voices is, bass first. Each scene takes one texture.
TEXTURES = {
    "full": [1.0, 0.74, 0.59, 0.49, 0.42],
    "high": [0.35, 0.5, 0.7, 0.65, 0.6],
    "low": [1.0, 0.8, 0.5, 0.25, 0.12],
    "open": [0.8, 0.3, 0.7, 0.2, 0.6],
}
DRIFT = [47.0, 61.0, 37.0, 53.0, 29.0]  # Seconds. Each voice swells and fades at its own period, so the blend does not repeat.
CROSS, SHORTEST, LONGEST = 5.0, 8.0, 20.0  # Seconds: the crossfade between two chords, and the limits of how long one chord lasts.


def plan(total, beats, scenes, seed):
    """Choose when the chord changes and which chord and texture each part gets.
    `beats` and `scenes` are start times in seconds. Returns a list of (start, end, chord, texture)."""
    rng = np.random.default_rng(seed)
    # A chord changes just before a beat starts, in the pause between two sentences.
    cuts = [0.0]
    for at in sorted(beats):
        if at - 0.3 - cuts[-1] >= SHORTEST and total - at >= SHORTEST: cuts.append(at - 0.3)
    cuts.append(total)
    # A long beat gets more than one chord.
    edges = [0.0]
    for a, b in zip(cuts, cuts[1:]):
        parts = int(np.ceil((b - a) / LONGEST))
        edges += [a + (b - a) * (i + 1) / parts for i in range(parts)]
    names = list(PALETTE)
    tones = {n: {note[0] for note in PALETTE[n].split()} for n in names}
    textures, chords, out = list(TEXTURES), [], []
    scene_texture = []
    for _ in scenes:
        scene_texture.append(rng.choice([x for x in textures if not scene_texture or x != scene_texture[-1]]))
    for a, b in zip(edges, edges[1:]):
        # The next chord is not one of the last two. A chord that shares more notes with the last one is more likely.
        # It shares at least one note with the last chord, so that the crossfade has a note that stays.
        options = [n for n in names if n not in chords[-2:] and (not chords or tones[n] & tones[chords[-1]])]
        weights = np.array([(len(tones[n] & tones[chords[-1]]) + 0.5) ** 1.5 if chords else 1.0 for n in options])
        chords.append(str(rng.choice(options, p=weights / weights.sum())))
        scene = max([i for i, s in enumerate(scenes) if s <= a + 1.0], default=0)
        out.append((a, b, chords[-1], str(scene_texture[scene])))
    return out


def pad(total, rate, parts):
    """Draw the pad for the plan from `plan`. Returns stereo samples with an RMS of 1."""
    n = int(total * rate)
    out = np.zeros((n, 2), dtype=np.float32)
    for k, (start, end, chord, texture) in enumerate(parts):
        a, b = max(0, int((start - CROSS / 2) * rate)), min(n, int((end + CROSS / 2) * rate))
        t = np.arange(a, b) / rate
        # The gains of two neighbors add up to 1 through the crossfade, so a note that both chords have stays level.
        rise = np.ones_like(t) if k == 0 else np.sin(np.clip((t - (start - CROSS / 2)) / CROSS, 0, 1) * np.pi / 2) ** 2
        fall = np.ones_like(t) if k == len(parts) - 1 else np.sin(np.clip(((end + CROSS / 2) - t) / CROSS, 0, 1) * np.pi / 2) ** 2
        for j, note in enumerate(PALETTE[chord].split()):
            f = hz(note)
            gain = TEXTURES[texture][j] * (1 + 0.3 * np.sin(2 * np.pi * t / DRIFT[j] + j)) * rise * fall
            # The phase is linear in time, so the pitch is constant. The two channels differ by 0.3 percent, which moves the
            # sound slowly between left and right. The phase depends on the note only, so a note that two chords share lines up.
            out[a:b, 0] += (gain * np.sin(2 * np.pi * f * 0.9985 * t + f)).astype(np.float32)
            out[a:b, 1] += (gain * np.sin(2 * np.pi * f * 1.0015 * t + f + 0.6)).astype(np.float32)
    out = sosfilt(butter(2, 900, "low", fs=rate, output="sos"), out, axis=0).astype(np.float32)
    return out / np.sqrt(np.mean(np.square(out, dtype=np.float64)))


def level(voice, rate, under=-22.0, pause=-15.0):
    """The gain of the pad over time, as a fraction of the level of the voice, and where the voice speaks.
    `under` and `pause` are in decibels below the voice: under speech, and in a long pause.
    A pause of 1 second or less does not raise the pad. A pause of 2.2 seconds raises it in full."""
    # Work on frames of 20 ms, then stretch the result back to samples.
    hop = rate // 50
    frames = len(voice) // hop
    energy = np.sqrt(np.mean(voice[: frames * hop].reshape(frames, hop).astype(np.float64) ** 2, axis=1))
    silent = (energy <= 0.012).astype(np.float64)
    speaking = np.clip(uniform_filter1d(1 - silent, 25, mode="nearest") * 2.2, 0, 1) > 0.5
    lift = np.clip((uniform_filter1d(silent, 120, mode="nearest") - 0.42) / 0.5, 0, 1)
    lift = uniform_filter1d(lift, 25, mode="nearest")
    low, high = 10 ** (under / 20), 10 ** (pause / 20)
    at = (np.arange(len(voice), dtype=np.float32) / hop)
    gain = np.interp(at, np.arange(frames) + 0.5, low + (high - low) * lift).astype(np.float32)
    return gain, np.interp(at, np.arange(frames) + 0.5, speaking.astype(np.float64)) > 0.5


def decibels(x):
    return 20 * np.log10(np.sqrt(np.mean(np.square(x, dtype=np.float64))) + 1e-12)
