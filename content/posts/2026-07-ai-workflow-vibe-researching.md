---
title: "AI Workflow & Vibe Researching"
date: 2026-07-06T16:00:00-04:00
draft: false
math: false
tags: ["AI", "LLM", "Research Workflow", "Agentic AI", "Automation", "MCP", "RAG"]
categories: ["Journal Club"]
---

| | |
|---|---|
| **Presenter** | Yiyang Jiang |
| **Date** | July 6, 2026 |
| **Topic** | AI Workflow & Vibe Researching |

The presentation argues that for modern physics research, the key question is no longer
whether to use AI, but how to use it effectively. It distinguishes two major roles:
NN-based AI for principles (neural-network fitting, neural quantum states, DeepH) and
LLM-based AI for workflow (planning, memory, tools, APIs, MCP, agent loops).

<!--more-->

{{< pdf src="ai-workflow-vibe-researching.pdf" title="Download slides (PDF)" >}}

## Core AI concepts

The talk introduces foundational AI concepts relevant to research:

- **LLMs, transformers, neural networks** — the architecture stack
- **Tokens & context windows** — the currency and memory of LLM interactions
- **RAG (Retrieval-Augmented Generation)** — grounding model responses in external knowledge
- **Prompts & system prompts** — how to instruct and constrain the model
- **Tools, MCP (Model Context Protocol), APIs** — connecting models to the world
- **Agents & skills** — composing capabilities into autonomous workflows
- **Headless mode** — running AI without a GUI for automation

Effective AI use depends on understanding how **temporary context**, **saved memory**,
**retrieval**, and **tooling** interact.

## Evolution of human–AI collaboration

| Year | Paradigm |
|------|----------|
| 2023 | Chat-based assistance |
| 2024 | Coding assistants |
| 2025–2026 | Agentic AI workflows |

The workflow shifts from "user directly writes code" toward "user manages agents that work
across a codebase and multiple tasks."

## Proposed research-project structure

A practical layout for AI-assisted research:

- **Main workspace** — global state and configuration
- **Task folders** — active execution environments
- **Recycled / archive folders** — failed or deprecated work
- **Dashboard files** (`main_dashboard.md`, `task_XX_dashboard.md`) — track progress, results,
  and decisions
- **System prompts** (`CLAUDE.md`, setup prompts) — define project rules and workflow expectations

## Core workflow principle

> Break one difficult task into several easier steps.

LLM performance drops when a prompt is too broad or vague, but improves when tasks are
decomposed and prompts are **precise and concise**. The research-coding spectrum runs from
precise coding, to LLM workflow management, to vague prompting — the best results come from
combining code-level precision with LLM-assisted iteration.

## Toward further automation

Agents can implement tasks, check plans, evaluate results, run massive tests, and compare
outputs. A possible research automation loop includes:

1. Browse arXiv for new papers
2. Grade and filter papers
3. Share results through Discord
4. Let the user approve plans and results before moving to the next task

## Takeaway

"Vibe researching" is a structured approach to using LLMs as research workflow partners:
organize memory, define prompts and rules, decompose tasks, use dashboards, test multiple
agents, and **keep the human in charge of judgment and approval**.
