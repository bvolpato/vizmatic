width = 1120;
height = 800;
background = "theme";

<Board c={c} width={1120} height={800}>
    <CanvasItem x={24} y={20} width={1072} height={112}>
        <CalloutCard
            c={c}
            width={1072}
            minHeight={112}
            padding={22}
            align="left"
            tone="purple"
            filled={false}
            title="AURORA / RELIABILITY DRILL 07"
            titleFontSize={12}
            detail="FICTIONAL CHECKOUT INCIDENT · traffic shifts around a degraded queue while recovery unfolds live."
            detailFontSize={17}
        />
    </CanvasItem>

    <CanvasItem x={24} y={146} width={254} height={86}>
        <MetricCard c={c} width={254} minHeight={86} tone="warm" label="P95 LATENCY" value="428 ms" detail="down from 1.8 s" valueFontSize={25} />
    </CanvasItem>
    <CanvasItem x={296} y={146} width={254} height={86}>
        <MetricCard c={c} width={254} minHeight={86} tone="green" label="CHECKOUT SUCCESS" value="99.93%" detail="recovered above objective" valueFontSize={25} />
    </CanvasItem>
    <CanvasItem x={568} y={146} width={254} height={86}>
        <MetricCard c={c} width={254} minHeight={86} tone="cyan" label="OLDEST QUEUE ITEM" value="18 s" detail="was 94 s at peak" valueFontSize={25} />
    </CanvasItem>
    <CanvasItem x={840} y={146} width={256} height={86}>
        <MetricCard c={c} width={256} minHeight={86} tone="blue" label="TRAFFIC ON HEALTHY POOL" value="100%" detail="zone-b serving checkout" valueFontSize={25} />
    </CanvasItem>

    <CanvasItem x={24} y={244} width={650} height={260}>
        <Panel
            c={c}
            width={650}
            height={260}
            padding={12}
            gap={6}
            tone="cyan"
            title="LIVE ROUTING / CHECKOUT PLANE"
            subtitle="The degraded worker is isolated; the healthy pool carries the rerouted queue."
        >
            <GraphDiagram
                c={c}
                width={624}
                height={190}
                layout="manual"
                routing="orthogonal"
                routingClearance={8}
                edgeGap={18}
                padding={12}
                nodeWidth={122}
                nodeHeight={58}
                labelFontSize={11}
                detailFontSize={11}
                nodes={[
                    { id: 'edge', label: 'Edge gateway', detail: 'checkout API', x: 0.10, y: 0.50, tone: 'blue', icon: 'gateway' },
                    { id: 'queue', label: 'Event queue', detail: 'replay paused', x: 0.34, y: 0.50, tone: 'purple', icon: 'queue' },
                    { id: 'worker-a', label: 'Zone A pool', detail: 'degraded · 1/3', x: 0.63, y: 0.27, tone: 'critical', icon: 'server' },
                    { id: 'worker-b', label: 'Zone B pool', detail: 'healthy · 3/3', x: 0.63, y: 0.73, tone: 'green', icon: 'container' },
                    { id: 'orders', label: 'Orders store', detail: 'writes steady', x: 0.91, y: 0.50, tone: 'green', icon: 'database' },
                ]}
                edges={[
                    { from: 'edge', to: 'queue', fromSide: 'right', toSide: 'left', tone: 'blue' },
                    { from: 'queue', to: 'worker-a', fromSide: 'right', toSide: 'left', tone: 'critical', style: 'dashed' },
                    { from: 'queue', to: 'worker-b', fromSide: 'right', toSide: 'left', tone: 'green' },
                    { from: 'worker-a', to: 'orders', fromSide: 'right', toSide: 'left', tone: 'warm', style: 'dashed' },
                    { from: 'worker-b', to: 'orders', fromSide: 'right', toSide: 'left', tone: 'green' },
                ]}
            />
        </Panel>
    </CanvasItem>

    <CanvasItem x={700} y={244} width={396} height={260}>
        <Timeline
            c={c}
            width={396}
            direction="vertical"
            gap={7}
            title="DRILL TIMELINE / RESPONSE"
            events={[
                { time: '14:32', title: 'Queue crosses 90 s', detail: 'Retry rate spikes 3×.', tone: 'critical' },
                { time: '14:34', title: 'Replay throttled', detail: 'Protect healthy pool.', tone: 'warm' },
                { time: '14:38', title: 'Fail over to zone B', detail: 'Lag falls steadily.', tone: 'green' },
            ]}
        />
    </CanvasItem>

    <CanvasItem x={24} y={514} width={1072} height={236}>
        <LineChart
            c={c}
            width={1020}
            height={106}
            title="P95 LATENCY / RECOVERY CURVE"
            subtitle="Lower is better · reroute restored the checkout SLO."
            min={0}
            max={2000}
            format="integer"
            labels={['14:32', '14:33', '14:34', '14:35', '14:36', '14:37', '14:38', '14:39']}
            series={[
                { name: 'p95 latency', points: [1800, 1690, 1320, 980, 710, 540, 428, 428], color: 'positive', area: true },
            ]}
        />
    </CanvasItem>
</Board>
