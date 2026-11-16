---
title: "More is Universal II: State–Operator Correspondence and Two-Dimensional CFT"
date: 2026-11-16T16:30:00-05:00
draft: false
math: true
tags: ["Conformal Field Theory", "Radial Quantization", "State-Operator Correspondence", "Virasoro Algebra", "Central Charge", "Minimal Models", "2D Ising", "Transverse Field Ising Model", "Finite-Size Scaling"]
categories: ["Journal Club"]
---

| | |
|---|---|
| **Presenter** | You-Chiuan (Andy) Chen (Prof. Ribhu Kaul's group, Penn State) |
| **Date** | November 16, 2026 · 4:30–6:00 PM |
| **Location** | Davey 339 |
| **Topic** | An introduction to conformal field theory — Lecture II |

Lecture II of the two-part introduction to conformal field theory (Lecture I:
[More is Universal]({{< relref "2026-08-conformal-field-theory-introduction.md" >}})). The punctured plane is
conformally a cylinder, and on that cylinder the dilatation operator is the Hamiltonian:
cutting a classical Euclidean path integral along circles produces a Hilbert space, local
operators become states, and scaling dimensions become energy gaps. In two dimensions the
conformal algebra becomes infinite-dimensional — two Virasoro algebras with a central charge
$c$ — and the critical Ising model is the $m = 3$ minimal model with $c = \tfrac12$ and three
primaries. The session closed by recovering all of this, to six digits, from the exact
free-fermion spectrum of the periodic transverse-field Ising chain.

<!--more-->

{{< deck src="conformal-field-theory-lecture-ii" label="More is Universal — Lecture II slides" >}}

{{< pdf src="cft-lecture-ii.pdf" title="Download slides — Lectures I & II (PDF)" embed="false" >}}

## Part 1 — Review: global conformal transformations

A map $x \mapsto \tilde x(x)$ is conformal when it changes the metric only by a local scale
factor, $\frac{\partial\tilde x^\rho}{\partial x^\mu}\frac{\partial\tilde x^\sigma}{\partial x^\nu}\delta_{\rho\sigma} = \Omega^2(x)\,\delta_{\mu\nu}$:
angles are preserved, lengths are not. Infinitesimally, $\tilde x^\mu = x^\mu + \epsilon^\mu(x)$
obeys the conformal Killing equation

$$
\partial_\mu\epsilon_\nu + \partial_\nu\epsilon_\mu = \frac{2}{d}(\partial\cdot\epsilon)\,\delta_{\mu\nu}.
$$

For $d \geq 3$ this forces $\epsilon^\mu$ to be at most quadratic,

$$
\epsilon^\mu(x) = a^\mu + \omega^\mu{}_\nu x^\nu + \lambda x^\mu + 2(b\cdot x)x^\mu - b^\mu x^2,
\qquad \omega_{\mu\nu} = -\omega_{\nu\mu},
$$

i.e. translations $P_\mu = -i\partial_\mu$, rotations $L_{\mu\nu} = i(x_\mu\partial_\nu - x_\nu\partial_\mu)$,
dilatation $D = -ix^\rho\partial_\rho$ and special conformal transformations
$K_\mu = -i(2x_\mu x^\rho\partial_\rho - x^2\partial_\mu)$. The key commutators for what follows are

$$
[D, P_\mu] = iP_\mu, \qquad [D, K_\mu] = -iK_\mu:
$$

once $D$ is the Hamiltonian, $P_\mu$ and $K_\mu$ raise and lower the energy. A finite SCT is
inversion–translation–inversion, $\tilde x^\mu = (x^\mu - b^\mu x^2)/(1 - 2b\cdot x + b^2x^2)$.
In $d = 2$ these four families are only the *global* subgroup — local conformal symmetry is
infinite-dimensional.

## Part 2 — From flat space to the cylinder

Beyond the continuous global transformations there are two different kinds of extension:
reflections (which enlarge the identity component to the full conformal group), and — the one
that matters here — a change of *description*. With polar coordinates and

$$
\rho = \ln\frac{r}{R}, \qquad
ds^2 = dr^2 + r^2d\theta^2 = R^2e^{2\rho}\left(d\rho^2 + d\theta^2\right),
$$

the punctured plane is Weyl-equivalent to an infinite cylinder: $0 < r < \infty$ becomes
$-\infty < \rho < \infty$, circles $r = $ const become slices $\rho = $ const. In general
dimension, $x^\mu = rn^\mu$ with $n \in S^{d-1}$ gives

$$
\mathbb{R}^d\setminus\{0\} \cong \mathbb{R}_\rho \times S^{d-1}.
$$

Rewriting the generators in cylinder coordinates ($x^\mu = Re^\rho n^\mu$, with
$\nabla^{(S)}_\mu$ the derivative tangent to the sphere):

$$
P_\mu = -\frac{ie^{-\rho}}{R}\left(n_\mu\partial_\rho + \nabla^{(S)}_\mu\right), \qquad
K_\mu = -iRe^{\rho}\left(n_\mu\partial_\rho - \nabla^{(S)}_\mu\right), \qquad
D = -i\partial_\rho .
$$

Rotations stay tangent to the sphere, $P$ and $K$ mix radial and angular directions, and
dilatation acts only along $\rho$: $r \mapsto e^\alpha r \Longleftrightarrow \rho \mapsto \rho + \alpha$.
With the dimensionful cylinder time $\tau = R\rho$,

$$
H_{\text{cyl}} = \frac{D}{R}.
$$

## Part 3 — Radial quantization and the state–operator correspondence

### A Hilbert space from a classical path integral

Start from a two-dimensional *classical* critical statistical field theory — no quantum
interpretation assumed. Cut the plane along the circle $r = R$ with boundary configuration
$\phi(R,\theta) = \varphi(\theta)$. Integrating over the interior defines a wavefunctional,

$$
\Psi^{\text{in}}_R[\varphi] = \int_{\phi(R,\theta) = \varphi(\theta)} \mathcal{D}\phi\;
e^{-S_{r<R}[\phi]} \prod_{r_i<R}\mathcal{O}_i(r_i,\theta_i)
= \langle\varphi|\Psi_{\text{in}}(R)\rangle,
$$

the exterior defines a bra, and gluing gives the inner product
$\langle\Psi_{\text{out}}|\Psi_{\text{in}}\rangle = \int\mathcal{D}\varphi\,\Psi^{\text{out}}_R[\varphi]^*\Psi^{\text{in}}_R[\varphi]$.
States are functionals of fields on the circle; reflection positivity makes the inner product
positive.

The path integral over an annulus $r_1 < r < r_2$ is a kernel $K_{r_2,r_1}[\varphi_2,\varphi_1]$,
and gluing annuli composes them — a transfer matrix. Since radial rescaling is translation in
$\rho$,

$$
K_{\rho_2,\rho_1} = e^{-(\rho_2-\rho_1)D}:
$$

the annulus is classical transfer, but $D$ is a Euclidean-time generator.

### Operators are states

The empty disk prepares the vacuum $|0\rangle \in \mathcal{H}_{S^1}$. A disk containing a local
operator prepares a new state, and since the origin is the infinite past of the cylinder,

$$
|\mathcal{O}\rangle = \lim_{r\to0}\mathcal{O}(r,\theta)|0\rangle = \mathcal{O}(0)|0\rangle .
$$

Radial conjugation exchanges origin and infinity: for a Hermitian scalar primary,
$\mathcal{O}(r,\theta)^{\dagger_{\text{rad}}} = r^{-2\Delta_\mathcal{O}}\mathcal{O}(r^{-1},\theta)$, so
$\langle\mathcal{O}| = \lim_{r\to\infty} r^{2\Delta_\mathcal{O}}\langle0|\mathcal{O}(r\hat n)$ and the
state norm is the two-point coefficient. Under this conjugation $D^\dagger = D$ and
$P_\mu^\dagger = K_\mu$.

Inserting a complete set of $D$ eigenstates into a cylinder two-point function,

$$
\langle0|\mathcal{O}_2(\theta_2)\,e^{-(\rho_2-\rho_1)D}\,\mathcal{O}_1(\theta_1)|0\rangle
= \sum_n \langle0|\mathcal{O}_2|n\rangle\langle n|\mathcal{O}_1|0\rangle\, e^{-(\rho_2-\rho_1)\Delta_n},
$$

and each term is just $(r_2/r_1)^{-\Delta_n}$: **power-law scaling on the plane is exponential
Euclidean-time decay on the cylinder**, with $E_n - E_0 = \Delta_n/R_{\text{cyl}}$.

### Primaries are the bottoms of towers

A primary state obeys $D|\mathcal{O}\rangle = \Delta_\mathcal{O}|\mathcal{O}\rangle$ and
$K_\mu|\mathcal{O}\rangle = 0$; its descendants $P_{\mu_1}\cdots P_{\mu_n}|\mathcal{O}\rangle$ sit
at $\Delta_\mathcal{O} + n$. Because $P^\dagger_\mu = K_\mu$, the primary is the lowest state of its
conformal energy tower.

| Flat-space CFT | Cylinder quantum theory |
|---|---|
| local operator | state on $S^{d-1}$ |
| Euclidean correlation function | quantum matrix element |
| scaling dimension $\Delta$ | energy gap $\Delta/R$ |
| rotation representation | angular momentum on $S^{d-1}$ |
| primary / descendant operator | lowest / excited state in a conformal tower |
| two-point coefficient | state norm |

The spectrum of local CFT operators *is* the energy spectrum of a quantum theory on a sphere.

## Part 4 — Two-dimensional CFT

### From the global algebra to Witt

With $z = x + iy$, the six global generators split into holomorphic and antiholomorphic triples,
$\ell_{-1} = -\partial_z$ (translation), $\ell_0 = -z\partial_z$ (dilatation + rotation),
$\ell_1 = -z^2\partial_z$ (SCT), and their barred copies. But in two dimensions the conformal
condition is locally just Cauchy–Riemann, so *any* holomorphic $\tilde z = f(z)$ is conformal.
Expanding $\epsilon(z) = \sum_n \epsilon_n z^{n+1}$ with $\ell_n = -z^{n+1}\partial_z$ gives the
Witt algebra

$$
[\ell_m, \ell_n] = (m-n)\,\ell_{m+n}, \qquad [\bar\ell_m,\bar\ell_n] = (m-n)\,\bar\ell_{m+n},
\qquad [\ell_m,\bar\ell_n] = 0 .
$$

Only $n = -1, 0, 1$ are globally nonsingular (the Möbius group); the rest are local.

### Virasoro and the central charge

Conservation and tracelessness of the stress tensor give $\partial_{\bar z}T = 0$,
$\partial_z\bar T = 0$, so $T(z) = \sum_n L_n z^{-n-2}$, with contour charges
$L_n = \oint\frac{dz}{2\pi i}z^{n+1}T(z)$ — the integration circle is a constant-time slice of radial
quantization. Quantum mechanically the Witt algebra acquires a central extension:

$$
[L_m, L_n] = (m-n)L_{m+n} + \frac{c}{12}\,m(m^2-1)\,\delta_{m+n,0},
$$

with a commuting copy $\bar L_n$ at $\bar c$. The central term vanishes for $m,n \in \{-1,0,1\}$, so
the global algebra is untouched. A Virasoro primary $|h,\bar h\rangle$ has
$L_0|h,\bar h\rangle = h|h,\bar h\rangle$, $L_{n>0}|h,\bar h\rangle = 0$, with

$$
\Delta = h + \bar h, \qquad s = h - \bar h,
$$

and its tower now includes all $L_{-n}$, $n \geq 2$, not only the derivatives $L_{-1}$.

### On the cylinder

With $z = e^w$, $w = \rho + i\theta$, the zero modes generate cylinder translations:
$D = L_0 + \bar L_0$, $J = L_0 - \bar L_0$. Mapping to a cylinder of radius $R$ via $z = e^{w/R}$,
the stress tensor picks up a Schwarzian term,
$T_{\text{cyl}}(w) = \frac{1}{R^2}\left[z^2T_{\text{plane}}(z) - \frac{c}{24}\right]$, so

$$
H_{\text{cyl}} = \frac{1}{R}\left(L_0 + \bar L_0 - \frac{c}{12}\right), \qquad
E_0^{\text{CFT}} = -\frac{c}{12R}, \qquad P_{\text{cyl}} = \frac{L_0 - \bar L_0}{R}.
$$

The conformal anomaly fixes a universal vacuum-energy shift between plane and cylinder.

### Ising is the $m = 3$ minimal model

Unitary minimal models form a discrete family,

$$
c = 1 - \frac{6}{m(m+1)}, \qquad
h_{r,s} = \frac{\big((m+1)r - ms\big)^2 - 1}{4m(m+1)}, \qquad
1 \leq r \leq m-1,\; 1 \leq s \leq m,
$$

with $(r,s) \sim (m-r, m+1-s)$. For $m = 3$: $c = \tfrac12$ and only $h \in \{0, \tfrac{1}{16}, \tfrac12\}$
survive. In the diagonal Ising CFT:

| Field | $h = \bar h$ | $\Delta$ | $\mathbb{Z}_2$ |
|---|---|---|---|
| identity $\mathbf{1}$ | $0$ | $0$ | even |
| spin $\sigma$ | $\tfrac{1}{16}$ | $\tfrac18$ | odd |
| energy $\epsilon$ | $\tfrac12$ | $1$ | even |

with fusion rules $\sigma\times\sigma = \mathbf{1} + \epsilon$, $\sigma\times\epsilon = \sigma$,
$\epsilon\times\epsilon = \mathbf{1}$. Virasoro symmetry plus consistency leave finitely many
primaries; every other local state lies in their towers.

## Part 5 — The exact Ising chain as a CFT

### What to look for

For a CFT on a circle of circumference $L$ with velocity $v$ and bulk energy density $e_\infty$,

$$
E_{h,\bar h;N,\bar N}(L) = e_\infty L + \frac{2\pi v}{L}\left(h + \bar h + N + \bar N - \frac{c}{12}\right) + o(L^{-1}),
\qquad
P = \frac{2\pi}{L}\left(h - \bar h + N - \bar N\right).
$$

The $1/L$ vacuum term measures $c$, rescaled gaps measure $\Delta$, lattice momentum measures
spin, and integer spacings are descendant levels.

### The chain

$$
H(g) = -\sum_{j=1}^{L}\left(X_jX_{j+1} + gZ_j\right), \qquad X_{L+1} = X_1,
\qquad \mathcal{P} = \prod_j Z_j,
$$

critical at $g = 1$. Jordan–Wigner, Fourier and Bogoliubov give
$H = \sum_k \varepsilon_g(k)\left(\gamma_k^\dagger\gamma_k - \tfrac12\right)$ with
$\varepsilon_g(k) = 2\sqrt{1 + g^2 - 2g\cos k}$. At $g = 1$, $\varepsilon(k) = 4\lvert\sin(k/2)\rvert \simeq 2\lvert k\rvert$,
so $v = 2$. No many-body diagonalization is needed.

The Jordan–Wigner boundary term ties fermion boundary conditions to spin parity:
$\mathcal{P} = +1$ is the Neveu–Schwarz (antiperiodic) sector, $k = (2m+1)\pi/L$, containing
$\mathbf{1}$ and $\epsilon$; $\mathcal{P} = -1$ is the Ramond (periodic) sector, $k = 2m\pi/L$,
containing $\sigma$ — the $\mathbb{Z}_2$-odd spin field cannot share a sector with the even ones.

### Reading off the CFT data

- **Central charge.** $E_{\text{NS}}(L) = -2\csc\!\left(\frac{\pi}{2L}\right) = -\frac{4}{\pi}L - \frac{\pi}{6L} + O(L^{-3})$.
  So $e_\infty = -4/\pi$, and matching $-\pi vc/6L = -\pi(2)c/6L$ gives $c = \tfrac12$. A subleading
  correction to a lattice ground-state energy measures the central charge.
- **Spin field.** $E_{\text{R}}(L) = -2\cot\!\left(\frac{\pi}{2L}\right)$, so
  $E_{\text{R}} - E_{\text{NS}} = 2\tan\!\left(\frac{\pi}{4L}\right)$ and
  $\Delta_\sigma = \lim \frac{L}{2\pi v}(E_{\text{R}} - E_{\text{NS}}) = \tfrac18$.
- **Energy field.** The lowest physical NS excitation is the pair $k = \pm\pi/L$:
  $E_\epsilon - E_0 = 2\varepsilon(\pi/L) = 8\sin\!\left(\frac{\pi}{2L}\right)$, giving $\Delta_\epsilon = 1$.

### Lattice operators select conformal families

The zero-momentum lattice operators $\hat\sigma_0 = \frac{1}{\sqrt L}\sum_j X_j$ (odd) and
$\hat\epsilon_0 = \frac{1}{\sqrt L}\sum_j\left[Z_j - \langle Z_j\rangle\right]$ (even) acting on
$|0\rangle$ also create descendants. Euclidean evolution filters them out:

$$
|\Psi_\mathcal{O}(\tau)\rangle = \frac{e^{-\tau(H-E_0)}\hat{\mathcal{O}}_0|0\rangle}{\left\lVert e^{-\tau(H-E_0)}\hat{\mathcal{O}}_0|0\rangle\right\rVert}
\xrightarrow{\;\tau\to\infty\;} |\sigma\rangle \text{ or } |\epsilon\rangle .
$$

Choosing $2\pi v\tau_L/L = \tfrac16\ln L$, the fidelity
$F_\mathcal{O}(L) = \lvert\langle\mathcal{O}_L|\Psi_\mathcal{O}(\tau_L)\rangle\rvert^2$ approaches one
for both operators, with infidelities decaying as powers of $L$ — increasing $L$ moves the regulated
insertion toward the origin of the plane.

### The numbers

With $c_{\text{eff}}(L) = -\frac{6L}{\pi v}\left[E_0(L) - e_\infty L\right]$ and
$\Delta_\alpha(L) = \frac{L}{2\pi v}(E_\alpha - E_0)$:

| $L$ | $c_{\text{eff}}$ | $\Delta_\sigma$ | $\Delta_\epsilon$ |
|---|---|---|---|
| 8 | 0.502258 | 0.125403 | 0.993587 |
| 16 | 0.500563 | 0.125101 | 0.998394 |
| 32 | 0.500141 | 0.125025 | 0.999598 |
| 64 | 0.500035 | 0.125006 | 0.999900 |
| CFT | $\tfrac12$ | $\tfrac18$ | $1$ |

The ground-state correction gives $c$, energy gaps give operator dimensions, and
symmetry-resolved insertions identify the conformal families.

## Discussion points

- Nothing quantum was put in: the Hilbert space, the inner product and the Hamiltonian $D$ all
  come out of slicing a classical Euclidean path integral along circles. Reflection positivity is
  what makes it a *bona fide* quantum theory.
- $P_\mu^\dagger = K_\mu$ under radial conjugation is why primaries are lowest-weight states — and
  why unitarity bounds on $\Delta$ (used in Lecture I's bootstrap) are positivity of norms.
- In 2D the jump from Witt to Virasoro is where the physics lives: $c$ is invisible in the global
  algebra but sets both the cylinder Casimir energy and, through unitarity, the discrete list of
  minimal models.
- The finite-size dictionary is a practical tool beyond solvable chains: the same fits of
  $E_0(L)$ and gaps $\times L$ are how one extracts $c$ and $\Delta$ from DMRG or exact
  diagonalization of non-integrable critical models.
- Corrections in the table shrink roughly as $L^{-2}$ — the leading irrelevant operators in the
  chain (identity descendants such as $T^2$ and $\bar T^2$) control how fast lattice data converge.

## References

1. D. Simmons-Duffin, *TASI Lectures on the Conformal Bootstrap*, [arXiv:1602.07982](https://arxiv.org/abs/1602.07982) (2016)
2. S. Rychkov, *EPFL Lectures on Conformal Field Theory in $D \geq 3$ Dimensions*, [arXiv:1601.05000](https://arxiv.org/abs/1601.05000) (2016)
3. R. Blumenhagen and E. Plauschinn, *Introduction to Conformal Field Theory: With Applications to String Theory*, Lecture Notes in Physics **779**, Springer (2009)
4. J. Cardy, *Scaling and Renormalization in Statistical Physics*, Cambridge Lecture Notes in Physics **5**, Cambridge University Press (1996)
