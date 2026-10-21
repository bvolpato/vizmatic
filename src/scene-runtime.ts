import { getQuickJS } from 'quickjs-emscripten'
import { transform } from 'sucrase'
import { extractRootJsx, findBareRootJsxStart } from './bare-source'
import { getThemeColors } from './theme'
import { SCENE_COMPONENT_NAMES } from './scene-components'
import {
    normalizeSceneRequest, normalizeSceneTime, SCENE_LIMITS, SCENE_RUNTIME_VERSION,
    sceneSha256, type NormalizedSceneRequest, type SceneFrameRequest, type SceneJson,
} from './scene-contract'
import { validateSceneGraph } from './scene-graph'

export { SCENE_LIMITS, SCENE_RUNTIME_VERSION } from './scene-contract'
export type { SceneRequest, SceneFrameRequest, SceneElement, SceneJson, NormalizedSceneRequest } from './scene-contract'
export { SCENE_COMPONENT_NAMES, SCENE_DOM_TAGS } from './scene-components'
export { validateSceneGraph } from './scene-graph'

export interface EvaluatedSceneFrame {
    graph: SceneJson
    request: NormalizedSceneRequest
    time: number
    runtimeVersion: string
    sourceSha256: string
    inputSha256: string
}

// The bootstrap and author code both execute inside QuickJS. No host callbacks,
// React functions, opaque references or objects are installed in its global scope.
const bootstrap = String.raw`
const __jsonStringify = JSON.stringify.bind(JSON);
const __objectEntries = Object.entries.bind(Object);
const __isArray = Array.isArray.bind(Array);
const __isFinite = Number.isFinite.bind(Number);
const __Error = Error;
const __ownDescriptor = Object.getOwnPropertyDescriptor.bind(Object);
const __freeze = (value) => {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) __freeze(child);
        Object.freeze(value);
    }
    return value;
};
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const lerp = (from, to, amount) => from + (to - from) * amount;
const ease = (amount) => { const x = clamp(amount); return x * x * (3 - 2 * x); };
const easeInOut = ease;
const easeOut = (amount) => 1 - Math.pow(1 - clamp(amount), 3);
const cue = (name, span = 1) => {
    if (!Object.hasOwn(cues, name)) throw new __Error('Unknown scene cue: ' + name);
    if (!__isFinite(span) || span <= 0) throw new __Error('Cue span must be positive seconds.');
    return clamp((time - cues[name]) / span);
};
let __randomState = seed >>> 0;
Math.random = () => {
    __randomState = (__randomState + 0x6D2B79F5) >>> 0;
    let v = Math.imul(__randomState ^ (__randomState >>> 15), 1 | __randomState);
    v ^= v + Math.imul(v ^ (v >>> 7), 61 | v);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
};
globalThis.Date = undefined;
globalThis.performance = undefined;
const __fragment = '__vizmatic_fragment';
const __jsx = (type, props, ...children) => {
    const attributes = props == null ? {} : { ...props };
    const descendants = children.length ? children : Object.hasOwn(attributes, 'children') ? [attributes.children] : [];
    delete attributes.children;
    if (type === __fragment) return descendants;
    if (typeof type === 'function') return type({ ...attributes, children: descendants.length === 1 ? descendants[0] : descendants });
    if (typeof type !== 'string') throw new __Error('Invalid scene JSX component.');
    return { kind: 'vizmatic.element', type, props: attributes, children: descendants };
};
const React = __freeze({ createElement: __jsx, Fragment: __fragment });
const Fragment = __fragment;
const __primitive = (type) => (props) => {
    const attributes = { ...props };
    const children = Object.hasOwn(attributes, 'children') ? [attributes.children] : [];
    delete attributes.children;
    return { kind: 'vizmatic.element', type, props: attributes, children };
};
const __serialize = (value) => {
    let values = 0;
    return __jsonStringify(value, (key, item) => {
        if (++values > 64000) throw new __Error('Scene graph contains too many values.');
        if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
            throw new __Error('Scene props cannot contain functions, symbols or bigint.');
        }
        if (typeof item === 'number' && !__isFinite(item)) throw new __Error('Scene props must be finite.');
        if (item && typeof item === 'object' && typeof item.then === 'function') throw new __Error('Async scene values are not supported.');
        return item;
    });
};
`

