# Architecture

Fusion Data Viewer is a vanilla JS PWA — no framework, no build step for app source. It runs entirely in the browser and never sends file data to any server.

## Directory Structure

| Path | Contents |
|------|----------|
| `index.html` | App entry point |
| `app.js` | Top-level app init and wiring |
| `styles.css` | Global styles |
| `sw.js` | Service worker (range request handling for h5wasm) |
| `data/` | HDF5 session management (h5wasm wrapper, tree parsing) |
| `storage/` | OPFS file caching (`opfs.js`) and dashboard persistence (`dashboards.js`) |
| `ui/` | All UI components: tree panel, dashboard panel, data view, layout, icons |
| `ui/tree/` | File tree panel |
| `ui/dashboard/` | Dashboard panel and plot cards |
| `ui/dataview/` | Dataset detail / data preview panel |
| `viz/` | Plotly render helpers |
| `dashboard/` | Dashboard data model and logic (separate from UI) |
| `scripts/` | Build utilities (`bump-version.mjs`) |
| `tests/` | Unit tests |

## Key Technical Pieces

**HDF5 reading** — handled client-side by [h5wasm](https://github.com/usnistgov/h5wasm) (WebAssembly). Files are loaded into the in-browser virtual filesystem via the service worker.

**Service worker (`sw.js`)** — intercepts range requests so h5wasm can perform lazy/partial dataset reads without loading the entire file into memory at once.

**OPFS (Origin Private File System)** — files opened by the user are cached in browser storage for fast re-open across sessions.

**Plotly.js** — all visualizations (line plots, scatter plots, heatmaps) are rendered via Plotly. The `viz/` module provides a thin wrapper to standardize plot creation.

**Dashboards** — a dashboard is a serializable list of plot configurations. Saved locally in the browser; references dataset paths but never stores file contents.

## Required Headers

h5wasm requires `SharedArrayBuffer`, which requires:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These are configured in `_headers` (Cloudflare Pages format). A plain static server will not work without setting these headers.
