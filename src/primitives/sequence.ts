import React from 'react'
import {
    type ThemeColors,
    type ToneName,
    getReadableTextColor,
    getReadableToneColor,
    getToneColor,
    getToneFill,
} from '../theme'

import { ArrowMarkerDef } from './svg'
import { Icon, textFitStyle, type IconName } from './layout'

/** The visual role used for a participant header. */
export type SequenceParticipantKind = 'participant' | 'actor' | 'boundary' | 'control' | 'entity' | 'database'

export interface SequenceParticipant {
    id: string
    label: React.ReactNode
    detail?: React.ReactNode
    tone?: ToneName
    kind?: SequenceParticipantKind
    icon?: IconName
    muted?: boolean
}

export type SequenceMessageKind = 'sync' | 'async' | 'return'

export interface SequenceMessage {
    id?: string
    from: string
    to: string
    label?: React.ReactNode
    kind?: SequenceMessageKind
    tone?: ToneName
    muted?: boolean
}

export interface SequenceNote {
    id?: string
    type: 'note'
    text: React.ReactNode
    participant?: string
    over?: string[]
    side?: 'left' | 'right' | 'over'
    tone?: ToneName
    muted?: boolean
}

export interface SequenceActivation {
    id?: string
    participant: string
    start?: number | string
    end?: number | string
    fromMessage?: string
    toMessage?: string
    depth?: number
    tone?: ToneName
    muted?: boolean
    type: 'activation'
}

export type SequenceFragmentKind = 'alt' | 'loop' | 'parallel'

export interface SequenceFragmentBranch {
    id?: string
    label?: React.ReactNode
    items?: SequenceItem[]
}

export interface SequenceFragment {
    id?: string
    kind: SequenceFragmentKind
    label?: React.ReactNode
    items?: SequenceItem[]
    branches?: SequenceFragmentBranch[]
    tone?: ToneName
    muted?: boolean
}

export type SequenceItem = SequenceMessage | SequenceNote | SequenceActivation | SequenceFragment

export interface SequenceDiagramProps {
    c: ThemeColors
    participants: SequenceParticipant[]
    messages?: SequenceMessage[]
    notes?: SequenceNote[]
    activations?: SequenceActivation[]
    fragments?: SequenceFragment[]
    /** Ordered event input. When present, it is the source of row order. */
    items?: SequenceItem[]
    title?: React.ReactNode
    subtitle?: React.ReactNode
    ariaLabel?: string
    width?: number
    height?: number
    padding?: number
    participantWidth?: number
    participantGap?: number
    rowHeight?: number
    fragmentIndent?: number
    noteWidth?: number
    lifelineDash?: string
}

interface SequenceRow {
    key: string
    item?: SequenceItem
    marker?: {
        fragment: SequenceFragment
        branch?: SequenceFragmentBranch
        branchIndex?: number
    }
    depth: number
}

interface SequenceFragmentSpan {
    id: string
    start: number
    end: number
    depth: number
    fragment: SequenceFragment
    branchStarts: Array<{ row: number; label: React.ReactNode }>
}

const sequenceFragmentKinds: SequenceFragmentKind[] = ['alt', 'loop', 'parallel']
const sequenceMessageKinds: SequenceMessageKind[] = ['sync', 'async', 'return']

function isFragment(item: SequenceItem): item is SequenceFragment {
    return !('from' in item) && (!('type' in item) || (item.type !== 'note' && item.type !== 'activation'))
}

function isActivation(item: SequenceItem): item is SequenceActivation {
    return 'type' in item && item.type === 'activation'
}

function isNote(item: SequenceItem): item is SequenceNote {
    return 'type' in item && item.type === 'note'
}

function sequenceFragmentKind(fragment: SequenceFragment): SequenceFragmentKind {
    const kind = fragment.kind
    if (kind == null || !sequenceFragmentKinds.includes(kind)) {
        throw new Error(`SequenceDiagram fragment must define kind as "alt", "loop", or "parallel".`)
    }
    return kind
}

function sequenceMessageKind(message: SequenceMessage): SequenceMessageKind {
    const kind = message.kind
    if (kind == null) return 'sync'
    if (!sequenceMessageKinds.includes(kind)) {
        throw new Error(`SequenceDiagram message kind must be "sync", "async", or "return".`)
    }
    return kind
}

function sequenceNoteText(note: SequenceNote): React.ReactNode {
    return note.text
}

