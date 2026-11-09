"""The checks of the files of a film, in one place: film.json, script.json, and the timing against the script.

Every step runs them before it does anything, so a mistake in a file is one line that names the file,
the field, what is wrong and what is allowed, and never a stack of the tool that met it first."""
import hashlib
import json
import re
import shutil
from pathlib import Path

# A scene id goes into the names of files, so it has letters, digits and hyphens only.
SCENE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]*\Z")
MOVIE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\Z")
# A cue id is a name that a scene types.
CUE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*\Z")
# The voice step speaks American English, and these are the two families of Kokoro voices for it.
VOICE_NAME = re.compile(r"a[fm]_[a-z]+\Z")

VOICE = {"name": "af_heart", "speed": 1.12}
LEVELS = {"under": -22.0, "pause": -15.0, "card": -10.0}
TIMELINE = {"intro": 0.0, "pause": 0.6, "gap": 0.4, "tail": 0.5}
RENDER = {"workers": 6, "draftWorkers": 3}
HOLD = 0.25
ANCHOR_KEYS = {"at", "intro", "scene", "beat", "word", "last", "edge", "offset"}
SWELL_KEYS = ANCHOR_KEYS | {"width", "db", "after"}
CHIME_KEYS = ANCHOR_KEYS | {"gain", "notes", "until", "full"}

# What each step reads beside film.json and script.json: the timing, the takes of the voice, and programs.
# A build starts with the voice, so it does not need a timing. Its later steps do: "render" is the build
# after its voice step, and "record" writes the timing of a picture beside its movie.
STEPS = {
    "voice": {},
    "draft": {},
    "build": {"programs": ["ffmpeg", "ffprobe"]},
    "render": {"takes": True, "programs": ["ffmpeg", "ffprobe"]},
    "record": {"timing": True, "programs": ["ffmpeg"]},
    "mix": {"takes": True, "programs": ["ffmpeg"]},
    "check": {"timing": True},
    "stills": {"timing": True},
    "sheet": {"timing": True},
    "beats": {"timing": True},
    "transcribe": {"takes": True},
    "sync": {"takes": True, "programs": ["ffprobe", "ffmpeg"]},
    "lag": {"takes": True},
    "probe": {"programs": ["ffprobe", "ffmpeg"]},
    "resound": {"takes": True, "programs": ["ffprobe", "ffmpeg"]},
}
# A WAV file with no sound is its header alone: 44 bytes.
EMPTY_WAV = 44


class Report:
    """The problems of the files of a film, one line each."""

    def __init__(self):
        self.lines = []

    def add(self, file, field, wrong, allowed):
        self.lines.append(f"{file}: {field}: {wrong}. {allowed}")


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def whole(value):
    return isinstance(value, int) and not isinstance(value, bool)


def shown(value):
    return json.dumps(value) if not isinstance(value, (dict, list)) else type(value).__name__


def read(path, report, missing=None):
    """The content of a JSON file, or None with a problem in the report."""
    if not path.exists():
        if missing:
            report.add(path.name, "the file", "is missing", missing)
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as error:
        report.add(path.name, f"line {error.lineno}", f"is not valid JSON ({error.msg})", "Correct the file")
        return None


def keys(given, known, file, field, report):
    for key in sorted(set(given) - set(known)):
        report.add(file, f"{field}{key}", "unknown key", f"The keys are: {', '.join(sorted(known))}")


