# css-timeline DSL

## Syntax

````markdown
```css-timeline
time: 0s..40s
ticks: 0,8,16,24,32,40
row 节点A: [0..8:green]"A1 ✓", [32..40:red]"A2 ✗"
row 节点B: [8..16:green]"B1 ✓"
```
````

- `time:` is optional when `ticks:` is present. Format: `start..end`; values may carry `s`, `ms`, `min`, or `h`.
- `ticks:` is optional when `time:` is present. Separate values with commas.
- `row LABEL:` is required. Add one or more bars separated by commas.
- Bar syntax: `[start..end:color]"optional label"`.
- Supported colors: `green`, `red`, `yellow`, `gray`, `blue`, `orange`, `purple`, `cyan`, `lime`, `pink`.
- Lines beginning with `#` and blank lines are ignored.

When `ticks` is omitted, the compiler creates 5-8 spaced ticks including both ends. When `time` is omitted, it uses the first and last tick. A missing bar label displays `start~end`; an explicitly empty label stays empty.

## Default colors

| Keyword | Color | Default meaning |
|---|---|---|
| green | `#198754` | success, sent, passed |
| red | `#dc3545` | failure, conflict, blocked |
| yellow | `#ffc107` | warning, waiting, listening |
| gray | `#6c757d` | neutral, paused, occupied |
| blue | `#0d6efd` | active, planned |
| orange | `#fd7e14` | delayed, risk |
| purple | `#6f42c1` | special, high priority |
| cyan | `#0dcaf0` | information, auxiliary |
| lime | `#20c997` | secondary success |
| pink | `#d63384` | urgent, exceptional |

Keep color meaning consistent within one domain. Yellow uses dark text for contrast.
