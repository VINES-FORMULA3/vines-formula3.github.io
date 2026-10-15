// Home-page hero: an interactive, illustrative view of a dynamic programmable
// wireless environment. Pick a band (sub-6, FR3, mmWave) and switch the RIS and
// the MRA on or off; every option runs on the same moving people, so the
// comparison table is like-for-like. The link model lives in pwe-model.js.
(function () {
  var M = window.PWEModel;
  var canvas = document.getElementById('pwe-sim');
  if (!M || !canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var wrap = canvas.parentNode;
  var spark = document.getElementById('pwe-spark');
  var sctx = spark && spark.getContext ? spark.getContext('2d') : null;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var W = M.W, H = M.H, WALL = M.WALL, DOOR = M.DOOR, AP = M.AP, PERSON_R = M.PERSON_R;
  var TARGET = 2;    // Gbps: a multi-Gbps service target
  var YMAX = 8;      // Gbps: sparkline scale, shared by all options
  var HIST_N = 200;  // 20 s of history at 10 samples/s
  var SERIES_COLOR = '#199e70';
  var CONE = { sub6: 0.55, fr3: 0.24, mmw: 0.1 }; // AP beam half-width (rad), for the picture only

  var world = M.createWorld();
  var bands = {};
  M.BANDS.forEach(function (b) { bands[b.key] = b; });
  var COMBOS = [
    { id: 'none', ris: false, mra: false }, { id: 'ris', ris: true, mra: false },
    { id: 'mra', ris: false, mra: true }, { id: 'both', ris: true, mra: true }
  ];
  function comboId(ris, mra) { return ris ? (mra ? 'both' : 'ris') : (mra ? 'mra' : 'none'); }
  var configs = [];
  M.BANDS.forEach(function (b) {
    COMBOS.forEach(function (c) { configs.push({ key: b.key + '-' + c.id, band: b, ris: c.ris, mra: c.mra }); });
  });
  var stats = {}, hist = {}, evals = {};
  configs.forEach(function (c) { stats[c.key] = { t: 0, ok: 0, sum: 0 }; hist[c.key] = []; });
  var sel = { band: 'fr3', ris: true, mra: true };
  function selKey() { return sel.band + '-' + comboId(sel.ris, sel.mra); }

  var tileGlow = world.tiles.map(function () { return 0.3; });
  var mraGlow = world.mra.map(function () { return 0.3; });
  var sampleAcc = 0, phase = 0, hoverIdx = null;

  function db2lin(db) { return Math.pow(10, db / 10); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function tick(dt) {
    world.step(dt);
    configs.forEach(function (c) {
      var e = world.evaluate(c.band, c.ris, c.mra);
      evals[c.key] = e;
      var s = stats[c.key];
      s.t += dt; s.sum += e.rate * dt;
      if (e.rate >= TARGET) s.ok += dt;
    });
    sampleAcc += dt;
    while (sampleAcc >= 0.1) {
      sampleAcc -= 0.1;
      configs.forEach(function (c) {
        var h = hist[c.key];
        h.push(evals[c.key].rate);
        if (h.length > HIST_N) h.shift();
      });
    }
    var cur = evals[selKey()];
    phase = (phase + dt * (0.12 + cur.rate / 6)) % 1;
    var ease = Math.min(1, dt * 6);
    world.tiles.forEach(function (tl, i) {
      var target = !sel.ris || tl.blocked ? 0 : world.best.indexOf(i) >= 0 ? 1 : 0.38;
      tileGlow[i] += (target - tileGlow[i]) * ease;
    });
    world.mra.forEach(function (m, i) {
      var target = !sel.mra || m.blocked ? 0 : i === world.bestMra ? 1 : 0.38;
      mraGlow[i] += (target - mraGlow[i]) * ease;
    });
  }

  // ---------- Room drawing ----------
  var dpr = 1, scale = 1, ox = 0, oy = 0;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(wrap.clientWidth * dpr);
    canvas.height = Math.round(wrap.clientHeight * dpr);
    scale = Math.min(canvas.width / W, canvas.height / H);
    ox = (canvas.width - W * scale) / 2;
    oy = (canvas.height - H * scale) / 2;
    if (spark) {
      spark.width = Math.round(spark.clientWidth * dpr);
      spark.height = Math.round(spark.clientHeight * dpr);
    }
  }
  function X(x) { return ox + x * scale; }
  function Y(y) { return oy + y * scale; }
  function S(v) { return v * scale; }

  function label(text, x, y, align, color) {
    ctx.font = '600 ' + Math.max(9, Math.round(S(0.24))) + 'px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = color || 'rgba(148,163,184,.85)';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, X(x), Y(y));
  }
  function line(points, color, width, alpha, dash) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * dpr;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (dash) ctx.setLineDash(dash.map(function (d) { return d * dpr; }));
    else { ctx.shadowColor = color; ctx.shadowBlur = 10 * dpr; }
    ctx.beginPath();
    ctx.moveTo(X(points[0].x), Y(points[0].y));
    for (var k = 1; k < points.length; k++) ctx.lineTo(X(points[k].x), Y(points[k].y));
    ctx.stroke();
    ctx.restore();
  }
  function packets(points, color) {
    var lens = [], total = 0;
    for (var k = 1; k < points.length; k++) {
      var l = Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
      lens.push(l); total += l;
    }
    ctx.fillStyle = color;
    for (var n = 0; n < 4; n++) {
      var s = ((phase + n / 4) % 1) * total;
      for (var m = 0; m < lens.length; m++) {
        if (s <= lens[m]) {
          var f = s / lens[m];
          ctx.beginPath();
          ctx.arc(X(points[m].x + (points[m + 1].x - points[m].x) * f), Y(points[m].y + (points[m + 1].y - points[m].y) * f), 2.2 * dpr, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        s -= lens[m];
      }
    }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }

  var desks = [
    { x: 2.1, y: 3.4, w: 1.5, h: 0.75 }, { x: 4.6, y: 3.4, w: 1.5, h: 0.75 },
    { x: 7.1, y: 3.4, w: 1.5, h: 0.75 }, { x: 4.6, y: 5.5, w: 1.5, h: 0.75 }
  ];

  function drawRoom() {
    var band = bands[sel.band];
    var e = evals[selKey()];
    var u = world.user, q = world.pred;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a1124';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    ctx.lineWidth = 1;
    for (var gx = 1; gx < W; gx++) { ctx.beginPath(); ctx.moveTo(X(gx), Y(WALL)); ctx.lineTo(X(gx), Y(H - WALL)); ctx.stroke(); }
    for (var gy = 1; gy < H; gy++) { ctx.beginPath(); ctx.moveTo(X(WALL), Y(gy)); ctx.lineTo(X(W - WALL), Y(gy)); ctx.stroke(); }

    ctx.fillStyle = 'rgba(148,163,184,.07)';
    ctx.strokeStyle = 'rgba(148,163,184,.14)';
    desks.forEach(function (d) { roundRect(X(d.x), Y(d.y), S(d.w), S(d.h), S(0.08)); ctx.fill(); ctx.stroke(); });

    ctx.strokeStyle = 'rgba(148,163,184,.4)';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(X(WALL), Y(DOOR.y0));
    ctx.lineTo(X(WALL), Y(WALL)); ctx.lineTo(X(W - WALL), Y(WALL));
    ctx.lineTo(X(W - WALL), Y(H - WALL)); ctx.lineTo(X(WALL), Y(H - WALL));
    ctx.lineTo(X(WALL), Y(DOOR.y1));
    ctx.stroke();
    label('door', WALL + 0.12, (DOOR.y0 + DOOR.y1) / 2, 'left', 'rgba(148,163,184,.5)');

    // AP beam footprint: wide at sub-6, a pencil at mmWave
    var ang = Math.atan2(u.y - AP.y, u.x - AP.x), half = CONE[sel.band];
    var reach = S(Math.hypot(u.x - AP.x, u.y - AP.y) + 0.6);
    var g = ctx.createRadialGradient(X(AP.x), Y(AP.y), 0, X(AP.x), Y(AP.y), reach);
    g.addColorStop(0, 'rgba(251,191,36,.22)');
    g.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(X(AP.x), Y(AP.y));
    ctx.arc(X(AP.x), Y(AP.y), reach, ang - half, ang + half);
    ctx.closePath();
    ctx.fill();

    // Contribution of each path to the received signal (sets brightness)
    var total = db2lin(e.snrDb);
    var losShare = db2lin(e.losDb) / total;
    var risShare = e.risDb === null ? 0 : db2lin(e.risDb) / total;
    var mraShare = e.mraDb === null ? 0 : db2lin(e.mraDb) / total;

    // Direct path; a person in the way costs band.block dB
    var losAlpha = clamp((e.losDb + 5) / 30, 0, 1);
    if (world.losBlocker) {
      var b = world.losBlocker;
      var dx = u.x - AP.x, dy = u.y - AP.y, len = Math.hypot(dx, dy);
      var f = clamp((((b.x - AP.x) * dx + (b.y - AP.y) * dy) / len - PERSON_R) / len, 0, 1);
      var hit = { x: AP.x + dx * f, y: AP.y + dy * f };
      line([AP, hit], '#fbbf24', 1.6, 0.55);
      if (losAlpha > 0.04) line([hit, u], '#fbbf24', 1.6, 0.55 * losAlpha);
      var sev = band.block >= 20 ? '#f87171' : band.block >= 10 ? '#fb923c' : '#fbbf24';
      ctx.save();
      ctx.strokeStyle = sev; ctx.lineWidth = 2 * dpr;
      var cx = X(hit.x), cy = Y(hit.y), k = 4 * dpr;
      ctx.beginPath(); ctx.moveTo(cx - k, cy - k); ctx.lineTo(cx + k, cy + k); ctx.moveTo(cx + k, cy - k); ctx.lineTo(cx - k, cy + k); ctx.stroke();
      ctx.restore();
      label('−' + band.block * world.losCount + ' dB', hit.x + 0.22, hit.y - 0.28, 'left', sev);
    } else {
      line([AP, u], '#fbbf24', 1.6, 0.55);
    }

    var paths = [{ share: losShare, pts: [AP, u], color: '#fde68a' }];
    if (sel.ris) {
      world.best.forEach(function (idx, rank) {
        var tl = world.tiles[idx];
        var pts = [AP, { x: tl.x, y: tl.y + 0.12 }, u];
        line(pts, '#2dd4bf', rank === 0 ? 2.2 : 1.2, (rank === 0 ? 0.25 : 0.12) + (rank === 0 ? 0.65 : 0.25) * Math.sqrt(risShare));
        if (rank === 0) paths.push({ share: risShare, pts: pts, color: '#ccfbf1' });
      });
      if (world.best.length) {
        var top = world.tiles[world.best[0]];
        line([{ x: top.x, y: top.y + 0.12 }, q], 'rgba(45,212,191,.45)', 1.2, 1, [3, 5]);
      }
    }
    if (sel.mra) {
      if (world.bestMra !== null) {
        var m = world.mra[world.bestMra];
        var mp = [AP, { x: m.x - 0.1, y: m.y }, u];
        line(mp, '#a78bfa', 1.6, 0.2 + 0.6 * Math.sqrt(mraShare));
        paths.push({ share: mraShare, pts: mp, color: '#ede9fe' });
      }
    }
    // Data packets flow along the strongest path, faster when the rate is higher
    paths.sort(function (a, c) { return c.share - a.share; });
    if (e.rate >= TARGET / 4 && paths[0].share > 0.05) packets(paths[0].pts, paths[0].color);

    // RIS tiles
    var tw = 7.5 / (world.NT - 1) * 0.78;
    world.tiles.forEach(function (tl, i) {
      var x = X(tl.x - tw / 2), y = Y(tl.y - 0.07), w = S(tw), h = S(0.2);
      if (!sel.ris) {
        ctx.strokeStyle = 'rgba(148,163,184,.35)'; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      } else if (tl.blocked) {
        ctx.fillStyle = '#1b2438';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(148,163,184,.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + w - 2, y + h - 2); ctx.stroke();
      } else {
        ctx.save();
        ctx.shadowColor = '#2dd4bf';
        ctx.shadowBlur = 14 * dpr * tileGlow[i];
        ctx.fillStyle = 'rgba(45,212,191,' + (0.25 + 0.75 * tileGlow[i]).toFixed(3) + ')';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
      }
    });
    label(sel.ris ? 'RIS tiles' : 'RIS tiles · off', 1.08, WALL + 0.52, 'left', sel.ris ? 'rgba(94,234,212,.85)' : 'rgba(148,163,184,.7)');

    // MRA slats
    world.mra.forEach(function (m, i) {
      ctx.save();
      ctx.translate(X(m.x), Y(m.y));
      ctx.rotate(-0.5);
      if (!sel.mra) ctx.fillStyle = 'rgba(148,163,184,.3)';
      else if (m.blocked) ctx.fillStyle = '#2a2f45';
      else {
        ctx.shadowColor = '#a78bfa';
        ctx.shadowBlur = 12 * dpr * mraGlow[i];
        ctx.fillStyle = 'rgba(167,139,250,' + (0.3 + 0.7 * mraGlow[i]).toFixed(3) + ')';
      }
      ctx.fillRect(-S(0.05), -S(0.28), S(0.1), S(0.56));
      ctx.restore();
    });
    label(sel.mra ? 'MRA' : 'MRA · off', W - WALL - 0.42, 1.45, 'right', sel.mra ? 'rgba(196,181,253,.85)' : 'rgba(148,163,184,.7)');

    // People
    world.people.forEach(function (p) {
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), S(PERSON_R * 0.72), 0, Math.PI * 2);
      ctx.fillStyle = '#475569'; ctx.fill();
      ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = 'rgba(203,213,225,.35)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), S(0.12), 0, Math.PI * 2);
      ctx.fillStyle = '#94a3b8'; ctx.fill();
    });

    if (sel.ris) {
      ctx.save();
      ctx.setLineDash([3 * dpr, 4 * dpr]);
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), S(0.2), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      label('t+Δ', q.x, q.y - 0.4, 'center', 'rgba(255,255,255,.55)');
    }

    // User: ring shows whether the 2 Gbps target is met right now
    var met = e.rate >= TARGET;
    var pulse = reduceMotion ? 0.5 : (Math.sin(world.t * 3) + 1) / 2;
    ctx.beginPath(); ctx.arc(X(u.x), Y(u.y), S(0.2 + 0.12 * pulse), 0, Math.PI * 2);
    ctx.fillStyle = met ? 'rgba(45,212,191,' + (0.25 - 0.15 * pulse).toFixed(3) + ')' : 'rgba(248,113,113,' + (0.3 - 0.15 * pulse).toFixed(3) + ')';
    ctx.fill();
    ctx.beginPath(); ctx.arc(X(u.x), Y(u.y), S(0.14), 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    label('user', u.x, u.y + 0.46, 'center', '#e2e8f0');

    ctx.save();
    ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 12 * dpr;
    ctx.fillStyle = '#fbbf24';
    roundRect(X(AP.x - 0.17), Y(AP.y - 0.17), S(0.34), S(0.34), S(0.07));
    ctx.fill();
    ctx.restore();
    label('AP · ' + band.carrier, AP.x + 0.32, AP.y + 0.3, 'left', '#fde68a');

    var occ = world.occupancy();
    label('occupancy ' + occ + ' · ' + (occ <= 2 ? 'low' : occ <= 4 ? 'medium' : 'high'), W - WALL - 0.2, H - WALL - 0.28, 'right', 'rgba(148,163,184,.75)');
  }

  // ---------- Sparkline: throughput of the selected option, last 20 s ----------
  function drawSpark() {
    if (!sctx) return;
    var w = spark.width, h = spark.height, padT = 14 * dpr, padB = 4 * dpr;
    var data = hist[selKey()];
    var color = SERIES_COLOR;
    sctx.clearRect(0, 0, w, h);
    function yv(v) { return padT + (h - padT - padB) * (1 - Math.min(v, YMAX) / YMAX); }
    function xi(i) { return w - (data.length - 1 - i) * (w / (HIST_N - 1)); }

    sctx.strokeStyle = 'rgba(148,163,184,.2)';
    sctx.lineWidth = 1;
    sctx.beginPath(); sctx.moveTo(0, yv(0) + 0.5); sctx.lineTo(w, yv(0) + 0.5); sctx.stroke();

    sctx.save();
    sctx.setLineDash([4 * dpr, 4 * dpr]);
    sctx.strokeStyle = 'rgba(203,213,225,.55)';
    sctx.beginPath(); sctx.moveTo(0, yv(TARGET)); sctx.lineTo(w, yv(TARGET)); sctx.stroke();
    sctx.restore();
    sctx.font = '500 ' + Math.round(10 * dpr) + 'px "JetBrains Mono", ui-monospace, monospace';
    sctx.fillStyle = 'rgba(203,213,225,.75)';
    sctx.textBaseline = 'top';
    sctx.textAlign = 'left';
    sctx.fillText(TARGET + ' Gbps target', 2 * dpr, yv(TARGET) + 3 * dpr);
    sctx.textBaseline = 'bottom';
    sctx.textAlign = 'right';
    sctx.fillText(YMAX + ' Gbps', w - 2 * dpr, 12 * dpr);

    if (data.length > 1) {
      sctx.strokeStyle = color;
      sctx.lineWidth = 2 * dpr;
      sctx.lineJoin = 'round';
      sctx.beginPath();
      for (var i = 0; i < data.length; i++) {
        var px = xi(i), py = yv(data[i]);
        if (i === 0) sctx.moveTo(px, py); else sctx.lineTo(px, py);
      }
      sctx.stroke();
    }

    if (hoverIdx !== null && data.length) {
      var idx = clamp(Math.round(hoverIdx), 0, data.length - 1);
      var hx = xi(idx), hy = yv(data[idx]);
      sctx.strokeStyle = 'rgba(226,232,240,.5)';
      sctx.lineWidth = 1;
      sctx.beginPath(); sctx.moveTo(hx, padT - 4 * dpr); sctx.lineTo(hx, h); sctx.stroke();
      sctx.fillStyle = color;
      sctx.strokeStyle = '#0d1426';
      sctx.lineWidth = 2 * dpr;
      sctx.beginPath(); sctx.arc(hx, hy, 4 * dpr, 0, Math.PI * 2); sctx.fill(); sctx.stroke();
      var ago = ((data.length - 1 - idx) / 10).toFixed(1);
      var txt = data[idx].toFixed(1) + ' Gbps · ' + ago + ' s ago';
      sctx.font = '600 ' + Math.round(11 * dpr) + 'px Inter, system-ui, sans-serif';
      var tw = sctx.measureText(txt).width + 12 * dpr;
      var tx = clamp(hx - tw / 2, 0, w - tw);
      sctx.fillStyle = 'rgba(15,23,42,.92)';
      sctx.fillRect(tx, 0, tw, 15 * dpr);
      sctx.fillStyle = '#f1f5f9';
      sctx.textAlign = 'left';
      sctx.textBaseline = 'middle';
      sctx.fillText(txt, tx + 6 * dpr, 7.5 * dpr);
    }
  }
  if (spark) {
    spark.addEventListener('pointermove', function (ev) {
      var data = hist[selKey()];
      var rect = spark.getBoundingClientRect();
      var fromRight = (rect.right - ev.clientX) / rect.width * (HIST_N - 1);
      var idx = data.length - 1 - fromRight;
      hoverIdx = idx < 0 ? null : idx;
      if (reduceMotion) drawSpark();
    });
    spark.addEventListener('pointerleave', function () { hoverIdx = null; if (reduceMotion) drawSpark(); });
  }

  // ---------- Readouts and comparison table ----------
  var el = {
    rate: document.querySelector('[data-sim="rate"]'),
    config: document.querySelector('[data-sim="config"]'),
    elapsed: document.querySelector('[data-sim="elapsed"]'),
    cells: Array.prototype.slice.call(document.querySelectorAll('[data-sim-cell]'))
  };
  var lastUi = -1;
  function updateUi(force) {
    if (!force && world.t - lastUi < 0.25) return;
    lastUi = world.t;
    var e = evals[selKey()];
    var band = bands[sel.band];
    if (el.rate) el.rate.textContent = e.rate >= 1 ? e.rate.toFixed(1) : e.rate.toFixed(2);
    if (el.config) el.config.textContent = band.label + ' (' + band.carrier + ') · RIS ' + (sel.ris ? 'on' : 'off') + ' · MRA ' + (sel.mra ? 'on' : 'off') + ' · ' + (e.rate >= TARGET ? 'meets' : 'below') + ' target';
    var t = stats[configs[0].key].t;
    if (el.elapsed) el.elapsed.textContent = Math.floor(t / 60) + ':' + ('0' + Math.floor(t % 60)).slice(-2);
    el.cells.forEach(function (cell) {
      var s = stats[cell.getAttribute('data-sim-cell')];
      if (!s || !s.t) return;
      var pct = s.ok / s.t;
      cell.querySelector('.fill').style.width = (pct * 100).toFixed(1) + '%';
      cell.querySelector('.pct').textContent = Math.round(pct * 100) + '%';
      var avg = (s.sum / s.t).toFixed(1);
      cell.querySelector('.avg').textContent = avg + ' Gbps';
      cell.title = cell.querySelector('.sr-only').textContent.replace(/: $/, '') + ': ' + Math.round(pct * 100) + '% of the time at ≥ ' + TARGET + ' Gbps, ' + avg + ' Gbps on average';
    });
  }

  function check(name, value) {
    var r = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (r) r.checked = true;
  }
  function select(band, ris, mra) {
    sel.band = band; sel.ris = ris; sel.mra = mra;
    check('sim-band', band);
    check('sim-ris', ris ? 'on' : 'off');
    check('sim-mra', mra ? 'on' : 'off');
    el.cells.forEach(function (cell) {
      cell.setAttribute('aria-pressed', String(cell.getAttribute('data-sim-cell') === selKey()));
    });
    drawRoom(); drawSpark();
    updateUi(true);
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="sim-band"]'), function (inp) {
    inp.addEventListener('change', function () { if (inp.checked) select(inp.value, sel.ris, sel.mra); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="sim-ris"]'), function (inp) {
    inp.addEventListener('change', function () { if (inp.checked) select(sel.band, inp.value === 'on', sel.mra); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="sim-mra"]'), function (inp) {
    inp.addEventListener('change', function () { if (inp.checked) select(sel.band, sel.ris, inp.value === 'on'); });
  });
  el.cells.forEach(function (cell) {
    cell.addEventListener('click', function () {
      var k = cell.getAttribute('data-sim-cell').split('-');
      select(k[0], k[1] === 'ris' || k[1] === 'both', k[1] === 'mra' || k[1] === 'both');
    });
  });

  // ---------- Run ----------
  resize();
  function redraw() { resize(); drawRoom(); drawSpark(); }
  if (window.ResizeObserver) new ResizeObserver(redraw).observe(wrap);
  else window.addEventListener('resize', redraw);

  // Warm up: two simulated minutes so the chart and table start out meaningful
  for (var s = 0; s < 2400; s++) tick(0.05);
  select(sel.band, sel.ris, sel.mra);

  if (reduceMotion) {
    drawRoom(); drawSpark();
    return;
  }

  var running = true, onScreen = true, last = null;
  function frame(now) {
    if (!running) { last = null; return; }
    if (last === null) last = now;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt);
    drawRoom();
    drawSpark();
    updateUi(false);
    requestAnimationFrame(frame);
  }
  function setRunning(v) {
    var was = running;
    running = v;
    if (v && !was) requestAnimationFrame(frame);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
      setRunning(onScreen && !document.hidden);
    }).observe(canvas);
  }
  document.addEventListener('visibilitychange', function () { setRunning(onScreen && !document.hidden); });
  requestAnimationFrame(frame);
})();
