# Technical diagram roadmap

Vizmatic aims to make polished technical diagrams easy from TSX while keeping rendering deterministic, offline-capable, theme-aware, and composable with charts or presentation frames.

Benchmarks: [Diagrams](https://diagrams.mingrammer.com/), [D2](https://d2lang.com/), [Structurizr](https://docs.structurizr.com/), [Mermaid](https://mermaid.js.org/), and [PlantUML](https://plantuml.com/).

## Available now

- Deterministic Dagre layout in four directions.
- Nested system boundaries through `GraphDiagram.groups`.
- Built-in generic icons for users, clients, services, infrastructure, data, networks, and operations.
- Reusable custom icon definitions and typed icon registries.
- Labeled synchronous, asynchronous, event, data, dependency, and association relationships.
- Solid, dashed, and dotted connectors with forward, backward, bidirectional, or no arrows.
- Manual positioning for ungrouped editorial diagrams.
- Connector diagnostics for crossings, label collisions, crowded endpoints, and parallel routes.
- Dark, light, and Engineering visual presets with PNG, SVG, and GIF output.
- Typed state timelines with holds, eased tweens, keyframes, parallel tracks, deterministic sampling, and streamed GIF encoding.

## Next capability batches

### Near-term priorities

1. Sequence diagrams, compiled into shared participants, messages, notes, and fragment semantics.
2. Dataflow and lineage views with explicit source, transform, store, stream, and batch relationships.
3. Deployment and network views with regions, zones, boundaries, ports, protocols, and trust direction.
4. ML architecture views for transformer blocks, tensor shapes, collectives, and distributed topologies.
5. Animation quality tools for loop-seam checks, frame-cadence diagnostics, animated content bounds, and smaller delta-encoded GIFs.

Each specialized API should remain declarative and reusable. Examples may contain complete scenario code, but scenario-specific NCCL or model helpers should not become core presets.

### Architecture model and views

- C4 person, software system, container, component, and deployment semantics.
- One reusable model with context, container, component, deployment, and dynamic views.
- Named views, filtered views, legends, tags, and technology metadata.
- Drill-down links and stable element identifiers in SVG output.

### Technical icon packs

- Build-time generated GCP and Kubernetes packs from pinned Apache-2.0 Iconify data.
- Optional provider modules so unused icons do not increase core bundle size.
- Asset metadata with source, version, license, and trademark notice.
- User-supplied AWS and Azure adapters until redistribution terms support bundled packs.
- No default runtime icon API or network dependency.

### Interaction and software design

- Sequence diagrams with participants, lifelines, activations, sync/async/return messages, notes, and `alt`/`loop`/`parallel` fragments.
- UML class and component diagrams with compartments, inheritance, aggregation, composition, multiplicity, and stereotypes.
- State machines with nested states, guards, entry/exit actions, and parallel regions.
- ER diagrams with tables, fields, keys, data types, and cardinality-aware relationships.

### Infrastructure and data systems

- Deployment and network views with regions, zones, VPCs, subnets, namespaces, hosts, ports, protocols, trust boundaries, and ingress/egress.
- Dataflow and lineage views with sources, sinks, stores, transformations, schemas, and batch/stream semantics.
- Swimlanes and activity diagrams for ownership, handoffs, conditions, and parallel work.

### Layout and rendering

- Named ports and endpoint anchors.
- Orthogonal, curved, and user-routed connectors with parallel-edge separation.
- Layout adapter interface with Dagre as default and ELK as optional backend.
- Per-boundary direction, collapsed groups, named scenarios, and reusable animation compositions.
- Tooltips, links, and accessible structured descriptions in SVG.
- Import/export adapters for Mermaid, D2, Structurizr, Kubernetes, and Terraform where semantics map safely.

## Design constraints

- Keep current `GraphDiagram` input backward compatible.
- Compile specialized diagram APIs into shared typed models instead of separate rendering stacks.
- Keep default rendering deterministic and offline.
- Treat provider licensing and trademarks as product requirements.
- Add tests for behavior contracts and regressions, not source-text presence.
- Ship each capability with dark/light reference renders, docs, and diagnostics.
