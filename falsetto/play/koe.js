// 声の高さを測る(裏声エレベーター)。マイク → 16kHz 前後に間引き → YIN → 中央値 → オクターブ誤りの保留 → 70ms の平滑。
// 設計: ~/Dev/studio/docs/2026-11-10_voice_design.md の「Codex レビュー反映」。
// ⚠️解析はこの端末の中だけ。音はどこにも送らないし、スピーカーにも返さない(ハウリングする)。
// Godot からは window.koe.read() を毎フレーム読む。検証は web/koe_test.html + tools/koe_test.mjs。
window.koe = (function () {
  const N = 1024;                 // 解析窓(間引き後のサンプル数。16kHz で 64ms)
  const FMIN = 70, FMAX = 1100;   // 地声の低い所〜裏声
  const YIN_THR = 0.15;
  const PERIOD_MS = 33;
  let ctx = null, stream = null, src = null, an = null, raw = null, x = new Float32Array(N), timer = 0;
  let state = 'off';              // off / asking / on / denied
  let sr = 16000, decim = 3;
  let floorDb = -70;              // 雑音床(下がるのは速く、上がるのは遅く)
  let hist = [];                  // 直近の有効値(半音、MIDI 番号の小数)
  let smooth = NaN, lastAccepted = NaN, holdUntil = 0, holdCand = NaN, lastT = 0, lastValidT = -1e9;
  const out = { valid: 0, midi: 0, db: -120, clarity: 0, t: 0, rawMidi: 0, frames: 0 };

  function yin(buf, rate) {
    const tauMin = Math.max(2, Math.floor(rate / FMAX)), tauMax = Math.min(N >> 1, Math.ceil(rate / FMIN));
    const W = N - tauMax;
    const d = new Float32Array(tauMax + 2);
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const v = buf[j] - buf[j + tau]; s += v * v; }
      d[tau] = s;
    }
    // 累積平均で正規化
    let run = 0; const dn = new Float32Array(tauMax + 2); dn[0] = 1;
    for (let tau = 1; tau <= tauMax + 1; tau++) { run += d[tau]; dn[tau] = run > 0 ? d[tau] * tau / run : 1; }
    let best = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (dn[tau] < YIN_THR) { while (tau + 1 <= tauMax && dn[tau + 1] < dn[tau]) tau++; best = tau; break; }
    }
    if (best < 0) { let m = 1e9; for (let tau = tauMin; tau <= tauMax; tau++) if (dn[tau] < m) { m = dn[tau]; best = tau; } }
    const refine = (tau) => {     // 放物線で谷の底を補間
      if (tau <= 1 || tau >= tauMax) return tau;
      const a = dn[tau - 1], b = dn[tau], c = dn[tau + 1], den = a - 2 * b + c;
      return den > 1e-9 ? tau + 0.5 * (a - c) / den : tau;
    };
    return { f: rate / refine(best), clarity: 1 - dn[best], dn: dn, tau: best, tauMin: tauMin, tauMax: tauMax, refine: refine };
  }
  const toMidi = (f) => 69 + 12 * Math.log2(f / 440);

  function tick() {
    if (!an) return;
    const now = performance.now();
    const dt = lastT ? Math.min(0.2, (now - lastT) / 1000) : PERIOD_MS / 1000; lastT = now;
    an.getFloatTimeDomainData(raw);
    // 間引き(decim 個の平均 = 簡易ローパス)。いちばん新しい側から N 個
    const off = raw.length - N * decim;
    let e = 0;
    for (let i = 0; i < N; i++) { let s = 0; const b = off + i * decim; for (let k = 0; k < decim; k++) s += raw[b + k]; x[i] = s / decim; e += x[i] * x[i]; }
    const db = 10 * Math.log10(e / N + 1e-12);
    out.db = db; out.t = now; out.frames++;
    let valid = false, m = NaN;
    if (db > Math.max(floorDb + 10, -62)) {
      const r = yin(x, sr);
      out.clarity = r.clarity;
      if (r.clarity > 0.55 && r.f >= FMIN && r.f <= FMAX) {
        m = toMidi(r.f); valid = true;
        // オクターブ誤り: 前の値から 9〜15 半音跳んだら、まず疑う。半分/倍の周期も同じくらい周期的なら前に近い方を採るが、
        // ⚠️それも 100ms まで。跳んだ先に居続けたら本当に声を変えたので採用する
        //   (Codex 2026-11-10: ここに上限が無く、220→440Hz に上げても 220 のまま固まっていた)
        if (!isNaN(lastAccepted) && now - lastValidT < 400) {
          const jump = m - lastAccepted;
          if (Math.abs(jump) > 9 && Math.abs(jump) < 15) {
            if (isNaN(holdCand) || Math.abs(holdCand - m) > 2) { holdCand = m; holdUntil = now + 100; }
            if (now < holdUntil) {
              const alt = jump > 0 ? r.tau * 2 : Math.round(r.tau / 2);
              if (alt >= r.tauMin && alt <= r.tauMax && r.dn[alt] < r.dn[r.tau] + 0.12) m = toMidi(sr / r.refine(alt));
              else m = lastAccepted;
            } else { holdCand = NaN; hist = []; smooth = m; }   // 採用。⚠️中央値の履歴も捨てる(残すと前の音に戻され、また保留に入って固まる)
          } else holdCand = NaN;
        }
      }
    } else out.clarity = 0;
    if (!valid) {
      // ⚠️雑音床は声が出ていない間だけ動かす(発声中も上げると、小声の伸ばしが途中から無音扱いになる)
      if (db < floorDb) floorDb += (db - floorDb) * Math.min(1, dt / 0.1); else floorDb += (db - floorDb) * Math.min(1, dt / 3.0);
      floorDb = Math.max(-90, Math.min(-35, floorDb));
    }
    if (valid) {
      out.rawMidi = m;
      if (now - lastValidT > 250) { hist = []; smooth = NaN; }   // 黙ったあとの出だしは引きずらない
      hist.push(m); if (hist.length > 3) hist.shift();
      const med = hist.slice().sort((a, b) => a - b)[hist.length >> 1];
      smooth = isNaN(smooth) ? med : smooth + (med - smooth) * (1 - Math.exp(-dt / 0.07));
      lastAccepted = med; lastValidT = now;
      out.valid = 1; out.midi = smooth;
    } else out.valid = 0;
  }

  async function start() {
    if (state === 'asking') return state;
    if (state === 'on') { try { if (ctx && ctx.state !== 'running') ctx.resume(); } catch (e) {} return state; }
    state = 'asking';
    // ⚠️AudioContext は**ボタンを押した処理の中で(await の前に)**作って resume する。
    //   iOS Safari はマイク許可の await をはさむと「ユーザー操作」扱いが切れて、止まったままになる
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.__noTap = true;                 // 録画用の分岐(shell.html)に、この解析用の文脈を拾わせない
      ctx.resume();
      ctx.onstatechange = () => { if (ctx && ctx.state !== 'running' && state === 'on') try { ctx.resume(); } catch (e) {} };
    } catch (e) { state = 'denied'; return state; }
    try {
      // ⚠️通話用の加工(エコー除去・雑音抑制・自動音量)は歌声を潰すので切る
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false });
    } catch (e) { try { ctx.close(); } catch (e2) {} ctx = null; state = 'denied'; return state; }
    try {
      decim = Math.max(1, Math.round(ctx.sampleRate / 16000)); sr = ctx.sampleRate / decim;
      src = ctx.createMediaStreamSource(stream);
      an = ctx.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0;
      while (an.fftSize < N * decim) an.fftSize *= 2;
      raw = new Float32Array(an.fftSize);
      src.connect(an);
      // Safari は出口に繋がっていない枝を回さない。音量 0 で繋ぐ(スピーカーには出ない)
      const mute = ctx.createGain(); mute.gain.value = 0; an.connect(mute); mute.connect(ctx.destination);
      // マイクが途中で切れたら(イヤホンを抜いた・他のアプリに取られた)、黙って落ちずに知らせる
      stream.getAudioTracks().forEach(t => { t.onended = () => { if (state === 'on') { stop(); state = 'denied'; } }; });
      timer = setInterval(tick, PERIOD_MS);   // ⚠️rAF は裏に回ると止まるので setInterval
      state = 'on';
      try { if (window.__micAttach) window.__micAttach(); } catch (e) {}   // 録画中に始めた場合も声を動画へ
    } catch (e) { stop(); state = 'denied'; }
    return state;
  }
  function stop() {
    clearInterval(timer); timer = 0;
    try { if (stream) stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { if (ctx) ctx.close(); } catch (e) {}
    ctx = stream = src = an = null; state = 'off'; out.valid = 0; hist = []; smooth = NaN; lastAccepted = NaN;
    return state;
  }
  return {
    start: start, stop: stop,
    state: () => state,
    // Godot が毎フレーム読む。「有効,半音(MIDI),dB,周期性,取り込み回数」
    read: () => out.valid + ',' + out.midi.toFixed(3) + ',' + out.db.toFixed(1) + ',' + out.clarity.toFixed(2) + ',' + out.frames,
    stream: () => stream,
    _out: out, _an: () => an, _tick: tick, _yin: yin,
  };
})();
