// Illustrative link model behind the home-page animation.
//
// Two scenes share one world size (10 x 7.4 m, top view):
//
// - indoor: a room with an access point (AP), RIS tiles on the top wall, a
//   metallic reflector arrays (MRA) on the right wall, a moving user, and people
//   who walk in and out.
// - o2i (outdoor-to-indoor): a base station (BS) across a street with pedestrians
//   and passing cars; a building facade with two windows and concrete piers;
//   a transmissive RIS on the windows ("smart window"); MRAs on two inside walls;
//   and a user inside with people coming and going.
// - outdoor: a street with buildings on both sides, a base station on a lamp
//   post, cars and buses in both lanes, pedestrians, and trees; a RIS and an MRA
//   on the facade across the street. FORMULA3 focuses on
//   indoor and O2I; this scene is for comparison.
//
// For each band the link combines a direct path (attenuated by people, cars, and
// the facade), a weak diffuse floor, and, when switched on, the best unshadowed
// RIS tiles and the MRA panels. Shadowed elements are excluded.
//
// An MRA panel is a grid of hexagonal metal tiles, each tilted by its own motor.
// Seen from above, each column of tiles is a small mirror. Every tile turns so
// its reflection lands on the user, so the panel acts like one large focusing
// dish (the idea behind a segmented telescope mirror).
//
// The numbers are rough, textbook-style trends chosen to show the trade-offs
// (sub-7: robust but narrow; mmWave: wide but fragile; FR3 in between). Facade
// losses follow the 3GPP TR 38.901 material models (standard glass 2 + 0.2 f dB,
// concrete 5 + 4 f dB, f in GHz). This is not a measurement or a validated
// channel model.
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
  // ris / mra: extra loss of a surface-assisted path relative to free space (dB);
  // ghz: carrier, used for the 3GPP facade losses.
  var BANDS = [
    { key: 'sub6', label: 'Sub-7 GHz', short: 'Sub-7', carrier: '3.5 GHz', ghz: 3.5, bw: 0.1, s1m: 46, block: 4,  nlos: -12, ris: -16, mra: -12 },
    { key: 'fr3',  label: 'FR3',       short: 'FR3',   carrier: '15 GHz',  ghz: 15,  bw: 0.6, s1m: 44, block: 16, nlos: -22, ris: -6,  mra: -7 },
    { key: 'mmw',  label: 'mmWave',    short: 'mmWave', carrier: '28 GHz', ghz: 28,  bw: 1.0, s1m: 41, block: 28, nlos: -32, ris: -6,  mra: -8 }
  ];
  var FOLIAGE = { sub6: 4, fr3: 10, mmw: 18 };   // dB through one tree (illustrative)
  BANDS.forEach(function (b) {
    b.glass = 2 + 0.2 * b.ghz;     // 3GPP TR 38.901, standard multi-pane glass
    b.concrete = 5 + 4 * b.ghz;    // 3GPP TR 38.901, concrete
    b.foliage = FOLIAGE[b.key];
  });

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
  function hitsVehicle(a, b, c) {
    var half = Math.max(0, c.len / 2 - c.wid / 2);
    for (var s = -1; s <= 1; s++) {
      var px = c.horiz ? c.x + s * half : c.x, py = c.horiz ? c.y : c.y + s * half;
      if (segDist(a.x, a.y, b.x, b.y, px, py) < c.wid / 2 + 0.05) return true;
    }
    return false;
  }
  function rateFrom(band, lin) {
    return band.bw * Math.min(SE_MAX, ETA * Math.log2(1 + lin));
  }

  // ---------------------------------------------------------------- MRA panels
  var TILE_TURN = 35 * Math.PI / 180;   // how far a tile can turn from facing straight out
  var MRA_TILES = 7;                    // tile columns per panel, as seen from above
  var MRA_OFF = 0.08;                   // tiles stand slightly off the wall
  // A panel along the wall from (x0, y0) to (x1, y1); (nx, ny) points into the room
  function mraPanel(x0, y0, x1, y1, nx, ny) {
    var tiles = [];
    for (var i = 0; i < MRA_TILES; i++) {
      var f = (i + 0.5) / MRA_TILES;
      tiles.push({ x: x0 + (x1 - x0) * f + nx * MRA_OFF, y: y0 + (y1 - y0) * f + ny * MRA_OFF,
        ang: 0, reach: true, blocked: false, cross: null });
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1, nx: nx, ny: ny,
      cx: (x0 + x1) / 2 + nx * MRA_OFF, cy: (y0 + y1) / 2 + ny * MRA_OFF, tiles: tiles, d: 0, live: 0 };
  }
  // Turn every tile toward the user. Law of reflection: the tile faces halfway
  // between the source and the user. A tile helps only if it can turn that far
  // and both of its legs (source to tile, tile to user) are clear.
  function steerPanel(pn, src, u, blocked, cross) {
    var c = { x: pn.cx, y: pn.cy };
    pn.d = hyp(src, c) + hyp(c, u);
    pn.live = 0;
    pn.tiles.forEach(function (t) {
      var ax = src.x - t.x, ay = src.y - t.y, la = Math.hypot(ax, ay);
      var bx = u.x - t.x, by = u.y - t.y, lb = Math.hypot(bx, by);
      var mx = ax / la + bx / lb, my = ay / la + by / lb;
      var ideal = Math.atan2(pn.nx * my - pn.ny * mx, pn.nx * mx + pn.ny * my);
      t.reach = Math.abs(ideal) <= TILE_TURN;
      t.ang = Math.max(-TILE_TURN, Math.min(TILE_TURN, ideal));
      t.blocked = blocked(src, t) || blocked(t, u);
      t.cross = cross ? cross(src, t) : null;
      if (t.reach && !t.blocked) pn.live++;
    });
  }
  // The working tiles add up in phase at the user, so a panel's gain scales
  // with the square of the share of tiles that work. Panels add up in power.
  function mraLink(panels, band, loss) {
    var lin = 0;
    var parts = panels.map(function (pn) {
      var amp = 0;
      pn.tiles.forEach(function (t) {
        if (t.reach && !t.blocked) amp += loss ? Math.pow(10, -loss(t, band) / 20) : 1;
      });
      if (amp <= 0) return null;
      var db = band.s1m - 20 * Math.log10(pn.d) + band.mra + 20 * Math.log10(amp / pn.tiles.length);
      lin += db2lin(db);
      return db;
    });
    return { db: lin > 0 ? lin2db(lin) : null, lin: lin, parts: parts };
  }

  // ---------------------------------------------------------------- indoor
  function createWorld(seed) {
    var rand = mulberry32(seed || 20261001);
    function r(a, b) { return a + rand() * (b - a); }

    var tiles = [], NT = 18;
    for (var i = 0; i < NT; i++) {
      var tx = 1.25 + i * (7.5 / (NT - 1));
      tiles.push({ x: tx, y: WALL + 0.1, ax: tx, ay: WALL + 0.22, blocked: false });
    }
    // Two MRA panels on the right wall
    var mra = [mraPanel(W - WALL, 2.7, W - WALL, 4.2, -1, 0), mraPanel(W - WALL, 5.2, W - WALL, 6.7, -1, 0)];

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
      scene: 'indoor', ap: AP, apLabel: 'AP',
      t: 0, tiles: tiles, mra: mra, people: people, NT: NT, cars: [], walkers: [],
      tileOrient: 'h',
      user: userPos(0), pred: userPos(LOOKAHEAD), best: [], losBlocker: null, active: 0
    };

    function userPos(t) {
      return {
        x: 5 + 3.1 * Math.sin(t * 0.21) + 0.6 * Math.sin(t * 0.57),
        y: 4.25 + 1.75 * Math.sin(t * 0.29 + 1.2) + 0.35 * Math.cos(t * 0.71)
      };
    }
    function blockers(a, b) {
      var n = 0, first = null, all = [];
      for (var k = 0; k < people.length; k++) {
        if (segDist(a.x, a.y, b.x, b.y, people[k].x, people[k].y) < PERSON_R) { n++; all.push(people[k]); if (!first) first = people[k]; }
      }
      return { n: n, first: first, all: all };
    }

    world.occupancy = function () {
      return people.filter(function (p) { return p.state !== 'leaving'; }).length + 1;
    };
    world.status = function () {
      var o = world.occupancy();
      return 'occupancy ' + o + ' · ' + (o <= 2 ? 'low' : o <= 4 ? 'medium' : 'high');
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

      mra.forEach(function (pn) { steerPanel(pn, AP, u, function (a, b) { return blockers(a, b).n > 0; }); });
      var los = blockers(AP, u);
      world.losCount = los.n;
      world.losBlocker = los.first;
      world.losAll = los.all;
    };

    // Link quality for one band, with the RIS and/or the MRA switched on
    world.evaluate = function (band, risOn, mraOn) {
      var u = world.user;
      var base = band.s1m - 20 * Math.log10(Math.max(1, hyp(AP, u)));
      var blockDb = world.losCount * band.block;
      var losDb = base - blockDb;
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
      var mraParts = null;
      if (mraOn) {
        var ml = mraLink(mra, band);
        mraDb = ml.db; mraParts = ml.parts; lin += ml.lin;
      }
      return { snrDb: lin2db(lin), rate: rateFrom(band, lin), losDb: losDb, blockDb: blockDb, facadeDb: 0, risDb: risDb, mraDb: mraDb, mraParts: mraParts };
    };

    return world;
  }

  // ---------------------------------------------------------------- outdoor-to-indoor
  var FX = 3.4;                                  // facade line (x)
  var WINDOWS = [[0.7, 3.2], [4.1, 6.7]];        // window spans along the facade (y)
  var BS = { x: 0.55, y: 3.65 };
  var DOOR_O2I = { y0: 5.3, y1: 6.4 };           // door on the right wall
  var LANE_X = 1.75;                             // street lane centre
  var CAR = { w: 0.62, h: 1.35 };
  var CAR_FACTOR = 1.5;                          // a car blocks more than a person

  function facadeAt(a, b) {
    if ((a.x - FX) * (b.x - FX) >= 0) return null;  // path does not cross the facade
    var f = (FX - a.x) / (b.x - a.x);
    var y = a.y + f * (b.y - a.y);
    var glass = WINDOWS.some(function (w) { return y >= w[0] && y <= w[1]; });
    return { x: FX, y: y, glass: glass };
  }

  function createO2IWorld(seed) {
    var rand = mulberry32(seed || 20261101);
    function r(a, b) { return a + rand() * (b - a); }

    var tiles = [];
    WINDOWS.forEach(function (w) {
      for (var i = 0; i < 6; i++) {
        var ty = w[0] + (i + 0.5) * (w[1] - w[0]) / 6;
        tiles.push({ x: FX, y: ty, ax: FX, ay: ty, blocked: false });
      }
    });
    // Two MRA panels inside, on the top and bottom walls, lit through the windows
    var mra = [mraPanel(5.2, WALL, 6.7, WALL, 0, 1), mraPanel(6.7, H - WALL, 5.2, H - WALL, 0, -1)];

    var doorMid = (DOOR_O2I.y0 + DOOR_O2I.y1) / 2;
    function newTarget(p) { p.tx = r(4.3, 9.2); p.ty = r(1.0, 6.6); }
    function makePerson(x, y, entering) {
      var p = { x: x, y: y, tx: x, ty: y, speed: r(0.45, 0.7), pause: 0, state: entering ? 'entering' : 'in' };
      if (entering) { p.tx = 8.9; p.ty = doorMid; } else newTarget(p);
      return p;
    }
    var people = [makePerson(5.2, 2.4), makePerson(7.8, 5.0)];
    var walkers = [
      { x: 2.7, y: r(0.5, 3.5), vy: r(0.5, 0.75) },
      { x: 3.0, y: r(3.8, 6.9), vy: -r(0.5, 0.75) }
    ];
    var cars = [];
    var carTimer = r(3, 6);
    var occTimer = r(6, 10);
    var LOOKAHEAD = 1.1;

    function userPos(t) {
      return {
        x: 6.9 + 1.9 * Math.sin(t * 0.23) + 0.4 * Math.sin(t * 0.61),
        y: 3.7 + 2.3 * Math.sin(t * 0.3 + 1.0) + 0.3 * Math.cos(t * 0.7)
      };
    }

    var world = {
      scene: 'o2i', ap: BS, apLabel: 'BS', fx: FX, windows: WINDOWS, door: DOOR_O2I, laneX: LANE_X, car: CAR,
      t: 0, tiles: tiles, mra: mra, people: people, walkers: walkers, cars: cars, NT: tiles.length,
      tileOrient: 'v',
      user: userPos(0), pred: userPos(LOOKAHEAD), best: [], losBlocker: null, active: 0
    };

    // People and walkers count as one blocker each; a car counts CAR_FACTOR times
    function blockers(a, b) {
      var n = 0, first = null, all = [], k;
      for (k = 0; k < people.length; k++) {
        if (segDist(a.x, a.y, b.x, b.y, people[k].x, people[k].y) < PERSON_R) { n++; all.push(people[k]); if (!first) first = people[k]; }
      }
      for (k = 0; k < walkers.length; k++) {
        if (segDist(a.x, a.y, b.x, b.y, walkers[k].x, walkers[k].y) < PERSON_R) { n++; all.push(walkers[k]); if (!first) first = walkers[k]; }
      }
      for (k = 0; k < cars.length; k++) {
        if (hitsVehicle(a, b, cars[k])) { n += cars[k].factor; all.push(cars[k]); if (!first) first = cars[k]; }
      }
      return { n: n, first: first, all: all };
    }

    world.occupancy = function () {
      return people.filter(function (p) { return p.state !== 'leaving'; }).length + 1;
    };
    world.status = function () {
      var o = world.occupancy();
      return 'occupancy ' + o + ' · ' + (o <= 2 ? 'low' : o <= 4 ? 'medium' : 'high');
    };

    world.step = function (dt) {
      world.t += dt;
      occTimer -= dt;
      if (occTimer <= 0) {
        occTimer = r(7, 12);
        var inside = people.filter(function (p) { return p.state !== 'leaving'; });
        var add = inside.length <= 0 ? true : inside.length >= 3 ? false : rand() < 0.5;
        if (add) people.push(makePerson(W + 0.3, doorMid, true));
        else {
          var p = inside[Math.floor(rand() * inside.length)];
          p.state = 'leaving'; p.tx = W + 0.4; p.ty = doorMid; p.pause = 0;
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
      walkers.forEach(function (wk) {
        wk.y += wk.vy * dt;
        if (wk.y > H + 0.5) wk.y = -0.5;
        if (wk.y < -0.5) wk.y = H + 0.5;
      });
      carTimer -= dt;
      if (carTimer <= 0) {
        var dir = rand() < 0.5 ? 1 : -1;
        cars.push({ x: LANE_X + (dir > 0 ? -0.28 : 0.28), y: dir > 0 ? -1.2 : H + 1.2, vy: dir * r(2.2, 3.0), len: CAR.h, wid: CAR.w, horiz: false, factor: CAR_FACTOR });
        carTimer = r(9, 15);
        world.carEvent = true;
      }
      for (var c = cars.length - 1; c >= 0; c--) {
        cars[c].y += cars[c].vy * dt;
        if (cars[c].y < -1.5 || cars[c].y > H + 1.5) cars.splice(c, 1);
      }

      var u = world.user = userPos(world.t);
      var pr = world.pred = userPos(world.t + LOOKAHEAD);
      var cand = [];
      world.active = 0;
      tiles.forEach(function (tl, idx) {
        tl.blocked = blockers(BS, tl).n > 0 || blockers(tl, u).n > 0;
        tl.d = hyp(BS, tl) + hyp(tl, u);
        if (!tl.blocked) {
          world.active++;
          cand.push({ i: idx, d: hyp(BS, tl) + hyp(tl, pr) });
        }
      });
      cand.sort(function (a, b) { return a.d - b.d; });
      world.best = cand.slice(0, 3).map(function (cc) { return cc.i; });

      mra.forEach(function (pn) { steerPanel(pn, BS, u, function (a, b) { return blockers(a, b).n > 0; }, facadeAt); });
      var los = blockers(BS, u);
      world.losCount = los.n;
      world.losBlocker = los.first;
      world.losAll = los.all;
      world.cross = facadeAt(BS, u);
    };

    world.evaluate = function (band, risOn, mraOn) {
      var u = world.user;
      var base = band.s1m - 20 * Math.log10(Math.max(1, hyp(BS, u)));
      var facadeDb = world.cross ? (world.cross.glass ? band.glass : band.concrete) : 0;
      var blockDb = world.losCount * band.block;
      var losDb = base - facadeDb - blockDb;
      // Diffuse energy that scatters in through the windows
      var lin = db2lin(losDb) + db2lin(base + band.nlos - band.glass);
      var risDb = null, mraDb = null;
      if (risOn) {
        // Transmissive RIS on the glass: steers the beam through the window
        // (3 dB insertion loss instead of the glass loss)
        var ds = [];
        tiles.forEach(function (tl) { if (!tl.blocked) ds.push(tl.d); });
        ds.sort(function (a, b) { return a - b; });
        if (ds.length) {
          var k = Math.min(3, ds.length);
          risDb = band.s1m - 20 * Math.log10(ds[0]) + band.ris - 3 + 10 * Math.log10(k);
          lin += db2lin(risDb);
        }
      }
      var mraParts = null;
      if (mraOn) {
        // Each tile's signal comes in through the facade: glass or concrete
        var ml = mraLink(mra, band, function (t, b) { return t.cross ? (t.cross.glass ? b.glass : b.concrete) : 0; });
        mraDb = ml.db; mraParts = ml.parts; lin += ml.lin;
      }
      return { snrDb: lin2db(lin), rate: rateFrom(band, lin), losDb: losDb, blockDb: blockDb, facadeDb: facadeDb, risDb: risDb, mraDb: mraDb, mraParts: mraParts };
    };

    return world;
  }


  // ---------------------------------------------------------------- outdoor street
  var OUT = {
    topFacade: 1.5, bottomFacade: 5.9,                  // building edges (y)
    street: [2.4, 5.0], lanes: [3.05, 4.35],            // asphalt and lane centres (y)
    BS: { x: 0.7, y: 5.15 },
    trees: [{ x: 3.3, y: 5.2, r: 0.38 }, { x: 6.1, y: 5.2, r: 0.38 }],
    CARL: 1.3, CARW: 0.6, BUSL: 2.6, BUSW: 0.75
  };
  var CAR_F = 1.5, BUS_F = 2.2;

  function createOutdoorWorld(seed) {
    var rand = mulberry32(seed || 20261201);
    function r(a, b) { return a + rand() * (b - a); }
    var BSo = OUT.BS;

    var tiles = [];
    for (var i = 0; i < 14; i++) {
      var tx = 2.4 + i * (6.4 / 13);
      tiles.push({ x: tx, y: OUT.topFacade - 0.1, ax: tx, ay: OUT.topFacade + 0.02, blocked: false });
    }
    // One MRA panel across the street, next to the RIS (on the near facade both
    // the BS and the user would sit at a grazing angle)
    var mra = [mraPanel(0.6, OUT.topFacade, 2.1, OUT.topFacade, 0, 1)];
    var walkers = [
      { x: r(1, 9), y: 5.3, vx: r(0.5, 0.8) }, { x: r(1, 9), y: 5.7, vx: -r(0.5, 0.8) },
      { x: r(1, 9), y: 1.8, vx: r(0.5, 0.8) }, { x: r(1, 9), y: 2.15, vx: -r(0.5, 0.8) }
    ];
    var cars = [];
    var laneTimer = [r(1, 4), r(2, 6)];
    var LOOKAHEAD = 1.1;

    function userPos(t) {
      return {
        x: 5.2 + 3.6 * Math.sin(t * 0.15) + 0.3 * Math.sin(t * 0.5),
        y: 5.5 + 0.2 * Math.sin(t * 0.8)
      };
    }

    var world = {
      scene: 'out', ap: BSo, apLabel: 'BS', out: OUT,
      t: 0, tiles: tiles, mra: mra, people: [], walkers: walkers, cars: cars, NT: tiles.length,
      tileOrient: 'h',
      user: userPos(0), pred: userPos(LOOKAHEAD), best: [], losBlocker: null, active: 0
    };

    function blockers(a, b) {
      var n = 0, first = null, all = [], k;
      for (k = 0; k < walkers.length; k++) {
        if (segDist(a.x, a.y, b.x, b.y, walkers[k].x, walkers[k].y) < PERSON_R) { n++; all.push(walkers[k]); if (!first) first = walkers[k]; }
      }
      for (k = 0; k < cars.length; k++) {
        if (hitsVehicle(a, b, cars[k])) { n += cars[k].factor; all.push(cars[k]); if (!first) first = cars[k]; }
      }
      return { n: n, first: first, all: all };
    }
    function trees(a, b) {
      var n = 0;
      OUT.trees.forEach(function (tr) { if (segDist(a.x, a.y, b.x, b.y, tr.x, tr.y) < tr.r) n++; });
      return n;
    }

    world.occupancy = function () { return 0; };
    world.status = function () {
      return 'traffic: ' + cars.length + (cars.length === 1 ? ' vehicle' : ' vehicles');
    };

    world.step = function (dt) {
      world.t += dt;
      walkers.forEach(function (wk) {
        wk.x += wk.vx * dt;
        if (wk.x > W + 0.5) wk.x = -0.5;
        if (wk.x < -0.5) wk.x = W + 0.5;
      });
      for (var ln = 0; ln < 2; ln++) {
        laneTimer[ln] -= dt;
        if (laneTimer[ln] <= 0) {
          var bus = rand() < 0.25, dir = ln === 0 ? 1 : -1;
          var len = bus ? OUT.BUSL : OUT.CARL;
          cars.push({ x: dir > 0 ? -len : W + len, y: OUT.lanes[ln], vx: dir * r(bus ? 1.6 : 2.2, bus ? 2.2 : 3.2),
            len: len, wid: bus ? OUT.BUSW : OUT.CARW, horiz: true, bus: bus, factor: bus ? BUS_F : CAR_F });
          laneTimer[ln] = r(7, 14);
          world.carEvent = true;
        }
      }
      for (var c = cars.length - 1; c >= 0; c--) {
        cars[c].x += cars[c].vx * dt;
        if (cars[c].x < -3 || cars[c].x > W + 3) cars.splice(c, 1);
      }

      var u = world.user = userPos(world.t);
      var pr = world.pred = userPos(world.t + LOOKAHEAD);
      var cand = [];
      world.active = 0;
      tiles.forEach(function (tl, idx) {
        tl.blocked = blockers(BSo, tl).n > 0 || blockers(tl, u).n > 0 || trees(BSo, tl) > 0 || trees(tl, u) > 0;
        tl.d = hyp(BSo, tl) + hyp(tl, u);
        if (!tl.blocked) {
          world.active++;
          cand.push({ i: idx, d: hyp(BSo, tl) + hyp(tl, pr) });
        }
      });
      cand.sort(function (a, b) { return a.d - b.d; });
      world.best = cand.slice(0, 3).map(function (cc) { return cc.i; });

      mra.forEach(function (pn) { steerPanel(pn, BSo, u, function (a, b) { return blockers(a, b).n > 0 || trees(a, b) > 0; }); });
      var los = blockers(BSo, u);
      world.losCount = los.n;
      world.losBlocker = los.first;
      world.losAll = los.all;
      world.treeCount = trees(BSo, u);
    };

    world.evaluate = function (band, risOn, mraOn) {
      var u = world.user;
      var base = band.s1m - 20 * Math.log10(Math.max(1, hyp(BSo, u)));
      var blockDb = world.losCount * band.block;
      var foliageDb = world.treeCount * band.foliage;
      var losDb = base - blockDb - foliageDb;
      // Fewer walls to scatter from outdoors: a weaker diffuse floor
      var lin = db2lin(losDb) + db2lin(base + band.nlos - 6);
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
      var mraParts = null;
      if (mraOn) {
        var ml = mraLink(mra, band);
        mraDb = ml.db; mraParts = ml.parts; lin += ml.lin;
      }
      return { snrDb: lin2db(lin), rate: rateFrom(band, lin), losDb: losDb, blockDb: blockDb, facadeDb: 0, foliageDb: foliageDb, risDb: risDb, mraDb: mraDb, mraParts: mraParts };
    };

    return world;
  }

  return {
    W: W, H: H, WALL: WALL, DOOR: DOOR, AP: AP, PERSON_R: PERSON_R,
    TARGET_GBPS: TARGET_GBPS, BANDS: BANDS,
    createWorld: createWorld, createO2IWorld: createO2IWorld, createOutdoorWorld: createOutdoorWorld,
    OUT: OUT,
    O2I: { FX: FX, WINDOWS: WINDOWS, BS: BS, DOOR: DOOR_O2I, LANE_X: LANE_X, CAR: CAR }
  };
});
