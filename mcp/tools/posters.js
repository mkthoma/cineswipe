import { Buffer } from 'buffer';

export async function fetch_poster_image({ query, title, genre, media_type }) {
  const { GOOGLE_CSE_KEY, GOOGLE_CX, TMDB_API_KEY } = process.env;

  // ── 1. TMDB (The Movie Database) — most reliable for movie/TV posters ──────
  if (TMDB_API_KEY && TMDB_API_KEY !== 'your_tmdb_api_key_here') {
    try {
      const searchTitle = encodeURIComponent(title);
      // Use the known media_type first to skip an unnecessary round-trip
      const tmdbTypes = media_type === 'tv' ? ['tv', 'movie'] : ['movie', 'tv'];
      for (const mediaType of tmdbTypes) {
        const url = `https://api.themoviedb.org/3/search/${mediaType}?api_key=${TMDB_API_KEY}&query=${searchTitle}&language=en-US&page=1&include_adult=false`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const result = data.results?.[0];
        if (result?.poster_path) {
          return {
            image_url: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
            source: 'tmdb',
          };
        }
      }
    } catch {
      // Fall through to Google CSE
    }
  }

  // ── 2. Google Custom Search ─────────────────────────────────────────────────
  // Note: for this to return real poster images the CSE should either search
  // the entire web OR include image-hosting sites like m.media-amazon.com / tmdb.org
  if (GOOGLE_CSE_KEY && GOOGLE_CX && GOOGLE_CSE_KEY !== 'your_google_cse_key_here') {
    try {
      const url = new URL('https://www.googleapis.com/customsearch/v1');
      url.searchParams.set('key', GOOGLE_CSE_KEY);
      url.searchParams.set('cx', GOOGLE_CX);
      url.searchParams.set('q', query || `${title} movie poster`);
      url.searchParams.set('searchType', 'image');
      url.searchParams.set('num', '1');
      url.searchParams.set('imgSize', 'large');
      url.searchParams.set('imgType', 'photo');
      url.searchParams.set('safe', 'active');

      const response = await fetch(url.toString());
      if (response.ok) {
        const data = await response.json();
        if (data.items?.length > 0) {
          return { image_url: data.items[0].link, source: 'google' };
        }
      }
    } catch {
      // Fall through to placeholder
    }
  }

  return { image_url: generatePlaceholder(title, genre), source: 'placeholder' };
}

const GENRE_COLORS = {
  thriller:  { bg: '#0e0a06', accent: '#c9a84c', text: '#8a7a5a' },
  horror:    { bg: '#080610', accent: '#9b59b6', text: '#6c3483' },
  drama:     { bg: '#060e08', accent: '#27ae60', text: '#1e8449' },
  comedy:    { bg: '#0e0e06', accent: '#f1c40f', text: '#b7950b' },
  action:    { bg: '#0e0704', accent: '#e74c3c', text: '#922b21' },
  romance:   { bg: '#0e060a', accent: '#e91e8c', text: '#a01461' },
  'sci-fi':  { bg: '#060a0e', accent: '#3498db', text: '#1a5276' },
  scifi:     { bg: '#060a0e', accent: '#3498db', text: '#1a5276' },
  animation: { bg: '#080e0a', accent: '#2ecc71', text: '#1e8449' },
  crime:     { bg: '#0a0a0a', accent: '#95a5a6', text: '#616a6b' },
  default:   { bg: '#0a0a0a', accent: '#c9a84c', text: '#8a7a5a' },
};

function generatePlaceholder(title = '', genre = '') {
  const key = genre.toLowerCase().replace(/\s+/g, '');
  const c = GENRE_COLORS[key] || GENRE_COLORS.default;
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');

  const lines = title.split(/\s+/).reduce((acc, word) => {
    const last = acc[acc.length - 1];
    if (last && (last + ' ' + word).length <= 14) {
      acc[acc.length - 1] = last + ' ' + word;
    } else {
      acc.push(word);
    }
    return acc;
  }, []);

  const titleSvgLines = lines.slice(0, 3).map((line, i) =>
    `<text x="150" y="${310 + i * 22}" font-family="serif" font-size="14" fill="${c.text}" text-anchor="middle">${line}</text>`
  ).join('');

  const genreLabel = genre ? genre.charAt(0).toUpperCase() + genre.slice(1) : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c.bg}"/>
      <stop offset="100%" stop-color="#080808"/>
    </linearGradient>
  </defs>
  <rect width="300" height="450" fill="url(#bg)"/>
  <rect x="2" y="2" width="296" height="446" fill="none" stroke="${c.accent}" stroke-width="1" opacity="0.2" rx="4"/>
  <line x1="0" y1="280" x2="300" y2="280" stroke="${c.accent}" stroke-width="0.5" opacity="0.15"/>
  <text x="150" y="175" font-family="serif" font-size="80" fill="${c.accent}" text-anchor="middle" opacity="0.25">${initials}</text>
  <text x="150" y="220" font-family="sans-serif" font-size="11" fill="${c.accent}" text-anchor="middle" letter-spacing="4" opacity="0.5">${genreLabel.toUpperCase()}</text>
  ${titleSvgLines}
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
