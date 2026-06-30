---
title: "Topological Insulators and the Bulk–Boundary Correspondence"
date: 2026-06-30T12:00:00-04:00
draft: false
math: true
tags: ["Topological Insulators", "Bulk-Boundary Correspondence", "Berry Curvature", "Chern Number", "Quantum Hall Effect", "Edge States"]
categories: ["Journal Club"]
---

| | |
|---|---|
| **Presenter** | Yiyang Jiang |
| **Date** | June 30, 2026 |
| **Venue** | Topology Seminar |
| **Notes** | Typeset & handwritten versions below |

These notes build the **bulk–boundary correspondence** of topological band insulators
from the ground up — from the modern theory of polarization to the protected edge spectrum
and the wider topological zoo. Both the typeset write-up and the original handwritten notes
are attached below.

<!--more-->

{{< pdf src="topological-insulators-bbc-typeset.pdf" title="Download typeset notes (PDF)" >}}

## Abstract

We develop the bulk–boundary correspondence of topological band insulators starting from
the **modern theory of polarization** and the position operator in the Bloch basis. The
quantized Hall conductivity is obtained three equivalent ways — adiabatic pump, Kubo
response, and Boltzmann anomalous velocity — and recast as a **Berry-curvature / Chern-number**
topology via the Gauss map of the Brillouin zone onto the Bloch sphere. The integer quantum
Hall system appears as the first topological insulator, with confinement-induced chiral edge
modes and the velocity-cancellation argument that pins

$$
\sigma_{xy} = \frac{e^2}{h}\, C, \qquad C \in \mathbb{Z}.
$$

The protected edge spectrum is then derived rigorously two ways — the **Dirac (Jackiw–Rebbi)**
domain-wall construction and the **Wilson-loop** spectral flow — before surveying the broader
topological zoo. All illustrations are redrawn in Python.

## Topics covered

- **Modern theory of polarization** — position operator in the Bloch basis, $\hat{r}
  \leftrightarrow i\nabla_k$, Berry connection $A_n(k) = \langle u_n | i\nabla_k | u_n\rangle$.
- **Quantized Hall conductivity**, derived three equivalent ways (adiabatic charge pump,
  Kubo formula, Boltzmann anomalous velocity).
- **Berry curvature & Chern number** as the bulk topological invariant; the Gauss map of the
  BZ onto the Bloch sphere.
- **Integer quantum Hall effect** as the first topological insulator; chiral edge modes from
  confinement; the velocity-cancellation pinning of $\sigma_{xy}$.
- **Bulk–boundary correspondence** — Dirac / Jackiw–Rebbi domain walls and Wilson-loop
  spectral flow.
- **The topological zoo** — 2D/3D topological insulators, Weyl semimetals and Fermi arcs,
  higher-order topological phases.

## Notes

The two PDFs cover the same material — the typeset version above, and the original
handwritten lecture notes here:

{{< pdf src="topological-insulators-bbc-handwritten.pdf" title="Download handwritten notes (PDF)" embed="false" >}}
