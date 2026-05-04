import anime from '/lib/anime.js';

const MODELS = [
  { id: 'meta/llama-3.1-8b-instruct',        label: '⚡ Llama 3.1 8B (Fast) — default' },
  { id: 'mistralai/mistral-medium-3.5-128b', label: '🧠 Mistral Medium 3.5' },
  { id: 'mistralai/mistral-large-2411',       label: '🔬 Mistral Large 2411' },
  { id: 'meta/llama-3.3-70b-instruct',        label: '🦙 Llama 3.3 70B' },
];

export function renderOnboarding(container, headerRight, { api, showToast }) {
  // Preserve the theme toggle button so it survives the innerHTML clear
  const savedThemeBtn = headerRight.querySelector('#btn-theme');
  headerRight.innerHTML = '';
  if (savedThemeBtn) headerRight.appendChild(savedThemeBtn);

  container.innerHTML = `
    <div class="onboarding">

      <!-- Left: animated icon scene -->
      <div class="demo-icons-wrap" aria-hidden="true">
        <div class="demo-icon-orbit">
          <img class="demo-icon demo-icon-clap" src="/assets/movie_studio.png" alt="">
          <img class="demo-icon demo-icon-cam"  src="/assets/video_marketing_movie_camera_icon_192459.png" alt="">
        </div>
        <div class="demo-icon-ring"></div>
      </div>

      <!-- Right: form -->
      <div class="onboarding-form-wrap">

        <!-- Movie icon -->
        <div class="ob-icon" aria-hidden="true">
          <img src="/assets/cinema_popcorn.png" alt="CineSwipe" class="ob-icon-img">
        </div>

        <div class="ob-headline">
          Discover your next<br><span>obsession.</span>
        </div>
        <div class="ob-tagline">
          Your taste. AI-curated. 10 perfect picks, every session.
        </div>

        <form class="onboarding-form" id="onboarding-form">
          <div class="form-field">
            <label class="form-label" for="ob-genre">Genre</label>
            <input class="input" id="ob-genre" type="text" placeholder="e.g. slow-burn thriller" autocomplete="off" required>
          </div>
          <div class="form-field">
            <label class="form-label" for="ob-lang">Language</label>
            <input class="input" id="ob-lang" type="text" placeholder="e.g. Korean, Hindi, Japanese" autocomplete="off" required>
          </div>
          <div class="form-field">
            <label class="form-label">Type</label>
            <div class="radio-group">
              <label class="radio-label"><input type="radio" name="media_type" value="movie" checked> Movie</label>
              <label class="radio-label"><input type="radio" name="media_type" value="tv"> TV Series</label>
            </div>
          </div>
          <div class="form-field">
            <label class="form-label" for="ob-model">Model</label>
            <select class="select" id="ob-model">
              ${MODELS.map((m, i) => `<option value="${m.id}"${i === 0 ? ' selected' : ''}>${m.label}</option>`).join('')}
            </select>
          </div>
          <button type="submit" class="generate-button" id="ob-submit">
            <svg class="gb-icon" viewBox="0 0 24 26" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 0.5L7.08396 3.91604L10.5 5L7.08396 6.08396L6 9.5L4.91604 6.08396L1.5 5L4.91604 3.91604L6 0.5Z"/>
              <path d="M14.5 9.5L16.0759 14.4241L21 16L16.0759 17.5759L14.5 22.5L12.9241 17.5759L8 16L12.9241 14.4241L14.5 9.5Z"/>
              <path d="M6 17.5L7.08396 20.916L10.5 22L7.08396 23.084L6 26.5L4.91604 23.084L1.5 22L4.91604 20.916L6 17.5Z"/>
            </svg>
            <span>✦ Get Recommendations</span>
          </button>
        </form>

        <div class="ob-hint">Drag or press ← → to swipe · Save 5 to activate taste profile</div>
      </div>

    </div>
  `;

  anime({ targets: '.onboarding-form-wrap > *', translateY: [20, 0], duration: 480, delay: anime.stagger(70), easing: 'easeOutCubic' });

  const genBtn = document.getElementById('ob-submit');

  // Initialise GSAP sparkle effect
  _initSparkleButton(genBtn);

  // Form submit
  const form = document.getElementById('onboarding-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const genre      = document.getElementById('ob-genre').value.trim();
    const language   = document.getElementById('ob-lang').value.trim();
    const media_type = form.querySelector('input[name="media_type"]:checked').value;
    const model      = document.getElementById('ob-model').value;

    if (!genre || !language) {
      showToast('Please enter a genre and language.', 'warning');
      return;
    }

    genBtn.classList.add('loading');
    genBtn.querySelector('span').textContent = '⏳ Fetching your picks…';

    try {
      await api.recommend({ genre, language, media_type, model });
    } catch (err) {
      genBtn.classList.remove('loading');
      genBtn.querySelector('span').textContent = '✦ Get Recommendations';
      showToast(err.message || 'Failed to start recommendations.', 'error');
    }
  });
}