def check_anchor(spec, file, field, extra, report):
    """One time of the mix: in the film, as a share of the title card, or at a beat."""
    if not isinstance(spec, dict):
        return report.add(file, field, f"{shown(spec)} is not an object", 'Give a time, such as { "scene": "hook", "beat": 0 }')
    keys(spec, ANCHOR_KEYS | extra, file, f"{field}.", report)
    given = [key for key in ("at", "intro", "scene") if key in spec]
    if len(given) != 1:
        report.add(file, field, f"has {' and '.join(given) or 'no time'}", 'Give one of "at", "intro" and "scene"')
    rules = {
        "at": (number, "a time in seconds, and a negative time counts from the end"),
        "intro": (lambda v: number(v) and 0 <= v <= 1, "a share of the title card, from 0 to 1"),
        "scene": (lambda v: isinstance(v, str) or whole(v), "the id of a scene, or its place in the film such as 0 and -1"),
        "beat": (whole, "the place of a beat in its scene, such as 0 and -1"),
        "word": (lambda v: isinstance(v, str) and v, "a word that the beat says"),
        "last": (lambda v: isinstance(v, bool), "true or false"),
        "edge": (lambda v: v in ("start", "end"), '"start" or "end"'),
        "offset": (number, "seconds"),
        "width": (lambda v: number(v) and v > 0, "seconds, more than 0"),
        "db": (number, "decibels under the voice, such as -10"),
        "gain": (lambda v: number(v) and v > 0, "a number over 0, such as 0.11"),
        "notes": (lambda v: isinstance(v, list) and 1 <= len(v) <= 4 and all(number(n) and n > 0 for n in v), "one to four frequencies in hertz"),
        "full": (lambda v: isinstance(v, bool), "true or false"),
    }
    for key, (valid, allowed) in rules.items():
        if key in spec and not valid(spec[key]):
            report.add(file, f"{field}.{key}", f"{shown(spec[key])} is not allowed", f"Give {allowed}")
    for key in ("until", "after"):
        if key in spec and key in extra:
            check_anchor(spec[key], file, f"{field}.{key}", set(), report)


def check_film(given, root, looks, report):
    """film.json: the particulars of one film. Every key has a default."""
    file = "film.json"
    if not isinstance(given, dict):
        return report.add(file, "the file", "does not hold one object", 'Give an object, such as { "output": "My-Film" }')
    keys(given, {"entry", "output", "look", "voice", "check", "render", "before", "mix"}, file, "", report)
    entry = given.get("entry", "film.ts")
    if not isinstance(entry, str) or not entry or Path(entry).is_absolute() or ".." in Path(entry).parts:
        report.add(file, "entry", f"{shown(entry)} is not a file of the folder", 'Give the film file, such as "film.ts"')
    elif not (root / entry).is_file():
        report.add(file, "entry", f"{entry} is missing", 'Give the film file, such as "film.ts"')
    if "output" in given and not (isinstance(given["output"], str) and MOVIE_NAME.match(given["output"])):
        report.add(file, "output", f"{shown(given['output'])} is not a name for a movie", 'Give letters, digits, hyphens, dots and underscores, without a folder and without .mp4, such as "My-Film"')
    elif "output" in given and given["output"].endswith("-draft"):
        # The draft of a film has the name of the film and "-draft". With this name, the delivered movie would pass for a draft.
        report.add(file, "output", f"{shown(given['output'])} ends in \"-draft\", which is the name of the draft of a film", f"Give the name of the delivered movie, such as {shown(given['output'][:-6] or 'My-Film')}")
    if "look" in given and (not isinstance(given["look"], str) or (looks and given["look"] not in looks)):
        report.add(file, "look", f"{shown(given['look'])} is not a look", f"The looks are: {', '.join(looks) if looks else 'run vizmatic looks'}")
    voice = given.get("voice", {})
    if not isinstance(voice, dict):
        report.add(file, "voice", f"{shown(voice)} is not an object", 'Give { "name": "af_heart", "speed": 1.12 }')
    else:
        keys(voice, VOICE, file, "voice.", report)
        if "name" in voice and not (isinstance(voice["name"], str) and VOICE_NAME.match(voice["name"])):
            report.add(file, "voice.name", f"{shown(voice['name'])} is not a voice of the voice step", 'Give a Kokoro voice of American English: its name starts with "af_" or "am_", such as "af_heart"')
        if "speed" in voice and not (number(voice["speed"]) and 0.5 <= voice["speed"] <= 2):
            report.add(file, "voice.speed", f"{shown(voice['speed'])} is not a speed", "Give a number from 0.5 to 2, such as 1.12")
    if "check" in given and not (isinstance(given["check"], list) and all(isinstance(word, str) for word in given["check"])):
        report.add(file, "check", "is not a list of words", 'Give options of the check, such as ["--text-margin", "30"]')
    render = given.get("render", {})
    if not isinstance(render, dict):
        report.add(file, "render", f"{shown(render)} is not an object", 'Give { "workers": 6, "draftWorkers": 3 }')
    else:
        keys(render, RENDER, file, "render.", report)
        for key in RENDER:
            if key in render and not (whole(render[key]) and render[key] > 0):
                report.add(file, f"render.{key}", f"{shown(render[key])} is not a number of threads", "Give a whole number over 0")
    before = given.get("before", [])
    if not (isinstance(before, list) and all(isinstance(command, list) and command and all(isinstance(word, str) for word in command) for command in before)):
        report.add(file, "before", "is not a list of commands", 'Give each command as a list of words, such as [["uv", "run", "data/make_numbers.py"]]')
    check_mix(given.get("mix", {}), file, report)


