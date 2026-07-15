import React from 'react'
import {
    type ThemeColors,
    type ToneName,
    getToneColor,
} from '../theme'

import { Column, compactChildren, type FlexAlign, Panel, Row, textFitStyle, ToneStrip } from './layout'
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
    boxed = true,
    fontSize = 11,
    width,
    math = false,
}: StatusRowProps): React.ReactElement {
    const accent = getToneColor(tone ?? statusTones[status], c)
    const glyph = statusGlyphs[status]

    const marker = React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            flexShrink: 0,
            borderRadius: 999,
            backgroundColor: status === 'dot' ? accent : `${accent}26`,
            border: `1px solid ${accent}`,
            color: accent,
            fontFamily: 'Inter',
            fontSize: status === 'warn' || status === 'info' ? 12 : 11,
            fontWeight: 900,
            lineHeight: 1,
        }
    }, glyph)

    return React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            width: width ?? '100%',
            boxSizing: 'border-box' as const,
            ...(boxed ? {
                padding: '7px 10px',
                borderRadius: 8,
                backgroundColor: `${accent}12`,
                border: `1px solid ${accent}3a`,
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
    gap = 7,
    boxed = true,
    fontSize,
    width,
    math = false,
}: StatusListProps): React.ReactElement {
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
    const accent = getToneColor(event.tone ?? statusTones[event.status ?? 'dot'], c)
    const resolvedWidth = event.width ?? width

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: 5,
            ...(resolvedWidth != null ? { width: resolvedWidth } : {}),
            ...(typeof resolvedWidth === 'string' ? { minWidth: 0 } : {}),
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${accent}44`,
            backgroundColor: c.bgCard,
            boxShadow: `0 7px 18px ${c.shadow}`,
            boxSizing: 'border-box' as const,
        }
    },
        ...compactChildren([
        event.time != null && React.createElement('div', {
            style: {
                display: 'flex',
                color: accent,
                fontFamily: 'JetBrains Mono',
                fontSize: 9,
                fontWeight: 900,
                lineHeight: 1.15,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.04em',
            }
        }, renderMaybeMath(event.time, math)),
        React.createElement('div', {
            style: {
                display: 'flex',
                color: c.textPrimary,
                fontFamily: 'Inter',
                fontSize: 14,
                fontWeight: 900,
                lineHeight: 1.18,
                ...textFitStyle(),
            }
        }, renderMaybeMath(event.title, math)),
        event.detail != null && React.createElement('div', {
            style: {
                display: 'flex',
                color: c.textSecondary,
                fontFamily: 'Inter',
                fontSize: 11,
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
    gap = 12,
    markerSize = 14,
    math = false,
}: TimelineProps): React.ReactElement {
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
                gap: 8,
                color: c.textPrimary,
                fontFamily: 'Inter',
                fontSize: 16,
                fontWeight: 900,
                lineHeight: 1.2,
            }
        }, ToneStrip({ tone: events[0]?.tone ?? 'blue' }), renderMaybeMath(title, math)),
        subtitle != null && React.createElement('div', {
            style: {
                display: 'flex',
                color: c.textSecondary,
                fontFamily: 'Inter',
                fontSize: 11,
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
                    gap: 0,
                    width: '100%',
                }
            }, ...events.map((event, index) => {
                const accent = getToneColor(event.tone ?? statusTones[event.status ?? 'dot'], c)
                return React.createElement('div', {
                    key: `timeline-h-${index}`,
                    style: {
                        display: 'flex',
                        flexDirection: 'column' as const,
                        gap: 8,
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
                                height: 2,
                                backgroundColor: c.borderLight,
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
                                border: `3px solid ${c.bg}`,
                                boxShadow: `0 0 0 1px ${accent}`,
                                flexShrink: 0,
                            }
                        }),
                        React.createElement('div', {
                            style: {
                                display: 'flex',
                                flex: 1,
                                height: 2,
                                backgroundColor: c.borderLight,
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
                    gap: 11,
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
                            width: 2,
                            backgroundColor: c.borderLight,
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
                            border: `3px solid ${c.bg}`,
                            boxShadow: `0 0 0 1px ${accent}`,
                            flexShrink: 0,
                        }
                    }),
                    React.createElement('div', {
                        style: {
                            display: 'flex',
                            flex: 1,
                            minHeight: 4,
                            width: 2,
                            backgroundColor: c.borderLight,
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
    const tone = stage.tone ?? 'blue'
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
    gap = 10,
    connectorLength = 28,
    connectorTone = 'neutral',
    align = 'center',
    math = false,
}: FlowProps): React.ReactElement {
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
        justify: 'center',
        children,
    })
}
