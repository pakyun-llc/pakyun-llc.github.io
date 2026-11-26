// 鼻ボタン(3 版め): 遊びの式だけ(画面・音・入力の取り方は知らない)。ブラウザでも node でも同じものを読む。
// 話: 寝ている犬の顔にゲーム機を乗せて、鼻をスティックにして遊ぶ。液晶の中の 小さな犬(= 夢の中の この犬)を鼻で動かして ほねを食べさせる。
//     そっと動かせば 犬は寝たまま。雑に動かすと 犬が起きて ゲーム機をはね飛ばし、顔が出たら おしまい。
// 時刻は ms、スティックは −1〜1、液晶の中は FW x FH の升目(画面の大きさは知らない)。ネイティブへ移すときは この式を そのまま写す。
(function (root) {
  'use strict';
  // 液晶の ほねパクパク
  var FW = 435, FH = 275, START = [217, 150];          // 液晶の広さ / 犬の出だしの位置
  var SPEED = 250, DZ = 0.12, FULL = 0.72;              // 倒すと その向きへ進む。0.72 で いちばん速い(それ以上 倒しても速くならない)
  var EAT = 36;                                         // 犬と ほねが これより近づくと たべる
  var GOAL = 20, LIVES = 3;                             // 20 本 たべたら クリア / ほねが 3 本 消えたら 液晶のゲームは おしまい
  var LIFE0 = 4600, LIFE_STEP = 110, LIFE_MIN = 2700, BLINK = 1200;   // ほねが消えるまで(1 本ごとに 短く)/ 消える前に点滅
  var GAP = 380, FIRST = 900;                           // 次のほねが出るまで / 1 本め
  // 起きかけ(wake 0〜1。1 で犬が顔を出す)
  var K_MOVE = 0.014;                                   // 鼻を 1.0 ぶん動かすごとに
  var V0 = 6.0;                                         // これより速い動き(1.0/秒 単位)は 2 乗で効く = 雑なほど起きる
  var K_TILT = 0.30, TILT_FREE = 0.85;                  // 倒しすぎ(0.85 より外)は 押しつけている間ずっと
  var DECAY_HOLD = 0.012, DECAY_FREE = 0.030;           // じっとしていると落ち着く(指を離すと もっと)
  var LIGHT_MULT = 3.5;                                 // 眠りが浅い間(いびきが止まる)は 3.5 倍 効く
  var STAGE = [0.34, 0.67, 1.0];                        // もぞっ / フガッ(パッドがはねる)/ 顔が出る
  var LIGHTS = [9000, 17500, 25500, 33000, 40500, 48000], LIGHT_LEN = 1900, LIGHT_WARN = 650;

  function rng(seed) { var s = (seed >>> 0) || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function makeChart(seed) {
    var r = rng(seed || 1), i; for (i = 0; i < 6; i++) r();
    var lights = LIGHTS.map(function (a) { var t0 = a + Math.round((r() - 0.5) * 1600); return { t0: t0, t1: t0 + LIGHT_LEN, warn: t0 - LIGHT_WARN }; });
    return { lights: lights, seed: seed, r: r };
  }
  // スティック → 液晶の犬の速さ(升目/秒)。ネイティブも これを使う
  function vel(x, y) {
    var m = Math.sqrt(x * x + y * y); if (m <= DZ) return [0, 0];
    var s = SPEED * Math.min(1, (m - DZ) / (FULL - DZ)); return [x / m * s, y / m * s];
  }
  function moveDog(p, x, y, dt) {
    var v = vel(x, y);
    p[0] = Math.max(22, Math.min(FW - 22, p[0] + v[0] * dt)); p[1] = Math.max(22, Math.min(FH - 22, p[1] + v[1] * dt));
    return v;
  }
  function inHud(x, y) { return (x < 120 && y < 64) || (x > FW - 110 && y < 56) || (x < 110 && y > FH - 80); }

  function Game(chart) {
    this.chart = chart; this.r = chart.r;
    this.x = 0; this.y = 0; this.touch = false; this.t = 0; this.tIn = -1e9;
    this.dog = START.slice(); this.face = [0, 1];
    this.wake = 0; this.peak = 0; this.stage = 0; this.light = false;
    this.caught = 0; this.missed = 0; this.over = null; this.log = [];
    this.bone = null; this.nextAt = FIRST; this.n = 0;
  }
  Game.prototype.isLight = function (t) { var L = this.chart.lights; for (var i = 0; i < L.length; i++) if (t >= L[i].t0 && t < L[i].t1) return true; return false; };
  Game.prototype._wake = function (dw, t, out) {
    if (this.over) return;
    this.wake = Math.max(0, this.wake + dw); if (this.wake > this.peak) this.peak = Math.min(1, this.wake);
    var st = 0; for (var s = 0; s < 3; s++) if (this.wake >= STAGE[s]) st = s + 1;
    if (st !== this.stage) { var up = st > this.stage; this.stage = st; out.push({ type: 'stage', stage: st, up: up }); }
    if (st >= 3) { this.over = 'woke'; out.push({ type: 'end', kind: 'woke', t: t }); }
  };
  Game.prototype._spawn = function (t, out) {
    var r = this.r, x, y, k = 0;
    do { x = 46 + r() * (FW - 92); y = 46 + r() * (FH - 92); k++; }
    while (k < 40 && (inHud(x, y) || Math.hypot(x - this.dog[0], y - this.dog[1]) < 120));
    var life = Math.max(LIFE_MIN, LIFE0 - this.n * LIFE_STEP);
    this.bone = { i: this.n++, x: x, y: y, t0: t, t1: t + life };
    out.push({ type: 'spawn', bone: this.bone });
  };
  Game.prototype._done = function (ok, t, out) {
    var b = this.bone; b.res = ok ? 'catch' : 'miss'; b.at = t; this.bone = null; this.nextAt = t + GAP;
    if (ok) this.caught++; else this.missed++;
    this.log.push({ i: b.i, res: b.res, ms: Math.round(t - b.t0) });
    out.push({ type: b.res, bone: b });
    if (this.missed >= LIVES) { this.over = 'lcdover'; out.push({ type: 'end', kind: 'lcdover', t: t }); }
    else if (this.caught >= GOAL) { this.over = 'clear'; out.push({ type: 'end', kind: 'clear', t: t }); }
  };
  // 時刻 t まで進める(スティックは いまの位置のまま)
  Game.prototype.advance = function (t, out) {
    out = out || [];
    while (!this.over && this.t < t) {
      var t1 = Math.min(t, this.t + 16), dt = (t1 - this.t) / 1000, lt = this.isLight(this.t);
      if (lt !== this.light) { this.light = lt; out.push({ type: 'light', on: lt }); }
      var m = Math.sqrt(this.x * this.x + this.y * this.y), dw = -(this.touch ? DECAY_HOLD : DECAY_FREE) * dt;
      if (this.touch && m > TILT_FREE) dw += K_TILT * (m - TILT_FREE) / 0.4 * dt * (lt ? LIGHT_MULT : 1);
      var v = this.touch ? moveDog(this.dog, this.x, this.y, dt) : [0, 0];
      if (v[0] || v[1]) { var vm = Math.sqrt(v[0] * v[0] + v[1] * v[1]); this.face = [v[0] / vm, v[1] / vm]; }
      this.t = t1; this._wake(dw, t1, out); if (this.over) break;
      if (!this.bone && t1 >= this.nextAt) this._spawn(t1, out);
      var b = this.bone;
      if (b && Math.hypot(b.x - this.dog[0], b.y - this.dog[1]) < EAT) this._done(true, t1, out);
      else if (b && t1 >= b.t1) this._done(false, t1, out);
    }
    return out;
  };
  // 指が動いた(t = その出来事の時刻)
  Game.prototype.input = function (t, x, y, touch) {
    var out = []; this.advance(t, out); if (this.over) return out;
    var dx = x - this.x, dy = y - this.y, d = Math.sqrt(dx * dx + dy * dy);
    if (touch && this.touch && d > 0) {                              // 押したままの動きだけ数える(離して戻るのは 犬にとって楽)
      var dt = Math.max(4, Math.min(50, t - this.tIn)) / 1000, v = d / dt;
      this._wake(d * K_MOVE * (1 + (v / V0) * (v / V0)) * (this.isLight(t) ? LIGHT_MULT : 1), t, out);
    }
    this.x = x; this.y = y; this.touch = touch; this.tIn = t;
    return out;
  };
  Game.prototype.sleepPct = function () { return Math.round((1 - Math.min(1, this.peak)) * 100); };
  Game.prototype.progress = function () { return this.caught / GOAL; };
  // 称号: 0 しのびの親指 / 1 いい親指 / 2 ひやひや親指(ここまでクリア)/ 3 やさしすぎる親指(液晶で負け)/ 4 起こした
  function title(g) { return g.over === 'woke' ? 4 : g.over === 'lcdover' ? 3 : g.peak < STAGE[0] ? 0 : g.peak < STAGE[1] ? 1 : 2; }

  var api = { makeChart: makeChart, Game: Game, title: title, rng: rng, vel: vel, moveDog: moveDog,
    K: { FW: FW, FH: FH, START: START, EAT: EAT, GOAL: GOAL, LIVES: LIVES, BLINK: BLINK, STAGE: STAGE, LIGHT_WARN: LIGHT_WARN, TILT_FREE: TILT_FREE } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HBGame = api;
})(typeof window !== 'undefined' ? window : globalThis);
