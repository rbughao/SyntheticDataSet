# Synthetic Dataset Generator by Bughao Lab

A browser-based tool that turns documents, web pages, ebooks, spreadsheets, and source code into fine-tuning Q&A pairs using the LLM provider of your choice. Upload files, pick a provider, click **Generate** — review the results, then export in the schema your training stack expects.

![React](https://img.shields.io/badge/React-18-blue?logo=react) ![Vite](https://img.shields.io/badge/Vite-5-purple?logo=vite) ![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss) ![License](https://img.shields.io/badge/license-MIT-green)

![Review workspace](docs/screenshots/03-review-workspace.png)

<details>
<summary><b>Dark mode</b> — click to expand</summary>

![Review workspace in dark mode](docs/screenshots/03b-review-workspace-dark.png)

</details>

---

## What it does

ML practitioners spend hours hand-labeling training data. This tool automates that by:

1. Reading your source material — documents, web pages, spreadsheets, ebooks, slide decks, or entire source files
2. Splitting long documents into overlapping chunks so nothing is truncated away
3. Sending every chunk to an LLM in parallel with a structured prompt that demands clean JSON
4. Rendering each Q&A pair as an editable card you can review, search, rate, and reorder
5. Exporting in Instruction, ChatML, Alpaca, or ShareGPT schema — with an optional train/validation split

Everything runs in the browser. No backend server, no data leaves your machine except the API calls you authorize.

---

## Features

### Getting material in

| Source | What it does |
|---|---|
| **Upload** | One or more individual files |
| **Folder** | A whole folder including every subfolder, reviewed before import |
| **URL** | Fetches a page and extracts its readable text |
| **Paste** | Raw text straight into the box |

Folder and URL both go through the same reader as a normal upload, so all 68
formats below work from any source.

#### Folder import

Selecting a folder walks every subfolder and opens a review step before
anything is imported — you see what was found, what was excluded and why, and
what generating from the selection would cost.

![Reviewing a folder import](docs/screenshots/09-ingest-review.png)

Excluded automatically, and reported rather than hidden:

- **Possible secrets** — `.env*`, private keys, `credentials.json`, `.pem`/`.p12`/`.key`, anything under `.ssh/` or `.aws/`
- **Build and VCS noise** — `.git/`, `node_modules/`, `dist/`, `__pycache__/`, and similar
- **Unsupported types**, **empty files**, and anything over 5 MB

> Document text is sent to your LLM provider. Excluding secrets by default is
> what stops a folder import from becoming a credential leak — which is why
> secrets are never selectable, not merely unchecked.

Large folders arrive with the first 200 files selected rather than all of them,
so a repository with thousands of files does not silently queue an expensive run.

#### URL import

Fetches the page through the dev CORS proxy and runs it through the normal
reader, so HTML, PDF, Markdown, CSV, JSON and Office documents all work. HTML
has navigation, scripts and chrome stripped before the text is kept.

> URL import needs the dev server's CORS proxy. In a static production build
> `proxyFetch` falls back to a direct request, which most origins refuse — so
> this source works under `npm run dev` unless you host a proxy alongside the app.

#### Supported formats

| Category | Formats |
|---|---|
| **Documents** | `.pdf` `.docx` `.epub` `.pptx` |
| **Text & prose** | `.txt` `.md` `.rst` `.adoc` `.tex` `.org` |
| **Markup** | `.html` `.htm` `.xhtml` `.xml` |
| **Tabular** | `.csv` `.tsv` |
| **Code** | `.py` `.js` `.ts` `.jsx` `.tsx` `.java` `.go` `.rs` `.c` `.cpp` `.cs` `.rb` `.php` `.swift` `.kt` `.scala` `.r` `.lua` `.dart` `.ex` `.clj` `.hs` … |
| **Config & data** | `.json` `.jsonl` `.yaml` `.toml` `.ini` `.sql` `.graphql` `.proto` `.sh` `.ps1` `.log` … |

- Drag-and-drop (including whole folders), file picker, folder picker, URL, or paste
- **Batch processing** — every loaded document is processed automatically, not just the active one
- Long documents are split into overlapping chunks (4,000 chars with 300-char overlap) so the full text is covered

Structured formats get format-aware handling rather than a naive text dump:

- **HTML** strips `script`, `style`, `nav`, `header`, `footer`, and other chrome, preferring `<article>`/`<main>` as the content root
- **CSV/TSV** is rendered as labelled records (`Question: …` / `Answer: …`) instead of comma soup, so the model can tell which value belongs to which column
- **EPUB** follows the OPF spine so chapters come out in reading order, not alphabetical filename order
- **PPTX** extracts per-slide text with numeric slide ordering (slide 10 after slide 2, not between 1 and 2)
- **Code** is chunked on line and block boundaries rather than sentence boundaries, since a period inside `obj.method()` is not a sentence end

If a file parses but yields no usable text — most often a **scanned PDF with no text layer** — the upload fails with a specific message telling you to OCR it, rather than silently adding an empty document that breaks generation later.

### Generation
- **Pair count** — 5 to 10,000 per document
- **Style** — Factual Q&A, Instruction-following, or both
- **Difficulty** — Basic, Intermediate, Advanced
- **Temperature** — Low (0.3), Balanced (0.7), Creative (1.0)
- **Domain tag** — optional label (e.g. `medical`, `legal`) injected into the prompt
- **Parallel requests** — 1 to 10 concurrent API calls, shared across all files

### Cost and time estimate before you commit

Every run shows what it will cost and how long it will take *before* you click Generate — chunk count, token estimates, wall time, and USD based on a per-model price table. Local providers show **Free**; runs above $5 get a warning.

![Pre-flight estimate](docs/screenshots/02-preflight-estimate.png)

### Interface

The UI is built on a semantic design-token system — every colour is a CSS variable, so light and dark are two sets of values rather than two sets of class names.

- **Light, dark, and system themes.** The toggle cycles between them; `system` follows the OS setting live, and the choice persists. The stored theme is applied before React mounts, so dark-mode users get no white flash on load.
- **Editorial typography.** Generated questions are set in a serif display face at a larger size, because reading and judging model output is the app's actual work. All faces are system fonts — no webfont, nothing fetched at runtime.
- **Keyboard shortcuts:**

| Shortcut | Action |
|---|---|
| `⌘/Ctrl` + `K` or `/` | Focus search |
| `⌘/Ctrl` + `Enter` | Generate |
| `⌘/Ctrl` + `E` | Open export |
| `Esc` | Close modal, or clear search |

- Visible focus rings on every interactive element, and `prefers-reduced-motion` is respected.

### Review workspace
- Editable instruction and output textareas (auto-resize)
- **Full-text search** across instructions and outputs
- Filter by type, rating, edited state, quality flags, or duplicates
- Thumbs up / down rating per pair
- Per-card regenerate
- Drag-and-drop reordering (up to 100 pairs)
- Bulk select → delete

![Search and filter](docs/screenshots/06-search-filter.png)

### Duplicate detection

Chunks overlap by design, so near-identical pairs are a structural certainty — and duplicate training examples cause overfitting. A two-pass scan (exact normalized match, then trigram similarity at 0.85) flags them for removal or review.

![Duplicate detection](docs/screenshots/05-duplicates-and-quality.png)

### Quality validation

Heuristic checks flag pairs likely to hurt a fine-tune — empty or truncated outputs, text that is too short, instructions echoed as answers, and answers that leak phrases like *"according to the document"* despite the prompt forbidding it. Issues appear inline on the card; nothing is deleted automatically.

![Quality validation](docs/screenshots/07-quality-validation.png)

### Export

Four schemas, three file formats, and an optional deterministic train/validation split:

| Schema | Shape | Used by |
|---|---|---|
| **Instruction** | `{ instruction, output, type }` | This app's native shape |
| **ChatML** | `{ messages: [{ role, content }] }` | OpenAI, Together, Fireworks |
| **Alpaca** | `{ instruction, input, output }` | Stanford Alpaca, LLaMA-Factory |
| **ShareGPT** | `{ conversations: [{ from, value }] }` | Axolotl, Vicuna |

![Export schemas](docs/screenshots/04-export-schemas.png)

Formats: **JSONL** (fine-tuning standard), **JSON**, **CSV**. Splits: none, 90/10, or 80/20 — emitted as `_train` and `_val` files. You can also export only the pairs you have selected.

### Large output mode

Above 1,000 pairs, rendering every card would freeze the browser. The app switches to direct-to-file mode: pairs stream into a buffer that bypasses React state entirely, a live counter shows progress, and the download fires when generation completes.

![Large output mode](docs/screenshots/08-large-output-mode.png)

### Session persistence

Generation settings persist to `localStorage`; documents and generated pairs persist to IndexedDB. Reload the page and you are offered your previous session back instead of losing a long run.

### Resilience
- **Adaptive context retry** — a chunk that overflows the model's context window is halved and retried, up to three times, instead of failing the run
- **Retry failed chunks** — transient failures (rate limits, timeouts) are tracked so you can re-run only those chunks rather than paying to regenerate the whole dataset
- One failing file never aborts a multi-file batch

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) 18 or later
- npm (comes with Node)

