#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Print where each beat of the voice starts and ends in the film.

Usage: beats.py <folder> [scene ...]             one line for each beat: scene, beat, start, end of the voice, text
       beats.py <folder> --words <scene> [beat]  the spoken words of a scene with their times, to choose the phrase of a cue"""
import film


def print_words(line, scene, index):
    for beat in line.beats:
        if beat.scene != scene or (index is not None and beat.index != index):
            continue
        print(f"--- {beat.scene} {beat.index}  {beat.take['duration']:.2f}s + hold {beat.take['hold']}")
        print(" ".join(f"{word['text']}@{word['start']:.1f}" for word in beat.take["words"]))


def print_beats(line, scenes):
    for beat in line.beats:
        if not scenes or beat.scene in scenes:
            print(f"{beat.scene:10s} {beat.index} {beat.start:7.2f} {beat.voice_end:7.2f}  {beat.take['say'][:90]}")
    print(f"end {line.last_word:.2f}")


def main(found, names, options):
    line = film.place(found.timing)
    for name in names if "--words" not in options else names[:1]:
        line.beat(name, 0)  # A scene that the film does not have is a mistake, not an empty list.
    if "--words" in options:
        if not names:
            film.fail("--words needs a scene: beats.py <folder> --words <scene> [beat]")
        if len(names) > 1 and not names[1].isdigit():
            film.fail(f'"{names[1]}" is not a beat. Give its place in the scene, such as 0')
        print_words(line, names[0], int(names[1]) if len(names) > 1 else None)
    else:
        print_beats(line, names)


if __name__ == "__main__":
    film.run(main, "beats", "beats.py <folder> [scene ...] | --words <scene> [beat]", flags=("--words",), words=True)
