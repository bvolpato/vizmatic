/**
 * Paxos for one value: the Synod protocol of Leslie Lamport, "Paxos Made Simple" (2001), section 2.
 * This file holds the acceptor and the proposer of the paper, and plays them through a schedule: when
 * each proposer starts a round, how long each message waits and travels, and which messages are lost.
 * The film draws the trace of that play: each message from the time it leaves to the time it arrives,
 * each promise with what it reports, and each state of an acceptor. A time of a schedule is a second
 * of the film, so the film types no time of its own for a message. Each message is one `connector.send`.
 *
 * The file stops the build when a run chooses two values: the two runs of the film, and 400 runs with
 * random delays, losses and copies of messages. It also plays a proposer that makes a mistake: one that
 * takes its own value, one that takes the lowest number, and one that counts a promise for an old number.
 * The first two must choose two values on the first schedule of the film, and the random runs must catch all three.
 *
 * Colors: teal is the value X, and orange is the value Y. Yellow is the light on the part to look at.
 * Red is a message that is lost or refused. Every other part is ink or dim.
 * Shapes: a machine is a border with its name. A number in an open pill is a prepare request, and in a
 * filled pill it is a promise. A filled box with a number and a letter is a proposal. A bar beside an
 * acceptor says that it is in a majority.
 */
import {
    Box, assertEqual, beside, boxOf, column, connector, delay, draw, fade, fadeIn, fadeOut, film, grid, group, indicate, place, recolor, rect, row,
    sceneKit, seededRandom, spotlight, surroundingBox, tagTrack, text,
    type Anim, type Block, type Node, type Zone, zone,
} from 'vizmatic/stage'

// ── The protocol: sections 2.2 and 2.5 of the paper ─────────────────────────

type Value = 'X' | 'Y'
type Name = 'p' | 'q'
interface Proposal { n: number; value: Value }
/** A mistake of a proposer. The file plays each one, to show that its checks stop a proposer that does not follow the paper. */
type Fault = 'own value' | 'lowest number' | 'old promise'

const ACCEPTORS = [1, 2, 3, 4, 5]
const MAJORITY = Math.floor(ACCEPTORS.length / 2) + 1

/** An acceptor remembers the number of the highest prepare request that it answered, and the highest proposal that it accepted. */
class Acceptor {
    promised = 0
    accepted: Proposal | null = null

    /** Phase 1b. A prepare request with a higher number than any that it answered gets a promise, with the proposal that it has accepted. */
    prepare(n: number): { accepted: Proposal | null } | null {
        if (n <= this.promised) return null
        this.promised = n
        return { accepted: this.accepted }
    }

    /** Phase 2b. It accepts a proposal, unless it has answered a prepare request with a higher number. */
    accept(proposal: Proposal): boolean {
        if (proposal.n < this.promised) return false
        if (!this.accepted || proposal.n > this.accepted.n) this.accepted = proposal
        return true
    }
}

class Proposer {
    n = 0
    /** The answers to the prepare request with the number `n`: for each acceptor, the proposal that it has accepted. */
    promises = new Map<number, Proposal | null>()
    proposal: Proposal | null = null

    constructor(readonly name: Name, readonly own: Value, private readonly fault: Fault | null) {}

    /** Phase 1a. A new number. The proposer gives up the round before it. */
    prepare(n: number): void {
        this.n = n
        this.promises = new Map()
        this.proposal = null
    }

    /** A promise counts when it answers this number, and the proposal is not out yet. */
    promise(acceptor: number, n: number, accepted: Proposal | null): boolean {
        if (this.proposal || (n !== this.n && this.fault !== 'old promise')) return false
        this.promises.set(acceptor, accepted)
        return true
    }

    /** The proposals that the answers report, each one time, in the order of the answers. */
    get heard(): Proposal[] {
        const reports = [...this.promises.values()].filter((each): each is Proposal => each !== null)
        return reports.filter((each, index) => reports.findIndex((other) => other.n === each.n) === index)
    }

    /**
     * Phase 2a. With promises from a majority, the proposal has the value of the highest-numbered proposal
     * that the answers report. The proposer takes its own value only when they report none.
     */
    propose(): Proposal | null {
        if (this.proposal || this.promises.size < MAJORITY) return null
        const taken = this.fault === 'own value' ? null : highest(this.heard, this.fault === 'lowest number' ? -1 : 1)
        return this.proposal = { n: this.n, value: taken ? taken.value : this.own }
    }
}

/** The proposal with the highest number, or null for an empty list. With the order -1, it is the one with the lowest number. */
const highest = (proposals: Proposal[], order = 1) => proposals.reduce<Proposal | null>((best, each) => (!best || (each.n - best.n) * order > 0 ? each : best), null)

// ── A run: the protocol, played through a schedule ──────────────────────────

/** A proposer starts a round at a time, with a number. It sends its proposal at the moment a majority has answered. */
interface Round { at: number; proposer: Name; n: number }
/** What the network does with one copy of a message: it leaves after `wait`, and it travels for `travel`. With `lostAt`, it is lost at that part of the way. */
interface Fate { wait: number; travel: number; lostAt?: number }
interface Schedule {
    rounds: Round[]
    /** The fate of each copy of a message. A list of two is a message that the network delivers two times. */
    network(message: Pick<Flight, 'kind' | 'proposer' | 'acceptor' | 'n'>): Fate[]
}

