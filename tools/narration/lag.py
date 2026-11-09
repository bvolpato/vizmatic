#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["numpy", "scipy", "soundfile"]
# ///
"""For each take of the voice, find the lag that best matches the sound of the movie at the planned time.

A transcript gives the time of a word to about a second. This check gives the lag of each take to a
sample, so it shows a sound track that is late by a frame. Run sync.py first: it writes stills/movie.wav.

Usage: lag.py <folder>"""
import film

RATE = 16000
# One frame of a film at 60 frames per second is 0.017 s. A take that is farther off than this is late or early.
ON_TIME = 0.02


def lag_of(movie, take, start):
    """Seconds between where the take is planned and where the movie has it. It looks one second on each side."""
    import numpy as np
    from scipy.signal import correlate

    first = int((start - 1.0) * RATE)
    window = movie[max(0, first): first + len(take) + 2 * RATE]
    match = correlate(window, take, mode="valid")
    return (int(np.argmax(np.abs(match))) + max(0, first)) / RATE - start


def main(found, _words, _options):
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly

    sound = found.root / "stills" / "movie.wav"
    if not sound.exists():
        film.fail(f"stills/movie.wav is missing. Run the sync step first, which writes the sound of the movie there: {found.next('sync')}")
    movie, rate = sf.read(sound, dtype="float32")
    assert rate == RATE, "sync.py writes the sound of the movie at 16 kHz"
    lags = []
    for beat in film.place(found.timing).beats:
        take, take_rate = sf.read(found.root / "audio" / beat.take["wav"], dtype="float32")
        # The first 4 seconds of a take are enough to find it.
        take = resample_poly(take, RATE, take_rate).astype(np.float32)[: RATE * 4]
        lag = lag_of(movie, take, beat.start)
        lags.append((abs(lag), lag, f"{beat.scene}/{beat.index}"))
    lags.sort(reverse=True)
    print("takes", len(lags), "largest lags (s):", [(name, round(lag, 3)) for _, lag, name in lags[:5]], "mean abs", round(float(np.mean([size for size, _, _ in lags])), 4))
    off = [f"{name} ({lag:+.3f} s)" for size, lag, name in lags if size > ON_TIME]
    if off:
        film.verdict(f"{len(off)} of {len(lags)} takes are not at their planned time in the movie that sync read: {', '.join(off[:8])}. "
                     f"The movie has another sound than this timing: run {found.next('mix')}, then build again or run {found.next('resound')}", passed=False)
    else:
        film.verdict(f"all {len(lags)} takes are within {ON_TIME} s of their planned time in the movie that sync read. Next: {found.next('probe')}")


if __name__ == "__main__":
    film.run(main, "lag", "lag.py <folder>")