export function prepareSceneSource(source: string): string {
    if (/^\s*(?:import|export)\b|\bimport\s*(?:[('"{*]|\/\*)/m.test(source)) {
        throw new Error('Editable scenes use bare TSX. Imports and exports are disabled; Vizmatic components are provided automatically.')
    }
    const start = findBareRootJsxStart(source, true)
    if (start < 0) throw new Error('Scene source needs one root JSX element after its local declarations.')
    const setup = source.slice(0, start)
    const jsx = extractRootJsx(source.slice(start).trim())
    return transform(`(() => {\n${setup}\nreturn (\n${jsx}\n);\n})()`, {
        transforms: ['typescript', 'jsx'], jsxPragma: 'React.createElement',
        jsxFragmentPragma: 'React.Fragment', production: true, disableESTransforms: true,
    }).code
}

export interface PreparedScene {
    request: NormalizedSceneRequest
    sourceSha256: string
    inputSha256: string
    /** Each call creates a fresh bounded QuickJS runtime, including serialization. */
    evaluate(time?: number): Promise<EvaluatedSceneFrame>
}

export async function prepareScene(request: SceneFrameRequest): Promise<PreparedScene> {
    const normalized = Object.freeze(normalizeSceneRequest(request))
    Object.freeze(normalized.cues)
    const code = prepareSceneSource(normalized.source)
    const sourceSha256 = await sceneSha256(normalized.source)
    const inputSha256 = await sceneSha256(JSON.stringify({ runtimeVersion: SCENE_RUNTIME_VERSION, ...normalized }))
    const QuickJS = await getQuickJS()
    const colors = getThemeColors(normalized.theme)
    const components = `const { ${SCENE_COMPONENT_NAMES.join(', ')} } = Object.fromEntries(${JSON.stringify(SCENE_COMPONENT_NAMES)}.map(name => [name, __primitive(name)]));`
    const evaluate = async (requestedTime?: number): Promise<EvaluatedSceneFrame> => {
        const time = normalizeSceneTime(requestedTime, normalized.duration)
        const runtime = QuickJS.newRuntime()
        runtime.setMemoryLimit(SCENE_LIMITS.memoryBytes)
        runtime.setMaxStackSize(SCENE_LIMITS.stackBytes)
        const deadline = Date.now() + SCENE_LIMITS.evaluationMs
        runtime.setInterruptHandler(() => Date.now() > deadline)
        runtime.removeModuleLoader()
        const vm = runtime.newContext()
        const context = {
            width: normalized.width, height: normalized.height, duration: normalized.duration,
            fps: normalized.fps, time, t: time, progress: time / normalized.duration,
            frame: Math.floor(time * normalized.fps + 1e-9), theme: normalized.theme,
            cues: normalized.cues, seed: normalized.seed, c: colors,
        }
        const declaration = `const { ${Object.keys(context).join(', ')} } = ${JSON.stringify(context)};`
        try {
            const result = vm.evalCode(`(() => { 'use strict';\n${declaration}\n${bootstrap}\n__freeze(c); __freeze(cues);\n${components}\ntry { return __serialize(${code}); } catch (error) {\nif (typeof error === 'string') throw error.slice(0, 1024);\nconst message = error && typeof error === 'object' ? __ownDescriptor(error, 'message')?.value : undefined;\nthrow typeof message === 'string' ? message.slice(0, 1024) : 'Scene evaluation failed.';\n}\n})()`, 'scene.tsx')
            if (result.error) {
                const error = result.error
                try {
                    // Do not evaluate error getters or toString supplied by author code.
                    const message = vm.typeof(error) === 'string' ? vm.getString(error) : 'Scene evaluation failed or exceeded its CPU, stack or memory limit.'
                    throw new Error(message.slice(0, 1_024))
                } finally { error.dispose() }
            }
            const handle = result.value
            try {
                if (vm.typeof(handle) !== 'string') throw new Error('Scene source must return synchronous JSX.')
                const length = vm.getProp(handle, 'length')
                try {
                    if (vm.getNumber(length) > SCENE_LIMITS.graphBytes) throw new Error('Scene graph exceeds its serialized size limit.')
                } finally { length.dispose() }
                const json = vm.getString(handle)
                if (new TextEncoder().encode(json).byteLength > SCENE_LIMITS.graphBytes) throw new Error('Scene graph exceeds its serialized size limit.')
                const graph = validateSceneGraph(JSON.parse(json))
                return { graph, request: normalized, time, runtimeVersion: SCENE_RUNTIME_VERSION, sourceSha256,
                    inputSha256: await sceneSha256(JSON.stringify({ sceneInputSha256: inputSha256, time })) }
            } finally { handle.dispose() }
        } finally {
            vm.dispose()
            runtime.dispose()
        }
    }
    return { request: normalized, sourceSha256, inputSha256, evaluate }
}

/** Browser Workers and Node rendering share this exact evaluator and graph contract. */
export async function evaluateSceneSource(request: SceneFrameRequest): Promise<EvaluatedSceneFrame> {
    return (await prepareScene(request)).evaluate(request.time)
}
