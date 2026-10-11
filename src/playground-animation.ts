export interface PlaygroundAnimationMetadata {
    /** Browser playback and source variable `t` use seconds. */
    duration: number
    fps: number
}

export interface PlaygroundAnimationFrame {
    time: number
    delay: number
}

export const PLAYGROUND_GIF_MAX_FRAMES = 120
export const PLAYGROUND_GIF_MAX_FRAME_PIXELS = 2_000_000
export const PLAYGROUND_GIF_MAX_TOTAL_PIXELS = 60_000_000
export const PLAYGROUND_GIF_TIMEOUT_MS = 45_000

export function validatePlaygroundAnimation(animation: PlaygroundAnimationMetadata): PlaygroundAnimationMetadata {
    if (!Number.isFinite(animation.duration) || animation.duration <= 0 || animation.duration > 10) {
        throw new Error('animationDuration must be greater than 0 and at most 10 seconds.')
    }
    if (!Number.isInteger(animation.fps) || animation.fps < 1 || animation.fps > 30) {
        throw new Error('animationFps must be an integer from 1 to 30.')
    }
    return { duration: animation.duration, fps: animation.fps }
}

export function validatePlaygroundTime(time: number, animation?: PlaygroundAnimationMetadata): number {
    if (!Number.isFinite(time) || time < 0) throw new Error('Animation time must be a nonnegative finite number.')
    return animation ? Math.min(time, animation.duration) : time
}

/**
 * GIF samples exclude the duplicate loop endpoint. Duration rounds to GIF
 * centiseconds, with a minimum display time of 20 ms per encoded frame.
 */
export function playgroundAnimationFrames(
    animation: PlaygroundAnimationMetadata,
    width: number,
    height: number,
): PlaygroundAnimationFrame[] {
    const { duration, fps } = validatePlaygroundAnimation(animation)
    const count = Math.ceil(duration * fps)
    if (count > PLAYGROUND_GIF_MAX_FRAMES) {
        throw new Error(`GIF export supports at most ${PLAYGROUND_GIF_MAX_FRAMES} frames. Reduce animationDuration or animationFps.`)
    }
    const pixels = width * height
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
        || pixels > PLAYGROUND_GIF_MAX_FRAME_PIXELS || pixels * count > PLAYGROUND_GIF_MAX_TOTAL_PIXELS) {
        throw new Error('GIF export supports at most 2 million pixels per frame and 60 million pixels in total. Reduce the canvas size or frame count.')
    }
    const frames = Array.from({ length: count }, (_, index) => {
        const time = index / fps
        const end = Math.min((index + 1) / fps, duration)
        return {
            time,
            delay: Math.max(20, Math.round(end * 100) * 10 - Math.round(time * 100) * 10),
        }
    })
    const target = Math.max(count * 20, Math.round(duration * 100) * 10)
    let excess = frames.reduce((total, frame) => total + frame.delay, 0) - target
    for (let index = frames.length - 2; index >= 0 && excess > 0; index -= 1) {
        const reduction = Math.min(excess, frames[index].delay - 20)
        frames[index].delay -= reduction
        excess -= reduction
    }
    return frames
}

/** GIF has one-bit transparency, so browser exports use the current theme matte. */
export function mattePlaygroundPixels(pixels: Uint8Array, matte: string): Uint8Array {
    if (!/^#[\da-f]{6}$/i.test(matte)) throw new Error('GIF matte must be a six-digit hex color.')
    const rgb = [1, 3, 5].map((offset) => Number.parseInt(matte.slice(offset, offset + 2), 16))
    const output = pixels.slice()
    for (let index = 0; index < output.length; index += 4) {
        const alpha = output[index + 3] / 255
        for (let channel = 0; channel < 3; channel += 1) {
            output[index + channel] = Math.round(output[index + channel] * alpha + rgb[channel] * (1 - alpha))
        }
        output[index + 3] = 255
    }
    return output
}