function sequenceContainerItems(container: {
    items?: SequenceItem[]
    messages?: SequenceMessage[]
    notes?: SequenceNote[]
    fragments?: SequenceFragment[]
}): SequenceItem[] {
    if (container.items) return container.items
    return [
        ...(container.messages ?? []),
        ...(container.notes ?? []),
        ...(container.fragments ?? []),
    ]
}

function participantReferences(note: SequenceNote): string[] {
    const references = note.over ?? []
    if (note.participant && !references.includes(note.participant)) return [note.participant, ...references]
    return references
}

function validateSequenceItems(
    items: SequenceItem[],
    participantIds: Set<string>,
    path: string,
): void {
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        const itemPath = `${path}[${index}]`
        if (isFragment(item)) {
            const kind = sequenceFragmentKind(item)
            const branches = item.branches ?? []
            if ((kind === 'alt' || kind === 'parallel') && branches.length < 2) {
                throw new Error(`SequenceDiagram ${kind} fragment at ${itemPath} requires at least two branches.`)
            }
            if (branches.some((branch) => !branch || typeof branch !== 'object')) {
                throw new Error(`SequenceDiagram fragment at ${itemPath} contains an invalid branch.`)
            }
            for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
                validateSequenceItems(
                    sequenceContainerItems(branches[branchIndex]),
                    participantIds,
                    `${itemPath}.branches[${branchIndex}]`,
                )
            }
            if (!branches.length) {
                validateSequenceItems(sequenceContainerItems(item), participantIds, `${itemPath}.items`)
            }
            continue
        }
        if (isActivation(item)) {
            if (!participantIds.has(item.participant)) {
                throw new Error(`SequenceDiagram activation references missing participant "${item.participant}".`)
            }
            continue
        }
        if (isNote(item)) {
            for (const participant of participantReferences(item)) {
                if (!participantIds.has(participant)) {
                    throw new Error(`SequenceDiagram note references missing participant "${participant}".`)
                }
            }
            continue
        }
        if (!participantIds.has(item.from) || !participantIds.has(item.to)) {
            throw new Error(`SequenceDiagram message "${item.from}" -> "${item.to}" references a missing participant.`)
        }
        sequenceMessageKind(item)
    }
}

function validateSequenceSpec(
    participants: SequenceParticipant[],
    items: SequenceItem[],
): void {
    const ids = new Set<string>()
    for (const participant of participants) {
        if (!participant.id.trim()) throw new Error('SequenceDiagram participant ids must not be empty.')
        if (ids.has(participant.id)) throw new Error(`SequenceDiagram received duplicate participant id "${participant.id}".`)
        ids.add(participant.id)
    }
    validateSequenceItems(items, ids, 'items')
}

function branchLabel(branch: SequenceFragmentBranch, index: number): React.ReactNode {
    return branch.label ?? (index === 0 ? 'case' : 'else')
}

function flattenSequenceItems(items: SequenceItem[]): { rows: SequenceRow[]; spans: SequenceFragmentSpan[] } {
    const rows: SequenceRow[] = []
    const spans: SequenceFragmentSpan[] = []

    const appendItems = (nextItems: SequenceItem[], depth: number, path: string): void => {
        nextItems.forEach((item, index) => {
            if (!isFragment(item)) {
                rows.push({ key: item.id ?? `${path}-${index}`, item, depth })
                return
            }

            const fragmentId = item.id ?? `${path}-fragment-${index}`
            const start = rows.length
            const branchStarts: Array<{ row: number; label: React.ReactNode }> = []
            const branches = item.branches ?? []
            if (branches.length) {
                branches.forEach((branch, branchIndex) => {
                    const row = rows.length
                    branchStarts.push({ row, label: branchLabel(branch, branchIndex) })
                    rows.push({
                        key: `${fragmentId}-branch-${branchIndex}`,
                        marker: { fragment: item, branch, branchIndex },
                        depth,
                    })
                    appendItems(sequenceContainerItems(branch), depth + 1, `${fragmentId}-branch-${branchIndex}`)
                })
            } else {
                rows.push({ key: `${fragmentId}-start`, marker: { fragment: item }, depth })
                appendItems(sequenceContainerItems(item), depth + 1, fragmentId)
            }
            if (rows.length === start) rows.push({ key: `${fragmentId}-empty`, marker: { fragment: item }, depth })
            spans.push({
                id: fragmentId,
                start,
                end: Math.max(start, rows.length - 1),
                depth,
                fragment: item,
                branchStarts,
            })
        })
    }

    appendItems(items, 0, 'sequence')
    return { rows, spans }
}

