import React from 'react'
import {
    typography,
    heatColor,
    type ThemeColors,
    type ColorName,
    type ToneName,
    getColor,
    getGradient,
    getToneColor,
    getToneGradient,
} from '../theme'

import { clamp, compactChildren, formatMathText, textFitStyle, ToneStrip } from './layout'
import { Arrow, ArrowMarkerDef, Box } from './svg'
import { renderMaybeMath } from './surfaces'

// ─── LayeredNetwork — Dense neural-network diagram without local coordinate code ─

export interface LayeredNetworkLayer {
    title: string
    nodes: string[]
    tone?: ToneName
}

interface LayeredNetworkProps {
    c: ThemeColors
    layers: LayeredNetworkLayer[]
    activePath?: number[]
    annotations?: string[]
    formula?: string
    legend?: string
    width?: number
    height?: number
    nodeSize?: number
    showFormula?: boolean
}

function distributeValues(count: number, start: number, end: number): number[] {
    if (count <= 1) return [(start + end) / 2]
    const step = (end - start) / (count - 1)
    return Array.from({ length: count }, (_, index) => start + index * step)
}

export function LayeredNetwork({
    c,
    layers,
    activePath = [],
    annotations = [],
    formula,
    legend = 'highlighted path',
    width = 900,
    height = 400,
    nodeSize = 56,
    showFormula = true,
}: LayeredNetworkProps): React.ReactElement {
    const radius = nodeSize / 2
    const top = 82
    const bottom = showFormula || formula ? height - 118 : height - 42
    const layerXs = distributeValues(layers.length, 82, width - 82)
    const nodeLayout = layers.map((layer, layerIndex) => ({
        ...layer,
        x: layerXs[layerIndex],
        ys: distributeValues(layer.nodes.length, top, bottom),
        tone: layer.tone ?? 'purple',
    }))

    const connectionElements = nodeLayout.slice(0, -1).flatMap((from, layerIndex) => {
        const to = nodeLayout[layerIndex + 1]
        return from.ys.flatMap((fromY, fromIndex) =>
            to.ys.map((toY, toIndex) => {
                const active = activePath[layerIndex] === fromIndex && activePath[layerIndex + 1] === toIndex
                return React.createElement('line', {
                    key: `connection-${layerIndex}-${fromIndex}-${toIndex}`,
                    x1: from.x + radius + 4,
                    y1: fromY,
                    x2: to.x - radius - 4,
                    y2: toY,
                    stroke: active ? c.warningLight : c.borderLight,
                    strokeWidth: active ? 3.6 : 1.2,
                    strokeOpacity: active ? 0.98 : 0.42,
                    strokeLinecap: 'round',
                })
            })
        )
    })

    const label = (
        key: string,
        text: string,
        x: number,
        y: number,
        labelWidth: number,
        color: string,
        fontSize = 13,
        fontWeight = 800,
        fontFamily = 'Inter',
    ) => React.createElement('div', {
        key,
        style: {
            position: 'absolute' as const,
            left: x - labelWidth / 2,
            top: y,
            width: labelWidth,
            display: 'flex',
            justifyContent: 'center',
            color,
            fontSize,
            fontWeight,
            fontFamily,
            lineHeight: 1.15,
            textAlign: 'center' as const,
        },
    }, formatMathText(text))

    const titleElements = nodeLayout.map((layer) =>
        label(`title-${layer.title}`, layer.title, layer.x, 20, 120, getToneColor(layer.tone, c), 16, 900)
    )

    const nodeElements = nodeLayout.flatMap((layer, layerIndex) =>
        layer.ys.flatMap((y, nodeIndex) => {
            const active = activePath[layerIndex] === nodeIndex
            const color = getToneColor(layer.tone, c)
            return [
                active && React.createElement('div', {
                    key: `halo-${layerIndex}-${nodeIndex}`,
                    style: {
                        position: 'absolute' as const,
                        left: layer.x - radius - 14,
                        top: y - radius - 14,
                        width: nodeSize + 28,
                        height: nodeSize + 28,
                        borderRadius: 999,
                        backgroundColor: `${c.warningLight}2e`,
                        border: `4px solid ${c.warningLight}`,
                        boxSizing: 'border-box' as const,
                        boxShadow: `0 0 18px ${c.warningLight}66`,
                    },
                }),
                React.createElement('div', {
                    key: `node-${layerIndex}-${nodeIndex}`,
                    style: {
                        position: 'absolute' as const,
                        left: layer.x - radius,
                        top: y - radius,
                        width: nodeSize,
                        height: nodeSize,
                        borderRadius: 999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: color,
                        color: c.textOnColor,
                        border: active ? `3px solid ${c.warningLight}` : `1.5px solid ${color}`,
                        boxSizing: 'border-box' as const,
                        boxShadow: active ? `0 0 16px ${c.warningLight}70` : `0 8px 14px ${c.shadow}`,
                        fontFamily: 'JetBrains Mono',
                        fontSize: 16,
                        fontWeight: 900,
                        lineHeight: 1,
                    },
                }, formatMathText(layer.nodes[nodeIndex])),
            ]
        }).filter(Boolean) as React.ReactElement[]
    )

    const annotationY = showFormula || formula ? height - 84 : height - 26
    const annotationElements = annotations.map((annotation, index) =>
        label(
            `annotation-${index}`,
            annotation,
            (layerXs[index] + layerXs[index + 1]) / 2,
            annotationY,
            132,
            c.textMuted,
            13,
            800,
            'JetBrains Mono'
        )
    )

    const formulaElement = (showFormula || formula) && formula
        ? React.createElement('div', {
            key: 'formula-wrap',
            style: {
                position: 'absolute' as const,
                left: width / 2 - 244,
                top: height - 52,
                width: 488,
                height: 44,
                borderRadius: 10,
                border: `1px solid ${c.borderSubtle}`,
                backgroundColor: c.bgCard,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: c.textPrimary,
                fontFamily: 'Inter',
                fontSize: 15,
                fontWeight: 850,
                boxShadow: `0 8px 18px ${c.shadow}`,
            },
        }, formatMathText(formula))
        : null

    const legendElement = (showFormula || formula) && formula
        ? React.createElement('div', {
            key: 'legend-wrap',
            style: {
                position: 'absolute' as const,
                left: width - 184,
                top: height - 43,
                width: 160,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                color: c.textSecondary,
                fontFamily: 'Inter',
                fontSize: 12,
                fontWeight: 800,
            },
        },
            React.createElement('div', {
                style: {
                    width: 42,
                    height: 5,
                    borderRadius: 999,
                    backgroundColor: c.warningLight,
                },
            }),
            legend,
        )
        : null

    return React.createElement('div', {
        role: 'img',
        style: {
            width,
            height,
            maxWidth: '100%',
            position: 'relative' as const,
            display: 'flex',
            alignSelf: 'center',
            flexShrink: 0,
        },
    },
        React.createElement('svg', {
            width,
            height,
            viewBox: `0 0 ${width} ${height}`,
            style: {
                position: 'absolute' as const,
                inset: 0,
                overflow: 'visible',
            },
        }, ...connectionElements),
        ...titleElements,
        ...nodeElements,
        ...annotationElements,
        formulaElement,
        legendElement,
    )
}

