#!/usr/bin/env python3
"""Compile fenced css-timeline blocks in an Obsidian Markdown note."""
from __future__ import annotations

import argparse, html, math, re, sys
from pathlib import Path

COLORS = {
    "green": ("#198754", "white"), "red": ("#dc3545", "white"),
    "yellow": ("#ffc107", "#333"), "gray": ("#6c757d", "white"),
    "blue": ("#0d6efd", "white"), "orange": ("#fd7e14", "white"),
    "purple": ("#6f42c1", "white"), "cyan": ("#0dcaf0", "#333"),
    "lime": ("#20c997", "#333"), "pink": ("#d63384", "white"),
}
BLOCK_RE = re.compile(r"```css-timeline\s*\n(.*?)\n```", re.DOTALL)
VALUE_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*([A-Za-zµμ]*)\s*$")
BAR_RE = re.compile(r"\[\s*(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)\s*:\s*([A-Za-z]+)\s*\]\s*(?:\"([^\"]*)\")?")
BASE_MARKER = "/* ===== css-timeline base ===== */"

class TimelineError(ValueError): pass

def parse_value(token: str) -> tuple[float, str]:
    m = VALUE_RE.match(token)
    if not m: raise TimelineError(f"invalid numeric value: {token!r}")
    return float(m.group(1)), m.group(2)

def pretty(value: float) -> str:
    return str(int(value)) if value.is_integer() else f"{value:g}"

def nice_ticks(start: float, end: float) -> list[float]:
    span = end - start
    if span <= 0: raise TimelineError("time end must be greater than start")
    raw, power = span / 6, 10 ** math.floor(math.log10(span / 6))
    ratio = raw / power
    step = (1 if ratio <= 1 else 2 if ratio <= 2 else 5 if ratio <= 5 else 10) * power
    result, current = [start], math.ceil(start / step) * step
    while current < end and len(result) < 20:
        if not math.isclose(current, start): result.append(current)
        current += step
    if not math.isclose(result[-1], end): result.append(end)
    return result

def infer_domain(note: Path) -> str:
    text = str(note).lower()
    for needle, domain in {"计算机网络":"network", "操作系统":"os", "langchain":"langchain", "数据库":"database"}.items():
        if needle in text: return domain
    return re.sub(r"[^a-z0-9]+", "-", note.parent.name.lower()).strip("-") or "general"

def find_snippet(note: Path) -> Path:
    for parent in note.parents:
        if (parent / ".obsidian").is_dir():
            return parent / ".obsidian" / "snippets" / "css-timeline.css"
    raise TimelineError("could not find a parent .obsidian directory; pass --snippet")

def split_bars(text: str) -> list[str]:
    parts, current, quoted = [], [], False
    for char in text:
        if char == '"': quoted = not quoted
        if char == "," and not quoted:
            parts.append("".join(current).strip()); current = []
        else: current.append(char)
    if current: parts.append("".join(current).strip())
    return [p for p in parts if p]

