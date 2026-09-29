# Importing Mermaid and D2 graphs

Vizmatic can import a conservative text subset of Mermaid flowcharts and D2 diagrams into `GraphDiagram` data. The adapters are local parsers and do not execute source code or make network requests.

```ts
import { importMermaidGraph } from 'vizmatic'

const result = importMermaidGraph(`flowchart LR
client[Client] -->|request| api[API]
api --> database[Database]`)

if (!result.ok || !result.graph) {
    throw new Error(result.diagnostics.map(({ message }) => message).join('\n'))
}

const { nodes, edges, groups, direction } = result.graph
```

Each result contains `source`, `ok`, `diagnostics`, and a `graph` only when the input can be imported safely. Errors suppress `graph`, including when some statements were understood, so a caller cannot accidentally render a partial interpretation. Warnings keep the graph available and describe accepted visual losses. A diagnostic includes a stable code, severity, source line and column, message, and a short source excerpt.

## Supported Mermaid syntax

- A `flowchart` or `graph` header with optional `LR`, `RL`, `TB`, `TD`, or `BT` direction. Omitted direction follows Mermaid's top-to-bottom default, and `TD` maps to Vizmatic's `TB`.
- One node declaration or a chain of supported edges per line. Node IDs use letters, digits, `_`, or `-`, with a letter or `_` first. Bare IDs use the ID as their label.
- Plain labels in square brackets and quoted labels using JSON-compatible double quoted escapes.
- `-->` directed edges, `---` open edges, and `-.->` dotted directed edges. Edge labels use `-->|plain label|` form.
- One level of `subgraph id [label]` groups, terminated with `end`. Group membership is retained for nodes declared inside the group.
- Lines beginning with `%%` as comments.

Mermaid shapes other than square bracket nodes are converted to generic `GraphDiagram` nodes with an `import.lossy_semantics` warning. This includes rounded, stadium, circular, cylindrical, and decision shapes. HTML and Markdown labels, nested subgraphs, local subgraph directions, edges to or from subgraphs, classes, styling, click actions, directives, and other edge operators are rejected with diagnostics. Mermaid supports many additional shapes and edge forms; this adapter does not imply support for them. See the [Mermaid flowchart syntax reference](https://mermaid.js.org/syntax/flowchart.html).

## Supported D2 syntax

- Optional `direction: right`, `left`, `down`, or `up` setting. Omitted direction follows D2's top-to-bottom default and maps to `TB`.
- One simple node declaration per line, either `id` or `id: label`. IDs use letters, digits, `_`, or `-`, with a letter or `_` first. Double quoted JSON strings and simple single quoted strings are accepted.
- One connection between simple IDs per line using `->`, `<-`, `<->`, or `--`. A plain connection label can follow a colon.
- Simple `id.shape: value` declarations. The default rectangle maps directly; any other shape is converted to a generic node with an `import.lossy_semantics` warning.
- Lines beginning with `#` as comments.

D2 containers and object-property blocks are rejected and their contents are skipped, so children cannot be mistaken for top-level nodes. Chained and semicolon-separated statements, dotted IDs, styling, sizing, positioning, Markdown or HTML labels, globs, variables, and other D2 features are unsupported. See the [D2 shapes reference](https://d2lang.com/tour/shapes/), [connections reference](https://d2lang.com/tour/connections), and [layouts reference](https://d2lang.com/tour/layouts/).

The parsers intentionally do not depend on the Mermaid or D2 runtimes. If source uses a feature outside these subsets, simplify it or handle the diagnostic before rendering.
