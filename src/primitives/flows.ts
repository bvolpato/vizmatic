import React from 'react'
import {
    type ThemeColors,
    type ToneName,
    getReadableToneColor,
    getToneColor,
    withColorAlpha,
    densityOf,
} from '../theme'

import { Column, compactChildren, type FlexAlign, Panel, Row, textFitStyle } from './layout'
import { FlowArrow } from './svg'
import { renderMaybeMath, StepCard } from './surfaces'
import { DetailList } from './content'

// ─── StatusList — Rows with check/cross/warn status markers ─────────────────

export type StatusKind = 'check' | 'cross' | 'warn' | 'info' | 'pending' | 'dot'

const statusGlyphs: Record<StatusKind, string> = {
    check: '✓',
    cross: '✗',
    warn: '!',
    info: 'i',
    pending: '–',
    dot: '',
}

const statusTones: Record<StatusKind, ToneName> = {
    check: 'green',
    cross: 'red',
    warn: 'warm',
    info: 'blue',
    pending: 'neutral',
    dot: 'blue',
}

export interface StatusRowSpec {
    label: React.ReactNode
    detail?: React.ReactNode
    status?: StatusKind
    tone?: ToneName
}

interface StatusRowProps extends StatusRowSpec {
    c: ThemeColors
    boxed?: boolean
    fontSize?: number
    width?: number | string
    math?: boolean
}

export function StatusRow({
    label,
    detail,
    status = 'check',
    tone,
    c,
    boxed = false,
    fontSize: fontSizeProp,
    width,
    math = false,
}: StatusRowProps): React.ReactElement {
    const fontSize = fontSizeProp ?? densityOf(c).f(11)
    const resolvedTone = tone ?? statusTones[status]
    const accent = getToneColor(resolvedTone, c)
    // Account for the marker tint composited over its row tint when boxed.
    const markerAlpha = 0x26 / 0xff
    const rowAlpha = boxed ? 0x12 / 0xff : 0
    const markerBackgroundAlpha = Math.round((rowAlpha + markerAlpha * (1 - rowAlpha)) * 0xff)
    const markerBackground = withColorAlpha(accent, markerBackgroundAlpha / 0xff)
    const accentText = getReadableToneColor(resolvedTone, c, markerBackground, c.bgCard)
    const glyph = statusGlyphs[status]

    const marker = React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: densityOf(c).f(16),
            height: densityOf(c).f(16),
            flexShrink: 0,
            borderRadius: 999,
            backgroundColor: status === 'dot' ? accent : withColorAlpha(accent, 0x20 / 0xff),
            border: `1px solid ${withColorAlpha(accent, 0.7)}`,
            color: accentText,
            fontFamily: 'Inter',
            fontSize: status === 'warn' || status === 'info' ? 12 : 11,
            fontWeight: 600,
            lineHeight: 1,
        }
    }, glyph)

    return React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'center',
            gap: densityOf(c).s(9),
            width: width ?? '100%',
            boxSizing: 'border-box' as const,
            ...(boxed ? {
                padding: `${densityOf(c).s(7)}px ${densityOf(c).s(10)}px`,
                borderRadius: densityOf(c).r(8),
                backgroundColor: withColorAlpha(accent, 0x12 / 0xff),
                border: `1px solid ${withColorAlpha(accent, 0x3a / 0xff)}`,
            } : { padding: '3px 0' }),
        }
    },
        marker,
        React.createElement('div', {
            style: {
                display: 'flex',
                flex: 1,
                color: c.textPrimary,
                fontFamily: 'Inter',
                fontSize,
                fontWeight: 600,
                lineHeight: 1.3,
            }
        }, renderMaybeMath(label, math)),
        detail != null && React.createElement('div', {
            style: {
                display: 'flex',
                flexShrink: 0,
                color: c.textSecondary,
                fontFamily: 'Inter',
                fontSize: fontSize - 1,
                lineHeight: 1.3,
                textAlign: 'right' as const,
            }
        }, renderMaybeMath(detail, math)),
    )
}

interface StatusListProps {
    rows: StatusRowSpec[]
    c: ThemeColors
    gap?: number
    boxed?: boolean
    fontSize?: number
    width?: number | string
    math?: boolean
}

export function StatusList({
    rows,
    c,
    gap: gapProp,
    boxed = false,
    fontSize,
    width,
    math = false,
}: StatusListProps): React.ReactElement {
    const gap = gapProp ?? densityOf(c).s(7)
    return Column({
        gap,
        align: 'stretch',
        ...(width != null ? { width } : {}),
        children: rows.map((row, index) => React.createElement(React.Fragment, { key: `status-${index}` },
            StatusRow({ ...row, c, boxed, fontSize, math })
        )),
    })
}

// ─── Timeline — Chronological milestones with compact cards ─────────────────

