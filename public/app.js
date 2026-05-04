import anime from '/lib/anime.js';
import { renderOnboarding } from '/views/onboarding.js';
import { renderSwipe }      from '/views/swipe.js';
import { renderSummary }    from '/views/summary.js';

// ── Canvas particle background ───────────────────────────────────────────────
(function initParticles() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const isDark = () => document.documentElement.dataset.theme !== 'light';

  let W, H, particles = [], animId;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function makeParticle() {
    return {
      x:    Math.random() * (W || 800),
      y:    Math.random() * (H || 600),
      r:    Math.random() * 2.2 + 0.4,          // radius 0.4–2.6
      vx:   (Math.random() - 0.5) * 0.28,
      vy:   (Math.random() - 0.5) * 0.28,
      life: Math.random(),                       // phase offset for twinkle
      speed: 0.004 + Math.random() * 0.008,      // twinkle speed
    };
  }

  function init() {
    resize();
    const count = Math.floor((W * H) / 8000);   // density
    particles = Array.from({ length: count }, makeParticle);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    const dark = isDark();
    const baseAlpha = dark ? 0.65 : 0.35;
    const baseColor = dark ? '201,168,76' : '140,110,40';

    particles.forEach(p => {
      p.life += p.speed;
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(p.life * Math.PI));
      const alpha = baseAlpha * twinkle;

      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -10) p.x = W + 10;
      if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H + 10;
      if (p.y > H + 10) p.y = -10;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${baseColor},${alpha.toFixed(3)})`;
      ctx.fill();
    });

    animId = requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); });
  // Re-tint automatically when theme changes (MutationObserver)
  new MutationObserver(() => {}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  init();
  draw();
})();

// ── State ────────────────────────────────────────────────────────────────────
let currentView = 'onboarding';
let sseSource = null;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const main            = document.getElementById('app-main');
const headerRight     = document.getElementById('header-right');
const sessionTitle    = document.getElementById('session-title');
const loadingOverlay  = document.getElementById('loading-overlay');
const progressFill    = document.getElementById('loading-progress-fill');
const progressText    = document.getElementById('loading-progress-text');
const toastArea       = document.getElementById('toast-area');

// ── Theme ─────────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('cineswipe-theme') || 'dark';
  document.documentElement.dataset.theme = saved;
  renderThemeBtn();
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('cineswipe-theme', next);
  renderThemeBtn();
}

function renderThemeBtn() {
  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  btn.textContent = document.documentElement.dataset.theme === 'dark' ? '◑ Light' : '◐ Dark';
}

// ── Shell reveal ──────────────────────────────────────────────────────────────
function shellReveal() {
  anime({ targets: '.app-header', translateY: [-40, 0], opacity: [0, 1], duration: 500, easing: 'easeOutCubic' });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
export function showToast(message, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastArea.appendChild(el);

  anime({ targets: el, translateY: [40, 0], opacity: [0, 1], duration: 350, easing: 'easeOutBack' });

  if (type === 'error') {
    anime({ targets: el, translateX: [0, -8, 8, -6, 6, -3, 3, 0], duration: 500, easing: 'easeOutCubic', delay: 400 });
  }

  setTimeout(() => {
    anime({ targets: el,
      translateY: [0, 20],
      opacity: [1, 0],
      duration: 300,
      easing: 'easeInQuad',
      complete: () => el.remove(),
    });
  }, duration);
}

// ── Loading overlay ───────────────────────────────────────────────────────────
let loadingStep = -1;
let _loadingStart = 0;
let _elapsedInterval = null;
const STEP_PROGRESS = [10, 35, 80, 100];
const STEP_LABELS = ['manage_watchlist', 'fetch_recommendations', 'fetch_poster_image', 'push_to_ui'];

const stageLabel  = document.getElementById('terminal-stage');
const elapsedEl   = document.getElementById('terminal-elapsed');
const terminalPid = document.getElementById('terminal-pid');

const _typewriteTimers = new WeakMap();
function _typewrite(el, text, speed = 22) {
  if (!el) return;
  // Cancel any in-flight interval on this element before starting a new one
  const prev = _typewriteTimers.get(el);
  if (prev) clearInterval(prev);
  el.textContent = '';
  let i = 0;
  const iv = setInterval(() => {
    if (i < text.length) { el.textContent += text[i++]; }
    else { clearInterval(iv); _typewriteTimers.delete(el); }
  }, speed);
  _typewriteTimers.set(el, iv);
}

function showLoading() {
  loadingStep = -1;
  _loadingStart = Date.now();
  loadingOverlay.hidden = false;
  loadingOverlay.style.opacity = '1';

  // Random fake PID for the terminal title bar
  if (terminalPid) terminalPid.textContent = `PID ${Math.floor(1000 + Math.random() * 8999)}`;

  // Reset steps
  document.querySelectorAll('.loading-step').forEach((s, i) => {
    s.classList.remove('active', 'done');
    s.querySelector('.step-check').textContent = '○';
    s.querySelector('.step-label').textContent = STEP_LABELS[i] || '…';
  });
  setProgress(0);
  if (stageLabel) stageLabel.textContent = 'Initialising…';

  // Elapsed counter
  clearInterval(_elapsedInterval);
  _elapsedInterval = setInterval(() => {
    const s = Math.floor((Date.now() - _loadingStart) / 1000);
    if (elapsedEl) elapsedEl.textContent = `elapsed ${s}s`;
  }, 1000);

  anime({ targets: '.spinner-ring-outer', rotate: '1turn', duration: 2000, loop: true, easing: 'linear' });
  anime({ targets: '.spinner-ring-inner', rotate: '-1turn', duration: 1400, loop: true, easing: 'linear' });
  anime({ targets: '.loading-terminal', opacity: [0, 1], translateY: [20, 0], duration: 450, easing: 'easeOutCubic' });
}

function hideLoading() {
  clearInterval(_elapsedInterval);
  anime({ targets: loadingOverlay,
    opacity: [1, 0],
    duration: 400,
    easing: 'easeOutCubic',
    complete: () => { loadingOverlay.hidden = true; loadingOverlay.style.opacity = ''; },
  });
}

function setProgress(pct) {
  progressFill.style.width = `${pct}%`;
  progressText.textContent = `${Math.round(pct)}%`;
}

function activateStep(step, message) {
  if (loadingStep >= 0) {
    const prev = document.querySelector(`.loading-step[data-step="${loadingStep}"]`);
    if (prev) {
      prev.classList.remove('active');
      prev.classList.add('done');
      prev.querySelector('.step-check').textContent = '✓';
    }
  }
  loadingStep = step;
  const el = document.querySelector(`.loading-step[data-step="${step}"]`);
  if (el) {
    el.classList.add('active');
    el.querySelector('.step-check').textContent = '⏳';
    const label = message || STEP_LABELS[step] || '…';
    el.querySelector('.step-label').textContent = label;
    anime({ targets: el, opacity: [0.5, 1], duration: 250, easing: 'easeOutCubic' });
  }
  // Update terminal stage label with typewriter
  if (stageLabel) {
    const stageTxt = message
      ? `▶ ${message}`
      : `▶ mcp::${STEP_LABELS[step] || ''}`;
    _typewrite(stageLabel, stageTxt, 18);
  }
  const pct = STEP_PROGRESS[step] || 0;
  anime({ targets: progressFill, width: `${pct}%`, duration: 600, easing: 'easeOutCubic',
    update: () => { progressText.textContent = `${Math.round(parseFloat(progressFill.style.width) || 0)}%`; },
  });
}

function completeStep(step) {
  const el = document.querySelector(`.loading-step[data-step="${step}"]`);
  if (!el) return;
  el.classList.remove('active');
  el.classList.add('done');
  const check = el.querySelector('.step-check');
  check.textContent = '✓';
  anime({ targets: check, scale: [0, 1.3, 1], opacity: [0, 1], duration: 400, easing: 'easeOutBack' });
}

// ── SSE ───────────────────────────────────────────────────────────────────────
function connectSSE() {
  if (sseSource) { sseSource.close(); }
  sseSource = new EventSource('/api/stream');

  sseSource.addEventListener('connected', () => {});
  sseSource.addEventListener('tool_start',    (e) => { const { step, message } = JSON.parse(e.data); activateStep(step, message); });
  sseSource.addEventListener('tool_complete', (e) => { const { step } = JSON.parse(e.data); completeStep(step); });

  sseSource.addEventListener('poster_progress', (e) => {
    const { count, total } = JSON.parse(e.data);
    const base = STEP_PROGRESS[1];
    const pct  = base + (count / total) * (STEP_PROGRESS[2] - base);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${Math.round(pct)}%`;
    const label = document.querySelector('.loading-step[data-step="2"] .step-label');
    if (label) label.textContent = `fetch_poster_image (${count}/${total})`;
    if (stageLabel) stageLabel.textContent = `▶ mcp::fetch_poster_image (${count}/${total})`;
  });

  sseSource.addEventListener('toast', (e) => {
    const { type, message, duration } = JSON.parse(e.data);
    showToast(message, type || 'info', duration || 3000);
  });

  sseSource.addEventListener('cards_ready', (e) => {
    const data = JSON.parse(e.data);
    setProgress(100);
    completeStep(3);
    sessionTitle.textContent = data.ui_title;
    if (stageLabel) _typewrite(stageLabel, '✓ All done! Loading your cards.', 18);
    if (elapsedEl) elapsedEl.textContent = `elapsed ${Math.floor((Date.now() - _loadingStart) / 1000)}s`;
    setTimeout(() => { hideLoading(); switchView('swipe', data); }, 900);
  });

  sseSource.addEventListener('prefab_ready', (e) => {
    const payload = JSON.parse(e.data);
    // Switch to in-app summary view (uses real sessionData)
    switchView('summary', payload);
    // Open the Prefab HTML report in a new tab automatically
    window.open(payload.url, '_blank', 'noopener,noreferrer');
    showToast('📊 Full results opened in a new tab!', 'success', 4000);
  });

  sseSource.addEventListener('error', (e) => {
    try { const { message } = JSON.parse(e.data); showToast(message, 'error', 6000); } catch {}
    hideLoading();
  });

  sseSource.onerror = () => {};
}

