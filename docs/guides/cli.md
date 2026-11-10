---
title: CLI
nav: CLI
section: Ship
order: 4
description: Create, preview, check, and export films, and render static figures, from the command line.
---

## Films

### vizmatic new

Create a film from a starter that renders as written and passes the check.

```bash
npx vizmatic new intro --template explainer
```

The templates are `explainer`, `equation`, `architecture`, `chart`, and `deck`. Each one is one file. The `narrated` template writes a folder: a film that follows a recorded voice, with its script, its scenes, and its build.

### vizmatic preview

Open a live preview with a timeline. The page reloads when you save.

```bash
npx vizmatic preview intro.ts --open
```

### vizmatic check

Inspect a film without rendering video. The check samples the timeline and reports marks off the canvas, overlapping text, and lines that cross text. Each finding has a time and a position. Use `--json` to read the report in a script.

A film whose lines run past the frame on purpose, such as a warped grid, sets `bleed: true` in its options. The check then ignores lines and shapes past the edge, and it still reports text that runs off the canvas or sits against an edge.

```bash
npx vizmatic check intro.ts --look midnight,paper --json
```

The check looks where the film comes to rest, so it misses a problem that lasts only while something moves. `--motion` also inspects every frame. It reports a problem that appears only in motion as a warning, because it cannot tell a collision from one picture that replaces another. It reports 0.2 seconds or more with nothing visible as `film.blank`. It reports text that leaves before a viewer can read it as `film.text_brief`: a reader takes in 20 characters in one second, and a text needs half a second at least. `--reading-speed <n>` changes the speed, and 0 turns the rule off. `--stepped` is for a deck, which waits at each chapter: text that is up there is not reported. In a film, `readingSeconds(text)` from `vizmatic/stage` gives the time that a plain text needs. `--content-top <px>` sets the canvas y where the content starts, so that a heading that stays up does not count as content. `--text-margin <px>` sets how near text may come to an edge of the frame before the check reports `film.text_edge`. The default is 2% of the shorter side, and 0 turns the rule off. While the camera is zoomed, the check looks only at pinned text, because a zoom crops the rest on purpose.

`--text-gap <part>` turns on one more rule, `film.text_crowded`, for text that has no room. `0.3` is a good value. The rule is off by default, because a plot may put a curve beside a label on purpose. It reports four cases:

- Text is nearer to a mark than that part of its font size. A caption that is 3 px below its figure is an example. The rule never asks for more than 2% of the shorter side of the frame.
- A line touches the letters. A line that runs through the letters is `film.text_crossed`, so each line at the letters is one finding of one rule.
- Text starts on a filled shape or an image and leaves it. A label that is wider than its dot is an example. The message says if the text is wider than the shape, taller than the shape, or past one edge of it.
- An opaque shape or an image in front of the text covers a part of it. Text that shapes hide in full has no finding, because a viewer does not see it.

A finding names the mark: its kind, the object that drew it, and its side of the text. An example is `Text "note" is 3 px from a line of a connector above it. Leave 12 px or more.` The kind is a line, the border of a box, the border of a shape, a filled shape, an image, or the surface of a 3D scene. For a band or a pill that holds the text, the message names the edge: `the lower edge of the filled shape behind it`. The object is the label that the film gave with `.named()`, or the name that an object of the library gives itself, such as `a card` or `the pictogram "database"`. The check does not read the name of a class, because a minified build changes it. So a class of the film has a name in a message only when the film gives one with `.named()`. The words "above", "below", "left of", and "right of" say where the mark is. The words "behind" and "in front of" say which of the two is drawn first.

The rule looks at the moments at rest. With `--motion`, it also judges a text and a mark that stay too near for one second while they move, or while other things move. A film that never comes to rest has no moment at rest, so check it with `--motion`.

A text has no room when the text and one mark are too near for one second. What lasts is the pair of the text and the mark, and not a place on the screen. The two may move together, as in a pan, and their distance may change. Two marks that are near the same text, one after the other, are two pairs. At a moment at rest, the rule looks again one second later, and reports the text when the same mark is too near there too. The last picture of a film stays, so a rest at the end counts.

With `--motion`, the check looks four times in one second, and reports a pair that is too near at four looks in a row. So a stretch of less than 0.7 s is never reported, a stretch of 1.1 s or more always is, and a stretch between the two may or may not be reported. A look where a line runs through the letters is for `film.text_crossed`, and it ends the stretch for this rule. So a curve that passes a label on its way, and a playhead that goes across a label, are not findings of this rule.

A mark is a line, the border of a shape, a filled shape, or an image:

