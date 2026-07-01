---
title: "Experimental Realization of Topological Insulator"
date: 2026-06-23T16:00:00-04:00
draft: false
math: true
tags: ["Topological Insulators", "ARPES", "Bi2Se3", "Molecular Beam Epitaxy", "Scanning Tunneling Microscopy", "Experimental"]
categories: ["Journal Club"]
---

| | |
|---|---|
| **Presenter** | Pu Xiao |
| **Date** | June 23, 2026 |
| **Topic** | Experimental Realization of Topological Insulator |
| **Notes** | Slides & PDF below |

A survey of how topological insulators are actually made and measured: from the
band-inversion picture and the 2D/3D material platforms that realize it, to the
experimental probes — ARPES, molecular beam epitaxy, and STM/STS — that reveal and
characterize the protected surface states.

<!--more-->

{{< pdf src="experimental-realization-of-topological-insulator.pdf" title="Download notes (PDF)" >}}

{{< slides src="experimental-realization-of-topological-insulator.pptx" title="Download slides (PPTX)" >}}

## Topological insulators: the band-inversion picture

Starting from an ordinary band insulator, turning on strong spin–orbit coupling can invert
the conduction and valence bands. Restoring the gap in the presence of this inversion forces
gapless, spin-momentum-locked states to appear at the boundary — the hallmark **edge/surface
states** of a topological insulator.

## Material platforms

- **2D TI (quantum spin Hall insulator):** HgTe quantum wells (Bernevig *et al.*, *Science*
  **314**, 1757 (2006); König *et al.*, *Science* **318**, 766 (2007)); InAs/GaSb quantum
  wells; monolayer 1T′-WTe$_2$.
- **3D TI:** Bi$_x$Sb$_{1-x}$ alloys (Fu & Kane, *Phys. Rev. B* **76**, 045302 (2007); Hsieh
  *et al.*, *Nature* **452**, 970 (2008)) and the **Bi$_2$Se$_3$ family** (Zhang *et al.*,
  *Nat. Phys.* **5**, 438 (2009); Xia *et al.*, *Nat. Phys.* **5**, 398 (2009); Chen *et al.*,
  *Science* **325**, 178 (2009)) — a single Dirac cone, large bulk gap, and simple surface
  chemistry made this family the workhorse system for the experiments below.

## Probe 1: ARPES

Angle-resolved photoemission spectroscopy extends the photoelectric effect
($E_{kin} = h\nu - \phi - |E_B|$) to map the occupied band structure directly: measuring the
photoelectron's kinetic energy and emission angle recovers its in-plane crystal momentum,

$$
\mathbf{p}_\parallel = \hbar \mathbf{k}_\parallel = \sqrt{2mE_{kin}}\,\sin\vartheta .
$$

ARPES directly imaged the single **Dirac surface state** of the Bi$_2$Se$_3$ family — the
linear, spin-momentum-locked cone connecting valence and conduction bands at the Kramers
point (Hsieh *et al.*, *Nature* **460**, 1101 (2009); Chen *et al.*, *Science* **325**, 178
(2009)).

## Probe 2: molecular beam epitaxy

Thin films grown by MBE (slow growth rate $\sim 0.2\,\text{nm/min}$, ultra-high vacuum
$\sim10^{-10}\,\text{mbar}$, monitored by RHEED) give atomic-layer control over thickness and
interfaces. Tracking the ARPES spectrum quantum-layer by quantum-layer shows the **2D-to-3D
crossover** in Bi$_2$Se$_3$: the surface Dirac cone only emerges once the film is thick enough
that top and bottom surface states decouple (Zhang, He, Chang *et al.*, *Nat. Phys.* **6**,
584–588 (2010)).

## Probe 3: STM / STS

Scanning tunneling microscopy resolves real-space surface topography from the
tip–sample tunneling current, $I \sim e^{-2\kappa d}$. Scanning tunneling spectroscopy
extends this to energy-resolved measurements — the differential conductance $dI/dV$ at fixed
tip position is proportional to the local density of states,

$$
\left.\frac{dI}{dV}\right|_{V_B} \propto \rho_S(eV)\,T(z,eV) + \int_0^{eV_B} \rho_S(E)\,
\frac{\partial T(eV,E)}{\partial V}\,dE .
$$

## Discussion points

- How robust is the Dirac surface state to non-magnetic vs. magnetic disorder, and how is
  that tested in STS?
- MBE thickness control as a knob for opening a hybridization gap — connection to
  proposals for gapping the surface state deliberately (e.g., for axion electrodynamics).
- What ARPES and STM each see that the other cannot (occupied-only vs. real-space/LDOS).

## References

1. Hasan & Kane, *Rev. Mod. Phys.* **82**, 3045 (2010).
2. Qi & Zhang, *Rev. Mod. Phys.* **83**, 1057 (2011).
3. Bernevig, Hughes & Zhang, *Science* **314**, 1757 (2006).
4. König *et al.*, *Science* **318**, 766 (2007).
5. Hsieh *et al.*, *Nature* **460**, 1101 (2009).
6. Chen *et al.*, *Science* **325**, 178 (2009).
7. Zhang, He, Chang *et al.*, *Nat. Phys.* **6**, 584–588 (2010).
