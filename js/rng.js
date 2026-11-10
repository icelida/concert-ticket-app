// Seeded random number generator — ทำให้ผลการจำลองทำซ้ำได้ (reproducible)
window.CT = window.CT || {};
(function (CT) {
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class Rng {
    constructor(seed = 42) {
      this.r = mulberry32(seed);
      this._spare = null;
    }
    random() { return this.r(); }
    normal(mu = 0, sd = 1) {
      if (this._spare !== null) {
        const s = this._spare; this._spare = null;
        return mu + sd * s;
      }
      let u = 0;
      while (u === 0) u = this.r();
      const v = this.r();
      const m = Math.sqrt(-2 * Math.log(u));
      this._spare = m * Math.sin(2 * Math.PI * v);
      return mu + sd * m * Math.cos(2 * Math.PI * v);
    }
    lognormal(median, sigma) { return median * Math.exp(this.normal(0, sigma)); }
    int(a, b) { return a + Math.floor(this.r() * (b - a + 1)); }
    choice(arr) { return arr[Math.floor(this.r() * arr.length)]; }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.r() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
  }

  CT.mulberry32 = mulberry32;
  CT.Rng = Rng;
})(window.CT);