- Its contrast with what a viewer sees behind it is 1.2 or more. Behind a mark are the fills that are drawn before it, one over the other, over the background of the frame. For a line, a fill counts when it holds the whole line. For a filled shape, a fill counts when it is behind the middle of the shape. So a dark rule on a light card is a mark, and a white line on a white card is not.
- A line of the `grid` color on the background has a contrast of 1.24 to 1.47 in the five looks, so it is a mark: a row name that touches the rule of its table is a finding. A fill of the `surface` color has 1.19 at most, so a panel with no border is not a mark.
- A band of a faint color behind a row of text is a mark when its contrast with the card behind it is 1.2 or more. A viewer sees its edge, and the row needs half of its room in the band.
- A line is faint when its contrast is under 1.6, with the background of the frame and with what is behind it. A faint line may run behind a label, as the grid of a plane does: through its letters, over their base line. No rule reports a faint line there. A text sits on a line at its base line. So a faint line at the base line, or under it through the tails of the letters, is a mark, as the rule under a row of a table is. The lowest quarter of the letters over the base line counts as the base line. A faint line beside the text is a mark too.
- A filled shape with a border is one mark, its border. When the border is faint, the fill is a mark too.
- An image is a mark, and a mark on an image is a mark, because an image has no one color.
- The faces of a 3D scene are one surface. Text on the surface is not near a mark, and text beside the surface or past its edge is.

The rule measures in this way:

- The font size is the size that the text was made with, times its scale on the screen. A rotation does not change it. `text`, `tex`, and the lines of a `codeBlock` record their size.
- The distance is to the box of each letter, and not to the box of the text block. At a round corner, the box of a letter can be nearer than its ink. A distance that is less than half a pixel under the limit passes, because a film places its marks at whole pixels.
- Inside a shape that holds the text, such as a cell of an array, a pill, a card, or a `zone`, the text needs half of the distance to the border of that shape. A shape holds the text when the box of each letter is in it. The frame of a `zone` holds its text when the zone has a title and when it has none.
- A mark on the other side of that border is not near the text, because the border is between the two. A line that goes behind a card and comes out at its border is an example: the rule judges a word of the card against the border, and not against the line. The box of an object of the library holds the labels of that object in the same way.
- A shape with an opacity of 80% or more hides the part of a mark that is behind it and inside its shape. The distance is to the part that shows. So a backing in the color of the background must be larger than the text by the distance. A backing that a viewer sees is a shape that holds the text.
- Two texts with the same words are two findings. A text of a `dynamic` drawing that changes its words at one place, such as a number that counts up, is one finding.

The rule judges the text that the film places, also in a `group`, in a class of the film, in markup from `fromSvg`, in a `zone`, and in the figure of a `card`. It does not judge a distance that a rule of the library sets:

- A label that an object places, against the marks of the same object: the numbers of `axes` beside its ticks, the title of a `card` or a `zone`, the word in a `tag`, the labels of a chart, of `lanes`, and of a `bitField`, the lines of a `terminal`, the names in the legend of a `stateGrid`, the labels and the notes of `steps`, the names, the tally, and the text of a crossing of a `boundary`, the words and the source of a `quote`, the numbers, the names, and the labels of the entries of a `ringBuffer`, the numbers, the labels, and the notes of a `dateLine`, the rows, the title, the footer, and the counts of an `eventLog`, and the names, the counts, and the texts of the items of a `requestQueue`. Text that the film adds to such an object is judged.
- A label of a plot against a line of the film, because a curve passes the numbers of an axis on purpose. The plots are `axes`, `numberLine`, `complexPlane`, the charts with an axis, `angleMark`, and a 3D scene. An arrow, a brace, the head of a `connector`, and the arrows of a `vectorField` are lines. A closed shape of the film, filled or not, is judged there too. So is the border of a `zone` around a chart, when the zone has a title and when it has none.
- A `connector`, a `callout`, and a `braceLabel` against the text of the nodes that they are tied to: a connector ends 3 px from the word that it connects.
- A label of a 3D scene against the marks of that scene, because their distance changes with the camera.
- A box from `surroundingBox`, a mark from `highlightSweep`, the line of `circumscribe`, the cursor of `typewriter`, and a shape on its way in a `morph`, against any text.

For every other mark, a label of an object is text of the film. A legend that a film puts 3 px above the axis of a chart is reported, and so is the label of a `labeledDot` that a film puts on an axis.

An object can put a label in a box of a size that the film sets, as `lanes` puts a label in a bar. The rule judges that label against that box. The message ends with a sentence that says what option to change, such as "Give the lanes a taller bar (`barHeight`) or a smaller text (`size`)." The room of such a label in its box is half of 0.3 of its font size at the most, with any `--text-gap`, so the default box of the object passes.

The points that objects give for the end of a line, such as `steps.p()`, leave room for a gap of 0.3. A film that asks for more with `--text-gap` may get a report on such a line.

The rule has these limits:

