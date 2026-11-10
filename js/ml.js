// ============================================================
// ml.js — Supervised Learning (เขียนเองทั้งหมด ไม่ใช้ไลบรารี)
//   - StandardScaler, train/test split (stratified)
//   - Logistic Regression (gradient descent + L2)
//   - Decision Tree (CART, Gini)
//   - Random Forest (bagging + random feature subset)
//   - Metrics: confusion matrix, accuracy, precision, recall, F1, ROC/AUC
// ============================================================
window.CT = window.CT || {};
(function (CT) {
  // ---------- preprocessing ----------
  class StandardScaler {
    fit(X) {
      const d = X[0].length, n = X.length;
      this.mean = new Array(d).fill(0);
      this.std = new Array(d).fill(0);
      for (const x of X) for (let j = 0; j < d; j++) this.mean[j] += x[j] / n;
      for (const x of X) for (let j = 0; j < d; j++) this.std[j] += (x[j] - this.mean[j]) ** 2 / n;
      this.std = this.std.map((s) => Math.sqrt(s) || 1);
      return this;
    }
    transform(X) { return X.map((x) => x.map((v, j) => (v - this.mean[j]) / this.std[j])); }
    fitTransform(X) { return this.fit(X).transform(X); }
  }

  function stratifiedSplit(n, y, testRatio, rng) {
    const byClass = {};
    for (let i = 0; i < n; i++) (byClass[y[i]] ||= []).push(i);
    const train = [], test = [];
    for (const k in byClass) {
      const idx = rng.shuffle(byClass[k].slice());
      const nt = Math.round(idx.length * testRatio);
      test.push(...idx.slice(0, nt));
      train.push(...idx.slice(nt));
    }
    return { train: rng.shuffle(train), test: rng.shuffle(test) };
  }

  const sigmoid = (z) => 1 / (1 + Math.exp(-z));

  // ---------- Logistic Regression ----------
  class LogisticRegression {
    constructor({ lr = 0.1, epochs = 600, l2 = 0.01 } = {}) {
      Object.assign(this, { lr, epochs, l2 });
      this.name = "Logistic Regression";
    }
    fit(X, y) {
      this.scaler = new StandardScaler();
      const Xs = this.scaler.fitTransform(X);
      const n = Xs.length, d = Xs[0].length;
      this.w = new Array(d).fill(0); this.b = 0;
      this.lossHistory = [];
      for (let ep = 0; ep < this.epochs; ep++) {
        const gw = new Array(d).fill(0); let gb = 0, loss = 0;
        for (let i = 0; i < n; i++) {
          let z = this.b;
          for (let j = 0; j < d; j++) z += this.w[j] * Xs[i][j];
          const p = sigmoid(z), e = p - y[i];
          loss += -(y[i] * Math.log(p + 1e-12) + (1 - y[i]) * Math.log(1 - p + 1e-12));
          for (let j = 0; j < d; j++) gw[j] += e * Xs[i][j];
          gb += e;
        }
        for (let j = 0; j < d; j++) this.w[j] -= this.lr * (gw[j] / n + this.l2 * this.w[j]);
        this.b -= this.lr * gb / n;
        if (ep % 10 === 0) this.lossHistory.push(loss / n);
      }
      return this;
    }
    predictProba(X) {
      return this.scaler.transform(X).map((x) => sigmoid(x.reduce((s, v, j) => s + v * this.w[j], this.b)));
    }
    featureImportance() {
      const a = this.w.map(Math.abs), s = a.reduce((p, c) => p + c, 0) || 1;
      return a.map((v) => v / s);
    }
  }

  // ---------- Decision Tree (CART) ----------
  function gini(pos, n) {
    if (n === 0) return 0;
    const p = pos / n;
    return 2 * p * (1 - p);
  }

  class DecisionTree {
    constructor({ maxDepth = 5, minSamplesLeaf = 3, maxFeatures = null, rng = null } = {}) {
      Object.assign(this, { maxDepth, minSamplesLeaf, maxFeatures, rng });
      this.name = "Decision Tree";
    }
    fit(X, y, idx = null) {
      this.d = X[0].length;
      this.importance = new Array(this.d).fill(0);
      this.nTotal = (idx || X).length;
      this.root = this._build(X, y, idx || X.map((_, i) => i), 0);
      const s = this.importance.reduce((a, b) => a + b, 0) || 1;
      this.importance = this.importance.map((v) => v / s);
      return this;
    }
    _leaf(y, idx) {
      const pos = idx.reduce((s, i) => s + y[i], 0);
      return { leaf: true, prob: (pos + 0.5) / (idx.length + 1), n: idx.length };
    }
    _featureSubset() {
      const all = [...Array(this.d).keys()];
      if (!this.maxFeatures || this.maxFeatures >= this.d) return all;
      return this.rng.shuffle(all).slice(0, this.maxFeatures);
    }
    _build(X, y, idx, depth) {
      const n = idx.length;
      const pos = idx.reduce((s, i) => s + y[i], 0);
      if (depth >= this.maxDepth || n < 2 * this.minSamplesLeaf || pos === 0 || pos === n) return this._leaf(y, idx);

      const parentG = gini(pos, n);
      let best = null;
      for (const f of this._featureSubset()) {
        const sorted = idx.slice().sort((a, b) => X[a][f] - X[b][f]);
        let lPos = 0;
        for (let k = 0; k < n - 1; k++) {
          lPos += y[sorted[k]];
          const lN = k + 1, rN = n - lN;
          const v = X[sorted[k]][f], vn = X[sorted[k + 1]][f];
          if (v === vn || lN < this.minSamplesLeaf || rN < this.minSamplesLeaf) continue;
          const g = (lN / n) * gini(lPos, lN) + (rN / n) * gini(pos - lPos, rN);
          if (!best || g < best.g) best = { g, f, thr: (v + vn) / 2 };
        }
      }
      if (!best || best.g >= parentG - 1e-9) return this._leaf(y, idx);

      this.importance[best.f] += (n / this.nTotal) * (parentG - best.g);
      const L = [], R = [];
      for (const i of idx) (X[i][best.f] <= best.thr ? L : R).push(i);
      return {
        leaf: false, f: best.f, thr: best.thr, n,
        left: this._build(X, y, L, depth + 1),
        right: this._build(X, y, R, depth + 1),
      };
    }
    _predictOne(x) {
      let node = this.root;
      while (!node.leaf) node = x[node.f] <= node.thr ? node.left : node.right;
      return node.prob;
    }
    predictProba(X) { return X.map((x) => this._predictOne(x)); }
    featureImportance() { return this.importance; }

    /** แปลงต้นไม้เป็นข้อความ (กฎ if-else) */
    toText(featureNames, node = this.root, indent = "") {
      if (node.leaf) return `${indent}→ P(บอท) = ${node.prob.toFixed(2)}  (n=${node.n})\n`;
      return (
        `${indent}ถ้า ${featureNames[node.f]} ≤ ${node.thr.toFixed(2)}\n` +
        this.toText(featureNames, node.left, indent + "│  ") +
        `${indent}มิฉะนั้น (${featureNames[node.f]} > ${node.thr.toFixed(2)})\n` +
        this.toText(featureNames, node.right, indent + "│  ")
      );
    }
  }

  // ---------- Random Forest ----------
  class RandomForest {
    constructor({ nTrees = 40, maxDepth = 6, minSamplesLeaf = 2, seed = 7 } = {}) {
      Object.assign(this, { nTrees, maxDepth, minSamplesLeaf });
      this.rng = new CT.Rng(seed);
      this.name = "Random Forest";
    }
    fit(X, y) {
      const n = X.length, d = X[0].length;
      const mf = Math.max(1, Math.round(Math.sqrt(d)));
      this.trees = [];
      for (let t = 0; t < this.nTrees; t++) {
        const boot = Array.from({ length: n }, () => Math.floor(this.rng.random() * n));
        const tree = new DecisionTree({ maxDepth: this.maxDepth, minSamplesLeaf: this.minSamplesLeaf, maxFeatures: mf, rng: this.rng });
        tree.fit(X, y, boot);
        this.trees.push(tree);
      }
      return this;
    }
    predictProba(X) {
      return X.map((x) => this.trees.reduce((s, t) => s + t._predictOne(x), 0) / this.trees.length);
    }
    featureImportance() {
      const d = this.trees[0].importance.length;
      const imp = new Array(d).fill(0);
      for (const t of this.trees) t.importance.forEach((v, j) => (imp[j] += v / this.trees.length));
      return imp;
    }
  }

  // ---------- Rule-based baseline ----------
  class RuleBaseline {
    constructor(featureIndex, threshold) {
      Object.assign(this, { featureIndex, threshold });
      this.name = `กฎ: request/วินาที > ${threshold}`;
    }
    fit() { return this; }
    predictProba(X) { return X.map((x) => (x[this.featureIndex] > this.threshold ? 1 : 0)); }
    featureImportance() { return null; }
  }

  // ---------- Metrics ----------
  function confusion(yTrue, prob, thr = 0.5) {
    let tp = 0, tn = 0, fp = 0, fn = 0;
    for (let i = 0; i < yTrue.length; i++) {
      const p = prob[i] >= thr ? 1 : 0;
      if (p === 1 && yTrue[i] === 1) tp++;
      else if (p === 0 && yTrue[i] === 0) tn++;
      else if (p === 1) fp++;
      else fn++;
    }
    const acc = (tp + tn) / yTrue.length;
    const prec = tp + fp ? tp / (tp + fp) : 0;
    const rec = tp + fn ? tp / (tp + fn) : 0;
    const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
    return { tp, tn, fp, fn, acc, prec, rec, f1 };
  }

  function roc(yTrue, prob) {
    const pairs = yTrue.map((y, i) => [prob[i], y]).sort((a, b) => b[0] - a[0]);
    const P = yTrue.reduce((a, b) => a + b, 0), N = yTrue.length - P;
    const pts = [{ x: 0, y: 0 }];
    let tp = 0, fp = 0, auc = 0, prevX = 0, prevY = 0;
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i][1] === 1) tp++; else fp++;
      if (i === pairs.length - 1 || pairs[i + 1][0] !== pairs[i][0]) {
        const x = fp / N, yv = tp / P;
        auc += (x - prevX) * (yv + prevY) / 2;
        pts.push({ x, y: yv });
        prevX = x; prevY = yv;
      }
    }
    return { pts, auc };
  }

  /** หาค่า threshold ที่ต้นทุนรวมต่ำสุด */
  function bestThreshold(yTrue, prob, costFP, costFN) {
    let best = { thr: 0.5, cost: Infinity };
    const curve = [];
    for (let t = 0.02; t <= 0.98; t += 0.02) {
      const c = confusion(yTrue, prob, t);
      const cost = c.fp * costFP + c.fn * costFN;
      curve.push({ x: +t.toFixed(2), y: cost });
      if (cost < best.cost) best = { thr: +t.toFixed(2), cost };
    }
    return { ...best, curve };
  }

  CT.ml = {
    StandardScaler, stratifiedSplit, LogisticRegression, DecisionTree, RandomForest, RuleBaseline,
    confusion, roc, bestThreshold, sigmoid,
  };
})(window.CT);
