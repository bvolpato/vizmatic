# Vizmatic components

Package: vizmatic@0.3.1. Catalog: 75 runnable examples across 11 categories.

Each example is a focused, runnable starting point. The generated Props lists mirror exported TypeScript signatures; `type` is TypeScript text, not a JSON schema, and props may accept values that JSON cannot represent. `required` records signature requiredness. Exhaustive finite choices use `allowedValuesRef`; mixed unions may use `literalValuesRef` for available JSON literal presets while callback or other non-literal variants remain source-only. Shared values are stored in the `propEnums` object in `components.json`. Default values are not inferred.

## Foundations



Scene structure, responsive layout, and framed surfaces.



### Canvas

Root canvas with transparent or custom backgrounds and padding.

Props:
- `background`: `string` (optional)
- `c`: `ThemeColors` (required)
- `children`: `React.ReactNode` (optional)
- `justify`: `"center" | "flex-start" | "space-between" | "space-around"` (optional; allowed values: `propEnums.values1`)
- `padding`: `number` (optional)

```tsx
width = 960
height = 480

<Canvas
    padding={24}>
  <Column
    gap={14}>
  <TitleBar
    title='Canvas surface'
    subtitle='A theme aware root with alpha background support' />
  <MetricCard
    label='Render time'
    value='42 ms'
    tone='green'
    detail='p95 across 1,200 frames' />
  </Column>
  </Canvas>
```

### Board

Fixed-size canvas for freely positioned visuals in one coordinate space.

Props:
- `background`: `string` (optional)
- `c`: `ThemeColors` (required)
- `children`: `React.ReactNode` (optional)
- `height`: `number` (optional)
- `width`: `number` (optional)

```tsx
width = 960
height = 480

<Board
    width={960}
    height={480}
    background={c.bgSubtle}>
  <CanvasItem
    x={48}
    y={44}
    width={288}
    height={132}>
  <MetricCard
    label='API latency'
    value='82 ms'
    detail='budget: 120 ms'
    tone='green' />
  </CanvasItem>
  <CanvasItem
    x={368}
    y={184}
    width={264}
    height={132}>
  <MetricCard
    label='Queue depth'
    value='14'
    detail='steady over 5 min'
    tone='purple' />
  </CanvasItem>
  <CanvasItem
    x={672}
    y={52}
    width={240}
    height={116}>
  <MetricCard
    label='Deploy'
    value='healthy'
    detail='all regions'
    tone='blue' />
  </CanvasItem>
  </Board>
```

### CanvasItem

Positions and sizes a visual relative to its parent Board.

Props:
- `children`: `React.ReactNode` (optional)
- `height`: `number` (optional)
- `width`: `number` (optional)
- `x`: `number` (required)
- `y`: `number` (required)

```tsx
width = 1040
height = 640

<Scene title="CanvasItem example" subtitle="Edit this focused CanvasItem scene" padding={22} gap={18}>
  <Board
    width={960}
    height={480}
    background={c.bgSubtle}>
  <CanvasItem
    x={52}
    y={48}
    width={300}
    height={138}>
  <MetricCard
    label='API latency'
    value='82 ms'
    detail='budget: 120 ms'
    tone='green' />
  </CanvasItem>
  <CanvasItem
    x={404}
    y={196}
    width={360}
    height={148}>
  <Panel
    title='Worker pool'
    subtitle='positioned as one canvas item'
    tone='purple'
    width='100%'
    padding={16}>
  <StatusRow
    label='Workers'
    detail='8 / 8 ready'
    status='check' />
  </Panel>
  </CanvasItem>
  </Board>
</Scene>
```

### Scene

Primary vertical scene layout with optional title and subtitle.

Props:
- `align`: `FlexAlign` (optional; allowed values: `propEnums.FlexAlign`)
- `background`: `string` (optional)
- `c`: `ThemeColors` (required)
- `children`: `React.ReactNode` (required)
- `contentStyle`: `React.CSSProperties` (optional)
- `contentWidth`: `string | number` (optional)
- `gap`: `number` (optional)
- `justify`: `"center" | "flex-start" | "space-between" | "space-around" | undefined` (optional; allowed values: `propEnums.values1`)
- `padding`: `number` (optional)
- `subtitle`: `string` (optional)
- `title`: `string` (optional)

```tsx
width = 960
height = 480

<Scene
    title='Scene layout'
    subtitle='A title, content area, and consistent spacing'>
  <Row
    gap={14}>
  <MetricCard
    label='Build'
    value='ready'
    tone='green' />
  <MetricCard
    label='Review'
    value='2 items'
    tone='warm' />
  </Row>
  </Scene>
```

### TitleBar

Standalone heading and supporting copy.

Props:
- `c`: `ThemeColors` (required)
- `subtitle`: `string` (optional)
- `title`: `string` (required)

```tsx
width = 960
height = 480

<Scene title="TitleBar example" subtitle="Edit this focused TitleBar scene" padding={22} gap={18}>
  <Column
    gap={16}>
  <TitleBar
    title='Release overview'
    subtitle='One clear headline with supporting context' />
  <ProgressList
    rows={[{ label: 'Build', value: 1, tone: 'green' },
        { label: 'Review', value: 0.72, tone: 'purple' }]} />
  </Column>
</Scene>
```

### Row

Horizontal flex layout with stable gaps and alignment.

Props:
- `align`: `FlexAlign` (optional; allowed values: `propEnums.FlexAlign`)
- `children`: `React.ReactNode` (required)
- `gap`: `number` (optional)
- `height`: `string | number` (optional)
- `justify`: `FlexJustify` (optional; allowed values: `propEnums.FlexJustify`)
- `style`: `React.CSSProperties` (optional)
- `width`: `string | number` (optional)
- `wrap`: `boolean` (optional; allowed values: `propEnums.values2`)

```tsx
width = 960
height = 480

<Scene title="Row example" subtitle="Edit this focused Row scene" padding={22} gap={18}>
  <Row
    gap={12}
    align='stretch'>
  <StepCard
    title='Plan'
    subtitle='shape the story'
    tone='blue'
    width={220} />
  <StepCard
    title='Render'
    subtitle='check both themes'
    tone='purple'
    width={220} />
  <StepCard
    title='Ship'
    subtitle='publish the asset'
    tone='green'
    width={220} />
  </Row>
</Scene>
```

### Column

Vertical flex layout for stacked composition.

Props:
- `align`: `FlexAlign` (optional; allowed values: `propEnums.FlexAlign`)
- `children`: `React.ReactNode` (required)
- `gap`: `number` (optional)
- `height`: `string | number` (optional)
- `justify`: `FlexJustify` (optional; allowed values: `propEnums.FlexJustify`)
- `style`: `React.CSSProperties` (optional)
- `width`: `string | number` (optional)
- `wrap`: `boolean` (optional; allowed values: `propEnums.values2`)

```tsx
width = 960
height = 480

<Scene title="Column example" subtitle="Edit this focused Column scene" padding={22} gap={18}>
  <Column
    gap={10}
    align='stretch'>
  <StatusRow
    label='Layout'
    detail='ready'
    status='check' />
  <StatusRow
    label='Contrast'
    detail='inspect'
    status='pending' />
  <StatusRow
    label='Export'
    detail='PNG + SVG'
    status='info' />
  </Column>
</Scene>
```

### Stack

Compact vertical grouping for related content.

Props:
- `align`: `"center" | "start" | "end" | "stretch"` (optional; allowed values: `propEnums.FlexAlign`)
- `children`: `React.ReactNode` (required)
- `direction`: `"vertical" | "horizontal"` (optional; allowed values: `propEnums.values3`)
- `gap`: `number` (optional)
- `wrap`: `boolean` (optional; allowed values: `propEnums.values2`)

```tsx
width = 960
height = 480

<Scene title="Stack example" subtitle="Edit this focused Stack scene" padding={22} gap={18}>
  <Stack
    gap={10}
    align='stretch'>
  <BadgePill
    text='INPUT'
    tone='blue' />
  <Arrow
    direction='down'
    length={24} />
  <BadgePill
    text='OUTPUT'
    tone='green' />
  </Stack>
</Scene>
```

### Panel

Titled container for grouped visual content.

Props:
- `accentHeight`: `number` (optional)
- `accentWidth`: `number` (optional)
- `align`: `FlexAlign` (optional; allowed values: `propEnums.FlexAlign`)
- `background`: `string` (optional)
- `bodyStyle`: `React.CSSProperties` (optional)
- `borderColor`: `string` (optional)
- `c`: `ThemeColors` (required)
- `children`: `React.ReactNode` (optional)
- `footer`: `React.ReactNode` (optional)
- `gap`: `number` (optional)
- `height`: `string | number` (optional)
- `justify`: `FlexJustify` (optional; allowed values: `propEnums.FlexJustify`)
- `minHeight`: `string | number` (optional)
- `minWidth`: `string | number` (optional)
- `padding`: `string | number` (optional)
- `radius`: `number` (optional)
- `shadow`: `boolean` (optional; allowed values: `propEnums.values2`)
- `subtitle`: `React.ReactNode` (optional)
- `title`: `React.ReactNode` (required)
- `titleFontSize`: `number` (optional)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="Panel example" subtitle="Edit this focused Panel scene" padding={22} gap={18}>
  <Panel
    title='Service health'
    subtitle='Live state grouped in a titled surface'
    tone='green'
    width='100%'
    padding={18}>
  <StatusList
    rows={[{ label: 'API', detail: 'healthy', status: 'check' },
        { label: 'Queue', detail: '12 jobs', status: 'info' }]} />
  </Panel>
</Scene>
```

### Card

General-purpose surface with tone, padding, and shadow.

Props:
- `align`: `FlexAlign` (optional; allowed values: `propEnums.FlexAlign`)
- `background`: `string` (optional)
- `bodyStyle`: `React.CSSProperties` (optional)
- `borderColor`: `string` (optional)
- `c`: `ThemeColors` (required)
- `children`: `React.ReactNode` (optional)
- `footer`: `React.ReactNode` (optional)
- `gap`: `number` (optional)
- `height`: `string | number` (optional)
- `justify`: `FlexJustify` (optional; allowed values: `propEnums.FlexJustify`)
- `minHeight`: `string | number` (optional)
- `minWidth`: `string | number` (optional)
- `padding`: `string | number` (optional)
- `radius`: `number` (optional)
- `shadow`: `boolean` (optional; allowed values: `propEnums.values2`)
- `subtitle`: `React.ReactNode` (optional)
- `title`: `React.ReactNode` (optional)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="Card example" subtitle="Edit this focused Card scene" padding={22} gap={18}>
  <Card
    title='Inference API'
    subtitle='Regional endpoint'
    tone='purple'
    width={430}
    padding={20} shadow>
  <TextLabel
    text='p95 latency'
    fontSize={12} />
  <MetricCard
    label='Latency'
    value='82 ms'
    tone='green'
    width={180} />
  </Card>
</Scene>
```