/** One message on its way. A prepare and an accept request go from the proposer to the acceptor, and a promise goes back. */
interface Flight {
    kind: 'prepare' | 'promise' | 'accept'
    proposer: Name
    acceptor: number
    n: number
    /** The proposal of an accept request, or the proposal that a promise reports. */
    carries: Proposal | null
    sent: number
    /** The time when it arrives, or when it is lost. */
    ends: number
    lostAt: number | null
    /**
     * What the receiver did with it. An acceptor does not answer an `ignored` prepare request, whose number is not
     * higher, and it does not accept a `refused` proposal. A proposer does not count a `late` promise: its
     * proposal is out, or it has a new number.
     */
    effect: 'lost' | 'promised' | 'ignored' | 'counted' | 'late' | 'accepted' | 'refused'
}

/** A value that a machine shows, when it changes. `who` is `p`, `q`, or an acceptor such as `a3`. */
type Change = { at: number; who: string } & (
    | { field: 'promised'; value: number }
    | { field: 'promises'; value: number }
    | { field: 'accepted'; value: Proposal }
    | { field: 'heard'; value: Proposal[] }
    | { field: 'sends'; value: { prepare: number } | { accept: Proposal } })

interface Run {
    flights: Flight[]
    changes: Change[]
    /** Every proposal that a proposer sent out. */
    issued: Proposal[]
    /** Each time that an acceptor accepted a proposal. */
    accepts: { at: number; acceptor: number; proposal: Proposal }[]
    /** Each proposal that a majority accepted, with the time when the last acceptor of that majority accepted it. */
    chosen: { at: number; proposal: Proposal; by: number[] }[]
    end: number
}

function simulate(schedule: Schedule, fault: Fault | null = null): Run {
    const acceptors = new Map(ACCEPTORS.map((id) => [id, new Acceptor()]))
    const proposers = { p: new Proposer('p', 'X', fault), q: new Proposer('q', 'Y', fault) }
    const run: Run = { flights: [], changes: [], issued: [], accepts: [], chosen: [], end: 0 }
    // The events of the run. The next one is the one with the lowest time, and of two with one time, the one that was made first.
    const queue: { at: number; order: number; act: () => void }[] = []
    let now = 0, made = 0
    const later = (at: number, act: () => void) => queue.push({ at, order: made++, act })

    const send = (kind: Flight['kind'], proposer: Name, acceptor: number, n: number, carries: Proposal | null, arrive: () => Flight['effect']) => {
        for (const fate of schedule.network({ kind, proposer, acceptor, n })) {
            const sent = now + fate.wait
            const flight: Flight = { kind, proposer, acceptor, n, carries, sent, ends: sent + fate.travel * (fate.lostAt ?? 1), lostAt: fate.lostAt ?? null, effect: 'lost' }
            run.flights.push(flight)
            if (fate.lostAt === undefined) later(flight.ends, () => { flight.effect = arrive() })
        }
    }

    /** Phase 2a: with a majority of promises, the proposal goes to each acceptor that answered. */
    const issue = (proposer: Proposer) => {
        const proposal = proposer.propose()
        if (!proposal) return
        run.issued.push(proposal)
        run.changes.push({ at: now, who: proposer.name, field: 'sends', value: { accept: proposal } })
        for (const id of proposer.promises.keys()) send('accept', proposer.name, id, proposal.n, proposal, () => {
            if (!acceptors.get(id)!.accept(proposal)) return 'refused'
            run.changes.push({ at: now, who: `a${id}`, field: 'accepted', value: acceptors.get(id)!.accepted! })
            run.accepts.push({ at: now, acceptor: id, proposal })
            // A proposal is chosen when a majority of the acceptors has accepted it.
            const by = [...new Set(run.accepts.filter((each) => each.proposal.n === proposal.n).map((each) => each.acceptor))].sort((a, b) => a - b)
            if (by.length === MAJORITY && !run.chosen.some((each) => each.proposal.n === proposal.n)) run.chosen.push({ at: now, proposal, by })
            return 'accepted'
        })
    }

    for (const round of schedule.rounds) later(round.at, () => {
        const proposer = proposers[round.proposer], answered = new Set<number>()
        proposer.prepare(round.n)
        const who = proposer.name
        run.changes.push({ at: now, who, field: 'sends', value: { prepare: round.n } }, { at: now, who, field: 'promises', value: 0 }, { at: now, who, field: 'heard', value: [] })
        for (const id of ACCEPTORS) send('prepare', proposer.name, id, round.n, null, () => {
            const promise = acceptors.get(id)!.prepare(round.n)
            if (!promise) return 'ignored'
            run.changes.push({ at: now, who: `a${id}`, field: 'promised', value: round.n })
            send('promise', proposer.name, id, round.n, promise.accepted, () => {
                const counted = proposer.promise(id, round.n, promise.accepted)
                // The proposer shows how many acceptors answered this round, with the ones that answer after its proposal is out.
                if (proposer.n === round.n) run.changes.push({ at: now, who, field: 'promises', value: answered.add(id).size })
                if (!counted) return 'late'
                if (proposer.n === round.n) run.changes.push({ at: now, who, field: 'heard', value: proposer.heard })
                issue(proposer)
                return 'counted'
            })
            return 'promised'
        })
    })

    while (queue.length > 0) {
        const next = queue.reduce((first, each) => (each.at < first.at || (each.at === first.at && each.order < first.order) ? each : first))
        queue.splice(queue.indexOf(next), 1)
        now = next.at
        next.act()
    }
    run.end = now
    return run
}

