# Accessible SVG diagrams

`GraphDiagram` adds a `<title>` and `<desc>` to SVGs exported with `renderToSvg` or downloaded from the playground. Set `title` and `description` to describe the visual for its audience. When omitted, the title uses `ariaLabel` and the description summarizes the nodes and relationships. `ariaLabel` remains available for the rendered React diagram.

Nodes and relationships can include a `title` for a browser tooltip and an `href` for a link. A node's `detail` becomes its description. Relationship labels and endpoint names form the relationship description. Links accept HTTP, HTTPS, `mailto:`, `tel:`, fragment, and relative URLs. Unsupported URL schemes, including `javascript:` and `data:`, throw an error.

```tsx
<GraphDiagram
  id="checkout"
  title="Checkout services"
  description="The checkout API reads from orders and publishes events."
  nodes={[
    { id: "api", label: "Checkout API", detail: "HTTP service", href: "/docs/checkout", title: "Open API docs" },
    { id: "orders", label: "Orders" },
  ]}
  edges={[
    { id: "reads-orders", from: "api", to: "orders", label: "queries", href: "/docs/orders" },
  ]}
/>
```

Each node and relationship receives a stable SVG element ID. Supply a stable `GraphDiagram` `id` to namespace these IDs when combining diagrams. For example, graph ID `checkout` and node ID `api` produce `vizmatic-graph-id-checkout-node-api`. ASCII letters, digits, dots, and hyphens stay readable; other characters use `_u<hex-codepoint>_` escapes. If a graph has no explicit `id`, its namespace uses its order in the exported SVG.

`DataflowDiagram`, `DeploymentDiagram`, and `TransformerTopology` pass their `id`, `title`, `description`, node links, relationship links, and tooltips through to `GraphDiagram`. `TransformerTopology` uses block links and route links; an expanded route with multiple segments gives each segment a numbered suffix. `renderToSvg` and the playground SVG download keep this metadata and the links in SVG. PNG output remains a raster image and does not retain links or interactive tooltips.

Satori serializes inline SVG artwork as embedded images and does not preserve HTML node groups. Vizmatic adds the accessible groups and transparent link targets to the final SVG after Satori renders it. Resvg can parse and rasterize that SVG; the added hit targets have no visible fill or stroke.