### Install & run

```bash
git clone https://github.com/rbughao/SyntheticDataSet.git
cd SyntheticDataSet
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

To try it with no API key at all, select **Mock (Simulation)** as the provider — it generates pairs locally from your document text.

---

## Usage Guide

### 1 — Load documents

Use the **Upload** tab to drag-and-drop or browse for files, or the **Paste** tab for raw text. Load as many as you like: all of them are processed when you hit Generate.

![Workspace ready](docs/screenshots/01-workspace-ready.png)

### 2 — Choose a provider

Pick a provider in **Settings** and enter your API key in the masked field. Keys are saved per provider on blur.

> **Note:** API keys are stored unencrypted in browser `localStorage`, which is readable by any script running on this origin. That is fine for a local tool; do not use this on a shared or untrusted machine.

### 3 — Configure generation

| Setting | Recommendation |
|---|---|
| Pair count | Start with 10–20 to check quality before scaling up |
| Style | "Factual Q&A" for reference material; "Instruction-following" for procedural content |
| Difficulty | Match your target model's expected capability |
| Temperature | "Balanced" suits most documents |
| Parallel requests | 3 for cloud APIs; 8–10 is safe for local Ollama |

Check the **Estimate** panel before generating — it tells you the cost and duration up front.

### 4 — Generate

Click **Generate Dataset**. All files and all their chunks feed one shared concurrency pool, so multiple documents process simultaneously. Sidebar badges track each file's status.

### 5 — Review

- **Search** to find specific pairs; **filter** by type, rating, flags, or duplicates
- Remove duplicates in one click if the banner appears
- Check anything flagged by quality validation
- **Edit**, **rate**, **regenerate**, or **delete** individual pairs

### 6 — Export

Click **Export**, choose a schema and format, optionally add a train/val split, and download. The modal previews the first record in your chosen schema so you can confirm the shape before committing.

---

## Provider Setup

| Provider | Notes |
|---|---|
| **Mock (Simulation)** | No API key needed — generates pairs locally. Good for testing the workflow |
| **Anthropic** | Requires a CORS proxy in the browser (see below) |
| **OpenAI** | Works directly from the browser |
| **Google Gemini** | Works directly from the browser |
| **Meta (Llama)** | Via Together.xyz, Fireworks AI, or Groq |
| **Chinese Open Weights** | Qwen (Alibaba DashScope) or DeepSeek |
| **Ollama** | Local models, zero cost |
| **Custom** | Any OpenAI-compatible endpoint (vLLM, LM Studio, etc.) |

### Google Gemini (easiest, no proxy)
1. Get an API key from [Google AI Studio](https://aistudio.google.com/)
2. Select **Google Gemini**, paste the key, pick a model

### OpenAI
1. Get an API key from [platform.openai.com](https://platform.openai.com/)
2. Select **OpenAI**, paste the key

### Anthropic (requires a CORS proxy)
Anthropic's API does not send `Access-Control-Allow-Origin` headers for browser requests.

**Option A — run a local CORS proxy:**
```bash
npx cors-anywhere
```
Then set Proxy URL in Settings to `http://localhost:8080/https://api.anthropic.com`.

