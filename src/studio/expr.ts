/**
 * A small math language for function inputs such as `a * sin(2x)`. Projects arrive
 * through shared links, so these strings are parsed here and never run as code.
 */
export class ExprError extends Error {
    constructor(message: string, readonly at: number) {
        super(message)
        this.name = 'ExprError'
    }
}

type Ast =
    | { type: 'num'; value: number }
    | { type: 'var'; name: string }
    | { type: 'neg'; arg: Ast }
    | { type: 'bin'; op: '+' | '-' | '*' | '/' | '%' | '^'; left: Ast; right: Ast }
    | { type: 'call'; name: string; args: Ast[] }

const FUNCTIONS: Record<string, { arity: [number, number]; run: (...args: number[]) => number; js: (args: string[]) => string }> = {
    sin: { arity: [1, 1], run: Math.sin, js: (a) => `Math.sin(${a[0]})` },
    cos: { arity: [1, 1], run: Math.cos, js: (a) => `Math.cos(${a[0]})` },
    tan: { arity: [1, 1], run: Math.tan, js: (a) => `Math.tan(${a[0]})` },
    asin: { arity: [1, 1], run: Math.asin, js: (a) => `Math.asin(${a[0]})` },
    acos: { arity: [1, 1], run: Math.acos, js: (a) => `Math.acos(${a[0]})` },
    atan: { arity: [1, 1], run: Math.atan, js: (a) => `Math.atan(${a[0]})` },
    atan2: { arity: [2, 2], run: Math.atan2, js: (a) => `Math.atan2(${a[0]}, ${a[1]})` },
    sinh: { arity: [1, 1], run: Math.sinh, js: (a) => `Math.sinh(${a[0]})` },
    cosh: { arity: [1, 1], run: Math.cosh, js: (a) => `Math.cosh(${a[0]})` },
    tanh: { arity: [1, 1], run: Math.tanh, js: (a) => `Math.tanh(${a[0]})` },
    exp: { arity: [1, 1], run: Math.exp, js: (a) => `Math.exp(${a[0]})` },
    log: { arity: [1, 1], run: Math.log, js: (a) => `Math.log(${a[0]})` },
    ln: { arity: [1, 1], run: Math.log, js: (a) => `Math.log(${a[0]})` },
    log10: { arity: [1, 1], run: Math.log10, js: (a) => `Math.log10(${a[0]})` },
    log2: { arity: [1, 1], run: Math.log2, js: (a) => `Math.log2(${a[0]})` },
    sqrt: { arity: [1, 1], run: Math.sqrt, js: (a) => `Math.sqrt(${a[0]})` },
    cbrt: { arity: [1, 1], run: Math.cbrt, js: (a) => `Math.cbrt(${a[0]})` },
    abs: { arity: [1, 1], run: Math.abs, js: (a) => `Math.abs(${a[0]})` },
    floor: { arity: [1, 1], run: Math.floor, js: (a) => `Math.floor(${a[0]})` },
    ceil: { arity: [1, 1], run: Math.ceil, js: (a) => `Math.ceil(${a[0]})` },
    round: { arity: [1, 1], run: Math.round, js: (a) => `Math.round(${a[0]})` },
    sign: { arity: [1, 1], run: Math.sign, js: (a) => `Math.sign(${a[0]})` },
    min: { arity: [2, 8], run: Math.min, js: (a) => `Math.min(${a.join(', ')})` },
    max: { arity: [2, 8], run: Math.max, js: (a) => `Math.max(${a.join(', ')})` },
    pow: { arity: [2, 2], run: Math.pow, js: (a) => `(${a[0]}) ** (${a[1]})` },
}

const CONSTANTS: Record<string, { value: number; js: string }> = {
    pi: { value: Math.PI, js: 'Math.PI' },
    tau: { value: Math.PI * 2, js: '(Math.PI * 2)' },
    e: { value: Math.E, js: 'Math.E' },
}

interface Token {
    kind: 'num' | 'name' | 'op' | 'end'
    text: string
    at: number
}

