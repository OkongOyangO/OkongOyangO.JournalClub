# Claude Code Project Notes — Journal Club

## What this is

Hugo (LoveIt theme) **English-only** subsite holding lecture notes from the condensed
matter theory journal club Yiyang Jiang organizes at Penn State. Sister site to
`OkongOyangO.Notes` (the trilingual Physics Notes site); it reuses the same theme and the
same subdirectory-deployment layout overrides, but is a **separate site / separate repo**.

## Project Structure

- Deployed at `https://OkongOyangO.github.io/OkongOyangO.JournalClub/` (subdirectory deployment).
- Lecture notes live in `content/posts/` as `YYYY-MM-<slug>.md` (English only — no language suffix).
- Theme is **vendored** (LoveIt copied into `themes/LoveIt/`, not a git submodule), so
  `git clone` + `hugo` works with no `--recursive`.
- Layout overrides in `layouts/` (copied from the Notes site):
  - `partials/head/link.html` — favicon paths via `relURL` for subdirectory deployment
  - `partials/header.html` — text labels on Search/Theme buttons
  - `partials/home/profile.html` — animated subtitle + GitHub star link (journal-club text);
    also includes the `home/upcoming-seminar.html` partial
  - `partials/home/upcoming-seminar.html` — "Upcoming Seminar" card, **live-synced** from the
    Journal Club Google Sheet via its **gviz CSV** endpoint
    (`/gviz/tq?tqx=out:csv` — the only endpoint that answers a browser `fetch` with CORS;
    `/export?format=csv` 307-redirects and drops the CORS header). Client-side JS maps columns
    **by header name** (the sheet is edited live and has grown Affiliation/Advisor columns), picks
    the next row dated today-or-later with a real speaker (blank / `N/A` break weeks skipped), and
    replaces a build-time **static fallback**. In-flow card under the profile; promoted to a fixed
    right-gutter widget on screens ≥ 1600px (the 1080px `.page` column leaves no gutter below that).
  - `partials/extend_head.html` — inherited from the Notes site; **dead code** (LoveIt never
    references `extend_head.html`, so its MathJax block does not load — math works via LoveIt's
    native KaTeX). Do NOT add CSS/JS here expecting it to load; use the hooks below.
  - `shortcodes/pdf.html` — the `{{< pdf >}}` shortcode (download button + inline PDF viewer)
  - `assets/css/_custom.scss` — custom CSS hook the theme actually compiles (`style.scss`
    does `@import "_custom"`). PDF-button/viewer styling and the Upcoming Seminar card styling
    (theme SCSS vars for light/dark) live here.
  - `404.html` — links back to this subsite
  - **`taxonomy/term.html`** — maps the theme's legacy single-term template to Hugo's modern
    `term` kind so individual `/tags/<tag>/` pages render (see Key Decisions).
- Config: `hugo.toml` (single language, `[menu]` not `[languages.*.menu]`).
- **Deploy model: GitHub Pages serves the committed `docs/` folder** on `main`
  (Pages `build_type: legacy`, source `main` `/docs`). There is **no Actions workflow** — the
  `gh` token lacked the `workflow` scope, so `.github/workflows/hugo.yaml` is untracked
  (gitignored, kept on disk for reference). Every update must rebuild and commit `docs/`:
  `rm -rf docs/ && hugo --gc --minify -d docs` then `git add -A && git commit && git push`.
  `docs/.nojekyll` is committed and required. (To switch to auto-deploy later: run
  `gh auth refresh -s workflow`, un-gitignore the workflow, set Pages `build_type=workflow`.)
- **Never future-date a post** — Hugo drops future-dated content; use a past time of day
  (or build with `--buildFuture`).

## Critical Rules

- **English only.** Unlike the Notes site, do NOT create `.zh-cn.md` / `.ja.md` versions.
  One `.md` file per lecture.
- **Unique `date` per post** — LoveIt orders by date; duplicates make ordering unstable.
- **Keep paths subdirectory-safe.** Never hardcode `https://...` asset URLs in layouts; use
  `relURL`. The avatar in `hugo.toml` is the one intentional absolute-from-root path
  (`/OkongOyangO.JournalClub/images/profile.png`).
- When changing layouts copied from `OkongOyangO.Notes`, remember any `OkongOyangO.Notes`
  subpath or repo URL must become `OkongOyangO.JournalClub` here.

## Key Decisions

- **`layouts/taxonomy/term.html`** is a one-file fix for a LoveIt + modern-Hugo mismatch:
  the theme predates Hugo 0.116's `taxonomy`/`term` kind rename, so it ships
  `taxonomy/list.html` (legacy single-term renderer) but no `term.html`. Without the
  override, `/tags/<tag>/` pages silently fail to generate (Hugo warns
  `found no layout file ... for kind "term"`). The override is a copy of the theme's
  `taxonomy/list.html`. **The sister `OkongOyangO.Notes` site has the same latent bug and
  could take the same fix.**
- Theme is vendored (not a submodule) for clone-and-go simplicity. The theme's `exampleSite/`
  was deleted — it contained a placeholder Mapbox token that GitHub secret-scanning blocked on
  push, and it isn't needed to build. It's gitignored so it can't return.

## Adding a lecture note

See `PUBLISHING_GUIDE.md` for the full frontmatter + body template. In short: one
`content/posts/YYYY-MM-<slug>.md` file with a Presenter/Date/Paper/Link table at the top,
a summary paragraph, `<!--more-->`, then the notes.

**PDF lecture notes:** drop the PDF in `static/pdfs/` and reference it with
`{{< pdf src="file.pdf" >}}` (renders a download button + inline viewer). Path handling:
a bare filename resolves under `static/pdfs/`; the shortcode strips a leading `/` before
`relURL` so the subdirectory prefix is added correctly (passing a `/`-prefixed path straight
to `relURL` would NOT get the subpath — a Hugo gotcha). Don't mix positional and named
shortcode params.

## Cross-site rule

The main homepage (`OkongOyangO.github.io`) menu links here via
`_data/navigation.yml` ("Journal Club"). If this subsite's URL or purpose changes, update
that link too.
