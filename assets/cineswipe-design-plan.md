# CineSwipe — Design & Plan Document

> Tinder for Movies & TV Series — local Node.js web app powered by a custom MCP server and Google Gemini AI

**Status:** Draft v6 — for review
**Stack:** Node.js · Express · MCP SDK (JavaScript) · Google Gemini API · HTML/CSS/JS · Anime.js v4
**Runs:** Locally on your machine — `npm start`, then open `http://localhost:3000`
**No hosting required. No Rust. No Python. No compilation.**

---

## 1. Concept

CineSwipe runs entirely on your machine as a local web app. You start it with one command, it opens in your browser, and everything — the AI calls, file storage, MCP tools — runs on `localhost`. Nothing is hosted or deployed anywhere.

The user enters genre and language in the UI. Gemini (via its function-calling API) orchestrates the MCP tools in sequence and pushes swipeable movie cards into the browser. When all cards are swiped, the **Prefab Results View** opens: a polished dashboard showing this session's saves with export options.

**Learning loop:** Every saved title feeds a persistent taste profile. From the 5th save onward, recommendations adapt to the user's derived taste — tone, themes, pacing — not just genre tags. Already-saved titles are always excluded from new results.

---

## 2. Why a Local Web App Works Better Here

| Concern | Answer |
|---|---|
| API keys exposed in browser? | No — all Gemini calls go through the Express backend. The browser never touches the API key. |
| File I/O from a webpage? | Yes — Express handles all reads/writes to `data/*.json` on the server side. |
| Offline-capable? | Yes — only the Gemini API calls and Google Images search require internet. The app itself runs locally. |
| Shareable later? | Yes — if you ever want to host it, the same codebase deploys to any Node.js host without changes. |
| MCP server? | Runs inside the same Node.js process using the `@modelcontextprotocol/sdk` JavaScript package. |

---

## 3. Architecture

```
Browser (http://localhost:3000)
         │
         │  HTTP / fetch()
         ▼
┌──────────────────────────────────────────────────────┐
│           Node.js Process  (npm start)               │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │         Express Web Server (:3000)           │    │
│  │                                             │    │
│  │  GET  /          → serves index.html        │    │
│  │  GET  /api/state → current app state        │    │
│  │  POST /api/recommend → triggers agent loop  │    │
│  │  POST /api/watchlist → add/remove items     │    │
│  │  GET  /api/watchlist → read watchlist       │    │
│  │  POST /api/taste  → edit/reset profile      │    │
│  │  GET  /api/taste  → read taste profile      │    │
│  │  POST /api/export → write export file       │    │
│  └──────────────┬──────────────────────────────┘    │
│                 │  calls                             │
│  ┌──────────────▼──────────────────────────────┐    │
│  │         Gemini Agent Loop                    │    │
│  │                                             │    │
│  │  1. Format user prompt                      │    │
│  │  2. Call Gemini API with tool schemas       │    │
│  │  3. Gemini returns function_call parts      │    │
│  │  4. Route to MCP tool handler               │    │
│  │  5. Return function_response to Gemini      │    │
│  │  6. Repeat until Gemini sends final reply   │    │
│  │  7. Push result to browser via SSE          │    │
│  └──────────────┬──────────────────────────────┘    │
│                 │  calls                             │
│  ┌──────────────▼──────────────────────────────┐    │
│  │      MCP Server (in-process, JS SDK)         │    │
│  │                                             │    │
│  │  9 tools — same as before, now in JS        │    │
│  │  File I/O: fs/promises (Node built-in)      │    │
│  │  HTTP calls: node-fetch or built-in fetch   │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  data/                                               │
│  ├── watchlist.json                                  │
│  ├── taste_profile.json                              │
│  ├── session_log.json                                │
│  └── ui_state.json                                   │
└──────────────────────────────────────────────────────┘
```

### Server-Sent Events (SSE) for live UI updates

Since the Gemini agent loop can take a few seconds (multiple tool calls), the browser subscribes to a `GET /api/stream` SSE endpoint. The Express backend pushes progress events as each tool completes:

```
event: tool_start     → "Fetching recommendations from Gemini…"
event: tool_complete  → "Poster images loaded (10/10)"
event: cards_ready    → sends the full recommendations payload
event: prefab_ready   → sends the session summary payload
event: error          → sends error message for toast display
```

This means the UI can show a live loading state ("Calling Gemini… Fetching posters… Done!") rather than a blank spinner.

---

## 4. File Structure

```
cineswipe/
│
├── server.js                  ← Express server entry point
│
├── agent/
│   └── gemini-loop.js         ← Gemini function-calling agent loop
│
├── mcp/
│   ├── server.js              ← MCP server setup (registers all tools)
│   └── tools/
│       ├── recommendations.js ← fetch_recommendations, retry_recommendations
│       ├── posters.js         ← fetch_poster_image
│       ├── watchlist.js       ← manage_watchlist, export_watchlist
│       ├── taste-profile.js   ← derive_taste_profile, edit_taste_profile,
│       │                         reset_taste_profile
│       └── ui-bridge.js       ← push_to_ui (fires SSE event to browser)
│
├── public/                    ← Static frontend (served by Express)
│   ├── index.html             ← App shell
│   ├── app.js                 ← Frontend JS (view routing, SSE listener)
│   ├── styles.css
│   └── views/
│       ├── onboarding.js      ← First-run / demo card view
│       ├── swipe.js           ← Card stack interaction
│       └── prefab.js          ← Results dashboard view
│
├── data/                      ← Runtime data (gitignored)
│   ├── watchlist.json
│   ├── taste_profile.json
│   ├── session_log.json
│   └── ui_state.json
│
├── .env                       ← GEMINI_API_KEY, GOOGLE_CSE_KEY, GOOGLE_CX
├── .env.example               ← Template (safe to commit)
├── package.json
└── README.md
```