function tokenize(source: string): Token[] {
    const tokens: Token[] = []
    let i = 0
    while (i < source.length) {
        const ch = source[i]!
        if (/\s/.test(ch)) {
            i++
        } else if (/[0-9.]/.test(ch)) {
            const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(source.slice(i))
            if (!match) throw new ExprError(`Unexpected "${ch}"`, i)
            tokens.push({ kind: 'num', text: match[0], at: i })
            i += match[0].length
        } else if (/[A-Za-z_]/.test(ch)) {
            const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!
            tokens.push({ kind: 'name', text: match[0], at: i })
            i += match[0].length
        } else if ('+-*/%^(),'.includes(ch)) {
            tokens.push({ kind: 'op', text: ch, at: i })
            i++
        } else {
            throw new ExprError(`Unexpected "${ch}"`, i)
        }
    }
    tokens.push({ kind: 'end', text: '', at: source.length })
    return tokens
}

function parse(source: string, allowed: ReadonlySet<string>): Ast {
    if (source.length > 2000) throw new ExprError('This expression is too long', 0)
    const tokens = tokenize(source)
    let index = 0
    let depth = 0
    const peek = () => tokens[index]!
    const take = () => tokens[index++]!
    const isOp = (text: string) => peek().kind === 'op' && peek().text === text

    const expression = (): Ast => {
        if (++depth > 64) throw new ExprError('This expression nests too deeply', peek().at)
        try {
            let left = term()
            while (isOp('+') || isOp('-')) {
                const op = take().text as '+' | '-'
                left = { type: 'bin', op, left, right: term() }
            }
            return left
        } finally {
            depth--
        }
    }
    const term = (): Ast => {
        let left = unary()
        while (true) {
            if (isOp('*') || isOp('/') || isOp('%')) {
                const op = take().text as '*' | '/' | '%'
                left = { type: 'bin', op, left, right: unary() }
            } else if (peek().kind === 'num' || peek().kind === 'name' || isOp('(')) {
                // Implicit multiplication: 2x, 3 sin(x), (x + 1)(x - 1).
                left = { type: 'bin', op: '*', left, right: power() }
            } else {
                return left
            }
        }
    }
    const unary = (): Ast => {
        if (isOp('-')) {
            take()
            return { type: 'neg', arg: unary() }
        }
        if (isOp('+')) {
            take()
            return unary()
        }
        return power()
    }
    const power = (): Ast => {
        const base = atom()
        if (isOp('^')) {
            take()
            return { type: 'bin', op: '^', left: base, right: unary() }
        }
        return base
    }
    const atom = (): Ast => {
        const token = take()
        if (token.kind === 'num') return { type: 'num', value: Number(token.text) }
        if (token.kind === 'op' && token.text === '(') {
            const inner = expression()
            if (!isOp(')')) throw new ExprError('Missing ")"', peek().at)
            take()
            return inner
        }
        if (token.kind === 'name') {
            const fn = Object.hasOwn(FUNCTIONS, token.text) ? FUNCTIONS[token.text] : undefined
            if (isOp('(')) {
                if (!fn) throw new ExprError(`Unknown function "${token.text}"`, token.at)
                take()
                const args: Ast[] = []
                if (!isOp(')')) {
                    args.push(expression())
                    while (isOp(',')) {
                        take()
                        args.push(expression())
                    }
                }
                if (!isOp(')')) throw new ExprError('Missing ")"', peek().at)
                take()
                if (args.length < fn.arity[0] || args.length > fn.arity[1]) {
                    throw new ExprError(`${token.text} takes ${fn.arity[0] === fn.arity[1] ? fn.arity[0] : `${fn.arity[0]} to ${fn.arity[1]}`} argument(s)`, token.at)
                }
                return { type: 'call', name: token.text, args }
            }
            if (allowed.has(token.text)) return { type: 'var', name: token.text }
            if (Object.hasOwn(CONSTANTS, token.text)) return { type: 'var', name: token.text }
            if (fn) throw new ExprError(`${token.text} needs parentheses`, token.at)
            throw new ExprError(`Unknown name "${token.text}"`, token.at)
        }
        if (token.kind === 'end') throw new ExprError('The expression ends too early', token.at)
        throw new ExprError(`Unexpected "${token.text}"`, token.at)
    }

    const result = expression()
    if (peek().kind !== 'end') throw new ExprError(`Unexpected "${peek().text}"`, peek().at)
    return result
}

