// 鼻ボタン: 遊びの式だけ(画面・音・入力の取り方は知らない)。ブラウザでも node でも同じものを読む。
// ネイティブへ移すときは このファイルの式を そのまま写す(時刻は ms、スティックは −1〜1)。
(function (root) {
  'use strict';
  // ---- 定数 ----
  var ZONE_MAG = 0.5;        // 方向に「入った」とみなす倒し幅
  var ZONE_ANG = 50;         // 方向の許容(度)
  var CENTER_MAG = 0.3;      // 「とめる」= ここより内側
  var WIN_MAX = 220;         // 判定の窓(±ms)。音の間が詰まると 間の 45% まで縮む
  var PERFECT = 60, GOOD = 120;
  var PTS = { perfect: 100, good: 70, ok: 40, hold: 100, miss: 0, idle: 0, moved: 0 };
  var DISTURB_STAGE = [4, 8, 12];   // 耳ぴく / 片目があく / 起きる
  var CALM_EVERY = 5;        // 続けて合うと 1 つ落ち着く
  var IDLE_LIMIT = 8;        // さわらないまま これだけ逃すと「ぐっすり」で終わり

  // [BPM, 1 文字ぶんの拍, 並び]  L R U D = 倒す向き / . = とめる(犬が もぞっとする)/ - = 休み
  var SECTIONS = [
    [80, 1, '----'],
    [80, 1, 'LRLRLRLR'],
    [80, 1, 'UDUDLRUD'],
    [80, 1, '..'],
    [96, 1, 'LRLRUDUD'],
    [96, 1, 'RDLURDLU'],
    [96, 0.5, 'LRLRLRLR'],
    [96, 1, 'UDUD'],
    [96, 1, '..'],
    [112, 1, 'LRUDLRUD'],
    [112, 0.5, 'RDLURDLU'],
    [112, 0.5, 'LRLRLRLR'],
    [112, 0.5, 'UDUDLRLR'],
    [112, 1, '...']
  ];
  var VEC = { L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1], C: [0, 0] };

  function rng(seed) { var s = (seed >>> 0) || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  // 譜面。seed で 左右・上下を入れ替える(毎回 少し違う)
  function makeChart(seed) {
    var r = rng(seed || 1), notes = [], beats = [], t = 600, i, j;
    for (i = 0; i < SECTIONS.length; i++) {
      var bpm = SECTIONS[i][0], step = SECTIONS[i][1], pat = SECTIONS[i][2];
      var fx = r() < 0.5, fy = r() < 0.5, ms = 60000 / bpm * step, acc = 0;
      for (j = 0; j < pat.length; j++) {
        var c = pat[j];
        if (fx) c = c === 'L' ? 'R' : c === 'R' ? 'L' : c;
        if (fy) c = c === 'U' ? 'D' : c === 'D' ? 'U' : c;
        if (Math.abs(acc - Math.round(acc)) < 1e-6) beats.push({ t: t, bpm: bpm, sec: i, quiet: c === '.' });
        if (c === '.') notes.push({ t: t, dir: 'C', hold: j > 0 && pat[j - 1] === '.', sec: i });
        else if (c !== '-') notes.push({ t: t, dir: c, hold: false, sec: i });
        t += ms; acc += step;
      }
    }
    for (i = 0; i < notes.length; i++) {
      var gp = i > 0 ? notes[i].t - notes[i - 1].t : 1e9, gn = i < notes.length - 1 ? notes[i + 1].t - notes[i].t : 1e9;
      notes[i].i = i; notes[i].w = Math.min(WIN_MAX, 0.45 * Math.min(gp, gn));
      notes[i].gap = gp;
    }
    return { notes: notes, beats: beats, end: t + 500, seed: seed };
  }

  function inZone(dir, x, y) {
    var m = Math.sqrt(x * x + y * y);
    if (dir === 'C') return m <= CENTER_MAG;
    if (m < ZONE_MAG) return false;
    var v = VEC[dir], cos = (x * v[0] + y * v[1]) / m;
    return cos >= Math.cos(ZONE_ANG * Math.PI / 180);
  }

  function zoneOf(x, y) { var d = ['L', 'R', 'U', 'D']; for (var i = 0; i < 4; i++) if (inZone(d[i], x, y)) return d[i]; return null; }

  function Game(chart) {
    this.chart = chart; this.notes = chart.notes; this.k = 0;
    this.x = 0; this.y = 0; this.touch = false;
    this.score = 0; this.max = 0; this.combo = 0; this.maxCombo = 0; this.streak = 0;
    this.disturb = 0; this.stage = 0; this.idleRun = 0; this.over = null;
    this.count = { perfect: 0, good: 0, ok: 0, hold: 0, miss: 0, idle: 0, moved: 0 };
    this.log = [];
  }
  Game.prototype._resolve = function (n, grade, err, out) {
    n.done = grade; n.err = err; this.k = n.i + 1;
    this.count[grade]++; this.score += PTS[grade]; this.max += 100;
    this.log.push({ i: n.i, dir: n.dir, grade: grade, err: err });
    var hit = grade === 'perfect' || grade === 'good' || grade === 'ok' || grade === 'hold';
    if (hit) {
      this.combo++; this.idleRun = 0; if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      if (grade !== 'ok') { this.streak++; if (this.streak % CALM_EVERY === 0 && this.disturb > 0) this.disturb--; } else this.streak = 0;
    } else {
      this.combo = 0; this.streak = 0;
      if (grade === 'idle') this.idleRun++; else { this.idleRun = 0; this.disturb += grade === 'moved' ? 2 : 1; }
    }
    out.push({ type: 'judge', note: n, grade: grade, err: err });
    var st = 0; for (var s = 0; s < 3; s++) if (this.disturb >= DISTURB_STAGE[s]) st = s + 1;
    if (st !== this.stage) { this.stage = st; out.push({ type: 'stage', stage: st }); }
    if (!this.over) {
      if (st >= 3) this.over = 'woke';
      else if (this.idleRun >= IDLE_LIMIT) this.over = 'idle';
      else if (this.k >= this.notes.length) this.over = 'clear';
      if (this.over) out.push({ type: 'end', kind: this.over, t: n.t });
    }
  };
  // 時刻 t まで進める(いまのスティックの位置のまま)
  Game.prototype.advance = function (t, out) {
    out = out || [];
    while (!this.over && this.k < this.notes.length) {
      var n = this.notes[this.k], ws = n.t - n.w, we = n.t + n.w;
      if (t < ws) break;
      if (this.touch) n.touched = true;
      var inside = inZone(n.dir, this.x, this.y);
      if (n.hold) {                                   // とめたまま: 窓のあいだ 動かさない
        if (!inside) { this._resolve(n, 'moved', t - n.t, out); continue; }
        if (t >= we) { this._resolve(n, 'hold', 0, out); continue; }
        break;
      }
      var z = zoneOf(this.x, this.y);
      if (!n.seen) {                                  // 窓が開いたとき もう そこにいた: 倒す向きなら 早すぎ(外れ)。「とめる」は 先に止まっていてよい
        n.seen = true; n.from = z;
        if (inside) { if (n.dir === 'C') this._resolve(n, 'good', -n.w, out); else { n.early = true; this._resolve(n, 'miss', -n.w, out); } continue; }
      }
      var pv = n.i > 0 ? this.notes[n.i - 1].dir : null;
      if (z && z !== n.dir && z !== n.from && z !== pv && n.dir !== 'C') { this._resolve(n, 'miss', null, out); continue; }   // ちがう向きへ倒した(でたらめに回しても合わない)。前の音の向きへ 遅れて着いたのは 数えない
      if (inside) { var e = t - n.t, a = Math.abs(e); this._resolve(n, a <= PERFECT ? 'perfect' : a <= GOOD ? 'good' : 'ok', e, out); continue; }
      if (t >= we) { this._resolve(n, n.touched ? 'miss' : 'idle', null, out); continue; }
      break;
    }
    return out;
  };
  // 指が動いた(t = その出来事の時刻 ms)
  Game.prototype.input = function (t, x, y, touch) {
    var out = [];
    this.advance(t - 0.001, out);                      // 動く前の位置で t の直前まで
    this.x = x; this.y = y; this.touch = touch;
    this.advance(t, out);
    return out;
  };
  Game.prototype.percent = function () { return this.max ? Math.round(this.score / (this.notes.length * 100) * 100) : 0; };
  Game.prototype.progress = function () { return this.k / this.notes.length; };

  function rank(pct) { return pct >= 95 ? 0 : pct >= 85 ? 1 : pct >= 70 ? 2 : pct >= 50 ? 3 : 4; }

  var api = { makeChart: makeChart, Game: Game, inZone: inZone, rank: rank, VEC: VEC, rng: rng,
    K: { ZONE_MAG: ZONE_MAG, CENTER_MAG: CENTER_MAG, PERFECT: PERFECT, GOOD: GOOD, DISTURB_STAGE: DISTURB_STAGE } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HBGame = api;
})(typeof window !== 'undefined' ? window : globalThis);