### WindowFrame

Application or terminal window framing.

Props:
- `background`: `string` (optional)
- `bodyStyle`: `React.CSSProperties` (optional)
- `c`: `ThemeColors` (required)
- `children`: `React.ReactNode` (optional)
- `dots`: `boolean` (optional; allowed values: `propEnums.values2`)
- `height`: `string | number` (optional)
- `minHeight`: `string | number` (optional)
- `minWidth`: `string | number` (optional)
- `padding`: `string | number` (optional)
- `radius`: `number` (optional)
- `shadow`: `boolean` (optional; allowed values: `propEnums.values2`)
- `title`: `React.ReactNode` (optional)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `variant`: `"window" | "browser" | "terminal"` (optional; allowed values: `propEnums.values4`)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="WindowFrame example" subtitle="Edit this focused WindowFrame scene" padding={22} gap={18}>
  <WindowFrame
    title='worker.log'
    variant='terminal'
    tone='green'
    width={620}>
  <Column
    gap={8}
    align='stretch'>
  <TextLabel
    text='$ vizmatic render scene.tsx' mono
    fontSize={13} />
  <TextLabel
    text='✓ dark and light previews created' mono
    fontSize={13}
    color={c.positiveLight} />
  </Column>
  </WindowFrame>
</Scene>
```
## Content



Labels, cards, code, comparisons, and reusable information blocks.



### ToneStrip

Short semantic color accent.

Props:
- `height`: `number` (optional)
- `tone`: `ToneName` (required; allowed values: `propEnums.ToneName`)
- `width`: `number` (optional)

```tsx
width = 960
height = 480

<Scene title="ToneStrip example" subtitle="Edit this focused ToneStrip scene" padding={22} gap={18}>
  <Row
    gap={14}
    align='center'>
  <ToneStrip
    tone='purple'
    width={64}
    height={8} />
  <TextLabel
    text='Accent follows the selected semantic tone.'
    fontSize={14} />
  </Row>
</Scene>
```

### Icon

Theme-aware technical icon set.

Props:
- `c`: `ThemeColors` (required)
- `color`: `string` (optional)
- `label`: `string` (optional)
- `muted`: `boolean` (optional; allowed values: `propEnums.values2`)
- `name`: `IconName` (required; allowed values: `propEnums.IconName`)
- `size`: `number` (optional)
- `strokeWidth`: `number` (optional)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)

```tsx
width = 960
height = 480

<Scene title="Icon example" subtitle="Edit this focused Icon scene" padding={22} gap={18}>
  <Row
    gap={18}
    align='center'>
  <Icon
    name='layers'
    tone='purple'
    size={34} />
  <Icon
    name='code'
    tone='blue'
    size={34} />
  <Icon
    name='spark'
    tone='green'
    size={34} />
  </Row>
</Scene>
```

### TextLabel

Wrapping-safe SVG or flex label.

Props:
- `align`: `"center" | "left" | "right"` (optional; allowed values: `propEnums.values5`)
- `c`: `ThemeColors` (required)
- `color`: `string` (optional)
- `fontSize`: `number` (optional)
- `fontWeight`: `number` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `mono`: `boolean` (optional; allowed values: `propEnums.values2`)
- `text`: `string` (required)
- `variant`: `"code" | "title" | "subtitle" | "label" | "body" | "small" | "tiny" | "annotation"` (optional; allowed values: `propEnums.values6`)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="TextLabel example" subtitle="Edit this focused TextLabel scene" padding={22} gap={18}>
  <Column
    gap={8}
    align='start'>
  <TextLabel
    text='A readable technical label'
    fontSize={20}
    fontWeight={800}
    color={c.textPrimary} />
  <TextLabel
    text='Use mono for identifiers, commands, and compact metadata.' mono
    fontSize={12} />
  </Column>
</Scene>
```

### MathText

Math-aware text formatting for React content.

Props:
- `text`: `string` (required)

```tsx
width = 960
height = 480

<Scene title="MathText example" subtitle="Edit this focused MathText scene" padding={22} gap={18}>
  <Column
    gap={10}
    align='start'>
  <TextLabel
    text={MathText({ text: 'x_i^2 + y_i^2' })}
    fontSize={22} mono />
  <TextLabel
    text='MathText formats inline notation for labels.'
    fontSize={12} />
  </Column>
</Scene>
```

### SvgMathText

Positioned math overlay aligned with custom SVG geometry.

Props:
- `dominantBaseline`: `string` (optional)
- `fill`: `string` (required)
- `fontFamily`: `string` (optional)
- `fontSize`: `number` (optional)
- `fontWeight`: `number` (optional)
- `opacity`: `number` (optional)
- `text`: `string` (required)
- `textAnchor`: `"start" | "end" | "middle"` (optional; allowed values: `propEnums.values7`)
- `x`: `number` (required)
- `y`: `number` (required)

```tsx
width = 960
height = 480

<Scene title="SvgMathText example" subtitle="Edit this focused SvgMathText scene" padding={22} gap={18}>
  <div
    style={{ position: 'relative', display: 'flex', width: 420, height: 100 }}>
  <SvgMathText
    text='E = mc^2'
    x={20}
    y={62}
    fill={c.textPrimary}
    fontSize={34}
    textAnchor='start' />
  </div>
</Scene>
```

### Badge

Compact semantic SVG label.

Props:
- `c`: `ThemeColors` (required)
- `color`: `ColorName` (optional; allowed values: `propEnums.ColorName`)
- `label`: `string` (required)

```tsx
width = 960
height = 480

<Scene title="Badge example" subtitle="Edit this focused Badge scene" padding={22} gap={18}>
  <Row
    gap={12}
    align='center'>
  <Badge
    label='stable'
    color='positive' />
  <Badge
    label='preview'
    color='warning' />
  <Badge
    label='blocked'
    color='critical' />
  </Row>
</Scene>
```

### BadgePill

Inline status, category, or metadata label.

Props:
- `c`: `ThemeColors` (required)
- `filled`: `boolean` (optional; allowed values: `propEnums.values2`)
- `fontSize`: `number` (optional)
- `height`: `string | number` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `minWidth`: `string | number` (optional)
- `mono`: `boolean` (optional; allowed values: `propEnums.values2`)
- `padding`: `string | number` (optional)
- `radius`: `number` (optional)
- `text`: `React.ReactNode` (required)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="BadgePill example" subtitle="Edit this focused BadgePill scene" padding={22} gap={18}>
  <Row
    gap={10}
    align='center'>
  <BadgePill
    text='API'
    tone='blue' />
  <BadgePill
    text='HEALTHY'
    tone='green' />
  <BadgePill
    text='P95 82 ms'
    tone='purple' />
  </Row>
</Scene>
```

### GradientChip

Emphasized label with tone gradient.

Props:
- `align`: `"center" | "left"` (optional; allowed values: `propEnums.values8`)
- `c`: `ThemeColors` (required)
- `gradient`: `string` (optional)
- `height`: `string | number` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `minHeight`: `string | number` (optional)
- `minWidth`: `string | number` (optional)
- `padding`: `string | number` (optional)
- `radius`: `number` (optional)
- `shadow`: `boolean` (optional; allowed values: `propEnums.values2`)
- `subtitle`: `React.ReactNode` (optional)
- `subtitleMono`: `boolean` (optional; allowed values: `propEnums.values2`)
- `title`: `React.ReactNode` (required)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="GradientChip example" subtitle="Edit this focused GradientChip scene" padding={22} gap={18}>
  <GradientChip
    title='Verified output'
    subtitle='dark + light themes'
    tone='green'
    width={320}
    minHeight={92}
    align='center' />
</Scene>
```

### ValuePill

Small label-value pair.

Props:
- `c`: `ThemeColors` (required)
- `detail`: `React.ReactNode` (optional)
- `label`: `React.ReactNode` (required)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `value`: `React.ReactNode` (required)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="ValuePill example" subtitle="Edit this focused ValuePill scene" padding={22} gap={18}>
  <Row
    gap={14}>
  <ValuePill
    label='Batch size'
    value='128'
    detail='tokens / step'
    tone='purple'
    width={170} />
  <ValuePill
    label='Throughput'
    value='940'
    detail='items / second'
    tone='green'
    width={190} />
  </Row>
</Scene>
```

### EquationCard

Formula, result, and supporting detail.

Props:
- `align`: `"center" | "left"` (optional; allowed values: `propEnums.values8`)
- `c`: `ThemeColors` (required)
- `detail`: `React.ReactNode` (optional)
- `formula`: `React.ReactNode` (required)
- `height`: `string | number` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `result`: `React.ReactNode` (optional)
- `title`: `React.ReactNode` (required)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="EquationCard example" subtitle="Edit this focused EquationCard scene" padding={22} gap={18}>
  <EquationCard
    title='Throughput'
    formula='items ÷ seconds'
    result='940/s'
    detail='measured over 5 minutes'
    tone='purple'
    width={300} math />
</Scene>
```

### StepCard

Numbered or staged process card.

Props:
- `align`: `"center" | "left"` (optional; allowed values: `propEnums.values8`)
- `c`: `ThemeColors` (required)
- `eyebrow`: `React.ReactNode` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `minHeight`: `string | number` (optional)
- `minWidth`: `string | number` (optional)
- `padding`: `string | number` (optional)
- `radius`: `number` (optional)
- `shadow`: `boolean` (optional; allowed values: `propEnums.values2`)
- `subtitle`: `React.ReactNode` (optional)
- `title`: `React.ReactNode` (required)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="StepCard example" subtitle="Edit this focused StepCard scene" padding={22} gap={18}>
  <Row
    gap={14}>
  <StepCard
    eyebrow='01'
    title='Collect'
    subtitle='read source data'
    tone='blue'
    width={220} />
  <StepCard
    eyebrow='02'
    title='Validate'
    subtitle='check invariants'
    tone='purple'
    width={220} />
  <StepCard
    eyebrow='03'
    title='Publish'
    subtitle='write artifacts'
    tone='green'
    width={220} />
  </Row>
