# Contributing to OrbitLab

Thanks for your interest in OrbitLab. This project is an offline astrodynamics
and trajectory analysis console: orbital element propagation, Porkchop contour
maps, C3 and delta-v budgets, and PQW and IJK transfer projections, powered by
a single UMD computation kernel.

## Ground rules

- Be respectful and constructive. This project follows the Contributor
  Covenant, found in `CODE_OF_CONDUCT.md`.
- Keep the project dependency free. No `node_modules`, build steps, or runtime
  libraries. Node builtins and the `node:test` runner are fine.
- Keep the console offline. No network requests, no CDN assets, no analytics.
- Astrodynamics needs a source. If you change a model, cite the textbook or
  paper and the equation, and state the assumptions the model makes.

## Development setup

Requirements:

- Node.js 22 or newer (the test runner is `node --test`)
- A modern browser for manual verification

```sh
git clone https://github.com/draarivpatel-ui/orbitlab.git
cd orbitlab
node --test
```

Open `index.html` directly, or serve the folder with any static server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## How the code is organised

| File | Role |
| --- | --- |
| `orbit.js` | The computation kernel: constants, vectors, orbital elements, propagation, transfers, and Porkchop sampling (UMD) |
| `app.js` | UI wiring: trajectory console, contour plots, and projection views |
| `index.html`, `style.css` | The console shell and its styling |
| `test.js` | The test suite |

The same `orbit.js` kernel drives the interactive console and the 125-test
suite, so a change in the kernel is visible in both. `orbit.js` is a UMD module,
so `require('./orbit.js')` works in Node and `window.OrbitLab` is available in
the browser. Match that pattern in new modules.

## Coding standards

- Use 2-space indentation and single quotes, matching the surrounding file.
- Prefer `const`, and use `let` only when reassignment is required.
- Keep functions small and single purpose. Name them after what they do.
- No comments that restate the code. Comment the reason, the equation, or the
  non-obvious trade-off.
- Treat em-dashes and en-dashes as a defect in prose and identifiers. Use
  commas, parentheses, or a plain hyphen instead.
- Never swallow errors silently. Fail loudly with an actionable message.
- Keep units explicit. Put them in the name or the constant, never assume.
- Do not mix degrees and radians in one function. Convert at the boundary.

## Testing the kernel

Prefer invariants over snapshots. Angular momentum stays constant in a
two-body propagation, a circular orbit has zero eccentricity, the vis-viva
equation holds at both apses, and a transfer's total delta-v matches the sum of
its two impulsive burns. The suite already uses relative and angular tolerant
comparisons for exactly this reason; keep that style rather than pinning a
single float.

## Opening a pull request

1. Fork the repository and create a branch from `main`.
2. Make your change with tests. Every bug fix should include a regression test
  that fails before your fix.
3. Run the full suite locally: `node --test`.
4. Update documentation where a model, constant, or default changed.
5. Open the PR against `main` with:
   - a short summary of what changed and why,
   - the commands you ran and their result,
   - screenshots for UI and plot changes,
   - the citation and assumptions for any astrodynamics model you touched.
6. Keep the PR small enough to review in one sitting, and respond to review
   promptly.

Commit messages: use a short imperative subject line under 72 characters. Put
the reasoning in the body, not the subject.

## Reporting bugs

Open an issue with the smallest reproduction you can manage: the orbital
elements or transfer setup, the steps you ran, what you expected, and what
happened instead. State the reference value or expected invariant when a result
looks wrong. Security issues follow `SECURITY.md` instead.