/**
 * What is not safe in a run, or null. At most one value is chosen. After a proposal is chosen, each proposal with
 * a higher number has its value (P2b of the paper), so a chosen value stays chosen: no later round can choose
 * another one. Proposals have different numbers.
 */
function unsafe(run: Run): string | null {
    if (new Set(run.issued.map((each) => each.n)).size !== run.issued.length) return 'two proposals have one number'
    if (new Set(run.chosen.map((each) => each.proposal.value)).size > 1) return 'two values are chosen'
    for (const { proposal } of run.chosen) {
        const other = run.issued.find((each) => each.n > proposal.n && each.value !== proposal.value)
        if (other) return `(${proposal.n}, ${proposal.value}) is chosen, and the later proposal (${other.n}, ${other.value}) has another value`
    }
    return null
}

// ── The two runs of the film ────────────────────────────────────────────────

/** The place of an acceptor in a wave of messages: p sends to acceptor 1 first, and q to acceptor 5. */
const turn = (proposer: Name, acceptor: number) => (proposer === 'p' ? acceptor - 1 : ACCEPTORS.length - acceptor)

/**
 * The first run, with three rounds. Round 1: p gets a majority of promises, and two of its three accept requests
 * are lost, so (1, X) is on acceptor 1 alone. Round 2: the prepare requests of q to acceptors 1 and 2 are lost,
 * and acceptors 3, 4 and 5 choose (2, Y). Round 3: the answers to p report (1, X) and (2, Y).
 * The first three acceptors of a wave answer one after the other, so that a viewer can follow each promise.
 * The last two answer late: their promises arrive after the proposer has gone on.
 */
const FIRST: Schedule = {
    rounds: [{ at: 3.8, proposer: 'p', n: 1 }, { at: 12.6, proposer: 'q', n: 2 }, { at: 25.8, proposer: 'p', n: 3 }],
    network({ kind, proposer, acceptor, n }) {
        const nth = turn(proposer, acceptor)
        if (kind === 'prepare') return [{ wait: 0.1 * nth, travel: 0.9, ...(n === 2 && acceptor <= 2 ? { lostAt: acceptor === 1 ? 0.45 : 0.6 } : {}) }]
        if (kind === 'promise') return [nth < MAJORITY ? { wait: 0.5 + 0.6 * nth, travel: 0.9 } : { wait: 1.4 + 0.4 * (nth - MAJORITY), travel: 2.6 }]
        return [{ wait: 0.3 * nth, travel: 0.9, ...(n === 1 && acceptor > 1 ? { lostAt: acceptor === 2 ? 0.5 : 0.65 } : {}) }]
    },
}

/**
 * The second run, from section 2.4 of the paper. No message is lost. Each proposer starts a round with a higher
 * number, and its prepare requests arrive before the accept requests of the other one. After its round 4, q stops.
 * The promises of a round arrive 0.6 apart, so the count of a proposer rises one by one, and a viewer can read
 * each count. Its accept requests leave with the third promise, as in the first run.
 */
const SECOND: Schedule = {
    rounds: [{ at: 0, proposer: 'p', n: 1 }, { at: 2.3, proposer: 'q', n: 2 }, { at: 4.6, proposer: 'p', n: 3 }, { at: 6.9, proposer: 'q', n: 4 }, { at: 9.2, proposer: 'p', n: 5 }],
    network({ kind, proposer, acceptor }) {
        const nth = turn(proposer, acceptor)
        if (kind === 'prepare') return [{ wait: 0.05 * nth, travel: 0.7 }]
        return [kind === 'promise' ? { wait: 0.2 + 0.55 * nth, travel: 0.6 } : { wait: 0.3 * nth, travel: 0.8 }]
    },
}

const first = simulate(FIRST), second = simulate(SECOND)
for (const [run, name] of [[first, 'the first run'], [second, 'the second run']] as const) assertEqual(unsafe(run), null, `what is not safe in ${name}`)

const flightsOf = (run: Run, kind: Flight['kind'], n: number, effect: Flight['effect']) => run.flights.filter((each) => each.kind === kind && each.n === n && each.effect === effect)
const acceptorsOf = (flights: Flight[]) => flights.map((each) => each.acceptor).sort((a, b) => a - b)
const changesOf = <F extends Change['field']>(run: Run, who: string, field: F) => run.changes.filter((each): each is Extract<Change, { field: F }> => each.who === who && each.field === field)

