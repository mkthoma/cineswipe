# 🎬 CineSwipe

> **Tinder for Movies & TV** — AI-curated swipe cards, personalised taste profiling, and session exports.  
> A local-first web app powered by an MCP tool layer, NVIDIA NIM LLMs, and TMDB.

---

## Screenshots

| Onboarding | Swipe View |
|:----------:|:----------:|
| ![Onboarding — choose genre, language, and model](assets/Screenshots/Screenshot%201.png) | ![Swipe View — card stack with watchlist panel](assets/Screenshots/Screenshot%202.png) |

| Session Summary | Full Results Page |
|:---------------:|:-----------------:|
| ![Session Summary — stats, saved cards, export options](assets/Screenshots/Screenshot%203.png) | ![Full Results — all recommendations with save/skip tabs](assets/Screenshots/Screenshot%204.png) |

---

## Table of Contents

1. [What is CineSwipe?](#1-what-is-cineswipe)
2. [Why MCP?](#2-why-mcp)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Component Deep-Dive](#4-component-deep-dive)
5. [Data Flow Diagrams](#5-data-flow-diagrams)
6. [MCP Tools Reference](#6-mcp-tools-reference)
7. [REST API Reference](#7-rest-api-reference)
8. [File Structure](#8-file-structure)
9. [Tech Stack](#9-tech-stack)
10. [Environment Variables](#10-environment-variables)
11. [Getting Started](#11-getting-started)
12. [Features](#12-features)
13. [Design Decisions](#13-design-decisions)

---

## 1. What is CineSwipe?

CineSwipe lets you discover movies and TV series through a swipe interface — right to save, left to skip. After each session:

- A **taste profile** is automatically derived from your saves using an LLM, and used to personalise the next session's recommendations.
- A **session summary** is generated showing all recommendations, save statistics, and time taken.
- Your **watchlist** can be exported as PDF, Markdown, or JSON.

The entire recommendation pipeline runs inside an **MCP agent loop** on the Node.js server — the browser only renders what the server pushes over a real-time SSE stream.

---

## 2. Why MCP?

### What is MCP?

The **Model Context Protocol (MCP)** is a structured way for an AI agent to invoke typed, validated tools — rather than generating raw text and hoping it works. Think of it as an API contract between an LLM orchestrator and the functions it needs to call.

### The Problem MCP Solves Here

Without MCP, an LLM-powered app typically does one of two things:

| Approach | Problem |
|----------|---------|
| LLM generates everything (title, year, genre, rating, poster URL) | Hallucination — wrong language, invented movies, broken image URLs |
| Direct API calls with no LLM | No personalisation, no taste matching, no natural-language genre understanding |

CineSwipe's MCP layer sits between the two: **the agent decides what to do, the tools guarantee it's done correctly.**

### What MCP Gives CineSwipe

```
┌─────────────────────────────────────────────────────────────┐
│  AGENT (gemini-loop.js)                                     │
│  Orchestrates the session — decides order and parameters    │
│                                                             │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ MCP Tool   │  │   MCP Tool   │  │    MCP Tool        │  │
│  │ manage_    │  │   fetch_     │  │    fetch_          │  │
│  │ watchlist  │  │ recommendations│  │  poster_image    │  │
│  └────────────┘  └──────────────┘  └────────────────────┘  │
│                                                             │
│  Each tool has a clear contract:                           │
│  • Typed inputs/outputs                                    │
│  • Isolated side-effects                                   │
│  • Independent testability                                 │
└─────────────────────────────────────────────────────────────┘
```

**Specifically MCP enables:**

1. **Tool isolation** — `fetch_recommendations` can be swapped from LLM-only to TMDB-backed without changing the agent logic.
2. **Retry composability** — if `fetch_recommendations` fails to parse JSON, the agent calls `retry_recommendations` with a stricter prompt, automatically.
3. **Taste-aware personalisation** — `manage_watchlist` transparently triggers `derive_taste_profile` whenever the save count reaches 5, without the agent needing to know.
4. **Auditability** — every tool call emits an SSE event to the browser, so the user sees exactly which MCP step is running.
5. **Model-agnosticism** — the agent passes `modelId` into tools; swapping models requires no agent code changes.

---

## 3. High-Level Architecture

```
╔══════════════════════════════════════════════════════════════════════════╗
║  BROWSER (Vanilla JS, no framework)                                      ║
║                                                                          ║
║  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────────────┐  ║
║  │  Onboarding  │  │   Swipe View     │  │     Summary View          │  ║
║  │  (genre,     │  │  (card stack,    │  │  (stats, saved/skipped    │  ║
║  │  language,   │  │  watchlist panel,│  │   cards, exports)         │  ║
║  │  model,type) │  │  taste panel)    │  │                           │  ║
║  └──────┬───────┘  └──────┬───────────┘  └───────────────────────────┘  ║
║         │                 │  SSE listener (EventSource /api/stream)       ║
╚═════════╪═════════════════╪══════════════════════════════════════════════╝
          │ POST /api/recommend  │ SSE events (tool_start, cards_ready, etc.)
          ▼                 ▲
╔══════════════════════════════════════════════════════════════════════════╗
║  NODE.JS SERVER  (Express + ES Modules)                                  ║
║                                                                          ║
║  ┌────────────────────────────────────────────────────────────────────┐  ║
║  │  REST API Layer  (server.js)                                       │  ║
║  │  /api/recommend  /api/watchlist  /api/taste  /api/export           │  ║
║  │  /api/stream  /api/proxy-image  /api/state  /api/recommend/complete│  ║
║  └──────────────────────────┬─────────────────────────────────────────┘  ║
║                             │                                            ║
║  ┌──────────────────────────▼─────────────────────────────────────────┐  ║
║  │  AGENT LOOP  (agent/gemini-loop.js)                                │  ║
║  │  Orchestrates MCP tool calls in sequence, emits SSE progress       │  ║
║  └──────────────────────────┬─────────────────────────────────────────┘  ║
║                             │                                            ║
║  ┌──────────────────────────▼─────────────────────────────────────────┐  ║
║  │  MCP TOOL LAYER  (mcp/tools/)                                      │  ║
║  │                                                                    │  ║
║  │  manage_watchlist   fetch_recommendations   fetch_poster_image     │  ║
║  │  derive_taste_profile   edit_taste_profile   export_watchlist      │  ║
║  │  sendSSE (ui-bridge)                                               │  ║
║  └──────────────────────────┬─────────────────────────────────────────┘  ║
║                             │                                            ║
╚═════════════════════════════╪════════════════════════════════════════════╝
                              │
          ┌───────────────────┼──────────────────────┐
          ▼                   ▼                      ▼
   ┌─────────────┐    ┌──────────────┐      ┌──────────────┐
   │ NVIDIA NIM  │    │  TMDB API    │      │  Local JSON  │
   │ (LLM API)   │    │  (Movies DB) │      │  data/       │
   │ Mistral,    │    │  Discovery + │      │  watchlist   │
   │ Llama etc.  │    │  Posters     │      │  taste_prof  │
   └─────────────┘    └──────────────┘      └──────────────┘
```

---

## 4. Component Deep-Dive

### 4.1 Frontend (public/)

The frontend is vanilla JavaScript — no React, no Vue, no bundler. Three view modules are dynamically mounted into `#app-main`.

```
public/
├── index.html         Single HTML shell. All views injected here.
├── app.js             Router, SSE listener, toast system, theme toggle,
│                      particle canvas background
├── styles.css         Single design-token driven stylesheet
│                      (CSS custom properties, responsive grid breakpoints)
└── views/
    ├── onboarding.js  Genre/language/type/model form + GSAP sparkle animation
    ├── swipe.js       Card stack with drag-to-swipe, watchlist panel,
    │                  taste profile panel, PDF/Markdown/JSON export
    └── summary.js     Post-session summary: stats grid, saved/skipped tabs,
                       export buttons, "View Results" button (new tab)
```

**SSE-driven rendering:** The browser never polls. It opens one persistent `EventSource` connection to `/api/stream`. Every meaningful state change (tool start, poster progress, cards ready, errors, toasts) arrives as a typed SSE event and is handled in `app.js`.

**View transitions:** Anime.js handles all motion — card swipe physics, panel reveals, button sparkle effects, progress bar animations.

---

### 4.2 Express Server (server.js)

Single-file Express server, ES module, no build step required.

**Responsibilities:**
- Serve static files from `public/`
- Expose REST endpoints for all browser interactions
- Own the in-memory session state (`currentSession`)
- Launch the agent loop when `/api/recommend` is called
- Generate the summary HTML (pure Node.js, no Python) when all cards are swiped
- Proxy external poster images to bypass browser CORS restrictions

**Session state** (in-memory, single-user):
```js
currentSession = {
  recommendations: [],   // populated by agent loop
  ui_title: '',
  model_used: '',
  personalised: false,
  date: '2025-01-01',
  start_time: Date.now(),  // used to compute time_taken_seconds
}
```

---

### 4.3 Agent Loop (agent/gemini-loop.js)

The orchestrator. Runs entirely on the server. Emits SSE events at each step so the browser loading overlay stays in sync.

```
Step 0  manage_watchlist(action:'list')
        → reads saved titles to exclude from new recommendations
        → checks if taste profile is active (≥5 saves)

Step 1  fetch_recommendations({ genre, language, media_type, model, excluded_titles, taste_ready })
        → primary: TMDB discover API (guaranteed language+genre accuracy)
        → fallback: LLM generates full movie list if TMDB unavailable
        → LLM called regardless for why_recommended text (personalised if taste active)
        [on parse failure → retry_recommendations with stricter prompt]
        [on second failure → retry with FALLBACK_MODEL (llama-3.1-8b)]

Step 2  fetch_poster_image (×10 in parallel via Promise.all)
        → SKIPPED if TMDB already embedded poster_url (avoids redundant calls)
        → fallback: Google Custom Search API
        → fallback: generated SVG placeholder (genre-coloured with title initials)

Step 3  cards_ready SSE event → browser renders 10 swipe cards
```

---

### 4.4 MCP Tool Layer (mcp/tools/)

Each file is a self-contained tool module with a clear input/output contract.

| File | Tool(s) | External dependency |
|------|---------|---------------------|
| `recommendations.js` | `fetch_recommendations`, `retry_recommendations` | NVIDIA NIM API, TMDB API |
| `watchlist.js` | `manage_watchlist`, `export_watchlist` | Local JSON file |
| `taste-profile.js` | `derive_taste_profile`, `edit_taste_profile`, `reset_taste_profile` | NVIDIA NIM API |
| `posters.js` | `fetch_poster_image` | TMDB API, Google Custom Search API |
| `ui-bridge.js` | `sendSSE`, `addSSEClient`, `removeSSEClient` | Express response objects |

---

### 4.5 Data Layer (data/)

All persistent state is stored as JSON files. No database required.

```
data/
├── watchlist.json       Array of saved movie objects (persists across sessions)
├── taste_profile.json   LLM-derived viewer preference summary + user annotations
├── session_log.json     Log of past sessions (title, date, saved count)
└── ui_state.json        Last active view (used for browser refresh recovery)
```

**Taste profile schema:**
```json
{
  "summary": "3-sentence LLM-derived preference description",
  "user_annotations": "freeform notes added by the user (max 300 chars)",
  "derived_from_count": 17,
  "is_active": true,
  "last_updated": "2025-05-04T09:00:00.000Z"
}
```

---

## 5. Data Flow Diagrams

### 5.1 Recommendation Generation Flow

```
User submits form (genre, language, type, model)
        │
        ▼
POST /api/recommend
        │  Validates inputs
        │  Resets currentSession
        │  Returns { status: 'started' } immediately
        │
        ▼ (async — does NOT block HTTP response)
runRecommendationLoop()
        │
        ├─── SSE: tool_start (step 0: manage_watchlist)
        │
        ├─── manage_watchlist({ action: 'list' })
        │         reads watchlist.json
        │         checks taste_profile.json
        │         returns { items, taste_ready, save_count }
        │
        ├─── SSE: tool_complete (step 0)
        │
        ├─── SSE: tool_start (step 1: fetch_recommendations)
        │
        ├─── fetch_recommendations()
        │         ┌─ TMDB path (primary — if TMDB_API_KEY set) ──────────┐
        │         │  1. Map language → ISO 639-1 code (e.g. Korean → ko) │
        │         │  2. Map genre → TMDB genre ID (e.g. thriller → 53)   │
        │         │  3. GET /discover/movie?with_original_language=ko     │
        │         │        &with_genres=53&sort_by=popularity.desc        │
        │         │  4. Fetch pages 1+2 (up to 40 results)               │
        │         │  5. Filter out watchlist titles                       │
        │         │  6. Take top 10                                       │
        │         │  7. LLM call (600 tokens): generate why_recommended   │
        │         │     for all 10 in one batch                           │
        │         └───────────────────────────────────────────────────────┘
        │         ┌─ LLM fallback (if TMDB unavailable / < 10 results) ──┐
        │         │  Prompt includes: genre, language, excluded titles,   │
        │         │  taste profile (if active)                            │
        │         │  Returns JSON array of 10 movie objects               │
        │         └───────────────────────────────────────────────────────┘
        │         [on JSON parse error → retry with stricter prompt]
        │         [on 2nd failure → retry with FALLBACK_MODEL]
        │
        ├─── SSE: tool_complete (step 1)
        │
        ├─── SSE: tool_start (step 2: fetch_poster_image)
        │
        ├─── Promise.all() — 10 concurrent poster fetches
        │         For each movie:
        │         ┌─ if poster_url already set by TMDB ─── skip (instant) ┐
        │         │                                                        │
        │         ├─ TMDB image API (/search/movie or /search/tv)          │
        │         │  → returns image.tmdb.org/t/p/w500/{path}             │
        │         │                                                        │
        │         ├─ Google Custom Search API (fallback)                   │
        │         │  → image search for "{title} {year} movie poster"     │
        │         │                                                        │
        │         └─ SVG placeholder (genre-coloured, title initials)      │
        │         SSE: poster_progress { count, total } after each
        │
        ├─── SSE: tool_complete (step 2)
        │
        ├─── SSE: tool_start (step 3: push_to_ui)
        │
        └─── SSE: cards_ready { recommendations, ui_title, personalised, save_count }
                  Browser renders 10 swipe cards
```

---

### 5.2 Card Swipe → Save Flow

```
User swipes right (or presses →)
        │
        ▼
swipe.js: Anime.js fly-right animation
        │
        ▼
POST /api/watchlist { action: 'add', item: { title, year, genre, ... } }
        │
        ▼
manage_watchlist('add')
        │  appends to watchlist.json
        │
        ├─ if watchlist.length >= 5 ──────────────────────────────────────┐
        │                                                                  │
        │  derive_taste_profile({ watchlist }) (async, fire-and-forget)   │
        │          │                                                       │
        │          ▼                                                       │
        │  NVIDIA NIM LLM call (512 tokens):                              │
        │  "In 3 sentences, describe what this viewer enjoys..."           │
        │          │                                                       │
        │          ▼                                                       │
        │  writes taste_profile.json { summary, is_active: true }         │
        │  Browser taste panel updates on next refresh/action             │
        └──────────────────────────────────────────────────────────────────┘
        │
        ▼
{ success: true, count: N }  → watchlist panel re-renders in browser
```

---

### 5.3 Session Complete → Summary Flow

```
User swipes last card (#10)
        │
        ▼
swipe.js: POST /api/recommend/complete { savedTitles: ['Title A', 'Title B', ...] }
        │
        ▼
server.js:
        Merges savedTitles with currentSession.recommendations
        Computes time_taken_seconds = (Date.now() - start_time) / 1000
        Builds sessionData object
        │
        ▼
generateSummaryHTML(sessionData)
        Generates styled HTML with:
        ├─ Stats grid (shown/saved/skipped/save-rate)
        ├─ Saved tab: movie cards with poster, rating, why_recommended
        └─ All Recommendations tab: same card format, skipped marked dimmed
        Writes → public/summary_output.html
        │
        ▼
SSE: prefab_ready { url: '/summary_output.html', sessionData }
        │
        ▼
Browser renders summary.js view
        Shows stat cards, movie grids, export buttons
        "View Results" button opens /summary_output.html in new tab
```

---

### 5.4 Export Flow (PDF / Markdown / JSON)

```
User clicks PDF / Markdown / JSON in summary view
        │
        ├─ PDF ──────────────────────────────────────────────────────────┐
        │  generateMoviePDF() runs entirely CLIENT-SIDE (jsPDF)          │
        │  For each movie poster:                                         │
        │    GET /api/proxy-image?url={tmdb_url}                         │
        │    (server fetches the image, returns it — bypasses CORS)      │
        │  Embeds image as base64 in PDF                                  │
        │  All text sanitised (emoji stripped, Latin-1 safe)             │
        │  Auto-downloads as cineswipe-saved-{date}.pdf                  │
        └────────────────────────────────────────────────────────────────┘
        │
        ├─ Markdown / JSON ──────────────────────────────────────────────┐
        │  POST /api/export { format, scope, session_data }              │
        │  export_watchlist() builds content string                      │
        │  Response: file attachment (Content-Disposition: attachment)   │
        │  Browser auto-downloads                                         │
        └────────────────────────────────────────────────────────────────┘
```

---

## 6. MCP Tools Reference

### `manage_watchlist`

**File:** `mcp/tools/watchlist.js`

| Action | Input | Effect |
|--------|-------|--------|
| `add` | `{ item }` | Append to watchlist.json. Triggers taste derivation if ≥5 saves. |
| `remove` | `{ item: { title } }` | Remove by title. Deactivates taste profile if count drops below 5. |
| `list` | — | Returns `{ items, taste_ready, save_count }`. |
| `clear` | — | Empties watchlist, resets taste profile. |

---

### `fetch_recommendations`

**File:** `mcp/tools/recommendations.js`

Two-path system:

**Path 1 — TMDB (primary)**

Uses TMDB's `/discover` API with `with_original_language` and `with_genres` filters. This guarantees 100% language and genre accuracy because TMDB metadata is ground-truth, not LLM-generated.

Language resolution: free-text → ISO 639-1 (30+ languages supported, fuzzy match)
Genre resolution: free-text keyword match → TMDB genre ID (handles "slow-burn thriller" → 53)

Then a single LLM call generates `why_recommended` for all 10 movies in one batch (~600 tokens).

**Path 2 — LLM fallback**

Used when TMDB key is absent or returns <10 results for a language/genre combination.
Prompt explicitly instructs the model: *"Every title MUST be originally in {language}."*

**Returns:** `{ recommendations[], personalised, excluded_count }`

---

### `retry_recommendations`

**File:** `mcp/tools/recommendations.js`

Called by the agent when `fetch_recommendations` throws (JSON parse failure).
- Attempt 1: same model, stricter prompt (starts with `[`, ends with `]`)
- Attempt 2: `FALLBACK_MODEL` (Llama 3.1 8B), temperature 0.2

---

### `fetch_poster_image`

**File:** `mcp/tools/posters.js`

Priority order:
1. **Skipped** — if `rec.poster_url` is already set from TMDB discover (saves an API round-trip)
2. **TMDB search** — `/search/movie` or `/search/tv` (media_type-aware, tries correct type first)
3. **Google Custom Search** — image search (fallback, requires `GOOGLE_CSE_KEY` + `GOOGLE_CX`)
4. **SVG placeholder** — genre-coloured gradient with title initials (always works, no API needed)

---

### `derive_taste_profile`

**File:** `mcp/tools/taste-profile.js`

Triggered automatically by `manage_watchlist` whenever saves reach ≥5.

Sends the full saved list to the LLM:
```
"In exactly 3 sentences, describe what this viewer seems to enjoy in terms of
themes, narrative tone, pacing, and storytelling style..."
```

Writes the result to `taste_profile.json` with `is_active: true`.

Next recommendation session reads this profile and injects it into the prompt,
producing personalised picks that match the viewer's documented preferences.

---

### `sendSSE` (ui-bridge)

**File:** `mcp/tools/ui-bridge.js`

A lightweight pub/sub bridge between the server and all connected browsers.

```js
sendSSE(event, data)
// Serialises to:  "event: {event}\ndata: {JSON.stringify(data)}\n\n"
// Writes to all active SSE response streams
```

**SSE events used:**

| Event | Payload | Browser action |
|-------|---------|---------------|
| `connected` | `{}` | SSE stream established |
| `tool_start` | `{ message, step }` | Loading overlay updates current step |
| `tool_complete` | `{ step }` | Marks step as done (✓) |
| `cards_ready` | `{ recommendations, ui_title, personalised, save_count }` | Hides overlay, renders swipe view |
| `poster_progress` | `{ count, total }` | Updates progress bar in overlay |
| `prefab_ready` | `{ url, sessionData }` | Renders summary view |
| `toast` | `{ type, message, duration }` | Shows toast notification |
| `error` | `{ message }` | Shows error toast, hides overlay |

---

## 7. REST API Reference

All endpoints are served by `server.js` on `http://localhost:3000` (default).

### `GET /api/stream`
Opens a persistent SSE connection. Browser keeps this open for the entire session.

### `GET /api/state`
Returns `{ watchlist[], taste }` — used for initial page load hydration.

### `POST /api/recommend`
Starts the recommendation loop asynchronously.

**Body:**
```json
{
  "genre":      "thriller",
  "language":   "Korean",
  "media_type": "movie",
  "model":      "meta/llama-3.1-8b-instruct"
}
```
**Response:** `{ status: 'started' }` — immediately, before the loop completes.  
Results arrive via SSE `cards_ready`.

### `POST /api/recommend/complete`
Called when the user has swiped all 10 cards. Triggers summary generation.

**Body:** `{ savedTitles: ['Parasite', 'Memories of Murder'] }`  
**Response:** `{ status: 'ok' }` — summary arrives via SSE `prefab_ready`.

### `GET /api/watchlist`
Returns the full watchlist array from disk.

### `POST /api/watchlist`
Manages the watchlist. Body is passed directly to `manage_watchlist`.

**Actions:** `add`, `remove`, `list`, `clear`

### `GET /api/taste`
Returns the current taste profile from disk.

### `POST /api/taste`
Updates the taste profile.

**Body:** `{ action: 'edit', user_annotations: '...' }` or `{ action: 'reset' }`

### `POST /api/export`
Generates and returns a file download.

**Body:**
```json
{
  "format":       "pdf | markdown | json",
  "scope":        "saved | full",
  "session_data": []
}
```
**Response:** File attachment (`Content-Disposition: attachment`).

### `GET /api/proxy-image?url={url}`
Server-side image proxy. Fetches an external image URL (e.g. TMDB CDN) and returns it with correct CORS headers. Used by the client-side PDF generator to bypass browser CORS restrictions.

---

## 8. File Structure

```
cineswipe/
│
├── server.js                   Express server + summary HTML generator
├── config.js                   Model list, API URLs, path constants
├── package.json
├── .env.example                Environment variable template
│
├── agent/
│   └── gemini-loop.js          MCP agent orchestrator (4-step loop)
│
├── mcp/
│   └── tools/
│       ├── ui-bridge.js        SSE pub/sub (sendSSE, addSSEClient)
│       ├── recommendations.js  fetch_recommendations, retry_recommendations
│       ├── watchlist.js        manage_watchlist, export_watchlist
│       ├── taste-profile.js    derive_taste_profile, edit/reset
│       └── posters.js          fetch_poster_image (TMDB → Google → SVG)
│
├── public/
│   ├── index.html              App shell (single HTML, no bundler)
│   ├── app.js                  Router, SSE listener, toast, theme, particles
│   ├── styles.css              Design tokens + all component styles
│   │
│   └── views/
│       ├── onboarding.js       Form + GSAP sparkle button
│       ├── swipe.js            Card stack, watchlist panel, taste panel, exports
│       └── summary.js          Post-session stats, movie grids, export buttons
│
├── data/                       Auto-created on first run
│   ├── watchlist.json          Persisted saves (array of movie objects)
│   ├── taste_profile.json      LLM-derived viewer preferences
│   ├── session_log.json        Session history
│   └── ui_state.json           Last active view
│
└── assets/
    ├── cinema_popcorn.png      UI icons
    ├── movie_studio.png
    └── video_marketing_...png
```

---

## 9. Tech Stack

### Backend

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^4.19 | HTTP server, static file serving, REST API |
| `openai` | ^6.35 | OpenAI-compatible client — used for NVIDIA NIM API |
| `dotenv` | ^16.4 | Environment variable loading |
| `@google/generative-ai` | ^0.21 | (Available, reserved for Gemini Flash fallback) |

### Frontend

| Library | How loaded | Purpose |
|---------|-----------|---------|
| Anime.js | npm, served via `/lib/anime.js` | All UI animations (card physics, panel reveals) |
| GSAP | CDN (`cdnjs.cloudflare.com`) | Sparkle button particle effect on onboarding |
| jsPDF | CDN (lazy-loaded on demand) | Client-side PDF generation for watchlist/exports |
| Vanilla JS (ES modules) | Native browser | No framework, no bundler, no build step |

### External APIs

| API | Free Tier | Used For |
|-----|-----------|---------|
| NVIDIA NIM | Yes (limited) | LLM inference — Llama 3.1 8B (fast), Mistral Medium/Large |
| TMDB | Yes (unlimited reads) | Movie/TV discovery (primary rec source) + poster images |
| Google Custom Search | 100 req/day | Poster image fallback |

### Design System

- **Fonts:** Cormorant Garamond (serif, display) + DM Mono (monospace, UI)
- **Colours:** Gold (`#c9a84c`) primary accent, dark surfaces, light mode via `data-theme` attribute
- **CSS variables:** Full design token system, all values defined in `:root`
- **Responsive:** CSS Grid + `clamp()` for fluid scaling without breakpoint thrash

---

## 10. Environment Variables

Copy `.env.example` to `.env` and fill in your keys.

```env
# ── Required ───────────────────────────────────────────────────────────────────

# NVIDIA NIM API key — powers all LLM calls (recommendations + taste derivation)
# Get free credits at: https://build.nvidia.com
NVIDIA_API_KEY=your_nvidia_api_key_here

# ── Strongly Recommended ───────────────────────────────────────────────────────

# TMDB API key — enables accurate genre/language filtering + high-quality posters
# Free, no credit card: https://www.themoviedb.org/signup → Settings → API
TMDB_API_KEY=your_tmdb_api_key_here

# ── Optional (poster fallback) ─────────────────────────────────────────────────

# Google Custom Search — used if TMDB poster lookup returns nothing
# 100 free image searches/day
# Setup: console.cloud.google.com → Enable Custom Search API → create key
GOOGLE_CSE_KEY=your_google_cse_key_here
# Setup: cse.google.com → New search engine → enable Image search → copy CX
GOOGLE_CX=your_google_cx_id_here

# ── Optional ───────────────────────────────────────────────────────────────────

# Change the server port (default: 3000)
PORT=3000
```

**What works without each key:**

| Missing Key | Impact |
|-------------|--------|
| `NVIDIA_API_KEY` | App won't start — all LLM calls fail |
| `TMDB_API_KEY` | Recommendations fall back to LLM-only (less accurate language/genre) + SVG placeholder posters |
| `GOOGLE_CSE_KEY` / `GOOGLE_CX` | Posters fall back to TMDB-only or SVG placeholders |

---

## 11. Getting Started

### Prerequisites

- Node.js 20+ (uses `--env-file` flag, native ES modules, and `fetch`)
- An NVIDIA NIM API key (free tier available)

### Installation

```bash
# 1. Clone or download the project
cd "cineswipe web app"

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and add your NVIDIA_API_KEY (and optionally TMDB_API_KEY)

# 4. Start the server
npm start
# → CineSwipe is running → http://localhost:3000
```

### First Run

1. Open `http://localhost:3000`
2. Enter a genre (e.g. `crime`), language (e.g. `English`), select Movie or TV
3. Choose a model — **⚡ Llama 3.1 8B (Fast)** is the default (~10–20s)
4. Click **✦ Get Recommendations**
5. Swipe right (→ or drag right) to save, left (← or drag left) to skip
6. After 10 cards, view your session summary and export your watchlist

### Model Selection Guide

| Model | Speed | Quality | Best For |
|-------|-------|---------|---------|
| ⚡ Llama 3.1 8B (Fast) | ~10–20s | Good | Most sessions |
| 🧠 Mistral Medium 3.5 | ~30–60s | Better | Quality over speed |
| 🔬 Mistral Large 2411 | ~60–90s | Best | Deep personalisation |
| 🦙 Llama 3.3 70B | ~30–60s | Very good | Balanced |

**Note:** When TMDB is configured (recommended), the model only generates `why_recommended` text (~10 words per movie) — not the full movie list. This makes even large models fast.

---

## 12. Features

### Recommendation Engine
- ✅ TMDB-backed discovery — 100% accurate language and genre matching
- ✅ 30+ languages supported with fuzzy text matching
- ✅ Handles compound genre descriptions ("slow-burn thriller", "psychological horror")
- ✅ Automatic exclusion of already-saved titles
- ✅ LLM fallback when TMDB returns insufficient results
- ✅ Retry logic with model escalation on JSON parse failure

### Taste Profiling
- ✅ Automatically derived from saved titles (triggers at ≥5 saves)
- ✅ 3-sentence LLM summary: themes, tone, pacing, storytelling style
- ✅ Injected into next session's recommendation prompt
- ✅ User can add free-text annotations (max 300 chars)
- ✅ Reset to blank slate at any time

### Swipe Interface
- ✅ Drag-to-swipe with Anime.js physics
- ✅ Keyboard navigation (← → arrow keys)
- ✅ SAVE / SKIP stamps on drag
- ✅ Card stack with depth effect (3 cards visible)
- ✅ Genre-coloured SVG poster placeholders

### Watchlist Panel (right sidebar)
- ✅ Live updates on every save/skip
- ✅ Scrollable — handles 20+ items without overflow
- ✅ Scroll-fade gradient hint at bottom
- ✅ Remove button appears on hover (✕)
- ✅ Scroll hint label when count exceeds 10
- ✅ Poster thumbnails from TMDB

### Session Summary
- ✅ Stats: shown / saved / skipped / save-rate
- ✅ Time taken display
- ✅ Saved and All Recommendations tabs (card grid layout)
- ✅ Personalised badge when taste profile was active
- ✅ "View Results" opens full summary in new tab

### Export
- ✅ **PDF** — client-side (jsPDF), includes poster images, sanitised for Latin-1
- ✅ **Markdown** — GitHub-flavoured, includes poster URLs and ratings
- ✅ **JSON** — structured data with all movie fields + save/skip status

### UI / UX
- ✅ Light / Dark theme with persistent preference
- ✅ Animated loading overlay with MCP step tracking and elapsed timer
- ✅ Toast notification system (info, warning, error with shake animation)
- ✅ Particle background (canvas, genre-tinted)
- ✅ Fully responsive — `clamp()` sizing, 3 breakpoints (1100px, 768px, 480px)
- ✅ Tablet mode: side panels hidden, full-width card

---

## 13. Design Decisions

### Why not React / Next.js?

CineSwipe is intentionally a local-first, zero-build app. Vanilla ES modules mean:
- No bundler, no transpile step, no `node_modules` on the frontend
- Faster iteration — edit a file, reload, done
- Easier to understand the full stack — one CSS file, one HTML file, three view modules

### Why SSE over WebSocket?

Server-Sent Events are:
- Unidirectional (server → client) — which is all we need for progress updates
- Built into browsers natively (`EventSource`)
- Automatically reconnect on drop
- No upgrade handshake overhead

### Why TMDB as the primary recommendation source?

Before TMDB integration, the LLM would sometimes recommend:
- English movies when asked for Korean
- Action films when asked for Romance
- Entirely fictional titles that don't exist

TMDB's `/discover` endpoint with `with_original_language` and `with_genres` is ground-truth metadata — the result is always real films in the correct language and genre. The LLM is then used only for what it's actually good at: writing a natural-language explanation of why you'd enjoy each film.

### Why client-side PDF generation?

PDFs need poster images embedded as base64. Fetching images server-side and streaming a PDF to the browser adds complexity (temp files, streaming pipes, cleanup). jsPDF in the browser is simpler — the only server involvement is `/api/proxy-image` to bypass CORS on the TMDB CDN.

### Why `data/` as local JSON instead of SQLite?

Single-user local app. JSON files are:
- Human-readable (you can open `watchlist.json` in any editor)
- Zero dependency (no database driver)
- Easy to back up, share, or version control
- Fast enough for hundreds of entries

### Why the taste profile is 3 sentences, not a structured object?

Structured preference data (e.g. `{ prefers_slow_pacing: true, likes_crime: true }`) would need careful schema design and might miss nuance. A natural-language paragraph is directly injectable into the recommendation prompt — the LLM understands it the same way a human would, and can make nuanced matching decisions.
