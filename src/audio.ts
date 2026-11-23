export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let muted = false;
  let songUntil = 0;

  function ensure() {
    if (ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    noise = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

    const low = ctx.createOscillator();
    const high = ctx.createOscillator();
    low.type = "sine";
    high.type = "sine";
    low.frequency.value = 174.61;
    high.frequency.value = 220;
    const bed = ctx.createGain();
    bed.gain.value = 0.012;
    low.connect(bed);
    high.connect(bed);
    bed.connect(master);
    low.start();
    high.start();
  }

  function burst(at: number, frequency: number, gain: number, dur: number) {
    if (!ctx || !master || !noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.7;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gain, at + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  return {
    start() {
      ensure();
      void ctx?.resume();
    },
    setMuted(next: boolean) {
      muted = next;
      if (!ctx || !master) return;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.linearRampToValueAtTime(next ? 0 : 0.9, now + 0.04);
    },
    match() {
      if (!ctx || muted) return;
      burst(ctx.currentTime, 2200, 0.08, 0.09);
    },
    song() {
      if (muted) return false;
      ensure();
      void ctx?.resume();
      if (!ctx || !master) return false;
      const now = ctx.currentTime;
      if (now < (songUntil ?? 0)) return true;
      const notes = [523.25, 659.25, 783.99, 880, 783.99, 659.25, 587.33, 523.25, 392, 523.25];
      notes.forEach((freq, index) => {
        const osc = ctx!.createOscillator();
        osc.type = index % 2 === 0 ? "sine" : "triangle";
        osc.frequency.value = freq;
        const amp = ctx!.createGain();
        const t = now + index * 0.34;
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.exponentialRampToValueAtTime(0.075, t + 0.03);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.72);
        osc.connect(amp);
        amp.connect(master!);
        osc.start(t);
        osc.stop(t + 0.76);
      });
      const low = ctx.createOscillator();
      low.type = "sine";
      low.frequency.value = 261.63;
      const bed = ctx.createGain();
      bed.gain.setValueAtTime(0.0001, now);
      bed.gain.exponentialRampToValueAtTime(0.03, now + 0.08);
      bed.gain.exponentialRampToValueAtTime(0.0001, now + 3.5);
      low.connect(bed);
      bed.connect(master);
      low.start(now);
      low.stop(now + 3.55);
      songUntil = now + 3.7;
      return true;
    },
    celebrate() {
      if (!ctx || !master || muted) return;
      const now = ctx.currentTime;
      burst(now, 1400, 0.16, 0.11);
      burst(now + 0.13, 1600, 0.13, 0.1);
      burst(now + 0.24, 1800, 0.1, 0.09);
      [523.25, 659.25, 783.99, 987.77].forEach((freq, index) => {
        const osc = ctx!.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        const amp = ctx!.createGain();
        const t = now + 0.08 + index * 0.16;
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);
        osc.connect(amp);
        amp.connect(master!);
        osc.start(t);
        osc.stop(t + 1.4);
      });
    },
  };
}
