// 餃子とドリル: 2 面・3 面の 遊びの式(画面を知らない。node でも動く)。1 面のドリルは game.js。
// 時刻は ms(0 = その面を始めた時)。座標は 舞台の座標(幅 1080)。
(function (root) {
  'use strict';
  var IDLE_MS = 10000;
  function rng(seed) { var s = (seed >>> 0) || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  // ================= 2 面: タッカーで 春巻を 3 か所 留める =================
  // 春巻が 左から 右へ 流れてくる。とじ目の 朱の印が タッカーの口の真下に来た時に タップ = ばちん。
  // 印 1 つでも 外す(空打ち・通りすぎ)と その春巻は「具がはみ出る」= 数えない。3 つとも 留まった春巻だけが 皿に載る。
  var STAPLE = {
    time: 36000, quota: 5, top: 10, win: 150, good: 60,           // 判定の幅(印の真ん中から ±150 ms = 留まる / ±60 ms = ぴたっ)
    // 区間(from 秒から): period = 春巻 1 本が来る間隔 / marks = 春巻が出てから 印が口に来るまでの ms / thick = 太巻き(絵だけ)
    phases: [
      { from: 0, period: 3400, marks: [1500, 2300, 3100], thick: 0 },
      { from: 18000, period: 3000, marks: [1300, 2500, 2850], thick: 1 }       // 常連「端まで 具を」→ 太巻き。端の 2 か所が 近い
    ]
  };
  function Staple(seed, cfg) {
    this.cfg = cfg || STAPLE; this.r = rng(seed || 1);
    this.rolls = []; this.firstT = 0; this.endT = this.cfg.time; this.over = null; this.stage = 0;      // 春巻は 勝手に流れてくるので 時計は 始めた時から
    this.closed = 0; this.spoiled = 0; this.hits = 0; this.perfect = 0; this.taps = 0; this.log = [];
    this.nextAt = 1200;                                // 最初の春巻は 1.2 秒後(最初の印は 2.7 秒)
  }
  Staple.prototype._phaseAt = function (t) { var P = this.cfg.phases, s = 0; for (var i = 0; i < P.length; i++) if (t >= P[i].from) s = i; return s; };
  Staple.prototype.advance = function (t, out) {
    out = out || [];
    if (this.over) return out;
    if (this.taps === 0 && t >= IDLE_MS) { this._end('idle', IDLE_MS, out); return out; }       // 10 秒 一度も押さない = 立っていただけ
    for (var g = 0; g < 200; g++) {
      var et = Infinity, ev = null, ph = this._phaseAt(this.nextAt);
      if (this.nextAt < et) { et = this.nextAt; ev = 'spawn'; }
      var miss = this._firstMiss(); if (miss && miss.due < et) { et = miss.due; ev = 'pass'; }
      var done = this._firstDone(); if (done && done.out < et) { et = done.out; ev = 'out'; }
      if (this.endT != null && this.endT <= et) { et = this.endT; ev = 'timeup'; }
      if (et > t || ev == null) break;
      if (ev === 'spawn') {
        var p = this.cfg.phases[ph]; if (ph !== this.stage) { this.stage = ph; out.push({ type: 'stage', t: et, stage: ph }); }
        var roll = { id: this.rolls.length, t0: et, marks: p.marks.map(function (m) { return { at: et + m, hit: null, dt: null }; }), thick: p.thick, result: null, spd: 1 };
        roll.out = et + p.marks[p.marks.length - 1] + 900;
        this.rolls.push(roll); out.push({ type: 'spawn', t: et, roll: roll }); this.nextAt = et + p.period;
      } else if (ev === 'pass') { miss.m.hit = 'miss'; this.log.push({ grade: 'miss', dt: null }); out.push({ type: 'judge', t: et, grade: 'miss', roll: miss.roll, mark: miss.i }); this._spoil(miss.roll, et, out); }
      else if (ev === 'out') { this._settle(done, et, out); }
      else { out.push({ type: 'timeup', t: et }); this._end(this.closed >= this.cfg.quota ? 'clear' : 'slow', et, out); break; }
    }
    return out;
  };
  // まだ判定していない印のうち 通りすぎた時刻(印 + 幅)が いちばん早いもの
  Staple.prototype._firstMiss = function () {
    var best = null;
    for (var i = 0; i < this.rolls.length; i++) { var r = this.rolls[i]; if (r.result) continue;
      for (var k = 0; k < r.marks.length; k++) { var m = r.marks[k]; if (m.hit) continue; var due = m.at + this.cfg.win; if (!best || due < best.due) best = { due: due, m: m, roll: r, i: k }; } }
    return best;
  };
  Staple.prototype._firstDone = function () { for (var i = 0; i < this.rolls.length; i++) if (!this.rolls[i].gone) return this.rolls[i]; return null; };
  Staple.prototype._spoil = function (r, t, out) { if (r.result) return; r.result = 'spoiled'; this.spoiled++; out.push({ type: 'roll', t: t, result: 'spoiled', roll: r }); };
  Staple.prototype._settle = function (r, t, out) {
    r.gone = true;
    if (!r.result) { var all = r.marks.every(function (m) { return m.hit === 'hit' || m.hit === 'perfect'; }); r.result = all ? 'closed' : 'spoiled'; if (all) this.closed++; else this.spoiled++; out.push({ type: 'roll', t: t, result: r.result, roll: r }); }
    out.push({ type: 'leave', t: t, roll: r });
  };
  Staple.prototype._end = function (k, t, out) { this.over = k; out.push({ type: 'end', t: t, kind: k }); };
  // タップ(指を置いた瞬間)。いちばん近い 印を探す
  Staple.prototype.tap = function (t) {
    var out = []; this.advance(t, out); if (this.over) return out;
    this.taps++;
    var best = null;
    for (var i = 0; i < this.rolls.length; i++) { var r = this.rolls[i]; if (r.result) continue;
      for (var k = 0; k < r.marks.length; k++) { var m = r.marks[k]; if (m.hit) continue; var d = t - m.at; if (Math.abs(d) <= this.cfg.win && (!best || Math.abs(d) < Math.abs(best.d))) best = { d: d, m: m, roll: r, i: k }; } }
    if (best) {
      var gr = Math.abs(best.d) <= this.cfg.good ? 'perfect' : 'hit'; best.m.hit = gr; best.m.dt = best.d; this.hits++; if (gr === 'perfect') this.perfect++;
      this.log.push({ grade: gr, dt: best.d }); out.push({ type: 'judge', t: t, grade: gr, dt: best.d, roll: best.roll, mark: best.i });
    } else {
      // 空打ち: いま口の下にある春巻(印の間)を 傷める。春巻が無ければ 台を打つだけ
      var under = null; for (var j = 0; j < this.rolls.length; j++) { var rr = this.rolls[j]; if (!rr.result && t > rr.marks[0].at - 700 && t < rr.marks[rr.marks.length - 1].at + 400) under = rr; }
      this.log.push({ grade: 'air', dt: null }); out.push({ type: 'judge', t: t, grade: 'air', roll: under });
      if (under) this._spoil(under, t, out);
    }
    return out;
  };
  Staple.prototype.left = function (t) { return this.firstT == null ? this.cfg.time : Math.max(0, this.endT - t); };
  Staple.prototype.flush = function () { var n = this.hits + this.log.filter(function (l) { return l.grade !== 'perfect' && l.grade !== 'hit'; }).length; return n ? Math.round(this.perfect / n * 100) : 0; };

  // ================= 3 面: 金尺に カッターを当てて 干し豆腐を 細切り =================
  // 板の上に 金尺が置いてある。尺の端から端まで 指で 一息に引く = 1 本切れる。
  // 尺から ずれすぎ(DEV_OK を超える)= 斜めに切れて 使えない / 速すぎ(MIN_MS 未満)= ちぎれる / 途中で離す・遅すぎ = 切れていない(やり直し・数えない)
  var CUT = {
    time: 36000, quota: 12, top: 22, reach: 90, devOk: 54, devGood: 20, minMs: 160, maxMs: 1300, reset: 420,
    // 区間: dir = 'h'(横に引く)/ 'v'(縦に引く)/ 'd'(斜め)。len = 尺の長さ(舞台 px)
    phases: [
      { from: 0, dir: 'h', len: 560 },
      { from: 16000, dir: 'v', len: 520 },              // 幹事「取り分けやすい長さで」→ 板を 90 度回す
      { from: 28000, dir: 'd', len: 520 }               // 大将「最後は 斜め切りや」→ 尺が 斜め
    ]
  };
  function Cut(seed, cfg) {
    this.cfg = cfg || CUT; this.r = rng(seed || 1);
    this.firstT = null; this.endT = null; this.over = null; this.stage = 0;
    this.cuts = 0; this.good = 0; this.perfect = 0; this.bad = 0; this.log = [];
    this.stroke = null; this.readyT = 0; this.n = 0;          // n = いまの区間で 何本目か(尺の位置が ずれていく)
  }
  Cut.prototype.phase = function () { return this.cfg.phases[this.stage]; };
  // いまの尺(線分 a → b。中心は 舞台の (540, cy))
  Cut.prototype.line = function (cy) {
    var p = this.phase(), L = p.len / 2, off = ((this.n % 6) - 2.5) * 34, cx = 540, a, b;
    cy = cy || 1300;
    if (p.dir === 'h') { a = { x: cx - L, y: cy + off }; b = { x: cx + L, y: cy + off }; }
    else if (p.dir === 'v') { a = { x: cx + off, y: cy - L }; b = { x: cx + off, y: cy + L }; }
    else { var k = Math.SQRT1_2; a = { x: cx - L * k + off * k, y: cy - L * k - off * k }; b = { x: cx + L * k + off * k, y: cy + L * k - off * k }; }
    return { a: a, b: b };
  };
  Cut.prototype.advance = function (t, out) {
    out = out || []; if (this.over) return out;
    if (this.firstT == null) { if (t >= IDLE_MS) { this.over = 'idle'; out.push({ type: 'end', t: IDLE_MS, kind: 'idle' }); } return out; }
    var ns = this.stage + 1;
    if (ns < this.cfg.phases.length && t >= this.firstT + this.cfg.phases[ns].from && !this.stroke) { this.stage = ns; this.n = 0; this.readyT = Math.max(this.readyT, this.firstT + this.cfg.phases[ns].from + 700); out.push({ type: 'stage', t: this.firstT + this.cfg.phases[ns].from, stage: ns }); }
    if (t >= this.endT) {
      if (this.stroke) { this.stroke = null; out.push({ type: 'judge', t: this.endT, grade: 'cut_short' }); }
      out.push({ type: 'timeup', t: this.endT }); this.over = this.cuts >= this.cfg.quota ? 'clear' : 'slow'; out.push({ type: 'end', t: this.endT, kind: this.over });
    }
    return out;
  };
  function distSeg(p, a, b) { var vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy, u = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2; var cx = a.x + vx * u, cy = a.y + vy * u; return { d: Math.hypot(p.x - cx, p.y - cy), u: u }; }
  Cut.prototype.ready = function (t) { return t >= this.readyT; };
  Cut.prototype.down = function (t, x, y, cy) {
    var out = []; this.advance(t, out); if (this.over) return out;
    if (t < this.readyT) return out;
    var L = this.line(cy), da = Math.hypot(x - L.a.x, y - L.a.y), db = Math.hypot(x - L.b.x, y - L.b.y), R = this.cfg.reach;
    if (Math.min(da, db) > R) { out.push({ type: 'miss_start', t: t }); return out; }
    if (this.firstT == null) { this.firstT = t; this.endT = t + this.cfg.time; }
    var from = da <= db ? L.a : L.b, to = da <= db ? L.b : L.a;
    this.stroke = { t0: t, from: from, to: to, dev: 0, prog: 0, pts: [{ x: x, y: y, t: t }] };
    out.push({ type: 'start', t: t, from: from, to: to }); return out;
  };
  Cut.prototype.move = function (t, x, y) {
    var s = this.stroke; if (!s || this.over) return [];
    var q = distSeg({ x: x, y: y }, s.from, s.to); s.dev = Math.max(s.dev, q.d); s.prog = Math.max(s.prog, Math.min(1, q.u)); s.pts.push({ x: x, y: y, t: t });
    return [];
  };
  Cut.prototype.up = function (t, x, y) {
    var out = []; this.advance(t, out); var s = this.stroke; if (!s || this.over) return out;
    this.move(t, x, y); this.stroke = null;
    var dur = t - s.t0, reach = Math.hypot(x - s.to.x, y - s.to.y) <= this.cfg.reach, gr;
    if (!reach) gr = 'cut_short';                                   // 端まで 引いていない = 切れていない(数えない・やり直し)
    else if (s.dev > this.cfg.devOk) gr = 'crooked';                // 斜めに それた
    else if (dur < this.cfg.minMs) gr = 'ripped';                   // 速すぎて ちぎれた
    else if (dur > this.cfg.maxMs) gr = 'cut_short';                // 遅すぎ = ぎこぎこ(数えない)
    else gr = s.dev <= this.cfg.devGood ? 'perfect' : 'good';
    this.log.push({ grade: gr, dev: s.dev, dur: dur });
    if (gr === 'perfect' || gr === 'good') { this.cuts++; this.good++; if (gr === 'perfect') this.perfect++; this.n++; this.readyT = t + this.cfg.reset; }
    else if (gr === 'crooked' || gr === 'ripped') { this.bad++; this.n++; this.readyT = t + this.cfg.reset + 250; }
    out.push({ type: 'judge', t: t, grade: gr, dev: s.dev, dur: dur, from: s.from, to: s.to });
    return out;
  };
  Cut.prototype.left = function (t) { return this.firstT == null ? this.cfg.time : Math.max(0, this.endT - t); };
  Cut.prototype.flush = function () { var n = this.log.filter(function (l) { return l.grade !== 'cut_short'; }).length; return n ? Math.round(this.perfect / n * 100) : 0; };

  var api = { Staple: Staple, Cut: Cut, STAPLE: STAPLE, CUT: CUT, IDLE_MS: IDLE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GZTools = api;
})(typeof window !== 'undefined' ? window : globalThis);