export interface TimelineEventSpec {
    title: React.ReactNode
    detail?: React.ReactNode
    time?: React.ReactNode
    tone?: ToneName
    status?: StatusKind
    width?: number | string
}

interface TimelineProps {
    events: TimelineEventSpec[]
    c: ThemeColors
    title?: React.ReactNode
    subtitle?: React.ReactNode
    direction?: 'vertical' | 'horizontal'
    width?: number | string
    eventWidth?: number | string
    gap?: number
    markerSize?: number
    math?: boolean
}

function renderTimelineCard(event: TimelineEventSpec, c: ThemeColors, math: boolean, width?: number | string): React.ReactElement {
    const resolvedTone = event.tone ?? statusTones[event.status ?? 'dot']
    const accentText = getReadableToneColor(resolvedTone, c)
    const resolvedWidth = event.width ?? width

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: densityOf(c).s(5),
            ...(resolvedWidth != null ? { width: resolvedWidth } : {}),
            ...(typeof resolvedWidth === 'string' ? { minWidth: 0 } : {}),
            padding: `${densityOf(c).s(4)}px 0`,
            boxSizing: 'border-box' as const,
        }
    },
        ...compactChildren([
        event.time != null && React.createElement('div', {
            style: {
                display: 'flex',
                color: event.tone || event.status ? accentText : c.textMuted,
                fontFamily: 'JetBrains Mono',
                fontSize: densityOf(c).type.micro,
                fontWeight: 400,
                lineHeight: 1.15,
            }
        }, renderMaybeMath(event.time, math)),
        React.createElement('div', {
            style: {
                display: 'flex',
                color: c.textPrimary,
                fontFamily: 'Inter',
                fontSize: densityOf(c).f(14),
                fontWeight: 600,
                lineHeight: 1.18,
                ...textFitStyle(),
            }
        }, renderMaybeMath(event.title, math)),
        event.detail != null && React.createElement('div', {
            style: {
                display: 'flex',
                color: c.textSecondary,
                fontFamily: 'Inter',
                fontSize: densityOf(c).f(11),
                fontWeight: 500,
                lineHeight: 1.35,
                ...textFitStyle(),
            }
        }, renderMaybeMath(event.detail, math)),
        ])
    )
}

export function Timeline({
    events,
    c,
    title,
    subtitle,
    direction = 'vertical',
    width,
    eventWidth,
    gap: gapProp,
    markerSize: markerSizeProp,
    math = false,
}: TimelineProps): React.ReactElement {
    const markerSize = markerSizeProp ?? densityOf(c).g(9)
    const gap = gapProp ?? densityOf(c).s(12)
    const header = (title != null || subtitle != null) && React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: subtitle != null ? 4 : 0,
            width: '100%',
        }
    },
        ...compactChildren([
        title != null && React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: densityOf(c).s(8),
                color: c.textPrimary,
                fontFamily: 'Inter',
                fontSize: densityOf(c).f(16),
                fontWeight: 600,
                lineHeight: 1.2,
            }
        }, renderMaybeMath(title, math)),
        subtitle != null && React.createElement('div', {
            style: {
                display: 'flex',
                color: c.textSecondary,
                fontFamily: 'Inter',
                fontSize: densityOf(c).f(11),
                fontWeight: 500,
                lineHeight: 1.35,
            }
        }, renderMaybeMath(subtitle, math)),
        ])
    )

    if (direction === 'horizontal') {
        return React.createElement('div', {
            style: {
                display: 'flex',
                flexDirection: 'column' as const,
                gap,
                ...(width != null ? { width } : {}),
            }
        },
            ...compactChildren([
            header,
            React.createElement('div', {
                style: {
                    display: 'flex',
                    alignItems: 'stretch',
                    gap: densityOf(c).s(0),
                    width: '100%',
                }
            }, ...events.map((event, index) => {
                const accent = getToneColor(event.tone ?? statusTones[event.status ?? 'dot'], c)
                return React.createElement('div', {
                    key: `timeline-h-${index}`,
                    style: {
                        display: 'flex',
                        flexDirection: 'column' as const,
                        gap: densityOf(c).s(8),
                        ...(eventWidth == null ? { flex: 1 } : {}),
                        ...((event.width ?? eventWidth) != null ? { width: event.width ?? eventWidth } : {}),
                        minWidth: 0,
                    }
                },
                    React.createElement('div', {
                        style: {
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                        }
                    },
                        React.createElement('div', {
                            style: {
                                display: 'flex',
                                flex: 1,
                                height: 1,
                                backgroundColor: c.border,
                                opacity: index === 0 ? 0 : 1,
                            }
                        }),
                        React.createElement('div', {
                            style: {
                                display: 'flex',
                                width: markerSize,
                                height: markerSize,
                                borderRadius: 999,
                                backgroundColor: accent,
                                
                                flexShrink: 0,
                            }
                        }),
                        React.createElement('div', {
                            style: {
                                display: 'flex',
                                flex: 1,
                                height: 1,
                                backgroundColor: c.border,
                                opacity: index === events.length - 1 ? 0 : 1,
                            }
                        }),
                    ),
                    renderTimelineCard(event, c, math, eventWidth),
                )
            })),
            ])
        )
    }

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap,
            ...(width != null ? { width } : {}),
        }
    },
        ...compactChildren([
        header,
        React.createElement('div', {
            style: {
                display: 'flex',
                flexDirection: 'column' as const,
                gap,
                width: '100%',
            }
        }, ...events.map((event, index) => {
            const accent = getToneColor(event.tone ?? statusTones[event.status ?? 'dot'], c)
            return React.createElement('div', {
                key: `timeline-v-${index}`,
                style: {
                    display: 'flex',
                    alignItems: 'stretch',
                    gap: densityOf(c).s(11),
                    width: '100%',
                }
            },
                React.createElement('div', {
                    style: {
                        display: 'flex',
                        flexDirection: 'column' as const,
                        alignItems: 'center',
                        width: markerSize + 8,
                        flexShrink: 0,
                    }
                },
                    React.createElement('div', {
                        style: {
                            display: 'flex',
                            flex: 1,
                            minHeight: 4,
                            width: 1,
                            backgroundColor: c.border,
                            opacity: index === 0 ? 0 : 1,
                        }
                    }),
                    React.createElement('div', {
                        style: {
                            display: 'flex',
                            width: markerSize,
                            height: markerSize,
                            borderRadius: 999,
                            backgroundColor: accent,
                            
                            flexShrink: 0,
                        }
                    }),
                    React.createElement('div', {
                        style: {
                            display: 'flex',
                            flex: 1,
                            minHeight: 4,
                            width: 1,
                            backgroundColor: c.border,
                            opacity: index === events.length - 1 ? 0 : 1,
                        }
                    }),
                ),
                renderTimelineCard(event, c, math),
            )
        })),
        ])
    )
}

