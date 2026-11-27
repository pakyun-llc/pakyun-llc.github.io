// ドリル飯店(旧 餃子とドリル): 2 面・3 面の 遊びの式(画面を知らない。node でも動く)。1 面のドリルは game.js。
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
  // 11-27 12 回目(ユウキさん「切れにくすぎる」「赤い点に指を置いて切ると先端が切れない…UI/UX を考えて」)= 作り直し:
  //  ・線は 板の 端から端まで(len 600)。印は 板の外(線の 両端の 先)
  //  ・刃先の 位置で 数える(指 ≠ 刃先。main.js が 指から ずらした 刃先を 渡す)。線から reach 以内の 点だけ 数え、外れても 失敗にしない
  //  ・何回に 分けて 引いてもよい(離しても 続きから)。両端 snap(12%)以内まで 届いたら 端から端まで 切れた = 1 本
  //  ・出来は まっすぐさ(線からの いちばん大きい ずれ)と 引いた回数で 決める: 優 = ずれ ≤ devGood かつ 1 回 / 良 = ずれ ≤ devOk / 可 = それより 曲がった(どれも 1 本に 数える)
  var CUT = {
    time: 36000, quota: 12, top: 22, reach: 72, devGood: 16, devOk: 34, snap: 0.12, reset: 380,
    // 区間: dir = 'h'(横に引く)/ 'v'(縦に引く)/ 'd'(斜め)。len = 線の長さ(= 板の幅。舞台 px)
    phases: [
      { from: 0, dir: 'h', len: 600 },
      { from: 16000, dir: 'v', len: 600 },              // 幹事「取り分けやすい長さで」→ 板を 90 度回す
      { from: 28000, dir: 'd', len: 600 }               // 大将「最後は 斜め切りや」→ 尺が 斜め
    ]
  };
  function Cut(seed, cfg) {
    this.cfg = cfg || CUT; this.r = rng(seed || 1);
    this.firstT = null; this.endT = null; this.over = null; this.stage = 0;
    this.cuts = 0; this.good = 0; this.perfect = 0; this.bad = 0; this.log = [];
    this.stroke = null; this.cov = null; this.readyT = 0; this.n = 0;          // cov = いまの線の 切れた範囲(lo〜hi、0〜1)
  }
  Cut.prototype.phase = function () { return this.cfg.phases[this.stage]; };
  // いまの線(線分 a → b。中心は 舞台の (540, cy))。板は dir の角度に 回っていて、線は 板の 端から端
  Cut.prototype.line = function (cy) {
    var p = this.phase(), L = p.len / 2, off = ((this.n % 6) - 2.5) * 34, cx = 540, a, b;
    cy = cy || 1300;
    if (p.dir === 'h') { a = { x: cx - L, y: cy + off }; b = { x: cx + L, y: cy + off }; }
    else if (p.dir === 'v') { a = { x: cx - off, y: cy - L }; b = { x: cx - off, y: cy + L }; }
    else { var k = Math.SQRT1_2; a = { x: cx - L * k - off * k, y: cy - L * k + off * k }; b = { x: cx + L * k - off * k, y: cy + L * k + off * k }; }
    return { a: a, b: b };
  };
  Cut.prototype.advance = function (t, out) {
    out = out || []; if (this.over) return out;
    if (this.firstT == null) { if (t >= IDLE_MS) { this.over = 'idle'; out.push({ type: 'end', t: IDLE_MS, kind: 'idle' }); } return out; }
    var ns = this.stage + 1;
    if (ns < this.cfg.phases.length && t >= this.firstT + this.cfg.phases[ns].from && !this.stroke) { this.stage = ns; this.n = 0; this.cov = null; this.readyT = Math.max(this.readyT, this.firstT + this.cfg.phases[ns].from + 700); out.push({ type: 'stage', t: this.firstT + this.cfg.phases[ns].from, stage: ns }); }
    if (t >= this.endT) {
      this.stroke = null; out.push({ type: 'timeup', t: this.endT }); this.over = this.cuts >= this.cfg.quota ? 'clear' : 'slow'; out.push({ type: 'end', t: this.endT, kind: this.over });
    }
    return out;
  };
  function distSeg(p, a, b) { var vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy, u = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2; var cx = a.x + vx * u, cy = a.y + vy * u; return { d: Math.hypot(p.x - cx, p.y - cy), u: u }; }
  Cut.prototype.ready = function (t) { return t >= this.readyT; };
  Cut.prototype._add = function (t, x, y) {          // 刃先の 1 点: 線の近く(reach 以内)だけ 切れた範囲を 広げる
    var s = this.stroke, c = this.cov, q = distSeg({ x: x, y: y }, s.L.a, s.L.b); s.pts.push({ x: x, y: y, t: t });
    if (q.d > this.cfg.reach || q.u < -0.4 || q.u > 1.4) return;
    var u = Math.max(0, Math.min(1, q.u)); c.lo = Math.min(c.lo, u); c.hi = Math.max(c.hi, u);
    if (q.u > 0.02 && q.u < 0.98) c.dev = Math.max(c.dev, q.d);
  };
  Cut.prototype.score = function () { return this.good + Math.floor(this.bad / 3); };   // 講評は まっすぐな本数で(曲がった 3 本 = 1 本)
  Cut.prototype.done = function () { var c = this.cov; return !!c && c.lo <= this.cfg.snap && c.hi >= 1 - this.cfg.snap; };
  Cut.prototype.down = function (t, x, y, cy) {
    var out = []; this.advance(t, out); if (this.over) return out;
    if (t < this.readyT) return out;
    var L = this.line(cy), q = distSeg({ x: x, y: y }, L.a, L.b);
    if (q.d > this.cfg.reach * 1.4 || q.u < -0.45 || q.u > 1.45) { out.push({ type: 'miss_start', t: t }); return out; }
    if (this.firstT == null) { this.firstT = t; this.endT = t + this.cfg.time; }
    if (!this.cov) this.cov = { lo: 2, hi: -1, dev: 0, strokes: 0, t0: t };
    this.cov.strokes++;
    this.stroke = { t0: t, L: L, from: L.a, to: L.b, pts: [] }; this._add(t, x, y);
    out.push({ type: 'start', t: t, from: L.a, to: L.b }); return out;
  };
  Cut.prototype.move = function (t, x, y) {
    var s = this.stroke; if (!s || this.over) return [];
    this._add(t, x, y);
    return this.done() ? this._finish(t) : [];
  };
  Cut.prototype._finish = function (t) {
    var c = this.cov, s = this.stroke, gr = c.dev <= this.cfg.devGood && c.strokes <= 1 ? 'perfect' : c.dev <= this.cfg.devOk ? 'good' : 'crooked';
    this.log.push({ grade: gr, dev: c.dev, dur: t - c.t0, strokes: c.strokes });
    this.cuts++; if (gr !== 'crooked') this.good++; else this.bad++; if (gr === 'perfect') this.perfect++;
    this.n++; this.readyT = t + this.cfg.reset; this.cov = null; this.stroke = null;
    return [{ type: 'judge', t: t, grade: gr, dev: c.dev, dur: t - c.t0, from: s.L.a, to: s.L.b }];
  };
  Cut.prototype.up = function (t, x, y) {
    var out = []; this.advance(t, out); var s = this.stroke; if (!s || this.over) return out;
    this._add(t, x, y);
    if (this.done()) return out.concat(this._finish(t));
    this.stroke = null; out.push({ type: 'lift', t: t, lo: this.cov.lo, hi: this.cov.hi });      // 途中で 離した = 失敗ではない。続きから 引ける
    return out;
  };
  Cut.prototype.left = function (t) { return this.firstT == null ? this.cfg.time : Math.max(0, this.endT - t); };
  Cut.prototype.flush = function () { var n = this.log.length; return n ? Math.round(this.perfect / n * 100) : 0; };


  // ================= 四品目: コーキングガンで 焼売の皮に 餡を 花の形に 絞る =================
  // 皮の上に 花(5 弁)の 点線。指を置いたまま 点線を 一周なぞる = 餡の すじ(ビード)が のる。
  // 一周(36 区切りの 34 以上)で 自動で 決まる。途中で離す = 足りない / 線から それる = はみ出た / 速すぎ = 細い / 遅すぎ = ぼてっ
  var CAULK = {
    time: 40000, quota: 9, top: 19, R: 200, tol: 46, near: 60, bins: 36, need: 34, reset: 450,
    phases: [ { from: 0, size: 1 }, { from: 20000, size: 0.66 } ]     // 20 秒: 子ども席の 小粒(花が 小さい)
  };
  function flowerR(R, a, amp) { return R * (1 + (amp == null ? 0.16 : amp) * Math.cos(5 * a)); }   // amp = 花の 出っぱり(餃子の皮 = 0 = 丸)
  function Caulk(seed, cfg) {
    this.cfg = cfg || CAULK; this.firstT = null; this.endT = null; this.over = null; this.stage = 0;
    this.good = 0; this.perfect = 0; this.bad = 0; this.log = []; this.stroke = null; this.readyT = 0; this.n = 0;
  }
  Caulk.prototype.size = function () { return this.cfg.phases[this.stage].size; };
  Caulk.prototype.radius = function (a) { return flowerR(this.cfg.R * this.size(), a, this.cfg.petal); };
  Caulk.prototype.advance = function (t, out) {
    out = out || []; if (this.over) return out;
    if (this.firstT == null) { if (t >= IDLE_MS) { this.over = 'idle'; out.push({ type: 'end', t: IDLE_MS, kind: 'idle' }); } return out; }
    var ns = this.stage + 1;
    if (ns < this.cfg.phases.length && t >= this.firstT + this.cfg.phases[ns].from && !this.stroke) { this.stage = ns; out.push({ type: 'stage', t: t, stage: ns }); }
    if (t >= this.endT) { if (this.stroke) this.stroke = null; out.push({ type: 'timeup', t: this.endT }); this.over = this.good >= this.cfg.quota ? 'clear' : 'slow'; out.push({ type: 'end', t: this.endT, kind: this.over }); }
    return out;
  };
  Caulk.prototype.ready = function (t) { return t >= this.readyT; };
  // c = 花の まん中(舞台の座標)
  Caulk.prototype.down = function (t, x, y, c) {
    var out = []; this.advance(t, out); if (this.over || t < this.readyT || this.stroke) return out;
    var dx = x - c.x, dy = y - c.y, a = Math.atan2(dy, dx), e = Math.abs(Math.hypot(dx, dy) - this.radius(a)), k = this.size();
    if (e > this.cfg.near * Math.max(0.8, k)) { out.push({ type: 'miss_start', t: t }); return out; }
    if (this.firstT == null) { this.firstT = t; this.endT = t + this.cfg.time; }
    this.stroke = { t0: t, c: c, bins: {}, nb: 0, se: 0, ns: 0, pts: [{ x: x, y: y, ok: true }] };
    out.push({ type: 'start', t: t }); this._sample(this.stroke, x, y); return out;
  };
  Caulk.prototype._sample = function (s, x, y) {
    var dx = x - s.c.x, dy = y - s.c.y, a = Math.atan2(dy, dx), e = Math.hypot(dx, dy) - this.radius(a), k = this.size();
    s.se += e * e; s.ns++;
    var ok = Math.abs(e) <= this.cfg.tol * Math.max(0.75, k);
    if (ok) { var b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * this.cfg.bins) % this.cfg.bins; if (!s.bins[b]) { s.bins[b] = 1; s.nb++; } }
    return ok;
  };
  Caulk.prototype.move = function (t, x, y) {
    var s = this.stroke; if (!s || this.over) return [];
    var ok = this._sample(s, x, y); s.pts.push({ x: x, y: y, ok: ok });
    if (s.nb >= this.cfg.need) return this._judge(t);       // 一周 = 自動で決まる
    return [];
  };
  Caulk.prototype.up = function (t, x, y) { var out = []; this.advance(t, out); if (!this.stroke || this.over) return out; return out.concat(this._judge(t)); };
  Caulk.prototype._judge = function (t) {
    var s = this.stroke, k = this.size(), dur = t - s.t0, rms = Math.sqrt(s.se / Math.max(1, s.ns)), cov = s.nb / this.cfg.bins, gr;
    this.stroke = null;
    if (cov < this.cfg.need / this.cfg.bins) gr = 'short';                 // 一周していない = 餡が 足りない
    else if (rms > 30 * Math.max(0.75, k)) gr = 'messy';                    // 線から それた = はみ出た
    else if (dur < 450 * k) gr = 'thin';                                     // 速すぎ = 細くて 切れた
    else if (dur > 4200 * k) gr = 'blob';                                    // 遅すぎ = ぼてっ と 垂れた
    else gr = rms <= 12 * Math.max(0.75, k) ? 'perfect' : 'good';
    this.log.push({ grade: gr, rms: rms, dur: dur, cov: cov });
    if (gr === 'perfect' || gr === 'good') { this.good++; if (gr === 'perfect') this.perfect++; } else this.bad++;
    this.n++; this.readyT = t + this.cfg.reset;
    return [{ type: 'judge', t: t, grade: gr, rms: rms, dur: dur, pts: s.pts, size: k }];
  };
  Caulk.prototype.left = function (t) { return this.firstT == null ? this.cfg.time : Math.max(0, this.endT - t); };
  Caulk.prototype.flush = function () { return this.log.length ? Math.round(this.perfect / this.log.length * 100) : 0; };

  // ================= 五品目: かんなで 長ねぎを 薄く削ぐ(白髪ねぎ)=================
  // 大工の かんなを 両手(指 2 本 = 左右の取っ手)で 持って、手前(画面の下)へ 一息に引く。指 1 本だと かんなが 傾いて 食い込む。
  // 判定: 上から下まで 引ききる / 左右の高さの差(傾き)/ 左右の ずれ / 速さ
  var KANNA = {
    time: 36000, quota: 12, top: 26, gripDX: 210, gripR: 110, len: 560, reset: 380, minMs: 220, maxMs: 1500, tiltOk: 70, tiltGood: 26, driftOk: 70, jam: 70,
    phases: [ { from: 0, thick: 0 }, { from: 18000, thick: 1 } ]           // 18 秒: 太い ねぎ(大将「太いのが 来たぞ。まっすぐ 引け」)= 傾きに 厳しい
  };
  function Kanna(seed, cfg) {
    this.cfg = cfg || KANNA; this.firstT = null; this.endT = null; this.over = null; this.stage = 0;
    this.good = 0; this.perfect = 0; this.bad = 0; this.log = []; this.readyT = 0; this.f = {}; this.stroke = null; this.y0 = 0; this.x0 = 540;
  }
  // かんなの 置き場所(上の端)。y0 は 呼ぶ側が 決める(ねぎの 上の端)
  Kanna.prototype.setTop = function (x0, y0) { this.x0 = x0; this.y0 = y0; };
  Kanna.prototype.grips = function () { var y = this.stroke ? this.stroke.y : this.y0; return [{ x: this.x0 - this.cfg.gripDX, y: y }, { x: this.x0 + this.cfg.gripDX, y: y }]; };
  // 指の位置は move で 覚えるだけ。傾き・終わりは advance(毎コマ = 2 本の指が そろってから)で 見る(1 本ずつ届く move で 見ると 一瞬の差を 傾きと 取り違える)
  Kanna.prototype.advance = function (t, out) {
    out = out || []; if (this.over) return out;
    if (this.firstT == null) { if (t >= IDLE_MS) { this.over = 'idle'; out.push({ type: 'end', t: IDLE_MS, kind: 'idle' }); } return out; }
    if (t >= this.readyT) out = out.concat(this._track(t));
    var ns = this.stage + 1;
    if (ns < this.cfg.phases.length && t >= this.firstT + this.cfg.phases[ns].from && !this.stroke) { this.stage = ns; out.push({ type: 'stage', t: t, stage: ns }); }
    if (t >= this.endT) { this.stroke = null; this.f = {}; out.push({ type: 'timeup', t: this.endT }); this.over = this.good >= this.cfg.quota ? 'clear' : 'slow'; out.push({ type: 'end', t: this.endT, kind: this.over }); }
    return out;
  };
  Kanna.prototype._track = function (t) {
    var out = [], h = this.hands(); if (!h.L && !h.R) return out;
    var dyL = h.L ? h.L.y - h.L.y0 : 0, dyR = h.R ? h.R.y - h.R.y0 : 0;
    if (!(h.L && h.R)) {                                              // 片手で 引くと 傾いて 食い込む
      if (Math.max(dyL, dyR) > this.cfg.jam) { this.log.push({ grade: 'jam' }); this.bad++; this.f = {}; this.stroke = null; this.readyT = t + this.cfg.reset + 300; out.push({ type: 'judge', t: t, grade: 'jam', side: h.L ? 'L' : 'R' }); }
      return out;
    }
    var dy = (dyL + dyR) / 2;
    if (!this.stroke && dy > 8) this.stroke = { t0: t, y: this.y0, tilt: 0, drift: 0 };
    if (!this.stroke) return out;
    var st = this.stroke; st.y = this.y0 + Math.max(0, dy); st.tilt = Math.max(st.tilt, Math.abs(dyL - dyR)); st.drift = Math.max(st.drift, Math.abs((h.L.x - h.L.x0 + h.R.x - h.R.x0) / 2)); st.dL = dyL; st.dR = dyR;
    if (dy >= this.cfg.len) out = out.concat(this._judge(t, true));
    return out;
  };
  Kanna.prototype.ready = function (t) { return t >= this.readyT; };
  // 指 id を 左 / 右の取っ手に 割り当てる。both = マウス(PC)= 1 本で 両手の扱い
  Kanna.prototype.down = function (t, id, x, y, both) {
    var out = []; this.advance(t, out); if (this.over || t < this.readyT) return out;
    var g = this.grips(), R = this.cfg.gripR, side = null;
    if (both) { if (Math.hypot(x - this.x0, y - this.y0) < this.cfg.gripDX + R) side = 'both'; }
    else for (var i = 0; i < 2; i++) if (Math.hypot(x - g[i].x, y - g[i].y) <= R) side = i ? 'R' : 'L';
    if (!side) { out.push({ type: 'miss_start', t: t }); return out; }
    for (var k in this.f) if (this.f[k].side === side || this.f[k].side === 'both') return out;
    this.f[id] = { side: side, x: x, y: y, x0: x, y0: y };
    if (this.firstT == null) { this.firstT = t; this.endT = t + this.cfg.time; }
    out.push({ type: 'grip', t: t, side: side, hands: this.hands() }); return out;
  };
  Kanna.prototype.hands = function () { var L = null, Rr = null; for (var k in this.f) { var f = this.f[k]; if (f.side === 'L' || f.side === 'both') L = f; if (f.side === 'R' || f.side === 'both') Rr = f; } return { L: L, R: Rr }; };
  Kanna.prototype.move = function (t, id, x, y) { var f = this.f[id]; if (f) { f.x = x; f.y = y; } return []; };
  Kanna.prototype.up = function (t, id) {
    var out = []; this.advance(t, out); if (!this.f[id]) return out;
    var st = this.stroke; delete this.f[id];
    if (st) { out = out.concat(this._judge(t, false)); } else if (!Object.keys(this.f).length) this.f = {};
    return out;
  };
  Kanna.prototype._judge = function (t, full) {
    var st = this.stroke, c = this.cfg, dur = t - st.t0, thick = c.phases[this.stage].thick, tOk = c.tiltOk * (thick ? 0.7 : 1), gr;
    this.stroke = null; this.f = {};
    if (!full) gr = 'short';                          // 引ききっていない
    else if (st.tilt > tOk) gr = 'tilt';              // 傾いて 食い込んだ = 厚い かたまり
    else if (st.drift > c.driftOk) gr = 'drift';      // 横に それた
    else if (dur < c.minMs) gr = 'fast';              // 速すぎ = ちぎれた
    else if (dur > c.maxMs) gr = 'slow';              // 遅すぎ = ぼろぼろ
    else gr = st.tilt <= c.tiltGood * (thick ? 0.8 : 1) ? 'perfect' : 'good';
    this.log.push({ grade: gr, tilt: st.tilt, drift: st.drift, dur: dur });
    if (gr === 'perfect' || gr === 'good') { this.good++; if (gr === 'perfect') this.perfect++; } else this.bad++;
    this.readyT = t + c.reset;
    return [{ type: 'judge', t: t, grade: gr, tilt: st.tilt, dur: dur }];
  };
  Kanna.prototype.left = function (t) { return this.firstT == null ? this.cfg.time : Math.max(0, this.endT - t); };
  Kanna.prototype.flush = function () { return this.log.length ? Math.round(this.perfect / this.log.length * 100) : 0; };

  // ================= 六品目: 手回しドリルで 麺を ひと口ずつ 巻く(ねじり葱そば)=================
  // 指で ハンドルを持って 円を描く(右回り)= ドリルの先に 麺が巻きつく。速さの帯(lo〜hi)の中で 回すと 巻ける。
  // 速すぎ(snap を 0.2 秒 越える)= 麺が ぷつっと 切れて その ひと口は やり直し / 遅い・止まる・左回り = ほどける
  var CRANK = {
    time: 40000, quota: 8, top: 15, minR: 60, slack: 0.5, snapMs: 200, pause: 550,
    phases: [ { from: 0, lo: 0.6, hi: 2.3, snap: 2.9, need: 3 }, { from: 26000, lo: 0.6, hi: 1.7, snap: 2.1, need: 4, chef: 1 } ]   // 26 秒: 大将の 一杯(ゆっくり ていねいに・4 回)
  };
  function Crank(seed, cfg) {
    this.cfg = cfg || CRANK; this.firstT = null; this.endT = null; this.over = null; this.stage = 0;
    this.done = 0; this.snaps = 0; this.wound = 0; this.omega = 0; this.hist = []; this.f = null; this.overMs = 0; this.pauseT = 0; this.lastT = null; this.log = []; this.chefDone = 0;
  }
  Crank.prototype.ph = function () { return this.cfg.phases[this.stage]; };
  Crank.prototype.advance = function (t, out) {
    out = out || []; if (this.over) return out;
    if (this.firstT == null) { if (t >= IDLE_MS) { this.over = 'idle'; out.push({ type: 'end', t: IDLE_MS, kind: 'idle' }); } return out; }
    var dt = this.lastT == null ? 0 : Math.max(0, t - this.lastT); this.lastT = t;
    // 指が止まっている・離した = ゆるむ(ほどける)
    this.hist = this.hist.filter(function (h) { return t - h.t <= 160; });
    var sum = 0; for (var i = 0; i < this.hist.length; i++) sum += this.hist[i].d; this.omega = this.f ? sum / (2 * Math.PI) / 0.16 : 0;
    if (t >= this.pauseT && this.omega < this.ph().lo) this.wound = Math.max(0, this.wound - this.cfg.slack * dt / 1000);
    var ns = this.stage + 1;
    if (ns < this.cfg.phases.length && t >= this.firstT + this.cfg.phases[ns].from && this.wound < 0.3) { this.stage = ns; this.wound = 0; out.push({ type: 'stage', t: t, stage: ns }); }
    if (t >= this.endT) { this.f = null; out.push({ type: 'timeup', t: this.endT }); this.over = this.done >= this.cfg.quota ? 'clear' : 'slow'; out.push({ type: 'end', t: this.endT, kind: this.over }); }
    return out;
  };
  // c = ハンドルの 軸(舞台の座標)
  Crank.prototype.down = function (t, x, y, c) {
    var out = []; this.advance(t, out); if (this.over) return out;
    if (Math.hypot(x - c.x, y - c.y) < this.cfg.minR) { out.push({ type: 'miss_start', t: t }); return out; }
    if (this.firstT == null) { this.firstT = t; this.endT = t + this.cfg.time; this.lastT = t; }
    this.f = { c: c, a: Math.atan2(y - c.y, x - c.x), lt: t }; this.hist = []; out.push({ type: 'start', t: t }); return out;
  };
  Crank.prototype.move = function (t, x, y) {
    var out = [], f = this.f; if (!f || this.over) return out;
    if (Math.hypot(x - f.c.x, y - f.c.y) < this.cfg.minR * 0.6) return out;
    var a = Math.atan2(y - f.c.y, x - f.c.x), d = a - f.a, mdt = Math.min(60, Math.max(0, t - f.lt)); f.lt = t; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; f.a = a;
    this.hist.push({ t: t, d: d }); this.advance(t, out); if (this.over) return out;
    var p = this.ph(), w = this.omega;
    if (t < this.pauseT) return out;
    if (w > p.snap) { this.overMs += mdt; if (this.overMs >= this.cfg.snapMs) { this.snaps++; this.wound = 0; this.overMs = 0; this.pauseT = t + this.cfg.pause; this.log.push({ grade: 'snap' }); out.push({ type: 'snap', t: t }); return out; } }
    else this.overMs = Math.max(0, this.overMs - mdt / 2);
    if (d < 0) this.wound = Math.max(0, this.wound + d / (2 * Math.PI));              // 左回り = ほどける
    else if (w >= p.lo && w <= p.hi) { var before = this.wound; this.wound += d / (2 * Math.PI); out.push({ type: 'wind', t: t, turn: Math.floor(this.wound) > Math.floor(before) }); }
    if (this.wound >= p.need) {
      this.done++; if (p.chef) this.chefDone++; this.wound = 0; this.pauseT = t + this.cfg.pause; this.log.push({ grade: 'done', chef: !!p.chef }); out.push({ type: 'served', t: t, chef: !!p.chef });
    }
    return out;
  };
  Crank.prototype.up = function (t) { var out = []; this.advance(t, out); this.f = null; this.hist = []; return out; };
  Crank.prototype.left = function (t) { return this.firstT == null ? this.cfg.time : Math.max(0, this.endT - t); };
  Crank.prototype.flush = function () { var n = this.done + this.snaps; return n ? Math.round(this.done / n * 100) : 0; };


  // ================= 二品目: 金づちで 叩ききゅうり =================
  // きゅうりに 叩く所(節)が 並ぶ。節を 一回ずつ 叩く = ひびが入る。同じ節を もう一回 = つぶれる(その きゅうりは ぐちゃ)。節の外を 叩く = 空振り(数えない)
  // 全部の節に ひび = 一本できあがり → 皿へ・次の きゅうり
  var SMASH = {
    time: 32000, quota: 8, top: 14, len: 820, reach: 70, good: 26, reset: 380,
    phases: [ { from: 0, n: 4 }, { from: 16000, n: 6 } ]           // 16 秒: 大将「細かく 叩け」= 節が 6 つ(狭い)
  };
  function Smash(seed, cfg) {
    this.cfg = cfg || SMASH; this.r = rng(seed || 1); this.firstT = null; this.endT = null; this.over = null; this.stage = 0;
    this.done = 0; this.ruined = 0; this.hits = 0; this.perfect = 0; this.misses = 0; this.log = []; this.readyT = 0; this.cur = null; this.n = 0; this._spawn(0);
  }
  Smash.prototype._spawn = function (t) {
    var k = this.cfg.phases[this.stage].n, L = this.cfg.len, segs = [];
    for (var i = 0; i < k; i++) { var u = (i + 0.5) / k; segs.push({ u: u + (this.r() - 0.5) * 0.25 / k, hit: 0 }); }
    this.cur = { id: this.n++, segs: segs, t0: t, result: null };
  };
  // c = きゅうりの まん中(舞台の座標)。節の位置 = c.x + (u - 0.5) × len
  Smash.prototype.spot = function (c, i) { return { x: c.x + (this.cur.segs[i].u - 0.5) * this.cfg.len, y: c.y }; };
  Smash.prototype.advance = function (t, out) {
    out = out || []; if (this.over) return out;
    if (this.firstT == null) { if (t >= IDLE_MS) { this.over = 'idle'; out.push({ type: 'end', t: IDLE_MS, kind: 'idle' }); } return out; }
    var ns = this.stage + 1;
    if (ns < this.cfg.phases.length && t >= this.firstT + this.cfg.phases[ns].from && t >= this.readyT && this.cur.segs.every(function (s) { return !s.hit; })) { this.stage = ns; this._spawn(t); out.push({ type: 'stage', t: t, stage: ns }); }
    if (t >= this.endT) { out.push({ type: 'timeup', t: this.endT }); this.over = this.done >= this.cfg.quota ? 'clear' : 'slow'; out.push({ type: 'end', t: this.endT, kind: this.over }); }
    return out;
  };
  Smash.prototype.ready = function (t) { return t >= this.readyT; };
  Smash.prototype.tap = function (t, x, y, c) {
    var out = []; this.advance(t, out); if (this.over || t < this.readyT) return out;
    if (this.firstT == null) { this.firstT = t; this.endT = t + this.cfg.time; }
    var best = -1, bd = 1e9;
    for (var i = 0; i < this.cur.segs.length; i++) { var p = this.spot(c, i), d = Math.hypot(x - p.x, (y - p.y) * 0.8); if (d < bd) { bd = d; best = i; } }
    var lim = Math.min(this.cfg.reach, this.cfg.len / this.cur.segs.length * 0.5);
    if (best < 0 || bd > lim) { this.misses++; this.log.push({ grade: 'miss' }); out.push({ type: 'judge', t: t, grade: 'miss', x: x, y: y }); return out; }
    var sg = this.cur.segs[best];
    if (sg.hit) {                                                     // 同じ節を もう一回 = つぶれる
      this.cur.result = 'ruined'; this.ruined++; this.log.push({ grade: 'mush' }); out.push({ type: 'judge', t: t, grade: 'mush', seg: best, d: this.cur });
      out.push({ type: 'cucumber', t: t, result: 'ruined', d: this.cur }); this.readyT = t + this.cfg.reset + 200; this._spawn(this.readyT); return out;
    }
    sg.hit = bd <= this.cfg.good ? 2 : 1; this.hits++; if (sg.hit === 2) this.perfect++;
    this.log.push({ grade: sg.hit === 2 ? 'perfect' : 'hit' }); out.push({ type: 'judge', t: t, grade: sg.hit === 2 ? 'perfect' : 'hit', seg: best, d: this.cur });
    if (this.cur.segs.every(function (s) { return s.hit; })) { this.cur.result = 'done'; this.done++; out.push({ type: 'cucumber', t: t, result: 'done', d: this.cur }); this.readyT = t + this.cfg.reset; this._spawn(this.readyT); }
    return out;
  };
  Smash.prototype.left = function (t) { return this.firstT == null ? this.cfg.time : Math.max(0, this.endT - t); };
  Smash.prototype.flush = function () { var n = this.hits + this.misses; return n ? Math.round(this.perfect / n * 100) : 0; };

  // ================= 七品目: のこぎりで 骨付きスペアリブを 切り分ける =================
  // 肉の上に 大将が引いた 鉛筆の線(骨の間)。線の上に指を置いて 上下に 往復 = のこぎりが 進む。動かした長さが たまると 切れる。
  // 線から それて 動かした分が 多いと 切り口が がたがた(数えない)
  var SAW = {
    time: 40000, quota: 9, top: 15, reach: 80, off: 48, need: 2200, reset: 420, ragged: 0.35, clean: 0.06, span: 360,
    phases: [ { from: 0, mult: 1 }, { from: 22000, mult: 1.5 } ]      // 22 秒: 太い骨(1.5 倍 引かないと 切れない)
  };
  function Saw(seed, cfg) {
    this.cfg = cfg || SAW; this.firstT = null; this.endT = null; this.over = null; this.stage = 0;
    this.done = 0; this.bad = 0; this.perfect = 0; this.log = []; this.readyT = 0; this.cut = null; this.f = null; this.n = 0;
  }
  Saw.prototype.need = function () { return this.cfg.need * this.cfg.phases[this.stage].mult; };
  Saw.prototype.advance = function (t, out) {
    out = out || []; if (this.over) return out;
    if (this.firstT == null) { if (t >= IDLE_MS) { this.over = 'idle'; out.push({ type: 'end', t: IDLE_MS, kind: 'idle' }); } return out; }
    var ns = this.stage + 1;
    if (ns < this.cfg.phases.length && t >= this.firstT + this.cfg.phases[ns].from && !this.cut) { this.stage = ns; out.push({ type: 'stage', t: t, stage: ns }); }
    if (t >= this.endT) { this.f = null; out.push({ type: 'timeup', t: this.endT }); this.over = this.done >= this.cfg.quota ? 'clear' : 'slow'; out.push({ type: 'end', t: this.endT, kind: this.over }); }
    return out;
  };
  Saw.prototype.ready = function (t) { return t >= this.readyT; };
  // L = 線 { x, y0, y1 }(舞台の座標)
  Saw.prototype.down = function (t, x, y, L) {
    var out = []; this.advance(t, out); if (this.over || t < this.readyT) return out;
    if (Math.abs(x - L.x) > this.cfg.reach || y < L.y0 - 60 || y > L.y1 + 60) { out.push({ type: 'miss_start', t: t }); return out; }
    if (this.firstT == null) { this.firstT = t; this.endT = t + this.cfg.time; }
    if (!this.cut) this.cut = { len: 0, offLen: 0, t0: t, strokes: 0 };
    this.f = { x: x, y: y, L: L, dir: 0 }; out.push({ type: 'start', t: t }); return out;
  };
  Saw.prototype.move = function (t, x, y) {
    var out = [], f = this.f, c = this.cut; if (!f || !c || this.over) return out;
    var dy = y - f.y, dl = Math.abs(dy), dir = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    if (dir && f.dir && dir !== f.dir) { c.strokes++; out.push({ type: 'stroke', t: t, n: c.strokes }); }
    if (dir) f.dir = dir;
    c.len += dl; if (Math.abs(x - f.L.x) > this.cfg.off) c.offLen += dl;
    f.x = x; f.y = y;
    if (c.len >= this.need()) {
      var r = c.offLen / c.len, gr = r <= this.cfg.clean ? 'perfect' : r <= this.cfg.ragged ? 'good' : 'ragged';
      this.log.push({ grade: gr, r: r, strokes: c.strokes }); if (gr === 'ragged') this.bad++; else { this.done++; if (gr === 'perfect') this.perfect++; }
      this.cut = null; this.f = null; this.n++; this.readyT = t + this.cfg.reset; out.push({ type: 'judge', t: t, grade: gr, r: r });
    }
    return out;
  };
  Saw.prototype.up = function (t) { var out = []; this.advance(t, out); this.f = null; return out; };
  Saw.prototype.progress = function () { return this.cut ? Math.min(1, this.cut.len / this.need()) : 0; };
  Saw.prototype.left = function (t) { return this.firstT == null ? this.cfg.time : Math.max(0, this.endT - t); };
  Saw.prototype.flush = function () { return this.log.length ? Math.round(this.perfect / this.log.length * 100) : 0; };
  var api = { Staple: Staple, Cut: Cut, Caulk: Caulk, Kanna: Kanna, Crank: Crank, Smash: Smash, Saw: Saw, STAPLE: STAPLE, CUT: CUT, CAULK: CAULK, KANNA: KANNA, CRANK: CRANK, SMASH: SMASH, SAW: SAW, flowerR: flowerR, IDLE_MS: IDLE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GZTools = api;
})(typeof window !== 'undefined' ? window : globalThis);
