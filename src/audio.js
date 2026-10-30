// Procedural sound: every sound here is synthesised with WebAudio, no audio files.
const NOTE = (m) => 440 * Math.pow(2, (m - 69) / 12);
const CHORDS = [
  { root: 48, tones: [60, 64, 67, 71], scale: [72, 74, 76, 79, 81, 84] }, // Cmaj7
  { root: 45, tones: [57, 60, 64, 67], scale: [69, 72, 74, 76, 79, 81] }, // Am7
  { root: 41, tones: [57, 60, 65, 69], scale: [69, 72, 74, 77, 79, 81] }, // Fmaj7
  { root: 43, tones: [55, 59, 62, 64], scale: [67, 71, 74, 76, 79, 83] }, // G6
];

export class AudioEngine {
  constructor() { this.ctx = null; this.on = false; this.music = true; this.step = 0; this.nextT = 0; this.tickPhase = 0; this.gullT = 6; this.cricketT = 1; this.melody = 3; }

  async start() {
    if (!this.ctx) this.init();
    await this.ctx.resume();
    this.on = true;
    this.master.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.4);
    this.nextT = this.ctx.currentTime + 0.1;
  }
  stop() { if (!this.ctx) return; this.on = false; this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15); }
  setMusic(on) { this.music = on; if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.4); }

  init() {
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(2.6, 2.4);
    const vg = ctx.createGain(); vg.gain.value = 0.5; this.verb.connect(vg); vg.connect(this.master);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.wind = this.loop('bandpass', 500, 0.7);
    this.waves = this.loop('lowpass', 380, 0.8);
    this.surf = this.loop('bandpass', 900, 0.5);
    this.rain = this.loop('highpass', 1600, 0.4);
    this.roll = this.loop('bandpass', 150, 1.4);
    // music bus with a dotted-eighth echo
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.music ? 0.5 : 0;
    this.musicBus.connect(this.master);
    const sendV = ctx.createGain(); sendV.gain.value = 0.6; this.musicBus.connect(sendV); sendV.connect(this.verb);
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = (60 / 84) * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.32; const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
    this.delay.connect(dl); dl.connect(fb); fb.connect(this.delay); dl.connect(this.musicBus);
  }

  impulse(sec, decay) {
    const ctx = this.ctx, n = ctx.sampleRate * sec, b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }

  loop(type, f, q) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = f; filter.Q.value = q;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filter); filter.connect(gain); gain.connect(this.master); src.start();
    return { filter, gain };
  }

  env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }

  burst(t, { type = 'bandpass', f = 2000, q = 1, peak = 0.3, a = 0.002, dec = 0.05, dest = this.master, rate = 1 } = {}) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rate;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain(); this.env(g, t, a, peak, dec);
    s.connect(fl); fl.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + a + dec + 0.05);
    return { fl, g };
  }

  tone(t, f, { type = 'sine', peak = 0.2, a = 0.005, dec = 0.4, dest = this.master, pan = 0, detune = 0 } = {}) {
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
    const g = ctx.createGain(); this.env(g, t, a, peak, dec);
    let out = g;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    o.connect(g); out.connect(dest); o.start(t); o.stop(t + a + dec + 0.05);
    return o;
  }

  bell() {
    if (!this.on) return;
    const t = this.ctx.currentTime;
    for (const k of [0, 0.16]) for (const [r, p] of [[1, 0.22], [2.76, 0.09], [5.4, 0.05], [8.93, 0.025]]) {
      this.tone(t + k, 2350 * r, { peak: p, dec: 1.1 / Math.sqrt(r), pan: 0.15 });
      this.tone(t + k, 2350 * r * 1.003, { peak: p * 0.5, dec: 1.1 / Math.sqrt(r), dest: this.verb });
    }
  }

  collect(gold = false) {
    if (!this.on) return;
    const t = this.ctx.currentTime, notes = gold ? [72, 76, 79, 84, 88, 91] : [76, 79, 84];
    notes.forEach((m, i) => { this.tone(t + i * 0.06, NOTE(m), { type: 'triangle', peak: 0.16, dec: 0.35 }); this.tone(t + i * 0.06, NOTE(m + 12), { peak: 0.05, dec: 0.25, dest: this.verb }); });
    // gulp
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(260, t + 0.05); o.frequency.exponentialRampToValueAtTime(90, t + 0.25);
    this.env(g, t + 0.05, 0.01, 0.25, 0.22); o.connect(g); g.connect(this.master); o.start(t + 0.05); o.stop(t + 0.4);
  }

  thump(k = 1) {
    if (!this.on) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    this.env(g, t, 0.004, 0.45 * k, 0.22); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.3);
    this.burst(t, { type: 'lowpass', f: 900, peak: 0.25 * k, dec: 0.12 });
    this.burst(t + 0.02, { f: 3800, q: 6, peak: 0.08 * k, dec: 0.12 }); // spring rattle
  }

  whoosh() {
    if (!this.on) return;
    const t = this.ctx.currentTime, b = this.burst(t, { f: 500, q: 0.8, peak: 0.18, a: 0.12, dec: 0.4 });
    b.fl.frequency.setValueAtTime(400, t); b.fl.frequency.exponentialRampToValueAtTime(2200, t + 0.4);
  }

  thunder(delay = 1) {
    if (!this.on) return;
    const t = this.ctx.currentTime + delay;
    this.burst(t, { type: 'lowpass', f: 2200, peak: 0.35, a: 0.01, dec: 0.5, rate: 0.6 });
    for (let i = 0; i < 5; i++) this.burst(t + 0.15 + i * (0.3 + Math.random() * 0.4), { type: 'lowpass', f: 160 + Math.random() * 120, q: 0.7, peak: 0.6 - i * 0.08, a: 0.08, dec: 1.4 + Math.random(), rate: 0.4 });
  }

  gull() {
    const ctx = this.ctx, t0 = ctx.currentTime, pan = Math.random() * 1.6 - 0.8, n = 2 + ((Math.random() * 3) | 0), base = 1300 + Math.random() * 500;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.22 + Math.random() * 0.12), o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 0.8, t); o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.06); o.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.26);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = base * 1.3; f.Q.value = 4;
      const g = ctx.createGain(); this.env(g, t, 0.02, 0.05, 0.25);
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      o.connect(f); f.connect(g);
      if (p) { p.pan.value = pan; g.connect(p); p.connect(this.master); p.connect(this.verb); } else g.connect(this.master);
      o.start(t); o.stop(t + 0.35);
    }
  }

  cricket() {
    const t = this.ctx.currentTime, pan = Math.random() * 1.4 - 0.7, f = 4200 + Math.random() * 600;
    for (let i = 0; i < 3; i++) this.tone(t + i * 0.055, f, { peak: 0.018, a: 0.004, dec: 0.035, pan });
  }

  scheduleStep(i, t) {
    const bar = Math.floor(i / 8), beat = i % 8, ch = CHORDS[Math.floor(bar / 2) % 4], night = this.st?.night || 0;
    const mb = this.musicBus;
    if (i % 16 === 0) for (const m of ch.tones) for (const det of [-7, 7]) {
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = NOTE(m); o.detune.value = det;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + (1 - night) * 500;
      const g = this.ctx.createGain(); const L = (60 / 84) * 8;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.022, t + 1.4); g.gain.setValueAtTime(0.022, t + L - 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + L + 1.2);
      o.connect(f); f.connect(g); g.connect(mb); o.start(t); o.stop(t + L + 1.3);
    }
    if (beat === 0 || beat === 4) this.tone(t, NOTE(ch.root), { peak: 0.16, a: 0.01, dec: 0.9, dest: mb });
    if (beat === 6 && Math.random() < 0.5) this.tone(t, NOTE(ch.root + 7), { peak: 0.08, a: 0.01, dec: 0.4, dest: mb });
    if (beat % 2 === 1) this.burst(t, { type: 'highpass', f: 7000, peak: 0.015 * (1 - night * 0.6), dec: 0.03, dest: mb });
    const density = 0.5 - night * 0.25 + (this.st?.speed || 0) * 0.02;
    if (Math.random() < density) {
      this.melody = Math.max(0, Math.min(ch.scale.length - 1, this.melody + ((Math.random() * 5) | 0) - 2));
      const m = ch.scale[this.melody];
      for (const dest of [mb, this.delay]) this.tone(t, NOTE(m), { type: 'triangle', peak: dest === mb ? 0.07 : 0.035, a: 0.004, dec: 0.5, dest, pan: Math.random() * 0.6 - 0.3 });
      this.tone(t, NOTE(m + 12), { peak: 0.015, a: 0.002, dec: 0.2, dest: mb });
    }
  }

  update(dt, st) {
    if (!this.ctx || !this.on) return;
    this.st = st;
    const t = this.ctx.currentTime, set = (n, v, tc = 0.25) => n.gain.gain.setTargetAtTime(v, t, tc);
    const v = st.speed;
    set(this.wind, 0.025 + Math.min(v, 14) * 0.012 + st.rain * 0.05 + st.air * 0.08);
    this.wind.filter.frequency.setTargetAtTime(300 + v * 70 + Math.sin(st.time * 0.7) * 60, t, 0.3);
    set(this.waves, 0.16 + 0.1 * Math.sin(st.time * 0.55) * Math.sin(st.time * 0.21), 0.6);
    set(this.surf, Math.max(0, Math.sin(st.time * 0.55)) * 0.05, 0.4);
    set(this.rain, st.rain * 0.22, 0.8);
    set(this.roll, st.grounded ? Math.min(v, 12) * 0.025 * (1 + st.rain * 0.6) : 0, 0.08);
    // freewheel pawl clicks while coasting
    if (st.coasting && v > 0.4 && st.grounded) {
      this.tickPhase += dt * Math.min(v * 7, 45);
      while (this.tickPhase > 1) { this.tickPhase -= 1; this.burst(t + Math.random() * 0.01, { type: 'highpass', f: 5200, peak: 0.05, a: 0.001, dec: 0.012 }); }
    }
    this.gullT -= dt;
    if (this.gullT < 0) { this.gullT = 7 + Math.random() * 14; if (st.night < 0.6) this.gull(); }
    if (st.night > 0.4 && st.rain < 0.3) { this.cricketT -= dt; if (this.cricketT < 0) { this.cricketT = 0.25 + Math.random() * 0.9; this.cricket(); } }
    if (this.music) {
      const step = (60 / 84) / 2;
      if (this.nextT < t) this.nextT = t + 0.05;
      while (this.nextT < t + 0.3) { this.scheduleStep(this.step++, this.nextT); this.nextT += step; }
    }
  }
}
