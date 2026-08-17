---
title: "More is Universal: An Introduction to Conformal Field Theory"
date: 2026-08-17T15:30:00-04:00
draft: false
math: true
tags: ["Conformal Field Theory", "Critical Phenomena", "Universality", "Renormalization Group", "Wilson-Fisher Fixed Point", "Operator Product Expansion", "Conformal Bootstrap", "3D Ising", "Radial Quantization", "State-Operator Correspondence", "Transverse Field Ising Model"]
categories: ["Journal Club"]
---

| | |
|---|---|
| **Presenter** | You-Chiuan (Andy) Chen (Prof. Ribhu Kaul's group, Penn State) |
| **Date** | August 17, 2026 · 5:00–6:00 PM |
| **Location** | Davey 339 |
| **Topic** | An introduction to conformal field theory — Lecture I |

Lecture I of a two-part introduction to conformal field theory, told from the
condensed-matter side. The organising question: a critical $\phi^4$ theory is strongly
interacting and we cannot solve it — so what can symmetry alone tell us? The answer runs
from the emergent scale invariance at a fixed point, through the conformal group and the
correlators it fixes, to the operator product expansion and the bootstrap, where crossing
symmetry plus unitarity pin the 3D Ising critical exponents to six digits without ever
evaluating a path integral. A preview of radial quantization closes the session.

<!--more-->

{{< pdf src="cft-introduction.pdf" title="Download slides (PDF)" >}}

## Part 1 — Criticality and universality

### The problem: an interacting theory we cannot solve

Start from the standard continuum description of a scalar order parameter,

$$
S[\phi] = \int \mathrm{d}^dx \left[ \frac{1}{2}(\partial_\mu\phi)^2 + \frac{r}{2}\phi^2
+ \frac{u}{4!}\phi^4 - h\phi \right],
$$

with $r$ the tuning parameter, $u$ the interaction, $h$ an external field. At $h = 0$ the
action carries a $\mathbb{Z}_2$ symmetry $\phi \mapsto -\phi$.

The classical strategy is stationary action, $\delta S/\delta\phi = 0$, giving
$-\partial^2\phi + r\phi + \frac{u}{3!}\phi^3 - h = 0$, which for a uniform saddle collapses
to $r\phi + \frac{u}{3!}\phi^3 - h = 0$. That provides candidate equilibrium configurations
and the mean-field phase structure — and misses exactly what we care about: fluctuations
around the saddle, and the physics of the continuous transition as $r \to 0$.

### Scale invariance is emergent, not imposed

Write the local fluctuation $\delta\phi(x) = \phi(x) - \langle\phi\rangle$ and its correlator
$G(x) = \langle\delta\phi(0)\,\delta\phi(x)\rangle$. Away from criticality a finite correlation
length permits exponential decay, $G(x)\sim e^{-|x|/\xi}$. At the transition $r\to 0$,
however, $\xi \to \infty$, and the RG argument says scale invariance is present at the
critical point. Under $\tilde{x} = \lambda x$,

$$
[\delta\tilde\phi(\tilde x)] = \lambda^{-\Delta_\phi}[\delta\phi(x)]
\qquad\Longrightarrow\qquad
G(\lambda x) = \lambda^{-2\Delta_\phi} G(x),
$$

with $\Delta_\phi$ the scaling dimension. The exponential is gone; a power law replaces it.

### Wilson–Fisher, and what universality means

The RG reorganises the problem as *microscopic theory* → (coarse grain and rescale) → *RG
flow* → (long distances) → *fixed point*. In $d = 4-\epsilon$ the dimensionless quartic
coupling flows as

$$
\beta(g) = -\epsilon g + A g^2 + \mathcal{O}(g^3), \qquad A > 0,
$$

with a non-Gaussian fixed point at $g_* = \epsilon/A + \mathcal{O}(\epsilon^2)$. Different
microscopic systems flow to the same fixed point and therefore share the same scaling
dimensions and critical exponents — **universality**.

### Symmetry already solves part of the theory

Suppose $h=0$ and the state preserves $\mathbb{Z}_2$. Then
$\langle\phi\rangle = \langle-\phi\rangle = -\langle\phi\rangle \Rightarrow \langle\phi\rangle = 0$,
and more generally every odd correlator vanishes,
$\langle\phi(x_1)\phi(x_2)\cdots\phi(x_{2n+1})\rangle = 0$. Exact information about
observables, with the partition function never evaluated. (The conclusion assumes a
$\mathbb{Z}_2$-invariant state; a chosen symmetry-broken vacuum may have
$\langle\phi\rangle \neq 0$.)

Stack the symmetries and the unknowns keep shrinking:

| Symmetry | What it tells us |
|---|---|
| $\mathbb{Z}_2$ | Selection rules: odd correlators vanish |
| Translations and rotations | Correlators depend only on relative geometry |
| Scale invariance | Correlators acquire power-law behaviour |
| Conformal invariance | Two- and three-point functions strongly constrained; four-point functions obey consistency conditions |

Which sets up the question the rest of the lecture answers: **can an enlarged symmetry
determine the critical theory without solving the underlying field theory?**

## Part 2 — Conformal transformations

### The defining condition

A map $\mathcal{M}: x^\mu \mapsto \tilde{x}^\mu$ is conformal when

$$
\tilde{g}_{\rho\sigma}(\tilde x)\,\frac{\partial \tilde x^\rho}{\partial x^\mu}
\frac{\partial \tilde x^\sigma}{\partial x^\nu} = \Omega^2(x)\, g_{\mu\nu}(x),
$$

i.e. $\mathrm{d}\tilde s^2 = \Omega^2(x)\,\mathrm{d}s^2$. Because every inner product picks up
the *same* local factor, the normalised ratio defining an angle is unchanged: lengths and
areas may distort, intersection angles may not. Locally a conformal map is a rotation
followed by a position-dependent rescaling.

### One equation for the infinitesimal maps

Take $\tilde x^\mu = x^\mu + \epsilon^\mu(x)$ with $\Omega^2 = 1 + 2\sigma(x)$. To first order
the metric condition reads $\partial_\mu\epsilon_\nu + \partial_\nu\epsilon_\mu = 2\sigma\eta_{\mu\nu}$,
and its trace fixes $\sigma = \frac{1}{d}\partial_\rho\epsilon^\rho$, leaving the **conformal
Killing equation**

$$
\partial_\mu \epsilon_\nu + \partial_\nu \epsilon_\mu = \frac{2}{d}(\partial\cdot\epsilon)\,\eta_{\mu\nu}.
$$

For $d \geq 3$ the integrability conditions make $\sigma$ affine, so $\epsilon^\mu$ is at most
quadratic:

$$
\epsilon^\mu(x) = a^\mu + \omega^\mu{}_\nu x^\nu + \lambda x^\mu + 2(b\cdot x)x^\mu - b^\mu x^2,
\qquad \omega_{\mu\nu} = -\omega_{\nu\mu},
$$

with $a^\mu$ a translation, $\omega_{\mu\nu}$ a rotation, $\lambda$ a dilatation, and $b^\mu$ a
**special conformal transformation** (SCT). In $d=2$ these generate the *global* conformal
subgroup only — local conformal transformations there form an infinite-dimensional symmetry,
which is what makes two dimensions special (and is the subject of the next lecture).

### Four generators, three easy exponentials, one that is not

$$
P_\mu = -\mathrm{i}\partial_\mu, \qquad
L_{\mu\nu} = \mathrm{i}\left(x_\mu\partial_\nu - x_\nu\partial_\mu\right), \qquad
D = -\mathrm{i}\,x^\mu\partial_\mu, \qquad
K_\mu = -\mathrm{i}\left(2x_\mu x^\nu\partial_\nu - x^2\partial_\mu\right).
$$

Exponentiating the first three is immediate: translations $\tilde x = x + a$ and rotations
$\tilde x = Rx$ have $\Omega^2 = 1$ (they are isometries), dilatations $\tilde x = \lambda x$
have $\Omega^2 = \lambda^2$ (one constant rescaling everywhere). The SCT is the one with a
*position-dependent* scale factor, and it is built from inversion $I : x^\mu \mapsto x^\mu/x^2$
as the composition $I \circ T_{-b} \circ I$:

$$
\tilde x^\mu = \frac{x^\mu - b^\mu x^2}{1 - 2b\cdot x + b^2x^2},
\qquad
\Omega(x) = \frac{1}{1 - 2b\cdot x + b^2 x^2}.
$$

It is convenient to name the denominator $\sigma_b(x) = 1 - 2b\cdot x + b^2x^2$, so
$\Omega = \sigma_b^{-1}$.

## Part 3 — Defining a conformal field theory

### Primaries transform homogeneously

A primary operator $\mathcal{O}_a(x)$ of scaling dimension $\Delta$ transforms with the local
scale factor and nothing else:

$$
\tilde{\mathcal{O}}_a(\tilde x) = \Omega(x)^{-\Delta} D[R(x)]_a{}^b\,\mathcal{O}_b(x),
$$

the matrix $D[R(x)]$ accounting for spin. For a scalar primary this is simply
$\tilde\phi(\tilde x) = \Omega(x)^{-\Delta}\phi(x)$: $\Delta$ measures how the local operator
responds to a local change of length scale.

| Transformation | Coordinates | Scalar primary |
|---|---|---|
| Translation | $\tilde x^\mu = x^\mu + a^\mu$ | $\tilde\phi(\tilde x) = \phi(x)$ |
| Rotation | $\tilde x^\mu = R^\mu{}_\nu x^\nu$ | $\tilde\phi(\tilde x) = \phi(x)$ |
| Dilatation | $\tilde x^\mu = \lambda x^\mu$ | $\tilde\phi(\tilde x) = \lambda^{-\Delta}\phi(x)$ |
| Special conformal | $\tilde x^\mu = (x^\mu - b^\mu x^2)/\sigma_b(x)$ | $\tilde\phi(\tilde x) = \sigma_b(x)^{\Delta}\phi(x)$ |

Each operator insertion in an $n$-point function $G_n = \langle\phi_1(x_1)\cdots\phi_n(x_n)\rangle$
contributes one such factor,

$$
\tilde G_n(\tilde x_1,\dots,\tilde x_n) = \prod_{i=1}^{n}\Omega(x_i)^{-\Delta_i}\,G_n(x_1,\dots,x_n),
$$

and this becomes a *constraint* because the transformed and original correlators describe the
same physical function.

### Two points: three symmetries almost do it, the SCT finishes

For two scalar primaries with dimensions $\Delta_1,\Delta_2$ and $x_{12} = x_1-x_2$: translation
invariance gives $G_{12} = F(x_{12})$, rotation invariance $F = f(|x_{12}|)$, and dilatation
covariance $f(\lambda|x_{12}|) = \lambda^{-(\Delta_1+\Delta_2)}f(|x_{12}|)$ — so the only
possible answer is a power law $C_{12}/|x_{12}|^{\Delta_1+\Delta_2}$.

The SCT then decides which power laws survive. Pairwise distances transform as
$|\tilde x_{12}|^2 = |x_{12}|^2/[\sigma_b(x_1)\sigma_b(x_2)]$, so the candidate power law
produces *equal* powers of $\sigma_b(x_1)$ and $\sigma_b(x_2)$, while covariance demands
$\Delta_1$ and $\Delta_2$ separately. Hence

$$
\langle \phi_i(x_1)\phi_j(x_2)\rangle =
\begin{cases}
\dfrac{C_{ij}}{|x_{12}|^{2\Delta}}, & \Delta_i = \Delta_j = \Delta,\\[2ex]
0, & \Delta_i \neq \Delta_j,
\end{cases}
$$

and within operators of equal dimension the two-point matrix can be diagonalised and normalised
to $C_{ij} = \delta_{ij}$.

### Three points: scale invariance is not enough, conformal invariance is

With three distances, the power-law ansatz $G_{123} = C_{123}/(|x_{12}|^\alpha|x_{23}|^\beta|x_{31}|^\gamma)$
gets only *one* equation from scale covariance, $\alpha+\beta+\gamma = \Delta_1+\Delta_2+\Delta_3$.
Matching the local scale factor at each insertion under an SCT gives three:
$\alpha+\gamma = 2\Delta_1$, $\alpha+\beta = 2\Delta_2$, $\beta+\gamma = 2\Delta_3$. Therefore

$$
G_{123} = \frac{C_{123}}
{|x_{12}|^{\Delta_1+\Delta_2-\Delta_3}\,|x_{23}|^{\Delta_2+\Delta_3-\Delta_1}\,|x_{31}|^{\Delta_3+\Delta_1-\Delta_2}}.
$$

Conformal symmetry has fixed all the position dependence of scalar two- and three-point
functions. What it leaves behind are numbers: the dimensions $\Delta_i$ and the three-point (OPE)
coefficients $C_{ijk}$. Together $\{\Delta_i, C_{ijk}\}$ are **the CFT data** — the local
dynamical content of the theory.

## Part 4 — OPE and the conformal bootstrap

### Fusion

When two local operators approach one another, their product can be written as a sum of local
operators at a single point,

$$
\mathcal{O}_i(x)\,\mathcal{O}_j(0) \sim \sum_k f_{ij}{}^k(x)\,\mathcal{O}_k(0).
$$

From far away two nearby insertions cannot be resolved separately, and their combined effect is
reproduced by every local operator the symmetries allow. Scaling fixes the distance dependence,
$f_{ij}{}^k(\lambda x) = \lambda^{\Delta_k-\Delta_i-\Delta_j}f_{ij}{}^k(x)$, so for scalars

$$
\mathcal{O}_i(x)\mathcal{O}_j(0) = \sum_k C_{ijk}\,|x|^{\Delta_k-\Delta_i-\Delta_j}
\left[\mathcal{O}_k(0) + \text{descendants}\right],
$$

with conformal symmetry fixing the relative descendant contributions — the undetermined
information is $\Delta_k$, the spin of $\mathcal{O}_k$, and $C_{ijk}$.

Symmetry restricts the channels before any calculation. In the Ising universality class,
$\sigma \mapsto -\sigma$ and $\epsilon \mapsto \epsilon$, so
$\sigma\times\sigma = \mathbf{1} + \sum\mathcal{O}^+$,
$\sigma\times\mathcal{O}^+ = \sum\mathcal{O}^-$,
$\mathcal{O}^+\times\mathcal{O}^+ = \mathbf{1} + \sum\mathcal{O}^+$; in particular
$\sigma\times\sigma = \mathbf{1} + \epsilon + \epsilon' + T_{\mu\nu} + \cdots$. Note that a
fusion rule specifies which symmetry *sectors* may appear — the OPE need not contain only
finitely many operators.

### Four points: the first function symmetry does not fix

Four points admit two conformal cross-ratios, and the four-point function is only determined up
to a function of them:

$$
\langle\phi(x_1)\phi(x_2)\phi(x_3)\phi(x_4)\rangle
= \frac{\mathcal{G}(u,v)}{|x_{12}|^{2\Delta_\phi}|x_{34}|^{2\Delta_\phi}},
\qquad
u = \frac{x_{12}^2x_{34}^2}{x_{13}^2x_{24}^2},\quad
v = \frac{x_{14}^2x_{23}^2}{x_{13}^2x_{24}^2}.
$$

$\mathcal{G}(u,v)$ carries genuine dynamical information — but the OPE lets us compute it in more
than one way. Fusing the pairs $(12)(34)$ (the $s$-channel) and $(14)(23)$ (the $t$-channel) are
two expansions of the *same* object, so they must agree.

In the $(12)(34)$ channel,

$$
\mathcal{G}(u,v) = \sum_{\mathcal{O}\in\phi\times\phi} C_{\phi\phi\mathcal{O}}^2\,
g_{\Delta_\mathcal{O},\ell_\mathcal{O}}(u,v),
$$

where the **conformal block** $g_{\Delta,\ell}$ packages a primary together with every descendant
in its multiplet, and is fixed by conformal symmetry once $\Delta$ and $\ell$ are given. The block
is universal kinematics; the spectrum and the $C_{\phi\phi\mathcal{O}}$ are the theory.

### Crossing symmetry is OPE associativity

Equating the two channels gives the **crossing equation**

$$
0 = \sum_{\mathcal{O}} C_{\phi\phi\mathcal{O}}^2
\left[ v^{\Delta_\phi} g_{\Delta_\mathcal{O},\ell_\mathcal{O}}(u,v)
- u^{\Delta_\phi} g_{\Delta_\mathcal{O},\ell_\mathcal{O}}(v,u) \right],
$$

which is nothing but $(\mathcal{O}_1\mathcal{O}_2)\mathcal{O}_3 = \mathcal{O}_1(\mathcal{O}_2\mathcal{O}_3)$:
different orders of local fusion must reconstruct exactly the same correlation functions.

The unknowns $\{\Delta_\mathcal{O}, \ell_\mathcal{O}, C_{ijk}\}$ must then satisfy several
constraints simultaneously — crossing symmetry, unitarity ($C^2_{\phi\phi\mathcal{O}} \geq 0$),
unitarity bounds (lower bounds on $\Delta$ at fixed spin), the internal symmetry (only allowed
representations appear), and local CFT structure (the identity and the stress tensor are
present). The numerical bootstrap asks: can a proposed spectrum satisfy all of them at once?

### The 3D Ising island

For the critical Ising CFT, with a lowest $\mathbb{Z}_2$-odd scalar $\sigma$ and lowest
$\mathbb{Z}_2$-even scalar $\epsilon$ in $\sigma\times\sigma = \mathbf{1} + \epsilon + \cdots$,
crossing and unitarity applied to $\langle\sigma\sigma\sigma\sigma\rangle$ carve a sharp corner
in the allowed region right at the Ising theory. Combining $\sigma$ and $\epsilon$ correlators
with mild spectral-gap assumptions isolates a small allowed **island**:

$$
\Delta_\sigma = 0.5181489(10), \qquad \Delta_\epsilon = 1.412625(10), \qquad
C_{\sigma\sigma\epsilon} = 1.0518537(41).
$$

Six-digit critical exponents for a strongly interacting theory, from consistency conditions
alone.

### Answer to the opening question

The lecture began with an interacting critical theory, $\phi^4 \to$ Wilson–Fisher fixed point.
Conformal symmetry reorganises it: *equations of motion* $\to$ *CFT data* $\{\Delta_i, C_{ijk}\}$.
The bootstrap then constrains that data:

$$
\text{conformal symmetry} + \text{OPE consistency} + \text{unitarity} \implies
\text{universal critical data}.
$$

More symmetry does not merely simplify the theory — combined with consistency, it can determine
sharply constrained properties of a strongly interacting critical point.

## Part 5 — Radial quantization (preview of Lecture II)

### The punctured plane is a cylinder

In polar coordinates with $\rho = \ln r$ and $\theta \sim \theta + 2\pi$, the punctured plane is
an infinite cylinder, $\mathbb{R}^2\setminus\{0\} \cong \mathbb{R}_\rho\times S^1$, with circles
of constant $r$ becoming constant-$\rho$ slices and $r\to 0 \Longleftrightarrow \rho\to-\infty$.
Each constant-$\rho$ slice is a spatial circle carrying a state
$|\Psi(\rho)\rangle \in \mathcal{H}_{S^1}$: a path integral over the disk inside the circle
prepares it, and a path integral over an annulus evolves it outward. Taking $\rho$ as Euclidean
time, outward radial evolution means increasing $\rho$.

### The Hamiltonian is the dilatation operator

Translation in cylinder time is a scale transformation on the plane,
$\rho \mapsto \rho + \alpha \Longleftrightarrow r \mapsto e^\alpha r$, so radial evolution is
generated by $D$:

$$
|\Psi(\rho_2)\rangle = e^{-(\rho_2-\rho_1)D}|\Psi(\rho_1)\rangle, \qquad H_{\text{cyl}} = D,
\qquad E_\mathcal{O} - E_0 = \Delta_\mathcal{O}.
$$

Scaling dimensions become measurable energy spacings. And since the origin is the infinite past
of the cylinder, inserting a local operator inside the disk prepares a state,

$$
|\mathcal{O}\rangle = \lim_{r\to 0}\mathcal{O}(r\hat n)|0\rangle = \mathcal{O}(0)|0\rangle,
$$

the **state–operator correspondence**. A primary satisfies $D|\mathcal{O}\rangle = \Delta|\mathcal{O}\rangle$
and $K_\mu|\mathcal{O}\rangle = 0$; acting with $P_\mu$ builds descendants at $\Delta + n$ for
level $n$. A conformal multiplet is an energy tower above a primary state.

### The critical Ising chain realizes the cylinder

Take the periodic critical transverse-field Ising chain
$H = -\sum_{j=1}^{N}\left(X_jX_{j+1} + Z_j\right)$, $X_{N+1} = X_1$. The ring of $N$ spins is a
lattice approximation to $S^1$, so for circumference $L$,

$$
E_\alpha(L) - E_0(L) = \frac{2\pi v}{L}\Delta_\alpha + \text{finite-size corrections}
\qquad\Longrightarrow\qquad
\Delta_\alpha \simeq \frac{L}{2\pi v}\left(E_\alpha - E_0\right).
$$

The Ising CFT has three primaries — $\mathbf{1}$ ($\mathbb{Z}_2$-even, $\Delta = 0$),
$\sigma$ (odd, $\tfrac{1}{8}$), $\epsilon$ (even, $1$) — and diagonalising the chain returns
$\Delta_\sigma = 0.1249995$, $\Delta_\epsilon = 0.9999994$, along with the identification of the
leading continuum fields of simple lattice operators, $X_j \leftrightarrow \sigma$ and
$X_jX_{j+1} - Z_j \leftrightarrow \epsilon$ (up to normalisation and higher-dimension
corrections).

### In any dimension

Writing $x^\mu = r n^\mu$ with $n \in S^{d-1}$ gives
$\mathbb{R}^d\setminus\{0\} \cong \mathbb{R}^+\times S^{d-1}$, and $\rho = \ln r$ again turns a
dilatation into a translation. So: a local operator in $\mathbb{R}^d$ ↔ a state in
$\mathcal{H}_{S^{d-1}}$; its scaling dimension ↔ cylinder energy above the vacuum; its rotation
representation ↔ angular momentum on $S^{d-1}$. The spectrum of local CFT operators *is* the
energy spectrum of a quantum theory living on a sphere.

## Next lecture

Radial quantization in full, and two-dimensional CFT — where the local conformal algebra becomes
infinite-dimensional.

## Discussion points

- The whole construction rests on scale invariance being *emergent* at the fixed point, and on
  the (highly non-trivial, and not proven in general) upgrade from scale to conformal invariance.
- Conformal symmetry is kinematics: it fixes where the $x$-dependence goes, and hands back the
  dynamical question in the compressed form $\{\Delta_i, C_{ijk}\}$. The bootstrap is what turns
  consistency into numbers.
- The 3D Ising island is the cleanest advertisement for the method — but note what went into it:
  mixed correlators plus mild gap assumptions, not crossing symmetry alone.
- The state–operator correspondence is the bridge back to condensed matter: it makes scaling
  dimensions something you can extract from exact diagonalisation of a finite critical chain.

## References

1. D. Simmons-Duffin, *TASI Lectures on the Conformal Bootstrap*, [arXiv:1602.07982](https://arxiv.org/abs/1602.07982) (2016)
2. S. Rychkov, *EPFL Lectures on Conformal Field Theory in $D \geq 3$ Dimensions*, [arXiv:1601.05000](https://arxiv.org/abs/1601.05000) (2016)
3. R. Blumenhagen and E. Plauschinn, *Introduction to Conformal Field Theory: With Applications to String Theory*, Lecture Notes in Physics **779**, Springer (2009)
4. J. Cardy, *Scaling and Renormalization in Statistical Physics*, Cambridge Lecture Notes in Physics **5**, Cambridge University Press (1996)
5. F. Kos, D. Poland, D. Simmons-Duffin, and A. Vichi, *JHEP* **08** (2016) 036, [arXiv:1603.04436](https://arxiv.org/abs/1603.04436) — the 3D Ising island
