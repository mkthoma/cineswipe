import OpenAI from 'openai';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DATA_DIR, FALLBACK_MODEL, NVIDIA_BASE_URL } from '../../config.js';

// ── Language name → ISO 639-1 code ──────────────────────────────────────────
const LANGUAGE_MAP = {
  english: 'en',    hindi: 'hi',      korean: 'ko',     japanese: 'ja',
  spanish: 'es',    french: 'fr',     tamil: 'ta',      telugu: 'te',
  italian: 'it',    german: 'de',     chinese: 'zh',    arabic: 'ar',
  portuguese: 'pt', russian: 'ru',    turkish: 'tr',    thai: 'th',
  vietnamese: 'vi', indonesian: 'id', malay: 'ms',      punjabi: 'pa',
  bengali: 'bn',    marathi: 'mr',    urdu: 'ur',       kannada: 'kn',
  malayalam: 'ml',  dutch: 'nl',      swedish: 'sv',    norwegian: 'no',
  danish: 'da',     polish: 'pl',     czech: 'cs',      greek: 'el',
  hebrew: 'he',     persian: 'fa',    romanian: 'ro',   hungarian: 'hu',
};

// ── TMDB genre name → ID ─────────────────────────────────────────────────────
const GENRE_MAP_MOVIE = {
  action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80,
  documentary: 99, drama: 18, fantasy: 14, history: 36, horror: 27,
  music: 10402, mystery: 9648, romance: 10749, 'science fiction': 878,
  'sci-fi': 878, scifi: 878, sf: 878, thriller: 53, war: 10752, western: 37,
  superhero: 28, sport: 18, sports: 18, psychological: 53,
  'slow-burn': 53, 'slow burn': 53, suspense: 53,
};

const GENRE_MAP_TV = {
  action: 10759, adventure: 10759, animation: 16, comedy: 35, crime: 80,
  documentary: 99, drama: 18, fantasy: 10765, 'sci-fi': 10765, scifi: 10765,
  'science fiction': 10765, sf: 10765, mystery: 9648, romance: 10749,
  thriller: 53, war: 10768, western: 37, reality: 10764,
  psychological: 53, 'slow-burn': 53, 'slow burn': 53, suspense: 53,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function resolveLanguageCode(language) {
  const key = language.toLowerCase().trim();
  if (LANGUAGE_MAP[key]) return LANGUAGE_MAP[key];
  for (const [name, code] of Object.entries(LANGUAGE_MAP)) {
    if (key.includes(name) || name.startsWith(key)) return code;
  }
  return null;
}

function resolveGenreId(genre, mediaType) {
  const map    = mediaType === 'tv' ? GENRE_MAP_TV : GENRE_MAP_MOVIE;
  const key    = genre.toLowerCase().trim();
  if (map[key] !== undefined) return map[key];
  for (const [name, id] of Object.entries(map)) {
    if (key.includes(name)) return id;
  }
  return null;
}

function isExcluded(title, excludedTitles) {
  const t = title.toLowerCase();
  return excludedTitles.some(e => e.toLowerCase() === t);
}

// ── TMDB discovery ────────────────────────────────────────────────────────────
async function discoverFromTMDB({ genre, language, media_type, excluded_titles, minResults = 10 }) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey || apiKey === 'your_tmdb_api_key_here') return null;

  const langCode = resolveLanguageCode(language);
  const genreId  = resolveGenreId(genre, media_type);
  const type     = media_type === 'tv' ? 'tv' : 'movie';

  // Fetch 2 pages (40 results) to have enough after filtering excluded titles
  const allResults = [];
  for (let page = 1; page <= 2; page++) {
    const params = new URLSearchParams({
      api_key:           apiKey,
      sort_by:           'popularity.desc',
      'vote_count.gte':  '50',
      'vote_average.gte':'5.5',
      include_adult:     'false',
      page:              String(page),
    });
    if (langCode) params.set('with_original_language', langCode);
    if (genreId)  params.set('with_genres', String(genreId));

    try {
      const res = await fetch(`https://api.themoviedb.org/3/discover/${type}?${params}`);
      if (!res.ok) break;
      const data = await res.json();
      allResults.push(...(data.results || []));
    } catch {
      break;
    }
  }

  if (allResults.length === 0) return null;

  // Filter out excluded titles, deduplicate
  const seen   = new Set();
  const filtered = [];
  for (const item of allResults) {
    const title = item.title || item.name || '';
    if (!title || seen.has(title.toLowerCase()) || isExcluded(title, excluded_titles)) continue;
    seen.add(title.toLowerCase());
    filtered.push(item);
    if (filtered.length >= minResults) break;
  }

  return filtered.length >= minResults ? filtered : null;
}

