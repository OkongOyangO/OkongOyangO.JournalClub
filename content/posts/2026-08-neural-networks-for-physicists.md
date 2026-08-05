---
title: "Neural Networks for Physicists: From One Neuron to Attention"
date: 2026-08-03T16:30:00-04:00
draft: false
math: true
tags: ["Machine Learning", "Neural Networks", "Attention", "Transformers", "Neural Quantum States", "Variational Monte Carlo", "Quantum Geometry", "Hopfield Network", "Boltzmann Machine", "PINN", "Reduced Density Matrix", "Moire Systems"]
categories: ["Journal Club"]
---

| | |
|---|---|
| **Presenter** | Mu-Yang Chen (Prof. Chao-Xing Liu's group, Penn State) |
| **Date** | August 3, 2026 · 4:30–6:00 PM |
| **Location** | Davey 339 |
| **Topic** | Neural networks for physicists — from one neuron to attention |

A three-part pedagogical tour: what a neural network actually is and how it is trained,
what attention adds once the data are sequences, and how both are being used right now in
many-body physics — neural-network wavefunction ansätze optimised by variational Monte
Carlo, and reduced density matrices learned without the wavefunction at all. The organising
claim: a network is a very flexible fitting function, and the physics lives entirely in the
details of how much of it you build in by hand.

<!--more-->

{{< pdf src="nn-for-physicists.pdf" title="Download slides (PDF)" >}}

## Part 1 — Foundations

### Why a physicist should care

The 2024 Nobel Prize in Physics went to Hopfield and Hinton for neural networks, and the
energy function of a Hopfield network *is* the spin-glass energy — not an analogy. Machine
learning now sits inside DFT, lattice QCD, gravitational-wave searches, and phase
classification. Two directions are worth separating: **put physics into the network** to
improve the fit, and **use the network to find physics**.

### Training needs exactly four ingredients

A physicist fitting a pendulum writes down $\theta(t) = \theta_0\cos\omega t$, has one
unknown, and minimises $\sum_i (\theta_i - \theta(t_i))^2$. Machine learning writes down a
generic form with $10^2$–$10^{12}$ parameters whose "basis functions" adapt during the fit,
and minimises the same kind of thing. The recipe:

1. A parametrised function $\hat{y} = f(x;\Theta)$, with $\Theta = \{W^{[\ell]}, b^{[\ell]}\}$
2. A training set $\mathcal{D} = \{(x_\alpha, y_\alpha)\}_{\alpha=1}^{M}$
3. A **loss** $L(\Theta)$ — one number saying how wrong $f$ currently is
4. An **optimiser** — the rule that changes $\Theta$ to make $L$ smaller

Ingredient 2 defines the paradigm: supervised (input/output pairs), unsupervised (only $x$),
reinforcement (act, get reward).

For regression the loss is mean squared error; for classification it is cross entropy,
$L = -\frac{1}{M}\sum_\alpha\sum_c y_{\alpha c}\ln\hat{y}_{\alpha c}$ — squared error would
barely punish a confident wrong answer, while $\ln$ punishes it infinitely. The optimiser
walks downhill, $\Theta \leftarrow \Theta - \eta\nabla_\Theta L$, in flavours GD → SGD (batch
noise helps escape saddles) → momentum → **Adam**, which is what everyone actually uses.

### One neuron, and why it must be nonlinear

The perceptron reports which side of a hyperplane you are on:

$$\hat{y} = \varphi\Big(\sum_i w_i x_i + b\Big)$$

The nonlinearity $\varphi$ is not optional: with $\varphi = \mathrm{id}$, composing layers
gives $W^{[L]}(\cdots W^{[2]}x\cdots) = W_{\text{eff}}x + b_{\text{eff}}$ — a hundred linear
layers collapse to one. ReLU won because $\sigma'$ and $\tanh'$ die for $|x|\gtrsim 4$
(a saturated neuron stops learning), while ReLU has $\varphi' = 1$ on the whole positive axis.

> **The sigmoid is the Fermi function.** Write $x = -\beta(\varepsilon - \mu)$ and
> $\sigma(x) = 1/(1+e^{\beta(\varepsilon-\mu)})$. A sigmoid neuron is one two-state level at
> finite temperature: $\beta\to\infty$ gives a hard yes/no step, finite $\beta$ gives a soft
> decision — and differentiability, which is the only reason we can train it. Boltzmann
> machines are built by running exactly this limit backwards.

### Why can this fit anything?

Two theorems, and only one of them licenses an MLP:

| | Kolmogorov–Arnold (1957) | Cybenko (1989), Hornik (1991) |
|---|---|---|
| result | exact, $=$ | approximate, $<\varepsilon$ |
| number of terms | fixed, $2n+1$ | unbounded $N$ |
| one-variable functions | nowhere differentiable | any non-polynomial |
| fixed before seeing $f$ | the inner $\phi_{q,p}$ | nothing |

Row 3 is forced by Vitushkin (1954): smooth superpositions cannot exist. Universal
approximation also guarantees **nothing outside the training domain**.

### Backpropagation is the chain rule with bookkeeping

The one new object is the error assigned to a neuron, $\Delta_i^{[\ell]} = \partial C/\partial z_i^{[\ell]}$:

$$\Delta^{[L]} = (a^{[L]} - y)\odot\varphi'(z^{[L]}), \qquad
\Delta^{[\ell]} = \big((W^{[\ell+1]})^{\top}\Delta^{[\ell+1]}\big)\odot\varphi'(z^{[\ell]})$$

so that $\partial C/\partial b_i^{[\ell]} = \Delta_i^{[\ell]}$ and
$\partial C/\partial w_{ij}^{[\ell]} = \Delta_i^{[\ell]}a_j^{[\ell-1]}$. Backpropagation starts
at the output error, prediction minus truth, and walks it backwards. The Hadamard product
appears because $\partial a_i^{[\ell]}/\partial z_j^{[\ell]} = \varphi'(z_i^{[\ell]})\delta_{ij}$
is diagonal.

### A pendulum, two ways

The same system, two very different networks — both trained for 5000 epochs in about
10 seconds on a laptop CPU.

**1. Learn a constant.** The known solution sits in the loss; the network outputs $\omega'$.
With 4 parameters and 300 data points it recovers $g' = 9.808954$ against a truth of
$9.81$ — a $0.011\%$ error in 2.1 s. Two honest caveats: the "network" is degenerate (its
output is forced constant in $t$, so 4 parameters represent 1 number), and at
$\eta = 10^{-4}$ the loss curve looks *smoother* but gives $g' = 9.924$, a hundred times worse.

**2. Solve the ODE (PINN).** The network *is* $\theta(t)$, the equation is the loss, and
there is no data at all:

$$L = \frac{1}{M}\sum_i\Big[\tfrac{d^2}{dt^2}\mathrm{NN}(t_i) + \omega_0^2\,\mathrm{NN}(t_i)\Big]^2 + L_{\text{IC}}$$

141 parameters, 50 collocation points. The instructive part is the plateau at epochs
100–1700: the ODE residual is low while the initial-condition term sits at 0.6, because the
network has found $\theta(t)\equiv 0$, which satisfies $\ddot\theta + \omega_0^2\theta = 0$
exactly. Only the initial conditions eventually push it off. **Plotting one lumped loss curve
hides this completely.**

### Hopfield and Boltzmann machines are spin glasses

For $N$ neurons $\sigma_i = \pm 1$ with symmetric $w_{ij}$, the Hopfield energy
$E(\sigma) = -\frac{1}{2}\sum_{i\neq j}w_{ij}\sigma_i\sigma_j - \sum_i b_i\sigma_i$ is exactly
the spin-glass energy — Ising spins renamed neurons, couplings renamed weights. Deterministic
updates $\sigma_i \leftarrow \mathrm{sign}(a_i)$ can only lower $E$, so the dynamics relaxes
into a local minimum. Hebb's rule $w_{ij} = \frac{1}{N}\sum_A \xi_i^A\xi_j^A$ makes each
stored pattern a minimum: **associative memory, addressed by content rather than location**.
Capacity is $P_{\max}\approx 0.138N$, beyond which the minima merge into spin-glass states and
recall fails (Amit–Gutfreund–Sompolinsky 1985).

Switch on the temperature and the update becomes stochastic, $\sigma_i = +1$ with probability
$\sigma(2\beta a_i)$ — the sigmoid again, at inverse temperature $\beta$, with $\beta\to\infty$
recovering Hopfield. At equilibrium the network samples $P(\sigma) = e^{-\beta E(\sigma)}/Z$:
it no longer computes a function, it **generates configurations**. Learning matches
correlations, $\Delta w_{ij} = \eta(\langle\sigma_i\sigma_j\rangle_{\text{data}} - \langle\sigma_i\sigma_j\rangle_{\text{model}})$.
In a restricted Boltzmann machine, integrating out the hidden layer is literally a
renormalisation-group step — stacking such layers is what led to deep learning.

## Part 2 — Attention

### Sequences need something new

An MLP takes a fixed-size vector, but a sentence, a time series, a trajectory, or a set of
particles is a sequence of $T$ tokens with $T$ varying, where what matters is the *relation*
between elements. We want $o_i = \sum_j \alpha_{ij}x_j$ with $\sum_j\alpha_{ij} = 1$, and the
entire design question is where the $\alpha_{ij}$ come from:

1. $\alpha_{ij} = 1/T$ — a plain average; throws everything away
2. $\alpha_{ij} = f(i-j)$ — fixed by separation; this is a **convolution** (a CNN), same kernel whatever the content
3. $\alpha_{ij} = \alpha(x_i, x_j)$ — computed from the content, afresh every time. This is **attention**

### A soft dictionary lookup

A library catalogue stores (key, value) pairs: the key is the subject heading, what makes a
book findable; the value is the book, what you take home; the query is your request in your
own words. An exact match is all-or-nothing, hence not differentiable, hence untrainable. The
fix is to score every key against the query, softmax the scores, and return the weighted blend
of all values — hard retrieval becomes smooth interpolation.

$$q_i = W_Q x_i,\quad k_j = W_K x_j,\quad v_j = W_V x_j,\qquad
\mathrm{Attn}(Q,K,V) = \mathrm{softmax}\Big(\frac{QK^{\top}}{\sqrt{d_k}} + M\Big)V$$

$W_Q, W_K, W_V$ are the only trainable objects; the weights $\alpha_{ij}$ are recomputed for
every input. The causal mask has $M_{ij} = -\infty$ for $j > i$.

**Why three different matrices?** *Key $\neq$ value*: what makes a token findable need not be
what it contributes — tying $W_K = W_V$ would force a token to be retrieved by exactly the
information it passes on. *Query $\neq$ key*: relevance is asymmetric — an adjective looking
for its noun is a different relation from that noun looking back, and $W_Q = W_K$ would make
the score matrix symmetric in $i\leftrightarrow j$, destroying the direction that carries most
of the grammar.

In the worked example "the ball bounced", with embedding axes (noun-ness, verb-ness), the verb
puts $86\%$ of its attention on *ball* — it has found its subject. The cost: the score matrix
is $T\times T$, so attention is $O(T^2)$, which is why context length is expensive.

**Multi-head.** $H$ heads run in parallel and $W_O$ mixes them back to width $d$. Taking
$d_k = d_v = d/H$ makes $H$ heads cost the same as one full-width head — $4d^2$ parameters
either way. A single softmax concentrates on one criterion of relevance at a time; $H$ heads
run $H$ criteria at once (syntax, position, long-range reference) for free.

> Read as physics, $\mathrm{softmax}(QK^\top/\sqrt{d_k})V$ is a Boltzmann average at
> $\beta = 1/\sqrt{d_k}$ — and attention is *built to learn relations*, which is exactly what
> a correlation is.

## Part 3 — Neural networks in physics

The many-body problem: $\dim\mathcal{H}$ grows exponentially. There are two places to spend a
network on it.

- **Route 1 — learn the wavefunction.** $\Psi_\theta(R)$ is the network, optimised by energy
  minimisation, $E_\theta = \langle\Psi_\theta|\hat H|\Psi_\theta\rangle/\langle\Psi_\theta|\Psi_\theta\rangle \geq E_0$.
  Being variational, lower energy is *strictly* better, and there is no training data — the
  Hamiltonian is the supervisor, exactly as in the PINN.
- **Route 2 — skip $\Psi$, learn the RDM.** Most observables need only
  $\langle c^\dagger_{k_1\alpha_1}\cdots c_{k'_1\alpha'_1}\rangle$: the 1-RDM gives every
  symmetry-breaking order parameter, the 2-RDM gives the energy of any two-body $\hat H$. The
  full $\Psi$ is more than you need.

All of what follows uses only the machinery of Parts 1 and 2 — attention, MLPs, gradient descent.

### Fu group: attention builds correlated orbitals

*Geier et al., PRB **112**, 045119 (2025).* **SlaterNet** passes each electron through the same
MLP independently and takes one Slater determinant, $\Psi = \det_{ij}\phi_j(r_i)$ — this is
exactly unrestricted Hartree–Fock, found variationally. The **self-attention NN** adds the
coupling,

$$\Psi(R) = \sum_{m=1}^{N_{\text{det}}}\det_{ij}\phi_j^m\big(r_i;\{r_{/i}\}\big)$$

so the orbital of electron $i$ now depends on where all the others are, produced by
self-attention over the $N$ electron streams — the $Q,K,V$ of Part 2 with **electrons in place
of tokens**. Attention is permutation-equivariant, so the determinant stays antisymmetric and
Fermi statistics survive by construction. Parameters scale as $\sim N^2$, against $e^{\sqrt N}$
for tensor networks.

**Neural-network VMC** is the training loop of Part 1 with two substitutions — the training set
becomes Monte Carlo samples redrawn every step, and the loss becomes the energy itself. The
$3N$-dimensional integral is rewritten as an average,
$E_\theta = \mathbb{E}_{R\sim|\Psi_\theta|^2}[E_{\text{loc}}(R)]$ with
$E_{\text{loc}} = \Psi_\theta^{-1}\hat H\Psi_\theta$: sample $R$ by Metropolis (no
normalisation needed), average $E_{\text{loc}}$ over the batch, update $\theta$, resample.
The zero-variance property means that in an exact eigenstate $E_{\text{loc}}$ is constant, so
the error bar vanishes as $\Psi_\theta\to\Psi_0$.

### Why the quantum geometric tensor enters the optimiser

Plain gradient descent takes the steepest step in *parameter* space — but $\theta$ is
arbitrary, and reparametrising changes which direction is "steepest". What is physical is the
distance between *states*:

$$\|d\theta\|^2 = 1 - |\langle\Psi_{\theta+d\theta}|\Psi_\theta\rangle|^2 = \sum_{nm}g_{nm}\,d\theta_n d\theta_m,
\qquad g_{nm} = \langle\partial_n\Psi|\big(1 - |\Psi\rangle\langle\Psi|\big)|\partial_m\Psi\rangle$$

the quantum geometric tensor (the Fubini–Study metric on projective Hilbert space). Natural
gradient descent, $d\theta = -\eta\,g^{-1}\nabla_\theta E$, is steepest descent on the manifold
of wavefunctions rather than on the coordinate chart, and is invariant under reparametrisation.
Since $g$ is $N_{\text{par}}\times N_{\text{par}}$, inverting it directly is hopeless at $10^5$
parameters: **KFAC** (Fu) approximates $g^{-1}$ layer by layer, **MinSR** (Zhang) works in the
$\leq N_{\text{samples}}$-dimensional subspace instead. Its real part is the quantum metric and
its imaginary part the Berry curvature — the same tensor as in band geometry.

**Does it work?** Benchmarked on a WSe₂/WS₂ moiré system, $3\times 3$ supercell, $\nu = 2/3$:
SlaterNet (= Hartree–Fock) misses correlation entirely, band-projected ED converges *towards*
the attention result from above as more bands are kept and never gets below it, and the gap is
the correlation energy — about $2\%$ here, far larger than in molecules. The honest reading:
this is a variational upper bound, not a proof of exactness. What it shows is that a
general-purpose architecture, given no physics beyond $\hat H$, beats a method that must
truncate the Hilbert space by hand.

### Zhang group: keep the physics form, learn the corrections

*Valenti et al., arXiv:2512.07947* asks whether the anomalous Hall crystal in $\alpha$-jellium
survives quantum fluctuations, using an (MP)²NQS Slater–Jastrow–backflow ansatz

$$\Psi(R,S) = e^{-U(R,S)}\det_{ij}\big[\phi_j\big(r_i + \boldsymbol{\mathcal{N}}_i(R),\sigma_i\big)\big]$$

with four learnable objects, each an old idea: plane-wave coefficients $c^{(jk)}_\sigma$ (the
orbitals never leave the free-electron basis, only the mixing is learned), a backflow shift
$\boldsymbol{\mathcal{N}}_i$ from a message-passing GNN, a two-body Jastrow $u_{\sigma\sigma'}$
in B-splines, and a many-body Jastrow $U_{\text{N.N.}}$ from an MLP. The spinor index carries
the Berry curvature. **Result:** the AHC survives beyond mean field and quantum geometry
*enhances* crystallisation, stable up to an order of magnitude above the $\alpha=0$ critical
density; the sequence HF → SJ → SJBF → NQS moves the liquid–crystal competition from $10^{-2}$
to $10^{-4}$ Ry, so it is not an artefact of the ansatz.

### Two philosophies for the same object

| | Fu (attention) | Zhang ((MP)²NQS) |
|---|---|---|
| starting form | bare Slater determinant | Slater–Jastrow–backflow |
| orbital basis | none — orbitals are network outputs | truncated plane waves |
| where correlation lives | correlated orbitals $\phi_j(r_i;\{r_{/i}\})$ | Jastrow × backflow shift |
| network | self-attention over electrons | message-passing GNN + MLP |
| architectural bias | none — general purpose | the known physics of a good trial state |
| optimiser | KFAC | MinSR |

*Learn everything*: no prior structure — Fu's group finds chiral $p_x+ip_y$ pairing without
ever telling the network about pairing (Li et al., arXiv:2509.03683). *Learn the correction*:
start from a state that already knows about screening and exchange and let the network supply
only what is missing — fewer parameters, faster convergence. This is the trade-off from the
pendulum, one level up.

### Yu group: don't learn Ψ at all — learn the RDM

*Azam, Zhao & Yu, arXiv:2511.07367.* For a gapped state the $n$-RDM is a **smooth function over
the Brillouin zone**, and smooth functions are exactly what networks interpolate well. So train
on a coarse momentum mesh where ED or HF is affordable, then evaluate on a fine mesh you could
never diagonalise. Two architectures: **SIREN**, an MLP with $\sin$ activations mapping
$k\mapsto$ RDM (a coordinate network, not a data-fitter — the same trick as the PINN, choosing a
basis that already resembles the answer, since the target lives on a torus); and a
**self-attention NN** mapping a random RDM onto a physical one.

This is a different game: Routes 1 and 2 both minimise energy, but this is *interpolation* —
the physics input is not a Hamiltonian but the smoothness of a gapped ground state. And unlike
Part 1's caveat about the training domain, here the training domain is the whole Brillouin
zone, so the network is only ever asked to fill in between known points.

- **Prediction** — in the Richardson model of superconductivity, a SIREN trained on a $6\times6$
  mesh predicts the $18\times18$ pair–pair correlation to $94.3\%$; trained instead on 4 tilted
  meshes of 12 points each, $93.8\%$.
- **Acceleration** — using $6\times6$ and $8\times8$ results as the Hartree–Fock initial guess
  cuts iterations by $91.6\%$ for a $50\times50$ translation-invariant HF, and by $92.8\%$ for a
  $30\times30$ translation-breaking one.
- **The catch** — nothing here is variational. An interpolated RDM carries no energy bound, and
  representability must be imposed by hand; the full condition is NP-complete.

*Hart et al., arXiv:2605.20326* build representability in: for twisted bilayer MoTe₂ at the
$\nu = 2/3$ FCI, imposing $N$-representability conditions in both the architecture and the loss
and then optimising the 2-RDM variationally lands $0.104$ meV below ED on a $6\times6$ mesh
using less than $1/20$ the parameters of semidefinite programming. Notable: among six
architectures tested the winner was a plain **residual MLP** — a Kolmogorov–Arnold network
lost. The non-smoothness obstruction from Part 1 has not gone away.

## Discussion points

- Universal approximation says nothing about the domain you did not train on — a point that
  cuts against naive extrapolation claims in every one of these applications.
- The PINN plateau is a general warning: a single lumped loss curve can hide a network sitting
  happily in a trivial solution. Plot the terms separately.
- The variational route gives a bound and a convergence criterion; the RDM route gives speed and
  interpolation but no bound. Which one you want depends on whether you need to *trust* the
  number or merely *produce* it.
- The recurring question to ask of any of this: **how much physics is built in — and therefore,
  how much is the network actually being asked to discover?**

## References

1. Miranda et al., arXiv:2505.13042 — machine learning for physicists, background review
2. Hohm, arXiv:2605.06394 — Hopfield networks, Boltzmann machines, and statistical physics
3. Geier et al., *Phys. Rev. B* **112**, 045119 (2025) — self-attention neural wavefunctions
4. Li et al., arXiv:2509.03683 — chiral $p_x+ip_y$ pairing from a neural ansatz
5. Valenti et al., arXiv:2512.07947 — (MP)²NQS and the anomalous Hall crystal in $\alpha$-jellium
6. Azam, Zhao & Yu, arXiv:2511.07367 — interpolating reduced density matrices across the BZ
7. Hart et al., arXiv:2605.20326 — $N$-representable 2-RDM optimisation for twisted bilayer MoTe₂
8. Amit, Gutfreund & Sompolinsky (1985) — Hopfield storage capacity $P_{\max}\approx 0.138N$