</Scene>
```

### MetricCard

KPI value with label and context.

Props:
- `align`: `"center" | "left"` (optional; allowed values: `propEnums.values8`)
- `c`: `ThemeColors` (required)
- `detail`: `React.ReactNode` (optional)
- `label`: `React.ReactNode` (required)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `minHeight`: `string | number` (optional)
- `minWidth`: `string | number` (optional)
- `padding`: `string | number` (optional)
- `radius`: `number` (optional)
- `shadow`: `boolean` (optional; allowed values: `propEnums.values2`)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `value`: `React.ReactNode` (required)
- `valueColor`: `string` (optional)
- `valueFontSize`: `number` (optional)
- `valueMono`: `boolean` (optional; allowed values: `propEnums.values2`)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="MetricCard example" subtitle="Edit this focused MetricCard scene" padding={22} gap={18}>
  <Row
    gap={14}>
  <MetricCard
    label='Build success'
    value='98.7%'
    detail='last 30 days'
    tone='green'
    width={220}
    minHeight={120} />
  <MetricCard
    label='Open issues'
    value='4'
    detail='2 need review'
    tone='warm'
    width={220}
    minHeight={120} />
  </Row>
</Scene>
```

### CalloutCard

Focused takeaway, warning, or recommendation.

Props:
- `align`: `"center" | "left"` (optional; allowed values: `propEnums.values8`)
- `c`: `ThemeColors` (required)
- `children`: `React.ReactNode` (optional)
- `detail`: `React.ReactNode` (optional)
- `detailFontSize`: `number` (optional)
- `filled`: `boolean` (optional; allowed values: `propEnums.values2`)
- `minHeight`: `string | number` (optional)
- `padding`: `string | number` (optional)
- `title`: `React.ReactNode` (optional)
- `titleFontSize`: `number` (optional)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="CalloutCard example" subtitle="Edit this focused CalloutCard scene" padding={22} gap={18}>
  <CalloutCard
    title='Recommendation'
    detail='Keep the source editable and verify both color themes before publishing.'
    tone='cyan'
    width={560}
    minHeight={132} />
</Scene>
```

### DetailList

Compact list of supporting facts.

Props:
- `c`: `ThemeColors` (required)
- `fontSize`: `number` (optional)
- `gap`: `number` (optional)
- `items`: `React.ReactNode[]` (required)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `mono`: `boolean` (optional; allowed values: `propEnums.values2`)
- `padding`: `string | number` (optional)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)

```tsx
width = 960
height = 480

<Scene title="DetailList example" subtitle="Edit this focused DetailList scene" padding={22} gap={18}>
  <DetailList
    tone='blue'
    items={['TypeScript source', 'Theme aware colors', 'PNG and SVG export']}
    fontSize={13} />
</Scene>
```

### CodeBlock

Code or command excerpt with optional line numbers.

Props:
- `background`: `string` (optional)
- `c`: `ThemeColors` (required)
- `fontSize`: `number` (optional)
- `lines`: `(React.ReactNode | CodeLineSpec)[]` (required)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `minWidth`: `string | number` (optional)
- `padding`: `string | number` (optional)
- `radius`: `number` (optional)
- `shadow`: `boolean` (optional; allowed values: `propEnums.values2`)
- `showLineNumbers`: `boolean` (optional; allowed values: `propEnums.values2`)
- `title`: `React.ReactNode` (optional)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="CodeBlock example" subtitle="Edit this focused CodeBlock scene" padding={22} gap={18}>
  <CodeBlock
    title='render.tsx'
    tone='purple'
    fontSize={13} showLineNumbers
    lines={[{ text: 'const frame = <Scene />', tone: 'purple' },
        { text: 'await render(frame)' },
        { text: 'writeFile(output)', tone: 'green' }]} />
</Scene>
```

### Comparison

Side-by-side alternatives or before/after states.

Props:
- `align`: `FlexAlign` (optional; allowed values: `propEnums.FlexAlign`)
- `c`: `ThemeColors` (required)
- `divider`: `React.ReactNode` (optional)
- `gap`: `number` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `minHeight`: `string | number` (optional)
- `sides`: `ComparisonSideSpec[]` (required)
- `sideWidth`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="Comparison example" subtitle="Edit this focused Comparison scene" padding={22} gap={18}>
  <Comparison divider
    gap={10}
    minHeight={150}
    sides={[{ title: 'Before', tone: 'warm', lines: ['manual spacing', 'one theme'] },
        { title: 'After', tone: 'green', lines: ['shared layout', 'dark + light'] }]} />
</Scene>
```

### KeyValueList

Aligned technical metadata rows.

Props:
- `c`: `ThemeColors` (required)
- `divider`: `boolean` (optional; allowed values: `propEnums.values2`)
- `fontSize`: `number` (optional)
- `gap`: `number` (optional)
- `keyMono`: `boolean` (optional; allowed values: `propEnums.values2`)
- `keyWidth`: `string | number` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `minWidth`: `string | number` (optional)
- `rows`: `KeyValueRow[]` (required)
- `title`: `React.ReactNode` (optional)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="KeyValueList example" subtitle="Edit this focused KeyValueList scene" padding={22} gap={18}>
  <KeyValueList
    title='Render settings'
    rows={[{ key: 'format', value: 'PNG + SVG', tone: 'blue' },
        { key: 'themes', value: 'dark, light', tone: 'green' },
        { key: 'latency', value: '42 ms' }]}
    width={430} />
</Scene>
```

### Tile

Single labeled unit for feature or system maps.

Props:
- `align`: `"center" | "left"` (optional; allowed values: `propEnums.values8`)
- `c`: `ThemeColors` (required)
- `children`: `React.ReactNode` (optional)
- `eyebrow`: `React.ReactNode` (optional)
- `icon`: `React.ReactNode` (optional)
- `lines`: `React.ReactNode[]` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `minHeight`: `string | number` (optional)
- `padding`: `string | number` (optional)
- `radius`: `number` (optional)
- `shadow`: `boolean` (optional; allowed values: `propEnums.values2`)
- `subtitle`: `React.ReactNode` (optional)
- `title`: `React.ReactNode` (required)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="Tile example" subtitle="Edit this focused Tile scene" padding={22} gap={18}>
  <Tile
    title='Search index'
    subtitle='retrieval service'
    eyebrow='READY'
    icon='⌕'
    tone='cyan'
    lines={['p95 18 ms', '3 replicas']}
    width={260}
    minHeight={128} />
</Scene>
```

### TileGrid

Dense grid of related labeled units.

Props:
- `align`: `"center" | "left"` (optional; allowed values: `propEnums.values8`)
- `c`: `ThemeColors` (required)
- `columns`: `number` (optional)
- `gap`: `number` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `minHeight`: `string | number` (optional)
- `tiles`: `TileSpec[]` (required)
- `tileWidth`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="TileGrid example" subtitle="Edit this focused TileGrid scene" padding={22} gap={18}>
  <TileGrid
    columns={3}
    gap={12}
    tileWidth={210}
    minHeight={112}
    tiles={[{ title: 'Ingest', subtitle: 'events', tone: 'blue' },
        { title: 'Transform', subtitle: 'schemas', tone: 'purple' },
        { title: 'Serve', subtitle: 'features', tone: 'green' }]} />
</Scene>
```

### Watermark

Frame metadata for text, image, or custom branding.

Props:
- `children`: `React.ReactNode` (optional)
- `color`: `string` (optional)
- `element`: `React.ReactNode` (optional)
- `icon`: `React.ReactNode` (optional)
- `image`: `string | WatermarkImageOptions` (optional)
- `opacity`: `number` (optional)
- `position`: `WatermarkPosition` (optional; allowed values: `propEnums.WatermarkPosition`)
- `text`: `string | false` (optional)

```tsx
width = 960
height = 480

<Scene title="Watermark example" subtitle="Edit this focused Watermark scene" padding={22} gap={18}>
  <Row
    width={680}
    height={300}
    align='center'
    justify='center'>{wrapWithWatermark(<Scene
    title='Published report'
    subtitle='Watermark stays anchored to the rendered frame'
    padding={22}>
  <MetricCard
    label='Verified runs'
    value='1,284'
    detail='this week'
    tone='green'
    width={250} />
  </Scene>, 640, 260, 'dark', <Watermark
    text='Vizmatic'
    color={c.textSecondary}
    opacity={0.9}
    position='bottom-right' />)}</Row>
</Scene>
```
## Flows



Processes, timelines, status, and progress.



### StatusRow

Single operational state with detail.

Props:
- `boxed`: `boolean` (optional; allowed values: `propEnums.values2`)
- `c`: `ThemeColors` (required)
- `detail`: `React.ReactNode` (optional)
- `fontSize`: `number` (optional)
- `label`: `React.ReactNode` (required)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `status`: `StatusKind` (optional; allowed values: `propEnums.StatusKind`)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="StatusRow example" subtitle="Edit this focused StatusRow scene" padding={22} gap={18}>
  <Column
    gap={10}
    width={620}
    align='stretch'>
  <StatusRow
    label='Build'
    detail='passed'
    status='check' />
  <StatusRow
    label='Review'
    detail='2 comments'
    status='pending' />
  <StatusRow
    label='Security'
    detail='attention'
    status='warn' />
  </Column>
</Scene>
```

### StatusList

Grouped checks, warnings, and pending work.

Props:
- `boxed`: `boolean` (optional; allowed values: `propEnums.values2`)
- `c`: `ThemeColors` (required)
- `fontSize`: `number` (optional)
- `gap`: `number` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `rows`: `StatusRowSpec[]` (required)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="StatusList example" subtitle="Edit this focused StatusList scene" padding={22} gap={18}>
  <StatusList
    width={620}
    rows={[{ label: 'Build', detail: 'passed', status: 'check' },
        { label: 'Review', detail: '2 comments', status: 'pending' },
        { label: 'Security', detail: 'attention', status: 'warn' }]} />
</Scene>
```

### Timeline

Ordered events in horizontal or vertical form.

Props:
- `c`: `ThemeColors` (required)
- `direction`: `"vertical" | "horizontal"` (optional; allowed values: `propEnums.values3`)
- `events`: `TimelineEventSpec[]` (required)
- `eventWidth`: `string | number` (optional)
- `gap`: `number` (optional)
- `markerSize`: `number` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `subtitle`: `React.ReactNode` (optional)
- `title`: `React.ReactNode` (optional)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="Timeline example" subtitle="Edit this focused Timeline scene" padding={22} gap={18}>
  <Timeline
    title='Release timeline'
    subtitle='Key steps from draft to publish'
    width={820}
    direction='horizontal'
    eventWidth={230}
    events={[{ time: '09:10', title: 'Draft', detail: 'write the scene', tone: 'blue' },
        { time: '09:24', title: 'Validate', detail: 'check layout', tone: 'purple' },
        { time: '09:31', title: 'Publish', detail: 'export assets', tone: 'green' }]} />
