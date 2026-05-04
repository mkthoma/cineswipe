/**
 * summary.js — Final session summary view.
 *
 * Shows an in-page stats panel built from real sessionData (passed via SSE),
 * a prominent "View Full Results" button that opens the Prefab HTML in a new
 * tab, animated export buttons, and action links.
 */
import anime from '/lib/anime.js';
import { switchView } from '/app.js';

/* ─── PDF helpers (jsPDF Latin-1 only — strip all non-Latin1 before passing) ── */
function sanitizePdf(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[★☆]/g, '*')
    .replace(/[—–]/g, '-')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/…/g, '...')
    .replace(/·/g, '-')
    .replace(/[^\x00-\xFF]/g, '');
}

async function loadJsPDF() {
  if (window.jspdf) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function fetchImgAsDataURL(url) {
  try {
    // Route through server proxy — TMDB blocks direct browser cross-origin fetches
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(blob); });
  } catch { return null; }
}

/** Generate a movie-list PDF from an array of recommendation objects. */
async function generateMoviePDF(items, headingText, subtitleText, filenamePrefix, showToast) {
  if (!items.length) { showToast('Nothing to export.', 'info'); return; }
  showToast('Building PDF...', 'info', 6000);
  await loadJsPDF();

  const { jsPDF } = window.jspdf;
  const doc    = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW  = 210;
  const margin = 14;
  const colW   = pageW - margin * 2;
  let y = 20;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.text(sanitizePdf(headingText), margin, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text(sanitizePdf(subtitleText), margin, y);
  y += 10;

  doc.setDrawColor(220, 220, 220);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  const POSTER_W = 28;
  const POSTER_H = 40;
  const TEXT_X   = margin + POSTER_W + 6;

  for (const item of items) {
    if (y + POSTER_H + 4 > 280) { doc.addPage(); y = 20; }

    if (item.poster_url && item.poster_url.startsWith('http')) {
      try {
        const img = await fetchImgAsDataURL(item.poster_url);
        if (img) doc.addImage(img, 'JPEG', margin, y, POSTER_W, POSTER_H, undefined, 'FAST');
      } catch { /* skip */ }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(30, 30, 30);
    doc.text(sanitizePdf(item.title || ''), TEXT_X, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    const meta = [
      item.year   ? String(item.year) : null,
      item.genre  || null,
      item.language && item.language !== 'English' ? item.language : null,
      item.media_type === 'tv' ? 'TV Series' : 'Movie',
    ].filter(Boolean).join('  -  ');
    doc.text(sanitizePdf(meta), TEXT_X, y + 12);

    if (item.rating_out_of_10) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(160, 130, 50);
      doc.text(`${item.rating_out_of_10} / 10`, TEXT_X, y + 19);
    }

    if (item.why_recommended) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      const lines = doc.splitTextToSize(`"${sanitizePdf(item.why_recommended)}"`, colW - POSTER_W - 6);
      doc.text(lines.slice(0, 3), TEXT_X, y + 26);
    }

    y += POSTER_H + 8;
    doc.setDrawColor(235, 235, 235);
    doc.line(margin, y - 4, pageW - margin, y - 4);
  }

  const filename = `${filenamePrefix}-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
  showToast(`Saved ${filename}`, 'success', 3500);
}

/* ─── Arrow SVG ─────────────────────────────────────────────────────────────── */
function arrowSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3v13M7 12l5 5 5-5" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

/* ─── Format seconds as "Xm Ys" ─────────────────────────────────────────────── */
function fmtTime(secs) {
  if (!secs || secs < 1) return '—';
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/* ─── Stats panel ────────────────────────────────────────────────────────────── */
function buildStatsPanel(sessionData, prefabUrl) {
  // Derive all stats from the real sessionData passed via SSE prefab_ready event
  const allRecs   = Array.isArray(sessionData?.all_recommendations) ? sessionData.all_recommendations : [];
  const saved     = allRecs.filter(r => r.saved);
  const skipped   = allRecs.filter(r => !r.saved);
  const total     = allRecs.length;
  const ratings   = allRecs.map(r => parseFloat(r.rating_out_of_10)).filter(n => !isNaN(n));
  const avgRating = ratings.length
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : null;
  const saveRate  = total ? Math.round(saved.length / total * 100) : 0;
  const title     = sessionData?.ui_title    || 'Your Session';
  const date      = sessionData?.session_date || '';
  const model     = sessionData?.model_used  || '';
  const timeTaken = fmtTime(sessionData?.time_taken_seconds);
  const isPersonalised = Boolean(sessionData?.personalised);

  // Format date
  let dateLabel = '';
  if (date) {
    try { dateLabel = new Date(date).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }); }
    catch { dateLabel = String(date); }
  }
  const subtitleParts = [dateLabel, model].filter(Boolean);

  const panel = document.createElement('div');
  panel.className = 'sm-panel';

  panel.innerHTML = `
    <div class="sm-header">
      <div class="sm-title-group">
        <div class="sm-title">🎬 ${title}</div>
        ${subtitleParts.length ? `<div class="sm-subtitle">${subtitleParts.join('  ·  ')}</div>` : ''}
      </div>
      <div class="sm-badges">
        <span class="sm-badge sm-badge-primary">${saved.length} saved</span>
        <span class="sm-badge sm-badge-secondary">${skipped.length} skipped</span>
        ${isPersonalised ? '<span class="sm-badge sm-badge-accent">✨ Personalised</span>' : ''}
      </div>
    </div>

    <div class="sm-stats-grid">
      <div class="sm-stat">
        <div class="sm-stat-value">${saved.length}</div>
        <div class="sm-stat-label">Saved</div>
        <div class="sm-stat-sub">of ${total} shown</div>
      </div>
      <div class="sm-stat">
        <div class="sm-stat-value">${skipped.length}</div>
        <div class="sm-stat-label">Skipped</div>
      </div>
      <div class="sm-stat">
        <div class="sm-stat-value">${avgRating ? `★ ${avgRating}` : '—'}</div>
        <div class="sm-stat-label">Avg rating</div>
      </div>
      <div class="sm-stat">
        <div class="sm-stat-value">${timeTaken}</div>
        <div class="sm-stat-label">Time taken</div>
      </div>
    </div>

    <div class="sm-progress-wrap">
      <div class="sm-progress-labels">
        <span>Save rate</span><span>${saveRate}%</span>
      </div>
      <div class="sm-progress-track">
        <div class="sm-progress-bar" style="width:${saveRate}%"></div>
      </div>
    </div>

    ${saved.length ? `
    <div class="sm-saves-label">Saved this session (${saved.length})</div>
    <div class="sm-saves-list">
      ${saved.map(r => `
        <div class="sm-save-chip">
          ${r.poster_url ? `<img class="sm-save-poster" src="${r.poster_url}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
          <div class="sm-save-info">
            <span class="sm-save-title">${r.title}</span>
            <span class="sm-save-meta">${r.year ? r.year + ' · ' : ''}${r.genre || ''}${r.rating_out_of_10 ? ' · ★' + r.rating_out_of_10 : ''}</span>
          </div>
        </div>
      `).join('')}
    </div>` : ''}

    <div class="sm-view-results-wrap">
      <button class="btn-view-results" id="sm-btn-view-results">
        <span class="btn-vr-icon-wrap">
          <svg viewBox="0 0 20 20" fill="currentColor" class="btn-vr-icon">
            <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"/>
            <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"/>
          </svg>
        </span>
        📊 View Full Results
        <span class="btn-vr-hint">Opens in new tab</span>
      </button>
    </div>
  `;

  // Wire up the View Results button
  const vrBtn = panel.querySelector('#sm-btn-view-results');
  if (vrBtn && prefabUrl) {
    vrBtn.addEventListener('click', () => {
      window.open(prefabUrl, '_blank', 'noopener,noreferrer');
    });
  } else if (vrBtn) {
    vrBtn.disabled = true;
    vrBtn.title = 'Results not yet generated';
  }

  return panel;
}

/* ─── Parachute download animation ──────────────────────────────────────────── */
async function doExport(btn, format, scope, all_recommendations, api, showToast) {
  if (btn.classList.contains('dl-active')) return;
  btn.classList.add('dl-active');

  const chute = btn.querySelector('.btn-dl-chute');
  const arrow = btn.querySelector('.btn-dl-arrow');
  const label = btn.querySelector('.btn-dl-label');

  anime({ targets: chute, translateY: [4, -28], opacity: [0, 1], scale: [0.6, 1], duration: 550, easing: 'easeOutBack' });
  anime({ targets: arrow, translateY: [0, 6],   opacity: [1, 0], duration: 380,   easing: 'easeInCubic' });
  anime({ targets: label, opacity: [1, 0.4],    duration: 300,   easing: 'easeInCubic' });

  try {
    const filename = await api.exportFile(format, scope, all_recommendations);

    anime({
      targets: chute, translateY: [-28, 0], scale: [1, 1.25, 1], duration: 450, easing: 'easeOutBounce',
      complete() {
        anime({ targets: chute, opacity: [1, 0], duration: 280, easing: 'easeInCubic',
          complete() { chute.style.cssText = ''; }
        });
      },
    });
    anime({ targets: arrow, translateY: [6, 0], opacity: [0, 1], duration: 320, delay: 200, easing: 'easeOutCubic' });
    anime({ targets: label, opacity: [0.4, 1],  duration: 280, delay: 200, easing: 'easeOutCubic' });
    anime({
      targets: btn, backgroundColor: ['', 'rgba(80,200,120,0.22)', ''],
      duration: 900, easing: 'easeOutCubic',
      complete() { btn.classList.remove('dl-active'); },
    });
    showToast(`✅ Downloading ${filename}`, 'success', 3000);
  } catch {
    anime({ targets: chute, translateY: [-28, 0], opacity: [1, 0], duration: 400, easing: 'easeInCubic' });
    anime({ targets: arrow, opacity: [0, 1], duration: 250, delay: 150, easing: 'easeOutCubic' });
    anime({ targets: label, opacity: [0.4, 1], duration: 250, delay: 150, easing: 'easeOutCubic' });
    setTimeout(() => btn.classList.remove('dl-active'), 500);
    showToast('Export failed. Please try again.', 'error');
  }
}

/* ─── Export section ────────────────────────────────────────────────────────── */
function buildExportSection(all_recommendations, api, showToast) {
  const sec = document.createElement('div');
  sec.className = 'export-section';

  const formats = [
    { id: 'pdf',      label: 'PDF'      },
    { id: 'markdown', label: 'Markdown' },
    { id: 'json',     label: 'JSON'     },
  ];

  sec.innerHTML = `
    <div class="section-label">Export</div>
    <div class="export-grid">
      ${formats.map(f => `
        <div class="export-group">
          <span class="export-group-label">${f.label}</span>
          <button class="btn-dl" data-fmt="${f.id}" data-scope="saved">
            <span class="btn-dl-chute">🪂</span>
            <span class="btn-dl-label">Saved list</span>
            <span class="btn-dl-arrow">${arrowSvg()}</span>
          </button>
          <button class="btn-dl btn-dl-full" data-fmt="${f.id}" data-scope="full">
            <span class="btn-dl-chute">🪂</span>
            <span class="btn-dl-label">Full list</span>
            <span class="btn-dl-arrow">${arrowSvg()}</span>
          </button>
        </div>
      `).join('')}
    </div>
  `;

  sec.querySelectorAll('.btn-dl').forEach(btn => {
    btn.addEventListener('click', function () {
      const fmt   = this.dataset.fmt;
      const scope = this.dataset.scope;
      const recs  = scope === 'saved'
        ? all_recommendations.filter(r => r.saved)
        : all_recommendations;

      if (fmt === 'pdf') {
        const heading  = scope === 'saved' ? 'CineSwipe - Saved Movies' : 'CineSwipe - All Recommendations';
        const dateStr  = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const subtitle = `Exported ${dateStr}  -  ${recs.length} title${recs.length !== 1 ? 's' : ''}`;
        const prefix   = scope === 'saved' ? 'cineswipe-saved' : 'cineswipe-full';
        generateMoviePDF(recs, heading, subtitle, prefix, showToast);
      } else {
        doExport(this, fmt, scope, recs, api, showToast);
      }
    });
  });

  requestAnimationFrame(() => {
    anime({
      targets: sec.querySelectorAll('.btn-dl'),
      opacity: [0, 1], translateY: [8, 0],
      duration: 500, delay: anime.stagger(55, { start: 600 }),
      easing: 'easeOutCubic',
    });
  });

  return sec;
}

/* ═══════════════════════════════════════════════════════════════════════════════
 *  renderSummary — main entry point
 * ═════════════════════════════════════════════════════════════════════════════ */
export function renderSummary(container, headerRight, { prefabUrl, sessionData, api, showToast }) {
  // Guard: sessionData comes directly from the SSE prefab_ready event payload
  // It must contain `all_recommendations`, `ui_title`, `time_taken_seconds`, etc.
  const allRecs = Array.isArray(sessionData?.all_recommendations)
    ? sessionData.all_recommendations
    : [];

  // ── Back button ─────────────────────────────────────────────────────────────
  const backBtn = document.createElement('button');
  backBtn.className   = 'btn';
  backBtn.textContent = '← New Search';
  headerRight.prepend(backBtn);
  backBtn.addEventListener('click', () => switchView('onboarding'));

  // ── "View Results" shortcut in header ───────────────────────────────────────
  if (prefabUrl) {
    const vrHeaderBtn = document.createElement('a');
    vrHeaderBtn.className  = 'btn btn-primary';
    vrHeaderBtn.href       = prefabUrl;
    vrHeaderBtn.target     = '_blank';
    vrHeaderBtn.rel        = 'noopener noreferrer';
    vrHeaderBtn.textContent = '📊 View Results';
    vrHeaderBtn.title       = 'Open full Prefab results in a new tab';
    headerRight.appendChild(vrHeaderBtn);
  }

  // ── Layout skeleton ─────────────────────────────────────────────────────────
  container.innerHTML = '';
  container.className = 'summary-view-root';

  // ── Stats panel with View Results button ─────────────────────────────────────
  const statsPanel = buildStatsPanel(sessionData, prefabUrl);
  container.appendChild(statsPanel);

  // ── Export buttons ──────────────────────────────────────────────────────────
  const exportSec = buildExportSection(allRecs, api, showToast);
  container.appendChild(exportSec);

  // ── Action row ──────────────────────────────────────────────────────────────
  const actionRow = document.createElement('div');
  actionRow.className = 'prefab-actions';
  actionRow.innerHTML = `
    <button class="btn btn-primary" id="sm-btn-new">🔄 New Recommendations</button>
    <button class="btn btn-danger"  id="sm-btn-clear">🗑 Clear Watchlist</button>
  `;
  container.appendChild(actionRow);

  actionRow.querySelector('#sm-btn-new').addEventListener('click', () => switchView('onboarding'));
  actionRow.querySelector('#sm-btn-clear').addEventListener('click', async () => {
    if (!confirm('Clear your entire watchlist? This cannot be undone.')) return;
    await api.clearWatchlist();
    showToast('Watchlist cleared.', 'info', 2000);
  });

  // ── Entrance animations ─────────────────────────────────────────────────────
  anime({ targets: statsPanel,  opacity: [0, 1], translateY: [20, 0], duration: 520, easing: 'easeOutCubic' });
  anime({ targets: exportSec,   opacity: [0, 1], translateY: [12, 0], duration: 450, delay: 320, easing: 'easeOutCubic' });
  anime({ targets: actionRow,   opacity: [0, 1], translateY: [8,  0], duration: 380, delay: 480, easing: 'easeOutCubic' });

  // Animate the progress bar after the panel fades in
  requestAnimationFrame(() => {
    setTimeout(() => {
      const bar = statsPanel.querySelector('.sm-progress-bar');
      if (bar) {
        const target = bar.style.width;
        bar.style.width = '0%';
        anime({ targets: bar, width: target, duration: 800, delay: 400, easing: 'easeOutCubic' });
      }
    }, 100);
  });

  // Pulse animation on the View Results button to draw attention
  requestAnimationFrame(() => {
    const vrBtn = statsPanel.querySelector('#sm-btn-view-results');
    if (vrBtn) {
      setTimeout(() => {
        anime({
          targets: vrBtn,
          scale: [1, 1.04, 1],
          boxShadow: [
            '0 4px 20px rgba(201,168,76,0.2)',
            '0 8px 40px rgba(201,168,76,0.55)',
            '0 4px 20px rgba(201,168,76,0.2)',
          ],
          duration: 900,
          delay: 800,
          easing: 'easeInOutSine',
        });
      }, 800);
    }
  });
}
