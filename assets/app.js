// Gin-DB common script
(function () {
  // 1. Scroll-trigger reveal animation (IntersectionObserver)
  function initReveal() {
    var els = document.querySelectorAll('.reveal');
    if (!els.length || !('IntersectionObserver' in window)) {
      els.forEach(function (e) { e.classList.add('reveal-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -10% 0px' });
    els.forEach(function (e) { io.observe(e); });
  }

  // 2. Header scroll shadow
  function initHeaderShadow() {
    var h = document.querySelector('.site-header');
    if (!h) return;
    function update() {
      if (window.scrollY > 8) h.classList.add('scrolled');
      else h.classList.remove('scrolled');
    }
    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  // 3. Mobile nav toggle
  function initNavToggle() {
    var btn = document.querySelector('.nav-toggle');
    var header = document.querySelector('.site-header');
    if (!btn || !header) return;
    btn.addEventListener('click', function () {
      header.classList.toggle('nav-open');
    });
  }

  // 4. Hero stats count-up
  function initCountUp() {
    var nums = document.querySelectorAll('.hero__stat .num[data-count]');
    nums.forEach(function (el) {
      var target = parseInt(el.getAttribute('data-count'), 10);
      if (!target) return;
      var dur = 1500;
      var start = null;
      el.textContent = '0';
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.floor(target * eased).toString();
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  // 5. Furusato page filter
  function initFurusatoFilter() {
    var bar = document.querySelector('.filter-bar');
    if (!bar) return;
    var chips = bar.querySelectorAll('.filter-chip');
    var cards = document.querySelectorAll('.furusato-card');
    if (!cards.length) return;

    function applyFilter(f) {
      cards.forEach(function (c) {
        var show = false;
        if (f === 'all') {
          show = true;
        } else if (f === 'amount-10000') {
          show = parseInt(c.getAttribute('data-amount') || '0', 10) <= 10000;
        } else if (f === 'amount-30000') {
          show = parseInt(c.getAttribute('data-amount') || '0', 10) <= 30000;
        } else if (f === 'award') {
          show = c.getAttribute('data-award') === 'true';
        } else if (f === 'set') {
          show = c.getAttribute('data-set') === 'true';
        } else if (f.indexOf('region-') === 0) {
          var region = f.replace('region-', '');
          show = c.getAttribute('data-region') === region;
        }
        c.style.display = show ? '' : 'none';
      });
    }

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        applyFilter(chip.getAttribute('data-filter') || 'all');
      });
    });
  }

  function init() {
    initReveal();
    initHeaderShadow();
    initNavToggle();
    initCountUp();
    initFurusatoFilter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
