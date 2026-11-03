/** Reads projects from files and share links, which are untrusted input. */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import { LOOKS, type Aspect, type LookName } from '../stage/index'
import { BEATS, DEFAULT_EASE, EASES } from './beats'
import { KINDS, type Field } from './catalog'
import { createId, emptyProject, LIMITS, round3, VALUE_TRACK, type Beat, type Marker, type ObjectProps, type PropValue, type StudioObject, type StudioProject, type Variable } from './model'

const ASPECTS: readonly Aspect[] = ['16:9', '9:16', '1:1', '4:3', '21:9']
const FPS: readonly number[] = [12, 24, 25, 30, 50, 60, 120]
const ID = /^[A-Za-z0-9_@-]{1,64}$/
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/
const RESERVED_VARIABLES = new Set(['x', 'pi', 'tau', 'e', '__proto__', 'constructor', 'prototype'])

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function finite(value: unknown, fallback: number, min = -1e7, max = 1e7): number {
    const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
    return round3(Math.max(min, Math.min(max, number)))
}

function short(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value.slice(0, LIMITS.stringLength) : fallback
}

function cleanProp(field: Field | undefined, value: unknown, fallback: PropValue): PropValue {
    const type = field?.type
    if (type === 'number') return finite(value, typeof fallback === 'number' ? fallback : 0, field?.min, field?.max)
    if (type === 'bool') return typeof value === 'boolean' ? value : Boolean(fallback)
    if (type === 'color') {
        if (value === null && field?.nullable) return null
        return typeof value === 'string' ? value.slice(0, 64) : fallback
    }
    if (type === 'select') {
        const text = typeof value === 'number' ? String(value) : value
        if (field?.options?.length) {
            return field.options.some(([option]) => option === text) ? text as string : fallback
        }
        return typeof text === 'string' ? text.slice(0, 64) : fallback
    }
    // Strings stay strings. Anything else takes the default.
    if (typeof value === 'string') return value.slice(0, LIMITS.stringLength)
    if (typeof fallback === 'number') return finite(value, fallback)
    return fallback
}

/** Keep only known keys with values of the expected shape. Unknown keys are dropped. */
function cleanProps(raw: unknown, fields: readonly Field[], defaults: ObjectProps): ObjectProps {
    const source = isRecord(raw) ? raw : {}
    const out: ObjectProps = Object.create(null) as ObjectProps
    for (const key of Object.keys(defaults)) {
        const field = fields.find((entry) => entry.key === key)
        out[key] = Object.hasOwn(source, key) ? cleanProp(field, source[key], defaults[key]!) : defaults[key]!
    }
    return { ...out }
}

function uniqueId(raw: unknown, prefix: string, used: Set<string>): string {
    let id = typeof raw === 'string' && ID.test(raw) ? raw : createId(prefix)
    while (used.has(id)) id = createId(prefix)
    used.add(id)
    return id
}