</Scene>
```

### Flow

Connected horizontal or vertical stages.

Props:
- `align`: `FlexAlign` (optional; allowed values: `propEnums.FlexAlign`)
- `c`: `ThemeColors` (required)
- `connectorLength`: `number` (optional)
- `connectorTone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `direction`: `"vertical" | "horizontal"` (optional; allowed values: `propEnums.values3`)
- `gap`: `number` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `stages`: `FlowStageSpec[]` (required)

```tsx
width = 960
height = 480

<Scene title="Flow example" subtitle="Edit this focused Flow scene" padding={22} gap={18}>
  <Flow
    gap={12}
    connectorLength={30}
    stages={[{ title: 'Request', subtitle: 'source data', tone: 'blue', width: 190 },
        { title: 'Transform', subtitle: 'build scene', tone: 'purple', width: 190 },
        { title: 'Deliver', subtitle: 'render files', tone: 'green', width: 190 }]} />
</Scene>
```

### Pipeline

Compact process pipeline with shared title.

Props:
- `c`: `ThemeColors` (required)
- `stages`: `PipelineStage[]` (required)
- `title`: `string` (optional)

```tsx
width = 960
height = 480

<Scene title="Pipeline example" subtitle="Edit this focused Pipeline scene" padding={22} gap={18}>
  <Pipeline
    title='Release pipeline'
    stages={[{ label: 'Build', sublabel: 'TSX', icon: '◇', color: 'secondary' },
        { label: 'Check', sublabel: 'themes', icon: '✓', color: 'info' },
        { label: 'Export', sublabel: 'PNG', icon: '↓', color: 'positive' }]} />
</Scene>
```

### ProgressRow

Labeled progress bar and value.

Props:
- `barHeight`: `number` (optional)
- `c`: `ThemeColors` (required)
- `fontSize`: `number` (optional)
- `label`: `React.ReactNode` (required)
- `labelWidth`: `number` (optional)
- `muted`: `boolean` (optional; allowed values: `propEnums.values2`)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)
- `value`: `number` (required)
- `valueLabel`: `React.ReactNode` (optional)
- `valueWidth`: `number` (optional)

```tsx
width = 960
height = 480

<Scene title="ProgressRow example" subtitle="Edit this focused ProgressRow scene" padding={22} gap={18}>
  <Column
    width={620}
    gap={14}
    align='stretch'>
  <ProgressRow
    label='Layout'
    value={0.96}
    valueLabel='96%'
    tone='green' />
  <ProgressRow
    label='Contrast'
    value={0.82}
    valueLabel='82%'
    tone='purple' />
  </Column>
</Scene>
```

### ProgressList

Comparable progress across several measures.

Props:
- `barHeight`: `number` (optional)
- `c`: `ThemeColors` (required)
- `fontSize`: `number` (optional)
- `gap`: `number` (optional)
- `labelWidth`: `number` (optional)
- `rows`: `ProgressRowSpec[]` (required)
- `valueWidth`: `number` (optional)

```tsx
width = 960
height = 480

<Scene title="ProgressList example" subtitle="Edit this focused ProgressList scene" padding={22} gap={18}>
  <ProgressList
    labelWidth={100}
    rows={[{ label: 'Layout', value: 0.96, tone: 'green' },
        { label: 'Contrast', value: 0.82, tone: 'purple' },
        { label: 'Labels', value: 1, tone: 'blue' }]} />
</Scene>
```
## Diagrams



Networks, system architecture, directed graphs, and hierarchies.



### LayeredNetwork

Layered neural network or staged DAG.

Props:
- `activePath`: `number[]` (optional)
- `annotations`: `string[]` (optional)
- `ariaLabel`: `string` (optional)
- `c`: `ThemeColors` (required)
- `formula`: `string` (optional)
- `height`: `number` (optional)
- `layers`: `LayeredNetworkLayer[]` (required)
- `legend`: `string` (optional)
- `nodeSize`: `number` (optional)
- `showFormula`: `boolean` (optional; allowed values: `propEnums.values2`)
- `width`: `number` (optional)

```tsx
width = 960
height = 560

<Scene title="LayeredNetwork example" subtitle="Edit this focused LayeredNetwork scene" padding={22} gap={18}>
  <LayeredNetwork
    width={820}
    height={360}
    layers={[{ title: 'Input', nodes: ['x₁', 'x₂', 'x₃'], tone: 'blue' },
        { title: 'Hidden', nodes: ['h₁', 'h₂', 'h₃'], tone: 'purple' },
        { title: 'Output', nodes: ['y'], tone: 'green' }]}
    activePath={[1, 0, 0]}
    formula='y = f(Wx + b)' />
</Scene>
```

### GraphDiagram

Auto-laid architecture graph with nested groups, icons, and semantic edges.

Props:
- `ariaLabel`: `string` (optional)
- `arrowSize`: `number` (optional)
- `c`: `ThemeColors` (required)
- `description`: `string` (optional)
- `detailFontSize`: `number` (optional)
- `direction`: `"LR" | "RL" | "TB" | "BT"` (optional; allowed values: `propEnums.values9`)
- `edgeGap`: `number` (optional)
- `edges`: `GraphDiagramEdge[]` (required)
- `groups`: `GraphDiagramGroup[]` (optional)
- `height`: `number` (optional)
- `iconSize`: `number` (optional)
- `id`: `string` (optional)
- `labelFontSize`: `number` (optional)
- `layout`: `"auto" | "manual"` (optional; allowed values: `propEnums.values10`)
- `nodeGap`: `number` (optional)
- `nodeHeight`: `number` (optional)
- `nodes`: `GraphDiagramNode[]` (required)
- `nodeWidth`: `number` (optional)
- `padding`: `number` (optional)
- `rankGap`: `number` (optional)
- `routing`: `GraphRouting` (optional; allowed values: `propEnums.GraphRouting`): Dagre retains existing routes. Orthogonal routes avoid node boxes and group headers.
- `routingClearance`: `number` (optional): Minimum node clearance in logical pixels for orthogonal routing.
- `sizing`: `"content" | "fixed"` (optional; allowed values: `propEnums.values11`)
- `title`: `string` (optional)
- `width`: `number` (optional)

```tsx
width = 960
height = 480

<Scene title="GraphDiagram example" subtitle="Edit this focused GraphDiagram scene" padding={22} gap={18}>
  <GraphDiagram
    width={820}
    height={360}
    routing='dagre'
    routingClearance={12}
    nodes={[{ id: 'api', label: 'API', tone: 'blue' },
        { id: 'queue', label: 'Queue', tone: 'purple' },
        { id: 'worker', label: 'Worker', tone: 'green' }]}
    edges={[{ from: 'api', to: 'queue', label: 'enqueue' },
        { from: 'queue', to: 'worker', label: 'consume' }]} />
</Scene>
```

### TreeDiagram

Auto-laid hierarchy, taxonomy, or decision tree.

Props:
- `ariaLabel`: `string` (optional)
- `c`: `ThemeColors` (required)
- `height`: `number` (optional)
- `levelGap`: `number` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `nodeHeight`: `number` (optional)
- `nodeWidth`: `number` (optional)
- `padding`: `number` (optional)
- `root`: `TreeNodeSpec` (required)
- `siblingGap`: `number` (optional)
- `subtitle`: `React.ReactNode` (optional)
- `title`: `React.ReactNode` (optional)
- `width`: `number` (optional)

```tsx
width = 960
height = 480

<Scene title="TreeDiagram example" subtitle="Edit this focused TreeDiagram scene" padding={22} gap={18}>
  <TreeDiagram
    width={820}
    height={340}
    root={{ id: 'root', label: 'Product', tone: 'purple', children: [{ id: 'api', label: 'API', tone: 'blue' },
        { id: 'web', label: 'Web app', tone: 'green' }] }} />
</Scene>
```
## Sequence



Time-ordered interactions, lifelines, activations, notes, and control fragments.



### SequenceDiagram

Typed participants, messages, notes, activations, and alt, loop, or parallel fragments.

Props:
- `activations`: `SequenceActivation[]` (optional)
- `ariaLabel`: `string` (optional)
- `c`: `ThemeColors` (required)
- `fragmentIndent`: `number` (optional)
- `fragments`: `SequenceFragment[]` (optional)
- `height`: `number` (optional)
- `items`: `SequenceItem[]` (optional): Ordered event input. When present, it is the source of row order.
- `lifelineDash`: `string` (optional)
- `messages`: `SequenceMessage[]` (optional)
- `notes`: `SequenceNote[]` (optional)
- `noteWidth`: `number` (optional)
- `padding`: `number` (optional)
- `participantGap`: `number` (optional)
- `participants`: `SequenceParticipant[]` (required)
- `participantWidth`: `number` (optional)
- `rowHeight`: `number` (optional)
- `subtitle`: `React.ReactNode` (optional)
- `title`: `React.ReactNode` (optional)
- `width`: `number` (optional)

```tsx
width = 960
height = 560

<Scene title="SequenceDiagram example" subtitle="Edit this focused SequenceDiagram scene" padding={22} gap={18}>
  <SequenceDiagram
    width={820}
    height={360}
    participants={[{ id: 'client', label: 'Client', kind: 'actor' },
        { id: 'api', label: 'API', kind: 'boundary' },
        { id: 'db', label: 'Database', kind: 'database' }]}
    messages={[{ id: 'request', from: 'client', to: 'api', kind: 'sync', label: 'GET /items' },
        { id: 'query', from: 'api', to: 'db', kind: 'sync', label: 'SELECT items' },
        { id: 'response', from: 'api', to: 'client', kind: 'return', label: '200 OK' }]} />
</Scene>
```
## Dataflow



Typed lineage across sources, transforms, stores, and sinks.



### DataflowDiagram

Schema-aware batch and streaming lineage compiled into a stable directed graph.

Props:
- `ariaLabel`: `string` (optional)
- `arrowSize`: `number` (optional)
- `boundaries`: `DataflowBoundary[]` (optional)
- `c`: `ThemeColors` (required)
- `description`: `string` (optional)
- `detailFontSize`: `number` (optional)
- `direction`: `"LR" | "RL" | "TB" | "BT" | undefined` (optional; allowed values: `propEnums.values9`)
- `edgeGap`: `number` (optional)
- `edges`: `DataflowEdge[]` (required)
- `height`: `number` (optional)
- `iconSize`: `number` (optional)
- `id`: `string` (optional)
- `labelFontSize`: `number` (optional)
- `nodeGap`: `number` (optional)
- `nodeHeight`: `number` (optional)
- `nodes`: `DataflowNode[]` (required)
- `nodeWidth`: `number` (optional)
- `padding`: `number` (optional)
- `rankGap`: `number` (optional)
- `routing`: `GraphRouting | undefined` (optional; allowed values: `propEnums.GraphRouting`)
- `routingClearance`: `number | undefined` (optional)
- `sizing`: `"content" | "fixed" | undefined` (optional; allowed values: `propEnums.values11`)
- `title`: `string` (optional)
- `width`: `number` (optional)

