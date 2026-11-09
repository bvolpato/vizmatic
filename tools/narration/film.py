"""What the narration tools share: the checked files of a film, the place of each beat, and how a tool starts.

A film folder holds `script.json` (what the voice says), `timing.json` (the measured voice, written by
`voice.py`), and `film.json` (the particulars of this film). Every tool takes the folder as its first
argument. This module and `checks.py` have no dependency, so each tool can import them whatever its own
dependencies are."""
import hashlib
import json
import os
import subprocess
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path

import checks

# Two times of a timeline are the same time when they differ by less than this: a millisecond.
TICK = 0.001
# A movie ends on a whole frame, so it can be this much longer or shorter than its timeline.
SAME_LENGTH = 0.1


class FilmError(Exception):
    """A mistake in the files of the film, or a result that stops the step. The message says what to do."""


def fail(message):
    raise FilmError(message)


@dataclass(frozen=True)
class Film:
    """A film folder whose files passed the checks of one step."""
    root: Path
    shown: str        # The folder as the person named it, for the commands that a tool suggests.
    given: dict       # film.json as written.
    script: dict      # script.json.
    timing: dict      # timing.json, for a step that reads it.

    @property
    def voice(self):
        return checks.voice_of(self.given)

    @property
    def output(self):
        """The name of the movie in dist/, without its extension."""
        return self.given.get("output", Path(self.given.get("entry", "film.ts")).stem)

    @property
    def mix(self):
        mix = self.given.get("mix", {})
        return {
            # Two films must not share their chords, so the default seed comes from the name of the film.
            "seed": mix.get("seed", zlib.crc32(self.output.encode()) % 1000),
            "levels": {**checks.LEVELS, **mix.get("levels", {})},
            "swells": mix.get("swells"),
            "chimes": mix.get("chimes"),
        }

    def movie(self, words, options, writes=False):
        """The movie that a step reads: the path that the command gives, the draft with --draft, or the
        delivered film in dist/. A movie that is not there is an error that says where a movie is. A step
        that writes the movie takes one inside the folder of the film only."""
        delivered = self.root / "dist" / f"{self.output}.mp4"
        draft = delivered.with_name(f"{self.output}-draft.mp4")
        if words:
            chosen = Path(words[0])
        else:
            chosen = draft if "--draft" in options else delivered
        if writes and not chosen.resolve().is_relative_to(self.root.resolve()):
            fail(f"{chosen} is outside the folder of the film, and a step writes only inside that folder. Copy the movie into {self.shown}/dist, or run the step in the folder of that movie")
        if chosen.exists():
            return chosen
        if chosen == delivered and draft.exists():
            fail(f"dist/{delivered.name} is missing, and a draft is there. Add --draft to read dist/{draft.name}")
        fail(f"{chosen} is missing. Build the film first: {self.next('build', '--draft' if chosen == draft else '')}")

    def next(self, step, more=""):
        """The command of the next step, for the last line of a tool."""
        return f"vizmatic narrated {step} {self.shown}{' ' + more if more else ''}"


def open_film(root, step, looks=None, shown=None):
    """Check the files of a film for one step. Every problem is one line, and all of them stop the step."""
    shown = shown or os.environ.get("VIZMATIC_FOLDER") or "."
    lines, given, written, measured = checks.problems(root, step, looks, shown)
    if lines:
        fail("\n".join(lines))
    return Film(root, shown, given, written, measured)


@dataclass(frozen=True)
class Beat:
    scene: str
    index: int
    start: float      # Where the take starts in the film, in seconds.
    voice_end: float  # Where the voice of the take ends.
    until: float      # The end of the silence after it.
    take: dict        # The entry of timing.json: say, text, wav, duration, hold, words.


@dataclass(frozen=True)
class Timeline:
    beats: list
    scenes: dict      # The start of each scene, by its id, in the order of the film.
    last_word: float  # The end of the last take.
    total: float      # The length of the film: the last word, one gap, and the tail.
    intro: float
    gap: float

    def beat(self, scene, index):
        """One beat. `scene` is an id or a place in the film, and both count from the end when negative."""
        ids = list(self.scenes)
        if isinstance(scene, int):
            if not -len(ids) <= scene < len(ids):
                fail(f"the film has {len(ids)} scenes, and there is no scene {scene}")
            scene = ids[scene]
        if scene not in self.scenes:
            fail(f'the film has no scene "{scene}". The scenes are: {", ".join(ids)}')
        own = [beat for beat in self.beats if beat.scene == scene]
        if not -len(own) <= index < len(own):
            fail(f'the scene "{scene}" has {len(own)} beats, and there is no beat {index}')
        return own[index]


