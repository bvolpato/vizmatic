export interface CuePosition {
    beat: number
    beatP: number
}

export interface CueSnapshot<Snapshot> {
    id: string
    snapshot: Snapshot
}

export interface DiscreteCue<Snapshot> extends CueSnapshot<Snapshot> {
    beat: number
    at: number
}

export interface CueTrackOptions<Snapshot> {
    initial: CueSnapshot<Snapshot>
    cues: readonly DiscreteCue<Snapshot>[]
}

function position(beat: number, progress: number): CuePosition {
    if (!Number.isSafeInteger(beat) || beat < 0) throw new Error('Cue beat must be a nonnegative safe integer')
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error('Cue progress must be between zero and one')
    if (progress === 1) {
        if (!Number.isSafeInteger(beat + 1)) throw new Error('Cue position exceeds the safe integer range')
        return { beat: beat + 1, beatP: 0 }
    }
    return { beat, beatP: progress }
}

function compare(left: CuePosition, right: CuePosition): number {
    return left.beat === right.beat ? left.beatP - right.beatP : left.beat - right.beat
}

/** Hold one authored simulation snapshot until the next explicit semantic cue. */
export function createCueTrack<Snapshot>(options: CueTrackOptions<Snapshot>) {
    const ids = new Set<string>()
    const entry = ({ id, snapshot }: CueSnapshot<Snapshot>): Readonly<CueSnapshot<Snapshot>> => {
        if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new Error('Cue IDs must be nonempty and unique')
        ids.add(id)
        return Object.freeze({ id, snapshot })
    }
    const initial = entry(options.initial)
    const cues = options.cues.map((cue) => ({ position: position(cue.beat, cue.at), value: entry(cue) }))
    for (let index = 1; index < cues.length; index += 1) {
        if (compare(cues[index - 1].position, cues[index].position) >= 0) {
            throw new Error('Cue positions must be strictly increasing')
        }
    }
    return Object.freeze({
        sample(current: CuePosition): Readonly<CueSnapshot<Snapshot>> {
            const at = position(current.beat, current.beatP)
            let low = 0, high = cues.length
            while (low < high) {
                const middle = Math.floor((low + high) / 2)
                if (compare(cues[middle].position, at) <= 0) low = middle + 1
                else high = middle
            }
            return low === 0 ? initial : cues[low - 1].value
        },
    })
}

export interface CueRevealOptions {
    result: string
    phrase: string
    /** First frame to inspect while the viewer can still predict the result. */
    fromFrame: number
    /** First frame allowed to show the result, resolved from the phrase by the host clock. */
    cueFrame: number
    /** Last frame allowed for the result to appear. Defaults to cueFrame for a cut. */
    byFrame?: number
    /** Observe the named result in this frame. Throw if the evidence is inconclusive. */
    visibleAt: (frame: number) => boolean
}

/** Check one prediction and return the two frames on either side of its observed reveal. */
export function assertCueReveal({ result, phrase, fromFrame, cueFrame, byFrame = cueFrame, visibleAt }: CueRevealOptions) {
    if (!result.trim() || !phrase.trim()) throw new Error('A cue reveal needs a result and a spoken phrase')
    if (![fromFrame, cueFrame, byFrame].every(Number.isSafeInteger) || fromFrame < 0 || fromFrame >= cueFrame || cueFrame > byFrame) {
        throw new RangeError('Cue reveal frames must be safe integers with 0 <= fromFrame < cueFrame <= byFrame')
    }
    for (let frame = fromFrame; frame <= byFrame; frame++) {
        const visible = visibleAt(frame)
        if (typeof visible !== 'boolean') throw new TypeError(`Expected a boolean observation of "${result}" at frame ${frame}`)
        if (!visible) continue
        if (frame < cueFrame) throw new Error(`"${result}" is visible at frame ${frame}, before "${phrase}" permits it at frame ${cueFrame}`)
        return { lastHiddenFrame: frame - 1, firstVisibleFrame: frame }
    }
    throw new Error(`"${result}" is still missing at frame ${byFrame} for "${phrase}" (cue frame ${cueFrame})`)
}
