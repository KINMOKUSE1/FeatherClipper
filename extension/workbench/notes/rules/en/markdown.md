# Obsidian and Markdown writing

Use these conventions when generating or revising notes; personal configuration still determines sections and properties

## Bold and punctuation

For Chinese labels, preferably put colons, commas, and other punctuation outside the bold span, for example `**声音/音素**：发音相似是一种关系`

If bold content ends with punctuation and a Chinese character immediately follows the closing delimiter, literal asterisks may remain. When punctuation must stay inside the bold span, put a space between the closing delimiter and following text:

```md
**声音/音素：** 发音相似是一种关系
```

The bold span in `**加粗**汉字` does not end with punctuation, so a space is not universally required; following punctuation in `**加粗**，` can remain as written. Check that delimiters are paired and that text or punctuation directly precedes the closing delimiter. Avoid `**声音/音素： **`

## Inline code and code fences

When naming a syntax in prose, write its name, such as `mermaid`. Put opening and closing code fences on their own lines. For inline code containing backticks, use matching delimiters with a different run length from any backtick sequence inside, adding spaces to separate backticks adjacent to the boundaries

To show complete fenced-code syntax, use a longer outer fence. This example uses four backticks outside and three inside:

````md
```mermaid
flowchart LR
    start["Start"] --> finish["Finish"]
```
````

Deliver final notes as Markdown body text. Add an outer fence only for source examples; wrapping the whole note in a code block prevents headings, formulas, and diagrams from rendering

## Tables and formulas

Use math delimiters for formulas in tables and replace formula pipe characters with LaTeX commands so the table parser does not treat them as column separators:

- Conditional probability: `$P(A \mid B)$`
- Absolute value: `$\lvert X \rvert$`

Use `$...$` for inline math and `$$` on separate lines for display math. Formulas inside code blocks or inline code show source only. Escape ordinary text pipes in tables as `\|`; also escape a Wikilink alias separator when showing it inside a cell

## YAML properties and tags

When properties are enabled, put YAML frontmatter at the beginning of the note between paired `---` lines. Use properties and types specified in properties.md

- Quote textual chapter numbers, identifiers, and number-like text, such as `chapter: "2.10"`, to preserve their form
- Quote text containing YAML syntax such as a colon followed by a space or a hash. Escape quotes according to the chosen quote style
- Write numbers and booleans with their actual types, such as `difficulty: 3` and `reviewed: false`. Use YAML lists and `YYYY-MM-DD` dates
- Use `null` when the fill rule calls for a null value, `""` for empty text, and omit the property when omission is required
- Quote Obsidian internal links in YAML properties, for example `"[[Glossary]]"`
- Obsidian tags contain no spaces; join multiple words with hyphens, such as `computer-network`. The YAML tags list contains tag names without the body-text hash prefix

## Links and attachments

Internal links and attachment paths in local notes must correspond to actual vault files. Obsidian supports Wikilinks and Markdown links. Encode spaces as `%20` or enclose Markdown link paths in angle brackets

Prefer standard Markdown links and actual source URLs for web delivery. Use relative paths and identify filenames for attachments delivered with the notes. Note directories are suggested save locations. Video references use identifiers and times confirmed in the materials

## Paragraphs and structure

Use clear heading levels. Separate headings, lists, blockquotes, tables, and code blocks from adjacent body text with blank lines. Indent nested lists and code blocks according to their list items

Separate paragraphs with blank lines and organize them semantically rather than making every subtitle sentence a separate paragraph. Blockquotes represent teacher quotations and code blocks represent source code. For Chinese relationship diagrams, use tables, Mermaid, or images rather than ASCII box drawings