function readableNodeText(value: React.ReactNode): string {
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    return ''
}

function sequenceMarkerPath(fromX: number, toX: number, y: number, rowHeight: number, selfLoop: boolean): string {
    if (!selfLoop) return `M ${fromX} ${y} L ${toX} ${y}`
    const loopWidth = 34
    const right = fromX + loopWidth
    const bottom = y + rowHeight * 0.52
    return `M ${fromX} ${y} L ${right} ${y} L ${right} ${bottom} L ${fromX + 10} ${bottom} L ${fromX + 10} ${y + 1}`
}

function sequenceNoteBounds(
    note: SequenceNote,
    xs: Map<string, number>,
    chartWidth: number,
    noteWidth: number,
    padding: number,
): { left: number; width: number } {
    const references = participantReferences(note).filter((id) => xs.has(id))
    if (references.length >= 2 || note.side === 'over') {
        const values = references.map((id) => xs.get(id) ?? chartWidth / 2)
        const left = Math.max(padding, Math.min(...values) - noteWidth / 2)
        const right = Math.min(chartWidth - padding, Math.max(...values) + noteWidth / 2)
        return { left, width: Math.max(82, right - left) }
    }
    const anchor = references.length ? (xs.get(references[0]) ?? chartWidth / 2) : chartWidth / 2
    const left = note.side === 'left'
        ? anchor - noteWidth - 18
        : note.side === 'right'
            ? anchor + 18
            : anchor - noteWidth / 2
    return {
        left: Math.max(padding, Math.min(chartWidth - padding - noteWidth, left)),
        width: noteWidth,
    }
}

function activationReference(value: number | string | undefined, rows: SequenceRow[], fallback: number, end: boolean): number {
    if (value == null) return fallback
    if (typeof value === 'number') {
        if (!Number.isInteger(value) || value < 0 || value >= Math.max(rows.length, 1)) {
            throw new Error(`SequenceDiagram activation row reference ${value} is outside rendered rows.`)
        }
        return value
    }
    const index = rows.findIndex((row) => row.key === value || (row.item != null && row.item.id === value))
    if (index < 0) throw new Error(`SequenceDiagram activation references missing row "${value}".`)
    return end ? index : index
}

/**
 * Render a deterministic sequence diagram with typed lifelines, messages,
 * notes, activations, and nested alt/loop/parallel fragments.
 */