def check_mix(mix, file, report):
    if not isinstance(mix, dict):
        return report.add(file, "mix", f"{shown(mix)} is not an object", 'Give { "seed": 7 }')
    keys(mix, {"seed", "levels", "swells", "chimes"}, file, "mix.", report)
    if "seed" in mix and not (whole(mix["seed"]) and mix["seed"] >= 0):
        report.add(file, "mix.seed", f"{shown(mix['seed'])} is not a seed", "Give a whole number, 0 or more, such as 7")
    levels = mix.get("levels", {})
    if not isinstance(levels, dict):
        report.add(file, "mix.levels", f"{shown(levels)} is not an object", 'Give { "under": -22, "pause": -15, "card": -10 }')
    else:
        keys(levels, LEVELS, file, "mix.levels.", report)
        for key in LEVELS:
            if key in levels and not (number(levels[key]) and levels[key] <= 0):
                report.add(file, f"mix.levels.{key}", f"{shown(levels[key])} is not a level", f"Give decibels under the voice, 0 or less, such as {LEVELS[key]:g}")
    for name, extra in (("swells", {"width", "db", "after"}), ("chimes", {"gain", "notes", "until", "full"})):
        entries = mix.get(name, [])
        if not isinstance(entries, list):
            report.add(file, f"mix.{name}", f"{shown(entries)} is not a list", "Give a list of times")
            continue
        for index, spec in enumerate(entries):
            check_anchor(spec, file, f"mix.{name}[{index}]", extra, report)


def check_script(written, report):
    """script.json: what the voice says, one entry for each scene and beat."""
    file = "script.json"
    if not isinstance(written, dict):
        return report.add(file, "the file", "does not hold one object", 'Give an object with "scenes"')
    if "title" in written:
        report.add(file, "title", "no step reads this key", "Remove it: the title of the film is in the film file, narrated({ title })")
    keys({key: 0 for key in written if key != "title"}, {"timeline", "scenes", "pronounce"}, file, "", report)
    check_timeline(written.get("timeline", {}), file, report)
    pronounce = written.get("pronounce", {})
    if not isinstance(pronounce, dict) or not all(isinstance(word, str) and word and isinstance(sub, str) and sub for word, sub in pronounce.items()):
        report.add(file, "pronounce", "is not a map from a word to its spoken form", 'Give an object such as { "800": "eight hundred" }')
        pronounce = {}
    scenes = written.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        return report.add(file, "scenes", "is missing or empty", "Give a list with one scene or more")
    seen = set()
    for index, scene in enumerate(scenes):
        check_scene(scene, f"scenes[{index}]", seen, file, report, pronounce)


