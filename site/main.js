// Project Starfish - landing interactions. No dependencies, CSP-friendly (script-src 'self').
(function () {
  'use strict';

  // ---- copy install command ----
  var btn = document.getElementById('copybtn');
  var cmd = document.getElementById('installcmd');
  if (btn && cmd) {
    btn.addEventListener('click', function () {
      var text = cmd.textContent.trim();
      var done = function () { btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = 'Copy'; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { fallback(text); done(); });
      } else { fallback(text); done(); }
    });
  }
  function fallback(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* noop */ }
    document.body.removeChild(ta);
  }

  // ---- scroll reveal ----
  var reveals = document.querySelectorAll('.s, .card, .member, .node');
  reveals.forEach(function (el) { el.classList.add('reveal'); });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  // ---- warp starfield (respects reduced-motion) ----
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canvas = document.getElementById('warp');
  if (!canvas || reduce) return;
  var ctx = canvas.getContext('2d');
  var w, h, stars, raf;
  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    var count = Math.min(220, Math.floor((w * h) / 9000));
    stars = [];
    for (var i = 0; i < count; i++) {
      stars.push({ x: (Math.random() - 0.5) * w, y: (Math.random() - 0.5) * h, z: Math.random() * w });
    }
  }
  function tick() {
    ctx.clearRect(0, 0, w, h);
    ctx.save(); ctx.translate(w / 2, h / 2);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.z -= 0.55;
      if (s.z <= 0) { s.x = (Math.random() - 0.5) * w; s.y = (Math.random() - 0.5) * h; s.z = w; }
      var k = 128 / s.z;
      var px = s.x * k, py = s.y * k;
      if (px < -w / 2 || px > w / 2 || py < -h / 2 || py > h / 2) continue;
      var size = (1 - s.z / w) * 1.9;
      var a = (1 - s.z / w) * 0.8;
      ctx.fillStyle = 'rgba(120,200,255,' + a.toFixed(3) + ')';
      ctx.fillRect(px, py, size, size);
    }
    ctx.restore();
    raf = requestAnimationFrame(tick);
  }
  resize();
  tick();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { cancelAnimationFrame(raf); } else { raf = requestAnimationFrame(tick); }
  });
})();
