#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Put a new narration.wav into a rendered movie, without a new render of the picture.

Use it after a change that touches only the sound: the levels, the seed, a chime. The timing of the
voice must not change, because the picture and the captions follow the voice. So the step compares the
timing that the picture was rendered with and the timing of the new sound, scene by scene, and stops
when they differ. The build keeps the timing of a picture beside its movie, as <name>.timing.json. A
movie with no record that is valid for its picture is refused too: build it again.

The picture and the captions are copied as they are. The title and the chapters are read from the movie
and written again. The new movie is written under a name of its own, it is checked (its streams, its
length, its chapters and its picture), and only then one rename puts it in the place of the old one.

Usage: resound.py <folder> [movie.mp4 | --draft]. The default is the delivered film in dist/."""
import json
import os
import subprocess
import tempfile
from pathlib import Path

import film


def ffprobe(movie, *args):
    return json.loads(subprocess.run(["ffprobe", "-v", "error", "-of", "json", *args, str(movie)], capture_output=True, text=True, check=True).stdout)


def escape(value):
    """A value of an FFmpeg metadata file: these four characters and a line break need a backslash."""
    return "".join("\\" + char if char in "=;#\\\n" else char for char in value)


def metadata(info):
    """The title and the chapters of the movie, as an FFmpeg metadata file."""
    lines = [";FFMETADATA1"]
    title = info["format"].get("tags", {}).get("title")
    if title:
        lines.append(f"title={escape(title)}")
    for chapter in info.get("chapters", []):
        start, end = round(float(chapter["start_time"]) * 1000), round(float(chapter["end_time"]) * 1000)
        lines += ["[CHAPTER]", "TIMEBASE=1/1000", f"START={start}", f"END={end}", f"title={escape(chapter.get('tags', {}).get('title', ''))}"]
    return "\n".join(lines) + "\n"


def chapter_track_entries(movie):
    """The entries of the chapter track of an MP4, which is its first data stream. A broken track has fewer than the film has chapters."""
    streams = ffprobe(movie, "-select_streams", "d:0", "-show_entries", "stream=nb_frames").get("streams", [])
    return int(streams[0].get("nb_frames", 0)) if streams else 0


def same_length(movie_seconds, sound_seconds, shown):
    """Stop when the new sound is not as long as the movie: the voice moved, and the picture follows the voice."""
    if abs(movie_seconds - sound_seconds) > film.SAME_LENGTH:
        film.fail(f"the movie is {movie_seconds:.2f} s long and narration.wav is {sound_seconds:.2f} s long. The timing of the voice changed, "
                  f"so the picture needs a new render: vizmatic narrated build {shown}. The movie was not replaced")


def temporary(movie, suffix):
    """A file of this run alone, beside the movie. Two runs at once, such as one for the delivered movie and
    one for the draft, must never write to one file."""
    handle, name = tempfile.mkstemp(dir=movie.parent, prefix=f".{movie.stem}.", suffix=suffix)
    os.close(handle)
    return Path(name)


def kinds(info):
    """How many streams of each kind a movie has."""
    found = {}
    for stream in info.get("streams", []):
        found[stream["codec_type"]] = found.get(stream["codec_type"], 0) + 1
    return found


def defects(before, after, picture_before, picture_after, chapter_track):
    """What is wrong with the new movie, against the movie that it replaces: `before` and `after` are what
    ffprobe says of the two. An empty list means that every stream, the length, the chapters and the
    picture are as they were, and that the movie has sound."""
    found = []
    had, has = kinds(before), kinds(after)
    for kind in ("video", "subtitle"):
        if has.get(kind, 0) != had.get(kind, 0):
            found.append(f"it has {has.get(kind, 0)} {kind} streams, and the movie has {had.get(kind, 0)}")
    if has.get("audio", 0) != 1:
        found.append(f"it has {has.get('audio', 0)} sound streams, and a movie has 1")
    length = float(after.get("format", {}).get("duration", 0))
    if abs(length - float(before["format"]["duration"])) > film.SAME_LENGTH:
        found.append(f"it is {length:.2f} s long, and the movie is {float(before['format']['duration']):.2f} s long")
    chapters = lambda info: [(round(float(chapter["start_time"]), 3), chapter.get("tags", {}).get("title")) for chapter in info.get("chapters", [])]
    wanted, written = chapters(before), chapters(after)
    if written != wanted or chapter_track != len(wanted):
        found.append(f"it has {min(len(written), chapter_track)} chapters, and the movie has {len(wanted)}")
    if picture_after != picture_before:
        found.append("its picture is not the picture of the movie")
    return found


def millisecond_scale():
    """The option that sets the time scale of the movie header to one millisecond.

    The chapter track of an MP4 counts in that scale. FFmpeg 7 and later take for it the least common
    multiple of the time scales of the tracks: 48,000,000 for a film with a picture, sound at 48 kHz and
    captions. A chapter longer than 44 seconds then does not fit in 32 bits, and the chapter track breaks.
    One millisecond is the scale that FFmpeg wrote up to version 6, and it holds a chapter of any length.
    An FFmpeg that has no such option, which is version 4, writes one millisecond always."""
    listed = subprocess.run(["ffmpeg", "-hide_banner", "-h", "muxer=mp4"], capture_output=True, text=True).stdout
    return ["-movie_timescale", "1000"] if "movie_timescale" in listed else []


def aac_options():
    """Disable noise substitution when supported, to avoid decoder-dependent spikes."""
    listed = subprocess.run(["ffmpeg", "-hide_banner", "-h", "encoder=aac"], capture_output=True, text=True)
    return ["-aac_pns", "0"] if listed.returncode == 0 and "-aac_pns" in listed.stdout else []


def remux(movie, sound, info, made):
    """Write the movie again with the new sound, into `made`. The picture is copied as it is."""
    notes = temporary(movie, ".resound.txt")
    try:
        notes.write_text(metadata(info))
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "warning", "-i", str(movie), "-i", str(sound), "-f", "ffmetadata", "-i", str(notes),
            "-map", "0:v:0", "-map", "1:a:0", "-map", "0:s?", "-map_metadata", "2", "-map_chapters", "2",
            "-af", f"asetpts=PTS-STARTPTS,apad,atrim=duration={info['format']['duration']}",
            "-c:v", "copy", "-c:s", "copy",
            "-c:a", "aac", "-b:a", "384k", "-ar", "48000", "-ac", "2", *aac_options(), *millisecond_scale(), "-movflags", "+faststart", "-f", "mp4", str(made),
        ], check=True)
    finally:
        notes.unlink(missing_ok=True)


def main(found, words, options):
    movie = found.movie(words, options, writes=True)
    draft = " --draft" if movie.name.endswith("-draft.mp4") else ""
    sound = found.root / "narration.wav"
    if not sound.exists():
        film.fail(f"narration.wav is missing. Run the mix step first: {found.next('mix')}")
    current, why = film.mix_state(found)
    if not current:
        film.fail(f"{why}, so the sound is not known to be the sound of timing.json. Run the mix step first: {found.next('mix')}. The movie was not replaced")
    info = ffprobe(movie, "-show_format", "-show_streams", "-show_chapters")
    same_length(float(info["format"]["duration"]), float(ffprobe(sound, "-show_format")["format"]["duration"]), found.shown)
    rendered, why = film.picture_timing(movie)
    if rendered is None:
        film.fail(f"{film.no_record(found, movie, why)}. The movie was not replaced")
    differ = film.timeline_changes(rendered, found.timing)
    if differ:
        film.fail(f"the picture of {movie.name} was rendered with another timing than timing.json has now: {', '.join(differ)}. The voice moved, "
                  f"and the picture and the captions follow the voice, so the picture needs a new render: {found.next('build')}{draft}. The movie was not replaced")
    picture = film.picture_of(movie)
    made = temporary(movie, ".resound.mp4")
    try:
        remux(movie, sound, info, made)
        wrong = defects(info, ffprobe(made, "-show_format", "-show_streams", "-show_chapters"), picture, film.picture_of(made), chapter_track_entries(made))
        if wrong:
            film.fail(f"the movie with the new sound is not right: {'; '.join(wrong)}. {movie.name} was not replaced")
        # One rename: a reader of the movie sees the old file or the new one, and never a part of one.
        os.replace(made, movie)
    finally:
        made.unlink(missing_ok=True)
    film.verdict(f"{movie.name} has the new sound. The new file was checked before it took the place of the old one: its picture, its captions, "
                 f"its {len(info.get('chapters', []))} chapters and its length are as they were. Its picture was rendered with the timing of timing.json, "
                 f"by the record that the build keeps beside it. Next: {found.next('sync')}{draft}")


if __name__ == "__main__":
    film.run(main, "resound", "resound.py <folder> [movie.mp4 | --draft]", flags=("--draft",), words=True)
