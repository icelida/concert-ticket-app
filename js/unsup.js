// ============================================================
// unsup.js — Unsupervised Learning
//   - K-Means (k-means++ init, หลายรอบเลือก inertia ต่ำสุด)
//   - Elbow (inertia) + Silhouette score เพื่อเลือก k
//   - PCA (Jacobi eigen-decomposition) → ลดมิติเหลือ 2D
//   - Anomaly score = ระยะห่างจาก centroid ที่ใกล้ที่สุด
// ============================================================
window.CT = window.CT || {};
(function (CT) {
  const dist2 = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s; };

  // ---------- K-Means ----------
  function kmeansOnce(X, k, rng, maxIter = 100) {
    const n = X.length, d = X[0].length;
    // k-means++ initialisation
    const C = [X[Math.floor(rng.random() * n)].slice()];
    const D = new Array(n).fill(Infinity);
    while (C.length < k) {
      let sum = 0;
      for (let i = 0; i < n; i++) { D[i] = Math.min(D[i], dist2(X[i], C[C.length - 1])); sum += D[i]; }
      let r = rng.random() * sum, i = 0;
      for (; i < n - 1; i++) { r -= D[i]; if (r <= 0) break; }
      C.push(X[i].slice());
    }
    const labels = new Array(n).fill(-1);
    for (let it = 0; it < maxIter; it++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        let bj = 0, bd = Infinity;
        for (let j = 0; j < k; j++) { const dd = dist2(X[i], C[j]); if (dd < bd) { bd = dd; bj = j; } }
        if (labels[i] !== bj) { labels[i] = bj; changed = true; }
      }
      const sums = Array.from({ length: k }, () => new Array(d).fill(0));
      const cnt = new Array(k).fill(0);
      for (let i = 0; i < n; i++) { cnt[labels[i]]++; for (let t = 0; t < d; t++) sums[labels[i]][t] += X[i][t]; }
      for (let j = 0; j < k; j++) {
        if (cnt[j] === 0) C[j] = X[Math.floor(rng.random() * n)].slice();
        else C[j] = sums[j].map((s) => s / cnt[j]);
      }
      if (!changed) break;
    }
    let inertia = 0;
    for (let i = 0; i < n; i++) inertia += dist2(X[i], C[labels[i]]);
    return { labels, centroids: C, inertia };
  }

  function kmeans(X, k, { nInit = 8, seed = 1 } = {}) {
    const rng = new CT.Rng(seed + k * 101);
    let best = null;
    for (let r = 0; r < nInit; r++) {
      const res = kmeansOnce(X, k, rng);
      if (!best || res.inertia < best.inertia) best = res;
    }
    return best;
  }

  function silhouette(X, labels, k) {
    const n = X.length;
    // ใช้ sample เพื่อความเร็วเมื่อ n ใหญ่
    const step = Math.max(1, Math.floor(n / 400));
    let total = 0, cnt = 0;
    for (let i = 0; i < n; i += step) {
      const sums = new Array(k).fill(0), cs = new Array(k).fill(0);
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        sums[labels[j]] += Math.sqrt(dist2(X[i], X[j]));
        cs[labels[j]]++;
      }
      const own = labels[i];
      if (cs[own] === 0) continue;
      const a = sums[own] / cs[own];
      let b = Infinity;
      for (let c = 0; c < k; c++) if (c !== own && cs[c] > 0) b = Math.min(b, sums[c] / cs[c]);
      total += (b - a) / Math.max(a, b);
      cnt++;
    }
    return cnt ? total / cnt : 0;
  }

  function elbow(X, kMin = 2, kMax = 8) {
    const out = [];
    for (let k = kMin; k <= kMax; k++) {
      const r = kmeans(X, k);
      out.push({ k, inertia: r.inertia, silhouette: silhouette(X, r.labels, k) });
    }
    return out;
  }

  // ---------- PCA ----------
  function jacobiEigen(A, maxIter = 200) {
    const n = A.length;
    const a = A.map((r) => r.slice());
    const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    for (let it = 0; it < maxIter; it++) {
      let p = 0, q = 1, max = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(a[i][j]) > max) { max = Math.abs(a[i][j]); p = i; q = j; }
      if (max < 1e-10) break;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
    const vals = a.map((r, i) => r[i]);
    const order = vals.map((v, i) => i).sort((i, j) => vals[j] - vals[i]);
    return {
      values: order.map((i) => vals[i]),
      vectors: order.map((i) => V.map((row) => row[i])), // แต่ละตัวคือ eigenvector (ความยาว n)
    };
  }

  class PCA {
    fit(Xs) { // Xs ต้อง standardize แล้ว
      const n = Xs.length, d = Xs[0].length;
      this.mean = new Array(d).fill(0);
      for (const x of Xs) for (let j = 0; j < d; j++) this.mean[j] += x[j] / n;
      const cov = Array.from({ length: d }, () => new Array(d).fill(0));
      for (const x of Xs)
        for (let i = 0; i < d; i++)
          for (let j = i; j < d; j++) cov[i][j] += ((x[i] - this.mean[i]) * (x[j] - this.mean[j])) / (n - 1);
      for (let i = 0; i < d; i++) for (let j = 0; j < i; j++) cov[i][j] = cov[j][i];
      const { values, vectors } = jacobiEigen(cov);
      const tot = values.reduce((a, b) => a + b, 0);
      this.components = vectors;
      this.explained = values.map((v) => v / tot);
      return this;
    }
    transform(Xs, nComp = 2) {
      return Xs.map((x) => this.components.slice(0, nComp).map((v) => v.reduce((s, vj, j) => s + vj * (x[j] - this.mean[j]), 0)));
    }
  }

  // ---------- Anomaly Detection Methods (จากคลาส Day 2: Unsupervised Learning) ----------
  function anomalyScores(X, centroids) {
    return X.map((x) => Math.sqrt(Math.min(...centroids.map((c) => dist2(x, c)))));
  }

  /**
   * 1) Isolation Forest (Ensemble method)
   * สุ่มแบ่งพื้นที่ด้วยต้นไม้หลายต้น จุดที่ผิดปกติ (anomaly) จะถูกแยกเดี่ยวได้ในไม่กี่ชั้น (path length สั้น)
   */
  function cFactor(n) {
    if (n <= 1) return 0;
    if (n === 2) return 1;
    return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n;
  }

  function buildITree(pts, depth, maxDepth, rng) {
    const n = pts.length;
    if (depth >= maxDepth || n <= 1) return { leaf: true, size: n };
    const d = pts[0].length;
    // สุ่มเลือกฟีเจอร์ที่มีค่าต่างกัน
    const feats = rng.shuffle([...Array(d).keys()]);
    for (const q of feats) {
      let lo = Infinity, hi = -Infinity;
      for (const x of pts) { if (x[q] < lo) lo = x[q]; if (x[q] > hi) hi = x[q]; }
      if (hi - lo > 1e-9) {
        const p = lo + rng.random() * (hi - lo);
        const L = [], R = [];
        for (const x of pts) (x[q] < p ? L : R).push(x);
        return {
          leaf: false, q, p,
          left: buildITree(L, depth + 1, maxDepth, rng),
          right: buildITree(R, depth + 1, maxDepth, rng),
        };
      }
    }
    return { leaf: true, size: n };
  }

  function iPathLength(x, node, depth = 0) {
    if (node.leaf) return depth + cFactor(node.size);
    return iPathLength(x, x[node.q] < node.p ? node.left : node.right, depth + 1);
  }

  function isolationForest(Xs, { nTrees = 80, sampleSize = 128, seed = 42 } = {}) {
    const rng = new CT.Rng(seed);
    const n = Xs.length, psi = Math.min(sampleSize, n);
    const maxDepth = Math.ceil(Math.log2(psi));
    const cn = cFactor(psi) || 1;
    const trees = [];
    for (let t = 0; t < nTrees; t++) {
      const idx = rng.shuffle([...Array(n).keys()]).slice(0, psi);
      trees.push(buildITree(idx.map((i) => Xs[i]), 0, maxDepth, rng));
    }
    const scores = Xs.map((x) => {
      const avgH = trees.reduce((s, tr) => s + iPathLength(x, tr, 0), 0) / nTrees;
      return Math.pow(2, -avgH / cn);
    });
    return { scores, predictOne: (x) => Math.pow(2, -(trees.reduce((s, tr) => s + iPathLength(x, tr, 0), 0) / nTrees) / cn) };
  }

  /**
   * 2) Local Outlier Factor — LOF (Proximity / Local Density method)
   * เปรียบเทียบความหนาแน่นท้องถิ่นของจุดนั้นกับเพื่อนบ้าน k ตัวที่ใกล้ที่สุด
   */
  function lof(Xs, { k = 20 } = {}) {
    const n = Xs.length, kk = Math.min(k, n - 1);
    const nbrs = new Array(n), kdist = new Array(n);
    for (let i = 0; i < n; i++) {
      const ds = [];
      for (let j = 0; j < n; j++) if (i !== j) ds.push({ j, d: Math.sqrt(dist2(Xs[i], Xs[j])) });
      ds.sort((a, b) => a.d - b.d);
      nbrs[i] = ds.slice(0, kk);
      kdist[i] = nbrs[i][kk - 1].d || 1e-9;
    }
    const lrd = new Array(n);
    for (let i = 0; i < n; i++) {
      let sumReach = 0;
      for (const nb of nbrs[i]) sumReach += Math.max(kdist[nb.j], nb.d);
      lrd[i] = kk / (sumReach || 1e-9);
    }
    const scores = new Array(n);
    for (let i = 0; i < n; i++) {
      let sumRatio = 0;
      for (const nb of nbrs[i]) sumRatio += lrd[nb.j] / lrd[i];
      scores[i] = sumRatio / kk;
    }
    return { scores };
  }

  /**
   * 3) K-Means Distance to Normal Centroid (Proximity / Clustering-based CBLOF)
   * จัดกลุ่มด้วย K-Means แล้ววัดระยะห่างจากจุดศูนย์กลางของกลุ่มใหญ่ (กลุ่มพฤติกรรมปกติ)
   */
  function kmeansAnomaly(Xs, { k = 4, seed = 42 } = {}) {
    const km = kmeans(Xs, k, { seed });
    const sizes = [...Array(k).keys()].map((c) => km.labels.filter((l) => l === c).length);
    const maxSize = Math.max(...sizes);
    const normalCentroids = km.centroids.filter((_, c) => sizes[c] >= 0.22 * Xs.length || sizes[c] === maxSize);
    return {
      scores: anomalyScores(Xs, normalCentroids),
      labels: km.labels,
      centroids: km.centroids,
      normalCentroids,
    };
  }

  /**
   * 4) DBSCAN Noise / Density-based Anomaly Detection
   * จุดที่อยู่ในบริเวณความหนาแน่นต่ำ (มีเพื่อนบ้านในรัศมี eps น้อยกว่า minSamples) จะได้ label = -1 (noise/anomaly)
   */
  function dbscanAnomaly(Xs, { eps = 1.45, minSamples = 8 } = {}) {
    const n = Xs.length, eps2 = eps * eps;
    const labels = new Array(n).fill(0); // 0=unvisited, -1=noise, >0=cluster id
    const neighbors = (i) => {
      const out = [];
      for (let j = 0; j < n; j++) if (dist2(Xs[i], Xs[j]) <= eps2) out.push(j);
      return out;
    };
    const nbCache = Array.from({ length: n }, (_, i) => neighbors(i));
    let cid = 0;
    for (let i = 0; i < n; i++) {
      if (labels[i] !== 0) continue;
      const nbs = nbCache[i];
      if (nbs.length < minSamples) { labels[i] = -1; continue; }
      cid++;
      labels[i] = cid;
      const queue = nbs.filter((j) => j !== i);
      const inQ = new Set(queue);
      while (queue.length) {
        const q = queue.shift();
        if (labels[q] === -1) labels[q] = cid;
        if (labels[q] !== 0) continue;
        labels[q] = cid;
        const qNbs = nbCache[q];
        if (qNbs.length >= minSamples) {
          for (const m of qNbs) if (labels[m] <= 0 && !inQ.has(m)) { queue.push(m); inQ.add(m); }
        }
      }
    }
    // ให้คะแนนต่อเนื่องจากระยะถึงเพื่อนบ้านลำดับที่ minSamples บวกโบนัสถ้าเป็น noise (-1)
    const scores = Xs.map((x, i) => {
      const ds = [];
      for (let j = 0; j < n; j++) if (i !== j) ds.push(Math.sqrt(dist2(x, Xs[j])));
      ds.sort((a, b) => a - b);
      const kd = ds[Math.min(minSamples - 1, ds.length - 1)] || 0;
      return kd + (labels[i] === -1 ? 1.5 : 0);
    });
    return { scores, labels: labels.map((l) => (l === -1 ? -1 : l - 1)), nClusters: cid };
  }

  /**
   * 5) Statistical Method: Z-Score + Tukey's IQR Rule
   * คำนวณความเบี่ยงเบนเทียบกับค่าควอร์ไทล์ (Q1, Q3, IQR) และค่า Z-Score สูงสุดในแต่ละฟีเจอร์
   */
  function statAnomaly(Xs) {
    const n = Xs.length, d = Xs[0].length;
    const q1 = new Array(d), q3 = new Array(d), iqr = new Array(d);
    for (let j = 0; j < d; j++) {
      const col = Xs.map((x) => x[j]).sort((a, b) => a - b);
      q1[j] = col[Math.floor(0.25 * (n - 1))];
      q3[j] = col[Math.floor(0.75 * (n - 1))];
      iqr[j] = Math.max(q3[j] - q1[j], 1e-6);
    }
    const scores = Xs.map((x) => {
      let s = 0;
      for (let j = 0; j < d; j++) {
        const over = x[j] > q3[j] ? (x[j] - q3[j]) / iqr[j] : x[j] < q1[j] ? (q1[j] - x[j]) / iqr[j] : 0;
        const z = Math.abs(x[j]) / 2;
        s += Math.max(over, z) ** 2;
      }
      return Math.sqrt(s);
    });
    return { scores };
  }

  // ---------- ตั้งชื่อกลุ่มอัตโนมัติจากค่าเฉลี่ย ----------
  /**
   * profiles: [{cluster, mean:{feature:value}, size}]
   */
  function nameSegments(profiles) {
    const names = {};
    const taken = new Set();
    const pick = (key, dir, name) => {
      const cands = profiles.filter((p) => !taken.has(p.cluster));
      if (!cands.length) return;
      const best = cands.reduce((a, b) => (dir * (b.mean[key] - a.mean[key]) > 0 ? b : a));
      names[best.cluster] = name; taken.add(best.cluster);
    };
    pick("vip_ratio", +1, "พรีเมียม/VIP");
    pick("concerts_per_year", +1, "แฟนตัวยง");
    pick("group_size", +1, "ครอบครัว/กลุ่ม");
    pick("avg_ticket_price", -1, "นักศึกษา/สายประหยัด");
    pick("lead_time_days", -1, "ผู้ชมทั่วไป");
    let extra = 1;
    for (const p of profiles) if (!(p.cluster in names)) names[p.cluster] = `กลุ่มอื่น ${extra++}`;
    return names;
  }

  CT.unsup = {
    kmeans, silhouette, elbow, PCA, anomalyScores, nameSegments, dist2,
    isolationForest, lof, kmeansAnomaly, dbscanAnomaly, statAnomaly,
  };
})(window.CT);
