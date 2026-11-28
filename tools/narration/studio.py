"""The work of a mix engineer on a voice and on a score, for mix.py. Each step keeps its input as it is and
returns a new track. All times are in seconds and all levels in decibels."""
import numpy as np
from scipy.ndimage import maximum_filter1d, uniform_filter1d
from scipy.signal import butter, fftconvolve, sosfilt, sosfiltfilt

import soundbed

# Where a voice is made of: its first overtones, its vowels and most of its consonants.
VOICE_BAND = (220.0, 5200.0)
HOLD = 0.6  # A pause that is shorter than this is a part of the phrase, so the score does not move in it.


def spoken(voice, rate):
    """Where the voice speaks, for each hundredth of a second. A gap inside a word is a part of the word."""
    hop = rate // 100
    frames = len(voice) // hop
    energy = np.sqrt(np.mean(voice[: frames * hop].reshape(frames, hop).astype(np.float64) ** 2, axis=1))
    return np.convolve(energy > 0.012, np.ones(19), mode="same") > 1.5


def room(speaking, attack, release):
    """How much room the voice needs, from 0 to 1, for each hundredth of a second. It is there by the first word,
    because it starts to open `attack` before. It stays open in a short pause, and closes over `release`."""
    held = speaking.copy()
    ends = np.flatnonzero(np.diff(np.concatenate(([0], speaking.astype(np.int8), [0]))))
    for end, start in zip(ends[1::2], ends[2::2]):
        if (start - end) / 100 < HOLD:
            held[end:start] = True
    down, up, last = np.empty(len(held)), np.empty(len(held)), 0.0
    for i in range(len(held)):
        last = down[i] = max(float(held[i]), last - 0.01 / release)
    last = 0.0
    for i in range(len(held) - 1, -1, -1):
        last = up[i] = max(float(held[i]), last - 0.01 / attack)
    depth = np.maximum(down, up)
    return depth * depth * (3 - 2 * depth)


def carve(score, depth, rate, cut, duck):
    """Make room for a voice in a score. `cut` decibels go from the band of the voice, in the middle of the image,
    where a voice is. `duck` decibels go from all of it. The bass, the air and the sides stay, so the score does
    not sound as if someone moved its fader."""
    middle, side = (score[:, 0] + score[:, 1]) / 2, (score[:, 0] - score[:, 1]) / 2
    low = sosfiltfilt(butter(2, VOICE_BAND[0], "low", fs=rate, output="sos"), middle)
    high = sosfiltfilt(butter(2, VOICE_BAND[1], "high", fs=rate, output="sos"), middle)
    at = np.arange(len(score), dtype=np.float64) * 100 / rate
    open_ = np.interp(at, np.arange(len(depth)) + 0.5, depth)
    # What is left of the middle is the band of the voice. The three parts add up to the score when nothing is cut.
    middle = low + (middle - low - high) * 10 ** (-cut * open_ / 20) + high
    return (np.stack([middle + side, middle - side], axis=1) * 10 ** (-duck * open_ / 20)[:, None]).astype(np.float32)


def band_level(track, where, rate):
    """The level of a track in the band of the voice, in the samples of `where`. A stereo track gives its louder side."""
    sides = track[:, None] if track.ndim == 1 else track
    sos = butter(4, (300.0, 4000.0), "band", fs=rate, output="sos")
    return max(soundbed.decibels(sosfilt(sos, sides[:, k])[where]) for k in range(sides.shape[1]))


def _rms(x, size):
    """The RMS over a window. A running sum can end a little under zero, so it is held at zero."""
    return np.sqrt(np.maximum(0.0, uniform_filter1d(x * x, size))) + 1e-9


def _bell(x, rate, at, gain, q):
    """A bell of an equalizer (the cookbook of Bristow-Johnson)."""
    a, w = 10 ** (gain / 40), 2 * np.pi * at / rate
    alpha, c = np.sin(w) / (2 * q), np.cos(w)
    b0, b1, b2, a0, a1, a2 = 1 + alpha * a, -2 * c, 1 - alpha * a, 1 + alpha / a, -2 * c, 1 - alpha / a
    return sosfilt(np.array([[b0, b1, b2, a0, a1, a2]]) / a0, x)


def _shelf(x, rate, at, gain):
    """A shelf for the air over a frequency."""
    a, w = 10 ** (gain / 40), 2 * np.pi * at / rate
    c, beta = np.cos(w), np.sin(w) * np.sqrt(a) * np.sqrt(2)
    b = [a * ((a + 1) + (a - 1) * c + beta), -2 * a * ((a - 1) + (a + 1) * c), a * ((a + 1) + (a - 1) * c - beta)]
    d = [(a + 1) - (a - 1) * c + beta, 2 * ((a - 1) - (a + 1) * c), (a + 1) - (a - 1) * c - beta]
    return sosfilt(np.array([[*b, *d]]) / d[0], x)


def polish(voice, rate):
    """The chain of a studio for one voice: clean the bass, take some mud, give it presence and air, tame the hiss
    of an "s", even out its level, and put it in a small room. Returns a stereo track with the level of the voice
    that came in."""
    x = sosfilt(butter(2, 78, "high", fs=rate, output="sos"), voice.astype(np.float64))
    x = _bell(x, rate, 280, -2.2, 1.0)
    x = _bell(x, rate, 3400, 2.4, 0.8)
    x = _shelf(x, rate, 9500, 2.5)
    # The hiss: where the top is loud beside the rest, take a part of it.
    hiss = sosfiltfilt(butter(2, (5200, 9500), "band", fs=rate, output="sos"), x)
    fast = int(0.008 * rate)
    top, rest = _rms(hiss, fast), _rms(x, fast)
    x = x - hiss * np.clip((top / rest - 0.34) * 1.6, 0, 0.55)
    # Even out the level: what is over the threshold is louder by a third only. The gain looks 5 ms ahead.
    level = _rms(x, int(0.02 * rate))
    loud = level[level > 0.012]
    if len(loud):
        threshold = np.percentile(loud, 55)
        wanted = np.minimum(1.0, (threshold / maximum_filter1d(level, int(0.01 * rate))) ** (1 - 1 / 3))
        x = x * uniform_filter1d(wanted, int(0.05 * rate))
    # The room: short, dark, and different at the two sides.
    n = int(0.42 * rate)
    s, noise = np.arange(n) / rate, np.random.default_rng(7)
    out = np.empty((len(x), 2))
    for side in range(2):
        tail = sosfilt(butter(2, (260, 5200), "band", fs=rate, output="sos"), noise.normal(size=n) * np.exp(-s * 13))
        tail[: int(0.009 * rate)] = 0
        out[:, side] = x + fftconvolve(x, tail / np.sqrt(np.sum(tail * tail)), mode="full")[: len(x)] * 10 ** (-21 / 20)
    where = np.abs(voice) > 0.003
    if where.any():
        out *= np.sqrt(np.mean(voice[where].astype(np.float64) ** 2) / max(1e-12, np.mean(out[where] ** 2) ))
    return out.astype(np.float32)
