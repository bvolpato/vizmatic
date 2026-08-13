import {
    DeploymentDiagram,
    Panel,
    Scene,
    getThemeColors,
    type ThemeMode,
} from 'vizmatic'

export const width = 1800
export const height = 700

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Deployment catalog"
            subtitle="nested region, VPC, subnet, namespace, and trust boundaries with typed ports"
            background={c.bg}
            padding={24}
            gap={12}
        >
            <Panel
                c={c}
                title="Regional inference plane"
                subtitle="network edges carry protocol and port intent; dotted links cross a declared trust or subnet boundary"
                tone="cyan"
                width="100%"
                minHeight={560}
                padding={14}
                align="center"
                footer="Ingress enters at HTTPS/443; service-to-service traffic uses mTLS or gRPC; workload identity remains inside its trust boundary."
            >
                <DeploymentDiagram
                    c={c}
                    width={1716}
                    height={452}
                    sizing="content"
                    direction="LR"
                    nodeWidth={168}
                    nodeHeight={76}
                    nodeGap={28}
                    rankGap={48}
                    edgeGap={12}
                    padding={26}
                    labelFontSize={13}
                    detailFontSize={11}
                    iconSize={18}
                    ariaLabel="Regional inference deployment with internet ingress, nested VPC and subnet boundaries, inference namespace, identity trust boundary, and protocol-specific service connections"
                    boundaries={[
                        { id: 'region', label: 'us-east-1', detail: 'REGION', kind: 'region', tone: 'blue' },
                        { id: 'vpc', label: 'prod-vpc', detail: '10.20.0.0/16', kind: 'vpc', parent: 'region', tone: 'purple' },
                        { id: 'public', label: 'public subnet', detail: '10.20.1.0/24', kind: 'subnet', parent: 'vpc', tone: 'cyan' },
                        { id: 'private', label: 'private subnet', detail: '10.20.2.0/24', kind: 'subnet', parent: 'vpc', tone: 'purple' },
                        { id: 'inference', label: 'inference', detail: 'NAMESPACE', kind: 'namespace', parent: 'private', tone: 'green' },
                        { id: 'identity', label: 'workload identity', detail: 'TRUST · mTLS', kind: 'trust', parent: 'vpc', tone: 'warm' },
                    ]}
                    nodes={[
                        {
                            id: 'internet',
                            label: 'Internet',
                            detail: 'external clients',
                            kind: 'internet',
                            tone: 'neutral',
                            icon: 'globe',
                            ports: [{ id: 'https', port: 443, protocol: 'HTTPS', direction: 'egress' }],
                        },
                        {
                            id: 'edge',
                            label: 'API gateway',
                            detail: 'public ingress',
                            kind: 'gateway',
                            boundary: 'public',
                            tone: 'cyan',
                            ports: [
                                { id: 'https', port: 443, protocol: 'HTTPS', direction: 'ingress' },
                                { id: 'mesh', port: 15008, protocol: 'mTLS', direction: 'egress' },
                            ],
                        },
                        {
                            id: 'api',
                            label: 'Inference API',
                            detail: 'namespace service',
                            kind: 'service',
                            boundary: 'inference',
                            tone: 'purple',
                            ports: [
                                { id: 'http', port: 8080, protocol: 'HTTP', direction: 'ingress' },
                                { id: 'grpc', port: 50051, protocol: 'gRPC', direction: 'egress' },
                            ],
                        },
                        {
                            id: 'model',
                            label: 'Model worker',
                            detail: 'GPU workload',
                            kind: 'worker',
                            boundary: 'inference',
                            tone: 'green',
                            ports: [
                                { id: 'grpc', port: 50051, protocol: 'gRPC', direction: 'ingress' },
                                { id: 'cache', port: 6379, protocol: 'TCP', direction: 'egress' },
                            ],
                        },
                        {
                            id: 'cache',
                            label: 'Feature cache',
                            detail: 'private state',
                            kind: 'cache',
                            boundary: 'private',
                            tone: 'blue',
                            ports: [{ id: 'redis', port: 6379, protocol: 'TCP', direction: 'bidirectional' }],
                        },
                        {
                            id: 'warehouse',
                            label: 'Feature warehouse',
                            detail: 'private history',
                            kind: 'database',
                            boundary: 'private',
                            tone: 'green',
                            ports: [{ id: 'sql', port: 5432, protocol: 'TCP', direction: 'ingress' }],
                        },
                        {
                            id: 'identity-agent',
                            label: 'Identity agent',
                            detail: 'attested workload',
                            kind: 'external',
                            boundary: 'identity',
                            tone: 'warm',
                            ports: [{ id: 'token', port: 443, protocol: 'HTTPS', direction: 'egress' }],
                        },
                    ]}
                    connections={[
                        { id: 'public-ingress', from: 'internet', to: 'edge', kind: 'ingress', label: 'HTTPS/443', protocol: 'HTTPS', toPort: 'https' },
                        { id: 'edge-api', from: 'edge', to: 'api', kind: 'cross-boundary', label: 'mTLS/8080', protocol: 'mTLS', fromPort: 'mesh', toPort: 'http' },
                        { id: 'api-model', from: 'api', to: 'model', kind: 'internal', label: 'gRPC/50051', protocol: 'gRPC', fromPort: 'grpc', toPort: 'grpc' },
                        { id: 'model-cache', from: 'model', to: 'cache', kind: 'cross-boundary', label: 'TCP/6379', protocol: 'TCP', fromPort: 'cache', toPort: 'redis' },
                        { id: 'model-warehouse', from: 'model', to: 'warehouse', kind: 'egress', label: 'TCP/5432', protocol: 'TCP', toPort: 'sql' },
                        { id: 'identity-api', from: 'identity-agent', to: 'api', kind: 'cross-boundary', label: 'trust / token', protocol: 'HTTPS', fromPort: 'token', toPort: 'http' },
                    ]}
                />
            </Panel>
        </Scene>
    )
}

export default create('dark')