function tmdbToRec(item, genre, language, mediaType) {
  const title  = item.title || item.name || 'Unknown';
  const year   = (item.release_date || item.first_air_date || '').slice(0, 4) || '?';
  const rating = Math.round((item.vote_average || 0) * 10) / 10;
  const poster = item.poster_path
    ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
    : null;

  return {
    title,
    year,
    language,
    genre,
    overview:             item.overview || '',
    why_recommended:      '',        // filled in by LLM batch call
    rating_out_of_10:     rating,
    poster_search_query:  `${title} ${year} ${mediaType === 'tv' ? 'TV series' : 'movie'} poster`,
    similar_to:           null,
    poster_url:           poster,    // pre-fetched — gemini-loop skips the extra call
    media_type:           mediaType,
  };
}

// ── LLM helpers ──────────────────────────────────────────────────────────────
function nvidiaClient() {
  return new OpenAI({
    apiKey:  process.env.NVIDIA_API_KEY,
    baseURL: NVIDIA_BASE_URL,
  });
}

async function callModel(modelId, prompt, temperature = 0.4, maxTokens = 1800) {
  const client = nvidiaClient();
  const completion = await client.chat.completions.create({
    model:       modelId,
    messages:    [{ role: 'user', content: prompt }],
    temperature,
    max_tokens:  maxTokens,
  });
  return completion.choices[0]?.message?.content || '';
}

function parseJsonFromText(text) {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const start = cleaned.indexOf('[');
  const end   = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('No JSON array found in response');

  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Response is not a JSON array');
  return parsed;
}

// ── Batch why_recommended via LLM ────────────────────────────────────────────
async function addWhyRecommended(recs, modelId, tasteContext = '') {
  const movieList = recs
    .map((r, i) => `${i + 1}. "${r.title}" (${r.year}): ${(r.overview || '').slice(0, 120)}`)
    .join('\n');

  const prompt = `For each movie/show below, write exactly one short sentence (≤15 words) explaining why a fan of this genre and language would enjoy it.
${tasteContext ? `Viewer taste: ${tasteContext}` : ''}
${movieList}
Return a JSON array of exactly ${recs.length} strings. Example: ["Because it...", "Fans of X will love..."]
JSON array only. No markdown.`;

  try {
    const text  = await callModel(modelId, prompt, 0.4, 600);
    const why   = parseJsonFromText(text);
    return recs.map((r, i) => ({ ...r, why_recommended: why[i] || 'A highly-rated pick in this genre.' }));
  } catch {
    // Non-fatal — return recs with a generic fallback
    return recs.map(r => ({ ...r, why_recommended: 'A highly-rated pick in this genre and language.' }));
  }
}