function evaluate(ast: Ast, env: Readonly<Record<string, number>>): number {
    switch (ast.type) {
        case 'num': return ast.value
        case 'var': {
            if (Object.hasOwn(env, ast.name)) return env[ast.name]!
            return CONSTANTS[ast.name]?.value ?? NaN
        }
        case 'neg': return -evaluate(ast.arg, env)
        case 'bin': {
            const a = evaluate(ast.left, env), b = evaluate(ast.right, env)
            switch (ast.op) {
                case '+': return a + b
                case '-': return a - b
                case '*': return a * b
                case '/': return a / b
                case '%': return a % b
                case '^': return Math.pow(a, b)
            }
            break
        }
        case 'call': return FUNCTIONS[ast.name]!.run(...ast.args.map((arg) => evaluate(arg, env)))
    }
    return NaN
}

const PRECEDENCE = { num: 5, var: 5, call: 5, '^': 3, neg: 2, '*': 1, '/': 1, '%': 1, '+': 0, '-': 0 } as const

function rank(ast: Ast): number {
    if (ast.type === 'bin') return PRECEDENCE[ast.op]
    return PRECEDENCE[ast.type]
}

function toJs(ast: Ast, name: (variable: string) => string): string {
    const wrap = (child: Ast, min: number) => rank(child) < min ? `(${toJs(child, name)})` : toJs(child, name)
    switch (ast.type) {
        case 'num': return String(ast.value)
        case 'var': return Object.hasOwn(CONSTANTS, ast.name) ? name(ast.name) === ast.name ? CONSTANTS[ast.name]!.js : name(ast.name) : name(ast.name)
        // JavaScript rejects -x ** 2 without parentheses, so powers are wrapped here.
        case 'neg': return `-${wrap(ast.arg, 4)}`
        case 'bin': {
            if (ast.op === '^') return `${wrap(ast.left, 4)} ** ${wrap(ast.right, 2)}`
            const own = PRECEDENCE[ast.op]
            return `${wrap(ast.left, own)} ${ast.op} ${wrap(ast.right, own + 1)}`
        }
        case 'call': return FUNCTIONS[ast.name]!.js(ast.args.map((arg) => toJs(arg, name)))
    }
}

function collect(ast: Ast, into: Set<string>): void {
    if (ast.type === 'var') {
        into.add(ast.name)
    } else if (ast.type === 'neg') {
        collect(ast.arg, into)
    } else if (ast.type === 'bin') {
        collect(ast.left, into)
        collect(ast.right, into)
    } else if (ast.type === 'call') {
        for (const arg of ast.args) collect(arg, into)
    }
}

export interface Expr {
    readonly source: string
    /** Variables the expression reads, other than constants. */
    readonly variables: ReadonlySet<string>
    run(env: Readonly<Record<string, number>>): number
    /** The same math as a JavaScript expression, for generated code. */
    js(name?: (variable: string) => string): string
}

/** Parse an expression. Throws ExprError with a position when it is not valid. */
export function parseExpr(source: string, allowed: readonly string[] = []): Expr {
    const allowedSet = new Set(allowed)
    const ast = parse(source, allowedSet)
    const names = new Set<string>()
    collect(ast, names)
    const variables = new Set([...names].filter((name) => allowedSet.has(name)))
    return {
        source,
        variables,
        run: (env) => evaluate(ast, env),
        js: (name = (variable) => variable) => toJs(ast, name),
    }
}

/** Check an expression and return a message, or null when it is fine. */
export function exprProblem(source: string, allowed: readonly string[] = []): string | null {
    try {
        parseExpr(source, allowed)
        return null
    } catch (error) {
        return error instanceof Error ? error.message : String(error)
    }
}
