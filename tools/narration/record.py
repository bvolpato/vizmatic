#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Keep with a movie the timing that its picture was rendered with, as <name>.timing.json beside it.

The build runs this step after each render. The resound step and the sync step read the record: a sound
of another timing must not go into this movie, because the picture and the captions follow the voice.

The build deletes the old record before it renders, and writes the new one after the render. So a build
that stops at any point leaves a movie with no record, and never a new picture beside an old record.

Usage: record.py <folder> <movie.mp4> --timing <sha256 of timing.json before the render>"""
import film


def main(found, words, options):
    if len(words) != 1:
        film.fail("give the movie that was rendered: record.py <folder> <movie.mp4>")
    movie = found.movie(words, options, writes=True)
    before = options.get("--timing")
    if not before:
        film.fail("give the hash of timing.json as it was before the render: --timing <sha256>. Without it, nothing says that this timing is the timing of the picture")
    # The render read timing.json when it started. A file that changed since then is not the timing of this picture.
    if film.file_hash(found.root / "timing.json") != before:
        film.fail(f"timing.json changed while the film was rendered, so nothing says which timing the picture of {movie.name} has. Build again: {found.next('build')}")
    film.write_picture_record(movie, found.timing)
    film.verdict(f"{film.picture_record(movie).name} is written beside {movie.name}: the timing that its picture was rendered with.")


if __name__ == "__main__":
    film.run(main, "record", "record.py <folder> <movie.mp4> --timing <sha256>", values=("--timing",), words=True)