```tsx
width = 1040
height = 560

<Scene title="DataflowDiagram example" subtitle="Edit this focused DataflowDiagram scene" padding={22} gap={18}>
  <DataflowDiagram
    width={820}
    height={390}
    routing='dagre'
    routingClearance={12}
    direction='LR'
    nodes={[{ id: 'source', label: 'Events', kind: 'source', tone: 'blue', schema: 'Event.v1' },
        { id: 'transform', label: 'Validate', kind: 'transform', tone: 'purple' },
        { id: 'sink', label: 'Warehouse', kind: 'store', tone: 'green' }]}
    edges={[{ from: 'source', to: 'transform', mode: 'stream', label: 'Event.v1' },
        { from: 'transform', to: 'sink', mode: 'batch', label: 'Valid.v1' }]} />
</Scene>
```
## Deployment



Infrastructure boundaries, workloads, ports, protocols, and trust direction.



### DeploymentDiagram

Nested region, network, and runtime boundaries with typed network connections.

Props:
- `ariaLabel`: `string` (optional)
- `arrowSize`: `number` (optional)
- `boundaries`: `DeploymentBoundary[]` (optional)
- `c`: `ThemeColors` (required)
- `connections`: `DeploymentConnection[]` (optional)
- `description`: `string` (optional)
- `detailFontSize`: `number` (optional)
- `direction`: `"LR" | "RL" | "TB" | "BT"` (optional; allowed values: `propEnums.values9`)
- `edgeGap`: `number` (optional)
- `height`: `number` (optional)
- `iconSize`: `number` (optional)
- `id`: `string` (optional)
- `labelFontSize`: `number` (optional)
- `layout`: `"auto" | "manual"` (optional; allowed values: `propEnums.values10`)
- `nodeGap`: `number` (optional)
- `nodeHeight`: `number` (optional)
- `nodes`: `DeploymentNode[]` (required)
- `nodeWidth`: `number` (optional)
- `padding`: `number` (optional)
- `rankGap`: `number` (optional)
- `routing`: `GraphRouting` (optional; allowed values: `propEnums.GraphRouting`): Dagre retains existing routes. Orthogonal routes avoid node boxes and group headers.
- `routingClearance`: `number` (optional): Minimum node clearance in logical pixels for orthogonal routing.
- `sizing`: `"content" | "fixed"` (optional; allowed values: `propEnums.values11`)
- `title`: `string` (optional)
- `width`: `number` (optional)

```tsx
width = 1040
height = 560

<Scene title="DeploymentDiagram example" subtitle="Edit this focused DeploymentDiagram scene" padding={22} gap={18}>
  <DeploymentDiagram
    width={820}
    height={390}
    routing='dagre'
    routingClearance={12}
    direction='LR'
    boundaries={[{ id: 'region', label: 'us-east-1', kind: 'region', tone: 'blue' },
        { id: 'private', label: 'private subnet', kind: 'subnet', parent: 'region', tone: 'purple' }]}
    nodes={[{ id: 'edge', label: 'Gateway', kind: 'gateway', tone: 'cyan' },
        { id: 'api', label: 'API', kind: 'service', boundary: 'private', tone: 'green' }]}
    connections={[{ id: 'https', from: 'edge', to: 'api', kind: 'cross-boundary', protocol: 'HTTPS', label: 'HTTPS/443' }]} />
</Scene>
```
## ML topology



Transformer blocks, tensor shapes, repeated layers, and distributed routes.



### TransformerTopology

Transformer computation topology with tensor metadata and collective routes.

Props:
- `ariaLabel`: `string` (optional)
- `arrowSize`: `number` (optional)
- `blocks`: `TransformerBlock[]` (required)
- `c`: `ThemeColors` (required)
- `description`: `string` (optional)
- `detailFontSize`: `number` (optional)
- `direction`: `"LR" | "RL" | "TB" | "BT"` (optional; allowed values: `propEnums.values9`)
- `edgeGap`: `number` (optional)
- `expandRepeats`: `boolean` (optional; allowed values: `propEnums.values2`): Expand repeat counts into individually addressable graph nodes.
- `height`: `number` (optional)
- `iconSize`: `number` (optional)
- `id`: `string` (optional)
- `labelFontSize`: `number` (optional)
- `layout`: `"auto" | "manual"` (optional; allowed values: `propEnums.values10`)
- `nodeGap`: `number` (optional)
- `nodeHeight`: `number` (optional)
- `nodeWidth`: `number` (optional)
- `padding`: `number` (optional)
- `rankGap`: `number` (optional)
- `routes`: `TransformerRoute[]` (optional)
- `routing`: `GraphRouting` (optional; allowed values: `propEnums.GraphRouting`): Dagre retains existing routes. Orthogonal routes avoid node boxes and group headers.
- `routingClearance`: `number` (optional): Minimum node clearance in logical pixels for orthogonal routing.
- `sizing`: `"content" | "fixed"` (optional; allowed values: `propEnums.values11`)
- `title`: `string` (optional)
- `width`: `number` (optional)

```tsx
width = 1040
height = 560

<Scene title="TransformerTopology example" subtitle="Edit this focused TransformerTopology scene" padding={22} gap={18}>
  <TransformerTopology
    width={820}
    height={390}
    routing='dagre'
    routingClearance={12}
    direction='LR'
    blocks={[{ id: 'embed', label: 'Embed', kind: 'embedding', outputShape: { dims: ['B', 'T', 'd'], dtype: 'bf16' } },
        { id: 'attn', label: 'Attention', kind: 'attention', shape: { dims: ['B', 'T', 'd'], dtype: 'bf16' } },
        { id: 'logits', label: 'Logits', kind: 'output', outputShape: { dims: ['B', 'T', 'V'], dtype: 'bf16' } }]}
    routes={[{ id: 'hidden', from: 'embed', to: 'attn', kind: 'activation', label: 'hidden state' },
        { id: 'scores', from: 'attn', to: 'logits', kind: 'activation', label: 'scores' }]} />
</Scene>
```
## Data



Tables, grids, matrices, and compact distributions.



### Matrix

Numeric or symbolic matrix with headers.

Props:
- `c`: `ThemeColors` (required)
- `cellHeight`: `number` (optional)
- `cellSize`: `number` (optional)
- `cellWidth`: `number` (optional)
- `colLabels`: `string[]` (optional)
- `colorize`: `boolean` (optional; allowed values: `propEnums.values2`)
- `colorScale`: `"heat" | "strength"` (optional; allowed values: `propEnums.values12`)
- `data`: `number[][]` (required)
- `format`: `"decimal" | "percent" | "integer"` (optional; allowed values: `propEnums.values13`)
- `labels`: `React.ReactNode[][]` (optional)
- `rowLabels`: `string[]` (optional)
- `rowLabelWidth`: `number` (optional)
- `title`: `string` (optional)

```tsx
width = 960
height = 480

<Scene title="Matrix example" subtitle="Edit this focused Matrix scene" padding={22} gap={18}>
  <Matrix
    title='Attention weights'
    rowLabels={['q₁', 'q₂', 'q₃']}
    colLabels={['k₁', 'k₂', 'k₃']}
    data={[[0.82, 0.14, 0.04],
        [0.18, 0.66, 0.16],
        [0.06, 0.21, 0.73]]}
    cellWidth={58}
    cellHeight={42}
    rowLabelWidth={34} />
</Scene>
```

### Heatmap

Color-scaled matrix for intensity and correlation.

Props:
- `c`: `ThemeColors` (required)
- `cellHeight`: `number` (optional)
- `cellSize`: `number` (optional)
- `cellWidth`: `number` (optional)
- `colorScale`: `"heat" | "strength"` (optional; allowed values: `propEnums.values12`)
- `data`: `number[][]` (required)
- `labels`: `React.ReactNode[][]` (optional)
- `rowLabelWidth`: `number` (optional)
- `title`: `string` (optional)
- `xLabels`: `string[]` (required)
- `yLabels`: `string[]` (required)

```tsx
width = 960
height = 480

<Scene title="Heatmap example" subtitle="Edit this focused Heatmap scene" padding={22} gap={18}>
  <Heatmap
    title='Similarity'
    xLabels={['api', 'docs', 'sdk']}
    yLabels={['setup', 'auth', 'tests']}
    data={[[0.92, 0.4, 0.2],
        [0.3, 0.86, 0.55],
        [0.18, 0.52, 0.95]]}
    cellWidth={62}
    cellHeight={42}
    rowLabelWidth={48}
    colorScale='strength' />
</Scene>
```

### TiledMatrix

Matrix with named regions and boundaries.

Props:
- `ariaLabel`: `string` (optional)
- `c`: `ThemeColors` (required)
- `cellSize`: `number` (optional)
- `cols`: `number` (required)
- `crossedOut`: `boolean` (optional; allowed values: `propEnums.values2`)
- `gap`: `number` (optional)
- `muted`: `boolean` (optional; allowed values: `propEnums.values2`)
- `regions`: `TiledMatrixRegion[]` (optional)
- `rows`: `number` (required)
- `subtitle`: `React.ReactNode` (optional)
- `title`: `React.ReactNode` (optional)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)

```tsx
width = 960
height = 480

<Scene title="TiledMatrix example" subtitle="Edit this focused TiledMatrix scene" padding={22} gap={18}>
  <TiledMatrix
    title='Block sparse attention'
    subtitle='Named regions within one matrix'
    rows={8}
    cols={10}
    cellSize={25}
    gap={3}
    tone='cyan'
    regions={[{ rowStart: 0, rowEnd: 4, colStart: 0, colEnd: 4, tone: 'purple' },
        { rowStart: 4, rowEnd: 8, colStart: 4, colEnd: 10, tone: 'green' }]} />
</Scene>
```

### DataTable

Structured rows and columns with headers.

Props:
- `c`: `ThemeColors` (required)
- `cellHeight`: `number` (optional)
- `cellWidth`: `number` (optional)
- `firstColWidth`: `number` (optional)
- `fontSize`: `number` (optional)
- `gap`: `number` (optional)
- `headerCols`: `number` (optional)
- `headerRows`: `number` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `rows`: `React.ReactNode[][]` (required)