// ─── Flow — Common linear stage flow with optional detail rows ──────────────

export interface FlowStageSpec {
    title: React.ReactNode
    subtitle?: React.ReactNode
    eyebrow?: React.ReactNode
    tone?: ToneName
    lines?: React.ReactNode[]
    children?: React.ReactNode
    width?: number | string
    minWidth?: number | string
    minHeight?: number | string
    padding?: number | string
}

interface FlowProps {
    stages: FlowStageSpec[]
    c: ThemeColors
    direction?: 'horizontal' | 'vertical'
    gap?: number
    connectorLength?: number
    connectorTone?: ToneName
    align?: FlexAlign
    math?: boolean
}

function renderFlowStage(stage: FlowStageSpec, c: ThemeColors, math: boolean): React.ReactElement {
    const tone = stage.tone
    const hasDetails = Boolean(stage.children || stage.lines?.length)

    if (!hasDetails) {
        return StepCard({
            title: stage.title,
            subtitle: stage.subtitle,
            eyebrow: stage.eyebrow,
            tone,
            c,
            width: stage.width,
            minWidth: stage.minWidth,
            minHeight: stage.minHeight,
            padding: stage.padding,
            math,
        })
    }

    return Panel({
        title: stage.title,
        subtitle: stage.subtitle,
        tone,
        c,
        width: stage.width,
        minWidth: stage.minWidth,
        minHeight: stage.minHeight,
        padding: stage.padding ?? 12,
        bodyStyle: { gap: 8 },
        children: stage.children ?? DetailList({ items: stage.lines ?? [], c, tone, math }),
    })
}

export function Flow({
    stages,
    c,
    direction = 'horizontal',
    gap: gapProp,
    connectorLength: connectorLengthProp,
    connectorTone = 'neutral',
    align = 'center',
    math = false,
}: FlowProps): React.ReactElement {
    const connectorLength = connectorLengthProp ?? densityOf(c).s(32)
    const gap = gapProp ?? densityOf(c).s(10)
    const isHorizontal = direction === 'horizontal'
    const children = stages.flatMap((stage, index) => {
        const elements: React.ReactElement[] = [
            React.createElement(React.Fragment, { key: `stage-${index}` }, renderFlowStage(stage, c, math)),
        ]

        if (index < stages.length - 1) {
            elements.push(React.createElement(React.Fragment, { key: `connector-${index}` },
                FlowArrow({
                    direction: isHorizontal ? 'right' : 'down',
                    length: connectorLength,
                    c,
                    tone: connectorTone,
                })
            ))
        }

        return elements
    })

    return (isHorizontal ? Row : Column)({
        gap,
        align,
        justify: isHorizontal ? 'start' : 'center',
        children,
    })
}
