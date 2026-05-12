/* ============================================================
   청심연한의원 — main.js
   ============================================================ */

/* ── Font size: 저장된 크기 즉시 복원 (FOUC 방지) ─────────── */
(function () {
  const SIZES = [16, 18, 20];
  const i = Math.min(parseInt(localStorage.getItem('csy_fs') || '0'), SIZES.length - 1);
  document.documentElement.style.fontSize = SIZES[i] + 'px';
})();

(function () {
  'use strict';

  /* ── Navigation ───────────────────────────────────────── */
  const header    = document.getElementById('header');
  const hamburger = document.querySelector('.nav-hamburger');
  const drawer    = document.querySelector('.nav-drawer');

  if (hamburger && drawer) {
    hamburger.addEventListener('click', () => {
      const open = hamburger.classList.toggle('open');
      drawer.classList.toggle('open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    });

    drawer.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        hamburger.classList.remove('open');
        drawer.classList.remove('open');
        document.body.style.overflow = '';
      }
    });
  }

  /* ── Header scroll effect ──────────────────────────────── */
  if (header) {
    const onScroll = () => {
      header.classList.toggle('scrolled', window.scrollY > 10);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ── Active nav link ───────────────────────────────────── */
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .nav-drawer a').forEach((link) => {
    const href = link.getAttribute('href');
    if (href === currentPath || (currentPath === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });

  /* ── Intersection Observer — fade-up ──────────────────── */
  const fadeEls = document.querySelectorAll('.fade-up');
  if (fadeEls.length && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('visible');
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    fadeEls.forEach((el) => obs.observe(el));
  } else {
    fadeEls.forEach((el) => el.classList.add('visible'));
  }

  /* ── Contact form ──────────────────────────────────────── */
  const form    = document.getElementById('contactForm');
  const success = document.getElementById('formSuccess');

  if (form && success) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      form.style.display = 'none';
      success.style.display = 'block';
    });
  }

  /* ── Treatment filter (treatment.html) ─────────────────── */
  const filters  = document.querySelectorAll('.treat-filter');
  const details  = document.querySelectorAll('.treatment-detail');

  if (filters.length && details.length) {
    filters.forEach((btn) => {
      btn.addEventListener('click', () => {
        filters.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        const target = btn.dataset.filter;
        details.forEach((card) => {
          if (target === 'all' || card.dataset.category === target) {
            card.style.display = '';
          } else {
            card.style.display = 'none';
          }
        });
      });
    });
  }

  /* ── Smooth scroll for anchor links ────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href');
      if (id === '#') return;
      const target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        const offset = parseInt(getComputedStyle(document.documentElement)
          .getPropertyValue('--nav-h')) || 68;
        const top = target.getBoundingClientRect().top + window.scrollY - offset - 16;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  /* ── Phone number formatting (contact form) ─────────────── */
  const phoneInput = document.getElementById('phone');
  if (phoneInput) {
    phoneInput.addEventListener('input', () => {
      let val = phoneInput.value.replace(/\D/g, '');
      if (val.length <= 3) {
        phoneInput.value = val;
      } else if (val.length <= 7) {
        phoneInput.value = val.slice(0, 3) + '-' + val.slice(3);
      } else {
        phoneInput.value =
          val.slice(0, 3) + '-' + val.slice(3, 7) + '-' + val.slice(7, 11);
      }
    });
  }

  /* ── Floating Action Buttons ───────────────────────────── */
  const SIZES = [16, 18, 20];
  let sizeIdx = Math.min(parseInt(localStorage.getItem('csy_fs') || '0'), SIZES.length - 1);

  function applySize(i) {
    sizeIdx = Math.max(0, Math.min(i, SIZES.length - 1));
    document.documentElement.style.fontSize = SIZES[sizeIdx] + 'px';
    localStorage.setItem('csy_fs', sizeIdx);
  }

  const fab = document.createElement('div');
  fab.className = 'float-group';
  fab.innerHTML = `
    <a href="tel:02-6393-5337" class="float-btn float-phone" title="전화 예약" aria-label="전화 예약">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36
          1.02-.24 1.12.37 2.32.57 3.58.57.55 0 1 .45 1 1V20c0 .55-.45
          1-1 1C10.18 21 3 13.82 3 5c0-.55.45-1 1-1h3.5c.55 0 1 .45 1
          1 0 1.27.2 2.47.57 3.58.11.35.02.74-.24 1.02L6.6 10.8z"/>
      </svg>
    </a>
    <a href="http://pf.kakao.com/_jxgYxin" target="_blank" rel="noopener noreferrer" class="float-btn float-kakao" title="카카오톡 채널" aria-label="카카오톡 채널">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 3C6.48 3 2 6.69 2 11.25c0 2.94 1.95 5.52 4.9 7.02
          -.2.74-.74 2.7-.84 3.11-.13.5.18.49.38.36.15-.1 2.43-1.64
          3.41-2.3.7.1 1.42.16 2.15.16 5.52 0 10-3.69 10-8.25
          C22 6.69 17.52 3 12 3z"/>
      </svg>
    </a>
    <div class="float-font-row">
      <button class="float-btn float-font" id="csy-font-down" title="글자 작게" aria-label="글자 작게">A−</button>
      <button class="float-btn float-font" id="csy-font-up"   title="글자 크게" aria-label="글자 크게">A+</button>
    </div>`;
  document.body.appendChild(fab);

  document.getElementById('csy-font-down').addEventListener('click', () => applySize(sizeIdx - 1));
  document.getElementById('csy-font-up').addEventListener('click',   () => applySize(sizeIdx + 1));

})();