```tsx
width = 960
height = 480

<Scene title="DataTable example" subtitle="Edit this focused DataTable scene" padding={22} gap={18}>
  <DataTable
    cellWidth={94}
    firstColWidth={120}
    cellHeight={34}
    rows={[[ 'Service', 'p95', 'State' ],
        [ 'API', '82 ms', 'ready' ],
        [ 'Worker', '140 ms', 'ready' ]]} />
</Scene>
```

### Grid

General labeled cell grid.

Props:
- `c`: `ThemeColors` (required)
- `cellHeight`: `number` (optional)
- `cellWidth`: `number` (optional)
- `fontSize`: `number` (optional)
- `gap`: `number` (optional)
- `headerCols`: `number` (optional)
- `headerRows`: `number` (optional)
- `math`: `boolean` (optional; allowed values: `propEnums.values2`)
- `radius`: `number` (optional)
- `rows`: `(React.ReactNode | GridCell)[][]` (required)

```tsx
width = 960
height = 480

<Scene title="Grid example" subtitle="Edit this focused Grid scene" padding={22} gap={18}>
  <Grid
    cellWidth={72}
    cellHeight={42}
    headerRows={1}
    headerCols={1}
    rows={[[ 'Region', 'US', 'EU' ],
        [ 'API',
        { label: 'ready', tone: 'green' },
        { label: 'watch', tone: 'warm' } ],
        [ 'Queue',
        { label: 'ready', tone: 'green' },
        { label: 'ready', tone: 'green' }]]} />
</Scene>
```

### MiniBarChart

Compact categorical bars for dense layouts.

Props:
- `barWidth`: `number` (optional)
- `c`: `ThemeColors` (required)
- `data`: `MiniBarDatum[]` (required)
- `fontSize`: `number` (optional)
- `gap`: `number` (optional)
- `height`: `number` (optional)
- `max`: `number` (optional)
- `minBarHeight`: `number` (optional)
- `radius`: `number` (optional)
- `showValues`: `boolean` (optional; allowed values: `propEnums.values2`)

```tsx
width = 960
height = 480

<Scene title="MiniBarChart example" subtitle="Edit this focused MiniBarChart scene" padding={22} gap={18}>
  <MiniBarChart
    height={170}
    barWidth={48}
    gap={18} showValues
    data={[{ label: 'plan', value: 74, tone: 'blue' },
        { label: 'build', value: 92, tone: 'purple' },
        { label: 'check', value: 86, tone: 'cyan' },
        { label: 'ship', value: 98, tone: 'green' }]} />
</Scene>
```
## Charts



Common comparisons, trends, distributions, and analytical plots.



### ChartFrame

Shared chart title, subtitle, legend, and footer.

Props:
- `c`: `ThemeColors` (required)
- `children`: `React.ReactNode` (required)
- `footer`: `string` (optional)
- `height`: `string | number` (optional)
- `legend`: `ChartLegendItem[]` (optional)
- `padding`: `number` (optional)
- `subtitle`: `string` (optional)
- `title`: `string` (optional)
- `width`: `string | number` (optional)

```tsx
width = 960
height = 480

<Scene title="ChartFrame example" subtitle="Edit this focused ChartFrame scene" padding={22} gap={18}>
  <ChartFrame
    title='Weekly quality'
    subtitle='A reusable title, legend, and footer'
    width={680}
    footer='Source: evaluation runs'>
  <BarChart
    width={620}
    height={220}
    data={[{ label: 'Mon', value: 0.72, color: 'secondary' },
        { label: 'Wed', value: 0.84, color: 'primary' },
        { label: 'Fri', value: 0.96, color: 'positive' }]}
    format='percent' />
  </ChartFrame>
</Scene>
```

### DonutChart

Part-to-whole composition with center label.

Props:
- `c`: `ThemeColors` (required)
- `centerLabel`: `React.ReactNode` (optional)
- `centerValue`: `React.ReactNode` (optional)
- `footer`: `string` (optional)
- `format`: `ChartValueFormat` (optional; literal presets: `propEnums.ChartValueFormat` (other non-literal variants remain TSX-only))
- `height`: `number` (optional)
- `segments`: `DonutChartSegment[]` (required)
- `showLegend`: `boolean` (optional; allowed values: `propEnums.values2`)
- `size`: `number` (optional)
- `subtitle`: `string` (optional)
- `thickness`: `number` (optional)
- `title`: `string` (optional)
- `width`: `number` (optional)

```tsx
width = 960
height = 480

<Scene title="DonutChart example" subtitle="Edit this focused DonutChart scene" padding={22} gap={18}>
  <DonutChart
    title='Evaluation results'
    subtitle='Share by outcome'
    width={420}
    height={280}
    size={190}
    thickness={34}
    centerValue='92%'
    centerLabel='passed'
    segments={[{ label: 'Passed', value: 0.72, color: 'positive' },
        { label: 'Review', value: 0.2, color: 'secondary' },
        { label: 'Failed', value: 0.08, color: 'critical' }]} />
</Scene>
```

### PieChart

Part-to-whole composition with a full circular radius.

Props:
- `c`: `ThemeColors` (required)
- `footer`: `string` (optional)
- `format`: `ChartValueFormat` (optional; literal presets: `propEnums.ChartValueFormat` (other non-literal variants remain TSX-only))
- `height`: `number` (optional)
- `segments`: `DonutChartSegment[]` (required)
- `showLegend`: `boolean` (optional; allowed values: `propEnums.values2`)
- `size`: `number` (optional)
- `subtitle`: `string` (optional)
- `title`: `string` (optional)
- `width`: `number` (optional)

```tsx
width = 960
height = 640

<Scene title="PieChart example" subtitle="Edit this focused PieChart scene" padding={22} gap={18}>
  <PieChart
    title='Requests by outcome'
    subtitle='Relative share of completed requests'
    width={500}
    height={300}
    segments={[{ label: 'Successful', value: 68, color: 'positive' },
        { label: 'Retried', value: 22, color: 'warning' },
        { label: 'Failed', value: 10, color: 'critical' }]} />
</Scene>
```

### StackedBar

Part-to-whole values along one dimension.

Props:
- `c`: `ThemeColors` (required)
- `height`: `number` (optional)
- `segments`: `StackedBarSegment[]` (required)
- `showLegend`: `boolean` (optional; allowed values: `propEnums.values2`)
- `subtitle`: `string` (optional)
- `title`: `string` (optional)
- `width`: `number` (optional)

```tsx
width = 960
height = 480

<Scene title="StackedBar example" subtitle="Edit this focused StackedBar scene" padding={22} gap={18}>
  <StackedBar
    title='Requests by outcome'
    subtitle='Share of total traffic'
    width={720}
    height={80}
    segments={[{ label: 'Success', value: 68, color: 'positive' },
        { label: 'Retry', value: 22, color: 'warning' },
        { label: 'Error', value: 10, color: 'critical' }]} />
</Scene>
```

### BarChart

Categorical comparison with labels and values.

Props:
- `c`: `ThemeColors` (required)
- `data`: `BarChartDatum[]` (required)
- `footer`: `string` (optional)
- `format`: `ChartValueFormat` (optional; literal presets: `propEnums.ChartValueFormat` (other non-literal variants remain TSX-only))
- `height`: `number` (optional)
- `max`: `number` (optional)
- `min`: `number` (optional)
- `showGrid`: `boolean` (optional; allowed values: `propEnums.values2`)
- `showValues`: `boolean` (optional; allowed values: `propEnums.values2`)
- `subtitle`: `string` (optional)
- `title`: `string` (optional)
- `width`: `number` (optional)
- `yAxisLabel`: `string` (optional)

```tsx
width = 960
height = 640

<Scene title="BarChart example" subtitle="Edit this focused BarChart scene" padding={22} gap={18}>
  <BarChart
    title='Pass rate'
    subtitle='By validation stage'
    width={760}
    height={340}
    format='percent'
    yAxisLabel='success'
    data={[{ label: 'Build', value: 0.82, color: 'secondary' },
        { label: 'Layout', value: 0.91, color: 'primary' },
        { label: 'Contrast', value: 0.98, color: 'positive' }]} />
</Scene>
```

### LineChart

One or more trends across an ordered axis.

Props:
- `c`: `ThemeColors` (required)
- `footer`: `string` (optional)
- `format`: `ChartValueFormat` (optional; literal presets: `propEnums.ChartValueFormat` (other non-literal variants remain TSX-only))
- `height`: `number` (optional)
- `labels`: `string[]` (optional)
- `max`: `number` (optional)
- `min`: `number` (optional)
- `series`: `LineChartSeries[]` (required)
- `showGrid`: `boolean` (optional; allowed values: `propEnums.values2`)
- `showPoints`: `boolean` (optional; allowed values: `propEnums.values2`)
- `subtitle`: `string` (optional)
- `title`: `string` (optional)
- `width`: `number` (optional)
- `yAxisLabel`: `string` (optional)

```tsx
width = 960
height = 640

<Scene title="LineChart example" subtitle="Edit this focused LineChart scene" padding={22} gap={18}>
  <LineChart
    title='Quality over time'
    subtitle='Two runs per release'
    width={760}
    height={340}
    labels={['r1', 'r2', 'r3', 'r4']}
    yAxisLabel='score'
    format='percent'
    series={[{ name: 'Quality', points: [0.62, 0.7, 0.81, 0.93], color: 'positive' },
        { name: 'Coverage', points: [0.48, 0.61, 0.72, 0.84], color: 'primary' }]} />
</Scene>
```

### ScatterPlot

Point distribution across two numeric axes.

Props:
- `c`: `ThemeColors` (required)
- `footer`: `string` (optional)
- `formatX`: `ChartValueFormat` (optional; literal presets: `propEnums.ChartValueFormat` (other non-literal variants remain TSX-only))
- `formatY`: `ChartValueFormat` (optional; literal presets: `propEnums.ChartValueFormat` (other non-literal variants remain TSX-only))
- `height`: `number` (optional)
- `points`: `ScatterPoint[]` (required)
- `showGrid`: `boolean` (optional; allowed values: `propEnums.values2`)
- `subtitle`: `string` (optional)
- `title`: `string` (optional)
- `width`: `number` (optional)
- `xAxisLabel`: `string` (optional)
- `xMax`: `number` (optional)
- `xMin`: `number` (optional)
- `yAxisLabel`: `string` (optional)
- `yMax`: `number` (optional)
- `yMin`: `number` (optional)

