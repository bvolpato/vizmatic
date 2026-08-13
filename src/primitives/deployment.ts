import React from 'react'

import {
    GraphDiagram,
    type GraphDiagramEdge,
    type GraphDiagramGroup,
    type GraphDiagramNode,
    type GraphDiagramProps,
    type DiagramIconDefinition,
} from './diagrams'
import type { ThemeColors, ToneName } from '../theme'
import type { IconName } from './layout'

/** Deployment boundary kinds understood by {@link DeploymentDiagram}. */
export type DeploymentBoundaryKind =
    | 'region'
    | 'zone'
    | 'vpc'
    | 'subnet'
    | 'namespace'
    | 'host'
    | 'cluster'
    | 'trust'

/** Common infrastructure nodes used in deployment views. */
export type DeploymentNodeKind =
    | 'user'
    | 'client'
    | 'external'
    | 'gateway'
    | 'load-balancer'
    | 'service'
    | 'api'
    | 'function'
    | 'lambda'
    | 'worker'
    | 'container'
    | 'pod'
    | 'host'
    | 'vm'
    | 'cluster'
    | 'database'
    | 'cache'
    | 'queue'
    | 'storage'
    | 'object-store'
    | 'registry'
    | 'message-broker'
    | 'firewall'
    | 'network'
    | 'internet'
    | 'device'
    | 'custom'

/** Direction of a declared port. */
export type DeploymentPortDirection = 'ingress' | 'egress' | 'bidirectional'

/** A named network port exposed by a deployment node. */
export interface DeploymentPort {
    id: string
    port?: number | string
    protocol?: string
    label?: string
    direction?: DeploymentPortDirection
}

export type DeploymentPortInput = DeploymentPort | string | number

/** A nested infrastructure or trust boundary. */
export interface DeploymentBoundary {
    id: string
    label: React.ReactNode
    kind: DeploymentBoundaryKind
    detail?: React.ReactNode
    parent?: string
    tone?: ToneName
    muted?: boolean
}

/** A typed service, workload, host, or external endpoint. */
export interface DeploymentNode extends Omit<GraphDiagramNode, 'label' | 'detail' | 'group' | 'icon'> {
    id: string
    label: React.ReactNode
    detail?: React.ReactNode
    kind: DeploymentNodeKind
    boundary?: string
    ports?: DeploymentPortInput[]
    icon?: IconName | DiagramIconDefinition | React.ReactElement
}

export type DeploymentConnectionKind = 'ingress' | 'egress' | 'internal' | 'cross-boundary'

/** A typed network relationship between two deployment nodes. */
export interface DeploymentConnection extends Omit<GraphDiagramEdge, 'from' | 'to' | 'label' | 'kind' | 'style' | 'arrow'> {
    id?: string
    from: string
    to: string
    kind?: DeploymentConnectionKind
    label?: string
    protocol?: string
    port?: DeploymentPortInput
    fromPort?: string | number
    toPort?: string | number
    style?: GraphDiagramEdge['style']
    arrow?: GraphDiagramEdge['arrow']
}

/** Props for a deterministic deployment/network view. */
export interface DeploymentDiagramProps extends Omit<GraphDiagramProps, 'nodes' | 'edges' | 'groups' | 'c' | 'ariaLabel'> {
    c: ThemeColors
    boundaries?: DeploymentBoundary[]
    nodes: DeploymentNode[]
    connections?: DeploymentConnection[]
    ariaLabel?: string
}

interface DeploymentSpec {
    nodes: DeploymentNode[]
    boundaries?: DeploymentBoundary[]
    connections?: DeploymentConnection[]
    ariaLabel?: string
}

interface CompiledDeployment {
    nodes: GraphDiagramNode[]
    edges: GraphDiagramEdge[]
    groups: GraphDiagramGroup[]
    ariaLabel?: string
}

const boundaryKindLabels: Record<DeploymentBoundaryKind, string> = {
    region: 'REGION',
    zone: 'ZONE',
    vpc: 'VPC',
    subnet: 'SUBNET',
    namespace: 'NAMESPACE',
    host: 'HOST',
    cluster: 'CLUSTER',
    trust: 'TRUST',
}