def compile_block(source: str, domain: str) -> tuple[str, set[str], list[str]]:
    time_range, unit, ticks, rows = None, "", None, []
    warnings, used = [], set()
    for number, raw in enumerate(source.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"): continue
        if line.startswith("time:"):
            pieces = line[5:].strip().split("..", 1)
            if len(pieces) != 2: raise TimelineError(f"line {number}: time must be start..end")
            start, u1 = parse_value(pieces[0]); end, u2 = parse_value(pieces[1])
            if end <= start or (u1 and u2 and u1 != u2): raise TimelineError(f"line {number}: invalid time range")
            unit, time_range = u1 or u2, (start, end)
        elif line.startswith("ticks:"):
            values = []
            for token in line[6:].split(","):
                value, u = parse_value(token)
                if unit and u and u != unit: raise TimelineError(f"line {number}: conflicting tick unit")
                unit = unit or u; values.append(value)
            if len(values) < 2 or any(b <= a for a,b in zip(values, values[1:])):
                raise TimelineError(f"line {number}: ticks must increase")
            ticks = values
        elif line.startswith("row "):
            if ":" not in line: raise TimelineError(f"line {number}: row missing ':'")
            label, bar_text = line[4:].split(":", 1); bars = []
            for part in split_bars(bar_text):
                m = BAR_RE.fullmatch(part)
                if not m: raise TimelineError(f"line {number}: invalid bar {part!r}")
                begin, end = float(m.group(1)), float(m.group(2))
                if end < begin: raise TimelineError(f"line {number}: bar end precedes start")
                color = m.group(3).lower()
                if color not in COLORS: warnings.append(f"unknown color {color!r}; used gray"); color = "gray"
                used.add(color); bars.append((begin, end, color, m.group(4)))
            if not bars: raise TimelineError(f"line {number}: row has no bars")
            rows.append((label.strip(), bars))
        else: raise TimelineError(f"line {number}: unrecognized field {line!r}")
    if time_range is None and ticks is None: raise TimelineError("time and ticks cannot both be absent")
    if time_range is None: time_range = (ticks[0], ticks[-1])
    if ticks is None: ticks = nice_ticks(*time_range)
    if not rows: raise TimelineError("timeline has no rows")
    start_time, end_time = time_range; span = end_time - start_time
    tick_html = ""
    for v in ticks:
        position = (v-start_time)/span*100
        shift = "0" if v == start_time else "-100%" if v == end_time else "-50%"
        tick_html += f'<span style="position:absolute;left:{position:.1f}%;transform:translateX({shift})">{html.escape(pretty(v)+unit)}</span>'
    out = [f'<div class="css-timeline domain-{html.escape(domain)}">', f'  <div class="time-axis" style="position:relative;height:20px">{tick_html}</div>']
    narrow = []
    for row_label, bars in rows:
        out += ['  <div class="task-row">', f'    <div class="task-label">{html.escape(row_label)}</div>', '    <div class="task-bar-container">']
        for begin, end, color, label in bars:
            left, width = (begin-start_time)/span*100, (end-begin)/span*100
            if begin < start_time or end > end_time: warnings.append(f"bar {begin:g}..{end:g} outside timeline")
            display = f"{pretty(begin)}~{pretty(end)}" if label is None else label
            if width < 3:
                if display: narrow.append(f"> {color} 窄条（{pretty(begin)}{unit}~{pretty(end)}{unit}）：{display}")
                display = ""
            out.append(f'      <div class="bar color-{color}" style="left:{left:.1f}%;width:{width:.1f}%">{html.escape(display)}</div>')
        out += ['    </div>', '  </div>']
    out.append('</div>')
    if narrow: out += ["", *narrow]
    return "\n".join(out), used, warnings

def base_css() -> str:
    return """/* ===== css-timeline base ===== */
.css-timeline { font-family: sans-serif; margin: 20px 0; }
.css-timeline .time-axis { display:flex; justify-content:space-between; margin-left:80px; margin-bottom:5px; color:var(--text-muted); font-size:12px; border-bottom:1px solid var(--background-modifier-border); }
.css-timeline .task-row { display:flex; align-items:center; margin-bottom:8px; }
.css-timeline .task-label { width:80px; padding-right:8px; box-sizing:border-box; font-size:14px; font-weight:600; color:var(--text-normal); }
.css-timeline .task-bar-container { flex:1; height:24px; background:var(--background-secondary); border-radius:4px; position:relative; overflow:hidden; }
.css-timeline .bar { position:absolute; height:100%; border-radius:4px; display:flex; align-items:center; justify-content:center; overflow:hidden; color:white; font-size:11px; font-weight:600; white-space:nowrap; }
"""

def ensure_css(existing: str, domain: str, colors: set[str]) -> str:
    result = existing.rstrip()
    if BASE_MARKER not in result: result = base_css().rstrip() + ("\n\n"+result if result else "")
    marker = f"/* === domain: {domain} === */"
    rules = [f".css-timeline.domain-{domain} .color-{c} {{ background:{COLORS[c][0]}; color:{COLORS[c][1]}; }}" for c in sorted(colors)]
    if marker not in result: result += f"\n\n{marker}\n" + "\n".join(rules)
    else:
        for rule in rules:
            if rule.split(" {",1)[0] not in result: result += "\n" + rule
    return result.strip()+"\n"

def compile_note(text: str, domain: str):
    colors, warnings, count = set(), [], 0
    def replace(match):
        nonlocal count
        compiled, found, notices = compile_block(match.group(1), domain)
        colors.update(found); warnings.extend(notices); count += 1
        return compiled
    return BLOCK_RE.sub(replace, text), colors, warnings, count

def atomic_write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix+".tmp"); temp.write_text(content, encoding="utf-8"); temp.replace(path)

def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("note", type=Path)
    mode = parser.add_mutually_exclusive_group(); mode.add_argument("--write", action="store_true"); mode.add_argument("--dry-run", action="store_true")
    parser.add_argument("--snippet", type=Path); parser.add_argument("--domain"); args = parser.parse_args()
    note = args.note.resolve()
    if not note.is_file(): parser.error(f"note does not exist: {note}")
    try:
        domain = args.domain or infer_domain(note)
        compiled, colors, warnings, count = compile_note(note.read_text(encoding="utf-8"), domain)
        if count == 0: print("No css-timeline blocks found.", file=sys.stderr); return 0
        snippet = args.snippet.resolve() if args.snippet else find_snippet(note)
        css = ensure_css(snippet.read_text(encoding="utf-8") if snippet.exists() else "", domain, colors)
        if args.write:
            atomic_write(note, compiled); atomic_write(snippet, css)
            print(f"Compiled {count} block(s); domain={domain}; snippet={snippet}")
        else:
            print(compiled); print(f"[preview] domain={domain}; snippet={snippet}", file=sys.stderr)
        for warning in warnings: print(f"warning: {warning}", file=sys.stderr)
        return 0
    except TimelineError as error: print(f"error: {error}", file=sys.stderr); return 2

if __name__ == "__main__": raise SystemExit(main())