```tsx
width = 960
height = 640

<Scene title="ScatterPlot example" subtitle="Edit this focused ScatterPlot scene" padding={22} gap={18}>
  <ScatterPlot
    title='Cost vs. quality'
    subtitle='Choose the right operating point'
    width={760}
    height={340}
    xMin={0}
    xMax={10}
    yMin={0}
    yMax={10}
    xAxisLabel='cost'
    yAxisLabel='quality'
    points={[{ x: 2, y: 6.8, label: 'fast', color: 'secondary' },
        { x: 4.8, y: 8.1, label: 'balanced', color: 'positive' },
        { x: 8, y: 9.2, label: 'deep', color: 'primary' }]} />
</Scene>
```

### ParetoBarChart

Descending category counts with a cumulative percentage line.

Props:
- `c`: `ThemeColors` (required)
- `data`: `BarChartDatum[]` (required)
- `footer`: `string` (optional)
- `format`: `ChartValueFormat` (optional; literal presets: `propEnums.ChartValueFormat` (other non-literal variants remain TSX-only))
- `height`: `number` (optional)
- `showGrid`: `boolean` (optional; allowed values: `propEnums.values2`)
- `showValues`: `boolean` (optional; allowed values: `propEnums.values2`)
- `subtitle`: `string` (optional)
- `title`: `string` (optional)
- `width`: `number` (optional)

```tsx
width = 960
height = 640

<Scene title="ParetoBarChart example" subtitle="Edit this focused ParetoBarChart scene" padding={22} gap={18}>
  <ParetoBarChart
    title='Support issues'
    subtitle='Sorted counts with cumulative share'
    width={760}
    height={340}
    data={[{ label: 'Setup', value: 42, color: 'primary' },
        { label: 'Auth', value: 28, color: 'secondary' },
        { label: 'Latency', value: 18, color: 'warning' },
        { label: 'Other', value: 12, color: 'neutral' }]} />
</Scene>
```

### ParetoChart

Automatic non-dominated frontier across competing numeric objectives.

Props:
- `c`: `ThemeColors` (required)
- `footer`: `string` (optional)
- `formatX`: `ChartValueFormat` (optional; literal presets: `propEnums.ChartValueFormat` (other non-literal variants remain TSX-only))
- `formatY`: `ChartValueFormat` (optional; literal presets: `propEnums.ChartValueFormat` (other non-literal variants remain TSX-only))
- `frontierColor`: `string` (optional)
- `goalLabel`: `string` (optional)
- `height`: `number` (optional)
- `points`: `ScatterPoint[]` (required)
- `showGoal`: `boolean` (optional; allowed values: `propEnums.values2`)
- `showGrid`: `boolean` (optional; allowed values: `propEnums.values2`)
- `subtitle`: `string` (optional)
- `title`: `string` (optional)
- `width`: `number` (optional)
- `xAxisLabel`: `string` (optional)
- `xMax`: `number` (optional)
- `xMin`: `number` (optional)
- `xObjective`: `ParetoObjective` (optional; allowed values: `propEnums.ParetoObjective`)
- `xScale`: `ParetoXScale` (optional; allowed values: `propEnums.ParetoXScale`)
- `yAxisLabel`: `string` (optional)
- `yMax`: `number` (optional)
- `yMin`: `number` (optional)
- `yObjective`: `ParetoObjective` (optional; allowed values: `propEnums.ParetoObjective`)

```tsx
width = 960
height = 640

<Scene title="ParetoChart example" subtitle="Edit this focused ParetoChart scene" padding={22} gap={18}>
  <ParetoChart
    title='Quality frontier'
    subtitle='Higher quality at lower cost'
    width={760}
    height={340}
    xMin={0}
    xMax={10}
    yMin={0}
    yMax={10}
    xAxisLabel='cost'
    points={[{ x: 1.2, y: 4, label: 'fast', color: 'info' },
        { x: 3.8, y: 6.8, label: 'balanced', color: 'positive' },
        { x: 7, y: 9.1, label: 'deep', color: 'primary' },
        { x: 8.4, y: 7.3, label: 'dominated', color: 'warning' }]}
    frontierColor='positive'
    goalLabel='higher quality · lower cost' />
</Scene>
```

### QuadrantChart

Numeric decision map split by configurable policy thresholds.

Props:
- `c`: `ThemeColors` (required)
- `footer`: `string` (optional)
- `formatX`: `ChartValueFormat` (optional; literal presets: `propEnums.ChartValueFormat` (other non-literal variants remain TSX-only))
- `formatY`: `ChartValueFormat` (optional; literal presets: `propEnums.ChartValueFormat` (other non-literal variants remain TSX-only))
- `height`: `number` (optional)
- `points`: `ScatterPoint[]` (required)
- `regions`: `{ topLeft: QuadrantRegion; topRight: QuadrantRegion; bottomLeft: QuadrantRegion; bottomRight: QuadrantRegion; }` (required)
- `showGrid`: `boolean` (optional; allowed values: `propEnums.values2`)
- `showTicks`: `boolean` (optional; allowed values: `propEnums.values2`)
- `subtitle`: `string` (optional)
- `title`: `string` (optional)
- `width`: `number` (optional)
- `xAxisLabel`: `string` (optional)
- `xMax`: `number` (optional)
- `xMin`: `number` (optional)
- `xThreshold`: `number` (optional)
- `yAxisLabel`: `string` (optional)
- `yMax`: `number` (optional)
- `yMin`: `number` (optional)
- `yThreshold`: `number` (optional)

```tsx
width = 960
height = 640

<Scene title="QuadrantChart example" subtitle="Edit this focused QuadrantChart scene" padding={22} gap={18}>
  <QuadrantChart
    title='Prioritization map'
    subtitle='Effort vs. user value'
    width={760}
    height={360}
    xAxisLabel='effort'
    yAxisLabel='user value'
    regions={{ topLeft: { label: 'Quick wins', color: 'positive', emphasis: true }, topRight: { label: 'Big bets', color: 'primary' }, bottomLeft: { label: 'Defer', color: 'neutral' }, bottomRight: { label: 'Avoid', color: 'warning' } }}
    points={[{ x: 0.24, y: 0.8, label: 'A', color: 'positive' },
        { x: 0.75, y: 0.7, label: 'B', color: 'primary' },
        { x: 0.34, y: 0.25, label: 'C', color: 'neutral' }]} />
</Scene>
```

### IntervalPlot

Low, midpoint, and high ranges by category.

Props:
- `axisLabel`: `string` (optional)
- `c`: `ThemeColors` (required)
- `data`: `IntervalDatum[]` (required)
- `footer`: `string` (optional)
- `format`: `ChartValueFormat` (optional; literal presets: `propEnums.ChartValueFormat` (other non-literal variants remain TSX-only))
- `height`: `number` (optional)
- `max`: `number` (optional)
- `min`: `number` (optional)
- `subtitle`: `string` (optional)
- `title`: `string` (optional)
- `width`: `number` (optional)

```tsx
width = 960
height = 640

<Scene title="IntervalPlot example" subtitle="Edit this focused IntervalPlot scene" padding={22} gap={18}>
  <IntervalPlot
    title='Latency ranges'
    subtitle='Low, median, and high values'
    width={760}
    height={340}
    min={0}
    max={100}
    axisLabel='milliseconds'
    format='integer'
    data={[{ label: 'API', low: 18, mid: 32, high: 46, color: 'secondary' },
        { label: 'Worker', low: 34, mid: 51, high: 78, color: 'primary' }]} />
</Scene>
```

### Legend

Reusable color key for charts and diagrams.

Props:
- `c`: `ThemeColors` (required)
- `items`: `LegendItem[]` (required)
- `title`: `string` (optional)

```tsx
width = 960
height = 480

<Scene title="Legend example" subtitle="Edit this focused Legend scene" padding={22} gap={18}>
  <Legend
    title='Result types'
    items={[{ label: 'Success', color: 'positive' },
        { label: 'Queued', color: 'warning' },
        { label: 'Blocked', color: c.critical, style: 'dashed' }]} />
</Scene>
```
## Drawing



Low-level SVG geometry for custom technical figures.



### Box

Rounded SVG box with label and tone.

Props:
- `c`: `ThemeColors` (required)
- `color`: `ColorName` (optional; allowed values: `propEnums.ColorName`)
- `fontSize`: `number` (optional)
- `gradient`: `boolean` (optional; allowed values: `propEnums.values2`): Use gradient background instead of solid
- `height`: `number` (optional)
- `icon`: `string` (optional): Optional icon/emoji before label
- `label`: `string` (required)
- `outlined`: `boolean` (optional; allowed values: `propEnums.values2`): Outlined style instead of filled
- `radius`: `number` (optional): Border radius
- `sublabel`: `string` (optional): Optional sub-label below main label
- `width`: `number` (optional)

```tsx
width = 960
height = 480

<Scene title="Box example" subtitle="Edit this focused Box scene" padding={22} gap={18}>
  <Row
    gap={14}
    align='center'>
  <Box
    label='Input'
    sublabel='request'
    color='primary' gradient
    width={180}
    height={100} />
  <Arrow
    direction='right'
    length={50} />
  <Box
    label='Output'
    sublabel='result'
    color='positive'
    width={180}
    height={100} />
  </Row>
</Scene>
```

### Arrow

Straight labeled SVG arrow.

Props:
- `c`: `ThemeColors` (required)
- `color`: `string` (optional)
- `direction`: `"left" | "right" | "down" | "up"` (optional; allowed values: `propEnums.values14`)
- `label`: `string` (optional)
- `length`: `number` (optional)

```tsx
width = 960
height = 480

<Scene title="Arrow example" subtitle="Edit this focused Arrow scene" padding={22} gap={18}>
  <Arrow
    direction='right'
    label='request'
    length={220}
    color={c.infoLight} />
</Scene>
```

### ArrowMarkerDef

Reusable SVG arrowhead definition.

Props:
- `color`: `string` (required)
- `id`: `string` (required)
- `size`: `number` (optional)

```tsx
width = 960
height = 480

<Scene title="ArrowMarkerDef example" subtitle="Edit this focused ArrowMarkerDef scene" padding={22} gap={18}>
  <Column
    gap={8}
    align='center'>
  <svg
    width='460'
    height='170'
    viewBox='0 0 460 170'>
  <defs>
  <ArrowMarkerDef
    id='catalog-arrow'
    color={c.infoLight}
    size={8} />
  </defs>
  <path
    d='M 42 85 C 140 8 280 162 410 85'
    fill='none'
    stroke={c.infoLight}
    strokeWidth={4}
    markerEnd='url(#catalog-arrow)' />
  </svg>
  <TextLabel
    text='Reusable SVG arrow marker'
    fontSize={14} />
  </Column>
</Scene>
```

### FlowArrow

Straight directional connector with label and tone.

Props:
- `c`: `ThemeColors` (required)
- `color`: `string` (optional)
- `direction`: `"left" | "right" | "down" | "up"` (optional; allowed values: `propEnums.values14`)
- `label`: `string` (optional)
- `length`: `number` (optional)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)