const nodeKindLabels: Record<DeploymentNodeKind, string> = {
    user: 'USER',
    client: 'CLIENT',
    external: 'EXTERNAL',
    gateway: 'GATEWAY',
    'load-balancer': 'LOAD BALANCER',
    service: 'SERVICE',
    api: 'API',
    function: 'FUNCTION',
    lambda: 'LAMBDA',
    worker: 'WORKER',
    container: 'CONTAINER',
    pod: 'POD',
    host: 'HOST',
    vm: 'VM',
    cluster: 'CLUSTER',
    database: 'DATABASE',
    cache: 'CACHE',
    queue: 'QUEUE',
    storage: 'STORAGE',
    'object-store': 'OBJECT STORE',
    registry: 'REGISTRY',
    'message-broker': 'MESSAGE BROKER',
    firewall: 'FIREWALL',
    network: 'NETWORK',
    internet: 'INTERNET',
    device: 'DEVICE',
    custom: 'NODE',
}

const nodeKindIcons: Partial<Record<DeploymentNodeKind, IconName>> = {
    user: 'user',
    client: 'browser',
    external: 'globe',
    gateway: 'gateway',
    'load-balancer': 'load-balancer',
    service: 'container',
    api: 'gateway',
    function: 'agent',
    lambda: 'agent',
    worker: 'agent',
    container: 'container',
    pod: 'cluster',
    host: 'server',
    vm: 'server',
    cluster: 'cluster',
    database: 'database',
    cache: 'cache',
    queue: 'queue',
    storage: 'storage',
    'object-store': 'bucket',
    registry: 'storage',
    'message-broker': 'queue',
    firewall: 'firewall',
    network: 'network',
    internet: 'globe',
    device: 'mobile',
}

const connectionTones: Record<DeploymentConnectionKind, ToneName> = {
    ingress: 'cyan',
    egress: 'warm',
    internal: 'blue',
    'cross-boundary': 'purple',
}

const boundaryKinds: DeploymentBoundaryKind[] = ['region', 'zone', 'vpc', 'subnet', 'namespace', 'host', 'cluster', 'trust']
const nodeKinds: DeploymentNodeKind[] = [
    'user',
    'client',
    'external',
    'gateway',
    'load-balancer',
    'service',
    'api',
    'function',
    'lambda',
    'worker',
    'container',
    'pod',
    'host',
    'vm',
    'cluster',
    'database',
    'cache',
    'queue',
    'storage',
    'object-store',
    'registry',
    'message-broker',
    'firewall',
    'network',
    'internet',
    'device',
    'custom',
]
const connectionKinds: DeploymentConnectionKind[] = ['ingress', 'egress', 'internal', 'cross-boundary']

function assertIdentifier(id: string, what: string): void {
    if (typeof id !== 'string' || id.trim().length === 0) {
        throw new Error(`DeploymentDiagram ${what} id must be a non-empty string.`)
    }
}

function assertUniqueIdentifier(id: string, seen: Set<string>, what: string): void {
    assertIdentifier(id, what)
    if (seen.has(id)) throw new Error(`DeploymentDiagram received duplicate ${what} id "${id}".`)
    seen.add(id)
}

function portIdentity(port: DeploymentPortInput): string {
    if (typeof port === 'string' || typeof port === 'number') return String(port)
    return port.id
}

function portText(port: DeploymentPortInput): string {
    if (typeof port === 'string' || typeof port === 'number') return String(port)
    if (port.label) return port.label
    const endpoint = port.port ?? port.id
    return [port.protocol, endpoint == null ? undefined : String(endpoint)].filter(Boolean).join('/')
        || port.direction
        || 'port'
}

function portForReference(node: DeploymentNode, reference: string | number | undefined): DeploymentPort | string | number | undefined {
    if (reference == null) return undefined
    return node.ports?.find((port) => portIdentity(port) === String(reference))
}

function resolveConnectionKind(connection: DeploymentConnection): DeploymentConnectionKind {
    const kind = connection.kind ?? 'internal'
    if (!connectionKinds.includes(kind)) {
        throw new Error(`DeploymentDiagram connection "${connection.from}" -> "${connection.to}" must use kind "ingress", "egress", "internal", or "cross-boundary".`)
    }
    return kind
}