**Option B — use Google Gemini or Ollama instead** (no proxy needed).

### Ollama (free, local)
```bash
OLLAMA_ORIGINS=* ollama serve
ollama pull llama3.2
```
Select **Ollama (Local)**, keep the default base URL, and type `llama3.2` as the model.

### Custom / vLLM / LM Studio
Select **Custom (OpenAI-compatible)** and enter your base URL including `/v1`, e.g. `http://192.168.1.10:8000/v1`.

Use the **Test** button to verify connectivity and fetch available models. In dev mode all Custom and Ollama requests route through a built-in Vite CORS proxy, so browser CORS restrictions are handled transparently.

---

## Architecture

```
src/
├── index.css                      # Design tokens (light + dark), base styles
├── App.jsx                        # Central state, persistence, filtering, dnd wiring
├── components/
│   ├── DocumentPanel.jsx          # Upload, paste, document list with per-file status
│   ├── SettingsPanel.jsx          # Provider config, generation settings, connection test
│   ├── PreflightEstimate.jsx      # Cost / token / duration estimate
│   ├── GenerateButton.jsx         # Trigger, progress bars, cancel
│   ├── PairCard.jsx               # Editable Q&A card with quality + duplicate badges
│   ├── ThemeToggle.jsx            # Light / dark / system cycle
│   ├── IngestReview.jsx           # Selection + cost gate for bulk import
│   ├── VirtualPairList.jsx        # Windowed list for large datasets
│   ├── WorkspaceHeader.jsx        # Search, filters, bulk actions, export
│   ├── ExportModal.jsx            # Schema + format picker, split, live preview
│   └── LargeOutputModal.jsx       # Direct-to-file format picker (>1000 pairs)
├── hooks/
│   ├── useDocuments.js            # Document loading, parsing, restore
│   ├── useGenerate.js             # Chunk orchestration, concurrency pool, retry
│   ├── useTheme.js                # Theme state, persistence, OS sync
│   ├── useKeyboardShortcuts.js    # Global shortcut bindings
│   └── useExport.js               # Schema conversion + serialization
├── providers/
│   ├── LLMProvider.js             # Abstract base class
│   ├── OpenAICompatibleProvider.js  # Shared OpenAI-format adapter
│   ├── AnthropicProvider.js
│   ├── OpenAIProvider.js
│   ├── GoogleProvider.js
│   ├── MetaProvider.js
│   ├── ChineseOpenWeightsProvider.js
│   ├── OllamaProvider.js
│   ├── CustomProvider.js
│   ├── MockProvider.js            # Offline simulation (no network)
│   └── index.js                   # Provider registry + factory
├── sources/
│   ├── exclusions.js              # Secret / noise / unsupported filtering
│   ├── folderSource.js            # Recursive folder + drag-drop walking
│   └── urlSource.js               # URL fetch → File, with URL validation
└── utils/
    ├── chunker.js                 # Semantic-boundary document splitter
    ├── promptBuilder.js           # System + user prompt construction
    ├── parser.js                  # 4-strategy JSON extraction from LLM output
    ├── fileReader.js              # PDF / DOCX / TXT / MD parsing
    ├── pricing.js                 # Model price table + run estimation
    ├── dedup.js                   # Exact + trigram duplicate detection
    ├── quality.js                 # Pair validation heuristics
    ├── storage.js                 # localStorage settings + IndexedDB session
    └── corsProxy.js               # Dev-mode CORS proxy wrapper for fetch
```

