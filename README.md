# Fusion Data Viewer

Fusion Data Viewer is an open and flexible tool for browsing HDF5 files and building customizable dashboards. This application was originally developed by Alexei '[keyhell](https://github.com/keyhell)' Zhurba from the [Next Step Fusion](https://nextfusion.org) team.

A hosted version by Next Step Fusion is available at **https://viewer.nextfusion.org/**

## Features

- Works offline as a Progressive Web App (PWA) — installable on desktop or mobile
- Open files from local disk or directly via URL (`?file=<url>`)
- No file upload — files are read locally and never sent to any server
- Fast cached re-open of previously loaded files via browser storage (OPFS)
- Plotly-powered fast and flexible visualizations
- Fully customizable dashboards with multiple plots
- Supports 1D, 2D, and 3D datasets with slice navigation
- Synchronized hover and slice controls across dashboard plots
- Many other small and big features

## Tech Stack

- Vanilla JS + HTML + CSS — no frontend framework, no build step for the app itself
- [h5wasm](https://github.com/usnistgov/h5wasm) for in-browser HDF5 reading via WebAssembly
- [Plotly.js](https://plotly.com/javascript/) for interactive plots
- Service Worker for range-request handling (enables lazy HDF5 access)
- Origin Private File System (OPFS) for persistent local file caching
- Deployed as a static site (e.g. on GitHub Pages, Cloudflare Pages, etc.)

## Getting Started

**Prerequisites:** Node.js >= 20

```bash
git clone https://github.com/Next-Step-Fusion/fusion-data-viewer.git
cd fusion-data-viewer
npm install
npm run build
```

`npm install` runs `prepare`, which sets the local git hooks path to `.githooks/`. `npm run build` also runs `scripts/bump-version.mjs` to generate `version.json` from the latest git commit.

### Run locally

The app requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers (needed for SharedArrayBuffer / h5wasm). Opening `index.html` directly or using a plain static server will not work.

Recommended approach — Cloudflare Pages local dev:

```bash
npx wrangler pages dev . --compatibility-flag=nodejs_compat
```

Any server that sets those two headers also works. Production headers are configured in `_headers` (Cloudflare Pages format).

### Run tests

```bash
npm test
```

## Project Structure

| Directory | Contents |
|-----------|----------|
| `data/` | HDF5 session management (h5wasm wrapper) |
| `storage/` | OPFS file caching |
| `ui/` | Main UI and tree panel |
| `ui/dashboard/` | Dashboard panel and plot cards |
| `viz/` | Plotly render helpers |
| `sw/` | Service worker (range request handling) |
| `scripts/` | Build utilities |
| `tests/` | Unit tests |
| `examples/` | Example HDF5 files |

This is a vanilla JS app — no transpilation or bundling for app source. Changes to JS/CSS/HTML are reflected immediately on page reload. After changes to `sw/sw.js`, hard-refresh or unregister the SW via DevTools > Application > Service Workers.

## Known Limitations

- **h5wasm CDN dependency:** h5wasm is currently loaded from a CDN at runtime. If the CDN is unavailable, file browsing fails. Future work: bundle the library locally.
- **In-memory file loading:** The current approach loads entire files into the in-browser virtual filesystem. Lazy slicing for very large files is planned but not yet implemented.

## Contributing

Contributions are welcome.

1. Fork the repository and create a branch from `main`
2. Make focused, clearly described commits
3. Run `npm test` — all tests must pass
4. Run `npm run build` — must succeed
5. Open a pull request against `main`

For significant changes, open an issue first to discuss the approach.

**Reporting issues:** use the [GitHub issue tracker](https://github.com/Next-Step-Fusion/fusion-data-viewer/issues). Include browser, OS, and steps to reproduce.

## License

This software is free and open source. If you clone, fork, or otherwise use this repository, the original author kindly asks that you credit **Alexei '[keyhell](https://github.com/keyhell)' Zhurba** from **[Next Step Fusion](https://nextfusion.org)**.

This software is provided as-is, without warranty of any kind. The author is not liable for any damages or issues arising from its use. Use it at your own risk.
