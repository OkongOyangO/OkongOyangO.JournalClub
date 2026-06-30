# Publishing Guide — Journal Club Lecture Notes

This is an **English-only** Hugo (LoveIt) subsite. To add a lecture note, create **one**
Markdown file in `content/posts/`.

## File naming

```
content/posts/YYYY-MM-<slug>.md
```

Example: `content/posts/2026-02-quantum-geometry-anomalous-hall.md`

- Use the meeting date as the `YYYY-MM` prefix and a short kebab-case slug.
- One file per lecture. No `.en.md` / `.zh-cn.md` / `.ja.md` split — this site is English-only.

## Frontmatter + body template

```markdown
---
title: "<Paper title or topic>"
date: YYYY-MM-DDTHH:MM:SS-05:00   # meeting date/time; must be unique per post
draft: false
math: true                        # set true if the note contains LaTeX
tags: ["Topic A", "Topic B"]      # drives the Tags page
categories: ["Journal Club"]
---

| | |
|---|---|
| **Presenter** | <Name> |
| **Date** | <Month DD, YYYY> |
| **Paper** | <Authors>, "<Title>," *<Journal>* (<Year>) |
| **Link** | [arXiv:XXXX.XXXXX](https://arxiv.org/abs/XXXX.XXXXX) |

<One-paragraph summary of what was discussed — this shows in list views.>

<!--more-->

## Setup
...

## Key result
...

## Discussion points
- ...

## References
1. ...
```

## Attaching a PDF lecture note (with download link)

This is a static site, so "uploading" a PDF means **adding the file to the repo**:

1. Drop the PDF into `static/pdfs/`, e.g. `static/pdfs/2026-02-quantum-geometry.pdf`.
2. In the note body (after `<!--more-->`), add the `pdf` shortcode:

   ```markdown
   {{< pdf src="2026-02-quantum-geometry.pdf" >}}
   ```

   This renders a red **Download** button plus an inline PDF viewer.

3. Commit and push — the PDF is served at
   `https://OkongOyangO.github.io/OkongOyangO.JournalClub/pdfs/2026-02-quantum-geometry.pdf`.

### `pdf` shortcode options

| Form | Effect |
|------|--------|
| `{{< pdf src="note.pdf" >}}` | Looks in `static/pdfs/note.pdf`; download button + inline viewer |
| `{{< pdf src="note.pdf" title="Slides (PDF)" >}}` | Custom button label |
| `{{< pdf src="note.pdf" embed="false" >}}` | Download button only (no inline viewer) |
| `{{< pdf src="note.pdf" height="500px" >}}` | Set the viewer height |
| `{{< pdf src="/files/note.pdf" >}}` | Explicit path under `static/` |
| `{{< pdf src="https://…/note.pdf" >}}` | External URL, used as-is |

> **Do not mix positional and named parameters** in one call — Hugo rejects
> `{{< pdf "note.pdf" title="…" >}}`. Use `src="note.pdf"` when you also pass `title`.

A bare filename (no `/`) resolves under `static/pdfs/`. You can also link the PDF from the
session table's **Link** row if you want it visible above the fold.

## Conventions

- **Unique `date`** per post — LoveIt orders posts by date; duplicates make ordering unstable.
- Keep the **session info table** at the top (Presenter / Date / Paper / Link) so every note
  records who presented and which paper.
- **Math** uses KaTeX with `$...$` (inline) and `$$...$$` (block). Set `math: true` in
  frontmatter. Split very long `aligned` blocks — KaTeX can choke on huge single environments.
- The text before `<!--more-->` becomes the list-view summary.
- **Figures**: put images under `assets/posts/<slug>/` and reference them with the LoveIt
  `figure` shortcode or standard Markdown.

## Build & deploy

This site is served by **GitHub Pages directly from the committed `docs/` folder** on the
`main` branch (no Actions workflow). So you must **rebuild `docs/` and commit it** as part of
every update:

```bash
cd OkongOyangO.JournalClub
rm -rf docs/ && hugo --gc --minify -d docs   # build the site INTO docs/
git add -A && git commit -m "Add lecture: <topic>" && git push
```

GitHub Pages picks up the new `docs/` and republishes in ~1 min. The live site is
`https://OkongOyangO.github.io/OkongOyangO.JournalClub/`.

> **Don't date a post in the future.** Hugo drops future-dated posts from the build. Use the
> meeting date with a past time of day. (If you ever must build a future-dated post, add
> `--buildFuture` to the `hugo` command.)
>
> `docs/.nojekyll` must exist (it tells Pages not to run Jekyll on the Hugo output). It's
> already committed — don't delete it.