function resolveBoundaryKind(boundary: DeploymentBoundary): DeploymentBoundaryKind {
    const kind = boundary.kind
    if (kind == null || !boundaryKinds.includes(kind)) {
        throw new Error(`DeploymentDiagram boundary "${boundary.id}" must define kind as "region", "zone", "vpc", "subnet", "namespace", "host", "cluster", or "trust".`)
    }
    return kind
}

function resolveNodeKind(node: DeploymentNode): DeploymentNodeKind {
    const kind = node.kind
    if (kind == null || !nodeKinds.includes(kind)) {
        throw new Error(`DeploymentDiagram node "${node.id}" must define kind as a supported deployment node kind.`)
    }
    return kind
}

function connectionPortReference(
    connection: DeploymentConnection,
    side: 'from' | 'to',
): string | number | undefined {
    return side === 'from' ? connection.fromPort : connection.toPort
}

function connectionLabel(
    connection: DeploymentConnection,
    sourcePort: DeploymentPortInput | undefined,
    targetPort: DeploymentPortInput | undefined,
): string | undefined {
    if (connection.label != null) return connection.label
    const declaredPort = connection.port
    const portLabel = declaredPort != null
        ? portText(declaredPort)
        : sourcePort != null
            ? portText(sourcePort)
            : targetPort != null
                ? portText(targetPort)
                : undefined
    const protocol = connection.protocol
        ?? (typeof sourcePort === 'object' && sourcePort != null ? sourcePort.protocol : undefined)
        ?? (typeof targetPort === 'object' && targetPort != null ? targetPort.protocol : undefined)
    if (protocol && portLabel && !portLabel.toLowerCase().startsWith(protocol.toLowerCase())) {
        return `${protocol}/${portLabel}`
    }
    return protocol ?? portLabel
}

function validateDeploymentSpec(
    boundaries: DeploymentBoundary[],
    nodes: DeploymentNode[],
    connections: DeploymentConnection[],
): void {
    const ids = new Set<string>()
    const boundaryIds = new Set<string>()
    for (const boundary of boundaries) {
        assertUniqueIdentifier(boundary.id, ids, 'boundary')
        resolveBoundaryKind(boundary)
        boundaryIds.add(boundary.id)
    }

    const nodeIds = new Set<string>()
    const portsByNode = new Map<string, Map<string, DeploymentPortInput>>()
    for (const node of nodes) {
        assertUniqueIdentifier(node.id, ids, 'node')
        nodeIds.add(node.id)
        const boundary = node.boundary
        if (boundary != null && !boundaryIds.has(boundary)) {
            throw new Error(`DeploymentDiagram node "${node.id}" references missing boundary "${boundary}".`)
        }
        const ports = new Map<string, DeploymentPortInput>()
        node.ports?.forEach((port) => {
            const identity = portIdentity(port)
            if (ports.has(identity)) throw new Error(`DeploymentDiagram node "${node.id}" received duplicate port "${identity}".`)
            ports.set(identity, port)
        })
        portsByNode.set(node.id, ports)
    }

    const boundaryParents = new Map(boundaries.map((boundary) => [boundary.id, boundary.parent]))
    for (const boundary of boundaries) {
        if (boundary.parent != null && !boundaryIds.has(boundary.parent)) {
            throw new Error(`DeploymentDiagram boundary "${boundary.id}" references missing parent boundary "${boundary.parent}".`)
        }
        const visited = new Set<string>([boundary.id])
        let parent = boundary.parent
        while (parent != null) {
            if (visited.has(parent)) throw new Error(`DeploymentDiagram boundaries contain a parent cycle at "${parent}".`)
            visited.add(parent)
            parent = boundaryParents.get(parent)
        }
    }

    const connectionIds = new Set<string>()
    for (const connection of connections) {
        if (connection.id != null) assertUniqueIdentifier(connection.id, connectionIds, 'connection')
        if (!nodeIds.has(connection.from) || !nodeIds.has(connection.to)) {
            throw new Error(`DeploymentDiagram connection "${connection.from}" -> "${connection.to}" references a missing node.`)
        }
        resolveConnectionKind(connection)
        for (const side of ['from', 'to'] as const) {
            const reference = connectionPortReference(connection, side)
            if (reference == null) continue
            const nodeId = side === 'from' ? connection.from : connection.to
            const ports = portsByNode.get(nodeId)
            if (ports != null && ports.size > 0 && !ports.has(String(reference))) {
                throw new Error(`DeploymentDiagram connection "${connection.from}" -> "${connection.to}" references missing ${side} port "${reference}" on node "${nodeId}".`)
            }
        }
    }
}

