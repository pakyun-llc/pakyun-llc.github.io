// 鼻ボタン(2 版め): 遊びの式だけ(画面・音・入力の取り方は知らない)。ブラウザでも node でも同じものを読む。
// 話: 寝ている犬の鼻をスティックにして 携帯ゲームを遊ぶ。うまく遊びつつ 起こさない。犬の顔が出たら おしまい。
// 時刻は ms、スティックは −1〜1。ネイティブへ移すときは この式を そのまま写す。
(function (root) {
  'use strict';
  var ZONE_MAG = 0.45, ZONE_ANG = 50;      // 液晶の犬が その向きを向く 倒し幅と角度
  var GRACE = 140;                         // ほねが口もとに居る時間(ms)。この間に向けば くわえる
  var LIVES = 4;                           // 落とせる数。4 つめで 液晶のゲームが おしまい
  // 起きかけ(wake 0〜1。1 で犬が顔を出す)
  var K_MOVE = 0.010;                     // 鼻を 1.0 ぶん動かすごとに
  var V0 = 9.0;                            // これより速い動き(1.0/秒 単位)は 2 乗で効く = 雑なほど起きる
  var K_TILT = 0.30, TILT_FREE = 0.85;     // 倒しすぎ(0.85 より外)は 押しつけている間ずっと
  var DECAY_HOLD = 0.012, DECAY_FREE = 0.030;   // じっとしていると落ち着く(指を離すと もっと)
  var LIGHT_MULT = 3.5;                    // 眠りが浅い間(いびきが止まる)は 3.5 倍 効く
  var STAGE = [0.34, 0.67, 1.0];           // もぞっ / フガッ(パッドがはねる)/ 顔が出る
  var PHASES = [[12000, 1500, 430], [26000, 1050, 380], [43500, 780, 300]];   // [ここまで ms, ほねの間隔, 1 コマの長さ]
  var LIGHTS = [14200, 26800, 34600, 40300], LIGHT_LEN = 1900, LIGHT_WARN = 650;
  var VEC = { L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1] }, DIRS = ['L', 'R', 'U', 'D'];

  function rng(seed) { var s = (seed >>> 0) || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function makeChart(seed) {
    var r = rng(seed || 1), items = [], t = 2600, prev = null, p = 0, i;
    for (i = 0; i < 6; i++) r();
    while (true) {
      while (p < PHASES.length && t > PHASES[p][0]) p++;
      if (p >= PHASES.length) break;
      var d; do { d = DIRS[Math.floor(r() * 4)]; } while (d === prev);      // 毎回 向きが変わる = 毎回 鼻を動かす
      items.push({ i: items.length, t: t, dir: d, step: PHASES[p][2] }); prev = d;
      t += PHASES[p][1];
    }
    var lights = LIGHTS.map(function (a) { var t0 = a + Math.round((r() - 0.5) * 1000); return { t0: t0, t1: t0 + LIGHT_LEN, warn: t0 - LIGHT_WARN }; });
    return { items: items, lights: lights, end: items[items.length - 1].t + GRACE + 400, seed: seed };
  }
  function zoneOf(x, y) {
    var m = Math.sqrt(x * x + y * y); if (m < ZONE_MAG) return null;
    for (var i = 0; i < 4; i++) { var v = VEC[DIRS[i]]; if ((x * v[0] + y * v[1]) / m >= Math.cos(ZONE_ANG * Math.PI / 180)) return DIRS[i]; }
    return null;
  }

  function Game(chart) {
    this.chart = chart; this.items = chart.items; this.k = 0;
    this.x = 0; this.y = 0; this.touch = false; this.t = 0; this.tIn = -1e9;
    this.wake = 0; this.peak = 0; this.stage = 0; this.light = false;
    this.caught = 0; this.missed = 0; this.over = null; this.log = [];
  }
  Game.prototype.isLight = function (t) { var L = this.chart.lights; for (var i = 0; i < L.length; i++) if (t >= L[i].t0 && t < L[i].t1) return true; return false; };
  Game.prototype._wake = function (dw, t, out) {
    if (this.over) return;
    this.wake = Math.max(0, this.wake + dw); if (this.wake > this.peak) this.peak = Math.min(1, this.wake);
    var st = 0; for (var s = 0; s < 3; s++) if (this.wake >= STAGE[s]) st = s + 1;
    if (st !== this.stage) { var up = st > this.stage; this.stage = st; out.push({ type: 'stage', stage: st, up: up }); }
    if (st >= 3) { this.over = 'woke'; out.push({ type: 'end', kind: 'woke', t: t }); }
  };
  Game.prototype._item = function (it, ok, t, out) {
    it.done = ok ? 'catch' : 'miss'; it.at = t; this.k = it.i + 1;
    if (ok) this.caught++; else this.missed++;
    this.log.push({ i: it.i, dir: it.dir, res: it.done, at: t - it.t });
    out.push({ type: it.done, item: it });
    if (this.over) return;
    if (this.missed >= LIVES) { this.over = 'lcdover'; out.push({ type: 'end', kind: 'lcdover', t: t }); }
    else if (this.k >= this.items.length) { this.over = 'clear'; out.push({ type: 'end', kind: 'clear', t: t }); }
  };
  // 時刻 t まで進める(スティックは いまの位置のまま)
  Game.prototype.advance = function (t, out) {
    out = out || [];
    while (!this.over && this.t < t) {
      var t1 = Math.min(t, this.t + 20), dt = (t1 - this.t) / 1000, lt = this.isLight(this.t);
      if (lt !== this.light) { this.light = lt; out.push({ type: 'light', on: lt }); }
      var m = Math.sqrt(this.x * this.x + this.y * this.y), dw = -(this.touch ? DECAY_HOLD : DECAY_FREE) * dt;
      if (this.touch && m > TILT_FREE) dw += K_TILT * (m - TILT_FREE) / 0.4 * dt * (lt ? LIGHT_MULT : 1);
      this.t = t1; this._wake(dw, t1, out);
      while (!this.over && this.k < this.items.length) {            // ほね
        var it = this.items[this.k]; if (t1 < it.t) break;
        if (zoneOf(this.x, this.y) === it.dir) { this._item(it, true, Math.max(it.t, Math.min(t1, this._zt || t1)), out); continue; }
        if (t1 >= it.t + GRACE) { this._item(it, false, t1, out); continue; }
        break;
      }
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
    this.x = x; this.y = y; this.touch = touch; this.tIn = t; this._zt = t;
    if (!this.over && this.k < this.items.length) {                  // 動いた その時刻で くわえたかを見る
      var it = this.items[this.k];
      if (t >= it.t && t < it.t + GRACE && zoneOf(x, y) === it.dir) this._item(it, true, t, out);
    }
    return out;
  };
  Game.prototype.sleepPct = function () { return Math.round((1 - Math.min(1, this.peak)) * 100); };
  Game.prototype.progress = function () { return this.k / this.items.length; };
  // 称号: 0 しのびの親指 / 1 いい親指 / 2 ひやひや親指(ここまでクリア)/ 3 やさしすぎる親指(液晶で負け)/ 4 起こした
  function title(g) { return g.over === 'woke' ? 4 : g.over === 'lcdover' ? 3 : g.peak < STAGE[0] ? 0 : g.peak < STAGE[1] ? 1 : 2; }

  var api = { makeChart: makeChart, Game: Game, zoneOf: zoneOf, title: title, VEC: VEC, rng: rng,
    K: { ZONE_MAG: ZONE_MAG, GRACE: GRACE, LIVES: LIVES, STAGE: STAGE, LIGHT_WARN: LIGHT_WARN } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HBGame = api;
})(typeof window !== 'undefined' ? window : globalThis);