// What the film says about the first run.
assertEqual([ACCEPTORS.length, MAJORITY], [5, 3], 'the acceptors, and how many are a majority')
assertEqual(first.issued, [{ n: 1, value: 'X' }, { n: 2, value: 'Y' }, { n: 3, value: 'Y' }], 'the proposals of the first run')
assertEqual(first.accepts.filter((each) => each.proposal.n === 1).map((each) => each.acceptor), [1], 'the acceptors that accept (1, X)')
const [chosen, again] = first.chosen as [Run['chosen'][number], Run['chosen'][number]]
assertEqual([chosen.proposal, chosen.by], [{ n: 2, value: 'Y' }, [3, 4, 5]], 'the proposal that the first run chooses, and its majority')
assertEqual([again.proposal, again.by], [{ n: 3, value: 'Y' }, [1, 2, 3]], 'the proposal of round 3, and its majority')
// The answers that p counts in round 3 report two proposals, with different numbers and different values. Its proposal has the value of the higher number.
const lastRound = FIRST.rounds[2]!
const reports = changesOf(first, 'p', 'heard').pop()!.value
assertEqual(reports, [{ n: 1, value: 'X' }, { n: 2, value: 'Y' }], 'the proposals that p hears of in round 3')
const answering = acceptorsOf(flightsOf(first, 'promise', lastRound.n, 'counted'))
assertEqual([answering, answering.filter((id) => chosen.by.includes(id))], [[1, 2, 3], [3]], 'the majority that answers p in round 3, and the acceptors that it shares with the majority that chose (2, Y)')
// The rule of phase 2a is what keeps this run safe: a proposer that takes the lowest number, or its own value, chooses a second value.
for (const fault of ['lowest number', 'own value'] as const) assertEqual(unsafe(simulate(FIRST, fault)), 'two values are chosen', `what is not safe in the first run, with a proposer that takes the ${fault}`)
assertEqual([first.flights.filter((each) => each.effect === 'lost').length, first.flights.filter((each) => each.effect === 'late').length], [4, 4], 'the lost messages and the late promises of the first run')
/** What each acceptor shows at the end of a run: the number that it promised, and the proposal that it accepted, as a text. */
const shownAtEnd = (run: Run) => ACCEPTORS.map((id) => {
    const accepted = changesOf(run, `a${id}`, 'accepted').pop()?.value
    return `${changesOf(run, `a${id}`, 'promised').pop()?.value} ${accepted ? accepted.n + accepted.value : '-'}`
})
assertEqual(shownAtEnd(first), ['3 3Y', '3 3Y', '3 3Y', '3 2Y', '3 2Y'], 'what the acceptors show at the end of the first run')

// What the film says about the second run.
const raced = second.chosen[0]!
const refusals = second.flights.filter((each) => each.effect === 'refused')
assertEqual([raced.proposal, raced.by], [{ n: 5, value: 'X' }, [1, 2, 3]], 'the proposal that the second run chooses, and its majority')
assertEqual(second.issued.map((each) => each.n), [1, 2, 3, 4, 5], 'the proposals of the second run')
assertEqual([refusals.length, second.accepts.filter((each) => each.proposal.n < raced.proposal.n).length], [4 * MAJORITY, 0], 'the accept requests that the second run refuses, and the ones before the last round that it accepts')
assertEqual(shownAtEnd(second), ['5 5X', '5 5X', '5 5X', '5 -', '5 -'], 'what the acceptors show at the end of the second run')
// The film draws a message that arrives, a lost one, and a refused one. No prepare request of the two runs is ignored.
assertEqual([...first.flights, ...second.flights].filter((each) => each.effect === 'ignored').length, 0, 'the messages that the film has no picture for')

/** Every majority of the acceptors: each set of three. Any two of them share an acceptor. */
const MAJORITIES = ACCEPTORS.flatMap((a) => ACCEPTORS.flatMap((b) => ACCEPTORS.filter((c) => a < b && b < c).map((c) => [a, b, c])))
assertEqual([MAJORITIES.length, MAJORITIES.every((one) => MAJORITIES.every((other) => one.some((id) => other.includes(id))))], [10, true], 'the majorities, and if any two of them share an acceptor')
/** Every other majority of three, for the film to show beside the one that chose (2, Y). In this order, most of them differ from the one before by one acceptor. */
const OTHERS = MAJORITIES.filter((each) => String(each) !== String(chosen.by)).reverse()
assertEqual([OTHERS.length, OTHERS[OTHERS.length - 1]], [9, answering], 'the other majorities of three, and the last one that the film shows: the one that answers p in round 3')

// ── Random runs ─────────────────────────────────────────────────────────────

/** The source line of the film shows this number, and the summary of the film in `catalog.json` names it. */
const RANDOM_RUNS = 400

/**
 * Three to six rounds for each proposer, and a network with a mood for each run: how many messages it loses and
 * copies, and how slow each kind of message is for each proposer. So promises for an old number arrive late.
 */