def check_timeline(line, file, report):
    if not isinstance(line, dict):
        return report.add(file, "timeline", f"{shown(line)} is not an object", 'Give { "intro": 2.4, "pause": 0.6, "gap": 0.4, "tail": 0.5 }')
    if "lead" in line:
        report.add(file, "timeline.lead", 'this key has the name "pause" now', 'Rename it: "pause" is the silence between the title card and the first word, and "lead" is the time of the first word in timing.json')
    keys({key: 0 for key in line if key != "lead"}, TIMELINE, file, "timeline.", report)
    for key in TIMELINE:
        if key in line and not (number(line[key]) and line[key] >= 0):
            report.add(file, f"timeline.{key}", f"{shown(line[key])} is not a time", "Give seconds, 0 or more")


def words_of(text):
    """The words of a text as a cue of the film reads them: its letters and its digits, without case and
    punctuation. A period stays inside a number, such as 3.8."""
    return [word.strip(".") for word in re.sub(r"[^\w.]|_", " ", text.lower()).split() if word.strip(".")]


def says(text, phrase):
    """How many times a text has the words of a phrase, one after another."""
    words, wanted = words_of(text), words_of(phrase)
    return sum(words[at:at + len(wanted)] == wanted for at in range(len(words) - len(wanted) + 1)) if wanted else 0


def check_cues(cues, beat, where, ids, pronounce, file, report):
    """The cues that a beat declares: a name for a moment of the voice, which a scene of the film uses."""
    example = '[{ "id": "result", "phrase": "one hundred and sixty times" }]'
    if not isinstance(cues, list):
        return report.add(file, f"{where}.cues", f"{shown(cues)} is not a list", f"Give a list of cues, such as {example}")
    for index, cue in enumerate(cues):
        at = f"{where}.cues[{index}]"
        if not isinstance(cue, dict):
            report.add(file, at, f"{shown(cue)} is not an object", f"Give an id and a phrase, such as {example}")
            continue
        keys(cue, {"id", "phrase", "data"}, file, f"{at}.", report)
        cue_id = cue.get("id")
        if not (isinstance(cue_id, str) and CUE_ID.match(cue_id)):
            report.add(file, f"{at}.id", "is missing" if "id" not in cue else f"{shown(cue_id)} is not an id", 'Give the name that a scene uses for the cue, with letters, digits, hyphens and underscores, such as "result"')
        elif cue_id in ids:
            report.add(file, f"{at}.id", f'"{cue_id}" is the id of two cues of the scene', "Give each cue of a scene its own id")
        else:
            ids.add(cue_id)
        phrase, say = cue.get("phrase"), beat.get("say")
        if not (isinstance(phrase, str) and words_of(phrase)):
            report.add(file, f"{at}.phrase", "is missing" if "phrase" not in cue else f"{shown(phrase)} has no word", "Give words of the beat that the voice says")
        elif isinstance(say, str):
            # The film finds a cue in the words that the voice says: the spoken form of the beat.
            said = spoken(say, pronounce)
            times = says(said, phrase)
            heard = f', which the voice says as "{said}"' if said != say else ""
            if times == 0:
                report.add(file, f"{at}.phrase", f'the beat does not say "{phrase}"', f'Give words of the beat, one after another. The beat is "{say}"{heard}')
            elif times > 1:
                report.add(file, f"{at}.phrase", f'the beat says "{phrase}" {times} times', f'Give a longer phrase, which the beat says one time. The beat is "{say}"{heard}')


