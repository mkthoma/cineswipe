import { sendSSE } from '../mcp/tools/ui-bridge.js';
import { manage_watchlist } from '../mcp/tools/watchlist.js';
import { fetch_recommendations, retry_recommendations } from '../mcp/tools/recommendations.js';
import { fetch_poster_image } from '../mcp/tools/posters.js';

export async function runRecommendationLoop(params, sessionRef) {
  const { genre, language, media_type, model } = params;

  // ── Step 0: Read watchlist ──────────────────────────────────────────
  sendSSE('tool_start', { message: 'Executing MCP tool: manage_watchlist…', step: 0 });
  const watchlistData = await manage_watchlist({ action: 'list' });
  sendSSE('tool_complete', { step: 0 });

  const { items: watchlistItems, taste_ready, save_count } = watchlistData;
  const excluded_titles = watchlistItems.map(i => i.title);

  // ── Step 1: Get recommendations from Gemini ─────────────────────────
  sendSSE('tool_start', { message: 'Executing MCP tool: fetch_recommendations…', step: 1 });

  let recsResult;
  try {
    recsResult = await fetch_recommendations({
      genre, language, media_type, model,
      excluded_titles, taste_ready,
    });
  } catch (err) {
    sendSSE('toast', { type: 'warning', message: '⚠ Parsing failed — retrying with stricter prompt…', duration: 3000 });
    try {
      recsResult = await retry_recommendations({
        genre, language, media_type, model,
        excluded_titles, taste_ready, attempt: 1,
      });
    } catch {
      sendSSE('toast', { type: 'warning', message: '⚠ Retry failed — switching to Flash 2.5…', duration: 3000 });
      try {
        recsResult = await retry_recommendations({
          genre, language, media_type,
          model: 'gemini-2.5-flash',
          excluded_titles, taste_ready, attempt: 2,
        });
      } catch {
        sendSSE('error', { message: '❌ Could not get recommendations. Check your NVIDIA_API_KEY in .env' });
        return;
      }
    }
  }

  sendSSE('tool_complete', { step: 1 });

  // Update session metadata
  sessionRef.personalised = recsResult.personalised;

  // ── Step 2: Fetch poster images in parallel ──────────────────────────
  // When TMDB was used as the rec source, poster_url is already embedded —
  // skip the extra API call for those to save a full round of TMDB requests.
  sendSSE('tool_start', { message: 'Executing MCP tool: fetch_poster_image…', step: 2 });

  let completedPosters = 0;
  const total = recsResult.recommendations.length;

  const recsWithPosters = await Promise.all(
    recsResult.recommendations.map(async (rec) => {
      if (rec.poster_url) {
        // Already provided by TMDB — no extra fetch needed
        completedPosters++;
        sendSSE('poster_progress', { count: completedPosters, total });
        return rec;
      }

      const poster = await fetch_poster_image({
        query:      rec.poster_search_query || `${rec.title} ${rec.year} ${media_type === 'tv' ? 'TV series' : 'movie'} poster`,
        title:      rec.title,
        genre:      rec.genre,
        media_type,
      });
      completedPosters++;
      sendSSE('poster_progress', { count: completedPosters, total });
      if (poster.source === 'placeholder') {
        sendSSE('toast', { type: 'info', message: `${rec.title}: using placeholder`, duration: 2000 });
      }
      return { ...rec, poster_url: poster.image_url };
    })
  );

  sendSSE('tool_complete', { step: 2 });

  // ── Step 3: Push cards to browser ───────────────────────────────────
  sendSSE('tool_start', { message: 'All done! Loading your cards.', step: 3 });

  const ui_title = `Top 10 ${language} ${genre.charAt(0).toUpperCase() + genre.slice(1)}`;

  sessionRef.recommendations = recsWithPosters;
  sessionRef.ui_title = ui_title;

  sendSSE('cards_ready', {
    recommendations: recsWithPosters,
    ui_title,
    personalised: recsResult.personalised,
    save_count,
  });

  sendSSE('tool_complete', { step: 3 });
}
