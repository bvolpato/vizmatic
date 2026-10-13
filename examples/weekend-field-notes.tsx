width = 1120;
height = 800;
background = "theme";

// themeColors = {"primary":"#9a3412","primaryLight":"#fdba74","primaryDark":"#7c2d12","secondary":"#0f766e","secondaryLight":"#5eead4","secondaryDark":"#134e4a","positive":"#4d7c0f","positiveLight":"#a3e635","positiveDark":"#365314","warning":"#b45309","warningLight":"#fbbf24","warningDark":"#78350f","info":"#0369a1","infoLight":"#38bdf8","infoDark":"#075985","accent":"#be185d","accentLight":"#f9a8d4"}

<Board width={1120} height={800}>
    <CanvasItem x={40} y={28} width={226} height={28}>
        <BadgePill text="THE WEEKENDER  /  FIELD NOTE 04" tone="warm" filled />
    </CanvasItem>
    <CanvasItem x={40} y={66} width={720} height={46}>
        <TextLabel text="Take the long way through Bellweather." variant="title" fontSize={30} color={c.textPrimary} />
    </CanvasItem>
    <CanvasItem x={40} y={116} width={720} height={36}>
        <TextLabel text="A fictional neighborhood walk · invented stops, scores, and timings" variant="body" fontSize={14} color={c.textSecondary} />
    </CanvasItem>
    <CanvasItem x={822} y={28} width={258} height={112}>
        <MetricCard label="READER RATING" value="4.9 / 5" detail="42 min on foot" tone="green" width={258} minHeight={112} valueFontSize={28} align="left" />
    </CanvasItem>

    <CanvasItem x={40} y={178} width={694} height={320}>
        <Card title="SAFFRON ROW  ·  1.8 MILES" subtitle="Four gentle stops from the tram to the old market" tone="warm" width={694} height={320} padding={16}>
            <GraphDiagram
                title="Fictional walking route through Saffron Row"
                ariaLabel="Demo walking route from Juniper Cafe through Glasshouse Garden and Paper Moon Books to Old Market"
                width={660}
                height={225}
                nodeWidth={126}
                nodeHeight={76}
                labelFontSize={13}
                detailFontSize={12}
                routing="orthogonal"
                routingClearance={12}
                nodes={[
                    { id: 'cafe', label: 'Juniper', detail: 'tram stop', x: 0.12, y: 0.25, tone: 'warm', icon: 'globe' },
                    { id: 'garden', label: 'Glasshouse', detail: 'shaded pause', x: 0.37, y: 0.70, tone: 'green', icon: 'bucket' },
                    { id: 'books', label: 'Paper Moon', detail: 'quiet shelves', x: 0.63, y: 0.25, tone: 'purple', icon: 'file' },
                    { id: 'market', label: 'Old Market', detail: 'citrus bun', x: 0.88, y: 0.70, tone: 'cyan', icon: 'check' },
                ]}
                edges={[
                    { from: 'cafe', to: 'garden', tone: 'warm' },
                    { from: 'garden', to: 'books', tone: 'green' },
                    { from: 'books', to: 'market', tone: 'cyan' },
                ]}
            />
        </Card>
    </CanvasItem>

    <CanvasItem x={40} y={518} width={694} height={222}>
        <BarChart
            width={660}
            height={158}
            title="Suggested pause, in demo minutes"
            format="integer"
            data={[
                { label: 'Cafe', value: 18, color: 'warning' },
                { label: 'Garden', value: 26, color: 'positive' },
                { label: 'Books', value: 22, color: 'primary' },
                { label: 'Market', value: 14, color: 'info' },
            ]}
        />
    </CanvasItem>

    <CanvasItem x={762} y={178} width={318} height={88}>
        <StepCard eyebrow="01  ·  4.9 / 5" title="Juniper Café" subtitle="Cortado · sesame bun" tone="warm" align="left" width={318} minHeight={88} />
    </CanvasItem>
    <CanvasItem x={762} y={278} width={318} height={88}>
        <StepCard eyebrow="02  ·  4.8 / 5" title="Glasshouse Garden" subtitle="Fern shade · quiet benches" tone="green" align="left" width={318} minHeight={88} />
    </CanvasItem>
    <CanvasItem x={762} y={378} width={318} height={88}>
        <StepCard eyebrow="03  ·  4.7 / 5" title="Paper Moon Books" subtitle="Used books · window seat" tone="purple" align="left" width={318} minHeight={88} />
    </CanvasItem>
    <CanvasItem x={762} y={478} width={318} height={88}>
        <StepCard eyebrow="04  ·  4.6 / 5" title="Old Market Hall" subtitle="Citrus bun · flower stall" tone="cyan" align="left" width={318} minHeight={88} />
    </CanvasItem>
    <CanvasItem x={762} y={584} width={318} height={122}>
        <Card title="Let the route breathe" subtitle="No reservations. No hurry. Every place in this guide is fictional demo content." tone="purple" width={318} height={122} padding={16}>
            <TextLabel text="Start when the rain clears; stay as long as the coffee is warm." variant="tiny" color={c.textSecondary} />
        </Card>
    </CanvasItem>
</Board>
