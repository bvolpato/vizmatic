#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["faster-whisper", "numpy", "soundfile", "scipy"]
# ///
"""Check that a movie is in step with the timing of the film: its picture first, then its sound.

The picture: the build keeps the timing of a picture beside its movie, and this step compares it with
timing.json, scene by scene. A movie whose sound was replaced after the timing changed has the right
sound and a picture that is early or late, and a transcript of the sound alone would not show it.

The sound: the step transcribes the sound of the movie, and compares where each beat is heard with the
timeline. It writes the sound of the movie to stills/movie.wav, which lag.py reads.

Usage: sync.py <folder> [movie.mp4 | --draft]. The default is the delivered film in dist/."""
import re
import subprocess

import film

# A transcript gives the time of a word to about a second. A beat that is heard farther from its place
# than this is not where the timeline has it.
NEAR = 2.0


def letters(word):
    return re.sub(r"[^a-z]", "", word.lower())


def heard_words(root, movie):
    """Each word that a transcript of the movie hears, with its time."""
    import soundfile as sf
    from faster_whisper import WhisperModel

    (root / "stills").mkdir(exist_ok=True)
    sound = root / "stills" / "movie.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(movie), "-ac", "1", "-ar", "16000", str(sound)], check=True)
    audio, _ = sf.read(sound, dtype="float32")
    model = WhisperModel("small.en", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(audio, beam_size=5, language="en", word_timestamps=True)
    return [(word.word.strip().lower().strip(".,?!:"), word.start) for segment in segments for word in segment.words]


def offsets(line, heard):
    """For each beat: heard time minus planned time of its first word, or None when the word is not heard
    within 3 seconds of its place."""
    found = {}
    for beat in line.beats:
        if not beat.take["words"]:
            continue
        first = letters(beat.take["say"].split()[0])
        near = [time for word, time in heard if abs(time - beat.start) < 3 and letters(word) == first]
        found[f"{beat.scene}/{beat.index}"] = min((time - (beat.start + beat.take["words"][0]["start"]) for time in near), key=abs) if near else None
    return found


def away(by_beat):
    """The beats that are not heard near their place: not heard at all, or farther than the limit."""
    return [name for name, offset in by_beat.items() if offset is None or abs(offset) > NEAR]


def main(found, words, options):
    movie = found.movie(words, options)
    draft = " --draft" if movie.name.endswith("-draft.mp4") else ""
    rendered, why = film.picture_timing(movie)
    if rendered is None:
        film.verdict(film.no_record(found, movie, why), passed=False)
    differ = film.timeline_changes(rendered, found.timing)
    if differ:
        film.verdict(f"the picture of {movie.name} was rendered with another timing than timing.json has now: {', '.join(differ)}. "
                     f"Its picture and its captions are not in step with the voice of this timing. Build it again: {found.next('build')}{draft}", passed=False)
    import numpy as np

    line = film.place(found.timing)
    heard = heard_words(found.root, movie)
    if not heard:
        film.fail(f"no word was heard in {movie}. Check that the movie has a sound track")
    by_beat = offsets(line, heard)
    matched = [offset for offset in by_beat.values() if offset is not None]
    if not matched:
        film.fail(f"no beat of the script was heard in {movie}. Check that the movie has the sound of this film")
    print("beats matched", len(matched), "of", len(line.beats), "; offset between planned and heard, seconds: mean", round(float(np.mean(matched)), 3), "max", round(float(np.max(np.abs(matched))), 3))
    print("words heard", len(heard), "last at", round(heard[-1][1], 1))
    print("end:", " ".join(word for word, _ in heard[-12:]))
    far = away(by_beat)
    if far:
        film.verdict(f"{len(far)} of {len(by_beat)} beats are not heard within {NEAR:g} s of their place: {', '.join(far)}. "
                     f"The movie does not have the sound of this timing: run {found.next('mix')}, then build again or run {found.next('resound')}{draft}", passed=False)
    film.verdict(f"The picture was rendered with this timing, and all {len(by_beat)} beats are heard within {NEAR:g} s of their place, which is as near as a transcript can say. Next, to a sample: {found.next('lag')}")


if __name__ == "__main__":
    film.run(main, "sync", "sync.py <folder> [movie.mp4 | --draft]", flags=("--draft",), words=True)
