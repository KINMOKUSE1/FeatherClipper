# Mermaid diagram selection

| Type | Directive | Best for |
|---|---|---|
| Flowchart | `flowchart TD` / `flowchart LR` | Processes, workflows, decisions, architecture pipelines |
| Sequence | `sequenceDiagram` | API calls, protocols, message flows, actor interactions |
| State | `stateDiagram-v2` | Lifecycles, state machines, status transitions |
| Class | `classDiagram` | Object models, types, relationships and methods |
| ER | `erDiagram` | Database entities, keys and relationships |
| Gantt | `gantt` | Dated project schedules and roadmaps |
| Mindmap | `mindmap` | Compact conceptual hierarchies |
| Timeline | `timeline` | Chronological events without proportional duration |
| Git | `gitGraph` | Branch and merge histories |
| Pie | `pie` | Simple proportions with few categories |
| Sankey | `sankey-beta` | Quantified flows between stages |
| Block | `block-beta` | High-level component layouts |
| Quadrant | `quadrantChart` | Two-axis positioning comparisons |

Prefer the simplest type that exposes the relationship. Use a Markdown table for repeated mappings or comparisons. For proportional durations, concurrent events, or protocol occupancy, use `obsidian-css-timeline` when installed, or a table of start and end times.