// ── View switching ────────────────────────────────────────────────────────────
export function switchView(view, data = {}) {
  currentView = view;

  main.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
  main.style.opacity = '0';
  main.style.transform = 'translateY(-8px)';

  setTimeout(() => {
    main.innerHTML = '';
    const themeBtn = document.getElementById('btn-theme');
    headerRight.innerHTML = '';
    if (themeBtn) headerRight.appendChild(themeBtn);
    sessionTitle.textContent = '';

    if (view === 'onboarding') {
      try { renderOnboarding(main, headerRight, { api, showToast }); }
      catch (err) { console.error('[switchView] onboarding render error:', err); showToast('UI render error — check console', 'error'); }
    } else if (view === 'swipe') {
      try { renderSwipe(main, headerRight, { data, api, showToast }); }
      catch (err) { console.error('[switchView] swipe render error:', err); showToast('UI render error — check console', 'error'); }
    } else if (view === 'summary') {
      try {
        renderSummary(main, headerRight, {
          prefabUrl:   data.url || '/prefab_output.html',
          sessionData: data.sessionData || {},
          api,
          showToast,
        });
      }
      catch (err) { console.error('[switchView] summary render error:', err); showToast('UI render error — check console', 'error'); }
    }

    main.offsetHeight; // force reflow
    main.style.opacity = '1';
    main.style.transform = 'translateY(0)';
  }, 180);
}