def place(measured):
    """Lay the takes on the timeline of the film, with the numbers that `narration()` uses in the film:
    the lead, then each take and its hold, and one gap after each scene."""
    now, beats, scenes = measured["lead"], [], {}
    for scene in measured["scenes"]:
        scenes[scene["id"]] = now
        for index, take in enumerate(scene["beats"]):
            start = now
            # The same sum as narration() in the film, so that the film and the sound agree on every time.
            now += take["duration"] + take["hold"]
            beats.append(Beat(scene["id"], index, start, start + take["duration"], now, take))
        now += measured["gap"]
    return Timeline(beats, scenes, now - measured["gap"], now + measured["tail"], measured.get("intro", 0.0), measured["gap"])


def arguments(argv, usage, flags=(), values=(), words=False):
    """The folder, the words and the options of a tool. An option that the tool does not have is an error
    that names it, because a mistyped option must not run the step with its defaults."""
    if len(argv) < 2 or argv[1].startswith("-"):
        raise SystemExit(f"Usage: {usage}")
    root = Path(argv[1]).resolve()
    if not root.is_dir():
        raise SystemExit(f"{argv[1]} is not a folder. Give the folder of the film.")
    found, options, rest = [], {}, list(argv[2:])
    known = ", ".join([*flags, *(f"{name} <value>" for name in values)]) or "none"
    while rest:
        word = rest.pop(0)
        if word in flags:
            options[word] = True
        elif word in values:
            if not rest or rest[0].startswith("--"):
                fail(f"{word} needs a value")
            options[word] = rest.pop(0)
        elif word.startswith("--"):
            fail(f"unknown option {word}. The options of this step are: {known}")
        elif not words:
            fail(f'"{word}" is one word too many: this step takes the folder and no other word. Its options are: {known}')
        else:
            found.append(word)
    return root, found, options


def run(main, step, usage, flags=(), values=(), words=False):
    """Start a tool: read its arguments, check the files of the film, and run it. A mistake in a file or a
    program that fails is printed as lines that say what to do, without the stack of the tool."""
    tool = Path(sys.argv[0]).stem
    try:
        root, found, options = arguments(sys.argv, usage, flags, values, words)
        looks = os.environ.get("VIZMATIC_LOOKS")
        return main(open_film(root, step, looks.split(",") if looks else None, None if os.environ.get("VIZMATIC_FOLDER") else sys.argv[1]), found, options)
    except FilmError as error:
        raise SystemExit("\n".join(f"{tool}: {line}" for line in str(error).split("\n")))
    except subprocess.CalledProcessError as error:
        # A program whose output the tool reads keeps its message. Its last line says what went wrong.
        said = (error.stderr or "").strip().splitlines() if isinstance(error.stderr, str) else []
        raise SystemExit(f"{tool}: {error.cmd[0]} failed with exit code {error.returncode}{': ' + said[-1] if said else '. Its message is above'}")


def verdict(line, passed=True):
    """The last line of a step: what passed, what did not, and the next command. It goes to the error
    stream, so that the output of a step that prints data stays data. A check that did not pass ends the
    step with a failure, so that a script or an agent that reads the exit code does not go on."""
    sys.stdout.flush()  # What the step printed comes first, whatever the two streams are joined to.
    print(f"{Path(sys.argv[0]).stem}: {line}", file=sys.stderr, flush=True)
    if not passed:
        raise SystemExit(1)


