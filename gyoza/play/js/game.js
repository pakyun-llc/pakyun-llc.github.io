// ドリル飯店(旧 餃子とドリル): 遊びの式だけ(画面・音・入力の取り方は知らない)。ブラウザでも node でも同じものを読む。
// 時刻は ms(0 = 出勤した時)。深さの単位は「ネジの長さ」で、x = 頭が皮に触れてから沈んだ量(マイナス = まだ浮いている)。
(function (root) {
  'use strict';
  // ---- 定数 ----
  var SHIFT_MS = 45000;      // 1 回目の引き金から ラッシュが終わるまで
  var IDLE_MS = 10000;       // 出勤してから 一度も引かないと「立っていただけ」で終わる
  var SPIN_MS = 140;         // 引き金を引いてから 回転が上がりきるまで
  var V = 1.0;               // ネジが進む速さ(LO・皮に触れる前。単位/秒)
  var GEAR_HI = 1.5;         // HI にすると 1.5 倍
  var LOAD = 0.4;            // 皮に触れたあとは 重くなって 0.4 倍
  var HOP_MS = 140;          // 次のネジへ ドリルが移る間
  var SWAP_MS = 420;         // 次の餃子が来る間
  var TEAR_MS = 900;         // 破いたあと 片づける間
  var MAX_TEARS = 3;         // 3 コ破くと クビ
  var QUOTA = 5;             // 茹でて開かなかった数が これ未満だと 不合格
  // 皮: ぴたっ = p0〜p1 / 触れてから tear まで沈めると 破れる
  var SKIN = { normal: { p0: 0.03, p1: 0.10, tear: 0.17 }, thin: { p0: 0.02, p1: 0.07, tear: 0.12 },
    easy: { p0: 0.025, p1: 0.13, tear: 0.20 }, ebi: { p0: 0.025, p1: 0.07, tear: 0.12 } };   // 11-27 餃子だけ版: easy = 一品目の はじめ(必ず 優が出る)/ ebi = エビ蒸し(透ける 薄皮・窓が 狭い)
  var LEN = { S: 0.40, M: 0.60, L: 0.85, G: 0.60, R: 0.60 };   // G = 金ネジ(ぴたっで 閉めた 餃子が 2 コ分)/ R = 錆びネジ(皮に入ってから 重い)
  var RUST = 0.6;
  // 時間で進む(店長が言う): 0 秒〜 ネジ 3 本 / 15 秒〜 注文が入って 4 本・長さが ばらばら / 30 秒〜 HI・5 本もある・薄皮がまじる
  var STAGES = [
    { from: 0, screws: [3], lens: 'M', gear: 1, thin: 0 },
    { from: 15000, screws: [4], lens: 'SML', gear: 1, thin: 0 },
    { from: 30000, screws: [4, 5], lens: 'SML', gear: GEAR_HI, thin: 0.4 }
  ];

  function rng(seed) { var s = (seed >>> 0) || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  // 引き金を tau ms 引いたときの x(len = ネジの長さ、gear = 1 か 1.5)
  function travel(tau, gear) { var v = V * gear / 1000; return tau < SPIN_MS ? v * tau * tau / (2 * SPIN_MS) : v * (tau - SPIN_MS / 2); }
  function contactMs(len, gear) { return len / (V * gear / 1000) + SPIN_MS / 2; }
  function xAt(tau, len, gear, lk) {
    var tc = contactMs(len, gear);
    if (tau <= tc) return travel(tau, gear) - len;
    return (tau - tc) * V * gear * LOAD * (lk || 1) / 1000;
  }
  // x まで沈めるのに 引いておく時間(x >= 0)。lk = 錆びネジの 重さ(0.6)
  function holdFor(x, len, gear, lk) { return contactMs(len, gear) + x / (V * gear * LOAD * (lk || 1) / 1000); }
  function grade(x, skin) { var s = SKIN[skin]; return x >= s.tear ? 'tear' : x < 0 ? 'loose' : (x >= s.p0 && x <= s.p1) ? 'perfect' : 'ok'; }

  // cfg = その面の決まり(省くと 前からの 45 秒の 1 本)。time / quota / tears / phases(上の STAGES と同じ形)
  var CLASSIC = { time: SHIFT_MS, quota: QUOTA, tears: MAX_TEARS, phases: STAGES };
  function Game(seed, cfg) {
    this.seed = seed || 1; this.r = rng(this.seed);
    cfg = cfg || CLASSIC; this.cfg = cfg; this.P = cfg.phases; this.TIME = cfg.time || SHIFT_MS; this.QUOTA = cfg.quota || QUOTA; this.TEARS = cfg.tears || MAX_TEARS;
    this.phase = 'wait';       // wait(まだ引いていない)/ ready / drill / hop / swap / over
    this.firstT = null; this.endT = null; this.readyT = 0; this.t0 = 0;
    this.down = false; this.fresh = false;
    this.stage = 0; this.n = 0;
    this.cur = null; this.done = [];           // done = 皿に乗った餃子 [{result:'closed'|'loose', screws, thin}]
    this.tears = 0; this.closed = 0; this.opened = 0; this.perfect = 0; this.driven = 0; this.pulls = 0;
    this.over = null; this.log = [];
    this._spawn(0);
  }
  Game.prototype._stageAt = function (t) { var e = this.firstT == null ? 0 : t - this.firstT, s = 0; for (var i = 0; i < this.P.length; i++) if (e >= this.P[i].from) s = i; return s; };
  Game.prototype._spawn = function (t) {
    var st = this.P[this._stageAt(t)], r = this.r, n = st.screws[Math.floor(r() * st.screws.length)], sc = [];
    var easy = this.cfg.easyFirst && this.n < this.cfg.easyFirst, gold = this.cfg.goldP ? this.cfg.goldP * (this.cfg.goldK || 1) : 0;
    for (var i = 0; i < n; i++) { var k = easy ? 'M' : st.lens[Math.floor(r() * st.lens.length)]; if (!easy && gold && k !== 'R' && r() < gold) k = 'G'; sc.push({ len: LEN[k], kind: k, lk: k === 'R' ? RUST : 1, grade: null, x: -LEN[k] }); }
    this.cur = { id: this.n++, screws: sc, i: 0, skin: easy ? 'easy' : st.skin || (r() < st.thin ? 'thin' : 'normal'), result: null, limitT: this.cfg.limit && this.firstT != null ? t + this.cfg.limit : null };
  };
  Game.prototype.gear = function () { return this.P[this.stage].gear; };
  // いまの(引いている途中の)ネジの x。引いていなければ 置いたままの値
  Game.prototype.depth = function (t) {
    var c = this.cur; if (!c) return 0; var s = c.screws[Math.min(c.i, c.screws.length - 1)];
    if (this.phase === 'drill') return xAt(t - this.t0, s.len, this.g0, s.lk);
    return s.x;
  };
  Game.prototype._start = function (t, out) {
    if (this.firstT == null) { this.firstT = t; this.endT = t + this.TIME; if (this.cfg.limit) this.cur.limitT = t + this.cfg.limit; }
    this.phase = 'drill'; this.t0 = t; this.g0 = this.gear(); this.fresh = false; this.pulls++;
    var s = this.cur.screws[this.cur.i]; this.tearT = t + holdFor(SKIN[this.cur.skin].tear, s.len, this.g0, s.lk);
    out.push({ type: 'start', t: t, screw: this.cur.i });
  };
  Game.prototype._judge = function (t, out) {
    var c = this.cur, s = c.screws[c.i], x = xAt(t - this.t0, s.len, this.g0, s.lk), g = grade(x, c.skin);
    s.grade = g; s.x = x; this.driven++; if (g === 'perfect') this.perfect++;
    this.log.push({ d: c.id, i: c.i, grade: g, x: x, hold: t - this.t0 });
    out.push({ type: 'judge', t: t, grade: g, x: x, screw: c.i, d: c.id });
    if (g === 'tear') {
      c.result = 'torn'; this.tears++; out.push({ type: 'dumpling', t: t, result: 'torn', d: c });
      if (this.tears >= this.TEARS) return this._end('fired', t, out);
      if (this.cfg.oneShot) return this._end('shot', t, out);
      this.phase = 'swap'; this.readyT = t + TEAR_MS; return;
    }
    if (c.i >= c.screws.length - 1) {
      var loose = false; for (var k = 0; k < c.screws.length; k++) if (c.screws[k].grade === 'loose') loose = true;
      c.result = loose ? 'loose' : 'closed'; if (loose) this.opened++; else this.closed++;
      var bonus = 0; if (!loose) for (k = 0; k < c.screws.length; k++) if (c.screws[k].kind === 'G' && c.screws[k].grade === 'perfect') bonus++;   // 金ネジを ぴたっ = もう 1 コ分
      this.closed += bonus; this.gold = (this.gold || 0) + bonus;
      this.done.push(c); out.push({ type: 'dumpling', t: t, result: c.result, d: c, bonus: bonus });
      if (this.cfg.oneShot) return this._end(c.result === 'closed' ? 'clear' : 'shot', t, out);   // 大将の 投げ餃子 = 一発
      this.phase = 'swap'; this.readyT = t + (this.cfg.swap || SWAP_MS); return;
    }
    c.i++; this.phase = 'hop'; this.readyT = t + (this.cfg.hop || HOP_MS);
  };
  // 焦げる / 回転台で 通り過ぎる(1 コごとの 時計)= 打ち終わらなかった 餃子は 皿に 出せない(数えない)
  Game.prototype._limit = function (t, out) {
    var c = this.cur; c.result = this.cfg.limitKind || 'burnt'; this.missed = (this.missed || 0) + 1;
    if (this.phase === 'drill') { this.down = false; this.fresh = false; }
    out.push({ type: 'dumpling', t: t, result: c.result, d: c });          // 皿には 出さない(done に 入れない)
    this.phase = 'swap'; this.readyT = t + (this.cfg.swap || SWAP_MS);
  };
  Game.prototype._end = function (kind, t, out) { this.phase = 'over'; this.over = kind; out.push({ type: 'end', t: t, kind: kind }); };
  // 時刻 t まで進める
  Game.prototype.advance = function (t, out) {
    out = out || [];
    for (var guard = 0; guard < 1000 && !this.over; guard++) {
      if (this.firstT == null) { if (t >= IDLE_MS) this._end('idle', IDLE_MS, out); break; }
      // つぎに起きること(早い順): 店長の合図 / ラッシュ終わり / 破れる / 次の準備
      var ev = null, et = Infinity, ns = this.stage + 1;
      if (ns < this.P.length && this.firstT + this.P[ns].from < et) { ev = 'stage'; et = this.firstT + this.P[ns].from; }
      if (this.phase === 'drill' && this.tearT < et) { ev = 'tear'; et = this.tearT; }
      if (this.cur && this.cur.limitT != null && !this.cur.result && (this.phase === 'drill' || this.phase === 'ready' || this.phase === 'hop') && this.cur.limitT < et) { ev = 'limit'; et = this.cur.limitT; }
      if ((this.phase === 'hop' || this.phase === 'swap') && this.readyT < et) { ev = 'ready'; et = this.readyT; }
      if (this.endT <= et) { ev = 'timeup'; et = this.endT; }
      if (et > t) break;
      if (ev === 'stage') { this.stage = ns; out.push({ type: 'stage', t: et, stage: ns }); }
      else if (ev === 'tear') this._judge(et, out);
      else if (ev === 'limit') this._limit(et, out);
      else if (ev === 'ready') {
        var sw = this.phase === 'swap'; if (sw) { this._spawn(et); out.push({ type: 'spawn', t: et, d: this.cur }); }
        this.phase = 'ready'; if (this.down && this.fresh) this._start(et, out);
      } else {
        out.push({ type: 'timeup', t: et });
        this._end(this.closed >= this.QUOTA ? 'clear' : this.opened > this.closed ? 'soup' : 'slow', et, out);
      }
    }
    return out;
  };
  // 引き金(down = 引いた / 離した)。1 本のネジは 1 回の引きで決まる(離したら 次のネジへ)
  Game.prototype.input = function (t, down) {
    var out = []; this.advance(t, out); if (this.over || down === this.down) return out;
    this.down = down;
    if (down) { this.fresh = true; if (this.phase === 'wait' || this.phase === 'ready') this._start(t, out); }
    else if (this.phase === 'drill') this._judge(t, out);
    return out;
  };
  Game.prototype.left = function (t) { return this.firstT == null ? this.TIME : Math.max(0, this.endT - t); };
  Game.prototype.perMin = function () { return Math.round(this.closed * 600000 / this.TIME) / 10; };
  Game.prototype.flush = function () { return this.driven ? Math.round(this.perfect / this.driven * 100) : 0; };

  // 茹でても開かなかった数 → 肩書き(0 がいちばん上)
  // q = その面のノルマ(省くと 5 = 前からの線 10 / 8 / 6)、top = いちばん上の線(省くと q の 2 倍)
  function rank(closed, q, top) { q = q || QUOTA; return closed >= (top || q * 2) ? 0 : closed >= q + 3 ? 1 : closed >= q + 1 ? 2 : 3; }

  // 11-27(14 回目)餃子だけ版の ドリルの面(main.js の STG が 使う。sim.js でも 同じ物を 回す)
  function PH(from, screws, lens, gear, extra) { var o = { from: from, screws: screws, lens: lens, gear: gear || 1, thin: 0 }; for (var k in extra || {}) o[k] = extra[k]; return o; }
  var VARIANTS = {
    mizu: { time: 45000, quota: 5, tears: 3, easyFirst: 2, goldP: 0.04, phases: [PH(0, [3], 'M'), PH(15000, [4], 'SML'), PH(30000, [4, 5], 'SML', 1.5, { thin: 0.4 })] },
    hitokuchi: { time: 36000, quota: 10, tears: 3, swap: 240, hop: 100, goldP: 0.04, phases: [PH(0, [2], 'S'), PH(12000, [2], 'SSM'), PH(24000, [2], 'S', 1.5)] },
    ebi: { time: 45000, quota: 5, tears: 3, goldP: 0.04, phases: [PH(0, [3], 'M', 1, { skin: 'ebi' }), PH(15000, [3], 'SML', 1, { skin: 'ebi' }), PH(30000, [3, 4], 'SML', 1.5, { skin: 'ebi' })] },
    yaki: { time: 45000, quota: 5, tears: 3, limit: 6500, limitKind: 'burnt', goldP: 0.04, phases: [PH(0, [3], 'M'), PH(15000, [3, 4], 'SML'), PH(30000, [4], 'SML', 1.5, { thin: 0.3 })] },
    kaiten: { time: 45000, quota: 6, tears: 3, limit: 5600, limitKind: 'gone', goldP: 0.16, phases: [PH(0, [3], 'MMR'), PH(15000, [3], 'SMLR'), PH(30000, [3, 4], 'SMLR', 1.5)] },
    kyodai: { time: 60000, quota: 3, tears: 3, goldP: 0.04, phases: [PH(0, [6], 'SML'), PH(20000, [7], 'SML'), PH(40000, [8], 'SML', 1.5)] },
    finale: { time: 20000, quota: 1, tears: 9, oneShot: true, phases: [PH(0, [1], 'L', 1.5)] }
  };
  var api = { VARIANTS: VARIANTS, Game: Game, CLASSIC: CLASSIC, rng: rng, xAt: xAt, holdFor: holdFor, contactMs: contactMs, grade: grade, rank: rank,
    K: { RUST: RUST, SHIFT_MS: SHIFT_MS, IDLE_MS: IDLE_MS, SPIN_MS: SPIN_MS, V: V, LOAD: LOAD, HOP_MS: HOP_MS, SWAP_MS: SWAP_MS, TEAR_MS: TEAR_MS, MAX_TEARS: MAX_TEARS, QUOTA: QUOTA, SKIN: SKIN, LEN: LEN, STAGES: STAGES } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GZGame = api;
})(typeof window !== 'undefined' ? window : globalThis);
