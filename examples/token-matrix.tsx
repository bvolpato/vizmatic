width = 1040;
height = 560;

const heat = ['#172033', '#123044', '#0f4a58', '#126a5b', '#6c7f2c', '#b46b24', '#d54545'];

function heatText(background: string) {
    const hex = background.slice(1)
    const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    const luminance = channels.reduce((total, channel, index) => {
        const linear = channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        return total + linear * [0.2126, 0.7152, 0.0722][index]
    }, 0)
    return luminance > 0.179 ? '#000000' : '#f8fafc'
}

<Scene title="Token matrix view" subtitle="tables and grids use wrapping-safe cells" background={c.bg} gap={18}>
    <Row gap={18} align="stretch">
        <Panel title="Attention weights" tone="purple" width={480} align="center">
            <Grid
                cellWidth={48}
                cellHeight={34}
                headerRows={1}
                headerCols={1}
                rows={[
                    ['', 'the', 'cat', 'sat', 'down'],
                    ['the', { label: '.91', backgroundColor: heat[6], color: heatText(heat[6]) }, { label: '.04', backgroundColor: heat[1], color: heatText(heat[1]) }, { label: '.03', backgroundColor: heat[1], color: heatText(heat[1]) }, { label: '.02', backgroundColor: heat[0], color: heatText(heat[0]) }],
                    ['cat', { label: '.10', backgroundColor: heat[2], color: heatText(heat[2]) }, { label: '.70', backgroundColor: heat[5], color: heatText(heat[5]) }, { label: '.14', backgroundColor: heat[3], color: heatText(heat[3]) }, { label: '.06', backgroundColor: heat[1], color: heatText(heat[1]) }],
                    ['sat', { label: '.05', backgroundColor: heat[1], color: heatText(heat[1]) }, { label: '.22', backgroundColor: heat[4], color: heatText(heat[4]) }, { label: '.61', backgroundColor: heat[5], color: heatText(heat[5]) }, { label: '.12', backgroundColor: heat[2], color: heatText(heat[2]) }],
                    ['down', { label: '.03', backgroundColor: heat[0], color: heatText(heat[0]) }, { label: '.09', backgroundColor: heat[2], color: heatText(heat[2]) }, { label: '.18', backgroundColor: heat[3], color: heatText(heat[3]) }, { label: '.70', backgroundColor: heat[5], color: heatText(heat[5]) }],
                ]}
            />
        </Panel>
        <Panel title="Feature table" tone="cyan" width={420} align="center">
            <Column gap={12}>
                <DataTable
                    firstColWidth={98}
                    cellWidth={76}
                    rows={[
                        ['metric', 'base', 'tuned', 'delta'],
                        ['BLEU', '31.2', '34.8', '+3.6'],
                        ['faith', '.72', '.81', '+.09'],
                        ['latency', '1.3s', '1.1s', '-.2s'],
                    ]}
                />
                <TextLabel text="Same component renders dark and light themes without rewriting cells." align="center" width={330} />
            </Column>
        </Panel>
    </Row>
</Scene>