def file_hash(path):
    with open(path, "rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def write_json(path, content):
    """Write a small file in one step: a reader never sees half of it."""
    part = path.with_name(f".{path.name}.{os.getpid()}")
    part.write_text(json.dumps(content) + "\n")
    os.replace(part, path)


# ── The record of a mix: what narration.wav was made from ────────────────────────────────────────

def mix_record(root):
    return root / "audio" / "mix.json"


def mix_inputs(found):
    """A short name for all that a mix is made from: the timing, the mix of film.json, and the tools that mix."""
    tools = hashlib.sha256(b"".join((Path(__file__).parent / name).read_bytes() for name in ("mix.py", "soundbed.py"))).hexdigest()
    return hashlib.sha256(json.dumps([found.timing, found.mix, tools], sort_keys=True).encode()).hexdigest()[:16]


def write_mix_record(found):
    """Say beside the takes what narration.wav was made from, so that a build can leave a mix that is current."""
    write_json(mix_record(found.root), {"inputs": mix_inputs(found), "sound": file_hash(found.root / "narration.wav")})


def mix_state(found):
    """Is narration.wav the mix of this timing and of the mix that film.json asks for? Returns the answer, and why."""
    sound = found.root / "narration.wav"
    if not sound.exists():
        return False, "narration.wav is missing"
    try:
        record = json.loads(mix_record(found.root).read_text())
        inputs, written = record["inputs"], record["sound"]
    except (OSError, ValueError, KeyError, TypeError):
        return False, "no record says what narration.wav was made from"
    if inputs != mix_inputs(found):
        return False, "the timing or the mix of film.json changed after the last mix"
    if written != file_hash(sound):
        return False, "narration.wav is not the file that the last mix wrote"
    return True, "narration.wav is the mix of this timing and of this film.json"


# ── The record of a picture: the timing that a movie was rendered with ───────────────────────────

def picture_of(movie):
    """A short name for the picture of a movie: the hash of its video packets. A new sound does not change it."""
    said = subprocess.run(["ffmpeg", "-v", "error", "-i", str(movie), "-map", "0:v:0", "-c", "copy", "-f", "md5", "-"], capture_output=True, text=True, check=True).stdout
    return said.strip().removeprefix("MD5=")


def picture_record(movie):
    return movie.with_name(f"{movie.stem}.timing.json")


def write_picture_record(movie, timing):
    """Keep with a movie the timing that its picture was rendered with. The hash of the picture ties the
    record to this movie: beside another render, the record does not count."""
    write_json(picture_record(movie), {"picture": picture_of(movie), "timing": timing})


def timeline_changes(picture, sound):
    """Where the timing of a picture and the timing of a sound differ, scene by scene. A timing with the
    same length and other scene starts is another timing: the picture and the captions follow the voice."""
    a, b = place(picture), place(sound)
    if list(a.scenes) != list(b.scenes):
        return [f"the scenes ({', '.join(a.scenes)} in the picture, {', '.join(b.scenes)} in timing.json)"]
    found = []
    for scene in a.scenes:
        if abs(a.scenes[scene] - b.scenes[scene]) > TICK:
            found.append(f"{scene} (starts at {a.scenes[scene]:.2f} s in the picture, and at {b.scenes[scene]:.2f} s in timing.json)")
            continue
        ours, theirs = [beat for beat in a.beats if beat.scene == scene], [beat for beat in b.beats if beat.scene == scene]
        if len(ours) != len(theirs):
            found.append(f"{scene} ({len(ours)} beats in the picture, {len(theirs)} in timing.json)")
            continue
        for old, new in zip(ours, theirs):
            if abs(old.start - new.start) > TICK or abs(old.voice_end - new.voice_end) > TICK:
                found.append(f"{scene}/{old.index} (from {old.start:.2f} to {old.voice_end:.2f} s in the picture, from {new.start:.2f} to {new.voice_end:.2f} s in timing.json)")
                break
            if old.take.get("say") != new.take.get("say") or old.take.get("words") != new.take.get("words"):
                found.append(f"{scene}/{old.index} (other words, or other times of its words)")
                break
    if not found and abs(a.total - b.total) > TICK:
        found.append(f"the end of the film ({a.total:.2f} s in the picture, {b.total:.2f} s in timing.json)")
    return found


def picture_timing(movie):
    """The timing that the picture of a movie was rendered with, from the record that the build keeps beside
    it. Without a record that is valid for this movie file, it returns None and the reason. A record is valid
    when it is whole and has the hash of the picture that is there: a render that stopped before its record,
    or a record that was deleted, leaves a movie that nothing vouches for."""
    path = picture_record(movie)
    if not path.exists():
        return None, "has no record of the timing of its picture"
    try:
        record = json.loads(path.read_text())
        kept, rendered = record["picture"], record["timing"]
    except (OSError, ValueError, KeyError, TypeError):
        return None, f"has a record of the timing of its picture, {path.name}, that is not whole"
    if checks.timing_defect(rendered) is not None:
        return None, f"has a record of the timing of its picture, {path.name}, that is not whole"
    if kept != picture_of(movie):
        return None, f"has the record of another picture beside it, {path.name}"
    return rendered, None


def no_record(found, movie, why):
    """What a step says of a movie with no valid record. The chapters of a movie hold the starts of its scenes
    only, so they do not say that the picture fits a timing: only a full render does."""
    draft = " --draft" if movie.name.endswith("-draft.mp4") else ""
    return f"{movie.name} {why}, so nothing says which timing its picture was rendered with. Build it again, with a full render: {found.next('build')}{draft}"