export interface GraphDiagramNode {
    id: string
    label: string
    detail?: string
    x: number
    y: number
    tone?: ToneName
    muted?: boolean
    width?: number
    height?: number
}

export interface GraphDiagramEdge {
    from: string
    to: string
    tone?: ToneName
    muted?: boolean
    dashed?: boolean
    label?: string
}

interface GraphDiagramProps {
    nodes: GraphDiagramNode[]
    edges: GraphDiagramEdge[]
    c: ThemeColors
    width?: number
    height?: number
    nodeWidth?: number
    nodeHeight?: number
    labelFontSize?: number
    detailFontSize?: number
    arrowSize?: number
    padding?: number
}

export function GraphDiagram({
    nodes,
    edges,
    c,
    width = 520,
    height = 420,
    nodeWidth = 150,
    nodeHeight = 66,
    labelFontSize = 14,
    detailFontSize = 9,
    arrowSize = 5,
    padding = 28,
}: GraphDiagramProps): React.ReactElement {
    const layout = new Map(nodes.map((node) => {
        const resolvedWidth = node.width ?? nodeWidth
        const resolvedHeight = node.height ?? nodeHeight
        return [node.id, {
            ...node,
            width: resolvedWidth,
            height: resolvedHeight,
            cx: padding + clamp(node.x, 0, 1) * (width - padding * 2),
            cy: padding + clamp(node.y, 0, 1) * (height - padding * 2),
        }]
    }))

    const edgeLayouts = edges.flatMap((edge, index) => {
        const from = layout.get(edge.from)
        const to = layout.get(edge.to)
        if (!from || !to || (from.cx === to.cx && from.cy === to.cy)) return []

        const dx = to.cx - from.cx
        const dy = to.cy - from.cy
        const absDx = Math.abs(dx)
        const absDy = Math.abs(dy)
        const fromScale = Math.min(
            absDx > 0 ? (from.width / 2) / absDx : Infinity,
            absDy > 0 ? (from.height / 2) / absDy : Infinity,
        )
        const toScale = Math.min(
            absDx > 0 ? (to.width / 2) / absDx : Infinity,
            absDy > 0 ? (to.height / 2) / absDy : Infinity,
        )
        const color = edge.muted ? c.textMuted : getToneColor(edge.tone ?? 'blue', c)
        const markerId = `graph-arrow-${edge.from}-${edge.to}-${index}`.replace(/[^a-zA-Z0-9_-]/g, '-')

        return [{
            ...edge,
            index,
            color,
            markerId,
            x1: from.cx + dx * fromScale,
            y1: from.cy + dy * fromScale,
            x2: to.cx - dx * toScale,
            y2: to.cy - dy * toScale,
        }]
    })

    return React.createElement('div', {
        role: 'img',
        style: {
            position: 'relative' as const,
            display: 'flex',
            width,
            height,
            maxWidth: '100%',
            flexShrink: 0,
        }
    },
        React.createElement('svg', {
            width,
            height,
            viewBox: `0 0 ${width} ${height}`,
            style: { position: 'absolute' as const, inset: 0, overflow: 'visible' },
        },
            React.createElement('defs', {},
                ...edgeLayouts.map((edge) => ArrowMarkerDef({
                    id: edge.markerId,
                    color: edge.color,
                    size: arrowSize,
                }))
            ),
            ...edgeLayouts.map((edge) => React.createElement('line', {
                key: `graph-edge-${edge.index}`,
                x1: edge.x1,
                y1: edge.y1,
                x2: edge.x2,
                y2: edge.y2,
                stroke: edge.color,
                strokeWidth: edge.muted ? 1.6 : 2.8,
                strokeDasharray: edge.dashed ? '7 6' : undefined,
                strokeLinecap: 'round',
                opacity: edge.muted ? 0.48 : 0.9,
                markerEnd: `url(#${edge.markerId})`,
            })),
        ),
        ...edgeLayouts.flatMap((edge) => edge.label ? [
            React.createElement('div', {
                key: `graph-edge-label-${edge.index}`,
                style: {
                    position: 'absolute' as const,
                    left: (edge.x1 + edge.x2) / 2,
                    top: (edge.y1 + edge.y2) / 2,
                    transform: 'translate(-50%, -50%)',
                    padding: '3px 7px',
                    borderRadius: 999,
                    backgroundColor: c.bgCard,
                    border: `1px solid ${c.borderSubtle}`,
                    color: edge.muted ? c.textMuted : edge.color,
                    fontFamily: 'JetBrains Mono',
                    fontSize: 9,
                    fontWeight: 800,
                    lineHeight: 1,
                    whiteSpace: 'nowrap' as const,
                }
            }, edge.label),
        ] : []),
        ...Array.from(layout.values()).map((node) => {
            const accent = node.muted ? c.textMuted : getToneColor(node.tone ?? 'blue', c)
            return React.createElement('div', {
                key: `graph-node-${node.id}`,
                style: {
                    position: 'absolute' as const,
                    left: node.cx - node.width / 2,
                    top: node.cy - node.height / 2,
                    width: node.width,
                    height: node.height,
                    display: 'flex',
                    flexDirection: 'column' as const,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: node.detail ? 5 : 0,
                    padding: '8px 10px',
                    boxSizing: 'border-box' as const,
                    borderRadius: 10,
                    backgroundColor: node.muted ? c.bgSubtle : `${accent}16`,
                    border: `1.5px solid ${node.muted ? c.borderLight : `${accent}88`}`,
                    ...(!node.muted ? { boxShadow: `0 8px 18px ${c.shadow}` } : {}),
                    opacity: node.muted ? 0.62 : 1,
                    color: accent,
                    textAlign: 'center' as const,
                }
            },
                React.createElement('div', {
                    style: {
                        fontFamily: 'Inter',
                        fontSize: labelFontSize,
                        fontWeight: 900,
                        lineHeight: 1.15,
                    }
                }, node.label),
                node.detail && React.createElement('div', {
                    style: {
                        color: c.textMuted,
                        fontFamily: 'JetBrains Mono',
                        fontSize: detailFontSize,
                        fontWeight: 650,
                        lineHeight: 1.2,
                    }
                }, node.detail),
            )
        }),
    )
}