function randomSchedule(seed: number): Schedule {
    const random = seededRandom(seed)
    const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!
    const loss = pick([0, 0.1, 0.3]), copies = pick([0, 0.15, 0.3])
    const mood = () => ({ prepare: pick([0.3, 2, 9]), promise: pick([0.3, 2, 9]), accept: pick([0.3, 2, 9]) })
    const slow = { p: mood(), q: mood() }
    const rounds: Round[] = []
    // The proposers take their numbers from two sets with no number in common: odd for p, even for q.
    for (const [proposer, lowest] of [['p', 1], ['q', 2]] as const) {
        let at = random() * 3
        for (let k = 0, count = 3 + Math.floor(random() * 4); k < count; k++) {
            rounds.push({ at, proposer, n: lowest + 2 * k })
            at += 0.2 + random() * pick([1, 4, 8])
        }
    }
    return {
        rounds,
        network: ({ kind, proposer }) => Array.from({ length: random() < copies ? 2 : 1 }, () => (random() < loss ? { wait: 0, travel: 1, lostAt: random() } : { wait: 0, travel: 0.1 + slow[proposer][kind] * random() })),
    }
}

/** How many of the random runs choose a value, need the rule of phase 2a, and catch each mistake of a proposer. */
const random = { chosen: 0, adopted: 0, 'own value': 0, 'lowest number': 0, 'old promise': 0 }
for (let seed = 1; seed <= RANDOM_RUNS; seed++) {
    const run = simulate(randomSchedule(seed))
    assertEqual(unsafe(run), null, `what is not safe in the random run ${seed}`)
    if (run.chosen.length > 0) random.chosen++
    // A proposal with an odd number is from p, whose own value is X.
    if (run.issued.some((each) => each.value !== (each.n % 2 === 1 ? 'X' : 'Y'))) random.adopted++
    for (const fault of ['own value', 'lowest number', 'old promise'] as const) if (unsafe(simulate(randomSchedule(seed), fault))) random[fault]++
}
// The random runs test the protocol only when some of them choose a value, some need the rule, and some catch each mistake.
// The counts are here so that a change of the protocol or of the schedules shows what it does to them.
assertEqual(random, { chosen: 297, adopted: 152, 'own value': 96, 'lowest number': 5, 'old promise': 12 }, 'what the random runs choose, need and catch')

// ── The film ────────────────────────────────────────────────────────────────

const COLOR = { X: 'teal', Y: 'orange', light: 'yellow', stop: 'red' } as const
/** The second run starts on a board with nothing on it, and its first message waits until a viewer has read what the run is about. */
const RESTART = first.end + 3.4, RACE = RESTART + 3
const END = RACE + raced.at + 4.4
/** The two runs with the time of the film at which each one starts, and how long a message that is stopped stays. The second run has no time to spare. */
const RUNS = [{ run: first, from: 0, hold: 2.4 }, { run: second, from: RACE, hold: 0.4 }]
/** A node that shows from a time, until the next one of its list takes its place. With no node, the place is empty. */
interface Turn { at: number; show: Node | null }