- It does not report a strike: a level filled bar in front of the letters that is thinner than a quarter of the font size, with its middle line in the middle half of the letters that it crosses. A strike can have any length: a thin filled bar across the frame, through the middle of a word, is a strike for the rule. The same bar as a line with a stroke is a finding of `film.text_crossed`. A strike excuses no other mark. A thin bar that cuts the top or the bottom of the letters is reported. The rule does not report a shape in front of the letters that they show through.
- It does not report an underline: a level line or filled bar under a text or under a part of it, which a film draws to mark words. An underline is thinner than a quarter of the font size. Its ends are in the box of the text, or past it by a quarter of the font size at the most. Its middle line is under the base line of the letters over it, by 0.4 of the font size at the most. The tails of letters may cross it. A longer line is a rule, as under a row of a table, and the rule reports it. A bar over the base line and outside the band of a strike cuts the letters, and the rule reports it. An underline excuses no other mark, and it is a mark for every other text. `text`, `tex`, a `codeBlock`, and a `terminal` record the base line of their letters. For letters that a film makes itself, a line under them is a mark.
- The room is not less for a label on a backing in the color of the background: a line that such a backing cuts must end at the full distance from the letters.
- The edge of an image is its rectangle, also where the picture is clear.
- A filled path that is not closed is not a backing.
- A film can import another version of the engine than the CLI has. An engine before this rule does not mark the labels of its objects. The check then reports one warning that says so, and does not run the rule.

```bash
npx vizmatic check intro.ts --motion --content-top 200
```

`--text-size <px>` turns on the rule `film.text_small`, for text that is too small to read. The value is the least size on a frame that is 1080 high, and a frame of another size has the same part of its shorter side. `26` is the size that a lesson video needs on a phone. The rule is off by default, because small text can be a texture, such as rows of a log that scroll.

- The size is what a viewer sees: the font size of the text, times the scale of its node and of the groups that hold it, times the zoom of the camera. For a formula, it is the size of its letters, and an index is smaller on purpose.
- The rule looks at the moments at rest. Automatic samples ignore text while its node, a parent group, or the camera changes scale. Explicit sample times judge the picture at that time.
- Text fully hidden by a later solid, opaque rectangular fill does not count. A translucent or partial cover does not suppress the finding. Rasterized text inside an image is outside this rule.
- The texts of one size are one finding, which names five of them: `8 texts are 22 px on the screen, and the least size is 26 px: "word a", "word b", "word c", "word d", "word e" and 3 more. Give them a larger size.` A film sets a size for a kind of text, so the size is the place to change.
- The labels of one object are one finding, which names the object: `4 labels of a bar chart are under 26 px on the screen, the smallest at 20 px: "alpha", "beta", "2", "3". Give the object a larger size for its labels.` The option is `labelSize` for most objects, and `size` for some.

Many objects have labels under 26 px by default, because their defaults are for a figure and not for a lesson on a phone: the numbers of `axes` and of the charts are 18 to 20 px, the label of a `connector` is 12 px, and the names of a `legend` are 13 px. The rule reports them, so a film that asks for 26 px sets the size of each one.

`--empty-space <part>` turns on the rule `film.empty_space`, for a picture that leaves much of the frame with no use. The value is the largest part of the frame that may stay empty in one piece, from 0 to 1. `0.5` is a good value. The rule is off by default, because a scene can leave a part of the frame empty on purpose.

- The rule looks at the film two times in each second, on a grid of 16 by 9 cells. A cell has content when a text, an image, a line or a filled shape is in it.
- By default, it reports a rectangle of cells that is larger than the part and has no content for 4 seconds or more: `For 5 s, 78% of the frame stays empty in one piece: the bottom 78% of the height. The limit is 50%. Make the picture larger, or use that part for what the picture explains.` `time` and `until` are the first look and the last look, and `box` is the rectangle.
- The rectangle is empty for the whole time. A picture that moves, and a picture that uses the left half and then the right half, use the frame.
- A scene that builds its picture in steps has an empty part for 2 or 3 seconds. That is no defect, so the rule waits for 4 seconds.
- With 0.5 or more, the rule never reports a picture in the middle of the frame, however small it is: a title card, one formula, one sentence. Above the middle of the frame and under it, 4 of the 9 rows are free, which is 44%. A lower value, such as 0.4, reports them.
- A line and a shape count from the contrast at which a viewer can tell them from the background, which is 1.6. So a faint grid, a panel in the color of the surface, and a text that is nearly gone are not content. An outline is content where its line is, and not inside it.
- The rule does not look at the first half second and the last half second of the film.
- A solid fill over the whole frame is a backdrop. It does not count as content, even when its color differs from the film background.
- For a PNG with transparency, only cells that contain visible image pixels count. Crops and transforms apply before this check. A rotated cell uses a bounding rectangle in the source image, so it can count nearby pixels conservatively. When an older engine provides no alpha mask, the whole image rectangle counts.
- `--empty-seconds <s>` changes the required duration. The default stays 4 seconds. Use `--empty-seconds 2` for a stricter course audit that must flag a sparse picture within a short beat. This option does not enable the rule by itself. The check includes a final sample half a second before the end, even when that time falls between the regular samples.

