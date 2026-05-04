import OpenAI from 'openai';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { DATA_DIR, FALLBACK_MODEL, NVIDIA_BASE_URL } from '../../config.js';

const TASTE_PATH = () => join(DATA_DIR, 'taste_profile.json');
const WATCHLIST_PATH = () => join(DATA_DIR, 'watchlist.json');

export async function derive_taste_profile({ watchlist }) {
  const client = new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: NVIDIA_BASE_URL });

  const titlesWithGenres = watchlist
    .map(i => `- ${i.title} (${i.year}) — ${i.genre}${i.language !== 'English' ? ` · ${i.language}` : ''}`)
    .join('\n');

  const prompt = `These are the movies/shows this viewer has saved:
${titlesWithGenres}

In exactly 3 sentences, describe what they seem to enjoy in terms of:
themes, narrative tone, pacing, and storytelling style.
Be specific — avoid generic words like "compelling" or "engaging".
Plain text only. No lists, no bullet points.`;

  const completion = await client.chat.completions.create({
    model: FALLBACK_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: 512,
  });
  const summary = (completion.choices[0]?.message?.content || '').trim();

  let existing = { summary: '', user_annotations: '', derived_from_count: 0, is_active: false, last_updated: null };
  try {
    existing = JSON.parse(await readFile(TASTE_PATH(), 'utf-8'));
  } catch {}

  const profile = {
    ...existing,
    summary,
    derived_from_count: watchlist.length,
    is_active: true,
    last_updated: new Date().toISOString(),
  };

  await writeFile(TASTE_PATH(), JSON.stringify(profile, null, 2));
  return profile;
}

export async function edit_taste_profile({ user_annotations }) {
  let profile = { summary: '', user_annotations: '', derived_from_count: 0, is_active: false, last_updated: null };
  try {
    profile = JSON.parse(await readFile(TASTE_PATH(), 'utf-8'));
  } catch {}

  profile.user_annotations = (user_annotations || '').slice(0, 300);
  await writeFile(TASTE_PATH(), JSON.stringify(profile, null, 2));
  return { success: true, profile };
}

// Reset always produces a blank slate — no auto-rederive.
// The profile can only be rebuilt by the user adding new items (watchlist.js)
// or by triggering a new recommendation session.
export async function reset_taste_profile() {
  const empty = {
    summary: '',
    user_annotations: '',
    derived_from_count: 0,
    is_active: false,
    last_updated: null,
  };
  await writeFile(TASTE_PATH(), JSON.stringify(empty, null, 2));
  return { success: true, profile: empty, rederived: false };
}
