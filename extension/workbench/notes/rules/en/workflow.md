# Course note workflow

Use preferences.md, modules.md, and properties.md to determine this task's writing configuration, then process the actual materials as follows

## 1. Confirm materials and scope

For local tasks, determine output groups from the specified scope and the available Course Import Index. Read subtitles for the current group and necessary prerequisite content; for a single-file task, read that file directly. Web tasks handle one video or one uploaded material file per task, using existing notes and progress as references; this round's materials are the files actually uploaded

Explicit groups in this task take priority over the course index, which takes priority over chapter numbers in original subtitles or title-based inference. For one note per video, process selected videos separately; for grouped notes, use confirmed groups

When grouping is selected but not yet confirmed, recognize groups from titles:

- Courses marked Lecture / Lec / L followed by a number use the lecture as the unit: Lecture 02.1–02.4 belong to group 2; L1 and L4 belong to groups 1 and 4. Parts and LIVE recordings of the same lecture form one note, with segments as internal subheadings
- Ordinary numbered sections retain both levels: multiple parts of 2.2 form one note; 2.3 forms another, rather than merging into chapter 2. Keep identifiers such as 2.10 as strings
- Recognize lectures from Lecture / Lec or a standalone L-number marker, rather than course language or platform
- 0 means ungrouped, not a shared chapter. Handle ungrouped materials within the user-specified scope; confirm before merging if the scope is unclear

When only part of a group is selected, record the actual videos or files covered. Distinguish available files, not imported, no subtitles, read failures, and missing content. Gaps in section numbering do not imply missed collection; retain original labels such as “extension” or “example”

## 2. Organize knowledge

Within each output group, reorganize spoken subtitles by concept and topic. Unify terminology, merge repeated explanations, and retain conditions of use, distinct examples, and differences in conditions

Complete and check one note before starting the next. Long notes can be extracted and written over multiple rounds; keep the current note's knowledge structure, examples, and derivations complete, and record terminology, completed scope, and the stopping point. Recheck original materials when gaps appear

When supported and allowed in a local environment, independent output groups can be assigned to subagents. Each receives its group's materials and applicable configuration and delivers complete notes, sources, and unfinished items. The main agent checks terminology and cross-note connections while retaining every note's full content; process strongly dependent groups sequentially. Without this capability, complete notes one by one

## 3. Retain explanations

Organize definitions, formulas, derivations, and teacher examples together. Retain problem conditions, specific data, code or algorithm inputs, key intermediate states, methods, and conclusions. Preserve source topology, weights, and table entries used throughout an explanation. Explain why results hold rather than replacing derivations with conclusions alone

Use blockquotes for short, verifiable statements emphasized by the teacher. Label paraphrases and supplementary examples separately. Identify the location of diagrams, board work, formulas, parameters, or problem statements missing from subtitles rather than inferring the teacher's original content

## 4. Add necessary background

Distinguish course content, the note writer's explanations, and external sources. Follow personal configuration on external additions and cite actual sources; label independently derived solutions as the note writer's solutions. For incomplete exam questions mentioned in subtitles, follow “Missing exam questions” in [task guidance](tasks.md)

List unverified problem statements, formulas, and board work with their locations and impact. Follow the selected video-reference style using verified video identifiers and times, avoiding repeated links to the same source

## 5. Write study notes

Use selected sections, writing rules, properties, and naming; apply a user-provided template when explicitly requested. Read [Obsidian and Markdown writing](markdown.md) and check bold boundaries, code fences, formulas in tables, property types, and links

Retain original names where needed on first mention of new terms. When self-tests are enabled, generate questions following their module rules and distinguish generated exercises from teacher questions and retrieved exam questions

## 6. Draw where useful

Use tables for comparisons and mappings and Mermaid for flows, structures, states, and message exchanges. When a diagram improves understanding, read [Mermaid diagrams](mermaid.md) and place it near the corresponding topic. Use prose or a table when sufficient

## 7. Check and deliver

Check section coverage, example conditions and steps, derivations, terms, formulas, and sources against the actual materials. Length follows the materials and selected writing rules. Preserve manual annotations; put incremental additions under the relevant topics. Present conflicting sources side by side with differences and citations; save a separate revision when merging is impractical

Local agents save outputs within allowed directories, retain raw materials in their collection directory, and leave the Course Import Index to the importer. Update Notes Progress.md only when progress is enabled, recording actual coverage, output paths, used materials, and missing items

Web AI delivers completed content as Markdown or downloadable .md files for the user to save in suggested locations. For multi-round delivery, state completed scope, stopping point, and remaining content. Preserve existing content when revising long notes and return the complete revision when finished. Include a suggested progress document when enabled

Completion status refers to the actual scope processed. Report output locations or suggested filenames and items to verify. Review and questions deliver an answer by default; modify notes only when the user explicitly requests it
