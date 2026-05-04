import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { DATA_DIR } from '../../config.js';
import { derive_taste_profile } from './taste-profile.js';

const WATCHLIST_PATH = () => join(DATA_DIR, 'watchlist.json');
const TASTE_PATH = () => join(DATA_DIR, 'taste_profile.json');

async function readWatchlist() {
  try {
    return JSON.parse(await readFile(WATCHLIST_PATH(), 'utf-8'));
  } catch {
    return [];
  }
}

async function readTaste() {
  try {
    return JSON.parse(await readFile(TASTE_PATH(), 'utf-8'));
  } catch {
    return { summary: '', user_annotations: '', derived_from_count: 0, is_active: false, last_updated: null };
  }
}

export async function manage_watchlist({ action, item }) {
  let watchlist = await readWatchlist();

  switch (action) {
    case 'add': {
      if (!item) return { error: 'item required for add' };
      const alreadyExists = watchlist.some(i => i.title === item.title);
      if (!alreadyExists) {
        watchlist.push({ ...item, saved_at: new Date().toISOString() });
        await writeFile(WATCHLIST_PATH(), JSON.stringify(watchlist, null, 2));
      }
      if (watchlist.length >= 5) {
        derive_taste_profile({ watchlist }).catch(() => {});
      }
      return { success: true, count: watchlist.length };
    }

    case 'remove': {
      if (!item?.title) return { error: 'item.title required for remove' };
      watchlist = watchlist.filter(i => i.title !== item.title);
      await writeFile(WATCHLIST_PATH(), JSON.stringify(watchlist, null, 2));
      if (watchlist.length >= 5) {
        derive_taste_profile({ watchlist }).catch(() => {});
      } else {
        const taste = await readTaste();
        taste.is_active = false;
        await writeFile(TASTE_PATH(), JSON.stringify(taste, null, 2));
      }
      return { success: true, count: watchlist.length };
    }

    case 'list': {
      const taste = await readTaste();
      const taste_ready = taste.is_active && watchlist.length >= 5;
      return { items: watchlist, taste_ready, save_count: watchlist.length };
    }

    case 'clear': {
      await writeFile(WATCHLIST_PATH(), JSON.stringify([], null, 2));
      const emptyTaste = { summary: '', user_annotations: '', derived_from_count: 0, is_active: false, last_updated: null };
      await writeFile(TASTE_PATH(), JSON.stringify(emptyTaste, null, 2));
      return { success: true };
    }

    default:
      return { error: `Unknown action: ${action}` };
  }
}

export async function export_watchlist({ format = 'txt', scope = 'saved', session_data = null }) {
  const watchlist = await readWatchlist();
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];
  const longDate = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  let items;
  if (scope === 'saved' && session_data) {
    items = session_data.filter(i => i.saved);
  } else if (scope === 'full' && session_data) {
    items = session_data;
  } else {
    items = watchlist;
  }

  const scopeLabel = scope === 'saved' ? 'Saved' : 'Full';
  let content, filename;

  if (format === 'json') {
    const payload = {
      exported_at: date.toISOString(),
      scope: scopeLabel,
      total: items.length,
      items: items.map(i => ({
        title: i.title || '',
        year: i.year || null,
        language: i.language || '',
        genre: i.genre || '',
        media_type: i.media_type || 'movie',
        rating_out_of_10: i.rating_out_of_10 || null,
        why_recommended: i.why_recommended || '',
        poster_url: i.poster_url || '',
        status: i.saved !== undefined ? (i.saved ? 'saved' : 'skipped') : 'unknown',
        saved_at: i.saved_at || null,
      })),
    };
    content  = JSON.stringify(payload, null, 2);
    filename = `cineswipe-${scopeLabel.toLowerCase()}-${dateStr}.json`;

  } else if (format === 'markdown') {
    const lines = [
      `# 🎬 CineSwipe — ${scopeLabel} List`,
      `**Exported:** ${longDate}  |  **Total:** ${items.length}`,
      '',
      '---',
      '',
    ];
    items.forEach((item, idx) => {
      const status = item.saved !== undefined ? (item.saved ? '✅ Saved' : '❌ Skipped') : '';
      lines.push(`## ${idx + 1}. ${item.title} (${item.year || '?'}) ${status}`);
      if (item.poster_url) {
        lines.push(`![${item.title}](${item.poster_url})`);
        lines.push('');
      }
      lines.push(`**Rating:** ★ ${item.rating_out_of_10 || '?'}/10`);
      lines.push(`**Language:** ${item.language || '—'}  |  **Genre:** ${item.genre || '—'}  |  **Type:** ${item.media_type === 'tv' ? 'TV Series' : 'Movie'}`);
      if (item.why_recommended) lines.push(`> _${item.why_recommended}_`);
      lines.push('');
      lines.push('---');
      lines.push('');
    });
    content  = lines.join('\n');
    filename = `cineswipe-${scopeLabel.toLowerCase()}-${dateStr}.md`;

  } else {
    // Plain text (default)
    const sep = '═'.repeat(44);
    const lines = [`CineSwipe Watchlist — ${longDate} (${scopeLabel})`, `Total: ${items.length}`, sep, ''];
    items.forEach((item, i) => {
      const savedTag = item.saved !== undefined ? (item.saved ? '  ✓ Saved' : '  ✗ Skipped') : '';
      lines.push(`${i + 1}. ${item.title} (${item.year || '?'}) ★ ${item.rating_out_of_10 || '?'}${savedTag}`);
      lines.push(`   ${item.language || '—'} · ${item.genre || '—'} · ${item.media_type === 'tv' ? 'TV Series' : 'Movie'}`);
      if (item.why_recommended) lines.push(`   "${item.why_recommended}"`);
      lines.push('');
    });
    content  = lines.join('\n');
    filename = `cineswipe-${scopeLabel.toLowerCase()}-${dateStr}.txt`;
  }

  return { content, filename };
}