```bash
npx vizmatic check lesson.ts --text-size 26 --empty-space 0.5
npx vizmatic check lesson.ts --empty-space 0.5 --empty-seconds 2
```

### vizmatic film

Export a film. See [Exporting](exporting.md) for the options.

```bash
npx vizmatic film intro.ts --out dist/films --look midnight,paper --quality high
```

| Flag | Meaning |
|---|---|
| `--out <dir>` | The output folder. |
| `--look a,b` | Render in these looks. |
| `--format mp4,webm,gif,png,svg` | The output formats. |
| `--quality draft\|standard\|high\|master` | Encoder quality, motion blur, and the dither of the bloom. |
| `--dither`, `--no-dither` | Turn the dither of the bloom on or off. Without them, a movie has it at `high` and `master`, and a PNG has it. |
| `--fps <n>` | Frame rate. |
| `--width <n>` | Output width in pixels. |
| `--motion-blur <n>` | Sub-frames per frame. |
| `--shutter <0-1>` | The fraction of a frame the shutter stays open. |
| `--range a:b` | Render part of the timeline. |
| `--frame t,t` | Write stills at these times. |
| `--every <seconds>` | Write stills at this interval, across the film or its `--range`. |
| `--sheet` | Join the stills into contact sheets, each tile with its time. With no times, a sheet shows 12 moments spread over the film. |
| `--columns <n>` | Tiles in a row of a contact sheet. |
| `--poster` | Also write a poster frame. |
| `--workers <n>` | Rasterizer threads. |
| `--audio <file>` | Add a sound track. |
| `--name <name>` | Name the output files, in place of the name of the film file. For one film. |
| `--background <color\|none>` | Replace the background. |
| `--ffmpeg <path>` | Use this FFmpeg. |
| `--json` | Print a report as JSON. |

### vizmatic narrated

Build a film that follows a recorded voice, or run one step of the build. The folder holds the script, the scenes, and `film.json`. See [Narrated films](narrated-films.md).

```bash
npx vizmatic narrated build my-film --draft
npx vizmatic narrated build my-film
npx vizmatic narrated stills my-film --scene answer
```

| Step | Meaning |
|---|---|
| `build` | The one command of a film. It brings the voice, the sound mix, the beat list, the layout check with motion, and the movie up to date, runs only the steps that have work to do, and says why it runs or skips each one. `--draft` writes `<name>-draft.mp4` and no file of the delivered movie. `--draft --scene <id,...>` makes a draft of those scenes alone. `--quality`, `--workers`, `--dither` and `--no-dither` set the render. A finding of the check stops the build, unless you pass `--allow-findings`. |
| `voice`, `mix` | The voice of the script, made on this machine, and the sound mix. |
| `draft` | A timing with estimated times and no sound. It never replaces a measured timing. |
| `check` | The layout check, with `--motion`, `--json`, `--content-top`, `--text-margin`, `--reading-speed` and `--stepped`. |
| `stills`, `sheet` | One full-size still for each beat, and contact sheets. `--scene <id,...>` builds only those scenes. |
| `beats` | Where each beat starts and ends, and with `--words <scene>` the spoken words. |
| `transcribe`, `sync`, `lag`, `probe` | Checks of the takes, of the picture and the voice of the movie against the timing, and of the movie file. `--draft` reads the draft. A check that does not pass ends with a failure. |
| `resound` | A new sound track in the rendered movie, without a new render of the picture. It stops when the picture was rendered with another timing than the sound has, and it checks the new movie before one rename puts it in the place of the old one. |

Every step first checks `film.json`, `script.json`, and the timing against the script, and prints one line for each problem. An option that a step does not have is an error. `--dry-run` checks the files, prints the steps, and runs none. The lines about the steps go to the error stream, so the output of `check --json` and of `probe` is the data alone. The steps need [uv](https://docs.astral.sh/uv/) and FFmpeg.

### vizmatic looks and vizmatic objects

List the looks and the object library. Use `--json` in scripts and agents.

```bash
npx vizmatic looks --json
npx vizmatic objects --json
```

## Figures

Render TSX figures to PNG and SVG.

```bash
npx vizmatic ./frame.tsx --out ./figures --theme dark,light --format both
npx vizmatic check ./frame.tsx --theme dark,light --json
npx vizmatic gif ./animated-frame.tsx --out ./figures --theme dark,light --fps 20
```

Run `npx vizmatic --help` to see every option.