def check_scene(scene, field, seen, file, report, pronounce=None):
    if not isinstance(scene, dict):
        return report.add(file, field, f"{shown(scene)} is not an object", 'Give { "id": ..., "title": ..., "beats": [...] }')
    keys(scene, {"id", "title", "beats"}, file, f"{field}.", report)
    scene_id = scene.get("id")
    if not (isinstance(scene_id, str) and SCENE_ID.match(scene_id)):
        report.add(file, f"{field}.id", f"{shown(scene_id)} is not an id", 'Give letters, digits and hyphens, such as "the-answer": the id goes into the names of files')
    elif scene_id in seen:
        report.add(file, f"{field}.id", f'"{scene_id}" is the id of two scenes', "Give each scene its own id")
    else:
        seen.add(scene_id)
    if not (isinstance(scene.get("title"), str) and scene["title"]):
        report.add(file, f"{field}.title", "is missing" if "title" not in scene else f"{shown(scene['title'])} is not a title", 'Give the chapter title of the scene, such as "The slow page"')
    beats = scene.get("beats")
    if not isinstance(beats, list) or not beats:
        return report.add(file, f"{field}.beats", "is missing or empty", 'Give a list with one beat or more, such as [{ "say": "One sentence." }]')
    cue_ids = set()
    for index, beat in enumerate(beats):
        where = f"{field}.beats[{index}]"
        if not isinstance(beat, dict):
            report.add(file, where, f"{shown(beat)} is not an object", 'Give { "say": "One sentence." }')
            continue
        keys(beat, {"say", "hold", "cues"}, file, f"{where}.", report)
        if "cues" in beat:
            check_cues(beat["cues"], beat, where, cue_ids, pronounce or {}, file, report)
        if not (isinstance(beat.get("say"), str) and beat["say"].strip()):
            report.add(file, f"{where}.say", "is missing" if "say" not in beat else f"{shown(beat['say'])} is not a text", "Give the words that the voice says")
        if "hold" in beat and not (number(beat["hold"]) and beat["hold"] >= 0):
            report.add(file, f"{where}.hold", f"{shown(beat['hold'])} is not a time", "Give the silence after the beat in seconds, 0 or more")


def voice_of(given):
    """The voice and its speed. The speed is a float, because the name of a take on disk has it as "1.12" or "1.0"."""
    merged = {**VOICE, **given.get("voice", {})}
    return {"name": merged["name"], "speed": float(merged["speed"])}


def spoken(text, pronounce):
    """The text as the voice engine gets it: each entry of the `pronounce` map replaces its word.
    A longer entry goes first, so that "2.0" is replaced before "2". A word inside a longer word or
    inside a number stays as it is."""
    for word, sub in sorted(pronounce.items(), key=lambda entry: -len(entry[0])):
        text = re.sub(rf"(?<![\w.,]){re.escape(word)}(?![\w]|[.,]\d)", sub, text)
    return text


def outline(written, voice):
    """What the voice is made from: the times of the film, and the text and the hold of each beat. It is
    all of timing.json but the measured lengths and the word times.

    In timing.json, `lead` is the time of the first word: the title card and the pause after it. The film
    and the sound mix both count from the start of the movie, so they need this one number."""
    line = {**TIMELINE, **written.get("timeline", {})}
    pronounce = written.get("pronounce", {})
    header = {"voice": voice["name"], "speed": voice["speed"], "intro": line["intro"], "lead": line["intro"] + line["pause"], "gap": line["gap"], "tail": line["tail"]}
    scenes = [{
        "id": scene["id"], "title": scene["title"],
        # A beat that declares cues has them here. A beat with none has no key, so the fingerprint of a script without cues is as it was.
        "beats": [{"say": beat["say"], "text": spoken(beat["say"], pronounce), "hold": beat.get("hold", HOLD), **({"cues": beat["cues"]} if beat.get("cues") else {})} for beat in scene["beats"]],
    } for scene in written["scenes"]]
    return header, scenes


def fingerprint(header, scenes):
    """A short name for what the voice was made from. The voice step stores it in timing.json."""
    return hashlib.sha1(json.dumps([header, scenes], sort_keys=True).encode()).hexdigest()[:16]


