#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Probe a movie: its streams, its duration, its chapters, its captions and its hash. Prints JSON.

With a timing in the folder, it also says if the picture of the movie was rendered with that timing.

Usage: probe.py <folder> [movie.mp4 | --draft]. The default is the delivered film in dist/."""
import hashlib
import json
import subprocess

import checks
import film

# QuickTime can refuse a film of 1080p at 60 frames per second above this H.264 level.
HIGHEST_LEVEL = 42


def ffprobe(movie, *args):
    return json.loads(subprocess.run(["ffprobe", "-v", "error", "-of", "json", *args, str(movie)], capture_output=True, text=True, check=True).stdout)


def caption_cues(movie):
    """The number of caption cues in the first subtitle stream."""
    srt = subprocess.run(["ffmpeg", "-v", "error", "-i", str(movie), "-map", "0:s:0", "-f", "srt", "-"], capture_output=True, text=True).stdout
    return srt.count(" --> ")


def in_step(root, movie, info):
    """The picture of the movie against timing.json: if the movie has a valid record of the timing of its
    picture, and where that timing differs from timing.json. None without a timing, and for a movie with no picture."""
    timing = checks.usable_timing(root)
    if timing is None or not any(stream["codec_type"] == "video" for stream in info["streams"]):
        return None
    rendered, why = film.picture_timing(movie)
    return {"record": why or "valid", "differs": film.timeline_changes(rendered, timing) if rendered else []}


def probe(movie, root):
    info = ffprobe(movie, "-show_format", "-show_streams", "-show_chapters")
    streams = {stream["codec_type"]: stream for stream in info["streams"]}
    video, audio, subs = streams.get("video"), streams.get("audio"), streams.get("subtitle")
    return {
        "path": str(movie),
        "sha256": hashlib.sha256(movie.read_bytes()).hexdigest(),
        "size_mb": round(movie.stat().st_size / 1e6, 1),
        "duration_seconds": round(float(info["format"]["duration"]), 2),
        "title": info["format"].get("tags", {}).get("title"),
        "video": video and {key: video.get(key) for key in ("codec_name", "profile", "level", "pix_fmt", "width", "height", "r_frame_rate", "nb_frames")},
        "audio": audio and {key: audio.get(key) for key in ("codec_name", "sample_rate", "channels", "duration")},
        "captions": subs and {"codec_name": subs.get("codec_name"), "cues": caption_cues(movie)},
        "chapters": [{"start": round(float(chapter["start_time"]), 2), "title": chapter.get("tags", {}).get("title")} for chapter in info.get("chapters", [])],
        "timing": in_step(root, movie, info),
    }


def missing(found):
    """What a narrated film has and this movie does not."""
    video, lacks = found["video"], []
    if not video:
        lacks.append("it has no picture")
    elif video.get("codec_name") == "h264" and (video.get("level") or 0) > HIGHEST_LEVEL:
        lacks.append(f"its H.264 level is {video['level']}, and QuickTime can refuse a film over {HIGHEST_LEVEL}")
    if not found["audio"]:
        lacks.append("it has no sound")
    if not found["captions"] or not found["captions"]["cues"]:
        lacks.append("it has no captions")
    if not found["chapters"]:
        lacks.append("it has no chapters")
    if found["timing"] and found["timing"]["record"] != "valid":
        lacks.append(f"it {found['timing']['record']}")
    elif found["timing"] and found["timing"]["differs"]:
        lacks.append(f"its picture was rendered with another timing than timing.json has now ({', '.join(found['timing']['differs'])})")
    return lacks


def main(found, words, options):
    movie = found.movie(words, options)
    result = probe(movie, found.root)
    print(json.dumps(result, indent=1))
    video = result["video"] or {}
    summary = f"{movie.name}: {video.get('width')}x{video.get('height')}, {result['duration_seconds']} s, {len(result['chapters'])} chapters, {(result['captions'] or {}).get('cues', 0)} caption cues"
    lacks = missing(result)
    timing = result["timing"]
    draft = " --draft" if movie.name.endswith("-draft.mp4") else ""
    if timing and timing["record"] != "valid" and len(lacks) == 1:
        # The one thing that is wrong is the record: the line is the line of the resound and sync steps.
        film.verdict(f"{summary}. {film.no_record(found, movie, timing['record'])}", passed=False)
    elif lacks:
        film.verdict(f"{summary}. Not as a narrated film is built: {'; '.join(lacks)}. Build it again: {found.next('build')}{draft}", passed=False)
    else:
        film.verdict(f"{summary}. It has a picture, sound, captions and chapters. Next: {found.next('sync')}{draft}")


if __name__ == "__main__":
    film.run(main, "probe", "probe.py <folder> [movie.mp4 | --draft]", flags=("--draft",), words=True)
