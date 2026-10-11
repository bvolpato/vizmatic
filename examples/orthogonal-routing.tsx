width = 1040;
height = 560;

<Scene title="Routes that respect the architecture" subtitle="named ports, separated traffic, and obstacle-aware connectors" align="center">
    <GraphDiagram
        ariaLabel="Two network routes bypass a central security appliance, with a retry loop on storage"
        width={960}
        height={380}
        nodeWidth={150}
        nodeHeight={80}
        routing="orthogonal"
        routingClearance={18}
        edgeGap={24}
        nodes={[
            { id: 'gateway', label: 'Gateway', detail: 'separate channels', x: 0.12, y: 0.52, tone: 'blue', icon: 'gateway', ports: [{ id: 'read', side: 'right', offset: 0.25 }, { id: 'write', side: 'right', offset: 0.75 }] },
            { id: 'security', label: 'Security', detail: 'reserved footprint', x: 0.50, y: 0.52, width: 190, height: 150, tone: 'purple', icon: 'firewall' },
            { id: 'storage', label: 'Storage', detail: 'read / write API', x: 0.87, y: 0.52, tone: 'green', icon: 'database', ports: [{ id: 'read', side: 'left', offset: 0.25 }, { id: 'write', side: 'left', offset: 0.75 }, { id: 'retry', side: 'right' }, { id: 'resume', side: 'top' }] },
        ]}
        edges={[
            { from: 'gateway', to: 'storage', fromPort: 'read', toPort: 'read', label: 'reads', tone: 'blue' },
            { from: 'gateway', to: 'storage', fromPort: 'write', toPort: 'write', label: 'writes', tone: 'green' },
            { from: 'storage', to: 'storage', fromPort: 'retry', toPort: 'resume', label: 'retry', style: 'dashed', tone: 'warm' },
        ]}
    />
</Scene>