export function SequenceDiagram({
    c,
    participants,
    messages = [],
    notes = [],
    activations = [],
    fragments = [],
    items,
    title,
    subtitle,
    ariaLabel,
    width,
    height,
    padding = 24,
    participantWidth = 132,
    participantGap = 42,
    rowHeight = 56,
    fragmentIndent = 12,
    noteWidth = 156,
    lifelineDash = '5 5',
}: SequenceDiagramProps): React.ReactElement {
    const orderedItems = items ?? sequenceContainerItems({ messages, notes, fragments })
    validateSequenceSpec(participants, activations.length ? [...orderedItems, ...activations] : orderedItems)
    const flattened = flattenSequenceItems(orderedItems)
    const rows = flattened.rows.length ? flattened.rows : [{ key: 'sequence-empty', depth: 0 }]
    const minimumWidth = padding * 2 + participantWidth * participants.length + participantGap * Math.max(0, participants.length - 1)
    const resolvedWidth = width ?? Math.max(560, minimumWidth)
    if (width != null && width < minimumWidth) {
        throw new Error(`SequenceDiagram width ${width} is too small for ${participants.length} participants; use at least ${minimumWidth}.`)
    }
    const headerHeight = 92
    const minimumHeight = padding + headerHeight + rows.length * rowHeight + padding
    const resolvedHeight = height ?? minimumHeight
    if (height != null && height < minimumHeight) {
        throw new Error(`SequenceDiagram height ${height} is too small for ${rows.length} rows; use at least ${minimumHeight}.`)
    }
    const availableParticipantWidth = resolvedWidth - padding * 2
    const step = participants.length > 1
        ? (availableParticipantWidth - participantWidth) / (participants.length - 1)
        : 0
    const firstX = participants.length > 1
        ? padding + participantWidth / 2
        : resolvedWidth / 2
    const participantXs = new Map(participants.map((participant, index) => [participant.id, firstX + index * step]))
    const bodyTop = padding + headerHeight
    const rowCenter = (index: number): number => bodyTop + index * rowHeight + rowHeight / 2
    const labelText = ariaLabel
        ?? readableNodeText(title)
        ?? 'Sequence diagram'
    const accessibleLabel = labelText || 'Sequence diagram'

    const markerDefinitions = participants.flatMap((participant, participantIndex) => {
        const color = getToneColor(participant.tone ?? 'blue', c)
        return sequenceMessageKindsForMarkers(orderedItems).map((kind) => ArrowMarkerDef({
            id: `sequence-arrow-${participantIndex}-${kind}`,
            color,
            size: 5,
        }))
    })

    const fragmentElements = flattened.spans.map((span) => {
        const tone = span.fragment.tone ?? (span.fragment.kind === 'loop' ? 'purple' : span.fragment.kind === 'parallel' ? 'cyan' : 'warm')
        const accent = span.fragment.muted ? c.textMuted : getToneColor(tone, c)
        const top = bodyTop + span.start * rowHeight + 4
        const spanHeight = Math.max(rowHeight - 8, (span.end - span.start + 1) * rowHeight - 8)
        const left = padding + span.depth * fragmentIndent
        const fragmentWidth = Math.max(0, resolvedWidth - left - padding - span.depth * fragmentIndent)
        return React.createElement('div', {
            key: `sequence-fragment-${span.id}`,
            'data-vizmatic-sequence-fragment': span.id,
            style: {
                position: 'absolute' as const,
                left,
                top,
                width: fragmentWidth,
                height: spanHeight,
                display: 'flex',
                boxSizing: 'border-box' as const,
                border: `1.25px ${span.fragment.muted ? 'dotted' : 'dashed'} ${accent}${span.fragment.muted ? '55' : '99'}`,
                backgroundColor: `${accent}0b`,
                borderRadius: c.preset === 'engineering' ? 4 : 8,
                pointerEvents: 'none' as const,
            },
        }, React.createElement('div', {
            style: {
                position: 'absolute' as const,
                left: 8,
                top: -9,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '1px 5px',
                backgroundColor: c.bg,
                color: span.fragment.muted ? c.textMuted : getReadableToneColor(tone, c),
                fontFamily: c.fontMono,
                fontSize: 11,
                fontWeight: 800,
                lineHeight: 1.1,
                textTransform: 'uppercase' as const,
            },
        }, span.fragment.kind, span.fragment.label),
        ...span.branchStarts.map((branch) => React.createElement('div', {
            key: `sequence-branch-${span.id}-${branch.row}`,
            style: {
                position: 'absolute' as const,
                left: Math.max(8, span.depth * fragmentIndent),
                top: branch.row * rowHeight - span.start * rowHeight + 5,
                padding: '2px 5px',
                backgroundColor: c.bg,
                color: span.fragment.muted ? c.textMuted : getReadableToneColor(tone, c),
                fontFamily: c.fontMono,
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1.1,
            },
        }, branch.label)),
        )
    })

    const lifelineElements = participants.map((participant) => {
        const x = participantXs.get(participant.id) ?? resolvedWidth / 2
        return React.createElement('line', {
            key: `sequence-lifeline-${participant.id}`,
            x1: x,
            y1: bodyTop - 14,
            x2: x,
            y2: bodyTop + rows.length * rowHeight,
            stroke: participant.muted ? c.textMuted : c.borderLight,
            strokeWidth: participant.muted ? 1 : 1.35,
            strokeDasharray: lifelineDash,
            opacity: participant.muted ? 0.46 : 0.8,
        })
    })

    const activationElements = [...activations, ...orderedItems.filter(isActivation)].map((activation, index) => {
        const participantX = participantXs.get(activation.participant)
        if (participantX == null) return null
        const startValue = activation.start ?? activation.fromMessage
        const endValue = activation.end ?? activation.toMessage
        const start = activationReference(startValue, rows, 0, false)
        const end = activationReference(endValue, rows, rows.length - 1, true)
        if (end < start) throw new Error(`SequenceDiagram activation for "${activation.participant}" ends before it starts.`)
        const depth = Math.max(0, activation.depth ?? 0)
        const accent = activation.muted ? c.textMuted : getToneColor(activation.tone ?? 'blue', c)
        const top = rowCenter(start) - rowHeight / 2 + 5
        const activationHeight = Math.max(14, (end - start + 1) * rowHeight - 10)
        return React.createElement('div', {
            key: `sequence-activation-${activation.id ?? index}`,
            'data-vizmatic-sequence-activation': activation.participant,
            style: {
                position: 'absolute' as const,
                left: participantX - 5 + depth * 7,
                top,
                width: 10,
                height: activationHeight,
                boxSizing: 'border-box' as const,
                borderRadius: 3,
                backgroundColor: getToneFill(activation.tone ?? 'blue', c),
                border: `1.5px solid ${accent}`,
                opacity: activation.muted ? 0.52 : 0.94,
                pointerEvents: 'none' as const,
            },
        })
    }).filter(Boolean)

    const messageElements = rows.map((row, rowIndex) => {
        if (!row.item || isFragment(row.item) || isActivation(row.item) || isNote(row.item)) return null
        const message = row.item
        const fromX = participantXs.get(message.from) ?? resolvedWidth / 2
        const toX = participantXs.get(message.to) ?? resolvedWidth / 2
        const kind = sequenceMessageKind(message)
        const tone = message.tone ?? (kind === 'return' ? 'neutral' : kind === 'async' ? 'cyan' : 'blue')
        const color = message.muted ? c.textMuted : getToneColor(tone, c)
        const markerId = `sequence-arrow-${participants.findIndex((participant) => participant.id === message.to)}-${kind}`
        const y = rowCenter(rowIndex)
        const selfLoop = message.from === message.to
        return React.createElement(React.Fragment, { key: `sequence-message-${message.id ?? row.key}` },
            React.createElement('path', {
                d: sequenceMarkerPath(fromX, toX, y, rowHeight, selfLoop),
                fill: 'none',
                stroke: color,
                strokeWidth: message.muted ? 1.25 : 2,
                strokeDasharray: kind === 'sync' ? undefined : '7 5',
                strokeLinecap: 'round',
                opacity: message.muted ? 0.48 : 0.9,
                markerEnd: `url(#${markerId})`,
            }),
            message.label != null && React.createElement('div', {
                style: {
                    position: 'absolute' as const,
                    left: selfLoop ? fromX + 34 : (fromX + toX) / 2,
                    top: y - 18,
                    transform: 'translate(-50%, -50%)',
                    maxWidth: Math.max(74, Math.abs(toX - fromX) - 28),
                    padding: '2px 5px',
                    backgroundColor: c.bg,
                    color: message.muted ? c.textMuted : c.textPrimary,
                    fontFamily: c.fontMono,
                    fontSize: 11,
                    fontWeight: 650,
                    lineHeight: 1.1,
                    whiteSpace: 'nowrap' as const,
                    ...textFitStyle('center'),
                },
            }, message.label),
        )
    }).filter(Boolean)

    const noteElements = rows.map((row, rowIndex) => {
        if (!row.item || !isNote(row.item)) return null
        const note = row.item
        const bounds = sequenceNoteBounds(note, participantXs, resolvedWidth, noteWidth, padding)
        const tone = note.tone ?? 'warm'
        const accent = note.muted ? c.textMuted : getToneColor(tone, c)
        return React.createElement('div', {
            key: `sequence-note-${note.id ?? row.key}`,
            'data-vizmatic-sequence-note': note.id ?? row.key,
            style: {
                position: 'absolute' as const,
                left: bounds.left,
                top: rowCenter(rowIndex) - 17,
                width: bounds.width,
                minHeight: 34,
                boxSizing: 'border-box' as const,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '6px 9px',
                borderRadius: c.preset === 'engineering' ? 3 : 7,
                backgroundColor: note.muted ? c.bgSubtle : getToneFill(tone, c),
                border: `1px solid ${accent}${note.muted ? '66' : '99'}`,
                color: note.muted ? c.textMuted : getReadableTextColor(getToneFill(tone, c), c),
                fontFamily: c.fontSans,
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1.2,
                textAlign: 'center' as const,
                ...textFitStyle('center'),
            },
        }, sequenceNoteText(note))
    }).filter(Boolean)

    const participantElements = participants.map((participant) => {
        const x = participantXs.get(participant.id) ?? resolvedWidth / 2
        const tone = participant.tone ?? 'blue'
        const accent = participant.muted ? c.textMuted : getToneColor(tone, c)
        const icon = participant.icon && Icon({
            c,
            name: participant.icon,
            color: accent,
            size: 16,
            muted: participant.muted,
            label: readableNodeText(participant.label) ? `${readableNodeText(participant.label)} icon` : undefined,
        })
        return React.createElement('div', {
            key: `sequence-participant-${participant.id}`,
            'data-vizmatic-sequence-participant': participant.id,
            style: {
                position: 'absolute' as const,
                left: x - participantWidth / 2,
                top: padding,
                width: participantWidth,
                minHeight: 54,
                boxSizing: 'border-box' as const,
                display: 'flex',
                flexDirection: icon ? 'row' as const : 'column' as const,
                alignItems: 'center',
                justifyContent: 'center',
                gap: icon ? 7 : participant.detail ? 3 : 0,
                padding: '7px 8px',
                borderRadius: c.preset === 'engineering' ? 4 : 8,
                backgroundColor: participant.muted ? c.bgSubtle : getToneFill(tone, c),
                border: `1.25px solid ${participant.muted ? c.borderLight : accent}`,
                color: participant.muted ? c.textMuted : getReadableTextColor(getToneFill(tone, c), c),
                opacity: participant.muted ? 0.62 : 1,
                textAlign: icon ? 'left' as const : 'center' as const,
            },
        },
            icon,
            React.createElement('div', {
                style: {
                    display: 'flex',
                    flexDirection: 'column' as const,
                    alignItems: icon ? 'flex-start' : 'center',
                    minWidth: 0,
                    gap: participant.detail ? 3 : 0,
                },
            },
                React.createElement('div', {
                    style: {
                        fontFamily: c.fontSans,
                        fontSize: 12,
                        fontWeight: 850,
                        lineHeight: 1.15,
                        ...textFitStyle(icon ? 'left' : 'center'),
                    },
                }, participant.label),
                participant.detail != null && React.createElement('div', {
                    style: {
                        color: c.textMuted,
                        fontFamily: c.fontMono,
                        fontSize: 11,
                        fontWeight: 550,
                        lineHeight: 1.1,
                        ...textFitStyle(icon ? 'left' : 'center'),
                    },
                }, participant.detail),
            ),
        )
    })

    return React.createElement('div', {
        role: 'img',
        'aria-label': accessibleLabel,
        'data-vizmatic-sequence-row-count': rows.length,
        style: {
            position: 'relative' as const,
            display: 'flex',
            width: resolvedWidth,
            height: resolvedHeight,
            maxWidth: '100%',
            flexShrink: 0,
        },
    },
        ...fragmentElements,
        React.createElement('svg', {
            width: resolvedWidth,
            height: resolvedHeight,
            viewBox: `0 0 ${resolvedWidth} ${resolvedHeight}`,
            style: { position: 'absolute' as const, inset: 0, overflow: 'visible' },
        },
            React.createElement('defs', {}, ...markerDefinitions),
            ...lifelineElements,
            ...messageElements,
        ),
        ...activationElements,
        ...noteElements,
        ...participantElements,
        title != null && React.createElement('div', {
            style: {
                position: 'absolute' as const,
                left: padding,
                top: 2,
                color: c.textPrimary,
                fontFamily: c.fontSans,
                fontSize: 14,
                fontWeight: 850,
            },
        }, title),
        subtitle != null && React.createElement('div', {
            style: {
                position: 'absolute' as const,
                left: padding,
                top: 20,
                color: c.textSecondary,
                fontFamily: c.fontSans,
                fontSize: 11,
                fontWeight: 550,
            },
        }, subtitle),
    )
}

function sequenceMessageKindsForMarkers(items: SequenceItem[]): SequenceMessageKind[] {
    const kinds = new Set<SequenceMessageKind>()
    const visit = (nextItems: SequenceItem[]): void => {
        for (const item of nextItems) {
            if (isFragment(item)) {
                if (item.branches) item.branches.forEach((branch) => visit(sequenceContainerItems(branch)))
                else visit(sequenceContainerItems(item))
            } else if (!isNote(item) && !isActivation(item)) {
                kinds.add(sequenceMessageKind(item))
            }
        }
    }
    visit(items)
    if (!kinds.size) kinds.add('sync')
    return Array.from(kinds)
}
