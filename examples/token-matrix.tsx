import React from 'react'
import { Column, DataTable, defineIllustration, Grid, Panel, Row, Scene, TextLabel } from 'vizmatic'

export const width = 1040
export const height = 560

const heat = ['#172033', '#123044', '#0f4a58', '#126a5b', '#6c7f2c', '#b46b24', '#d54545']

const frame = defineIllustration((c) =>
    <Scene c={c} title="Token matrix view" subtitle="tables and grids use wrapping-safe cells" gap={18}>
        <Row gap={18} align="stretch">
            <Panel c={c} title="Attention weights" tone="purple" width={480} align="center">
                <Grid
                    c={c}
                    cellWidth={48}
                    cellHeight={34}
                    headerRows={1}
                    headerCols={1}
                    rows={[
                        ['', 'the', 'cat', 'sat', 'down'],
                        ['the', { label: '.91', backgroundColor: heat[6] }, { label: '.04', backgroundColor: heat[1] }, { label: '.03', backgroundColor: heat[1] }, { label: '.02', backgroundColor: heat[0] }],
                        ['cat', { label: '.10', backgroundColor: heat[2] }, { label: '.70', backgroundColor: heat[5] }, { label: '.14', backgroundColor: heat[3] }, { label: '.06', backgroundColor: heat[1] }],
                        ['sat', { label: '.05', backgroundColor: heat[1] }, { label: '.22', backgroundColor: heat[4] }, { label: '.61', backgroundColor: heat[5] }, { label: '.12', backgroundColor: heat[2] }],
                        ['down', { label: '.03', backgroundColor: heat[0] }, { label: '.09', backgroundColor: heat[2] }, { label: '.18', backgroundColor: heat[3] }, { label: '.70', backgroundColor: heat[5] }],
                    ]}
                />
            </Panel>
            <Panel c={c} title="Feature table" tone="cyan" width={420} align="center">
                <Column gap={12}>
                    <DataTable
                        c={c}
                        firstColWidth={98}
                        cellWidth={76}
                        rows={[
                            ['metric', 'base', 'tuned', 'delta'],
                            ['BLEU', '31.2', '34.8', '+3.6'],
                            ['faith', '.72', '.81', '+.09'],
                            ['latency', '1.3s', '1.1s', '-.2s'],
                        ]}
                    />
                    <TextLabel c={c} text="Same component renders dark and light themes without rewriting cells." align="center" width={330} />
                </Column>
            </Panel>
        </Row>
    </Scene>
)

export const create = frame.create
export default frame.default