// ─── TreeDiagram — Auto-laid hierarchy for orgs, routes, and decisions ──────

export interface TreeNodeSpec {
    label: React.ReactNode
    id?: string
    detail?: React.ReactNode
    tone?: ToneName
    muted?: boolean
    children?: TreeNodeSpec[]
}

interface TreeDiagramProps {
    root: TreeNodeSpec
    c: ThemeColors
    title?: React.ReactNode
    subtitle?: React.ReactNode
    width?: number
    height?: number
    nodeWidth?: number
    nodeHeight?: number
    levelGap?: number
    siblingGap?: number
    padding?: number
    math?: boolean
}

type PositionedTreeNode = TreeNodeSpec & {
    key: string
    depth: number
    cx: number
    cy: number
}

type TreeEdgeLayout = {
    key: string
    from: PositionedTreeNode
    to: PositionedTreeNode
}

function countTreeLeaves(node: TreeNodeSpec): number {
    if (!node.children?.length) return 1
    return node.children.reduce((sum, child) => sum + countTreeLeaves(child), 0)
}

function maxTreeDepth(node: TreeNodeSpec): number {
    if (!node.children?.length) return 0
    return 1 + Math.max(...node.children.map(maxTreeDepth))
}

export function TreeDiagram({
    root,
    c,
    title,
    subtitle,
    width,
    height,
    nodeWidth = 156,
    nodeHeight = 64,
    levelGap = 58,
    siblingGap = 24,
    padding = 28,
    math = false,
}: TreeDiagramProps): React.ReactElement {
    const leafCount = Math.max(1, countTreeLeaves(root))
    const depthCount = maxTreeDepth(root)
    const resolvedWidth = width ?? Math.max(520, padding * 2 + leafCount * nodeWidth + Math.max(0, leafCount - 1) * siblingGap)
    const resolvedHeight = height ?? padding * 2 + (depthCount + 1) * nodeHeight + depthCount * levelGap
    const levelStep = depthCount === 0
        ? 0
        : Math.max(nodeHeight + 18, (resolvedHeight - padding * 2 - nodeHeight) / depthCount)
    const usableWidth = Math.max(0, resolvedWidth - padding * 2 - nodeWidth)
    const leafStep = leafCount <= 1 ? 0 : usableWidth / (leafCount - 1)
    const positioned: PositionedTreeNode[] = []
    const edges: TreeEdgeLayout[] = []
    let nextLeaf = 0

    const placeWithEdges = (node: TreeNodeSpec, depth: number, path: string): number => {
        const children = node.children ?? []
        let centerIndex: number
        const childPlacements: Array<{ node: TreeNodeSpec; index: number; center: number }> = []

        if (!children.length) {
            centerIndex = nextLeaf
            nextLeaf += 1
        } else {
            for (let index = 0; index < children.length; index += 1) {
                const child = children[index]
                childPlacements.push({
                    node: child,
                    index,
                    center: placeWithEdges(child, depth + 1, `${path}-${index}`),
                })
            }
            centerIndex = childPlacements.reduce((sum, child) => sum + child.center, 0) / childPlacements.length
        }

        const placed: PositionedTreeNode = {
            ...node,
            key: node.id ?? path,
            depth,
            cx: leafCount <= 1 ? resolvedWidth / 2 : padding + nodeWidth / 2 + centerIndex * leafStep,
            cy: padding + nodeHeight / 2 + depth * levelStep,
        }
        positioned.push(placed)

        for (const childPlacement of childPlacements) {
            const childKey = childPlacement.node.id ?? `${path}-${childPlacement.index}`
            const childNode = positioned.find((candidate) => candidate.key === childKey)
            if (childNode) edges.push({ key: `${placed.key}-${childNode.key}`, from: placed, to: childNode })
        }

        return centerIndex
    }

    placeWithEdges(root, 0, 'root')

    const header = (title != null || subtitle != null) && React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: subtitle != null ? 4 : 0,
            width: resolvedWidth,
            maxWidth: '100%',
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
        }, ToneStrip({ tone: root.tone ?? 'blue' }), renderMaybeMath(title, math)),
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

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: header ? 10 : 0,
            width: resolvedWidth,
            maxWidth: '100%',
        }
    },
        ...compactChildren([
        header,
        React.createElement('div', {
            role: 'img',
            style: {
                position: 'relative' as const,
                display: 'flex',
                width: resolvedWidth,
                height: resolvedHeight,
                maxWidth: '100%',
                flexShrink: 0,
            }
        },
            React.createElement('svg', {
                width: resolvedWidth,
                height: resolvedHeight,
                viewBox: `0 0 ${resolvedWidth} ${resolvedHeight}`,
                style: { position: 'absolute' as const, inset: 0, overflow: 'visible' },
            }, ...edges.map((edge) => {
                const tone = edge.to.muted ? 'neutral' : (edge.to.tone ?? edge.from.tone ?? 'blue')
                const color = edge.to.muted ? c.textMuted : getToneColor(tone, c)
                const startY = edge.from.cy + nodeHeight / 2
                const endY = edge.to.cy - nodeHeight / 2
                const midY = startY + (endY - startY) / 2
                return React.createElement('path', {
                    key: `tree-edge-${edge.key}`,
                    d: `M ${edge.from.cx} ${startY} C ${edge.from.cx} ${midY}, ${edge.to.cx} ${midY}, ${edge.to.cx} ${endY}`,
                    fill: 'none',
                    stroke: color,
                    strokeWidth: edge.to.muted ? 1.4 : 2.4,
                    strokeLinecap: 'round',
                    opacity: edge.to.muted ? 0.4 : 0.74,
                })
            })),
            ...positioned.map((node) => {
                const accent = node.muted ? c.textMuted : getToneColor(node.tone ?? 'blue', c)
                return React.createElement('div', {
                    key: `tree-node-${node.key}`,
                    style: {
                        position: 'absolute' as const,
                        left: node.cx - nodeWidth / 2,
                        top: node.cy - nodeHeight / 2,
                        width: nodeWidth,
                        height: nodeHeight,
                        display: 'flex',
                        flexDirection: 'column' as const,
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: node.detail ? 4 : 0,
                        padding: '8px 10px',
                        boxSizing: 'border-box' as const,
                        borderRadius: 8,
                        backgroundColor: node.muted ? c.bgSubtle : c.bgCard,
                        border: `1.5px solid ${node.muted ? c.borderLight : `${accent}88`}`,
                        ...(!node.muted ? { boxShadow: `0 8px 18px ${c.shadow}` } : {}),
                        opacity: node.muted ? 0.62 : 1,
                        color: accent,
                        textAlign: 'center' as const,
                    }
                },
                    React.createElement('div', {
                        style: {
                            color: accent,
                            fontFamily: 'Inter',
                            fontSize: 13,
                            fontWeight: 900,
                            lineHeight: 1.15,
                            ...textFitStyle('center'),
                        }
                    }, renderMaybeMath(node.label, math)),
                    node.detail != null && React.createElement('div', {
                        style: {
                            color: c.textMuted,
                            fontFamily: 'JetBrains Mono',
                            fontSize: 9,
                            fontWeight: 650,
                            lineHeight: 1.2,
                            ...textFitStyle('center'),
                        }
                    }, renderMaybeMath(node.detail, math)),
                )
            }),
        ),
        ])
    )
}

