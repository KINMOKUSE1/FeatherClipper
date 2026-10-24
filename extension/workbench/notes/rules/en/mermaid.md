# Mermaid diagrams

Read this when course content benefits from flow, structure, state, or message-exchange diagrams. Current user instructions and personal writing preferences take priority. Draw when it improves understanding; use prose or a table when sufficient

## Selection and sources

Read the target passage and its sources. List the nodes, relationships, conditions, and data to express. Choose the simplest diagram that makes the relationships clear. Split complex relationships into an overview and detail diagrams; draw separate topics separately

| Type | Directive | Suitable content |
|---|---|---|
| Flowchart | `flowchart TD` or `flowchart LR` | Processes, branches, structures, processing chains |
| Sequence | `sequenceDiagram` | Protocol messages, API calls, participant interactions |
| State | `stateDiagram-v2` | Lifecycles, states, transition conditions |
| Class | `classDiagram` | Objects, types, methods, relationships |
| Entity relationship | `erDiagram` | Data entities, keys, relationships |
| Gantt | `gantt` | Project plans with explicit dates |
| Mind map | `mindmap` | Compact concept hierarchies |
| Timeline | `timeline` | Events in chronological order |
| Git | `gitGraph` | Branch and merge history |
| Pie | `pie` | Proportions with few categories |
| Sankey | `sankey-beta` | Quantitative flow between stages |
| Block | `block-beta` | High-level component layouts |
| Quadrant | `quadrantChart` | Positioning and comparison on two dimensions |

Prefer Markdown tables for repeated mappings and concept comparisons. For exact durations, overlapping intervals, or protocol occupancy, list start/end values, units, and durations; ordinary `timeline` spacing is not proportional to time. Use diagram types supported by the target note reader

Place diagrams near their corresponding topics. Preserve source values, directions, branches, and labels. Label supplementary illustrations separately. Mark missing topology, parameters, board work, and relationships for verification rather than guessing the original diagram from subtitles

## Syntax and layout

- Use unique letter, digit, or underscore node IDs. Put Chinese in display text, for example `step1["收到 ACK"]`
- Give subgraphs short IDs and display titles, for example `subgraph phase1["拥塞避免"]`
- Enclose complex node text and edge labels in double quotes; use `#quot;` for double quotes inside display text
- Choose top-to-bottom or left-to-right flow based on content. Use `{}` for decisions and `([])` for start/end nodes
- Avoid starting node text with Markdown numbering such as `1.`; use `①` if needed. Put long explanations outside the diagram and keep labels short
- Select sequence arrows by message meaning and label requests, returns, or events clearly; show state transition conditions
- Use colors and groups for real categories with consistent meanings; do not rely on color alone to express relationships
- Use a separate `mermaid` code fence; see [Markdown writing](markdown.md) for fences and body text

## Check and deliver

Check node IDs, brackets, quotes, subgraph closure, arrows, and code fences. Then compare relationship directions, branch conditions, values, and units against sources

When a rendering environment is available, preview in the target note reader and check text overlap, reading order, and size. Split diagrams or shorten labels where necessary. Report specific compatibility or display problems and how they were handled. Distinguish source checks from rendering checks actually performed

For standalone diagram requests, deliver the diagram and necessary brief explanation. When inserting into notes, preserve surrounding text and manual annotations. Follow workflow.md for delivery
