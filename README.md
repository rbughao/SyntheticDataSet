# Synthetic Dataset Generator by Bughao Lab

A browser-based tool that turns any document into fine-tuning Q&A pairs using the LLM provider of your choice. Upload a file, pick a provider, click **Generate** — export as JSONL, JSON, or CSV.

![Synthetic Dataset Generation](https://img.shields.io/badge/React-18-blue?logo=react) ![Vite](https://img.shields.io/badge/Vite-5-purple?logo=vite) ![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss) ![License](https://img.shields.io/badge/license-MIT-green)

---

## What it does

ML practitioners spend hours hand-labeling training data. This tool automates that by:

1. Reading your source document (PDF, DOCX, TXT, Markdown, or pasted text)
2. Sending it to an LLM with a structured prompt that demands clean JSON output
3. Rendering each Q&A pair as an editable card you can review, rate, and reorder
4. Exporting the final dataset in JSONL (the standard fine-tuning format), JSON, or CSV

Everything runs in the browser — no backend server, no data leaves your machine except the API calls you authorize.

---

## Features

### Document Ingestion
- Upload `.txt`, `.md`, `.pdf`, `.docx` files via drag-and-drop or file picker
- Paste raw text directly
- Manage multiple documents per session; switch between them in the sidebar
- Auto-truncation warning for documents over 10,000 characters

### Generation Settings
- **Pair count** — slider from 5 to 1,000 pairs
- **Style** — Factual Q&A, Instruction-following, or both
- **Difficulty** — Basic, Intermediate, Advanced
- **Temperature** — Low (0.3), Balanced (0.7), Creative (1.0)
- **Domain tag** — optional label (e.g. `medical`, `legal`) included in the prompt

### LLM Providers
| Provider | Notes |
|---|---|
| **Mock (Simulation)** | No API key needed — generates pairs locally from your document |
| **Anthropic** | Requires a CORS proxy in dev (see below) |
| **OpenAI** | Works directly from the browser |
| **Google Gemini** | Works directly from the browser |
| **Meta (Llama)** | Via Together.xyz, Fireworks AI, or Groq |
| **Chinese Open Weights** | Qwen (Alibaba DashScope) or DeepSeek |
| **Ollama** | Local models, zero cost |
| **Custom** | Any OpenAI-compatible endpoint (vLLM, LM Studio, etc.) |

API keys are saved to `localStorage` per provider — never hardcoded.

### Review & Edit Workspace
- Editable instruction and output textareas (auto-resize)
- Drag-and-drop reordering
- Thumbs up / down quality rating per pair
- Per-card regenerate button
- Bulk select → delete
- Filter by rating

### Export
- **JSONL** — one JSON object per line, standard fine-tuning format
- **JSON** — full pretty-printed array
- **CSV** — `instruction,output,type` columns, properly escaped
- Export summary modal: total pairs, style breakdown, estimated token count
- Filename: `dataset_<timestamp>.<ext>`

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) 18 or later
- npm (comes with Node)

### Install & Run