/** Build a valid project from arbitrary JSON. Bad parts are repaired or dropped. */
export function normalizeProject(raw: unknown): StudioProject {
    if (!isRecord(raw)) throw new Error('This is not a Vizmatic project file.')
    const base = emptyProject(short(raw['name'], 'Untitled film').slice(0, 200) || 'Untitled film')
    base.mode = raw['mode'] === 'code' ? 'code' : 'visual'
    base.look = typeof raw['look'] === 'string' && Object.hasOwn(LOOKS, raw['look']) ? raw['look'] as LookName : 'midnight'
    base.aspect = ASPECTS.includes(raw['aspect'] as Aspect) ? raw['aspect'] as Aspect : '16:9'
    base.fps = FPS.includes(raw['fps'] as number) ? raw['fps'] as number : 60
    base.hold = finite(raw['hold'], 1, 0, 120)
    base.source = typeof raw['source'] === 'string' ? raw['source'].slice(0, LIMITS.sourceBytes) : ''
    base.codeLook = typeof raw['codeLook'] === 'string' && Object.hasOwn(LOOKS, raw['codeLook']) ? raw['codeLook'] as LookName : null

    const ids = new Set<string>()
    const objects: StudioObject[] = []
    for (const entry of Array.isArray(raw['objects']) ? raw['objects'].slice(0, LIMITS.objects) : []) {
        if (!isRecord(entry) || typeof entry['kind'] !== 'string' || !Object.hasOwn(KINDS, entry['kind'])) continue
        const kind = KINDS[entry['kind']]!
        objects.push({
            id: uniqueId(entry['id'], 'o', ids),
            kind: kind.kind,
            name: short(entry['name']).slice(0, 120),
            x: finite(entry['x'], 0),
            y: finite(entry['y'], 0),
            rotation: finite(entry['rotation'], 0, -36000, 36000),
            scale: finite(entry['scale'], 1, 0.001, 1000),
            opacity: finite(entry['opacity'], 1, 0, 1),
            hidden: entry['hidden'] === true,
            locked: entry['locked'] === true,
            props: cleanProps(entry['props'], kind.fields, kind.defaults),
        })
    }
    base.objects = objects

    const objectIds = new Set(objects.map((object) => object.id))
    const beatIds = new Set<string>()
    const beats: Beat[] = []
    for (const entry of Array.isArray(raw['beats']) ? raw['beats'].slice(0, LIMITS.beats) : []) {
        if (!isRecord(entry) || typeof entry['kind'] !== 'string' || !Object.hasOwn(BEATS, entry['kind'])) continue
        const def = BEATS[entry['kind']]!
        const target = typeof entry['target'] === 'string' ? entry['target'] : ''
        if (def.group === 'Value' ? target !== VALUE_TRACK : !objectIds.has(target)) continue
        const params = cleanProps(entry['params'], def.fields, def.params)
        // References must point at objects in this project.
        for (const key of ['into', 'path']) {
            if (key in params && typeof params[key] === 'string' && params[key] && !objectIds.has(params[key] as string)) params[key] = ''
        }
        beats.push({
            id: uniqueId(entry['id'], 'b', beatIds),
            target,
            kind: def.kind,
            start: finite(entry['start'], 0, 0, LIMITS.timelineSeconds),
            duration: def.instant ? 0 : finite(entry['duration'], def.duration, 0.01, LIMITS.timelineSeconds),
            ease: typeof entry['ease'] === 'string' && Object.hasOwn(EASES, entry['ease']) ? entry['ease'] : DEFAULT_EASE,
            params,
        })
    }
    base.beats = beats

    const markerIds = new Set<string>()
    const markers: Marker[] = []
    for (const entry of Array.isArray(raw['markers']) ? raw['markers'].slice(0, LIMITS.markers) : []) {
        if (!isRecord(entry)) continue
        markers.push({ id: uniqueId(entry['id'], 'm', markerIds), time: finite(entry['time'], 0, 0, LIMITS.timelineSeconds), title: short(entry['title'], 'Chapter').slice(0, 200) || 'Chapter' })
    }
    base.markers = markers

    const names = new Set<string>()
    const variables: Variable[] = []
    for (const entry of Array.isArray(raw['variables']) ? raw['variables'].slice(0, LIMITS.variables) : []) {
        if (!isRecord(entry) || typeof entry['name'] !== 'string' || !VARIABLE.test(entry['name'])) continue
        if (names.has(entry['name']) || RESERVED_VARIABLES.has(entry['name'])) continue
        names.add(entry['name'])
        variables.push({ name: entry['name'], value: finite(entry['value'], 0) })
    }
    base.variables = variables

    if (isRecord(raw['loop'])) {
        const from = finite(raw['loop']['from'], 0, 0, LIMITS.timelineSeconds)
        const to = finite(raw['loop']['to'], 0, 0, LIMITS.timelineSeconds)
        base.loop = to > from ? { from, to } : null
    }
    return base
}

function toBase64Url(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

export const SHARE_KEY = 'p'
const MAX_SHARE_BYTES = 1_500_000
const MAX_INFLATED_BYTES = 4_000_000

/** Compress a project into a URL-safe string. */
export function encodeShare(project: StudioProject): string {
    return toBase64Url(deflateSync(strToU8(JSON.stringify(project)), { level: 9 }))
}

/** Decode a share string. Throws when it is damaged or too large. */
export function decodeShare(encoded: string): StudioProject {
    if (encoded.length > MAX_SHARE_BYTES) throw new Error('This shared link is too large to open.')
    let inflated: Uint8Array
    try {
        inflated = inflateSync(fromBase64Url(encoded))
    } catch {
        throw new Error('This shared link is damaged.')
    }
    if (inflated.length > MAX_INFLATED_BYTES) throw new Error('This shared link is too large to open.')
    let parsed: unknown
    try {
        parsed = JSON.parse(strFromU8(inflated))
    } catch {
        throw new Error('This shared link is damaged.')
    }
    return normalizeProject(parsed)
}
