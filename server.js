import express from 'express';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { ROOT_DIR, DATA_DIR, PUBLIC_DIR, PORT } from './config.js';
import { addSSEClient, removeSSEClient, sendSSE } from './mcp/tools/ui-bridge.js';
import { runRecommendationLoop } from './agent/gemini-loop.js';
import { manage_watchlist, export_watchlist } from './mcp/tools/watchlist.js';
import { edit_taste_profile, reset_taste_profile } from './mcp/tools/taste-profile.js';

// ── Summary HTML generation (native Node.js — no Python dependency) ──────────
async function generateSummaryHTML(sessionData) {
  const {
    ui_title = 'Your Recommendations',
    session_date = new Date().toISOString().split('T')[0],
    model_used = '',
    personalised = false,
    total_shown = 0,
    saved_count = 0,
    all_recommendations = [],
    time_taken_seconds = 0,
  } = sessionData;

  const skipped_count = total_shown - saved_count;
  const save_rate = total_shown > 0 ? Math.round((saved_count / total_shown) * 100) : 0;
  const saved = all_recommendations.filter(r => r.saved);
  const all   = all_recommendations;

  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const movieCard = (m, index) => `
    <div class="movie-card${m.saved ? '' : ' card-skipped'}">
      ${m.poster_url
        ? `<img class="movie-poster" src="${esc(m.poster_url)}" alt="${esc(m.title)}" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="movie-poster-placeholder"><span>${index + 1}</span></div>`}
      <div class="movie-info">
        <div class="movie-title">
          ${esc(m.title)}
          ${m.saved
            ? '<span class="badge-saved">Saved</span>'
            : '<span class="badge-skipped">Skipped</span>'}
        </div>
        <div class="movie-meta">${esc(m.year || '')}${m.year && m.genre ? ' · ' : ''}${esc(m.genre || '')}${m.language && m.language !== 'English' ? ' · ' + esc(m.language) : ''}</div>
        ${m.rating_out_of_10 ? `<div class="movie-rating">★ ${m.rating_out_of_10}/10</div>` : ''}
        ${m.why_recommended ? `<div class="movie-synopsis">${esc(m.why_recommended)}</div>` : ''}
      </div>
    </div>`;

  // (tableRow removed — All Recommendations now uses the same card grid as Saved)

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ui_title)} — CineSwipe Summary</title>
<style>
  :root {
    --bg: #0e0e13; --surface: #16161e; --surface2: #1e1e28;
    --border: rgba(255,255,255,0.08); --text: #e8e8f0; --muted: #8888aa;
    --gold: #c9a84c; --gold-dim: rgba(201,168,76,0.15);
    --green: #4caf79; --red: #e05c5c;
    --radius: 10px; --radius-sm: 6px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; min-height: 100vh; }
  .container { max-width: 1000px; margin: 0 auto; padding: 32px 20px 60px; }
  .header { text-align: center; margin-bottom: 36px; }
  .header h1 { font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; }
  .header .sub { color: var(--muted); font-size: 0.9rem; margin-top: 6px; }
  .header .model-tag { display: inline-block; background: var(--gold-dim); color: var(--gold); border: 1px solid rgba(201,168,76,0.3); border-radius: 100px; padding: 2px 12px; font-size: 0.8rem; margin-top: 8px; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 36px; }
  @media (max-width: 600px) { .stats-grid { grid-template-columns: repeat(2, 1fr); } }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 16px; text-align: center; }
  .stat-value { font-size: 2rem; font-weight: 700; }
  .stat-value.gold { color: var(--gold); }
  .stat-value.green { color: var(--green); }
  .stat-label { font-size: 0.8rem; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.06em; }
  .tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--border); margin-bottom: 28px; }
  .tab-btn { background: none; border: none; color: var(--muted); font-size: 0.95rem; padding: 10px 16px; cursor: pointer; position: relative; transition: color .2s; }
  .tab-btn:hover { color: var(--text); }
  .tab-btn.active { color: var(--gold); }
  .tab-btn.active::after { content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: var(--gold); border-radius: 2px 2px 0 0; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  .movies-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 18px; }
  .movie-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); display: flex; gap: 14px; padding: 14px; overflow: hidden; }
  .movie-poster { width: 70px; height: 100px; object-fit: cover; border-radius: var(--radius-sm); flex-shrink: 0; }
  .movie-poster-placeholder { width: 70px; height: 100px; background: var(--surface2); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 1.4rem; font-weight: 700; flex-shrink: 0; }
  .movie-info { flex: 1; min-width: 0; }
  .movie-title { font-weight: 600; font-size: 0.95rem; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .movie-meta { font-size: 0.8rem; color: var(--muted); margin-bottom: 4px; }
  .movie-rating { font-size: 0.85rem; color: var(--gold); margin-bottom: 6px; }
  .movie-synopsis { font-size: 0.8rem; color: var(--muted); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
  .badge-saved   { background: rgba(76,175,121,0.15); color: var(--green); border: 1px solid rgba(76,175,121,0.3);  border-radius: 100px; padding: 1px 8px; font-size: 0.72rem; font-weight: 600; white-space: nowrap; }
  .badge-skipped { background: rgba(224,92,92,0.10); color: var(--red);   border: 1px solid rgba(224,92,92,0.2);  border-radius: 100px; padding: 1px 8px; font-size: 0.72rem; white-space: nowrap; }
  .card-skipped  { opacity: 0.7; }
  .empty-msg { text-align: center; color: var(--muted); padding: 48px 0; font-size: 0.9rem; }
  .footer { margin-top: 48px; text-align: center; color: var(--muted); font-size: 0.8rem; }
</style>
</head>
<body>
<div class="container">

  <div class="header">
    <h1>🎬 ${esc(ui_title)}</h1>
    <div class="sub">${esc(session_date)} · ${time_taken_seconds}s · ${personalised ? 'Personalised' : 'Generic'} session</div>
    ${model_used ? `<div class="model-tag">${esc(model_used)}</div>` : ''}
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${total_shown}</div>
      <div class="stat-label">Shown</div>
    </div>
    <div class="stat-card">
      <div class="stat-value green">${saved_count}</div>
      <div class="stat-label">Saved</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${skipped_count}</div>
      <div class="stat-label">Skipped</div>
    </div>
    <div class="stat-card">
      <div class="stat-value gold">${save_rate}%</div>
      <div class="stat-label">Save Rate</div>
    </div>
  </div>

  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab(event,'saved')">Saved (${saved_count})</button>
    <button class="tab-btn" onclick="switchTab(event,'all')">All Recommendations (${total_shown})</button>
  </div>

  <div id="tab-saved" class="tab-panel active">
    ${saved.length === 0
      ? '<div class="empty-msg">No movies were saved this session.</div>'
      : `<div class="movies-grid">${saved.map((m,i) => movieCard(m,i)).join('')}</div>`}
  </div>

  <div id="tab-all" class="tab-panel">
    ${all.length === 0
      ? '<div class="empty-msg">No recommendations found.</div>'
      : `<div class="movies-grid">${all.map((m, i) => movieCard(m, i)).join('')}</div>`}
  </div>

  <div class="footer">Generated by CineSwipe · ${esc(session_date)}</div>
</div>
<script>
function switchTab(e, id) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  e.currentTarget.classList.add('active');
  document.getElementById('tab-' + id).classList.add('active');
}
</script>
</body>
</html>`;

  const outFile = join(PUBLIC_DIR, 'summary_output.html');
  await writeFile(outFile, html, 'utf-8');
  return '/summary_output.html';
}

// ── Session state (in-memory, single-user) ──────────────────────────────────
let currentSession = {
  recommendations: [],
  ui_title: '',
  model_used: '',
  personalised: false,
  date: new Date().toISOString().split('T')[0],
};

// ── Startup: ensure data directory and default files ────────────────────────
async function initDataDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
  const defaults = {
    'watchlist.json': [],
    'taste_profile.json': { summary: '', user_annotations: '', derived_from_count: 0, is_active: false, last_updated: null },
    'session_log.json': [],
    'ui_state.json': { last_view: 'onboarding' },
  };
  for (const [file, value] of Object.entries(defaults)) {
    const p = join(DATA_DIR, file);
    if (!existsSync(p)) {
      await writeFile(p, JSON.stringify(value, null, 2));
    }
  }
}

// ── Express setup ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.get('/lib/anime.js', (_, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(join(ROOT_DIR, 'node_modules/animejs/lib/anime.es.js'));
});

// ── SSE stream ───────────────────────────────────────────────────────────────
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');

  addSSEClient(res);
  req.on('close', () => removeSSEClient(res));
});

// ── App state ─────────────────────────────────────────────────────────────────
app.get('/api/state', async (req, res) => {
  try {
    const watchlist = JSON.parse(await readFile(join(DATA_DIR, 'watchlist.json'), 'utf-8'));
    const taste = JSON.parse(await readFile(join(DATA_DIR, 'taste_profile.json'), 'utf-8'));
    res.json({ watchlist, taste });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Recommendations ───────────────────────────────────────────────────────────
app.post('/api/recommend', (req, res) => {
  const { genre, language, media_type = 'movie', model = 'mistralai/mistral-medium-3.5-128b' } = req.body;

  if (!genre?.trim() || !language?.trim()) {
    return res.status(400).json({ error: 'genre and language are required' });
  }

  currentSession = {
    recommendations: [],
    ui_title: `Top 10 ${language} ${genre}`,
    model_used: model,
    personalised: false,
    date: new Date().toISOString().split('T')[0],
    start_time: Date.now(),
  };

  res.json({ status: 'started' });

  runRecommendationLoop({ genre: genre.trim(), language: language.trim(), media_type, model }, currentSession)
    .catch(err => sendSSE('error', { message: err.message }));
});

app.post('/api/recommend/complete', async (req, res) => {
  const { savedTitles = [] } = req.body;
  res.json({ status: 'ok' }); // respond immediately; generation is async

  const allRecs = currentSession.recommendations.map(r => ({
    ...r,
    saved: savedTitles.includes(r.title),
  }));

  const sessionData = {
    ui_title:             currentSession.ui_title,
    session_date:         currentSession.date,
    model_used:           currentSession.model_used,
    personalised:         currentSession.personalised,
    total_shown:          allRecs.length,
    saved_count:          savedTitles.length,
    all_recommendations:  allRecs,
    time_taken_seconds:   Math.round((Date.now() - (currentSession.start_time || Date.now())) / 1000),
  };

  try {
    sendSSE('toast', { type: 'info', message: 'Building your summary…', duration: 4000 });
    const url = await generateSummaryHTML(sessionData);
    sendSSE('prefab_ready', { url, sessionData });
  } catch (err) {
    console.error('[prefab]', err.message);
    sendSSE('error', { message: 'Could not build the summary view. Check server logs.' });
  }
});

// ── Watchlist ─────────────────────────────────────────────────────────────────
app.get('/api/watchlist', async (req, res) => {
  try {
    const data = await readFile(join(DATA_DIR, 'watchlist.json'), 'utf-8');
    res.json(JSON.parse(data));
  } catch {
    res.json([]);
  }
});

app.post('/api/watchlist', async (req, res) => {
  try {
    const result = await manage_watchlist(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Taste profile ──────────────────────────────────────────────────────────────
app.get('/api/taste', async (req, res) => {
  try {
    const data = await readFile(join(DATA_DIR, 'taste_profile.json'), 'utf-8');
    res.json(JSON.parse(data));
  } catch {
    res.json({ summary: '', user_annotations: '', is_active: false });
  }
});

app.post('/api/taste', async (req, res) => {
  const { action, user_annotations } = req.body;
  try {
    let result;
    if (action === 'edit') {
      result = await edit_taste_profile({ user_annotations });
    } else if (action === 'reset') {
      result = await reset_taste_profile();
      sendSSE('toast', { type: 'info', message: 'Taste profile reset.', duration: 3000 });
    } else {
      return res.status(400).json({ error: 'action must be edit or reset' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Export ─────────────────────────────────────────────────────────────────────
app.post('/api/export', async (req, res) => {
  const { format = 'txt', scope = 'saved', session_data = null } = req.body;
  try {
    const { content, filename } = await export_watchlist({ format, scope, session_data });
    const mime = format === 'json'     ? 'application/json'
               : format === 'markdown' ? 'text/markdown'
               : 'text/plain';
    res.setHeader('Content-Type', `${mime}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Image proxy (for cross-origin poster images in PDF exports) ───────────────
app.get('/api/proxy-image', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required' });
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(502).send('Upstream error');
    const buf = await upstream.arrayBuffer();
    const ct  = upstream.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
await initDataDir();

app.listen(PORT, () => {
  console.log(`\n🎬  CineSwipe is running → http://localhost:${PORT}\n`);
  console.log('  Press Ctrl+C to stop.\n');
});
