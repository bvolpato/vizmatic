width = 1120;
height = 800;
background = "theme";

// themeColors = {"primary":"#6d28d9","primaryLight":"#c4b5fd","primaryDark":"#4c1d95","secondary":"#0e7490","secondaryLight":"#22d3ee","secondaryDark":"#155e75","positive":"#15803d","positiveLight":"#4ade80","positiveDark":"#166534","warning":"#c2410c","warningLight":"#fb923c","warningDark":"#9a3412","info":"#0369a1","infoLight":"#38bdf8","infoDark":"#075985","accent":"#be185d","accentLight":"#f9a8d4"}

<Board width={1120} height={800}>
    <CanvasItem x={40} y={28} width={208} height={28}>
        <BadgePill text="DAYBREAK  /  ISSUE 01" tone="purple" filled />
    </CanvasItem>
    <CanvasItem x={40} y={66} width={690} height={46}>
        <TextLabel text="The launch found its people." variant="title" fontSize={31} color={c.textPrimary} />
    </CanvasItem>
    <CanvasItem x={40} y={116} width={690} height={32}>
        <TextLabel text="A first-day field report · all figures are illustrative demo data" variant="body" fontSize={14} color={c.textSecondary} />
    </CanvasItem>
    <CanvasItem x={790} y={28} width={290} height={126}>
        <MetricCard label="THE FIRST 24 HOURS" value="18,402" detail="new readers · +42% over goal" tone="purple" valueFontSize={34} align="left" />
    </CanvasItem>

    <CanvasItem x={40} y={172} width={248} height={82}>
        <MetricCard label="ACTIVATION" value="64%" detail="opened a second story" tone="green" align="left" />
    </CanvasItem>
    <CanvasItem x={304} y={172} width={248} height={82}>
        <MetricCard label="READ TIME" value="8m 24s" detail="median first session" tone="cyan" align="left" />
    </CanvasItem>
    <CanvasItem x={568} y={172} width={248} height={82}>
        <MetricCard label="PAID TRIALS" value="1,286" detail="started before midnight" tone="warm" align="left" />
    </CanvasItem>
    <CanvasItem x={832} y={172} width={248} height={82}>
        <MetricCard label="REFERRALS" value="2,940" detail="readers brought a friend" tone="pink" align="left" />
    </CanvasItem>

    <CanvasItem x={40} y={276} width={676} height={472}>
        <LineChart
            width={628}
            height={358}
            title="Momentum peaked at 6 pm"
            subtitle="Hourly readers · mobile and desktop · demo cohort"
            labels={['08', '10', '12', '14', '16', '18', '20', '22']}
            format="compact"
            yAxisLabel="readers"
            series={[
                { name: 'Mobile', points: [460, 720, 940, 1240, 1680, 1980, 1660, 1120], color: 'info', area: true },
                { name: 'Desktop', points: [340, 570, 780, 1110, 1460, 1600, 1200, 900], color: 'accent' },
            ]}
        />
    </CanvasItem>
    <CanvasItem x={740} y={276} width={340} height={218}>
        <DonutChart
            width={306}
            height={218}
            size={132}
            title="A launch list led discovery"
            centerLabel="new readers"
            centerValue="18.4k"
            format="percent"
            segments={[
                { label: 'Launch list', value: 0.38, color: 'primary' },
                { label: 'Search', value: 0.26, color: 'info' },
                { label: 'Community', value: 0.21, color: 'positive' },
                { label: 'Direct', value: 0.15, color: 'warning' },
            ]}
        />
    </CanvasItem>
    <CanvasItem x={740} y={516} width={340} height={222}>
        <ParetoBarChart
            width={306}
            height={158}
            title="Two steps drove most setup questions"
            format="integer"
            showValues={false}
            data={[
                { label: 'Setup', value: 40, color: 'warning' },
                { label: 'Import', value: 28, color: 'critical' },
                { label: 'Invite', value: 19, color: 'info' },
                { label: 'Billing', value: 13, color: 'neutral' },
            ]}
        />
    </CanvasItem>
</Board>