/* ──────────────────────────────────────────────────────────────────────────
   GSAP Sparkle button initialiser
   Particles fly upward, stroke traces the border, stars pulse — all gold.
────────────────────────────────────────────────────────────────────────── */
function _initSparkleButton(btn) {
  if (typeof gsap === 'undefined') return;

  // Defer one frame so layout is settled and offsetWidth is accurate
  requestAnimationFrame(() => {
    const W = btn.offsetWidth  || 280;
    const H = btn.offsetHeight || 52;
    const R = parseFloat(getComputedStyle(btn).borderRadius) || 29;

    /* ── Dots (particle) SVG ─────────────────────────────────────── */
    const dotsSVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    dotsSVG.setAttribute('viewBox', `0 0 ${W} ${H}`);
    dotsSVG.setAttribute('preserveAspectRatio', 'none');
    Object.assign(dotsSVG.style, {
      position: 'absolute', inset: '0',
      width: '100%', height: '100%',
      fill: 'var(--gold)', opacity: '0',
      pointerEvents: 'none', zIndex: '10',
      overflow: 'visible',
    });
    btn.appendChild(dotsSVG);

    /* ── Stroke SVGs (double layer — one blurred) ────────────────── */
    const strokeWrap = document.createElement('div');
    Object.assign(strokeWrap.style, {
      position: 'absolute', inset: '0',
      pointerEvents: 'none', mixBlendMode: 'hard-light',
    });

    const strokeRects = [];
    for (let i = 0; i < 2; i++) {
      const s   = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const rec = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      s.setAttribute('viewBox', `0 0 ${W} ${H}`);
      s.setAttribute('preserveAspectRatio', 'none');
      Object.assign(s.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        fill: 'none', opacity: '0',
        ...(i === 1 ? { filter: 'blur(3px)' } : {}),
      });

      rec.setAttribute('x',          '0.5');
      rec.setAttribute('y',          '0.5');
      rec.setAttribute('width',      String(W - 1));
      rec.setAttribute('height',     String(H - 1));
      rec.setAttribute('rx',         String(R));
      rec.setAttribute('ry',         String(R));
      rec.setAttribute('pathLength', '10');
      rec.setAttribute('stroke',     'var(--gold)');
      rec.setAttribute('stroke-dasharray',  '1.5 14');
      rec.setAttribute('stroke-dashoffset', '22');
      rec.setAttribute('stroke-width', i === 0 ? '0.75' : '1');
      if (i === 1) rec.setAttribute('stroke-opacity', '0.5');

      s.appendChild(rec);
      strokeWrap.appendChild(s);
      strokeRects.push(rec);
    }
    btn.appendChild(strokeWrap);

    const strokeSVGs = Array.from(strokeWrap.querySelectorAll('svg'));

    /* ── Particle circles ────────────────────────────────────────── */
    const COUNT = 32;
    const particles = [];
    for (let i = 0; i < COUNT; i++) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('r', '0');
      dotsSVG.appendChild(c);
      particles.push(c);
    }

    function buildParticleTL() {
      const tl = gsap.timeline({ repeat: -1 });
      particles.forEach((c, i) => {
        const sx  = gsap.utils.random(W * 0.15, W * 0.85);
        const sy  = gsap.utils.random(H * 0.2,  H * 0.8);
        const ex  = sx + gsap.utils.random(-W * 0.3, W * 0.3);
        const ey  = sy - gsap.utils.random(H * 1.8, H * 3.2);
        const dur = gsap.utils.random(1.0, 1.9);
        const pTL = gsap.timeline();
        pTL
          .set(c, { attr: { cx: sx, cy: sy, r: 0 } })
          .to(c, {
            duration: dur,
            attr: { r: gsap.utils.random(0.8, 1.8), cx: ex, cy: ey },
            ease: 'power1.out',
          })
          .to(c, { duration: dur * 0.35, attr: { r: 0 } }, `-=${dur * 0.3}`);
        tl.add(pTL, i * 0.06);
      });
      return tl;
    }

    let ptl = buildParticleTL();
    ptl.pause();

    /* ── Star icon animation ─────────────────────────────────────── */
    const paths = btn.querySelectorAll('.gb-icon path');
    gsap.set(paths[0], { transformOrigin: '25% 14.58%', opacity: 0.25, scale: 1 });
    gsap.set(paths[1], { transformOrigin: '60.42% 50%',  opacity: 1,    scale: 1 });
    gsap.set(paths[2], { transformOrigin: '25% 85.42%', opacity: 0.5,  scale: 1 });

    const starsTL = gsap.timeline({ repeat: -1, repeatDelay: 0.85, paused: true })
      .to(paths[1], { scale: 0.5, opacity: 0.2, duration: 0.32 })
      .to(paths[2], { scale: 1.3, opacity: 1,   duration: 0.32 }, '<')
      .to(paths[0], { scale: 1.6, opacity: 0.6, duration: 0.32 }, '+=0.04')
      .to(paths[1], { scale: 0.5, duration: 0.32 }, '<')
      .to(paths[2], { scale: 1.0, opacity: 0.5, duration: 0.32 }, '<')
      .to(paths[0], { scale: 1.0, opacity: 0.25, duration: 0.32 }, '+=0.04')
      .to(paths[1], { scale: 1.15, opacity: 1, duration: 0.32 }, '<')
      .to(paths[1], { scale: 1.0, duration: 0.38 });

    /* ── Hover enter ─────────────────────────────────────────────── */
    let starTimer;
    btn.addEventListener('pointerenter', () => {
      clearTimeout(starTimer);

      // Reveal dots
      gsap.killTweensOf(dotsSVG);
      gsap.to(dotsSVG, { opacity: 0.65, duration: 0.3 });
      ptl.restart().play();

      // Reveal + animate stroke
      strokeSVGs.forEach((s, i) => {
        gsap.killTweensOf(s);
        gsap.killTweensOf(strokeRects[i]);
        gsap.to(s, { opacity: 1, duration: 0.2 });
        gsap.fromTo(strokeRects[i],
          { attr: { 'stroke-dashoffset': 22 } },
          { attr: { 'stroke-dashoffset': 6 }, duration: 2.5, repeat: -1, ease: 'none', delay: 0.15 },
        );
      });

      starTimer = setTimeout(() => starsTL.restart().play(), 420);
    });

    /* ── Hover leave ─────────────────────────────────────────────── */
    btn.addEventListener('pointerleave', () => {
      clearTimeout(starTimer);

      gsap.killTweensOf(dotsSVG);
      gsap.to(dotsSVG, { opacity: 0, duration: 0.2 });
      ptl.pause();

      strokeSVGs.forEach((s, i) => {
        gsap.killTweensOf(s);
        gsap.killTweensOf(strokeRects[i]);
        gsap.to(s, { opacity: 0, duration: 0.15 });
      });

      starsTL.pause();
      gsap.killTweensOf(paths);
      gsap.to(paths[0], { scale: 1, opacity: 0.25, duration: 0.2 });
      gsap.to(paths[1], { scale: 1, opacity: 1,    duration: 0.2 });
      gsap.to(paths[2], { scale: 1, opacity: 0.5,  duration: 0.2 });
    });
  });
}