```tsx
width = 960
height = 480

<Scene title="FlowArrow example" subtitle="Edit this focused FlowArrow scene" padding={22} gap={18}>
  <FlowArrow
    direction='right'
    label='verified result'
    length={240}
    tone='green' />
</Scene>
```

### Connector

Alias for flow connectors in diagram code.

Props:
- `c`: `ThemeColors` (required)
- `color`: `string` (optional)
- `direction`: `"left" | "right" | "down" | "up"` (optional; allowed values: `propEnums.values14`)
- `label`: `string` (optional)
- `length`: `number` (optional)
- `tone`: `ToneName` (optional; allowed values: `propEnums.ToneName`)

```tsx
width = 960
height = 480

<Scene title="Connector example" subtitle="Edit this focused Connector scene" padding={22} gap={18}>
  <Connector
    direction='right'
    label='dependency'
    length={240}
    tone='purple' />
</Scene>
```

### VectorArrow

Vector with optional endpoints and arrowhead.

Props:
- `arrowSize`: `number` (optional)
- `color`: `string` (required)
- `key`: `React.Key` (optional)
- `opacity`: `number` (optional)
- `strokeWidth`: `number` (optional)
- `x1`: `number` (required)
- `x2`: `number` (required)
- `y1`: `number` (required)
- `y2`: `number` (required)

```tsx
width = 960
height = 480

<Scene title="VectorArrow example" subtitle="Edit this focused VectorArrow scene" padding={22} gap={18}>
  <Column
    gap={8}
    align='center'>
  <svg
    width='460'
    height='180'
    viewBox='0 0 460 180'>
  <VectorArrow
    x1={64}
    y1={140}
    x2={390}
    y2={38}
    color={c.positiveLight}
    strokeWidth={5} />
  <SvgPoint
    cx={64}
    cy={140}
    r={8}
    fill={c.positiveLight} />
  </svg>
  <TextLabel
    text='Vector with arrowhead'
    fontSize={15} />
  </Column>
</Scene>
```

### VectorSegment

Line segment for geometric constructions.

Props:
- `color`: `string` (required)
- `dotRadius`: `number` (optional)
- `key`: `React.Key` (optional)
- `opacity`: `number` (optional)
- `showEndDot`: `boolean` (optional; allowed values: `propEnums.values2`)
- `showStartDot`: `boolean` (optional; allowed values: `propEnums.values2`)
- `strokeWidth`: `number` (optional)
- `x1`: `number` (required)
- `x2`: `number` (required)
- `y1`: `number` (required)
- `y2`: `number` (required)

```tsx
width = 960
height = 480

<Scene title="VectorSegment example" subtitle="Edit this focused VectorSegment scene" padding={22} gap={18}>
  <Column
    gap={8}
    align='center'>
  <svg
    width='460'
    height='180'
    viewBox='0 0 460 180'>
  <VectorSegment
    x1={64}
    y1={130}
    x2={396}
    y2={54}
    color={c.secondaryLight}
    strokeWidth={5} showStartDot showEndDot />
  </svg>
  <TextLabel
    text='Segment with endpoint dots'
    fontSize={15} />
  </Column>
</Scene>
```

### SvgFrame

SVG plotting frame with border and fill.

Props:
- `c`: `ThemeColors` (required)
- `fill`: `string` (optional)
- `height`: `number` (required)
- `key`: `React.Key` (optional)
- `opacity`: `number` (optional)
- `rx`: `number` (optional)
- `stroke`: `string` (optional)
- `strokeWidth`: `number` (optional)
- `width`: `number` (required)
- `x`: `number` (optional)
- `y`: `number` (optional)

```tsx
width = 960
height = 480

<Scene title="SvgFrame example" subtitle="Edit this focused SvgFrame scene" padding={22} gap={18}>
  <Column
    gap={8}
    align='center'>
  <svg
    width='460'
    height='180'
    viewBox='0 0 460 180'>
  <SvgFrame
    x={18}
    y={18}
    width={424}
    height={144}
    rx={18}
    fill={c.bgCard}
    stroke={c.borderLight}
    strokeWidth={2} />
  </svg>
  <TextLabel
    text='Theme aware plot frame'
    fontSize={15} />
  </Column>
</Scene>
```

### SvgPoint

Labeled point for SVG figures.

Props:
- `cx`: `number` (required)
- `cy`: `number` (required)
- `fill`: `string` (required)
- `key`: `React.Key` (optional)
- `opacity`: `number` (optional)
- `r`: `number` (optional)
- `stroke`: `string` (optional)
- `strokeWidth`: `number` (optional)

```tsx
width = 960
height = 480

<Scene title="SvgPoint example" subtitle="Edit this focused SvgPoint scene" padding={22} gap={18}>
  <Column
    gap={8}
    align='center'>
  <svg
    width='460'
    height='180'
    viewBox='0 0 460 180'>
  <SvgFrame
    width={460}
    height={180}
    c={c} />
  <SvgPoint
    cx={230}
    cy={90}
    r={26}
    fill={c.positiveLight}
    stroke={c.bg}
    strokeWidth={5} />
  </svg>
  <TextLabel
    text='SVG point with outline'
    fontSize={15} />
  </Column>
</Scene>
```

### DotPoint

Point marker with optional text label.

Props:
- `c`: `ThemeColors` (required)
- `color`: `string` (required)
- `label`: `string` (required)
- `labelOffset`: `{ x?: number; y?: number; }` (optional)
- `size`: `number` (optional)
- `x`: `number` (required)
- `y`: `number` (required)

```tsx
width = 960
height = 480

<Scene title="DotPoint example" subtitle="Edit this focused DotPoint scene" padding={22} gap={18}>
  <div
    style={{ position: 'relative', display: 'flex', width: 460, height: 220 }}>{DotPoint({ x: 230, y: 100, label: 'deploy', color: c.infoLight, size: 14 })}<TextLabel
    text='Labeled coordinate point'
    fontSize={15} />
  </div>
</Scene>
```

### DashedLine

Dotted or dashed SVG guide line.

Props:
- `color`: `string` (required)
- `dotSize`: `number` (optional)
- `dotSpacing`: `number` (optional)
- `x1`: `number` (required)
- `x2`: `number` (required)
- `y1`: `number` (required)
- `y2`: `number` (required)

```tsx
width = 960
height = 480

<Scene title="DashedLine example" subtitle="Edit this focused DashedLine scene" padding={22} gap={18}>
  <div
    style={{ position: 'relative', display: 'flex', width: 460, height: 220 }}>{DashedLine({ x1: 36, y1: 110, x2: 424, y2: 110, color: c.warningLight, dotSpacing: 12, dotSize: 3 })}<TextLabel
    text='Threshold'
    fontSize={15} />
  </div>
</Scene>
```

### AxisPlot

Coordinate plane for points, vectors, and paths.

Props:
- `axisColor`: `string` (optional)
- `c`: `ThemeColors` (required)
- `children`: `React.ReactNode` (optional)
- `frameFill`: `string` (optional)
- `frameRx`: `number` (optional)
- `frameStroke`: `string` (optional)
- `gridCount`: `number` (optional)
- `height`: `number` (required)
- `padding`: `number` (optional)
- `paths`: `AxisPlotPath[]` (optional)
- `points`: `AxisPlotPoint[]` (optional)
- `showAxes`: `boolean` (optional; allowed values: `propEnums.values2`)
- `showFrame`: `boolean` (optional; allowed values: `propEnums.values2`)
- `showGrid`: `boolean` (optional; allowed values: `propEnums.values2`)
- `vectors`: `AxisPlotVector[]` (optional)
- `width`: `number` (required)
- `xAxisLabel`: `string` (optional)
- `xMax`: `number` (optional)
- `xMin`: `number` (optional)
- `yAxisLabel`: `string` (optional)
- `yMax`: `number` (optional)
- `yMin`: `number` (optional)

```tsx
width = 960
height = 560

<Scene title="AxisPlot example" subtitle="Edit this focused AxisPlot scene" padding={22} gap={18}>
  <AxisPlot
    width={700}
    height={380}
    xMin={-1}
    xMax={1}
    yMin={-1}
    yMax={1} showGrid
    xAxisLabel='x'
    yAxisLabel='y'
    points={[{ x: -0.5, y: 0.3, r: 6, tone: 'blue' },
        { x: 0.6, y: 0.7, r: 7, tone: 'green' }]}
    vectors={[{ x1: 0, y1: 0, x2: 0.45, y2: 0.55, tone: 'purple', arrow: true }]} />
</Scene>
```
## Shared prop value sets

Finite allowed values referenced by component props:

- `propEnums.values1`: ["center","flex-start","space-between","space-around"]
- `propEnums.FlexAlign`: ["center","start","end","stretch"]
- `propEnums.FlexJustify`: ["center","space-between","space-around","start","end"]
- `propEnums.values2`: [false,true]
- `propEnums.values3`: ["vertical","horizontal"]
- `propEnums.ToneName`: ["critical","neutral","blue","purple","green","warm","cyan","pink","red","sunset","ocean","dark"]
- `propEnums.values4`: ["window","browser","terminal"]
- `propEnums.IconName`: ["warning","browser","terminal","agent","bucket","cache","chart","check","cluster","code","cloud","container","database","file","firewall","gateway","git","globe","image","layers","lock","load-balancer","mobile","monitor","network","play","queue","server","spark","storage","stream","tool","user"]
- `propEnums.values5`: ["center","left","right"]
- `propEnums.values6`: ["code","title","subtitle","label","body","small","tiny","annotation"]
- `propEnums.values7`: ["start","end","middle"]
- `propEnums.ColorName`: ["primary","secondary","positive","warning","critical","info","accent","neutral"]
- `propEnums.values8`: ["center","left"]
- `propEnums.WatermarkPosition`: ["top-left","top-right","bottom-left","bottom-right"]
- `propEnums.StatusKind`: ["info","check","cross","warn","pending","dot"]
- `propEnums.values9`: ["LR","RL","TB","BT"]
- `propEnums.values10`: ["auto","manual"]
- `propEnums.GraphRouting`: ["dagre","straight","orthogonal"]
- `propEnums.values11`: ["content","fixed"]
- `propEnums.values12`: ["heat","strength"]
- `propEnums.values13`: ["decimal","percent","integer"]
- `propEnums.ChartValueFormat`: ["decimal","percent","integer","compact"]
- `propEnums.ParetoObjective`: ["minimize","maximize"]
- `propEnums.ParetoXScale`: ["linear","log"]
- `propEnums.values14`: ["left","right","down","up"]