### Chunking and parallelism

Documents longer than 4,000 characters are split at semantic boundaries — paragraph, then sentence, then word, then a hard cut as a last resort — with 300 characters of overlap so context straddling a boundary is not lost. The requested pair count is distributed evenly across chunks.

Every chunk from every document is flattened into **one shared concurrency pool**. Files therefore process simultaneously rather than one after another, which for a multi-file batch is substantially faster than sequential processing. Accuracy is unaffected: each API call is a self-contained prompt containing only that chunk's text, so the model has no cross-call or cross-file state.

JavaScript is single-threaded, so this is async I/O concurrency, not OS threading — which is the right tool here, because the bottleneck is waiting on network responses rather than CPU work.

### CORS proxy (dev mode)

A Vite plugin in `vite.config.js` registers middleware at `/api/cors-proxy`. In development, `corsProxy.js` sends requests to the local Vite server with the real target in an `x-proxy-target` header; the middleware forwards them server-side using Node's `http`/`https` (forcing IPv4, which avoids a `localhost` → `::1` mismatch on Windows) and returns the response. This makes any OpenAI-compatible server work without touching its CORS configuration.

Production builds fall back to direct `fetch`.

---

## Building for Production

```bash
npm run build
npx serve dist
```

Note: the CORS proxy is a dev-server feature only. For production deployments using Custom or Ollama providers, the target server must send `Access-Control-Allow-Origin: *`.

---

## Testing

File-type parsing has an end-to-end test that generates a fixture per format, uploads each through the real file input in headless Chrome, and asserts on what the app actually extracted:

```bash
npm run dev              # in one terminal
npm run test:filetypes   # in another
npm run test:sources
```

`test:filetypes` covers the tricky parsing cases explicitly — HTML noise stripping, CSV column labelling, EPUB spine ordering (the fixture's spine deliberately contradicts filename order), PPTX numeric slide ordering, plus the empty-extraction and unsupported-type guards.

`test:sources` covers folder and URL import: every exclusion rule against synthetic paths, a folder selection driven through the real React handler, and a live URL fetch through the proxy. It also pins URL parsing — that `ftp://` is rejected rather than coerced, that `host:port` is not mistaken for a scheme, and that credentials in a URL are refused.

---

## Regenerating the screenshots

The images in this README are produced from the running app by a script, so they stay in sync with the UI:

```bash
npm run dev            # in one terminal
npm run screenshots    # in another
```

It drives headless Chrome via `puppeteer-core` using the Mock provider, so no API key or network access is needed. Set `CHROME_PATH` if Chrome is not at the default Windows location, or `APP_URL` if the dev server is on another port.

---

## Tech Stack

| Library | Purpose |
|---|---|
| React 18 | UI framework |
| Vite 5 | Dev server, bundler |
| Tailwind CSS 3 | Styling |
| @dnd-kit | Drag-and-drop reordering |
| react-window | List virtualization for large datasets |
| pdfjs-dist 4 | PDF text extraction |
| mammoth | DOCX text extraction |
| jszip | EPUB / PPTX archive reading |
| puppeteer-core | Screenshots and file-type tests (dev only) |

HTML and XML parsing use the browser's built-in `DOMParser` — no dependency. Theming is plain CSS variables consumed through Tailwind, so there is no runtime theming library either.

---

## License

MIT