// ─── CalloutCard — Small highlighted takeaway block ────────────────────────

interface CalloutCardProps {
    c: ThemeColors
    children?: React.ReactNode
    title?: React.ReactNode
    detail?: React.ReactNode
    tone?: ToneName
    width?: number | string
    minHeight?: number | string
    padding?: number | string
    titleFontSize?: number
    detailFontSize?: number
    filled?: boolean
    align?: 'left' | 'center'
}

export function CalloutCard({
    c,
    children,
    title,
    detail,
    tone = 'blue',
    width,
    minHeight,
    padding = 12,
    titleFontSize,
    detailFontSize,
    filled = true,
    align = 'center',
}: CalloutCardProps): React.ReactElement {
    const accent = getToneColor(tone, c)
    const textAlign = align

    return React.createElement('div', {
        style: {
            ...(width != null ? { width } : {}),
            ...(minHeight != null ? { minHeight } : {}),
            padding,
            borderRadius: 10,
            boxSizing: 'border-box' as const,
            ...(filled
                ? { backgroundImage: getToneGradient(tone), color: c.textOnColor, border: `1px solid ${accent}00` }
                : { backgroundColor: c.bgCard, color: c.textPrimary, border: `1px solid ${accent}66` }),
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: align === 'center' ? 'center' : 'flex-start',
            justifyContent: 'center',
            gap: detail ? 5 : 0,
            boxShadow: `0 10px 24px ${c.shadow}`,
            textAlign,
        }
    },
        ...compactChildren([
        title && React.createElement('div', {
            style: {
                ...typography.small,
                ...(titleFontSize != null ? { fontSize: titleFontSize } : {}),
                color: filled ? c.textOnColor : accent,
                fontWeight: 900,
                lineHeight: 1.2,
                textAlign,
            }
        }, title),
        detail && React.createElement('div', {
            style: {
                ...typography.tiny,
                ...(detailFontSize != null ? { fontSize: detailFontSize } : {}),
                color: filled ? 'rgba(255,255,255,0.84)' : c.textSecondary,
                lineHeight: 1.3,
                textAlign,
            }
        }, detail),
        children && React.createElement('div', {
            style: {
                display: 'flex',
                flexDirection: 'column' as const,
                alignItems: align === 'center' ? 'center' : 'flex-start',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1.3,
                textAlign,
            }
        }, children),
        ])
    )
}

// ─── Pipeline — Horizontal flow with arrows between stages ──────────────────

interface PipelineStage {
    label: string
    sublabel?: string
    icon?: string
    color?: ColorName
}

interface PipelineProps {
    stages: PipelineStage[]
    c: ThemeColors
    title?: string
}

export function Pipeline({ stages, c, title }: PipelineProps): React.ReactElement {
    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            gap: 20,
        }
    },
        title && React.createElement('div', {
            style: { ...typography.label, color: c.textPrimary }
        }, title),

        React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: 0,
            }
        },
            ...stages.flatMap((stage, i) => {
                const elements: React.ReactElement[] = []

                elements.push(
                    Box({
                        label: stage.label,
                        sublabel: stage.sublabel,
                        icon: stage.icon,
                        color: stage.color || 'primary',
                        gradient: true,
                        c,
                        fontSize: 13,
                    })
                )

                if (i < stages.length - 1) {
                    elements.push(
                        Arrow({ direction: 'right', length: 36, c })
                    )
                }

                return elements
            }),
        ),
    )
}
