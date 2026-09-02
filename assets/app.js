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
    function setOpen(open) {
      header.classList.toggle('nav-open', open);
      btn.setAttribute('aria-expanded', String(open));
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!header.classList.contains('nav-open'));
    });
    // メニュー外タップで閉じる（誤タップ・閉じ方が分からない問題の対策）
    document.addEventListener('click', function (e) {
      if (header.classList.contains('nav-open') && !header.contains(e.target)) {
        setOpen(false);
      }
    });
    // Escで閉じてトグルにフォーカスを戻す（キーボード操作のため）
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && header.classList.contains('nav-open')) {
        setOpen(false);
        btn.focus();
      }
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

  // 5. 一覧ページの並べ替え（.bottle-list 内の .bottle を data-price / data-cap で並べ替える）
  //    ボタンは .sort-bar .sort-chip[data-sort] 。無いページでは何もしない。
  function initListSort() {
    var bars = document.querySelectorAll('.sort-bar');
    if (!bars.length) return;
    bars.forEach(function (bar) {
      var list = bar.nextElementSibling;
      while (list && !list.querySelector('.bottle')) list = list.nextElementSibling;
      if (!list) return;
      var chips = bar.querySelectorAll('.sort-chip');
      var original = Array.prototype.slice.call(list.querySelectorAll('.bottle'));
      function val(el, key) {
        var v = parseFloat(el.getAttribute('data-' + key));
        return isNaN(v) ? Infinity : v;
      }
      chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
          chips.forEach(function (c) { c.classList.remove('active'); });
          chip.classList.add('active');
          var mode = chip.getAttribute('data-sort');
          var items = original.slice();
          if (mode === 'price-asc') items.sort(function (a, b) { return val(a, 'price') - val(b, 'price'); });
          else if (mode === 'price-desc') items.sort(function (a, b) { return val(b, 'price') - val(a, 'price'); });
          else if (mode === 'cap-asc') items.sort(function (a, b) { return val(a, 'cap') - val(b, 'cap'); });
          items.forEach(function (el) { list.appendChild(el); });
        });
      });
    });
  }

  function init() {
    initReveal();
    initHeaderShadow();
    initNavToggle();
    initCountUp();
    initListSort();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
