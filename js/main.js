/* ============================================================
   청심연한의원 — main.js
   ============================================================ */

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
      const target = document.querySelector(link.getAttribute('href'));
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
})();