def changes(header, scenes, measured):
    """What the script and film.json say now that the timing does not have. An empty list: the timing is current."""
    if measured.get("fingerprint") == fingerprint(header, scenes):
        return []
    found = [f"{key} ({header[key]} now, {measured.get(key)} in the timing)" for key in header if measured.get(key) != header[key]]
    old = {scene.get("id"): scene for scene in measured.get("scenes", []) if isinstance(scene, dict)}
    if [scene["id"] for scene in scenes] != list(old):
        found.append(f"the scenes ({', '.join(scene['id'] for scene in scenes)} now, {', '.join(map(str, old)) or 'none'} in the timing)")
    for scene in scenes:
        before = old.get(scene["id"])
        if before is None:
            continue
        if before.get("title") != scene["title"]:
            found.append(f"{scene['id']} (the title)")
        takes = before.get("beats", [])
        if len(takes) != len(scene["beats"]):
            found.append(f"{scene['id']} ({len(scene['beats'])} beats now, {len(takes)} in the timing)")
            continue
        for index, (beat, take) in enumerate(zip(scene["beats"], takes)):
            what = [name for key, name in (("say", "the text"), ("text", "the spoken form"), ("hold", "the hold"), ("cues", "the cues")) if take.get(key) != beat.get(key)]
            if what:
                # A change of the text is also a change of its spoken form, and one name is enough.
                found.append(f"{scene['id']}/{index} ({' and '.join(name for name in what if not (name == 'the spoken form' and 'the text' in what))})")
    return found


def timing_defect(measured):
    """The first thing that makes a timing unusable, as its field and what is wrong, or None. A tool writes
    this file, so the remedy is always to make it again, and one line is enough."""
    if not isinstance(measured, dict):
        return "the file", "does not hold one object"
    for key in ("lead", "gap", "tail"):
        if not (number(measured.get(key)) and measured[key] >= 0):
            return key, "is missing" if key not in measured else f"{shown(measured[key])} is not a time"
    if "intro" in measured and not (number(measured["intro"]) and measured["intro"] >= 0):
        return "intro", f"{shown(measured['intro'])} is not a time"
    scenes = measured.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        return "scenes", "is missing or empty"
    ended = None
    for at, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            return f"scenes[{at}]", "is not an object"
        if not isinstance(scene.get("id"), str):
            return f"scenes[{at}].id", "is missing"
        if "start" in scene and not (number(scene["start"]) and scene["start"] >= 0):
            return f"scenes[{at}].start", f"{shown(scene['start'])} is not a time"
        # A scene with a start of its own starts when the scene before it has ended, as in the film.
        if "start" in scene and ended is not None and scene["start"] < ended - 1e-6:
            return f"scenes[{at}].start", f"{shown(scene['start'])} is before the end of the scene before it, at {round(ended, 3)} s"
        now = scene["start"] if "start" in scene else measured["lead"] if ended is None else ended + measured["gap"]
        beats = scene.get("beats")
        if not isinstance(beats, list) or not beats:
            return f"scenes[{at}].beats", "is missing or empty"
        for index, beat in enumerate(beats):
            where = f"scenes[{at}].beats[{index}]"
            if not isinstance(beat, dict):
                return where, "is not an object"
            if not isinstance(beat.get("say"), str):
                return f"{where}.say", "is missing"
            if not (number(beat.get("duration")) and beat["duration"] > 0):
                return f"{where}.duration", "is missing" if "duration" not in beat else f"{shown(beat['duration'])} is not a length"
            if not (number(beat.get("hold")) and beat["hold"] >= 0):
                return f"{where}.hold", "is missing" if "hold" not in beat else f"{shown(beat['hold'])} is not a time"
            words = beat.get("words")
            if not isinstance(words, list) or not all(isinstance(word, dict) and isinstance(word.get("text"), str) and number(word.get("start")) and number(word.get("end")) for word in words):
                return f"{where}.words", "is not a list of words with their times"
            now += beat["duration"] + beat["hold"]
        ended = now
    return None


def usable_timing(root):
    """timing.json when it is there and whole, or None. For a step that can do its work without it."""
    path = root / "timing.json"
    try:
        measured = json.loads(path.read_text()) if path.exists() else None
    except json.JSONDecodeError:
        return None
    return measured if measured is not None and timing_defect(measured) is None else None


