import anime from '/lib/anime.js';
import { switchView } from '/app.js';

const animate = anime;

/* ─── PDF helpers ────────────────────────────────────────────────────────────
 * jsPDF's built-in Helvetica only covers Latin-1 (ISO-8859-1).
 * Any character outside that range (emoji, ★, curly quotes, …) renders as
 * garbled bytes.  Strip / replace everything before passing to jsPDF.
 * ─────────────────────────────────────────────────────────────────────────── */
function sanitizePdf(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')   // emoji plane 1
    .replace(/[\u{2600}-\u{27BF}]/gu, '')      // misc symbols, dingbats
    .replace(/[★☆]/g, '*')           // ★☆  → *
    .replace(/[—–]/g, '-')           // em / en dash
    .replace(/[“”]/g, '"')           // " "  → "
    .replace(/[‘’]/g, "'")           // ' '  → '
    .replace(/…/g, '...')                 // …    → ...
    .replace(/·/g, '-')                   // middle dot → -
    .replace(/[^\x00-\xFF]/g, '');             // anything else → drop
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

async function fetchImageAsDataURL(url) {
  try {
    // Route through the server proxy so CORS restrictions don't block the fetch
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise(r => {
      const rd = new FileReader();
      rd.onload = () => r(rd.result);
      rd.readAsDataURL(blob);
    });
  } catch { return null; }
}

/* ─── PDF export via jsPDF (loaded from CDN on demand) ─────────────────────── */
async function exportWatchlistPDF(watchlist, showToast) {
  if (watchlist.length === 0) { showToast('Nothing in watchlist to export.', 'info'); return; }

  showToast('Building PDF...', 'info', 6000);
  await loadJsPDF();

  const { jsPDF } = window.jspdf;
  const doc    = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW  = 210;
  const margin = 14;
  const colW   = pageW - margin * 2;
  let y = 20;

  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const count   = watchlist.length;

  // ── Header ──────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.text('CineSwipe Watchlist', margin, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text(`Exported ${dateStr}  -  ${count} title${count !== 1 ? 's' : ''}`, margin, y);
  y += 10;

  doc.setDrawColor(220, 220, 220);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  // ── Movie rows ───────────────────────────────────────────────────────────────
  const POSTER_W = 28;
  const POSTER_H = 40;
  const TEXT_X   = margin + POSTER_W + 6;

  for (const item of watchlist) {
    if (y + POSTER_H + 4 > 280) { doc.addPage(); y = 20; }

    if (item.poster_url && item.poster_url.startsWith('http')) {
      try {
        const imgData = await fetchImageAsDataURL(item.poster_url);
        if (imgData) doc.addImage(imgData, 'JPEG', margin, y, POSTER_W, POSTER_H, undefined, 'FAST');
      } catch { /* skip poster silently */ }
    }

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(30, 30, 30);
    doc.text(sanitizePdf(item.title), TEXT_X, y + 6);

    // Metadata
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    const meta = [
      item.year   ? String(item.year)   : null,
      item.genre  || null,
      item.language && item.language !== 'English' ? item.language : null,
      item.media_type === 'tv' ? 'TV Series' : 'Movie',
    ].filter(Boolean).join('  -  ');
    doc.text(sanitizePdf(meta), TEXT_X, y + 12);

    // Rating
    if (item.rating_out_of_10) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(160, 130, 50);
      doc.text(`${item.rating_out_of_10} / 10`, TEXT_X, y + 19);
    }

    // Why recommended
    if (item.why_recommended) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      const why   = sanitizePdf(item.why_recommended);
      const lines = doc.splitTextToSize(`"${why}"`, colW - POSTER_W - 6);
      doc.text(lines.slice(0, 3), TEXT_X, y + 26);
    }

    y += POSTER_H + 8;
    doc.setDrawColor(235, 235, 235);
    doc.line(margin, y - 4, pageW - margin, y - 4);
  }

  const filename = `cineswipe-watchlist-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
  showToast(`Saved ${filename}`, 'success', 3500);
}



const MODELS = [
  { id: 'mistralai/mistral-medium-3.5-128b', label: '🧠 Mistral Medium 3.5' },
  { id: 'mistralai/mistral-large-2411',       label: '🔬 Mistral Large 2411' },
  { id: 'meta/llama-3.3-70b-instruct',        label: '🦙 Llama 3.3 70B' },
];

const SWIPE_THRESHOLD = 100;

// PNG icons cycled per card (chosen by title char-code for stable, deterministic selection)
const CARD_ICONS = [
  '/assets/cinema_popcorn.png',
  '/assets/movie_studio.png',
  '/assets/movie_camera.png',
];

export function renderSwipe(container, headerRight, { data, api, showToast }) {
  const { recommendations = [], ui_title = '', personalised = false, save_count = 0 } = data;

  let cards = [...recommendations];
  let currentIndex = 0;
  let savedTitles = [];
  let watchlist = [...recommendations.filter(r => false)]; // starts empty for this session display

  // ── Load persisted watchlist for panel display ──────────────────────────────
  api.getWatchlist().then(wl => {
    watchlist = wl;
    renderWatchlistPanel();
  }).catch(() => {});

  api.getTaste().then(taste => {
    renderTastePanel(taste);
  }).catch(() => {});

  // ── HTML ────────────────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="swipe-layout">

      <!-- Left panel: new search + progress -->
      <aside class="swipe-left-panel">
        <div class="panel-title">NEW SEARCH</div>
        <form class="search-mini-form" id="mini-search-form">
          <div class="form-field">
            <label class="form-label">Genre</label>
            <input class="input" id="mini-genre" type="text" placeholder="genre…" autocomplete="off">
          </div>
          <div class="form-field">
            <label class="form-label">Language</label>
            <input class="input" id="mini-lang" type="text" placeholder="language…" autocomplete="off">
          </div>
          <div class="form-field">
            <label class="form-label">Type</label>
            <div class="radio-group">
              <label class="radio-label"><input type="radio" name="mini_type" value="movie" checked> Movie</label>
              <label class="radio-label"><input type="radio" name="mini_type" value="tv"> TV</label>
            </div>
          </div>
          <div class="form-field">
            <label class="form-label">Model</label>
            <select class="select" id="mini-model">
              ${MODELS.map((m, i) => `<option value="${m.id}"${i === 0 ? ' selected' : ''}>${m.label}</option>`).join('')}
            </select>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center">✨ Get Recs</button>
        </form>

        <hr class="divider">

        <div>
          <div class="panel-title">PROGRESS</div>
          <div class="swipe-progress">
            <div class="swipe-progress-label" id="progress-label">Card 1 of ${cards.length}</div>
            <div class="swipe-progress-bar">
              <div class="swipe-progress-fill" id="swipe-progress-fill"></div>
            </div>
          </div>
        </div>

        <hr class="divider">

        <div id="taste-left-section">
          <div class="panel-title">TASTE</div>
          <div style="font-size:0.75rem; color:var(--text-dimmer); font-style:italic" id="taste-left-status">
            ${personalised ? '✅ Active' : save_count >= 5 ? '✅ Active' : `${save_count}/5 saves`}
          </div>
        </div>
      </aside>

      <!-- Center: card stack -->
      <section class="swipe-center">
        <div class="card-stack" id="card-stack"></div>

        <div class="swipe-buttons">
          <!-- Dislike / Skip button -->
          <button class="btn-swipe btn-swipe-skip" id="btn-skip" title="Skip (←)" aria-label="Skip">
            <svg class="swipe-icon-x" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
              <circle class="x-ring" cx="22" cy="22" r="20" fill="none"/>
              <g class="x-cross">
                <line x1="14" y1="14" x2="30" y2="30" stroke-width="3" stroke-linecap="round"/>
                <line x1="30" y1="14" x2="14" y2="30" stroke-width="3" stroke-linecap="round"/>
              </g>
              <!-- burst dots (initially hidden) -->
              <circle class="x-dot" cx="22" cy="5" r="2.5" opacity="0"/>
              <circle class="x-dot" cx="22" cy="39" r="2.5" opacity="0"/>
              <circle class="x-dot" cx="5"  cy="22" r="2.5" opacity="0"/>
              <circle class="x-dot" cx="39" cy="22" r="2.5" opacity="0"/>
              <circle class="x-dot" cx="9"  cy="9"  r="2" opacity="0"/>
              <circle class="x-dot" cx="35" cy="35" r="2" opacity="0"/>
              <circle class="x-dot" cx="35" cy="9"  r="2" opacity="0"/>
              <circle class="x-dot" cx="9"  cy="35" r="2" opacity="0"/>
            </svg>
          </button>

          <div class="swipe-keyboard-hint">← skip · save →</div>

          <!-- Like / Save button -->
          <button class="btn-swipe btn-swipe-save" id="btn-save" title="Save (→)" aria-label="Save">
            <svg class="swipe-icon-heart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44">
              <!-- Outline heart (default state) -->
              <path class="heart-outline" d="M22 38 C18 34 6 26 6 16.5 C6 11.5 10 8 14.5 8 C17.5 8 20 9.8 22 12 C24 9.8 26.5 8 29.5 8 C34 8 38 11.5 38 16.5 C38 26 26 34 22 38 Z" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
              <!-- Fill heart (shown when active) -->
              <path class="heart-fill" d="M22 38 C18 34 6 26 6 16.5 C6 11.5 10 8 14.5 8 C17.5 8 20 9.8 22 12 C24 9.8 26.5 8 29.5 8 C34 8 38 11.5 38 16.5 C38 26 26 34 22 38 Z" opacity="0"/>
              <!-- Burst dots (hidden) -->
              <circle class="heart-dot" cx="22" cy="4"  r="2.5" opacity="0"/>
              <circle class="heart-dot" cx="22" cy="40" r="2.5" opacity="0"/>
              <circle class="heart-dot" cx="4"  cy="22" r="2.5" opacity="0"/>
              <circle class="heart-dot" cx="40" cy="22" r="2.5" opacity="0"/>
              <circle class="heart-dot" cx="8"  cy="8"  r="2"   opacity="0"/>
              <circle class="heart-dot" cx="36" cy="36" r="2"   opacity="0"/>
              <circle class="heart-dot" cx="36" cy="8"  r="2"   opacity="0"/>
              <circle class="heart-dot" cx="8"  cy="36" r="2"   opacity="0"/>
            </svg>
          </button>
        </div>
      </section>

      <!-- Right panel: watchlist (scrolls) + taste (pinned bottom) -->
      <aside class="swipe-right-panel">

        <!-- Watchlist section — items scroll inside this -->
        <div class="watchlist-section">
          <div class="watchlist-header">
            <div class="panel-title" style="margin-bottom:0">MY WATCHLIST</div>
            <span class="watchlist-count" id="watchlist-count">0</span>
          </div>
          <div class="watchlist-items" id="watchlist-items">
            <div class="empty-state">No saves yet.<br>Swipe right to save a title.</div>
          </div>
          <div class="watchlist-export-row">
            <button class="btn" id="btn-export-txt" title="Export as text">📄 .txt</button>
            <button class="btn" id="btn-export-pdf" title="Export as PDF with images">📑 PDF</button>
            <button class="btn btn-danger" id="btn-clear-watchlist" title="Clear all">🗑</button>
          </div>
        </div>

        <!-- Taste profile — always visible at bottom -->
        <div class="taste-section">
          <div class="panel" id="panel-taste">
            <div class="taste-header">
              <div class="taste-status-dot" id="taste-dot"></div>
              <span class="taste-label">TASTE PROFILE</span>
              <span class="taste-count" id="taste-count"></span>
            </div>
            <p class="taste-summary" id="taste-summary" style="margin-top:8px"></p>
            <div class="taste-edit-panel" id="taste-edit-panel" style="height:0;opacity:0;overflow:hidden">
              <textarea id="taste-annotations" placeholder="Add your own notes (max 300 chars)…" maxlength="300"></textarea>
              <div class="taste-actions">
                <button class="btn" id="btn-save-annotations">Save notes</button>
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn btn-ghost" id="btn-edit-taste" style="flex:1;justify-content:center;font-size:0.7rem">✏ Edit</button>
              <button class="btn btn-danger" id="btn-reset-taste" style="font-size:0.7rem;padding:6px 10px">↺ Reset</button>
            </div>
          </div>
        </div>

      </aside>
    </div>
  `;

  // ── Build card stack ────────────────────────────────────────────────────────
  const stack = document.getElementById('card-stack');

  function buildCards() {
    stack.innerHTML = '';
    const visible = cards.slice(currentIndex, currentIndex + 3);
    visible.forEach((card, i) => {
      const el = createCardEl(card, i);
      stack.appendChild(el);
    });

    // Animate stack entrance — no opacity so cards are never invisible
    animate({
      targets: '.movie-card',
      translateY: [60, 0],
      scale: [0.88, 1],
      duration: 700,
      delay: anime.stagger(60, { from: 'last' }),
      easing: 'easeOutBack',
    });

    attachDrag(stack.children[0]);
  }

  function createCardEl(rec, stackPos) {
    const el = document.createElement('div');
    el.className = 'movie-card' + (stackPos === 1 ? ' card-behind-1' : stackPos === 2 ? ' card-behind-2' : '');
    el.dataset.title = rec.title;
    el.style.zIndex = 10 - stackPos;

    const showSimilar = rec.similar_to && personalised;

    const _posterUrl = (rec.poster_url || '').replace(/'/g, '%27');
    const _iconSrc   = CARD_ICONS[rec.title.charCodeAt(0) % 3];
    el.innerHTML = `
      <div class="stamp stamp-save">SAVE</div>
      <div class="stamp stamp-skip">SKIP</div>
      <div class="card-poster-wrap${rec.poster_url ? '' : ' poster-missing'}">
        ${rec.poster_url ? `<div class="card-poster-blur" style="background-image:url('${_posterUrl}')"></div>` : ''}
        <img class="card-poster" src="${_posterUrl}" alt="${rec.title}" loading="lazy"
             onerror="this.closest('.card-poster-wrap').classList.add('poster-missing')">
        <div class="card-poster-placeholder">
          <img src="${_iconSrc}" alt="" class="card-placeholder-icon">
        </div>
      </div>
      <div class="card-body">
        <div class="card-title-row">
          <span class="card-title">${rec.title}</span>
          <span class="card-year">${rec.year || ''}</span>
        </div>
        <div class="card-meta">
          <span class="card-rating">★ ${rec.rating_out_of_10 || '?'}</span>
          <span class="card-dot">·</span>
          <span class="card-genre">${rec.genre || ''}</span>
          <span class="card-dot">·</span>
          <span class="card-lang">${rec.language || ''}</span>
        </div>
        <p class="card-overview">${rec.overview || ''}</p>
        <p class="card-why">💬 "${rec.why_recommended || ''}"</p>
        ${showSimilar ? `<p class="card-similar">🔁 Similar to: ${rec.similar_to}</p>` : ''}
      </div>
    `;
    return el;
  }

  // ── Drag handling ────────────────────────────────────────────────────────────
  function attachDrag(cardEl) {
    if (!cardEl) return;
    let isDragging = false, startX = 0, startY = 0, currentDeltaX = 0;

    cardEl.addEventListener('mouseenter', () => {
      animate({ targets: cardEl, translateY: -6, boxShadow: '0 32px 80px rgba(0,0,0,0.9)', duration: 200, easing: 'easeOutCubic' });
    });
    cardEl.addEventListener('mouseleave', () => {
      if (!isDragging) {
        animate({ targets: cardEl, translateY: 0, boxShadow: '0 20px 60px rgba(0,0,0,0.7)', duration: 200, easing: 'easeOutCubic' });
      }
    });

    cardEl.addEventListener('pointerdown', (e) => {
      isDragging = true;
      startX = e.clientX; startY = e.clientY; currentDeltaX = 0;
      cardEl.setPointerCapture(e.pointerId);
    });

    cardEl.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      currentDeltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      animate({
        targets: cardEl,
        translateX: currentDeltaX,
        translateY: deltaY * 0.3,
        rotate: `${currentDeltaX * 0.08}deg`,
        duration: 80,
        easing: 'easeOutQuad',
      });

      const absX = Math.abs(currentDeltaX);
      if (absX > 30) {
        const isSave = currentDeltaX > 0;
        animate({
          targets: cardEl.querySelector(isSave ? '.stamp-save' : '.stamp-skip'),
          opacity: Math.min(1, absX / 120),
          duration: 100,
          easing: 'easeOutQuad',
        });
        animate({
          targets: cardEl.querySelector(isSave ? '.stamp-skip' : '.stamp-save'),
          opacity: 0,
          duration: 100,
          easing: 'easeOutQuad',
        });

        // Card glow
        const glowColor = isSave ? 'rgba(80,200,120,0.15)' : 'rgba(224,85,85,0.15)';
        cardEl.style.boxShadow = `0 20px 60px ${glowColor}, 0 0 0 1px ${isSave ? 'rgba(80,200,120,0.2)' : 'rgba(224,85,85,0.2)'}`;
      } else {
        cardEl.style.boxShadow = '';
        animate({ targets: [cardEl.querySelector('.stamp-save'), cardEl.querySelector('.stamp-skip')], opacity: 0, duration: 100 });
      }
    });

    cardEl.addEventListener('pointerup', () => {
      if (!isDragging) return;
      isDragging = false;
      if (currentDeltaX > SWIPE_THRESHOLD) {
        doSwipe(cardEl, 'save');
      } else if (currentDeltaX < -SWIPE_THRESHOLD) {
        doSwipe(cardEl, 'skip');
      } else {
        snapBack(cardEl);
      }
    });
  }

  function snapBack(cardEl) {
    cardEl.style.boxShadow = '';
    animate({ targets: cardEl, translateX: 0, translateY: 0, rotate: '0deg', duration: 500, easing: 'easeOutElastic(1, .5)' });
    animate({ targets: [cardEl.querySelector('.stamp-save'), cardEl.querySelector('.stamp-skip')], opacity: 0, duration: 200 });
  }

  function doSwipe(cardEl, action) {
    const card = cards[currentIndex];

    if (action === 'save') {
      savedTitles.push(card.title);
      api.addToWatchlist(card).then(result => {
        // Trigger taste badge if just hit 5
        if (result.count === 5) {
          activateTasteBadge();
        }
        api.getTaste().then(t => renderTastePanel(t)).catch(() => {});
        // Chain getWatchlist AFTER addToWatchlist has written to disk
        return api.getWatchlist();
      }).then(wl => { watchlist = wl; renderWatchlistPanel(); }).catch(() => {});
      showToast(`✅ ${card.title} saved!`, 'success', 2000);

      animate({
        targets: cardEl,
        translateX: window.innerWidth + 200,
        translateY: -60,
        rotate: '25deg',
        opacity: 0,
        duration: 500,
        easing: 'easeOutCubic',
        complete: () => { cardEl.remove(); advanceCard(); },
      });
    } else {
      animate({
        targets: cardEl,
        translateX: -(window.innerWidth + 200),
        translateY: -60,
        rotate: '-25deg',
        opacity: 0,
        duration: 500,
        easing: 'easeOutCubic',
        complete: () => { cardEl.remove(); advanceCard(); },
      });
    }
  }

  function advanceCard() {
    currentIndex++;
    updateProgress();

    if (currentIndex >= cards.length) {
      onAllCardsSwiped();
      return;
    }

    // Add next card to back of stack if needed
    const nextCardIndex = currentIndex + 2;
    if (nextCardIndex < cards.length) {
      const newBackEl = createCardEl(cards[nextCardIndex], 2);
      stack.appendChild(newBackEl);
      animate({ targets: newBackEl, opacity: [0, 1], duration: 300 });
    }

    // Re-classify remaining cards
    const stackCards = stack.querySelectorAll('.movie-card');
    stackCards.forEach((el, i) => {
      el.classList.remove('card-behind-1', 'card-behind-2');
      if (i === 1) el.classList.add('card-behind-1');
      if (i === 2) el.classList.add('card-behind-2');
      el.style.zIndex = 10 - i;
    });

    // Promote new top card
    if (stackCards[0]) {
      animate({ targets: stackCards[0], scale: [0.96, 1], translateY: [10, 0], duration: 400, easing: 'easeOutBack' });
      attachDrag(stackCards[0]);
    }
  }

  async function onAllCardsSwiped() {
    stack.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text-dim)">
      <img src="/assets/movie_studio.png" alt="" style="width:72px;height:72px;object-fit:contain;margin-bottom:14px;opacity:0.85;filter:drop-shadow(0 4px 12px rgba(201,168,76,0.35))">
      <div style="font-family:var(--mono);font-size:0.8rem">Building your results…</div>
    </div>`;
    await api.completeSwiping(savedTitles);
    // prefab_ready SSE will trigger the view switch
  }

  // ── Progress ──────────────────────────────────────────────────────────────────
  function updateProgress() {
    const total = cards.length;
    const done = currentIndex;
    const pct = total > 0 ? (done / total) * 100 : 0;
    document.getElementById('progress-label').textContent = `Card ${Math.min(done + 1, total)} of ${total}`;
    animate({ targets: '#swipe-progress-fill', width: `${pct}%`, duration: 400, easing: 'easeOutCubic' });
  }

  // ── Watchlist panel ────────────────────────────────────────────────────────
  function renderWatchlistPanel() {
    const countEl  = document.getElementById('watchlist-count');
    const itemsEl  = document.getElementById('watchlist-items');
    const section  = itemsEl?.closest('.watchlist-section');
    if (!countEl || !itemsEl) return;

    countEl.textContent = watchlist.length;

    // Show a scroll hint label when there are many items
    const hintId = 'watchlist-scroll-hint';
    let hintEl = document.getElementById(hintId);
    if (watchlist.length > 10) {
      if (!hintEl) {
        hintEl = document.createElement('div');
        hintEl.id = hintId;
        hintEl.style.cssText = 'font-size:0.62rem;color:var(--text-dimmer);text-align:right;margin-top:-4px;flex-shrink:0';
        section?.insertBefore(hintEl, itemsEl);
      }
      hintEl.textContent = `scroll to see all ${watchlist.length}`;
    } else if (hintEl) {
      hintEl.remove();
    }

    if (watchlist.length === 0) {
      itemsEl.innerHTML = '<div class="empty-state">No saves yet.<br>Swipe right to save a title.</div>';
      return;
    }

    // Render newest-first; CSS scroll container handles overflow
    const allItems = [...watchlist].reverse();
    itemsEl.innerHTML = allItems.map(item => {
      const rating = item.rating_out_of_10 != null ? `★${item.rating_out_of_10}` : '';
      const meta   = [item.year, item.genre].filter(Boolean).join(' · ');
      return `
      <div class="watchlist-item" data-title="${item.title}">
        ${item.poster_url ? `<img class="watchlist-item-poster" src="${item.poster_url}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="watchlist-item-info">
          <span class="watchlist-item-title">${item.title}</span>
          ${meta ? `<span class="watchlist-item-meta">${meta}</span>` : ''}
        </div>
        ${rating ? `<span class="watchlist-item-rating">${rating}</span>` : ''}
        <button class="watchlist-item-remove" data-remove="${item.title}" title="Remove">✕</button>
      </div>`;
    }).join('');

    // Scroll to top so the newest item is visible
    itemsEl.scrollTop = 0;

    itemsEl.querySelectorAll('.watchlist-item-remove').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const title = btn.dataset.remove;
        await api.removeFromWatchlist(title);
        watchlist = watchlist.filter(i => i.title !== title);
        renderWatchlistPanel();
        api.getTaste().then(t => renderTastePanel(t)).catch(() => {});
      });
    });
  }

  // ── Taste panel ────────────────────────────────────────────────────────────
  let tasteEditOpen = false;

  function renderTastePanel(taste) {
    const dot = document.getElementById('taste-dot');
    const summary = document.getElementById('taste-summary');
    const countEl = document.getElementById('taste-count');
    const annoEl = document.getElementById('taste-annotations');
    if (!dot) return;

    if (taste.is_active) {
      dot.classList.add('active');
      countEl.textContent = `${taste.derived_from_count} saves`;
      summary.textContent = taste.summary || '';
    } else {
      dot.classList.remove('active');
      countEl.textContent = '';
      summary.textContent = 'Build up 5 saves to activate personalised recommendations.';
    }

    if (annoEl) {
      annoEl.value = taste.user_annotations || '';
    }
  }

  function activateTasteBadge() {
    const dot = document.getElementById('taste-dot');
    const summaryEl = document.getElementById('taste-summary');
    const panelTaste = document.getElementById('panel-taste');
    if (!dot) return;

    const tl = anime.timeline({ easing: 'easeOutCubic' });
    tl.add({ targets: dot, backgroundColor: ['#555', '#c9a84c'], duration: 600, easing: 'easeOutCubic' })
      .add({ targets: summaryEl, opacity: [0, 1], translateY: [8, 0], duration: 400 }, '-=200')
      .add({ targets: panelTaste, borderColor: ['rgba(255,255,255,0.07)', 'rgba(201,168,76,0.4)', 'rgba(255,255,255,0.07)'], duration: 1000 }, '-=200');
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────────
  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (currentIndex >= cards.length) return;
    const topCard = stack.querySelector('.movie-card:first-child');
    if (!topCard) return;
    if (e.key === 'ArrowRight') doSwipe(topCard, 'save');
    if (e.key === 'ArrowLeft')  doSwipe(topCard, 'skip');
  }

  document.addEventListener('keydown', onKeyDown);

  // Clean up on view change
  const origSwitchView = window._cleanupSwipe;
  window._cleanupSwipe = () => {
    document.removeEventListener('keydown', onKeyDown);
    if (origSwitchView) origSwitchView();
  };

  // ── Button handlers ────────────────────────────────────────────────────────

  // Animated Skip button
  document.getElementById('btn-skip').addEventListener('click', () => {
    const topCard = stack.querySelector('.movie-card:first-child');
    if (topCard && currentIndex < cards.length) {
      _animateSkipBtn();
      doSwipe(topCard, 'skip');
    }
  });

  // Animated Save/Heart button
  document.getElementById('btn-save').addEventListener('click', () => {
    const topCard = stack.querySelector('.movie-card:first-child');
    if (topCard && currentIndex < cards.length) {
      _animateSaveBtn();
      doSwipe(topCard, 'save');
    }
  });

  function _animateSkipBtn() {
    const btn = document.getElementById('btn-skip');
    const cross = btn.querySelector('.x-cross');
    const ring  = btn.querySelector('.x-ring');
    const dots  = btn.querySelectorAll('.x-dot');

    // Ring flash
    anime({ targets: ring, opacity: [0, 0.6, 0], scale: [0.8, 1.15, 0.8], strokeWidth: [0, 3, 0], duration: 500, easing: 'easeOutCubic' });
    // Cross shake + scale burst
    anime({ targets: cross, rotate: ['0deg', '-20deg', '20deg', '-10deg', '0deg'], scale: [1, 1.25, 1], duration: 450, easing: 'easeOutElastic(1, 0.5)' });
    // Dots burst outward
    const dotTargets = Array.from(dots);
    dotTargets.forEach((dot, i) => {
      const angle = (i / dotTargets.length) * Math.PI * 2;
      const dist  = 10 + Math.random() * 8;
      anime({
        targets: dot,
        opacity: [0, 1, 0],
        translateX: [0, Math.cos(angle) * dist],
        translateY: [0, Math.sin(angle) * dist],
        duration: 400,
        delay: 60,
        easing: 'easeOutCubic',
      });
    });
  }

  function _animateSaveBtn() {
    const btn   = document.getElementById('btn-save');
    const fill  = btn.querySelector('.heart-fill');
    const outline = btn.querySelector('.heart-outline');
    const dots  = btn.querySelectorAll('.heart-dot');

    // Pulse scale
    anime({
      targets: btn.querySelector('.swipe-icon-heart'),
      scale: [1, 1.4, 1],
      duration: 480,
      easing: 'easeOutBack',
    });

    // Show fill, hide outline briefly then restore
    anime({ targets: fill,    opacity: [0, 1], scale: [0.6, 1], duration: 300, easing: 'easeOutBack' });
    anime({ targets: outline, opacity: [1, 0, 1], duration: 500, easing: 'easeOutCubic' });
    setTimeout(() => { fill.style.opacity = '0'; }, 600);

    // Dots burst
    const hues = [350, 20, 60, 200, 280, 320, 170, 45];
    dots.forEach((dot, i) => {
      const angle = (i / dots.length) * Math.PI * 2;
      const dist  = 12 + Math.random() * 8;
      dot.style.fill = `hsl(${hues[i % hues.length]}, 90%, 60%)`;
      anime({
        targets: dot,
        opacity: [0, 1, 0],
        translateX: [0, Math.cos(angle) * dist],
        translateY: [0, Math.sin(angle) * dist],
        duration: 500,
        delay: 80,
        easing: 'easeOutCubic',
      });
    });
  }

  document.getElementById('btn-export-txt').addEventListener('click', async () => {
    try {
      const filename = await api.exportFile('txt', 'saved', null);
      showToast(`✅ Downloading ${filename}`, 'success', 3000);
    } catch { showToast('Export failed', 'error'); }
  });

  document.getElementById('btn-export-pdf').addEventListener('click', async () => {
    try {
      await exportWatchlistPDF(watchlist, showToast);
    } catch (err) { showToast('PDF export failed: ' + err.message, 'error'); }
  });

  document.getElementById('btn-clear-watchlist').addEventListener('click', async () => {
    if (!confirm('Clear your entire watchlist? This cannot be undone.')) return;
    await api.clearWatchlist();
    watchlist = [];
    renderWatchlistPanel();
    renderTastePanel({ is_active: false, summary: '', user_annotations: '', derived_from_count: 0 });
    showToast('Watchlist cleared.', 'info', 2000);
  });

  document.getElementById('btn-edit-taste').addEventListener('click', () => {
    const panel   = document.getElementById('taste-edit-panel');
    const btn     = document.getElementById('btn-edit-taste');
    const section = document.querySelector('.taste-section');

    if (!tasteEditOpen) {
      tasteEditOpen = true;
      btn.textContent = '✖ Close';
      section && section.classList.add('edit-open');
      // Keep overflow:hidden so the section's scroll stays intact
      animate({
        targets: panel,
        height: [0, 150],
        opacity: [0, 1],
        duration: 380,
        easing: 'easeOutCubic',
        complete() {
          // Scroll the taste section so the Save + Reset buttons are visible
          if (section) section.scrollTop = section.scrollHeight;
        },
      });
    } else {
      tasteEditOpen = false;
      btn.textContent = '✏ Edit';
      section && section.classList.remove('edit-open');
      animate({
        targets: panel,
        height: [150, 0],
        opacity: [1, 0],
        duration: 260,
        easing: 'easeInCubic',
        complete() { section && (section.scrollTop = 0); },
      });
    }
  });

  document.getElementById('btn-save-annotations').addEventListener('click', async () => {
    const text = document.getElementById('taste-annotations').value;
    await api.editTaste(text);
    showToast('Notes saved.', 'success', 2000);
  });

  document.getElementById('btn-reset-taste').addEventListener('click', async () => {
    // Close edit panel first so it doesn't get stuck
    const editPanel = document.getElementById('taste-edit-panel');
    const editBtn   = document.getElementById('btn-edit-taste');
    const section   = document.querySelector('.taste-section');
    if (tasteEditOpen) {
      tasteEditOpen = false;
      editBtn.textContent = '✏ Edit';
      section && section.classList.remove('edit-open');
      animate({ targets: editPanel, height: 0, opacity: 0, duration: 200, easing: 'easeInCubic' });
    }
    await api.resetTaste();
    api.getTaste().then(t => renderTastePanel(t)).catch(() => {});
    showToast('Taste profile reset.', 'info', 2500);
  });

  // ── Mini search form ────────────────────────────────────────────────────────
  document.getElementById('mini-search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const genre    = document.getElementById('mini-genre').value.trim();
    const language = document.getElementById('mini-lang').value.trim();
    const media_type = e.target.querySelector('input[name="mini_type"]:checked')?.value || 'movie';
    const model    = document.getElementById('mini-model').value;
    if (!genre || !language) { showToast('Enter genre and language', 'warning'); return; }
    try {
      await api.recommend({ genre, language, media_type, model });
    } catch (err) {
      showToast(err.message || 'Failed.', 'error');
    }
  });

  // ── Init ────────────────────────────────────────────────────────────────────
  buildCards();
  updateProgress();
}