export default film({
    title: 'Paxos: two majorities share an acceptor',
    description: 'Single-decree Paxos, played by real code: two proposers, five acceptors, and messages that are lost or late.',
    fps: 60,
    font: 'text-serif',
}, (s) => {
    const { area, heading, source, label, chip } = sceneKit({ size: 38, source: { size: 30 }, chip: { size: 30, font: 'mono', height: 1.6, room: 1.2, stroke: 'dim' } })
    const small = { size: 30, color: 'dim' } as const
    const mono = (words: string, size = 32) => text(words, { font: 'mono', size })

    // ── The parts ───────────────────────────────────────────────────────────

    // The picture is over one line of text. The acceptors are a column in its middle, with a proposer at each side.
    const [picture, caption] = area.rows([7, 1], 'none')
    const cell = (width: number) => rect(width, 60, { radius: 8, fill: 'surface', stroke: null })
    const machine = (title: string, cells: Block) => zone(cells, { title, titleSize: 30, padding: 16 })

    const acceptors = ACCEPTORS.map((id) => {
        const promised = cell(128), accepted = cell(128)
        return { promised, accepted, frame: machine(`acceptor ${id}`, row([promised, accepted])) }
    })
    const frames = acceptors.map((each) => each.frame)
    place(column(frames, { align: 'center' }), picture, 'bottom')
    // The names of the two cells stand over the first acceptor, one time for the column.
    const heads = (['promised', 'accepted'] as const).map((field) => beside(label(field, small), frames[0]!, 'above', 'normal', acceptors[0]![field]))

    const proposer = (name: Name) => {
        const names = ['wants', 'promises', 'heard', 'sends'].map((word) => label(word, small))
        const [wants, promises, heard, sends] = names.map(() => cell(236)) as [Node, Node, Node, Node]
        return { wants, promises, heard, sends, frame: machine(`proposer ${name}`, grid([names[0]!, wants, names[1]!, promises, names[2]!, heard, names[3]!, sends], { columns: 2, gap: 'tight' })) }
    }
    const proposers = { p: proposer('p'), q: proposer('q') }
    const middle = boxOf(frames)
    place(proposers.p.frame, new Box(picture.left, middle.top, middle.left, middle.bottom), 'left')
    place(proposers.q.frame, new Box(middle.right, middle.top, picture.right, middle.bottom), 'right')

    // One line from each proposer to each acceptor. A message travels along it.
    const wires = (from: Zone) => frames.map((to, index) => connector(from, to, { route: 'straight', tip: false, color: 'gridStrong', width: 2, fromOffset: (index - 2) * 0.42 }))
    const lanes = { p: wires(proposers.p.frame), q: wires(proposers.q.frame) }

    // A bar at each side of each acceptor. A lit bar says that the acceptor is in a majority: the left bars are one majority, and the right bars are another.
    const bars = (side: 'left' | 'right') => frames.map((frame) => beside(rect(10, boxOf(frame.frame).height, { radius: 5, fill: 'ink', stroke: null }).opacity(0), frame.frame, side, 6))
    const sets = { left: bars('left'), right: bars('right') }
    // What a bar is, in one label beside the names of the cells. It shows with the bars.
    const legend = beside(row([rect(10, 30, { radius: 5, fill: 'ink', stroke: null }), label('in a majority', small)], { gap: 'tight' }), heads[0]!, 'left', 'wide')

    // ── The marks: one shape for each kind of thing ─────────────────────────

    const nothing = () => text('–', { font: 'mono', size: 32, color: 'faint' })
    const request = (n: number) => chip(String(n), { round: true, anchor: 'center' })
    const promise = (n: number) => chip(String(n), { round: true, anchor: 'center', fill: 'ink', stroke: 'ink', color: 'bg' })
    const valueChip = (value: Value) => chip(value, { anchor: 'center', fill: COLOR[value], stroke: COLOR[value], color: 'bg' })
    const proposal = ({ n, value }: Proposal) => chip(`${n} ${value}`, { anchor: 'center', fill: COLOR[value], stroke: COLOR[value], color: 'bg' })
    const pair = (...items: Node[]) => group(row(items, { gap: 'tight', align: 'center' }))
    /** The node for a value of a cell, or for nothing yet. */
    const shown = (change: Change | null): Node => {
        if (!change || (change.field === 'heard' && change.value.length === 0)) return nothing()
        if (change.field === 'promised') return mono(String(change.value), 36)
        if (change.field === 'promises') return mono(`${change.value} of ${ACCEPTORS.length}`)
        if (change.field === 'accepted') return proposal(change.value)
        if (change.field === 'heard') return pair(...change.value.map(proposal))
        return 'prepare' in change.value ? pair(label('prepare', { size: 30 }), request(change.value.prepare)) : pair(label('accept', { size: 30 }), proposal(change.value.accept))
    }

    /** The states of a list that a viewer can read. A state that the next one replaces in less than 0.3 seconds is left out. */
    const readable = <T extends { at: number }>(states: T[]) => states.filter((state, index) => index === 0 || index === states.length - 1 || states[index + 1]!.at - state.at >= 0.3)
    /** The values of one field of one machine through both runs, each with its node. Each run starts with nothing, and a value that does not change is one state. */
    const history = (who: string, field: Change['field']): Turn[] => {
        const values: { at: number; change: Change | null }[] = RUNS.flatMap(({ run, from }) => [{ at: from === 0 ? 0 : RESTART, change: null }, ...changesOf(run, who, field).map((change) => ({ at: from + change.at, change }))])
        // What a state looks like: the start of a run and an empty list both show nothing.
        const look = (change: Change | null) => (!change || (change.field === 'heard' && change.value.length === 0) ? '' : JSON.stringify(change.value))
        return readable(values.filter(({ change }, index) => index === 0 || look(change) !== look(values[index - 1]!.change))).map(({ at, change }) => ({ at, show: shown(change) }))
    }
    /** Put the nodes of a cell at its place, as parts of the machine: a light on a machine is on its values too. Only the first one shows. */
    const inCell = (frame: Zone, slot: Node, states: Turn[]): Turn[] => {
        states.forEach(({ show }, index) => {
            frame.add(show!)
            place(show!, boxOf(slot))
            if (index > 0) show!.hide()
        })
        return states
    }
    const wishes = { p: valueChip('X'), q: valueChip('Y') }
    const promisedCells = acceptors.map((each, index) => inCell(each.frame, each.promised, history(`a${index + 1}`, 'promised')))
    const ofProposers = <F extends 'promises' | 'heard' | 'sends'>(field: F) => ({ p: inCell(proposers.p.frame, proposers.p[field], history('p', field)), q: inCell(proposers.q.frame, proposers.q[field], history('q', field)) })
    const counts = ofProposers('promises'), heardCells = ofProposers('heard'), sendsCells = ofProposers('sends')
    const cells = [
        ...promisedCells, ...acceptors.map((each, index) => inCell(each.frame, each.accepted, history(`a${index + 1}`, 'accepted'))),
        ...(['p', 'q'] as const).flatMap((name) => [inCell(proposers[name].frame, proposers[name].wants, [{ at: 0, show: wishes[name] }]), counts[name], heardCells[name], sendsCells[name]]),
    ]
    /** What a list shows at a time. */
    const showsAt = (states: Turn[], time: number) => states.filter((state) => state.at <= time).pop()!.show!
    // A strike through the value that p wants, for the round in which it sends another value.
    const strike = rect(boxOf(wishes.p).width + 20, 4, { fill: 'ink', stroke: null }).hide()
    proposers.p.frame.add(strike)
    place(strike, boxOf(wishes.p).grow('tight', 'none'))

    // The count of the acceptors that accepted the last proposal, beside the name of their cell. A majority chooses it.
    // A chosen value stays chosen: when a later proposal is accepted, the count gives way to the value.
    const tally: Turn[] = readable(RUNS.flatMap(({ run, from }) => {
        const states: (Turn & { key: string })[] = [{ at: from === 0 ? 0 : RESTART, show: null, key: '' }]
        run.accepts.forEach((accept, index) => {
            const count = new Set(run.accepts.slice(0, index + 1).filter((each) => each.proposal.n === accept.proposal.n).map((each) => each.acceptor)).size
            const done = run.chosen.find((each) => each.at <= accept.at && each.proposal.n !== accept.proposal.n)
            const key = done ? done.proposal.value : `${accept.proposal.n} ${count}`
            if (key === states[states.length - 1]!.key) return
            const words = done ? [valueChip(done.proposal.value)] : [proposal(accept.proposal), mono(`${count} of ${ACCEPTORS.length}`, 30)]
            const chosenNow = done !== undefined || count >= MAJORITY
            states.push({ at: from + accept.at, key, show: beside(pair(...words, ...(chosenNow ? [label('chosen', { size: 30, color: COLOR.light })] : [])), heads[1]!, 'right', 'normal') })
        })
        return states
    }))

    // ── The frame: the heading, the name of the run, the line for what happens now, and the source ──

    const title = heading('Paxos: two majorities share an acceptor')
    const from = source(`Leslie Lamport, “Paxos Made Simple”, 2001. Each run is real: the code of this film also checks ${RANDOM_RUNS} random ones.`)
    const status = tagTrack([
        { at: 0.4, word: 'RUN 1', note: 'messages are lost or late' },
        { at: RESTART + 0.1, word: 'RUN 2', note: 'two proposers race' },
    ], { until: END + 1, size: 30, anchor: 'right', noteFont: 'text-serif' }).at(area.right, title.get('y'))

    const [round1, round2] = FIRST.rounds as [Round, Round]
    const issueAt = (run: Run, who: Name, n: number) => changesOf(run, who, 'sends').find((each) => 'accept' in each.value && each.value.accept.n === n)!.at
    // The film shows other majorities when a viewer has read that a value is chosen.
    const pairsAt = chosen.at + 2.6
    const lines: Turn[] = ([
        [0, 'Five acceptors must choose one value.'],
        [round1.at, 'Phase 1. A promise: accept no lower number.'],
        [issueAt(first, 'p', round1.n), 'Phase 2. A majority promised: p sends accept.'],
        [issueAt(first, 'p', round1.n) + 2.5, `${first.accepts.filter((each) => each.proposal.n === round1.n).length} of ${ACCEPTORS.length} is no majority: X is not chosen.`],
        [round2.at, 'q tries, with a higher number.'],
        [chosen.at, `A majority accepted it: ${chosen.proposal.value} is chosen.`],
        [pairsAt, `All ${OTHERS.length} other majorities of three share an acceptor with it.`],
        [lastRound.at + 0.9, 'A promise reports what the acceptor accepted.'],
        [issueAt(first, 'p', lastRound.n), 'The rule: take the value with the highest number.'],
        [RESTART, 'No loss now. Both proposers keep trying.'],
        [RACE + refusals[0]!.ends, 'Each prepare blocks the accept of the other.'],
        [RACE + refusals[refusals.length - 1]!.ends, '“A distinguished proposer must be selected.”'],
        [RACE + raced.at + 1.2, 'In every run, at most one value is chosen.'],
    ] as const).map(([at, words]) => ({ at, show: place(label(words), caption, 'left') }))

    // ── The timeline. The machines come first, so that each message is drawn over them. ──

    s.add(title, from, status, lines[0]!.show!)
    s.chapter('The parts')
    s.play(fadeIn(frames, { lag: 0.2 }), fadeIn(heads), { duration: 1.2 })
    s.play(fadeIn([proposers.p.frame, proposers.q.frame]), draw([...lanes.p, ...lanes.q], { lag: 0.05 }), { duration: 1 })
    // The bars are over the lines, and they show later.
    s.add([...sets.left, ...sets.right])
    for (const [at, name] of [
        [round1.at, 'Phase 1: prepare and promise'], [issueAt(first, 'p', round1.n), 'Phase 2: accept'], [round2.at, 'A majority chooses'], [pairsAt, 'Two majorities'],
        [lastRound.at, 'The rule'], [RESTART, 'No progress'], [RACE + raced.at, 'One value'],
    ] as const) s.at(at, () => s.chapter(name))

    // Each value of a cell, each count, and each line takes the place of the one before it at its time. The old one is gone before the new one can be read.
    for (const states of [...cells, tally, lines]) states.slice(1).forEach(({ at, show }, index) => s.at(at, () => {
        const before = states[index]!.show
        s.play(...(before ? [fadeOut(before, { duration: 0.15 })] : []), ...(show ? [delay(fadeIn(show, { duration: 0.25 }), 0.1)] : []))
    }))

    // ── The messages of both runs ───────────────────────────────────────────

    for (const { run, from: start, hold } of RUNS) for (const flight of run.flights) {
        const mark = flight.kind === 'prepare' ? request(flight.n) : flight.kind === 'accept' ? proposal(flight.carries!) : flight.carries ? pair(promise(flight.n), proposal(flight.carries)) : promise(flight.n)
        // The message leaves and arrives at its times of the run. A promise goes back to the proposer. A message stops clear of the bar of an acceptor.
        const sent = lanes[flight.proposer][flight.acceptor - 1]!.send(mark, {
            duration: flight.ends - flight.sent, reverse: flight.kind === 'promise', lost: flight.lostAt ?? undefined, refused: flight.effect === 'refused', hold, stopColor: COLOR.stop, gap: 20,
        })
        s.at(start + flight.sent, () => s.play(sent))
        // The reason of a refusal is the number that the acceptor promised.
        if (flight.effect === 'refused') s.at(start + flight.ends, () => s.play(indicate(showsAt(promisedCells[flight.acceptor - 1]!, start + flight.ends), { color: COLOR.light, scale: 1.5, duration: hold })))
    }

    // ── What the film points at ─────────────────────────────────────────────

    // In the first run the promises arrive one by one. The count is lit when it is a majority: the proposer goes on then.
    // The light comes when the count before it is gone.
    for (const round of FIRST.rounds) {
        const at = issueAt(first, round.proposer, round.n)
        s.at(at + 0.3, () => s.play(indicate(showsAt(counts[round.proposer], at), { color: COLOR.light, scale: 1.3, duration: 1.2 })))
    }

    // A ring around the cell of each acceptor of the majority that chose a proposal.
    for (const { run, from: start } of RUNS) for (const choice of run.chosen) s.at(start + choice.at + 0.2, () => {
        const rings = choice.by.map((id) => surroundingBox(acceptors[id - 1]!.accepted, { color: COLOR.light, pad: 5, radius: 12, width: 3 }))
        s.play(draw(rings, { duration: 0.6 }))
        s.wait(1.6)
        s.play(fadeOut(rings, { duration: 0.4 }))
    })

    /** Light the bars of two majorities, and the border of each acceptor that is in both. */
    const majorities = (left: number[], right: number[], duration = 0.25): Anim[] => ACCEPTORS.flatMap((id, index) => [
        fade(sets.left[index]!, left.includes(id) ? 1 : 0, { duration }),
        fade(sets.right[index]!, right.includes(id) ? 1 : 0, { duration }),
        ...[frames[index]!.frame, frames[index]!.title!].map((part) => recolor(part, left.includes(id) && right.includes(id) ? COLOR.light : 'dim', { duration })),
    ])
    // The majority that chose a value, and every other majority of three, one after the other: each one shares an acceptor with it.
    // A step is short, so the bars change at once, and each picture of the sweep is sharp.
    s.at(pairsAt, () => {
        s.play(...majorities([], chosen.by), fadeIn(legend, { duration: 0.25 }))
        s.wait(0.35)
        for (const other of OTHERS) {
            s.play(...majorities(other, chosen.by, 0.1))
            s.wait(0.4)
        }
        s.play(...majorities([], chosen.by))
    })
    // In round 3, the left bar of an acceptor lights when p counts its promise. The third one is in both majorities.
    for (const flight of flightsOf(first, 'promise', lastRound.n, 'counted')) s.at(flight.ends, () => s.play(...majorities(answering.filter((id) => id <= flight.acceptor), chosen.by)))
    s.at(again.at + 2.6, () => s.play(...majorities([], []), fadeOut(legend, { duration: 0.25 })))

    // The rule: of the proposals that p heard of, it takes the one with the highest number, and not the value that it wants.
    const heardOf = showsAt(heardCells.p, issueAt(first, 'p', lastRound.n) + 0.01)
    const taken = heardOf.children[reports.indexOf(highest(reports)!)]!
    const ring = surroundingBox(taken, { color: COLOR.light, pad: 4, radius: 12, width: 3 })
    s.at(issueAt(first, 'p', lastRound.n) + 0.4, () => s.play(draw(ring, { duration: 0.5 }), ...heardOf.children.filter((each) => each !== taken).map((each) => fade(each, 0.45, { duration: 0.4 })), fadeIn(strike, { duration: 0.3 }), fade(wishes.p, 0.6, { duration: 0.3 })))
    // The second run starts from nothing.
    s.at(RESTART, () => s.play(fadeOut([ring, strike], { duration: 0.15 }), fade(wishes.p, 1, { duration: 0.15 })))
    // After its last refusal q stops, and p goes on alone: the light leaves q and its lines, until a value is chosen.
    s.at(RACE + refusals[refusals.length - 1]!.ends, () => s.play(spotlight([proposers.p.frame, ...frames, ...lanes.p, ...heads], { keep: [title, from] })))
    s.at(lines[lines.length - 1]!.at, () => s.play(spotlight(null)))

    s.wait(END - s.time)
})
