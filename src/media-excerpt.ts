export interface MediaExcerptOptions {
    /** Zero-based index of the first displayed frame. */
    startFrame: number
    frameCount: number
    /** Constant source frame rate in whole frames per second. */
    fps: number
    /** Source audio sample rate in Hz. */
    sampleRate: number
}

/** Build FFmpeg input options and filters for a half-open excerpt of a zero-origin CFR source. */
export function planMediaExcerpt({ startFrame, frameCount, fps, sampleRate }: MediaExcerptOptions) {
    if (!Number.isSafeInteger(startFrame) || startFrame < 0 || !Number.isSafeInteger(frameCount) || frameCount <= 0)
        throw new RangeError('Expected a nonnegative startFrame and a positive frameCount')
    if (![fps, sampleRate].every(rate => Number.isInteger(rate) && rate > 0 && rate <= 0x7fffffff))
        throw new RangeError('Expected positive integer source frame and sample rates')

    const endFrame = startFrame + frameCount
    if (!Number.isSafeInteger(endFrame)) throw new RangeError('Frame range exceeds the exact source clock')
    // Include each sample whose start time falls in the requested frame interval.
    const sampleAt = (frame: number) => (BigInt(frame) * BigInt(sampleRate) + BigInt(fps - 1)) / BigInt(fps)
    const endSample = sampleAt(endFrame)
    if (endSample > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Frame range exceeds the exact sample clock')
    const inputArgs = ['-copyts', '-reinit_filter:v', '0']
    // Decode some audio before the cut so the AAC decoder can reconstruct overlapping packets.
    const seek = Math.max(0, Math.floor(startFrame / fps) - 1)
    if (seek > 0) inputArgs.push('-ss', String(seek))
    inputArgs.push('-t', String(Math.ceil(endFrame / fps) - seek + 1))

    return {
        inputArgs,
        videoFilter: `settb=1/${fps},trim=start_pts=${startFrame}:end_pts=${endFrame},setpts=PTS-STARTPTS`,
        audioFilter: `atrim=start_pts=${sampleAt(startFrame)}:end_pts=${endSample},asetpts=PTS-STARTPTS`,
    }
}