def missing_takes(root, measured):
    """The takes that the timing names and the disk does not have, or has with no sound: the beat, the file, and which of the two."""
    found = []
    for scene in measured["scenes"]:
        for index, take in enumerate(scene["beats"]):
            wav = take.get("wav")
            path = root / "audio" / wav if isinstance(wav, str) and Path(wav).name == wav else None
            if path is None or not path.is_file():
                found.append((f"{scene['id']}/{index}", wav, "is missing"))
            elif path.stat().st_size <= EMPTY_WAV:
                found.append((f"{scene['id']}/{index}", wav, "is empty"))
    return found


def timing_state(root, written, voice, needs_takes):
    """timing.json against the script. Returns the timing, or None, and what is wrong with it: the field, what
    is wrong, and the step that corrects it. A script that changed after the voice was made must not pass in silence."""
    path = root / "timing.json"
    if not path.exists():
        return None, [("the file", "is missing", "voice")]
    try:
        measured = json.loads(path.read_text())
    except json.JSONDecodeError as error:
        return None, [(f"line {error.lineno}", f"is not valid JSON ({error.msg})", "voice")]
    maker = "draft" if isinstance(measured, dict) and measured.get("draft") else "voice"
    defect = timing_defect(measured)
    if defect:
        return None, [(defect[0], f"{defect[1]}, so the file is not a timing", maker)]
    found = changes(*outline(written, voice), measured)
    if found:
        return measured, [("the script", f"changed after the {maker} was made: {', '.join(found)}", maker)]
    if needs_takes and measured.get("draft"):
        return measured, [("the file", "is a draft: its times are estimates, and there is no voice", "voice")]
    if needs_takes:
        return measured, [(beat, f"the take audio/{wav} {what}", "voice") for beat, wav, what in missing_takes(root, measured)]
    return measured, []


def check_timing(root, written, voice, needs_takes, folder, report):
    """timing.json for a step that reads it: every problem is one line that names the file and the step to run."""
    measured, wrong = timing_state(root, written, voice, needs_takes)
    for field, what, step in wrong:
        lead = f"Run the {step} step first" if what == "is missing" or what.startswith("is a draft") else "Run"
        report.add("timing.json", field, what, f"{lead}: vizmatic narrated {step} {folder}")
    return measured


def voice_state(root, written, voice):
    """For a build: is timing.json the measured voice of this script, with every take on the disk? Returns the
    answer, and one sentence that says why."""
    measured, wrong = timing_state(root, written, voice, True)
    if not wrong:
        takes = sum(len(scene["beats"]) for scene in measured["scenes"])
        return True, f"timing.json is the voice of this script, and its {takes} takes are on the disk"
    field, what, _ = wrong[0]
    if field == "the script":
        return False, f"the script {what}"
    if field == "the file":
        return False, f"timing.json {what}"
    if measured is None:
        return False, f"timing.json is not whole: {field} {what}"
    return False, f"{len(wrong)} takes of timing.json are missing or empty on the disk"


def problems(root, step, looks=None, folder="."):
    """Check the files of the film for one step. Returns the lines of the problems, and what was read."""
    report = Report()
    needs = STEPS[step]
    given = read(root / "film.json", report) if (root / "film.json").exists() else {}
    if given is not None:
        check_film(given, root, looks, report)
    written = read(root / "script.json", report, "It holds what the voice says, one entry for each scene and beat")
    if written is not None:
        check_script(written, report)
    measured = None
    # The timing is compared with files that are right. With a problem above, the comparison has no meaning.
    if not report.lines and (needs.get("timing") or needs.get("takes")):
        measured = check_timing(root, written, voice_of(given), bool(needs.get("takes")), folder, report)
    for program in needs.get("programs", []):
        if shutil.which(program) is None:
            report.add("this machine", program, "is not installed", f"The {step} step needs it. It comes with FFmpeg")
    return report.lines, given, written, measured