// ── Full LLM fallback (when TMDB unavailable / insufficient results) ──────────
async function fetchFromLLM({ genre, language, media_type, model, excluded_titles, taste_ready }) {
  const mediaLabel  = media_type === 'tv' ? 'TV series' : 'movie';
  const fieldSchema = `{"title":"","year":"YYYY","language":"","genre":"","overview":"2 sentences","why_recommended":"1 sentence","rating_out_of_10":0.0,"poster_search_query":"Title Year poster","similar_to":null}`;

  let prompt;
  let personalised = false;

  if (taste_ready && excluded_titles.length >= 5) {
    const tasteProfile = JSON.parse(await readFile(join(DATA_DIR, 'taste_profile.json'), 'utf-8'));
    personalised = tasteProfile.is_active;

    prompt = `Return a JSON array of exactly 10 ${mediaLabel} recommendations.
Genre: ${genre} | Language: ${language}
IMPORTANT: Every title MUST be originally in ${language}. Do NOT include dubbed or subtitled content.
Exclude: ${excluded_titles.slice(0, 30).join(', ')}
Taste profile: ${tasteProfile.summary || 'none'}
User notes: ${tasteProfile.user_annotations || 'none'}
Each object: ${fieldSchema}
why_recommended must reference the taste profile. similar_to = closest saved title or null.
JSON array only. No markdown. No extra text.`;
  } else {
    prompt = `Return a JSON array of exactly 10 ${mediaLabel} recommendations.
Genre: ${genre} | Language: ${language}
IMPORTANT: Every title MUST be originally in ${language}. Do NOT include dubbed or subtitled content.
${excluded_titles.length > 0 ? `Exclude: ${excluded_titles.slice(0, 30).join(', ')}` : ''}
Each object: ${fieldSchema}
JSON array only. No markdown. No extra text.`;
  }

  const text = await callModel(model, prompt);
  const recommendations = parseJsonFromText(text);
  return { recommendations, personalised };
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function fetch_recommendations({
  genre, language, media_type, model,
  excluded_titles = [], taste_ready = false,
}) {
  // ── 1. Try TMDB-backed path (guarantees correct language + genre) ───────────
  const tmdbItems = await discoverFromTMDB({ genre, language, media_type, excluded_titles });

  if (tmdbItems) {
    const recs = tmdbItems.map(item => tmdbToRec(item, genre, language, media_type));

    // Load taste profile for personalised why_recommended context
    let personalised  = false;
    let tasteContext  = '';
    if (taste_ready && excluded_titles.length >= 5) {
      try {
        const tp = JSON.parse(await readFile(join(DATA_DIR, 'taste_profile.json'), 'utf-8'));
        personalised = tp.is_active;
        tasteContext = tp.summary || '';
      } catch { /* ignore */ }
    }

    const recommendations = await addWhyRecommended(recs, model, tasteContext);
    return { recommendations, personalised, excluded_count: excluded_titles.length };
  }

  // ── 2. Fall back to pure LLM (no TMDB key, or no results for combo) ────────
  const { recommendations, personalised } = await fetchFromLLM({
    genre, language, media_type, model, excluded_titles, taste_ready,
  });

  return { recommendations, personalised, excluded_count: excluded_titles.length };
}

export async function retry_recommendations({
  genre, language, media_type, model,
  excluded_titles = [], taste_ready, attempt,
}) {
  const retryModelId = attempt >= 2 ? FALLBACK_MODEL : model;
  const mediaLabel   = media_type === 'tv' ? 'TV series' : 'movie';

  const prompt = `OUTPUT A VALID JSON ARRAY ONLY. NO OTHER TEXT.
Return exactly 10 ${mediaLabel} recommendations originally in ${language}.
Genre: ${genre} | Language: ${language}
${excluded_titles.length ? `Exclude: ${excluded_titles.slice(0, 20).join(', ')}` : ''}
Each object: {"title":"","year":"","language":"","genre":"","overview":"","why_recommended":"","rating_out_of_10":0.0,"poster_search_query":"","similar_to":null}
JSON ARRAY ONLY. START WITH [ END WITH ]`;

  const text = await callModel(retryModelId, prompt, 0.2);
  const recommendations = parseJsonFromText(text);
  return { recommendations, personalised: false, excluded_count: excluded_titles.length };
}