// ── API helpers ───────────────────────────────────────────────────────────────
export const api = {
  async recommend(params) {
    showLoading();
    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json();
      hideLoading();
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  },

  async addToWatchlist(item) {
    return fetch('/api/watchlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', item }),
    }).then(r => r.json());
  },

  async removeFromWatchlist(title) {
    return fetch('/api/watchlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', item: { title } }),
    }).then(r => r.json());
  },

  async clearWatchlist() {
    return fetch('/api/watchlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear' }),
    }).then(r => r.json());
  },

  async getWatchlist() {
    return fetch('/api/watchlist').then(r => r.json());
  },

  async getTaste() {
    return fetch('/api/taste').then(r => r.json());
  },

  async editTaste(user_annotations) {
    return fetch('/api/taste', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit', user_annotations }),
    }).then(r => r.json());
  },

  async resetTaste() {
    return fetch('/api/taste', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' }),
    }).then(r => r.json());
  },

  async completeSwiping(savedTitles) {
    return fetch('/api/recommend/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ savedTitles }),
    }).then(r => r.json());
  },

  async exportFile(format, scope, session_data) {
    const res = await fetch('/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, scope, session_data }),
    });
    if (!res.ok) throw new Error('Export failed');

    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `cineswipe.${format}`;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return filename;
  },
};

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  initTheme();
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);

  connectSSE();
  shellReveal();

  try {
    await fetch('/api/state').then(r => r.json());
  } catch {}

  renderOnboarding(main, headerRight, { api, showToast });
}

boot();