---

## 5. Gemini Models

| Display name | Model ID | Default | Notes |
|---|---|---|---|
| ⚡ Flash 3.1 Lite | `gemini-3.1-flash-lite-preview` | ✅ Yes | Fastest and cheapest. Great for structured JSON output. Preview. |
| 🪶 Flash 2.5 Lite | `gemini-2.5-flash-lite` | Option | Stable. Better nuance, slightly more latency. |
| 🧠 Flash 2.5 | `gemini-2.5-flash` | Option | Stable. Strongest reasoning, best for niche picks. |

Model IDs verified against the [Gemini API model docs](https://ai.google.dev/gemini-api/docs/models), April 2026. The retry escalation in Tool 2 steps up from the user's selected model to `gemini-2.5-flash` on repeated failures.

---

## 6. MCP Server — 9 Tools

The MCP server is registered using `@modelcontextprotocol/sdk/server` inside the same Node.js process. The Gemini agent loop calls tool handlers directly via in-process function calls — no subprocess, no stdio pipe needed.

---

### Tool 1 · `fetch_recommendations`
**Category:** Internet — Gemini API

Calls Gemini with the user's genre, language, and (if active) taste profile. Returns a structured array of 10 recommendations. Reads the watchlist first to build the exclusion list.

**Parameters:**

| Parameter | Type | Notes |
|---|---|---|
| `genre` | string | Natural language e.g. `"slow-burn thriller"` |
| `language` | string | e.g. `"Korean"`, `"Hindi"`, `"Japanese"` |
| `media_type` | `"movie"` \| `"tv"` | Defaults to `"movie"` |
| `model` | string | Gemini model ID from UI selector |

**Gemini prompt — cold start (< 5 saves):**
```
You are a movie recommendation engine.
Return ONLY a JSON array of exactly 10 {media_type} recommendations for:
  Genre: {genre}
  Language: {language}

Fields per item:
  title, year, language, genre, overview (2 sentences max),
  why_recommended (1 sentence), rating_out_of_10,
  poster_search_query, similar_to (null)

Raw JSON array only. No markdown. No explanation.
```

**Gemini prompt — personalised (≥ 5 saves):**
```
You are a movie recommendation engine that knows this viewer's taste.

DO NOT recommend any of these already-saved titles:
{excluded_titles}

Viewer's taste profile (AI-derived):
{taste_profile_summary}

Viewer's own notes:
{user_annotations}

Recommend exactly 10 new {media_type} titles for:
  Genre: {genre} · Language: {language}
  Match the tone, pacing, and themes of the taste profile above.

Fields per item:
  title, year, language, genre, overview (2 sentences max),
  why_recommended (reference taste profile specifically),
  rating_out_of_10, poster_search_query,
  similar_to (closest title from their saved list)

Raw JSON array only. No markdown. No explanation.
```

**Returns:** `{ recommendations: [...10 items], personalised: bool, excluded_count: int }`

---

### Tool 2 · `retry_recommendations`
**Category:** Internet — Gemini API (fallback)

Called when Tool 1 returns malformed JSON or a Gemini error. Retries with a stricter prompt. Maximum 2 retries:

- Attempt 1: same model, explicit JSON-only instruction, lower temperature
- Attempt 2: forces `gemini-2.5-flash` regardless of user selection

On final failure, returns an error payload that `push_to_ui` converts into a toast notification.

---

### Tool 3 · `fetch_poster_image`
**Category:** Internet — Google Custom Search API (image mode)

Takes `poster_search_query` from Gemini's output and returns a usable image URL via Google Custom Search. Falls back to a genre-coloured inline SVG placeholder if no image is found.

**Parameters:** `query` (string), `title` (string), `genre` (string)

**Returns:** `{ image_url: string, source: "google" | "placeholder" }`

**Requirement:** Free Google Custom Search JSON API — 100 queries/day. Needs a Google Cloud API key and Custom Search Engine ID (CX), both free. Stored in `.env`.

---

### Tool 4 · `manage_watchlist`
**Category:** Local CRUD — `data/watchlist.json`

| Action | Trigger | Behaviour |
|---|---|---|
| `add` | User swipes right | Appends item, deduplicates, timestamps. Triggers `derive_taste_profile` if total ≥ 5. |
| `remove` | User removes from watchlist panel | Removes by title. Regenerates taste profile if ≥ 5 remain. |
| `list` | Session start | Returns full array + `taste_ready: bool` + `save_count: int` |
| `clear` | User clears watchlist | Empties file, resets taste profile |

**`watchlist.json` item schema:**
```json
{
  "title": "Parasite",
  "year": "2019",
  "language": "Korean",
  "genre": "thriller",
  "media_type": "movie",
  "rating_out_of_10": 9.2,
  "why_recommended": "Masterclass in genre-blending social tension",
  "similar_to": null,
  "poster_url": "https://...",
  "saved_at": "2025-01-30T14:22:00"
}
```

---

### Tool 5 · `export_watchlist`
**Category:** Local CRUD — file export

Reads `watchlist.json` and writes a formatted file to the user's Desktop (or a user-chosen path). Supports `.txt` and `.csv`.

**`.txt` output format:**
```
CineSwipe Watchlist — 30 Jan 2025
Total saved: 7
════════════════════════════════

1. Parasite (2019) ★ 9.2
   Korean · Thriller · Movie
   "Masterclass in genre-blending social tension"
...
```

**`.csv` format:** `title, year, language, genre, media_type, rating, why_recommended, saved_at`

---

### Tool 6 · `derive_taste_profile`
**Category:** Internet — Gemini API (lightweight)

Auto-called by `manage_watchlist` (add/remove) when ≥ 5 saves exist. Sends the full watchlist to Gemini and returns a 3-sentence taste summary. Writes to `taste_profile.json`.

**Gemini prompt:**
```
These are the movies/shows this viewer has saved:
{titles_with_genres}

In exactly 3 sentences, describe what they seem to enjoy in terms of:
themes, narrative tone, pacing, and storytelling style.
Be specific — avoid generic words like "compelling" or "engaging".
Plain text only.
```

**`taste_profile.json` schema:**
```json
{
  "summary": "Prefers slow-burn psychological tension...",
  "user_annotations": "",
  "derived_from_count": 7,
  "is_active": true,
  "last_updated": "2025-01-30T15:00:00"
}
```

---

### Tool 7 · `edit_taste_profile`
**Category:** Local CRUD — `data/taste_profile.json`

Saves the user's own annotations. These are injected verbatim into future recommendation prompts alongside the AI-derived summary.

**Parameters:** `user_annotations` string (max 300 chars)

---

### Tool 8 · `reset_taste_profile`
**Category:** Local CRUD — `data/taste_profile.json`

Clears the AI-derived summary and user annotations without touching the watchlist. If ≥ 5 saves remain, `derive_taste_profile` is immediately re-triggered to produce a fresh derivation from the existing titles.

---

### Tool 9 · `push_to_ui`
**Category:** Prefab UI bridge

Fires a Server-Sent Event from Express to the connected browser. The frontend's SSE listener receives the event and transitions to the appropriate view (`swipe` or `prefab`).

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `event` | `"cards"` \| `"prefab"` | Which view to show |
| `recommendations` | array | For `"cards"` event |
| `session_summary` | object | For `"prefab"` event |
| `ui_title` | string | e.g. `"Top 10 Korean Thrillers"` |
| `personalised` | bool | Whether taste profile was used |
| `error_message` | string \| null | If set, shows a toast instead |

---

## 7. Agent Flow

```
User submits form (genre, language, media_type, model)
  │
  ▼  POST /api/recommend
Express receives request → starts Gemini agent loop
  │
  ├── SSE → browser: "Reading your watchlist…"
  │
Gemini: function_call → manage_watchlist (action: list)
  │
  ├─ < 5 saves  → cold start
  └─ ≥ 5 saves  → load taste_profile.json, build excluded_titles list
  │
  ├── SSE → browser: "Asking Gemini for recommendations…"
  │
Gemini: function_call → fetch_recommendations
  │
  ├─ malformed JSON → retry_recommendations (up to 2×)
  │      └─ final failure → push_to_ui (error toast)
  │
  └─ success: 10 items
        │
        ├── SSE → browser: "Fetching poster images…"
        │
Gemini: function_call → fetch_poster_image × 10
        │
        ├── SSE → browser: "All done! Loading your cards."
        │
Gemini: function_call → push_to_ui (event: "cards")
        │
        └── SSE → browser: cards_ready payload
              │
              Browser renders swipe view

[User swipes cards]
  │
  ├─ Right swipe → POST /api/watchlist (add)
  │                  └─ if ≥ 5 saves → derive_taste_profile (background)
  │
  └─ Last card swiped
        │
        POST /api/recommend/complete
        Gemini: push_to_ui (event: "prefab")
        SSE → browser: prefab_ready payload
        Browser transitions to Prefab Results View
```

---

## 8. UI Design

### Aesthetic direction: *Cinematic Dark Luxury*

Deep black backgrounds, warm gold accents, film-grain texture overlay. Playfair Display serif for movie titles, DM Mono for metadata. Feels like a premium streaming discovery screen — not a generic web form.

---

### View 1 — Onboarding / Empty State

```
┌──────────────────────────────────────────────────────────────────┐
│  🎬 CineSwipe                                                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│      [ 3 fanned demo cards — blurred placeholder posters ]       │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  How CineSwipe works                                        │  │
│  │                                                             │  │
│  │  1. Enter your genre and language below                     │  │
│  │  2. Gemini AI fetches 10 personalised picks                 │  │
│  │  3. Swipe → to save  ·  Swipe ← to skip                    │  │
│  │  4. After 5 saves, recommendations adapt to your taste      │  │
│  │  5. When done swiping, your Results Dashboard opens         │  │
│  │                                                             │  │
│  │  Everything is stored locally. Only Gemini API calls        │  │
│  │  and poster image searches leave your machine.              │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Genre        [ slow-burn thriller      ]                        │
│  Language     [ Korean                  ]                        │
│  Type         ○ Movie   ○ TV Series                              │
│  Model        [ ⚡ Flash 3.1 Lite     ▾ ]                        │
│                                                                  │
│               [ ✨ Get Recommendations  ]                         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

### View 2 — Loading State (SSE progress)

Shown between form submit and cards appearing. Progress updates arrive via SSE.

```
┌──────────────────────────────────────────────────────────────────┐
│  🎬 CineSwipe                                                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                  [ animated film reel spinner ]                  │
│                                                                  │
│            Reading your watchlist…              ✅               │
│            Asking Gemini for recommendations…   ✅               │
│            Fetching poster images…             ⏳               │
│            Loading your cards…                                   │
│                                                                  │
│            [ ░░░░░░████████ 60% ]                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

### View 3 — Swipe View

```
┌──────────────────────────────────────────────────────────────────────┐
│  🎬 CineSwipe     Top 10 Korean Thrillers    [Model ▾]    [⚙ gear]  │
├────────────────────┬──────────────────────────┬──────────────────────┤
│                    │                          │                      │
│  NEW SEARCH        │   ┌──────────────────┐   │  MY WATCHLIST  (7)  │
│                    │   │                  │   │                      │
│  Genre             │   │  [Poster image]  │   │  Parasite  ★9.2  ✕  │
│  [_____________]   │   │                  │   │  Oldboy    ★8.4  ✕  │
│                    │   │  PARASITE   2019 │   │  Decision… ★8.1  ✕  │
│  Language          │   │  ★ 9.2           │   │  + 4 more…          │
│  [_____________]   │   │  Thriller        │   │                      │
│                    │   │  Korean          │   │  [Export .txt]       │
│  Type              │   │                  │   │  [Export .csv]       │
│  ○ Movie  ○ TV     │   │  A poor family   │   │  [Clear all]         │
│                    │   │  schemes their   │   │                      │
│  [ Get Recs ✨ ]   │   │  way into a      │   │  ─────────────────   │
│                    │   │  wealthy         │   │                      │
│  ── Progress ──    │   │  household...    │   │  TASTE PROFILE       │
│  Card 3 of 10      │   │                  │   │  ✅ Active (7 saves) │
│  ███░░░░░░  30%    │   │  💬 "If you loved│   │                      │
│                    │   │  Memories of     │   │  Prefers slow-burn   │
│  ── Taste ──       │   │  Murder, this    │   │  psychological       │
│  ✅ Active         │   │  delivers..."    │   │  tension with        │
│  7 saves           │   │                  │   │  morally complex...  │
│                    │   │  🔁 Like: Oldboy  │   │                      │
│                    │   └──────────────────┘   │  [✏ Edit / Annotate] │
│                    │                          │  [↺ Reset profile]   │
│                    │       ❌         ✅       │                      │
│                    │      Skip       Save     │                      │
│                    │   ← keyboard arrows →    │                      │
├────────────────────┴──────────────────────────┴──────────────────────┤
│  ℹ Toast area — errors and confirmations, auto-dismiss               │
└──────────────────────────────────────────────────────────────────────┘
```

---

### View 4 — Prefab Results View

Opens automatically when the last card is swiped. This is a self-contained view rendered entirely from the `prefab_ready` SSE payload — no further API calls needed after it opens.

```
┌──────────────────────────────────────────────────────────────────────┐
│  🎬 CineSwipe — Results                        [← New Search]        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │  Session Summary                                               │   │
│  │                                                                │   │
│  │  🎬 Top 10 Korean Thrillers  ·  30 Jan 2025                   │   │
│  │  Model: gemini-3.1-flash-lite-preview                         │   │
│  │  You saved 4 of 10 recommendations                            │   │
│  │  ✨ Personalised — taste profile active (7 total saves)        │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  SAVED THIS SESSION  (4)                                             │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐     │
│  │ [Poster]   │  │ [Poster]   │  │ [Poster]   │  │ [Poster]   │     │
│  │            │  │            │  │            │  │            │     │
│  │ Parasite   │  │ Oldboy     │  │ Decision   │  │ I Saw the  │     │
│  │ 2019 ★9.2  │  │2003 ★8.4  │  │ to Leave   │  │ Devil 2010 │     │
│  │ Thriller   │  │ Thriller   │  │ 2022 ★8.1  │  │ ★8.0       │     │
│  │            │  │            │  │            │  │            │     │
│  │ 💬 "If you │  │ 💬 "Brutal │  │ 💬 "Rare   │  │ 💬 "Dark   │     │
│  │ loved the  │  │ and poetic │  │ slow-burn  │  │ and        │     │
│  │ class..."  │  │ equally..."│  │ romance..."│  │ visceral…" │     │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘     │
│                                                                       │
│  ALL RECOMMENDATIONS THIS SESSION  (10)                              │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  ✅ Parasite (2019)              ★ 9.2   Saved                        │
│  ✅ Oldboy (2003)                ★ 8.4   Saved                        │
│  ✅ Decision to Leave (2022)     ★ 8.1   Saved                        │
│  ✅ I Saw the Devil (2010)       ★ 8.0   Saved                        │
│  ✗  Memories of Murder (2003)   ★ 8.6   Skipped                      │
│  ✗  The Wailing (2016)          ★ 7.9   Skipped                      │
│  ✗  A Bittersweet Life (2005)   ★ 7.8   Skipped                      │
│  ✗  The Man from Nowhere        ★ 7.7   Skipped                      │
│  ✗  Burning (2018)              ★ 7.6   Skipped                      │
│  ✗  Mother (2009)               ★ 7.8   Skipped                      │
│                                                                       │
│  ── Export ──────────────────────────────────────────────────────    │
│                                                                       │
│  [📄 Saved as .txt]   [📊 Saved as .csv]                             │
│  [📄 Full list .txt]  [📊 Full list .csv]                            │
│                                                                       │
│  [🔄 New Recommendations]        [🗑 Clear Watchlist]                │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

#### Prefab SSE payload (what `push_to_ui` sends)

```json
{
  "event": "prefab",
  "ui_title": "Top 10 Korean Thrillers",
  "session_date": "2025-01-30",
  "model_used": "gemini-3.1-flash-lite-preview",
  "personalised": true,
  "total_shown": 10,
  "saved_count": 4,
  "all_recommendations": [
    {
      "title": "Parasite",
      "year": "2019",
      "rating_out_of_10": 9.2,
      "genre": "thriller",
      "language": "Korean",
      "why_recommended": "...",
      "poster_url": "https://...",
      "saved": true
    }
  ]
}
```

#### Export options

| Button | Exports | Format |
|---|---|---|
| Saved as .txt | Only titles the user swiped right this session | Formatted text |
| Saved as .csv | Same, machine-readable | Spreadsheet |
| Full list .txt | All 10 with saved/skipped status | Formatted text |
| Full list .csv | All 10 with full metadata | Spreadsheet |

All exports are downloaded via the browser's native download mechanism (`Content-Disposition: attachment`) — no file dialog needed, goes straight to the Downloads folder.

---

### Card anatomy

```
┌──────────────────────────┐
│                          │
│   [Movie poster image]   │  ← Google Custom Search result
│   or genre-coloured SVG  │    or fallback placeholder
│                          │
├──────────────────────────┤
│ PARASITE            2019 │  ← Playfair Display
│ ★ 9.2   Thriller · Korean│  ← DM Mono
├──────────────────────────┤
│ A poor family schemes    │
│ their way into a wealthy │
│ household with dark...   │
├──────────────────────────┤
│ 💬 "If you loved the    │  ← why_recommended from Gemini
│ dread in Memories of     │    references taste profile
│ Murder..."               │    when personalised
├──────────────────────────┤
│ 🔁 Similar to: Oldboy   │  ← hidden on cold start (< 5 saves)
└──────────────────────────┘
```

### Swipe interactions

| Interaction | Result |
|---|---|
| Drag right or ✅ button | Save · card exits right · `POST /api/watchlist` |
| Drag left or ❌ button | Skip · card exits left |
| Keyboard `→` | Swipe right |
| Keyboard `←` | Swipe left |
| Last card | Prefab Results View opens automatically |

### Visual swipe feedback

- Drag right → green glow + **SAVE** stamp fades onto card
- Drag left → red glow + **SKIP** stamp fades onto card
- Card exits with rotation; next card scales up from behind

### Toast notifications

| Trigger | Message |
|---|---|
| Gemini bad JSON | ⚠ "Parsing failed — retrying with stricter prompt…" |
| Retry 1 fails | ⚠ "Retry failed — switching to Flash 2.5…" |
| Retry 2 fails | ❌ "Could not get recommendations. Check your API key in .env" |
| Poster not found | ℹ "[Title]: using placeholder" (2 s, auto-dismiss) |
| Item saved | ✅ "[Title] saved!" (2 s) |
| Export complete | ✅ "Downloading cineswipe-2025-01-30-korean-thriller.txt" |
| Taste profile reset | ℹ "Profile cleared — rebuilding from existing saves…" |

---

## 9. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | **Node.js 20+** | Built-in `fetch`, `fs/promises`, streams — minimal dependencies |
| Web server | **Express 4** | Serves static files + API routes + SSE in ~50 lines |
| MCP server | **`@modelcontextprotocol/sdk`** (JS) | Official JS SDK — tools run in-process, no subprocess |
| AI agent | **Google Gemini API** (function calling) | Single AI provider, handles orchestration and generation |
| Movie posters | **Google Custom Search API** (image mode) | Free 100 req/day |
| Poster fallback | Inline SVG coloured by genre | Zero dependency |
| Animation engine | **Anime.js v4** | Spring physics, timelines, stagger — drives all UI motion |
| Frontend | **Vanilla HTML/CSS/JS** | No build step, no bundler, no framework — opens in any browser |
| Fonts | Playfair Display + DM Mono | Google Fonts CDN |
| Live UI updates | **Server-Sent Events (SSE)** | Simpler than WebSocket for one-way server → browser push |
| Local storage | **JSON files** via `fs/promises` | Human-readable, zero dependency |
| Environment vars | **`dotenv`** | API keys in `.env`, never in code |

### Key npm dependencies

```json
{
  "dependencies": {
    "express": "^4.19.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@google/generative-ai": "^0.21.0",
    "dotenv": "^16.4.0",
    "animejs": "^4.0.0"
  }
}
```

That's it — 5 packages. No bundler, no TypeScript compiler, no build step.

---

## 10. Setup Flow

```
1. Install Node.js 20+ from nodejs.org (if not already installed)

2. Clone / download the project folder

3. Run:  npm install

4. Copy .env.example → .env  and fill in:
     GEMINI_API_KEY=your_key_here
     GOOGLE_CSE_KEY=your_key_here   ← from console.cloud.google.com (free)
     GOOGLE_CX=your_cx_id_here      ← from cse.google.com (free)

5. Run:  npm start

6. Open:  http://localhost:3000

Done. The app runs fully locally.
To stop: Ctrl+C in the terminal.
```

**Getting the Google Custom Search keys (one-time, free):**
```
1. Go to console.cloud.google.com → Enable "Custom Search API"
2. Create an API key under Credentials
3. Go to cse.google.com → Create a search engine → Enable "Image search"
4. Copy the CX ID
```

---

## 11. Personalisation Rules Summary

| Condition | Behaviour |
|---|---|
| 0–4 saves | Cold start — generic Gemini prompt, no taste context |
| 5th save | `derive_taste_profile` runs; taste becomes active |
| 6+ saves | Profile regenerated with every add or remove |
| Saves drop below 5 | Taste deactivated; cold start prompt used again |
| User edits annotations | Injected verbatim into next prompt |
| User resets profile | AI summary + annotations cleared; profile immediately re-derived from existing saves |
| Already-saved titles | Always excluded regardless of profile state |

---

## 12. Animation Design — Anime.js v4

CineSwipe uses **Anime.js v4** (`animejs` on npm) to make every view feel like a living piece of software rather than a static web page. The aesthetic goal is **cinematic HUD** — like a premium media OS, not a website. Every state change, every data arrival, every interaction has a deliberate animation.

### Installation

```js
// Loaded as an ES module — no bundler needed
import anime from '/node_modules/animejs/lib/anime.esm.js';
```

Or via CDN for development:
```html
<script type="module">
  import anime from 'https://cdn.jsdelivr.net/npm/animejs@4/lib/anime.esm.min.js';
</script>
```

---

### Animation Catalogue

Every named animation in the app, per view and trigger.

---

#### A. App Shell — Initial Load

**`shellReveal`** — Runs once when the page first loads. Gives the whole app a "booting up" feel.

```
Timeline sequence (total ~1.2s):

0ms    Header slides down from y: -40 → 0, opacity 0 → 1
       ease: spring(1, 80, 10)

150ms  Left panel slides in from x: -30 → 0, opacity 0 → 1
       ease: 'out(3)'

150ms  Right panel slides in from x: 30 → 0, opacity 0 → 1
       (same timing as left, creates symmetrical reveal)

300ms  Center content fades in, scale: 0.95 → 1
       ease: spring(1, 90, 14)

400ms  scanline overlay animates backgroundPosition top → bottom, loop: true
       (subtle, ~4s loop — persistent atmospheric effect)
```

**Scanline CSS variable animation** (persistent background effect):
```js
anime({
  targets: 'body',
  '--scanline-offset': ['0%', '100%'],
  duration: 4000,
  loop: true,
  ease: 'linear'
});
```

---

#### B. Onboarding View

**`demoCarsFloat`** — The three placeholder demo cards breathe gently while waiting for user input. Staggered so each card moves slightly out of phase with the others.

```js
anime({
  targets: '.demo-card',
  translateY: [-6, 6],
  rotate: ['-1deg', '1deg'],
  duration: 3000,
  loop: true,
  alternate: true,
  delay: anime.stagger(400),         // cards drift out of phase
  ease: 'inOut(2)'
});
```

**`formFieldReveal`** — Input fields appear with a staggered slide-up:
```js
anime({
  targets: '.form-field',
  translateY: [20, 0],
  opacity: [0, 1],
  duration: 500,
  delay: anime.stagger(80),
  ease: 'out(3)'
});
```

**`submitButtonPulse`** — The "Get Recommendations" button has a slow gold glow pulse on idle:
```js
anime({
  targets: '.btn-submit',
  boxShadow: [
    '0 0 0px rgba(201,168,76,0)',
    '0 0 24px rgba(201,168,76,0.5)'
  ],
  duration: 1800,
  loop: true,
  alternate: true,
  ease: 'inOut(2)'
});
```

---

#### C. Loading View (SSE Progress Steps)

**`progressBarFill`** — Smooth fill as each tool completes:
```js
anime({
  targets: '.progress-fill',
  width: `${percent}%`,
  duration: 600,
  ease: 'out(3)'
});
```

**`stepCheckReveal`** — Each step's ✅ icon animates in when the SSE event arrives:
```js
anime({
  targets: `.step[data-id="${stepId}"] .check`,
  scale: [0, 1.2, 1],
  opacity: [0, 1],
  duration: 400,
  ease: 'spring(1, 100, 12)'
});
```

**`stepTextGlow`** — Active step text glows gold:
```js
anime({
  targets: `.step.active .label`,
  color: ['#8a7a5a', '#c9a84c'],
  duration: 300,
  ease: 'out(2)'
});
```

**`spinnerOrbit`** — The film reel loading icon: two rings orbiting opposite directions:
```js
anime({
  targets: '.spinner-ring-outer',
  rotate: '1turn',
  duration: 2000,
  loop: true,
  ease: 'linear'
});
anime({
  targets: '.spinner-ring-inner',
  rotate: '-1turn',
  duration: 1400,
  loop: true,
  ease: 'linear'
});
```

---

#### D. Swipe View — Card Stack Entrance

**`stackReveal`** — Cards appear when the `cards_ready` SSE event fires. Top card flies in; cards behind scale up from underneath in sequence.

```js
// Cards appear staggered from back to front
anime({
  targets: '.movie-card',
  translateY: [80, 0],
  opacity: [0, 1],
  scale: [0.85, 1],
  duration: 700,
  delay: anime.stagger(60, { from: 'last' }),  // back cards first
  ease: 'spring(1, 80, 12)'
});
```

**`cardHoverLift`** — Top card subtly lifts on mouse enter:
```js
// Applied on mouseenter / mouseleave
anime({
  targets: '.movie-card.is-top',
  translateY: -6,
  boxShadow: '0 32px 80px rgba(0,0,0,0.9)',
  duration: 200,
  ease: 'out(2)'
});
```

---

#### E. Swipe Interaction (the centrepiece)

The drag uses Anime.js's `animate()` with `composition: 'replace'` for smooth real-time following, and a spring throw on release.

**`cardFollowDrag`** — Card tracks mouse/touch in real time:
```js
// Called on mousemove/touchmove
anime({
  targets: activeCard,
  translateX: deltaX,
  translateY: deltaY * 0.3,
  rotate: `${deltaX * 0.08}deg`,
  duration: 80,
  ease: 'out(1)',
  composition: 'replace'             // overwrites previous frame instantly
});
```

**`stampReveal`** — SAVE or SKIP stamp fades in as drag crosses threshold (±80px):
```js
anime({
  targets: deltaX > 0 ? '.stamp-save' : '.stamp-skip',
  opacity: [0, Math.min(1, Math.abs(deltaX) / 120)],
  scale: [0.8, 1],
  rotate: deltaX > 0 ? ['-8deg', '-4deg'] : ['8deg', '4deg'],
  duration: 100,
  ease: 'out(2)',
  composition: 'replace'
});
```

**`cardThrowRight`** — Spring throw on right-release (save):
```js
anime({
  targets: activeCard,
  translateX: window.innerWidth + 200,
  translateY: -60,
  rotate: '25deg',
  opacity: 0,
  duration: 500,
  ease: 'out(3)',
  onComplete: () => revealNextCard()
});
```

**`cardThrowLeft`** — Spring throw on left-release (skip):
```js
anime({
  targets: activeCard,
  translateX: -(window.innerWidth + 200),
  translateY: -60,
  rotate: '-25deg',
  opacity: 0,
  duration: 500,
  ease: 'out(3)',
  onComplete: () => revealNextCard()
});
```

**`cardSnapBack`** — If drag released before threshold (neither save nor skip):
```js
anime({
  targets: activeCard,
  translateX: 0,
  translateY: 0,
  rotate: '0deg',
  duration: 600,
  ease: 'spring(1, 80, 10)'         // elastic snap back
});
anime({
  targets: ['.stamp-save', '.stamp-skip'],
  opacity: 0,
  duration: 200,
  ease: 'out(2)'
});
```

**`nextCardPromote`** — Second card scales up to top position when current card exits:
```js
anime({
  targets: '.movie-card.is-second',
  scale: [0.95, 1],
  translateY: [12, 0],
  duration: 400,
  ease: 'spring(1, 90, 14)'
});
```

---

#### F. Swipe View — UI Panels

**`watchlistItemAdd`** — New item slides into the watchlist panel on right swipe:
```js
anime({
  targets: newWatchlistItem,
  translateX: [30, 0],
  opacity: [0, 1],
  duration: 400,
  ease: 'out(3)'
});
// Gold flash on the watchlist count badge
anime({
  targets: '.watchlist-count',
  color: ['#c9a84c', '#e8e2d4'],
  scale: [1.3, 1],
  duration: 500,
  ease: 'spring(1, 80, 12)'
});
```

**`progressBarUpdate`** — Progress bar fills as cards are swiped:
```js
anime({
  targets: '.swipe-progress-fill',
  width: `${(currentCard / totalCards) * 100}%`,
  duration: 400,
  ease: 'out(3)'
});
```

**`tasteBadgeActivate`** — When the 5th save triggers the taste profile, the "Taste Profile" section in the left panel animates:
```js
// Timeline: badge lights up, text types in, panel pulses gold
const tl = anime.timeline();
tl.add({
  targets: '.taste-status-dot',
  backgroundColor: ['#555', '#c9a84c'],
  boxShadow: ['0 0 0 #0000', '0 0 12px rgba(201,168,76,0.6)'],
  duration: 600,
  ease: 'out(3)'
})
.add({
  targets: '.taste-summary-text',
  opacity: [0, 1],
  translateY: [8, 0],
  duration: 400,
  ease: 'out(3)'
}, '-=200')
.add({
  targets: '.panel-taste',
  borderColor: ['rgba(255,255,255,0.07)', 'rgba(201,168,76,0.4)', 'rgba(255,255,255,0.07)'],
  duration: 1000,
  ease: 'inOut(2)'
}, '-=200');
```

**`tasteProfileExpand`** — Edit panel slides open when user clicks "✏ Edit / Annotate":
```js
anime({
  targets: '.taste-edit-panel',
  height: [0, 180],
  opacity: [0, 1],
  duration: 400,
  ease: 'spring(1, 80, 14)'
});
```

---

#### G. Toast Notifications

**`toastSlideIn`** — Toasts slide up from the bottom:
```js
anime({
  targets: toastEl,
  translateY: [40, 0],
  opacity: [0, 1],
  duration: 350,
  ease: 'spring(1, 80, 12)'
});
```

**`toastSlideOut`** — Auto-dismiss after 2–3s:
```js
anime({
  targets: toastEl,
  translateY: [0, 20],
  opacity: [1, 0],
  duration: 300,
  ease: 'in(2)',
  onComplete: () => toastEl.remove()
});
```

**`toastShake`** — Error toasts shake once to demand attention:
```js
anime({
  targets: toastEl,
  translateX: [0, -8, 8, -6, 6, -3, 3, 0],
  duration: 500,
  ease: 'out(2)'
});
```

---

#### H. Prefab Results View

**`prefabReveal`** — Full view entrance when the last card is swiped. Feels like a mission debrief screen.

```js
// Timeline: header first, then summary card, then saved grid, then full list
const tl = anime.timeline({ ease: 'out(3)' });

tl.add({
  targets: '.prefab-header',
  translateY: [-30, 0],
  opacity: [0, 1],
  duration: 500
})
.add({
  targets: '.session-summary',
  translateY: [20, 0],
  opacity: [0, 1],
  duration: 450
}, '-=200')
.add({
  targets: '.saved-card-grid .poster-card',
  translateY: [40, 0],
  opacity: [0, 1],
  scale: [0.9, 1],
  duration: 500,
  delay: anime.stagger(80)          // cards appear one by one
}, '-=200')
.add({
  targets: '.full-list-row',
  translateX: [-20, 0],
  opacity: [0, 1],
  duration: 300,
  delay: anime.stagger(40)
}, '-=300');
```

**`savedCounterRoll`** — The "You saved 4 of 10" counter rolls up digit-by-digit:
```js
anime({
  targets: { value: 0 },
  value: savedCount,
  round: 1,
  duration: 800,
  ease: 'out(3)',
  onUpdate(anim) {
    counterEl.textContent = `You saved ${anim.targets[0].value} of ${totalCount}`;
  }
});
```

**`exportButtonReady`** — Export buttons pulse gold once when the view fully loads, drawing attention:
```js
anime({
  targets: '.btn-export',
  boxShadow: [
    '0 0 0 rgba(201,168,76,0)',
    '0 0 20px rgba(201,168,76,0.5)',
    '0 0 0 rgba(201,168,76,0)'
  ],
  duration: 1200,
  delay: anime.stagger(100),
  ease: 'inOut(2)'
});
```

**`rowSavedGlow`** — Saved rows in the full list flash gold on reveal:
```js
anime({
  targets: '.full-list-row.saved',
  backgroundColor: ['rgba(201,168,76,0.15)', 'rgba(201,168,76,0)'],
  duration: 1000,
  delay: anime.stagger(50),
  ease: 'out(3)'
});
```

---

#### I. Persistent Background — HUD Grid

A subtle animated SVG grid overlaid on the dark background. Gives the app depth and makes it feel like a live interface rather than a static page.

**`gridPulse`** — Grid lines pulse in opacity with a slow wave, staggered by column:
```js
anime({
  targets: '.grid-line',
  opacity: [0.03, 0.08, 0.03],
  duration: 3000,
  loop: true,
  delay: anime.stagger(200, { grid: [12, 8], from: 'center' }),
  ease: 'inOut(2)'
});
```

**`ambientDrift`** — Two radial gradient blobs drift slowly behind the content, driven by Anime.js Timer:
```js
anime({
  targets: '.ambient-blob-gold',
  translateX: [-30, 30],
  translateY: [-20, 20],
  duration: 8000,
  loop: true,
  alternate: true,
  ease: 'inOut(2)'
});
anime({
  targets: '.ambient-blob-purple',
  translateX: [20, -20],
  translateY: [15, -15],
  duration: 10000,
  loop: true,
  alternate: true,
  ease: 'inOut(2)'
});
```

---

### Animation Summary Table

| ID | Trigger | Target | Effect | Duration |
|---|---|---|---|---|
| `shellReveal` | Page load | Header, panels, center | Staged slide-in reveal | 1.2s total |
| `scanlineLoop` | Always | Body CSS var | Scanline scrolls down | 4s loop |
| `demoCarsFloat` | Onboarding visible | Demo cards | Gentle float + tilt | 3s loop |
| `submitButtonPulse` | Idle on form | Submit button | Gold glow breathe | 1.8s loop |
| `progressBarFill` | SSE `tool_complete` | Progress bar | Width fill | 600ms |
| `stepCheckReveal` | SSE step done | ✅ icon | Scale-in pop | 400ms |
| `spinnerOrbit` | Loading active | Ring SVGs | Counter-rotation | 2s loop |
| `stackReveal` | SSE `cards_ready` | Card stack | Staggered fly-in | 700ms |
| `cardFollowDrag` | mousemove | Active card | Real-time follow | 80ms |
| `stampReveal` | Drag > threshold | SAVE/SKIP stamp | Fade + scale in | 100ms |
| `cardThrowRight` | Release right | Active card | Spring throw exit | 500ms |
| `cardThrowLeft` | Release left | Active card | Spring throw exit | 500ms |
| `cardSnapBack` | Release < threshold | Active card | Elastic snap back | 600ms |
| `nextCardPromote` | Card exits | Next card | Scale up to top | 400ms |
| `watchlistItemAdd` | Right swipe | New list item | Slide in + count flash | 400ms |
| `tasteBadgeActivate` | 5th save | Taste panel | Gold light-up + text in | 1.2s |
| `tasteProfileExpand` | Edit click | Edit panel | Height expand | 400ms |
| `toastSlideIn` | Any toast | Toast element | Slide up | 350ms |
| `toastSlideOut` | Auto-dismiss | Toast element | Slide down + fade | 300ms |
| `toastShake` | Error toast | Toast element | Shake | 500ms |
| `prefabReveal` | Last card swiped | All prefab elements | Timeline reveal | 1.5s total |
| `savedCounterRoll` | Prefab open | Counter text | Number roll-up | 800ms |
| `exportButtonReady` | Prefab loaded | Export buttons | Gold pulse | 1.2s |
| `rowSavedGlow` | Prefab list render | Saved rows | Gold flash fade | 1s |
| `gridPulse` | Always | SVG grid lines | Wave opacity pulse | 3s loop |
| `ambientDrift` | Always | Gradient blobs | Slow drift | 8–10s loop |

---

### What "futuristic" means in practice

Rather than random flying particles (which feels generic), CineSwipe's animation language is built around three ideas:

**1. Data arriving feels like data.** When cards appear, they don't just fade in — they fly in from below with spring physics, like they've been computed and delivered. The SSE progress steps check off in sequence. The counter rolls up. This makes the AI feel *active*, not invisible.

**2. Physical interaction has weight.** The drag uses real spring physics (not CSS transitions). Cards snap back elastically if you don't commit. Throwing a card feels satisfying because the animation has momentum and overshoot.

**3. The interface breathes.** The scanline overlay, grid pulse, ambient blobs, floating demo cards, and breathing submit button all use slow looping animations. They're not distracting — they make the screen feel alive when nothing else is happening.

---

## 13. Out of Scope (for now)

- Any cloud hosting or deployment
- Trailer playback or streaming availability
- Multiple user profiles
- User star ratings or written reviews
- Mobile layout (desktop browser only for now)
- Scheduled or automated recommendation runs

---

*Ready for your feedback. Once approved, build order: `server.js` + Express routes → MCP tools → Gemini agent loop → frontend views (onboarding → swipe → prefab) → `.env` setup guide.*
