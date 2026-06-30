# Condensed Matter Journal Club

Lecture notes and paper discussions from the condensed matter theory journal club
organized by [Yiyang Jiang](https://OkongOyangO.github.io/) at Penn State University.

**Live site:** [https://OkongOyangO.github.io/OkongOyangO.JournalClub/](https://OkongOyangO.github.io/OkongOyangO.JournalClub/)

## About

Each entry records a journal club session: the paper we discussed, who presented, and the
key ideas worked through on the board. Browse by tag or scroll the lecture archive.

## Adding a lecture note

One Markdown file per session under `content/posts/`. See
[`PUBLISHING_GUIDE.md`](PUBLISHING_GUIDE.md) for the template.

## Built With

- [Hugo](https://gohugo.io/) static site generator
- [LoveIt](https://github.com/dillonzq/LoveIt) theme (vendored)
- KaTeX for math rendering
- Deployed on GitHub Pages via GitHub Actions

## Local development

```bash
hugo server -D            # preview at http://localhost:1313/OkongOyangO.JournalClub/
rm -rf public/ && hugo    # clean production build
```

Sister site: [OkongOyangO.Notes](https://OkongOyangO.github.io/OkongOyangO.Notes/) — personal
physics notes (trilingual).