function graphConnectionKind(kind: DeploymentConnectionKind): GraphDiagramEdge['kind'] {
    if (kind === 'internal') return 'data'
    if (kind === 'ingress') return 'sync'
    return 'dependency'
}

function graphConnectionStyle(kind: DeploymentConnectionKind): GraphDiagramEdge['style'] {
    if (kind === 'cross-boundary') return 'dotted'
    if (kind === 'egress') return 'dashed'
    return 'solid'
}

/** Compile typed deployment semantics into the shared GraphDiagram model. */
function compileDeployment(spec: DeploymentSpec): CompiledDeployment {
    const boundaries = spec.boundaries ?? []
    const connections = spec.connections ?? []
    validateDeploymentSpec(boundaries, spec.nodes, connections)

    const groups: GraphDiagramGroup[] = boundaries.map((boundary) => ({
        id: boundary.id,
        label: boundary.label,
        detail: boundary.detail ?? boundaryKindLabels[resolveBoundaryKind(boundary)],
        parent: boundary.parent,
        tone: boundary.tone,
        muted: boundary.muted,
    }))

    const nodes: GraphDiagramNode[] = spec.nodes.map((node) => {
        const kind = resolveNodeKind(node)
        const nodePorts = node.ports ?? []
        const generatedDetail = nodePorts.length > 0
            ? `ports: ${nodePorts.map(portText).join(', ')}`
            : nodeKindLabels[kind]
        return {
            id: node.id,
            label: node.label,
            detail: node.detail ?? generatedDetail,
            x: node.x,
            y: node.y,
            tone: node.tone,
            muted: node.muted,
            width: node.width,
            height: node.height,
            group: node.boundary,
            icon: node.icon ?? nodeKindIcons[kind],
            iconSize: node.iconSize,
        }
    })

    const edges: GraphDiagramEdge[] = connections.map((connection) => {
        const kind = resolveConnectionKind(connection)
        const fromReference = connectionPortReference(connection, 'from')
        const toReference = connectionPortReference(connection, 'to')
        const sourceNode = spec.nodes.find((node) => node.id === connection.from)
        const targetNode = spec.nodes.find((node) => node.id === connection.to)
        const sourcePort = sourceNode ? portForReference(sourceNode, fromReference) : undefined
        const targetPort = targetNode ? portForReference(targetNode, toReference) : undefined
        const fallbackFromPort = fromReference != null && !sourceNode?.ports?.length ? fromReference : undefined
        const fallbackToPort = toReference != null && !targetNode?.ports?.length ? toReference : undefined
        return {
            from: connection.from,
            to: connection.to,
            tone: connection.tone ?? connectionTones[kind],
            muted: connection.muted,
            kind: graphConnectionKind(kind),
            style: connection.style ?? graphConnectionStyle(kind),
            arrow: connection.arrow ?? 'forward',
            label: connectionLabel(connection, sourcePort ?? fallbackFromPort, targetPort ?? fallbackToPort),
        }
    })

    return {
        nodes,
        edges,
        groups,
        ariaLabel: spec.ariaLabel ?? 'Deployment diagram',
    }
}

/**
 * Render typed deployment and network semantics through GraphDiagram.
 *
 * Boundary and node array order is preserved before handing the model to
 * Dagre, keeping automatic layout stable for equal inputs.
 */
export function DeploymentDiagram({
    c,
    boundaries,
    nodes,
    connections,
    ariaLabel = 'Deployment diagram',
    ...graphProps
}: DeploymentDiagramProps): React.ReactElement {
    const compiled = compileDeployment({ nodes, boundaries, connections, ariaLabel })
    return GraphDiagram({
        ...graphProps,
        c,
        nodes: compiled.nodes,
        edges: compiled.edges,
        groups: compiled.groups,
        ariaLabel: compiled.ariaLabel,
    })
}