```bash
git clone https://github.com/rbughao/SyntheticDataSet.git
cd SyntheticDataSet
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Usage Guide

### Step 1 — Load a document

Use the **Upload** tab to drag-and-drop or browse for a file, or use the **Paste** tab to drop in raw text. Multiple documents can be loaded; click one in the sidebar to make it active.

### Step 2 — Choose a provider

Open the **Settings** panel and select a provider from the dropdown. For a zero-config test, choose **Mock (Simulation)** — no API key or internet connection required.

For real providers, enter your API key in the masked field. Keys are saved to browser storage automatically on blur.

### Step 3 — Configure generation

| Setting | Recommendation |
|---|---|
| Pair count | Start with 10–20 to verify quality before going large |
| Style | "Factual Q&A" for fact-heavy docs; "Instruction-following" for procedural content |
| Difficulty | Match your target model's expected capability |
| Temperature | "Balanced" works for most documents |

### Step 4 — Generate

Click **Generate Dataset**. A loading skeleton appears while the LLM responds. Pairs populate as cards on the right.

### Step 5 — Review

- **Edit** any instruction or output directly in the card
- **Thumbs up/down** pairs to mark quality; use the filter dropdown to focus on a subset
- **Drag** cards to reorder
- **Regenerate** a single pair if the result is off
- **Delete** unwanted pairs (two-click confirmation)

### Step 6 — Export

Click **Export** in the top bar. The summary modal shows pair counts and an estimated token count. Download as JSONL (recommended for fine-tuning), JSON, or CSV.

---

## Provider Setup

### Google Gemini (easiest, no proxy needed)
1. Get an API key from [Google AI Studio](https://aistudio.google.com/)
2. Select **Google Gemini** in Settings, paste the key, pick a model

### OpenAI
1. Get an API key from [platform.openai.com](https://platform.openai.com/)
2. Select **OpenAI**, paste the key

### Anthropic (requires CORS proxy in browser)
Anthropic's API does not send `Access-Control-Allow-Origin` headers for browser requests.

**Option A — run a local CORS proxy:**
```bash
npx cors-anywhere
# Then set Proxy URL in Settings to: http://localhost:8080/https://api.anthropic.com
```

**Option B — use Google Gemini or Ollama instead** (no proxy needed).

### Ollama (free, local)
```bash
# Install from https://ollama.com, then:
OLLAMA_ORIGINS=* ollama serve
ollama pull llama3.2
```
Select **Ollama (Local)** in Settings, leave the base URL as the default, type `llama3.2` as the model name.

### Custom / vLLM / LM Studio
Select **Custom (OpenAI-compatible)** and enter your base URL including `/v1`, e.g. `http://192.168.1.10:8000/v1`.

Use the **Test** button next to the base URL field to verify connectivity and fetch the list of available models. In development mode (`npm run dev`), all Custom and Ollama requests are automatically routed through a built-in Vite CORS proxy — so the "Failed to fetch" CORS error is handled transparently without any extra configuration.

---

## Architecture

```
src/
├── App.jsx                        # Central state hub, dnd-kit wiring
├── components/
│   ├── DocumentPanel.jsx          # Upload, paste, document list, preview
│   ├── SettingsPanel.jsx          # Provider config, generation settings, connection test
│   ├── GenerateButton.jsx         # Trigger + loading state
│   ├── PairCard.jsx               # Editable Q&A card with drag handle
│   ├── WorkspaceHeader.jsx        # Sticky bar, bulk actions, filter, export
│   └── ExportModal.jsx            # Export summary + download buttons
├── hooks/
│   ├── useDocuments.js            # Document loading and parsing state
│   ├── useGenerate.js             # LLM call orchestration, error classification
│   └── useExport.js               # JSONL / JSON / CSV serialization
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
└── utils/
    ├── promptBuilder.js           # System + user prompt construction
    ├── parser.js                  # 4-strategy JSON extraction from LLM response
    ├── fileReader.js              # PDF / DOCX / TXT / MD parsing
    └── corsProxy.js               # Dev-mode CORS proxy wrapper for fetch
```

### CORS Proxy (dev mode)

A Vite plugin in `vite.config.js` registers a middleware at `/api/cors-proxy`. In development, `corsProxy.js` wraps every `fetch()` call for Custom and Ollama providers: instead of making a cross-origin request from the browser, it sends the request to Vite's local server with the real target URL in an `x-proxy-target` header. The Vite middleware forwards it using Node's native `fetch` (no CORS restriction) and returns the response. This makes any OpenAI-compatible server work without touching its CORS configuration.

In production builds the wrapper falls back to direct `fetch`.

---

## Building for Production

```bash
npm run build
# Output is in dist/
```

Serve the `dist/` folder with any static file server:
```bash
npx serve dist
```

Note: the CORS proxy is a dev-server feature only. For production deployments with Custom or Ollama providers, the target server must send `Access-Control-Allow-Origin: *`.

---

## Tech Stack

| Library | Purpose |
|---|---|
| React 18 | UI framework |
| Vite 5 | Dev server, bundler |
| Tailwind CSS 3 | Styling |
| @dnd-kit | Drag-and-drop reordering |
| pdfjs-dist 4 | PDF text extraction |
| mammoth | DOCX text extraction |

---

## License

MIT
