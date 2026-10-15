// Illustrative link model behind the home-page animation.
//
// A room with an access point (AP), RIS tiles on the top wall, a metallic
// reflector array (MRA) on the right wall, a moving user, and people who walk
// in and out. For each band it combines a direct path (attenuated by people in
// the way), a weak diffuse/NLoS floor, and, when surfaces are on, the best
// unshadowed RIS tiles and MRA slat. Shadowed elements are excluded.
//
// The numbers are rough, textbook-style trends chosen to show the trade-offs
// (sub-6: robust but narrow; mmWave: wide but fragile; FR3 in between). They are
// not measurements or a validated channel model.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PWEModel = api;
})(this, function () {
  var W = 10, H = 7.4, WALL = 0.16;
  var DOOR = { y0: 1.55, y1: 2.65 };
  var AP = { x: 0.85, y: 6.55 };
  var PERSON_R = 0.34;
  var TARGET_GBPS = 1;
  var SE_MAX = 7.5;   // bps/Hz ceiling (~30 dB SNR)
  var ETA = 0.75;     // implementation efficiency

  // s1m: SNR at 1 m after antenna gains (dB); block: loss per person in the way (dB);
  // nlos: diffuse floor relative to the unblocked direct path (dB);
  // ris / mra: extra loss of a surface-assisted path relative to free space (dB).
  var BANDS = [
    { key: 'sub6', label: 'Sub-6 GHz', short: 'Sub-6', carrier: '3.5 GHz', bw: 0.1, s1m: 46, block: 4,  nlos: -12, ris: -16, mra: -12 },
    { key: 'fr3',  label: 'FR3',       short: 'FR3',   carrier: '15 GHz',  bw: 0.6, s1m: 44, block: 16, nlos: -22, ris: -6,  mra: -7 },
    { key: 'mmw',  label: 'mmWave',    short: 'mmWave', carrier: '28 GHz', bw: 1.0, s1m: 41, block: 28, nlos: -32, ris: -6,  mra: -8 }
  ];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function db2lin(db) { return Math.pow(10, db / 10); }
  function lin2db(x) { return 10 * Math.log10(x); }
  function hyp(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function segDist(ax, ay, bx, by, px, py) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(ax + t * dx - px, ay + t * dy - py);
  }

  function createWorld(seed) {
    var rand = mulberry32(seed || 20261001);
    function r(a, b) { return a + rand() * (b - a); }

    var tiles = [], NT = 18;
    for (var i = 0; i < NT; i++) tiles.push({ x: 1.25 + i * (7.5 / (NT - 1)), y: WALL + 0.1, blocked: false });
    var mra = [];
    for (var j = 0; j < 5; j++) mra.push({ x: W - WALL - 0.1, y: 2.0 + j * 0.78, blocked: false });

    function newTarget(p) { p.tx = r(1.2, 8.8); p.ty = r(1.3, 6.5); }
    function makePerson(x, y, entering) {
      var p = { x: x, y: y, tx: x, ty: y, speed: r(0.45, 0.7), pause: 0, state: entering ? 'entering' : 'in' };
      if (entering) { p.tx = 1.4; p.ty = (DOOR.y0 + DOOR.y1) / 2; } else newTarget(p);
      return p;
    }
    var people = [makePerson(3.2, 2.2), makePerson(6.4, 4.8), makePerson(8.2, 2.6)];
    var occTimer = r(6, 10);
    var LOOKAHEAD = 1.1;

    var world = {
      t: 0, tiles: tiles, mra: mra, people: people, NT: NT,
      user: userPos(0), pred: userPos(LOOKAHEAD), best: [], bestMra: null, losBlocker: null, active: 0
    };

    function userPos(t) {
      return {
        x: 5 + 3.1 * Math.sin(t * 0.21) + 0.6 * Math.sin(t * 0.57),
        y: 4.25 + 1.75 * Math.sin(t * 0.29 + 1.2) + 0.35 * Math.cos(t * 0.71)
      };
    }
    function blockers(a, b) {
      var n = 0, first = null;
      for (var k = 0; k < people.length; k++) {
        if (segDist(a.x, a.y, b.x, b.y, people[k].x, people[k].y) < PERSON_R) { n++; if (!first) first = people[k]; }
      }
      return { n: n, first: first };
    }

    world.occupancy = function () {
      return people.filter(function (p) { return p.state !== 'leaving'; }).length + 1;
    };

    world.step = function (dt) {
      world.t += dt;
      occTimer -= dt;
      if (occTimer <= 0) {
        occTimer = r(7, 12);
        var inside = people.filter(function (p) { return p.state !== 'leaving'; });
        var add = inside.length <= 1 ? true : inside.length >= 4 ? false : rand() < 0.5;
        if (add) people.push(makePerson(-0.3, (DOOR.y0 + DOOR.y1) / 2, true));
        else {
          var p = inside[Math.floor(rand() * inside.length)];
          p.state = 'leaving'; p.tx = -0.4; p.ty = (DOOR.y0 + DOOR.y1) / 2; p.pause = 0;
        }
      }
      for (var k = people.length - 1; k >= 0; k--) {
        var q = people[k];
        if (q.pause > 0) { q.pause -= dt; continue; }
        var dx = q.tx - q.x, dy = q.ty - q.y, d = Math.hypot(dx, dy), mv = q.speed * dt;
        if (d <= mv) {
          q.x = q.tx; q.y = q.ty;
          if (q.state === 'leaving') { people.splice(k, 1); continue; }
          if (q.state === 'entering') q.state = 'in';
          q.pause = r(0.4, 2.2); newTarget(q);
        } else { q.x += dx / d * mv; q.y += dy / d * mv; }
      }

      var u = world.user = userPos(world.t);
      var pr = world.pred = userPos(world.t + LOOKAHEAD);
      var cand = [];
      world.active = 0;
      tiles.forEach(function (tl, idx) {
        tl.blocked = blockers(AP, tl).n > 0 || blockers(tl, u).n > 0;
        tl.d = hyp(AP, tl) + hyp(tl, u);
        if (!tl.blocked) {
          world.active++;
          // Rank toward the predicted position: beams are steered ahead of the user
          cand.push({ i: idx, d: hyp(AP, tl) + hyp(tl, pr) });
        }
      });
      cand.sort(function (a, b) { return a.d - b.d; });
      world.best = cand.slice(0, 3).map(function (c) { return c.i; });

      world.bestMra = null;
      var bestD = Infinity;
      mra.forEach(function (m, idx) {
        m.blocked = blockers(AP, m).n > 0 || blockers(m, u).n > 0;
        m.d = hyp(AP, m) + hyp(m, u);
        if (!m.blocked && m.d < bestD) { bestD = m.d; world.bestMra = idx; }
      });
      var los = blockers(AP, u);
      world.losCount = los.n;
      world.losBlocker = los.first;
    };

    // Link quality for one band, with the RIS and/or the MRA switched on
    world.evaluate = function (band, risOn, mraOn) {
      var u = world.user;
      var base = band.s1m - 20 * Math.log10(Math.max(1, hyp(AP, u)));
      var losDb = base - world.losCount * band.block;
      var lin = db2lin(losDb) + db2lin(base + band.nlos);
      var risDb = null, mraDb = null;
      if (risOn) {
        var ds = [];
        tiles.forEach(function (tl) { if (!tl.blocked) ds.push(tl.d); });
        ds.sort(function (a, b) { return a - b; });
        if (ds.length) {
          var k = Math.min(3, ds.length);
          risDb = band.s1m - 20 * Math.log10(ds[0]) + band.ris + 10 * Math.log10(k);
          lin += db2lin(risDb);
        }
      }
      if (mraOn) {
        if (world.bestMra !== null) {
          mraDb = band.s1m - 20 * Math.log10(mra[world.bestMra].d) + band.mra;
          lin += db2lin(mraDb);
        }
      }
      var se = Math.min(SE_MAX, ETA * Math.log2(1 + lin));
      return { snrDb: lin2db(lin), rate: band.bw * se, losDb: losDb, risDb: risDb, mraDb: mraDb };
    };

    return world;
  }

  return {
    W: W, H: H, WALL: WALL, DOOR: DOOR, AP: AP, PERSON_R: PERSON_R,
    TARGET_GBPS: TARGET_GBPS, BANDS: BANDS, createWorld: createWorld
  };
});
