width = 1120;
height = 760;
background = "theme";

<Board c={c} width={1120} height={760}>
    <CanvasItem x={24} y={20} width={1072} height={104}>
        <CalloutCard
            c={c}
            width={1072}
            minHeight={104}
            padding={20}
            align="left"
            tone="blue"
            filled={false}
            title="MODEL GARDEN / ROUTE BY THE JOB"
            titleFontSize={12}
            detail="ILLUSTRATIVE DATA ONLY · compare the cost, quality, and latency trade-offs before choosing a default."
            detailFontSize={16}
        />
    </CanvasItem>

    <CanvasItem x={24} y={140} width={668} height={420}>
        <ParetoChart
            c={c}
            width={450}
            height={294}
            title="MODEL OPTIONS / COST × QUALITY FRONTIER"
            subtitle="Synthetic values · lower cost and higher quality are preferred."
            xMin={0}
            xMax={10}
            yMin={50}
            yMax={100}
            xAxisLabel="credits per request · illustrative"
            formatX="decimal"
            formatY="integer"
            frontierColor="positive"
            showGoal={false}
            points={[
                { x: 0.5, y: 64, label: 'Swift', color: 'info', size: 8 },
                { x: 1.2, y: 76, label: 'Sage', color: 'primary', size: 9 },
                { x: 2.7, y: 88, label: 'Orbit', color: 'secondary', size: 9 },
                { x: 5.8, y: 95, label: 'Apex', color: 'warning', size: 9 },
                { x: 8.4, y: 97, label: 'Max', color: 'positive', size: 8 },
                { x: 4.2, y: 81, label: 'Classic', color: 'critical', size: 8 },
                { x: 7.1, y: 91, label: 'Studio', color: 'neutral', size: 8 },
            ]}
            footer="Fictional values for illustration, not model benchmarks."
        />
    </CanvasItem>

    <CanvasItem x={712} y={140} width={384} height={178}>
        <CalloutCard
            c={c}
            width={384}
            minHeight={178}
            padding={20}
            align="left"
            tone="green"
            filled={false}
            title="THE BALANCED DEFAULT"
            titleFontSize={15}
            detail="Sage covers routine support at 1.2 credits per request, with a fictional quality index of 76. Escalate only when the task needs deeper reasoning."
            detailFontSize={13}
        />
    </CanvasItem>

    <CanvasItem x={712} y={322} width={384} height={240}>
        <BarChart
            c={c}
            width={350}
            height={128}
            title="SPEED / SECONDS · ILLUSTRATIVE P50"
            subtitle="Lower latency · measure on your own workloads."
            footer="P50 s: Swift 0.42 · Sage 0.68 · Orbit 1.20 · Apex 2.40"
            format="decimal"
            showValues={false}
            min={0}
            max={3}
            data={[
                { label: 'Swift', value: 0.42, color: 'info' },
                { label: 'Sage', value: 0.68, color: 'primary' },
                { label: 'Orbit', value: 1.2, color: 'secondary' },
                { label: 'Apex', value: 2.4, color: 'warning' },
            ]}
        />
    </CanvasItem>

    <CanvasItem x={24} y={578} width={344} height={134}>
        <CalloutCard c={c} width={344} minHeight={134} padding={16} align="left" tone="cyan" filled={false} title="FAST PATH / SWIFT" titleFontSize={13} detail="Tagging, extraction, and low stakes actions." detailFontSize={13} />
    </CanvasItem>
    <CanvasItem x={388} y={578} width={344} height={134}>
        <CalloutCard c={c} width={344} minHeight={134} padding={16} align="left" tone="purple" filled={false} title="BALANCED / SAGE" titleFontSize={13} detail="Everyday support and dependable summaries." detailFontSize={13} />
    </CanvasItem>
    <CanvasItem x={752} y={578} width={344} height={134}>
        <CalloutCard c={c} width={344} minHeight={134} padding={16} align="left" tone="warm" filled={false} title="DEEP WORK / APEX" titleFontSize={13} detail="Long plans, hard analysis, and careful reviews." detailFontSize={13} />
    </CanvasItem>
</Board>
