// ============================================================
// app.js — เชื่อมทุกส่วนเข้ากับ UI + StagePass Shield Live Lab
// ============================================================
(function (CT) {
  const { data, db: DBM, ml, unsup } = CT;
  const BF = data.BEHAVIOR_FEATURES, SF = data.SEGMENT_FEATURES;
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 0) => (v == null || Number.isNaN(v) ? "-" : Number(v).toLocaleString("th-TH", { maximumFractionDigits: d, minimumFractionDigits: d }));
  const pct = (v, d = 1) => fmt(v * 100, d) + "%";
  const PALETTE = ["#6d28d9", "#0284c7", "#f97316", "#16a34a", "#e11d48", "#eab308", "#a855f7", "#64748b"];
  const MODEL_NAMES = { rf: "Random Forest", dt: "Decision Tree", lr: "Logistic Regression", rule: "กฎ req/s > 10" };
  const ANOM_NAMES = {
    iforest: "Isolation Forest (Ensemble)",
    lof: "Local Outlier Factor (LOF)",
    kmeans: "K-Means Centroid Distance",
    dbscan: "DBSCAN Noise (label = -1)",
    stat: "Statistical Z-Score / IQR",
  };

  function applyChartTheme() {
    const isDark = document.body.classList.contains("dark");
    Chart.defaults.color = isDark ? "#9aa1c7" : "#5b547a";
    Chart.defaults.borderColor = isDark ? "#2c3358" : "#e2ddf5";
    Chart.defaults.font.family = "'IBM Plex Sans Thai', sans-serif";
  }
  applyChartTheme();

  const charts = {};
  function chart(id, cfg) {
    if (!$(id)) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($(id), cfg);
  }

  const S = { cur: "rf", thr: 0.5, anomMethod: "iforest" };
  const setStatus = (t, ok = false) => { $("status").textContent = t; $("status").classList.toggle("ok", ok); };

  // ============================================================
  // Init / pipeline
  // ============================================================
  async function init() {
    setupTabs();
    setStatus("กำลังโหลด SQLite (WebAssembly)…");
    S.SQL = await DBM.loadSqlJs();
    bindEvents();
    await rebuild();
    initLab();
  }

  async function rebuild() {
    const n = +$("cfg-n").value, botRatio = +$("cfg-bot").value, seed = +$("cfg-seed").value;
    S.seed = seed;
    setStatus("สร้างข้อมูลจำลอง…");
    await tick();
    S.users = data.generateUsers({ n, botRatio, seed });
    S.X = S.users.map((u) => BF.map((f) => u[f.key]));
    S.y = S.users.map((u) => u.is_bot);
    S.yKnown = S.users.map((u) => u.known_label);

    S.db = new DBM.TicketDB(S.SQL);
    S.db.seed(S.users);

    setStatus("ฝึกโมเดล Supervised…");
    await tick();
    trainAll();

    setStatus("รัน Unsupervised & Anomaly…");
    await tick();
    runAnomaly();
    runUnsupervised(true);

    renderOverview();
    renderSupervised();
    renderSeatMap("seatmap", true);
    renderSeatMap("lab-seatmap", true, S.labSelected);
    $("sql-input").value = SQL_PRESETS[0].sql;
    runSql();
    if (S.labReady) updateLabEvaluation();
    setStatus(`พร้อมใช้งาน · ${n} บัญชี`, true);
  }

  const tick = () => new Promise((r) => setTimeout(r, 20));

  function switchTab(tabName) {
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === tabName));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + tabName));
    if (tabName === "database") renderSeatMap("seatmap", true);
    if (tabName === "lab") renderSeatMap("lab-seatmap", true, S.labSelected);
  }

  function setupTabs() {
    document.querySelectorAll("#tabs button").forEach((b) =>
      b.addEventListener("click", () => switchTab(b.dataset.tab))
    );
    if ($("btn-goto-lab")) {
      $("btn-goto-lab").addEventListener("click", () => switchTab("lab"));
    }
  }

  // ============================================================
  // 0. Overview
  // ============================================================
  function renderOverview() {
    const n = S.users.length, bots = S.y.reduce((a, b) => a + b, 0);
    const knownBots = S.yKnown.reduce((a, b) => a + b, 0);
    const zeroDayBots = bots - knownBots;
    const seats = S.db.scalar("SELECT COUNT(*) FROM seats");
    const k = [
      ["บัญชีทั้งหมด", fmt(n)], ["คนจริง", fmt(n - bots)],
      ["บอทที่มี Label", fmt(knownBots)], ["บอทไร้ Label (Zero-Day)", fmt(zeroDayBots)],
      ["ที่นั่งทั้งหมด", fmt(seats)], ["จำกัดสิทธิ์", DBM.MAX_TICKETS_PER_ID + " ใบ/บัตร"],
    ];
    $("overview-kpis").innerHTML = kpiHtml(k);
  }
  const kpiHtml = (arr) => arr.map(([l, v]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

  // ============================================================
  // 1. STAGEPASS SHIELD LIVE LAB (Real-Time Telemetry + Bot Simulator)
  // ============================================================
  const LAB_BOT_PRESETS = {
    human: {
      title: "🙂 คนทั่วไปจองบัตร (Human)",
      isBot: false,
      botType: null,
      features: { clicks_per_min: 16, req_per_sec: 0.6, accounts_per_ip: 1, checkout_time_s: 42, mouse_entropy: 0.78, account_age_days: 540, captcha_fail: 0 },
      flags: { isTrusted: true, webdriver: false, honeypotField: false, honeypotSeat: false, keyIntervalCv: 0.44, teleportCount: 0 },
      zone: "A", count: 2,
      name: "สมชาย ใจดี (แฟนเพลงตัวจริง)",
    },
    selenium: {
      title: "🤖 Bot #1: Selenium / Script Click",
      isBot: true,
      botType: "obvious",
      features: { clicks_per_min: 190, req_per_sec: 14.5, accounts_per_ip: 6, checkout_time_s: 3.2, mouse_entropy: 0.03, account_age_days: 2, captcha_fail: 3 },
      flags: { isTrusted: false, webdriver: true, honeypotField: false, honeypotSeat: false, keyIntervalCv: 0.01, teleportCount: 5 },
      zone: "VIP", count: 4,
      name: "AUTO_BUYER_SELENIUM_01",
    },
    burst: {
      title: "⚡ Bot #2: กดรัวแย่งโซน VIP (High-Speed Scalper)",
      isBot: true,
      botType: "obvious",
      features: { clicks_per_min: 360, req_per_sec: 28.0, accounts_per_ip: 9, checkout_time_s: 1.8, mouse_entropy: 0.08, account_age_days: 1, captcha_fail: 4 },
      flags: { isTrusted: true, webdriver: false, honeypotField: false, honeypotSeat: false, keyIntervalCv: 0.03, teleportCount: 4 },
      zone: "VIP", count: 4,
      name: "VIP_SNIPER_BOT_99",
    },
    honeypot: {
      title: "🍯 Bot #3: Auto-Fill & ติดกับดัก Honeypot",
      isBot: true,
      botType: "obvious",
      features: { clicks_per_min: 240, req_per_sec: 18.0, accounts_per_ip: 5, checkout_time_s: 0.3, mouse_entropy: 0.05, account_age_days: 4, captcha_fail: 2 },
      flags: { isTrusted: false, webdriver: true, honeypotField: true, honeypotSeat: true, keyIntervalCv: 0.0, teleportCount: 3 },
      zone: "VIP", count: 2,
      name: "DOM_SCRAPER_AUTOFILL",
    },
    stealth: {
      title: "🥷 Bot #4: บอทแนบเนียน (Stealth Bot)",
      isBot: true,
      botType: "stealth",
      features: { clicks_per_min: 58, req_per_sec: 4.2, accounts_per_ip: 3, checkout_time_s: 14.0, mouse_entropy: 0.38, account_age_days: 25, captcha_fail: 1 },
      flags: { isTrusted: true, webdriver: false, honeypotField: false, honeypotSeat: false, keyIntervalCv: 0.05, teleportCount: 1 },
      zone: "VIP", count: 2,
      name: "STEALTH_PROXY_AGENT",
    },
    zeroday: {
      title: "🕵️ Bot #5: Zero-Day Bot (บอทสายพันธุ์ใหม่ไร้ Label!)",
      isBot: true,
      botType: "zeroday",
      features: { clicks_per_min: 11, req_per_sec: 0.45, accounts_per_ip: 14, checkout_time_s: 88.0, mouse_entropy: 0.04, account_age_days: 680, captcha_fail: 5 },
      flags: { isTrusted: true, webdriver: false, honeypotField: false, honeypotSeat: false, keyIntervalCv: 0.07, teleportCount: 2 },
      zone: "A", count: 4,
      name: "DISTRIBUTED_ZERODAY_NODE",
    },
  };

  function initLab() {
    S.labSelected = ["VIP-A01", "VIP-A02"];
    S.labMode = "live"; // 'live' or preset key
    S.labTelemetry = {
      startTime: performance.now(),
      mousePts: [],
      clicks: [],
      keys: [],
      untrustedEvents: 0,
      teleportCount: 0,
      honeypotSeatClicked: false,
    };

    const arena = $("tab-lab");
    arena.addEventListener("mousemove", (e) => {
      if (S.labMode !== "live") return;
      const pts = S.labTelemetry.mousePts;
      const now = performance.now();
      if (pts.length) {
        const prev = pts[pts.length - 1];
        const dist = Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
        const dt = Math.max(1, now - prev.t);
        if (dist > 360 && dt < 18) S.labTelemetry.teleportCount++;
      }
      pts.push({ x: e.clientX, y: e.clientY, t: now });
      if (pts.length > 80) pts.shift();
      updateLabTelemetryUI();
    });

    arena.addEventListener("click", (e) => {
      if (!e.isTrusted) S.labTelemetry.untrustedEvents++;
      if (S.labMode === "live") {
        S.labTelemetry.clicks.push(performance.now());
        if (S.labTelemetry.clicks.length > 40) S.labTelemetry.clicks.shift();
      }
    });

    arena.addEventListener("keydown", () => {
      if (S.labMode !== "live") {
        S.labMode = "live";
        $("lab-telemetry-mode").textContent = "โหมด: วัดจากการขยับเมาส์/คีย์บอร์ดจริงของคุณ";
        document.querySelectorAll("#lab-bot-grid .bot-card").forEach((b) => b.classList.remove("active"));
      }
      S.labTelemetry.keys.push(performance.now());
      if (S.labTelemetry.keys.length > 40) S.labTelemetry.keys.shift();
      updateLabEvaluation();
    });

    $("lab-seatmap").addEventListener("click", (e) => {
      const seat = e.target.dataset.seat;
      if (!seat) return;
      if (e.target.classList.contains("SOLD")) return;
      // If user clicks manually, switch back to live mode
      if (e.isTrusted && S.labMode !== "live") {
        S.labMode = "live";
        $("lab-telemetry-mode").textContent = "โหมด: วัดจากการขยับเมาส์/คีย์บอร์ดจริงของคุณ";
        document.querySelectorAll("#lab-bot-grid .bot-card").forEach((b) => b.classList.remove("active"));
      }
      const idx = S.labSelected.indexOf(seat);
      if (idx >= 0) S.labSelected.splice(idx, 1);
      else if (S.labSelected.length < 4) S.labSelected.push(seat);
      renderSeatMap("lab-seatmap", true, S.labSelected);
      updateSelectedBadge();
      updateLabEvaluation();
    });

    $("lab-honeypot-seat").addEventListener("click", () => {
      S.labTelemetry.honeypotSeatClicked = true;
      updateLabEvaluation();
    });

    $("btn-lab-id").onclick = () => {
      const u = S.users.find((x) => !x.is_bot) || S.users[0];
      const randomHuman = S.users.filter((x) => !x.is_bot);
      const pick = randomHuman[Math.floor(Math.random() * randomHuman.length)] || u;
      $("lab-thai-id").value = pick.thai_id;
      updateLabEvaluation();
    };

    $("lab-ip-accounts").oninput = () => updateLabEvaluation();
    $("lab-thai-id").oninput = () => updateLabEvaluation();

    $("btn-lab-reset").onclick = () => {
      S.labMode = "live";
      S.labTelemetry = {
        startTime: performance.now(),
        mousePts: [],
        clicks: [],
        keys: [],
        untrustedEvents: 0,
        teleportCount: 0,
        honeypotSeatClicked: false,
      };
      $("lab-honeypot").value = "";
      $("lab-ip-accounts").value = "1";
      $("lab-name").value = "ผู้ชม ทดสอบระบบ";
      $("lab-db-msg").textContent = "";
      $("lab-db-msg").className = "msg";
      $("lab-telemetry-mode").textContent = "โหมด: วัดจากการขยับเมาส์/คีย์บอร์ดจริงของคุณ";
      document.querySelectorAll("#lab-bot-grid .bot-card").forEach((b) => b.classList.remove("active"));
      updateSelectedBadge();
      updateLabEvaluation();
    };

    document.querySelectorAll("#lab-bot-grid .bot-card").forEach((btn) => {
      btn.addEventListener("click", () => runBotScenario(btn.dataset.bot, btn));
    });

    $("btn-lab-book").onclick = () => executeLabBooking();

    S.labReady = true;
    updateSelectedBadge();
    renderSeatMap("lab-seatmap", true, S.labSelected);
    updateLabEvaluation();
  }

  function updateSelectedBadge() {
    const el = $("lab-selected-badge");
    if (!el) return;
    if (!S.labSelected || !S.labSelected.length) {
      el.textContent = "ยังไม่ได้เลือกที่นั่ง";
      el.className = "pill p-warn";
    } else {
      el.textContent = `เลือกแล้ว ${S.labSelected.length}/4 ที่นั่ง: ${S.labSelected.join(", ")}`;
      el.className = "pill p1";
    }
  }

  function computeLiveFeatures() {
    if (S.labMode !== "live" && LAB_BOT_PRESETS[S.labMode]) {
      const p = LAB_BOT_PRESETS[S.labMode];
      return {
        features: { ...p.features, accounts_per_ip: +$("lab-ip-accounts").value || p.features.accounts_per_ip },
        flags: { ...p.flags, honeypotField: Boolean($("lab-honeypot").value) || p.flags.honeypotField },
        presetTitle: p.title,
        isBotPreset: p.isBot,
      };
    }

    const tel = S.labTelemetry;
    const elapsedS = Math.max(4, (performance.now() - tel.startTime) / 1000);
    const recentClicks = tel.clicks.filter((t) => performance.now() - t < 60000).length;
    const clicksPerMin = Math.max(8, Math.round((recentClicks / Math.min(60, elapsedS)) * 60));
    const reqPerSec = +(Math.max(0.3, recentClicks / elapsedS)).toFixed(2);

    // Compute mouse entropy from angle changes
    let entropy = 0.76;
    if (tel.mousePts.length >= 6) {
      const angles = [];
      for (let i = 2; i < tel.mousePts.length; i++) {
        const a1 = Math.atan2(tel.mousePts[i - 1].y - tel.mousePts[i - 2].y, tel.mousePts[i - 1].x - tel.mousePts[i - 2].x);
        const a2 = Math.atan2(tel.mousePts[i].y - tel.mousePts[i - 1].y, tel.mousePts[i].x - tel.mousePts[i - 1].x);
        let da = Math.abs(a2 - a1);
        if (da > Math.PI) da = 2 * Math.PI - da;
        angles.push(da);
      }
      const meanA = angles.reduce((s, v) => s + v, 0) / angles.length;
      const stdA = Math.sqrt(angles.reduce((s, v) => s + (v - meanA) ** 2, 0) / angles.length);
      entropy = Math.min(0.95, Math.max(0.15, +(0.45 + stdA * 0.65).toFixed(2)));
    }

    // Keystroke interval variation
    let keyCv = 0.38;
    if (tel.keys.length >= 4) {
      const diffs = [];
      for (let i = 1; i < tel.keys.length; i++) diffs.push(tel.keys[i] - tel.keys[i - 1]);
      const m = diffs.reduce((s, v) => s + v, 0) / diffs.length;
      const sd = Math.sqrt(diffs.reduce((s, v) => s + (v - m) ** 2, 0) / diffs.length);
      keyCv = m > 0 ? +(sd / m).toFixed(2) : 0.35;
    }

    return {
      features: {
        clicks_per_min: clicksPerMin,
        req_per_sec: reqPerSec,
        accounts_per_ip: +$("lab-ip-accounts").value || 1,
        checkout_time_s: Math.min(180, Math.max(12, Math.round(elapsedS))),
        mouse_entropy: entropy,
        account_age_days: 420,
        captcha_fail: 0,
      },
      flags: {
        isTrusted: tel.untrustedEvents === 0,
        webdriver: Boolean(navigator.webdriver),
        honeypotField: Boolean($("lab-honeypot").value),
        honeypotSeat: tel.honeypotSeatClicked,
        keyIntervalCv: keyCv,
        teleportCount: tel.teleportCount,
      },
      presetTitle: "👤 ผู้ใช้งานจริงบนเบราว์เซอร์ (Live Telemetry)",
      isBotPreset: false,
    };
  }

  function updateLabTelemetryUI() {
    if (!S.labReady) return;
    const { features, flags } = computeLiveFeatures();
    $("lab-telemetry-kpis").innerHTML = kpiHtml([
      ["ความเร็วคลิก", `${fmt(features.clicks_per_min)} /นาที`],
      ["Request Rate", `${fmt(features.req_per_sec, 1)} req/s`],
      ["Mouse Entropy", fmt(features.mouse_entropy, 2)],
      ["เวลาทำรายการ", `${fmt(features.checkout_time_s, 1)} วินาที`],
      ["บัญชีต่อ IP", `${fmt(features.accounts_per_ip)} บัญชี`],
      ["Event Trust", flags.isTrusted ? "isTrusted ✔" : "Script ✖"],
    ]);
  }

  function evaluateAllLayers() {
    const { features, flags, presetTitle } = computeLiveFeatures();
    const xVec = BF.map((f) => features[f.key]);

    // 1. Supervised Model Probability
    const supProb = S.models[S.cur].predictProba([xVec])[0];
    const supBlock = supProb >= S.thr;

    // 2. Unsupervised Anomaly Score (Isolation Forest + selected method)
    const LOGF = new Set(["clicks_per_min", "req_per_sec", "accounts_per_sec", "accounts_per_ip", "checkout_time_s", "account_age_days", "captcha_fail"]);
    const xr = BF.map((f, j) => (LOGF.has(f.key) ? Math.log1p(Math.max(0, xVec[j])) : xVec[j]));
    const xs = S.anom.scaler.transform([xr])[0];
    const ifScore = S.anom.methods.iforest.predictOne(xs);
    const ifCut = flagsForScores(S.anom.methods.iforest.scores, +$("anom-pct").value / 100).cut;
    const unsupBlock = ifScore >= ifCut;

    // 3. StagePass 11-Layer Shield checks
    const idCheck = data.validateThaiId($("lab-thai-id").value.replace(/[\s-]/g, ""));
    const layers = [
      {
        name: "Layer 1 · Browser Fingerprint & WebDriver",
        status: flags.webdriver ? "fail" : "pass",
        detail: flags.webdriver ? "ตรวจพบ navigator.webdriver = true (Headless/Automation)" : "เบราว์เซอร์ปกติ (webdriver = false)",
      },
      {
        name: "Layer 2 · DOM Event Trust (event.isTrusted)",
        status: !flags.isTrusted ? "fail" : "pass",
        detail: !flags.isTrusted ? "ตรวจพบการคลิกจำลองด้วย element.click() / dispatchEvent" : "คลิกจากฮาร์ดแวร์เมาส์จริง (isTrusted = true)",
      },
      {
        name: "Layer 3 · Mouse Trajectory & Entropy",
        status: features.mouse_entropy < 0.15 || flags.teleportCount > 2 ? "fail" : features.mouse_entropy < 0.42 ? "warn" : "pass",
        detail: `Mouse Entropy = ${features.mouse_entropy.toFixed(2)} · วาร์ป ${flags.teleportCount} ครั้ง`,
      },
      {
        name: "Layer 4 · Click Cadence & Burst Rate",
        status: features.clicks_per_min > 140 || features.req_per_sec > 10 ? "fail" : features.clicks_per_min > 50 ? "warn" : "pass",
        detail: `${features.clicks_per_min} คลิก/นาที (${features.req_per_sec} req/s)`,
      },
      {
        name: "Layer 5 · Keystroke Dynamics",
        status: flags.keyIntervalCv < 0.04 ? "fail" : flags.keyIntervalCv < 0.12 ? "warn" : "pass",
        detail: `ความแปรปรวนจังหวะพิมพ์ CV = ${flags.keyIntervalCv.toFixed(2)}`,
      },
      {
        name: "Layer 6 · Checkout Speed Timing",
        status: features.checkout_time_s < 4 ? "fail" : features.checkout_time_s < 15 ? "warn" : "pass",
        detail: `ใช้เวลากรอกและเลือกที่นั่ง ${features.checkout_time_s} วินาที`,
      },
      {
        name: "Layer 7 · Honeypot Hidden Field & Trap Seat (Z99)",
        status: flags.honeypotField || flags.honeypotSeat ? "fail" : "pass",
        detail: flags.honeypotField || flags.honeypotSeat ? "ติดกับดักบอท! กรอกช่องลับหรือคลิกที่นั่งล่อ Z99" : "ไม่แตะช่องลับ Honeypot",
      },
      {
        name: "Layer 8 · Distributed IP / Multi-Account Check",
        status: features.accounts_per_ip >= 8 ? "fail" : features.accounts_per_ip >= 3 ? "warn" : "pass",
        detail: `พบ ${features.accounts_per_ip} บัญชีใช้งานจาก IP เดียวกัน`,
      },
      {
        name: `Layer 9 · Supervised ML (${MODEL_NAMES[S.cur]})`,
        status: supBlock ? "fail" : "pass",
        detail: `P(บอท) = ${(supProb * 100).toFixed(1)}% (เกณฑ์ ${(S.thr * 100).toFixed(0)}%) → ${supBlock ? "🤖 บล็อก (ตรงกับแพตเทิร์นบอทที่มี Label)" : "🙂 ผ่านเกณฑ์ Supervised"}`,
      },
      {
        name: "Layer 10 · Unsupervised Anomaly Detection (Isolation Forest)",
        status: unsupBlock ? "fail" : "pass",
        detail: `Anomaly Score = ${ifScore.toFixed(2)} (เกณฑ์ ${ifCut.toFixed(2)}) → ${unsupBlock ? "🚨 ติดธง Anomaly! (จับบอทไร้ Label / Zero-Day ได้)" : "🙂 พฤติกรรมอยู่ในกลุ่มปกติ (Inlier)"}`,
      },
      {
        name: "Layer 11 · Thai ID Modulo-11 & SQLite Quota Trigger",
        status: !idCheck.ok ? "fail" : "pass",
        detail: idCheck.ok ? `เลขบัตร 13 หลักถูกต้อง · จำกัดไม่เกิน ${DBM.MAX_TICKETS_PER_ID} ใบ/บัตร` : `เลขบัตรไม่ถูกต้อง (${idCheck.reason})`,
      },
    ];

    const shieldFails = layers.filter((l) => l.status === "fail").length;
    return { features, flags, presetTitle, supProb, supBlock, ifScore, ifCut, unsupBlock, idCheck, layers, shieldFails };
  }

  function updateLabEvaluation() {
    if (!S.labReady) return;
    updateLabTelemetryUI();
    const ev = evaluateAllLayers();

    // Update 3-pillar summary
    $("lab-layer-summary").innerHTML = kpiHtml([
      ["ด่าน 1 · Supervised ML", ev.supBlock ? `🤖 บล็อก (${pct(ev.supProb, 0)})` : `✅ ผ่าน (${pct(ev.supProb, 0)})`],
      ["ด่าน 2 · Unsupervised Anomaly", ev.unsupBlock ? `🚨 ติดธง (${ev.ifScore.toFixed(2)})` : `✅ ปกติ (${ev.ifScore.toFixed(2)})`],
      ["ด่าน 3 · บัตร ปชช. & DB", ev.idCheck.ok ? "✅ Checksum ผ่าน" : "❌ เลขบัตรผิด"],
    ]);

    // Update overall verdict banner
    const vEl = $("lab-verdict");
    if (!ev.supBlock && ev.unsupBlock) {
      vEl.className = "msg big warn";
      vEl.innerHTML = `🕵️ <b>ตรวจพบบอทสายพันธุ์ใหม่ (Zero-Day Bot)!</b> · โมเดล Supervised ปล่อยผ่านเพราะคลิกช้าเหมือนคน (P=${ev.supProb.toFixed(2)}) แต่ <b>Unsupervised Anomaly Detection (Isolation Forest)</b> จับได้จากความผิดปกติหลายมิติ (Score=${ev.ifScore.toFixed(2)} ≥ ${ev.ifCut.toFixed(2)})!`;
    } else if (ev.shieldFails > 0) {
      vEl.className = "msg big bad";
      vEl.innerHTML = `🚫 <b>ระบบป้องกัน StagePass × TicketFlow ปฏิเสธรายการ!</b> · ตกเกณฑ์ความปลอดภัย ${ev.shieldFails} ด่าน (${ev.presetTitle})`;
    } else {
      vEl.className = "msg big ok";
      vEl.innerHTML = `✅ <b>ผ่านการตรวจสอบครบทั้ง 11 ชั้น!</b> · พฤติกรรมสอดคล้องกับผู้ใช้งานจริง พร้อมจองที่นั่งผ่าน SQLite Atomic Transaction`;
    }

    // Render 11-layer checklist
    $("lab-shield-list").innerHTML = ev.layers
      .map(
        (l) => `
      <div class="shield-item ${l.status}">
        <span class="s-name">${l.status === "pass" ? "✅" : l.status === "warn" ? "⚠️" : "🛑"} ${l.name}</span>
        <span class="s-detail">${l.detail}</span>
      </div>`
      )
      .join("");
  }

  async function runBotScenario(botKey, btnEl) {
    const preset = LAB_BOT_PRESETS[botKey];
    if (!preset) return;
    document.querySelectorAll("#lab-bot-grid .bot-card").forEach((b) => b.classList.remove("active"));
    if (btnEl) btnEl.classList.add("active");

    S.labMode = botKey;
    $("lab-telemetry-mode").textContent = `โหมดจำลอง: ${preset.title}`;
    $("lab-name").value = preset.name;
    $("lab-ip-accounts").value = preset.features.accounts_per_ip;
    $("lab-honeypot").value = preset.flags.honeypotField ? "https://scalper-bot-auto.xyz" : "";

    // Pick appropriate user from DB so bookings reflect human vs bot in seatmap
    const pool = S.users.filter((u) => (preset.isBot ? u.is_bot === 1 : u.is_bot === 0));
    const matchUser = pool[Math.floor(Math.random() * pool.length)] || S.users[0];
    $("lab-thai-id").value = matchUser.thai_id;

    // Animate virtual bot cursor across target seats and booking button
    const cursor = $("bot-cursor");
    cursor.textContent = preset.isBot ? "🤖" : "👆";
    cursor.style.display = "block";

    S.labSelected = [];
    renderSeatMap("lab-seatmap", true, S.labSelected);

    const targetSeats = S.db.availableSeats(preset.zone || "VIP", preset.count || 2);
    for (const seatId of targetSeats) {
      const seatEl = document.querySelector(`#lab-seatmap [data-seat="${seatId}"]`);
      if (seatEl) {
        const rect = seatEl.getBoundingClientRect();
        cursor.style.left = rect.left + rect.width / 2 + "px";
        cursor.style.top = rect.top + rect.height / 2 + "px";
        await new Promise((r) => setTimeout(r, preset.isBot && botKey !== "zeroday" ? 80 : 150));
        if (!seatEl.classList.contains("SOLD")) {
          S.labSelected.push(seatId);
          renderSeatMap("lab-seatmap", true, S.labSelected);
          updateSelectedBadge();
        }
      }
    }

    const bookBtn = $("btn-lab-book");
    if (bookBtn) {
      const rect = bookBtn.getBoundingClientRect();
      cursor.style.left = rect.left + rect.width / 2 + "px";
      cursor.style.top = rect.top + rect.height / 2 + "px";
      await new Promise((r) => setTimeout(r, 200));
    }
    setTimeout(() => { cursor.style.display = "none"; }, 450);

    updateLabEvaluation();
    executeLabBooking();
  }

  function executeLabBooking() {
    const ev = evaluateAllLayers();
    const msgEl = $("lab-db-msg");

    if (ev.shieldFails > 0) {
      msgEl.className = "msg bad";
      if (!ev.supBlock && ev.unsupBlock) {
        msgEl.innerHTML = `🛑 <b>บล็อกโดยด่านที่ 2 (Unsupervised Anomaly Detection)!</b> แม้โมเดล Supervised จะคิดว่าเป็นคน (P=${ev.supProb.toFixed(2)}) แต่ Isolation Forest ตรวจพบค่าความผิดปกติสูง (${ev.ifScore.toFixed(2)}) จึงไม่อนุญาตให้ทำ Transaction ลงฐานข้อมูล`;
      } else {
        const failedNames = ev.layers.filter((l) => l.status === "fail").map((l) => l.name.split("·")[1]?.trim() || l.name);
        msgEl.innerHTML = `🛑 <b>คำสั่งซื้อถูกสกัดกั้นก่อนถึงฐานข้อมูล!</b> ไม่ผ่านด่าน: <b>${failedNames.join(", ")}</b>`;
      }
      return;
    }

    if (!S.labSelected.length) {
      msgEl.className = "msg warn";
      msgEl.textContent = "⚠️ กรุณาคลิกเลือกที่นั่งว่างในผังอย่างน้อย 1 ที่นั่งก่อนยืนยันการจอง";
      return;
    }

    // Find or assign user_id in SQLite
    const rawId = $("lab-thai-id").value.replace(/[\s-]/g, "");
    const h = data.hashId(rawId);
    const existing = S.db.query("SELECT user_id FROM users WHERE id_hash=?", [h])[0];
    const uid = existing ? existing.user_id : 1;

    const booked = [];
    let failReason = null;
    for (const seatId of S.labSelected) {
      const r = S.db.bookSeat(uid, seatId);
      if (r.ok) booked.push(seatId);
      else { failReason = r.reason; break; }
    }

    S.labSelected = [];
    renderSeatMap("lab-seatmap", true, S.labSelected);
    renderSeatMap("seatmap", true);
    updateSelectedBadge();

    if (booked.length && !failReason) {
      msgEl.className = "msg ok";
      msgEl.innerHTML = `🎉 <b>จองตั๋วสำเร็จ (COMMIT)!</b> · บันทึกที่นั่ง <b>${booked.join(", ")}</b> ให้ <code>user_id=${uid}</code> ลงตาราง <code>orders</code> ใน SQLite เรียบร้อย`;
    } else if (booked.length && failReason) {
      msgEl.className = "msg warn";
      msgEl.innerHTML = `⚠️ จองสำเร็จบางส่วน (<b>${booked.join(", ")}</b>) · ที่นั่งถัดไปถูกปฏิเสธโดย SQLite Trigger: <b>${failReason}</b> (จำกัดสูงสุด ${DBM.MAX_TICKETS_PER_ID} ใบ/เลขบัตรประชาชน)`;
    } else {
      msgEl.className = "msg bad";
      msgEl.innerHTML = `✖ <b>SQLite Transaction ปฏิเสธการจอง (ROLLBACK):</b> ${failReason === "LIMIT_EXCEEDED" ? `เลขบัตรประชาชนนี้ซื้อครบโควตา ${DBM.MAX_TICKETS_PER_ID} ใบแล้ว` : "ที่นั่งถูกจองไปแล้ว"}`;
    }
  }

  // ============================================================
  // 2. Supervised
  // ============================================================
  function makeModel(key) {
    if (key === "lr") return new ml.LogisticRegression({ lr: 0.3, epochs: 400, l2: 0.001 });
    if (key === "dt") return new ml.DecisionTree({ maxDepth: 4, minSamplesLeaf: 5 });
    if (key === "rf") return new ml.RandomForest({ nTrees: 40, maxDepth: 6, seed: S.seed });
    return new ml.RuleBaseline(1, 10);
  }

  /** Out-of-fold prediction (5-fold) — ทุกบัญชีได้ความน่าจะเป็นจากโมเดลที่ไม่เคยเห็นบัญชีนั้น */
  function crossValPredict(key, X, y, k = 5) {
    const rng = new CT.Rng(S.seed + 99);
    const idx = rng.shuffle([...X.keys()]);
    const out = new Array(X.length);
    for (let f = 0; f < k; f++) {
      const test = idx.filter((_, i) => i % k === f), train = idx.filter((_, i) => i % k !== f);
      const m = makeModel(key).fit(train.map((i) => X[i]), train.map((i) => y[i]));
      const p = m.predictProba(test.map((i) => X[i]));
      test.forEach((i, j) => (out[i] = p[j]));
    }
    return out;
  }

  function trainAll() {
    const rng = new CT.Rng(S.seed + 1);
    S.split = ml.stratifiedSplit(S.X.length, S.y, 0.3, rng);
    // โมเดล Supervised มีเฉพาะ known_label ในชุดฝึก (บอท zeroday ยังไม่มีใครติด label จึงมีค่าเป็น 0)
    const Xtr = S.split.train.map((i) => S.X[i]), ytr = S.split.train.map((i) => S.yKnown[i]);
    S.Xte = S.split.test.map((i) => S.X[i]);
    S.yte = S.split.test.map((i) => S.y[i]);
    S.yteKnown = S.split.test.map((i) => S.yKnown[i]);
    S.models = {}; S.probsTest = {}; S.probsAll = {};
    for (const key of ["lr", "dt", "rf", "rule"]) {
      const m = makeModel(key).fit(Xtr, ytr);
      S.models[key] = m;
      S.probsTest[key] = m.predictProba(S.Xte);
      S.probsAll[key] = key === "rule" ? m.predictProba(S.X) : crossValPredict(key, S.X, S.yKnown);
    }
  }

  function savePredictions() {
    const p = S.probsAll[S.cur];
    const anomScores = S.anom ? S.anom.methods[S.anomMethod].scores : new Array(S.users.length).fill(0);
    const anomFlags = S.anom ? S.anom.flags : new Array(S.users.length).fill(0);
    S.db.savePredictions(
      S.users.map((u, i) => ({
        user_id: u.user_id,
        prob: p[i],
        decision: p[i] >= S.thr ? "BLOCK" : "ALLOW",
        anom_score: anomScores[i],
        anom_flag: anomFlags[i],
      })),
      `${MODEL_NAMES[S.cur]} + ${ANOM_NAMES[S.anomMethod]}`
    );
  }

  function recallBySubset(indices, prob, thr) {
    if (!indices.length) return 0;
    return indices.filter((i) => prob[i] >= thr).length / indices.length;
  }

  function renderSupervised() {
    const key = S.cur, prob = S.probsTest[key];
    const c = ml.confusion(S.yte, prob, S.thr);
    const knownTe = S.split.test.map((idx, j) => (S.users[idx].bot_type && S.users[idx].bot_type !== "zeroday" ? j : -1)).filter((j) => j >= 0);
    const zeroTe = S.split.test.map((idx, j) => (S.users[idx].bot_type === "zeroday" ? j : -1)).filter((j) => j >= 0);
    const recKnown = recallBySubset(knownTe, prob, S.thr);
    const recZero = recallBySubset(zeroTe, prob, S.thr);
    $("cm").innerHTML = `
      <div class="cm">
        <div></div><div class="h">ทำนาย: คน</div><div class="h">ทำนาย: บอท</div>
        <div class="h">จริง: คน</div><div class="c good">${c.tn}<small>TN</small></div><div class="c badc">${c.fp}<small>FP · คนจริงถูกปฏิเสธ</small></div>
        <div class="h">จริง: บอท</div><div class="c badc">${c.fn}<small>FN · บอทหลุด (ส่วนใหญ่คือ Zero-Day)</small></div><div class="c good">${c.tp}<small>TP</small></div>
      </div>`;
    const cost = c.fp * +$("cost-fp").value + c.fn * +$("cost-fn").value;
    $("sup-metrics").innerHTML = kpiHtml([
      ["Precision", pct(c.prec)], ["Recall (บอทที่มี Label)", pct(recKnown)], ["Recall (Zero-Day ไร้ Label)", pct(recZero)],
      ["Recall รวม", pct(c.rec)], ["F1", fmt(c.f1, 3)], ["ต้นทุนรวม", fmt(cost)],
    ]);

    // ROC ทุกโมเดล
    chart("chart-roc", {
      type: "scatter",
      data: {
        datasets: [
          ...["rf", "dt", "lr", "rule"].map((k, i) => {
            const r = ml.roc(S.yte, S.probsTest[k]);
            return { label: `${MODEL_NAMES[k]} (AUC ${r.auc.toFixed(3)})`, data: r.pts, showLine: true, pointRadius: 0, borderWidth: k === key ? 3 : 1.5, borderColor: PALETTE[i] };
          }),
          { label: "สุ่ม", data: [{ x: 0, y: 0 }, { x: 1, y: 1 }], showLine: true, pointRadius: 0, borderDash: [4, 4], borderColor: "#888" },
        ],
      },
      options: { plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { x: { title: { display: true, text: "False Positive Rate" }, min: 0, max: 1 }, y: { title: { display: true, text: "True Positive Rate" }, min: 0, max: 1 } } },
    });

    // Feature importance
    const imp = S.models[key].featureImportance();
    chart("chart-imp", {
      type: "bar",
      data: { labels: BF.map((f) => f.label), datasets: [{ data: imp || BF.map((_, i) => (i === 1 ? 1 : 0)), backgroundColor: PALETTE[0] }] },
      options: { indexAxis: "y", plugins: { legend: { display: false }, title: { display: !imp, text: "กฎใช้แค่ request/วินาที ตัวเดียว" } } },
    });

    // ตารางเปรียบเทียบ
    const rows = ["rf", "dt", "lr", "rule"].map((k) => ({
      k,
      c: ml.confusion(S.yte, S.probsTest[k], 0.5),
      recKnown: recallBySubset(knownTe, S.probsTest[k], 0.5),
      recZero: recallBySubset(zeroTe, S.probsTest[k], 0.5),
      auc: ml.roc(S.yte, S.probsTest[k]).auc,
    }));
    const bestF1 = Math.max(...rows.map((r) => r.c.f1));
    $("sup-compare").innerHTML = `<thead><tr><th>โมเดล</th><th class="num">Prec</th><th class="num">Recall (มี Label)</th><th class="num">Recall (Zero-Day)</th><th class="num">Recall รวม</th><th class="num">F1</th><th class="num">FP</th><th class="num">FN</th></tr></thead><tbody>` +
      rows.map((r) => `<tr class="${r.c.f1 === bestF1 ? "best" : ""}"><td>${MODEL_NAMES[r.k]}</td><td class="num">${pct(r.c.prec)}</td><td class="num">${pct(r.recKnown)}</td><td class="num" style="color:var(--warn)">${pct(r.recZero)}</td><td class="num">${pct(r.c.rec)}</td><td class="num">${fmt(r.c.f1, 3)}</td><td class="num">${r.c.fp}</td><td class="num">${r.c.fn}</td></tr>`).join("") + "</tbody>";

    // ต้นทุน vs threshold
    const bt = ml.bestThreshold(S.yte, prob, +$("cost-fp").value, +$("cost-fn").value);
    S.bestThr = bt.thr;
    chart("chart-cost", {
      type: "scatter",
      data: { datasets: [
        { label: "ต้นทุนรวม", data: bt.curve, showLine: true, pointRadius: 0, borderColor: PALETTE[2] },
        { label: `threshold ปัจจุบัน (${S.thr.toFixed(2)})`, data: [{ x: S.thr, y: cost }], pointRadius: 6, backgroundColor: PALETTE[1] },
        { label: `ต่ำสุดที่ ${bt.thr}`, data: [{ x: bt.thr, y: bt.cost }], pointRadius: 6, pointStyle: "star", borderColor: PALETTE[3], backgroundColor: PALETTE[3] },
      ] },
      options: { plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { x: { min: 0, max: 1, title: { display: true, text: "threshold" } }, y: { title: { display: true, text: "ต้นทุน" } } } },
    });

    $("tree-text").textContent = S.models.dt.toText(BF.map((f) => f.label));
    buildTryForm();
    tryPredict();
  }

  // ---------- ทดสอบบัญชีเดียว ----------
  const TRY_EXAMPLES = {
    "บัญชี ก (คนปกติ)": [12, 0.5, 1, 80, 0.75, 600, 0],
    "บัญชี ข (คนรีบกด)": [40, 2, 1, 35, 0.68, 300, 1],
    "บัญชี ค (บอทโจ่งแจ้ง)": [300, 25, 8, 5, 0.1, 3, 4],
    "บัญชี ง (บอทแนบเนียน)": [60, 4, 2, 18, 0.45, 30, 1],
    "บัญชี จ (Zero-Day ไร้ Label)": [10, 0.4, 11, 95, 0.05, 700, 5],
  };
  function buildTryForm() {
    if ($("try-form").dataset.built) return;
    $("try-form").dataset.built = "1";
    const ex = Object.values(TRY_EXAMPLES)[0];
    $("try-form").innerHTML =
      BF.map((f, i) => `<label>${f.label}<input type="number" step="any" data-i="${i}" value="${ex[i]}" /></label>`).join("") +
      `<div style="grid-column:1/-1" class="row gap wrap">${Object.keys(TRY_EXAMPLES).map((k) => `<button class="btn ghost small" data-ex="${k}">${k}</button>`).join("")}</div>`;
    $("try-form").addEventListener("input", tryPredict);
    $("try-form").addEventListener("click", (e) => {
      const k = e.target.dataset.ex; if (!k) return;
      $("try-form").querySelectorAll("input").forEach((inp) => (inp.value = TRY_EXAMPLES[k][+inp.dataset.i]));
      tryPredict();
    });
  }
  function tryPredict() {
    const x = [...$("try-form").querySelectorAll("input")].map((i) => +i.value);
    const lines = ["rf", "dt", "lr", "rule"].map((k) => {
      const p = S.models[k].predictProba([x])[0];
      return `${MODEL_NAMES[k]}: P(บอท)=${p.toFixed(2)} → ${p >= S.thr ? "🤖 บอท" : "🙂 คน"}`;
    });
    if (S.anom && S.anom.methods.iforest.predictOne) {
      const LOGF = new Set(["clicks_per_min", "req_per_sec", "accounts_per_ip", "checkout_time_s", "account_age_days", "captcha_fail"]);
      const xr = BF.map((f, j) => (LOGF.has(f.key) ? Math.log1p(Math.max(0, x[j])) : x[j]));
      const xs = S.anom.scaler.transform([xr])[0];
      const ifScore = S.anom.methods.iforest.predictOne(xs);
      const ifCut = flagsForScores(S.anom.methods.iforest.scores, +$("anom-pct").value / 100).cut;
      lines.push(`🔎 Unsupervised (Isolation Forest): Score=${ifScore.toFixed(2)} (เกณฑ์ ${ifCut.toFixed(2)}) → ${ifScore >= ifCut ? "🚨 ติดธง Anomaly (จับได้แม้ไม่มี Label!)" : "🙂 ปกติ"}`);
    }
    const p = S.models[S.cur].predictProba([x])[0];
    $("try-result").className = "msg big " + (p >= S.thr ? "bad" : "ok");
    $("try-result").innerHTML = `${MODEL_NAMES[S.cur]}: ${p >= S.thr ? "🤖 บอท — ปฏิเสธ/ขอยืนยันตัวตนเพิ่ม" : "🙂 คน — อนุญาตให้ซื้อ"} (P=${p.toFixed(2)})<div class="small muted">${lines.join("<br>")}</div>`;
  }

  // ============================================================
  // 3. Unsupervised
  // ============================================================
  function runUnsupervised(recomputeElbow = false) {
    const onlyHuman = $("uns-only-human").checked;
    const p = S.probsAll[S.cur];
    const anomFlags = S.anom ? S.anom.flags : new Array(S.users.length).fill(0);
    const idx = S.users.map((_, i) => i).filter((i) => !onlyHuman || (p[i] < S.thr && !anomFlags[i]));
    const Xraw = idx.map((i) => SF.map((f) => S.users[i][f.key]));
    const scaler = new ml.StandardScaler().fit(Xraw);
    const Xs = scaler.transform(Xraw);
    const k = +$("uns-k").value;

    if (recomputeElbow || !S.elbow) {
      S.elbow = unsup.elbow(Xs, 2, 8);
      chart("chart-elbow", { type: "line", data: { labels: S.elbow.map((e) => e.k), datasets: [{ data: S.elbow.map((e) => e.inertia), borderColor: PALETTE[0], tension: 0.2 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: "k" } } } } });
      const bestK = S.elbow.reduce((a, b) => (b.silhouette > a.silhouette ? b : a)).k;
      chart("chart-sil", { type: "bar", data: { labels: S.elbow.map((e) => e.k), datasets: [{ data: S.elbow.map((e) => e.silhouette), backgroundColor: S.elbow.map((e) => (e.k === bestK ? PALETTE[3] : PALETTE[1])) }] }, options: { plugins: { legend: { display: false }, title: { display: true, text: `silhouette สูงสุดที่ k = ${bestK}` } }, scales: { x: { title: { display: true, text: "k" } } } } });
    }

    const km = unsup.kmeans(Xs, k, { seed: S.seed });
    const pca = new unsup.PCA().fit(Xs);
    const Z = pca.transform(Xs, 2);
    const Zc = pca.transform(km.centroids, 2);

    chart("chart-pcavar", {
      type: "bar",
      data: { labels: pca.explained.map((_, i) => "PC" + (i + 1)), datasets: [
        { type: "bar", label: "รายตัว", data: pca.explained, backgroundColor: PALETTE[0] },
        { type: "line", label: "สะสม", data: pca.explained.map((_, i) => pca.explained.slice(0, i + 1).reduce((a, b) => a + b, 0)), borderColor: PALETTE[2] },
      ] },
      options: { scales: { y: { min: 0, max: 1 } }, plugins: { legend: { labels: { boxWidth: 10 } } } },
    });

    // โปรไฟล์ + ตั้งชื่อ
    const profiles = [...Array(k).keys()].map((c) => {
      const members = idx.filter((_, j) => km.labels[j] === c);
      const mean = {};
      for (const f of SF) mean[f.key] = members.reduce((s, i) => s + S.users[i][f.key], 0) / (members.length || 1);
      return { cluster: c, size: members.length, mean, members };
    });
    const names = unsup.nameSegments(profiles);
    S.seg = {
      k, names, scaler, centroids: km.centroids,
      assign(u) {
        const x = scaler.transform([SF.map((f) => u[f.key])])[0];
        let bj = 0, bd = Infinity;
        km.centroids.forEach((c, j) => { const d = unsup.dist2(x, c); if (d < bd) { bd = d; bj = j; } });
        return { cluster: bj, name: names[bj] };
      },
    };

    const centroidColor = document.body.classList.contains("dark") ? "#ffffff" : "#1e1b4b";
    chart("chart-pca", {
      type: "scatter",
      data: { datasets: [
        ...profiles.map((pr) => ({
          label: `${names[pr.cluster]} (${pr.size})`,
          data: idx.map((_, j) => j).filter((j) => km.labels[j] === pr.cluster).map((j) => ({ x: Z[j][0], y: Z[j][1] })),
          backgroundColor: PALETTE[pr.cluster % PALETTE.length] + "aa", pointRadius: 3.5,
        })),
        { label: "centroid", data: Zc.map((z) => ({ x: z[0], y: z[1] })), pointStyle: "crossRot", pointRadius: 10, borderWidth: 3, borderColor: centroidColor },
      ] },
      options: { scales: { x: { title: { display: true, text: `PC1 (${pct(pca.explained[0])})` } }, y: { title: { display: true, text: `PC2 (${pct(pca.explained[1])})` } } }, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } } },
    });

    const dec = { avg_ticket_price: 0, vip_ratio: 2, concerts_per_year: 1, group_size: 1 };
    $("uns-profile").innerHTML = `<thead><tr><th>กลุ่ม</th><th class="num">จำนวน</th>${SF.map((f) => `<th class="num">${f.label}</th>`).join("")}</tr></thead><tbody>` +
      profiles.map((pr) => `<tr><td><span style="color:${PALETTE[pr.cluster % PALETTE.length]}">●</span> ${names[pr.cluster]}</td><td class="num">${pr.size} (${pct(pr.size / idx.length, 0)})</td>${SF.map((f) => `<td class="num">${fmt(pr.mean[f.key], dec[f.key] ?? 0)}</td>`).join("")}</tr>`).join("") + "</tbody>";

    const RECO = {
      "พรีเมียม/VIP": "ขายแพ็กเกจ VIP / Hospitality ราคาสูง และเปิด pre-sale สำหรับสมาชิก",
      "แฟนตัวยง": "Fan-club pre-sale พร้อมยืนยันตัวตนเข้มงวด เพราะกลุ่มนี้ถูกบอทแย่งตั๋วมากที่สุด",
      "ครอบครัว/กลุ่ม": "บัตรแพ็กกลุ่ม 4 ใบ ที่นั่งติดกัน",
      "นักศึกษา/สายประหยัด": "กันโควตาโซน C หรือให้ส่วนลดนักศึกษา (ทดลองได้ในแท็บ 5)",
      "ผู้ชมทั่วไป": "กลุ่มนี้ซื้อใกล้วันงาน จึงเหมาะกับ last-minute sale และการแจ้งเตือนเมื่อมีที่นั่งคืน",
    };
    $("uns-reco").innerHTML = profiles.map((pr) => `<li><b>${names[pr.cluster]}</b>: ${RECO[names[pr.cluster]] || "วิเคราะห์เพิ่มเติม"}</li>`).join("");

    // crosstab กับ persona จริง
    const personas = [...new Set(idx.map((i) => S.users[i].persona_name))];
    let pure = 0;
    $("uns-crosstab").innerHTML = `<thead><tr><th>กลุ่มที่พบ \\ persona จริง</th>${personas.map((p) => `<th class="num">${p}</th>`).join("")}</tr></thead><tbody>` +
      profiles.map((pr) => {
        const counts = personas.map((pn) => pr.members.filter((i) => S.users[i].persona_name === pn).length);
        const mx = Math.max(...counts); pure += mx;
        return `<tr><td>${names[pr.cluster]}</td>${counts.map((c) => `<td class="num" style="${c === mx && c > 0 ? "color:var(--ok);font-weight:600" : ""}">${c}</td>`).join("")}</tr>`;
      }).join("") + "</tbody>";
    $("uns-purity").textContent = `Purity = ${pct(pure / idx.length)} — K-Means ไม่เคยเห็น persona จริงเลย แต่ยังค้นพบกลุ่มที่สอดคล้องกันได้`;

    // บันทึกลง DB (ทุกบัญชี — บัญชีนอกชุด fit ใช้ centroid ที่ใกล้ที่สุด)
    const zMap = new Map(idx.map((i, j) => [i, Z[j]]));
    S.db.saveSegments(S.users.map((u, i) => {
      const a = S.seg.assign(u);
      const z = zMap.get(i) || pca.transform(scaler.transform([SF.map((f) => u[f.key])]), 2)[0];
      return { user_id: u.user_id, cluster: a.cluster, segment_name: a.name, pc1: z[0], pc2: z[1] };
    }));
  }

  // ---------- Anomaly detection (5 วิธีจากคลาส Day 2: Unsupervised Learning + PCA Biplot) ----------
  function runAnomaly() {
    const LOGF = new Set(["clicks_per_min", "req_per_sec", "accounts_per_ip", "checkout_time_s", "account_age_days", "captcha_fail"]);
    const Xr = S.users.map((u) => BF.map((f) => (LOGF.has(f.key) ? Math.log1p(u[f.key]) : u[f.key])));
    const scaler = new ml.StandardScaler().fit(Xr);
    const Xs = scaler.transform(Xr);
    const pca = new unsup.PCA().fit(Xs);
    const Z = pca.transform(Xs, 2);

    const methods = {
      iforest: unsup.isolationForest(Xs, { nTrees: 80, sampleSize: 128, seed: S.seed + 11 }),
      lof: unsup.lof(Xs, { k: Math.max(30, Math.round(S.users.length * 0.12)) }),
      kmeans: unsup.kmeansAnomaly(Xs, { k: 4, seed: S.seed + 5 }),
      dbscan: unsup.dbscanAnomaly(Xs, { eps: 1.6, minSamples: Math.max(15, Math.round(S.users.length * 0.11)) }),
      stat: unsup.statAnomaly(Xs),
    };

    S.anom = { scaler, pca, Z, methods, flags: new Array(S.users.length).fill(0) };

    chart("chart-beh-pcavar", {
      type: "bar",
      data: {
        labels: pca.explained.map((_, i) => "PC" + (i + 1)),
        datasets: [
          { type: "bar", label: "รายตัว", data: pca.explained, backgroundColor: PALETTE[1] },
          { type: "line", label: "สะสม", data: pca.explained.map((_, i) => pca.explained.slice(0, i + 1).reduce((a, b) => a + b, 0)), borderColor: PALETTE[2] },
        ],
      },
      options: { scales: { y: { min: 0, max: 1 } }, plugins: { legend: { labels: { boxWidth: 10 } } } },
    });

    renderAnomaly();
  }

  function flagsForScores(sc, pctCut) {
    const n = sc.length;
    const sorted = sc.slice().sort((a, b) => b - a);
    const cut = sorted[Math.max(0, Math.round(n * pctCut) - 1)];
    return { cut, flag: sc.map((s) => (s >= cut ? 1 : 0)) };
  }

  function renderAnomaly() {
    if (!S.anom) return;
    S.anomMethod = $("anom-method") ? $("anom-method").value : "iforest";
    const sc = S.anom.methods[S.anomMethod].scores;
    const p = +$("anom-pct").value / 100;
    const { cut, flag } = flagsForScores(sc, p);
    S.anom.flags = flag;
    S.anom.cut = cut;
    savePredictions();

    const knownIdx = S.users.map((u, i) => (u.is_bot && u.bot_type !== "zeroday" ? i : -1)).filter((i) => i >= 0);
    const zeroIdx = S.users.map((u, i) => (u.bot_type === "zeroday" ? i : -1)).filter((i) => i >= 0);

    const c = ml.confusion(S.y, flag, 0.5);
    const recKnown = recallBySubset(knownIdx, flag, 0.5);
    const recZero = recallBySubset(zeroIdx, flag, 0.5);
    const auc = ml.roc(S.y, sc).auc;

    if ($("anom-cm")) {
      $("anom-cm").innerHTML = `
        <div class="cm">
          <div></div><div class="h">ปกติ (Inlier)</div><div class="h">ติดธง Anomaly</div>
          <div class="h">จริง: คน</div><div class="c good">${c.tn}<small>TN</small></div><div class="c badc">${c.fp}<small>FP · คนติดธง</small></div>
          <div class="h">จริง: บอท</div><div class="c badc">${c.fn}<small>FN · บอทหลุด</small></div><div class="c good">${c.tp}<small>TP · จับบอทได้</small></div>
        </div>`;
    }
    $("anom-metrics").innerHTML = kpiHtml([
      ["Precision", pct(c.prec)],
      ["Recall (บอททั้งหมด)", pct(c.rec)],
      ["Recall (Zero-Day ไร้ Label)", pct(recZero)],
      ["Recall (บอทที่มี Label)", pct(recKnown)],
      ["F1", fmt(c.f1, 3)],
      ["AUC", fmt(auc, 3)],
    ]);

    // ฮิสโทแกรมแยก คนจริง / บอทที่มี Label / บอท Zero-Day ไร้ Label
    const lo = Math.min(...sc), hi = Math.max(...sc), B = 28, w = (hi - lo) / B || 1;
    const hH = new Array(B).fill(0), hK = new Array(B).fill(0), hZ = new Array(B).fill(0);
    sc.forEach((s, i) => {
      const b = Math.min(B - 1, Math.floor((s - lo) / w));
      if (!S.y[i]) hH[b]++;
      else if (S.users[i].bot_type === "zeroday") hZ[b]++;
      else hK[b]++;
    });
    const labels = [...Array(B).keys()].map((b) => (lo + (b + 0.5) * w).toFixed(2));
    const cutBin = Math.min(B - 1, Math.floor((cut - lo) / w));
    chart("chart-anom", {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "คนจริง", data: hH, backgroundColor: labels.map((_, b) => (b >= cutBin ? "#16a34a" : "#16a34a55")) },
          { label: "บอทที่มี Label", data: hK, backgroundColor: labels.map((_, b) => (b >= cutBin ? "#dc2626" : "#dc262655")) },
          { label: "บอท Zero-Day (ไร้ Label)", data: hZ, backgroundColor: labels.map((_, b) => (b >= cutBin ? "#d97706" : "#d9770655")) },
        ],
      },
      options: {
        scales: {
          x: { stacked: true, title: { display: true, text: `${ANOM_NAMES[S.anomMethod]} Score (สีเข้ม ≥ ${cut.toFixed(2)} = ติดธง Anomaly)` } },
          y: { stacked: true },
        },
        plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 } } } },
      },
    });

    // PCA 2D Biplot & Anomaly Map
    const Z = S.anom.Z, pca = S.anom.pca;
    const ptsHuman = [], ptsKnown = [], ptsZero = [], ptsFlag = [];
    S.users.forEach((u, i) => {
      const pt = { x: Z[i][0], y: Z[i][1] };
      if (flag[i]) ptsFlag.push(pt);
      if (!u.is_bot) ptsHuman.push(pt);
      else if (u.bot_type === "zeroday") ptsZero.push(pt);
      else ptsKnown.push(pt);
    });
    const arrowScale = 3.6;
    const loadingDatasets = BF.map((f, j) => ({
      label: j === 0 ? "PCA Loadings (Biplot)" : undefined,
      data: [{ x: 0, y: 0 }, { x: pca.components[0][j] * arrowScale, y: pca.components[1][j] * arrowScale }],
      showLine: true,
      borderColor: "#d97706",
      borderWidth: 2,
      pointRadius: [0, 3],
      pointBackgroundColor: "#d97706",
    }));

    const ringColor = document.body.classList.contains("dark") ? "#ffffff" : "#4c1d95";
    chart("chart-beh-pca", {
      type: "scatter",
      data: {
        datasets: [
          { label: `คนจริง (${ptsHuman.length})`, data: ptsHuman, backgroundColor: "#16a34a88", pointRadius: 3 },
          { label: `บอทที่มี Label (${ptsKnown.length})`, data: ptsKnown, backgroundColor: "#dc2626cc", pointRadius: 4 },
          { label: `บอท Zero-Day ไร้ Label (${ptsZero.length})`, data: ptsZero, backgroundColor: "#d97706ee", pointStyle: "triangle", pointRadius: 6 },
          { label: `ถูกติดธง Anomaly (${ptsFlag.length})`, data: ptsFlag, backgroundColor: "transparent", borderColor: ringColor, borderWidth: 1.5, pointRadius: 6 },
          ...loadingDatasets,
        ],
      },
      options: {
        scales: {
          x: { title: { display: true, text: `PC1 (${pct(pca.explained[0])})` } },
          y: { title: { display: true, text: `PC2 (${pct(pca.explained[1])})` } },
        },
        plugins: {
          legend: {
            labels: {
              boxWidth: 10,
              font: { size: 10 },
              filter: (item) => item.text !== undefined,
            },
          },
        },
      },
    });

    // ตารางเปรียบเทียบทั้ง 5 วิธี Unsupervised Anomaly + Supervised
    if ($("anom-compare")) {
      const mRows = Object.keys(ANOM_NAMES).map((k) => {
        const s = S.anom.methods[k].scores;
        const fl = flagsForScores(s, p).flag;
        const cm = ml.confusion(S.y, fl, 0.5);
        return {
          name: `Unsupervised · ${ANOM_NAMES[k]}`,
          key: k,
          prec: cm.prec,
          recAll: cm.rec,
          recKnown: recallBySubset(knownIdx, fl, 0.5),
          recZero: recallBySubset(zeroIdx, fl, 0.5),
          f1: cm.f1,
          auc: ml.roc(S.y, s).auc,
        };
      });
      const supP = S.probsAll[S.cur];
      const supCm = ml.confusion(S.y, supP, S.thr);
      mRows.push({
        name: `Supervised · ${MODEL_NAMES[S.cur]} (ฝึกจาก Label เก่า)`,
        key: "sup",
        prec: supCm.prec,
        recAll: supCm.rec,
        recKnown: recallBySubset(knownIdx, supP, S.thr),
        recZero: recallBySubset(zeroIdx, supP, S.thr),
        f1: supCm.f1,
        auc: ml.roc(S.y, supP).auc,
      });
      // Hybrid row
      const hybFlag = S.users.map((_, i) => (supP[i] >= S.thr || flag[i] ? 1 : 0));
      const hybCm = ml.confusion(S.y, hybFlag, 0.5);
      mRows.push({
        name: `✨ Hybrid · ${MODEL_NAMES[S.cur]} + ${ANOM_NAMES[S.anomMethod]}`,
        key: "hybrid",
        prec: hybCm.prec,
        recAll: hybCm.rec,
        recKnown: recallBySubset(knownIdx, hybFlag, 0.5),
        recZero: recallBySubset(zeroIdx, hybFlag, 0.5),
        f1: hybCm.f1,
        auc: Math.max(ml.roc(S.y, supP).auc, auc),
      });

      $("anom-compare").innerHTML =
        `<thead><tr><th>วิธีตรวจจับ</th><th class="num">Prec</th><th class="num">Recall (มี Label)</th><th class="num">Recall (Zero-Day)</th><th class="num">Recall รวม</th><th class="num">F1</th><th class="num">AUC</th></tr></thead><tbody>` +
        mRows
          .map(
            (r) =>
              `<tr class="${r.key === S.anomMethod || r.key === "hybrid" ? "best" : ""}"><td>${r.name}</td><td class="num">${pct(r.prec)}</td><td class="num">${pct(r.recKnown)}</td><td class="num" style="font-weight:700;color:${r.recZero > 0.5 ? "var(--ok)" : "var(--bad)"}">${pct(r.recZero)}</td><td class="num">${pct(r.recAll)}</td><td class="num">${fmt(r.f1, 3)}</td><td class="num">${fmt(r.auc, 3)}</td></tr>`
          )
          .join("") +
        `</tbody>`;
    }
  }

  // ============================================================
  // 2. Database UI & Seat Map
  // ============================================================
  function renderSeatMap(containerId, clickable, selectedList = []) {
    if (!$(containerId)) return;
    const rows = S.db.query(`SELECT s.seat_id, s.zone, s.row_no, s.col_no, s.status, u.is_bot, o.user_id
      FROM seats s LEFT JOIN orders o ON o.seat_id = s.seat_id AND o.status='PAID'
      LEFT JOIN users u ON u.user_id = o.user_id ORDER BY s.row_no, s.col_no`);
    const byZone = {};
    rows.forEach((r) => (byZone[r.zone] ||= []).push(r));
    const selSet = new Set(selectedList || []);
    let html = `<div class="stage">STAGE · IMPACT ARENA</div>`;
    for (const z of DBM.ZONES) {
      const seats = byZone[z.zone] || [];
      const sold = seats.filter((s) => s.status === "SOLD").length;
      html += `<div class="zone zone-${z.zone}"><div class="zone-label">โซน ${z.zone} · ${fmt(z.price)} บาท · ขายแล้ว ${sold}/${seats.length}</div>
        <div class="zone-grid" style="grid-template-columns:repeat(${z.cols},16px)">` +
        seats.map((s) => {
          const isSel = s.status === "AVAILABLE" && selSet.has(s.seat_id);
          return `<i class="seat ${s.status} ${isSel ? "SELECTED" : ""} ${s.status === "SOLD" ? (s.is_bot ? "bot" : "human") : ""}" data-seat="${s.seat_id}" title="${s.seat_id} (${fmt(z.price)}฿)${s.user_id ? " · user " + s.user_id + (s.is_bot ? " (บอท)" : "") : ""}"></i>`;
        }).join("") +
        `</div></div>`;
    }
    $(containerId).innerHTML = html;
    $(containerId).dataset.clickable = clickable ? "1" : "";
  }

  const SQL_PRESETS = [
    { name: "ยอดขายต่อโซน", sql: `SELECT z.zone, z.price,
       COUNT(s.seat_id) AS total_seats,
       SUM(s.status='SOLD') AS sold,
       COALESCE(SUM(o.price),0) AS revenue
FROM zones z
JOIN seats s ON s.zone = z.zone
LEFT JOIN orders o ON o.seat_id = s.seat_id
GROUP BY z.zone ORDER BY z.price DESC;` },
    { name: "ยอดขายตามกลุ่มลูกค้า", sql: `SELECT sg.segment_name,
       COUNT(DISTINCT sg.user_id) AS customers,
       COUNT(o.order_id) AS tickets,
       COALESCE(SUM(o.price),0) AS revenue
FROM segments sg
JOIN users u USING(user_id)
LEFT JOIN orders o USING(user_id)
WHERE u.is_bot = 0
GROUP BY sg.segment_name ORDER BY revenue DESC;` },
    { name: "บอท Zero-Day ที่ Supervised พลาดแต่ Anomaly จับได้", sql: `SELECT u.user_id, u.bot_type,
       ROUND(p.bot_prob,3) AS sup_prob, p.decision AS sup_decision,
       ROUND(p.anom_score,3) AS anom_score,
       CASE p.anom_flag WHEN 1 THEN 'FLAG_ANOMALY' ELSE 'NORMAL' END AS unsup_decision
FROM users u
JOIN predictions p USING(user_id)
WHERE u.is_bot = 1 AND p.decision = 'ALLOW'
ORDER BY p.anom_score DESC LIMIT 20;` },
    { name: "เทียบ Supervised vs Unsupervised ด้วย SQL", sql: `SELECT COALESCE(u.bot_type, 'human') AS account_type,
       COUNT(*) AS total,
       SUM(p.decision = 'BLOCK') AS caught_by_supervised,
       SUM(p.anom_flag = 1) AS caught_by_anomaly,
       SUM(p.decision = 'BLOCK' OR p.anom_flag = 1) AS caught_by_hybrid
FROM users u JOIN predictions p USING(user_id)
GROUP BY 1 ORDER BY total DESC;` },
    { name: "ตรวจที่นั่งขายซ้ำ (ควรว่าง)", sql: `SELECT seat_id, COUNT(*) AS times_sold
FROM orders GROUP BY seat_id HAVING COUNT(*) > 1;` },
    { name: "ตรวจสิทธิ์ต่อบัตร", sql: `SELECT o.user_id, u.id_hash, COUNT(*) AS tickets
FROM orders o JOIN users u USING(user_id)
GROUP BY o.user_id ORDER BY tickets DESC LIMIT 10;` },
    { name: "ทดสอบ trigger (ซื้อเกินสิทธิ์)", sql: `-- ใส่ order ให้ user 1 ทีละใบ — ใบที่ ${DBM.MAX_TICKETS_PER_ID + 1} จะถูกปฏิเสธโดย trigger
INSERT INTO orders(user_id, seat_id, price)
SELECT 1, seat_id, 1500 FROM seats
WHERE status = 'AVAILABLE' AND zone = 'C'
LIMIT ${DBM.MAX_TICKETS_PER_ID + 1};` },
  ];

  function runSql() {
    const sql = $("sql-input").value;
    try {
      const res = S.db.exec(sql);
      if (!res.length) { $("sql-output").innerHTML = `<div class="msg ok">✔ สำเร็จ (แก้ไข ${S.db.db.getRowsModified()} แถว)</div>`; return; }
      $("sql-output").innerHTML = res.map((r) =>
        `<table class="tbl"><thead><tr>${r.columns.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>` +
        r.values.slice(0, 300).map((v) => `<tr>${v.map((x) => `<td class="${typeof x === "number" ? "num" : ""}">${x === null ? "NULL" : typeof x === "number" && !Number.isInteger(x) ? x.toFixed(3) : x}</td>`).join("")}</tr>`).join("") +
        `</tbody></table><p class="muted small">${r.values.length} แถว</p>`).join("");
    } catch (e) {
      $("sql-output").innerHTML = `<div class="msg bad">✖ ${String(e.message).includes("LIMIT_EXCEEDED") ? "Trigger ปฏิเสธ: เกินจำนวนตั๋วสูงสุดต่อบัตรประชาชน (ทั้งคำสั่งถูก rollback)" : e.message}</div>`;
    }
  }

  // ============================================================
  // 5. Simulation — รวมทุกส่วน
  // ============================================================
  function simulate({ mode = "hybrid", quota = false }) {
    const rng = new CT.Rng(S.seed + 777);
    S.db.resetSales();
    savePredictions();
    const prob = S.probsAll[S.cur];
    const anomFlag = S.anom ? S.anom.flags : new Array(S.users.length).fill(0);
    const zonePrice = Object.fromEntries(DBM.ZONES.map((z) => [z.zone, z.price]));
    const totalC = S.db.scalar("SELECT COUNT(*) FROM seats WHERE zone='C'");
    const reservedC = quota ? Math.round(totalC * 0.3) : 0;
    let studentC = 0;
    const totalSeats = S.db.scalar("SELECT COUNT(*) FROM seats");

    // เวลาเข้ามา: บอทเร็วกว่าคนมาก
    const arrivals = S.users.map((u, i) => ({
      u, i, seg: S.seg.assign(u).name,
      t: Math.floor(u.is_bot ? rng.lognormal(4, 0.7) : rng.lognormal(20, 0.9)),
    })).sort((a, b) => a.t - b.t);

    const st = {
      soldHuman: 0, soldBot: 0, soldBotKnown: 0, soldBotZero: 0,
      revenue: 0, revenueBot: 0, blockedBot: 0, blockedZero: 0, blockedHuman: 0,
      conflicts: 0, limitBlocks: 0, humansNoTicket: 0, humansServed: 0, soldOut: null,
      seg: {}, timeline: [],
    };
    const segStat = (name) => (st.seg[name] ||= { wanted: 0, got: 0, tickets: 0 });

    let ai = 0;
    const maxT = arrivals[arrivals.length - 1].t;
    for (let t = 0; t <= maxT; t++) {
      // snapshot ของที่นั่งว่างตอนต้นวินาที — ผู้ใช้ที่เข้ามาพร้อมกันเห็นข้อมูลเดียวกัน → เกิดการแย่ง
      const snap = {};
      for (const z of DBM.ZONES) snap[z.zone] = S.db.availableSeats(z.zone, 12);
      while (ai < arrivals.length && arrivals[ai].t === t) {
        const { u, i, seg } = arrivals[ai++];
        if (!u.is_bot) segStat(seg).wanted++;
        // (1) คัดกรองบอทตามโหมด (none / sup / unsup / hybrid)
        const blockSup = prob[i] >= S.thr;
        const blockUns = anomFlag[i] === 1;
        const blocked =
          mode === "sup" ? blockSup :
          mode === "unsup" ? blockUns :
          mode === "hybrid" ? (blockSup || blockUns) : false;
        if (blocked) {
          if (u.is_bot) {
            st.blockedBot++;
            if (u.bot_type === "zeroday") st.blockedZero++;
          } else {
            st.blockedHuman++;
          }
          continue;
        }
        // (2) เลือกโซน
        let zones, need;
        if (u.is_bot) { zones = ["VIP", "A", "B"]; need = 6; } // บอทพยายามซื้อเกินสิทธิ์
        else {
          need = Math.max(1, Math.round(u.group_size));
          const pref = rng.random() < u.vip_ratio ? "VIP" : null;
          zones = DBM.ZONES.map((z) => z.zone)
            .filter((z) => zonePrice[z] <= Math.max(u.avg_ticket_price * 1.6, pref === z ? Infinity : 0))
            .sort((a, b) => Math.abs(zonePrice[a] - u.avg_ticket_price) - Math.abs(zonePrice[b] - u.avg_ticket_price));
          if (pref) zones = ["VIP", ...zones.filter((z) => z !== "VIP")];
        }
        // (3) Database: จองผ่าน transaction
        let got = 0, stop = false;
        for (const z of zones) {
          if (stop || got >= need) break;
          let cands = snap[z].slice();
          let guard = 0;
          while (got < need && guard++ < 40) {
            if (z === "C" && quota && seg !== "นักศึกษา/สายประหยัด") {
              const availC = S.db.scalar("SELECT COUNT(*) FROM seats WHERE zone='C' AND status='AVAILABLE'");
              if (availC <= Math.max(0, reservedC - studentC)) break;
            }
            if (!cands.length) { cands = S.db.availableSeats(z, need - got); if (!cands.length) break; }
            const seat = cands.shift();
            const r = S.db.bookSeat(u.user_id, seat, t);
            if (r.ok) {
              got++;
              const price = zonePrice[z];
              st.revenue += price;
              if (u.is_bot) {
                st.soldBot++;
                st.revenueBot += price;
                if (u.bot_type === "zeroday") st.soldBotZero++;
                else st.soldBotKnown++;
              } else {
                st.soldHuman++;
                segStat(seg).tickets++;
                if (z === "C" && seg === "นักศึกษา/สายประหยัด") studentC++;
              }
            } else if (r.reason === "SEAT_TAKEN") { st.conflicts++; cands = []; }
            else if (r.reason === "LIMIT_EXCEEDED") { st.limitBlocks++; stop = true; break; }
            else break;
          }
        }
        if (!u.is_bot) { if (got > 0) { st.humansServed++; segStat(seg).got++; } else st.humansNoTicket++; }
      }
      const sold = st.soldHuman + st.soldBot;
      st.timeline.push({ t, human: st.soldHuman, bot: st.soldBot });
      if (st.soldOut === null && sold >= totalSeats) st.soldOut = t;
      if (t > 600 && ai >= arrivals.length) break;
    }
    st.totalSeats = totalSeats;
    st.zones = S.db.query(`SELECT s.zone, SUM(u.is_bot=0) AS human, SUM(u.is_bot=1) AS bot
      FROM orders o JOIN seats s USING(seat_id) JOIN users u USING(user_id) GROUP BY s.zone`);
    return st;
  }

  function renderSim(st) {
    const humans = S.users.filter((u) => !u.is_bot).length;
    $("sim-kpis").innerHTML = kpiHtml([
      ["ที่นั่งขายให้คน", fmt(st.soldHuman)],
      ["ตกไปอยู่กับบอทรวม", `${fmt(st.soldBot)} (${pct(st.soldBot / st.totalSeats)})`],
      ["ตั๋วที่เสียให้ Zero-Day Bot", fmt(st.soldBotZero)],
      ["คนจริงที่ได้ตั๋ว", `${fmt(st.humansServed)}/${fmt(humans)}`],
      ["บอทถูกบล็อก (Zero-Day)", `${fmt(st.blockedBot)} (${fmt(st.blockedZero)})`],
      ["คนจริงถูกบล็อก (FP)", fmt(st.blockedHuman)],
      ["กันจองซ้ำได้ (ครั้ง)", fmt(st.conflicts)],
      ["Trigger ปฏิเสธเกินสิทธิ์", fmt(st.limitBlocks)],
      ["ขายหมดใน", st.soldOut === null ? "ไม่หมด" : st.soldOut + " วินาที"],
    ]);
    const tl = st.timeline.filter((_, i) => i % 2 === 0 || i === st.timeline.length - 1);
    chart("chart-sim-time", {
      type: "line",
      data: { labels: tl.map((p) => p.t), datasets: [
        { label: "ขายให้คน", data: tl.map((p) => p.human), borderColor: "#16a34a", backgroundColor: "#16a34a33", fill: true, pointRadius: 0 },
        { label: "ขายให้บอท", data: tl.map((p) => p.bot), borderColor: "#dc2626", backgroundColor: "#dc262633", fill: true, pointRadius: 0 },
      ] },
      options: { scales: { x: { title: { display: true, text: "วินาทีหลังเปิดขาย" }, ticks: { maxTicksLimit: 12 } }, y: { title: { display: true, text: "ที่นั่งสะสม" } } } },
    });
    const zmap = Object.fromEntries(st.zones.map((z) => [z.zone, z]));
    chart("chart-sim-who", {
      type: "bar",
      data: { labels: DBM.ZONES.map((z) => "โซน " + z.zone), datasets: [
        { label: "คน", data: DBM.ZONES.map((z) => zmap[z.zone]?.human || 0), backgroundColor: "#16a34a" },
        { label: "บอท", data: DBM.ZONES.map((z) => zmap[z.zone]?.bot || 0), backgroundColor: "#dc2626" },
      ] },
      options: { scales: { x: { stacked: true }, y: { stacked: true } } },
    });
    renderSeatMap("sim-seatmap", false);
    renderSeatMap("lab-seatmap", true, S.labSelected);
  }

  function renderSimCompare(list) {
    const rows = [
      ["ที่นั่งตกไปอยู่กับบอทรวม", (s) => `${fmt(s.soldBot)} (${pct(s.soldBot / s.totalSeats)})`],
      ["— เสียให้บอทที่มีใน Label", (s) => fmt(s.soldBotKnown)],
      ["— เสียให้บอท Zero-Day (ไร้ Label)", (s) => fmt(s.soldBotZero)],
      ["ที่นั่งขายให้คนจริง", (s) => fmt(s.soldHuman)],
      ["คนจริงที่ได้ตั๋ว (คน)", (s) => fmt(s.humansServed)],
      ["บอทถูกบล็อก (รวม / Zero-Day)", (s) => `${fmt(s.blockedBot)} / ${fmt(s.blockedZero)}`],
      ["คนจริงถูกบล็อกผิด (FP)", (s) => fmt(s.blockedHuman)],
      ["นักศึกษาที่ได้ตั๋ว", (s) => { const g = s.seg["นักศึกษา/สายประหยัด"]; return g ? `${g.got}/${g.wanted} (${pct(g.got / (g.wanted || 1), 0)})` : "-"; }],
      ["แฟนตัวยงที่ได้ตั๋ว", (s) => { const g = s.seg["แฟนตัวยง"]; return g ? `${g.got}/${g.wanted} (${pct(g.got / (g.wanted || 1), 0)})` : "-"; }],
      ["กันจองซ้ำ / Trigger ปฏิเสธ", (s) => `${fmt(s.conflicts)} / ${fmt(s.limitBlocks)}`],
      ["ขายหมดใน (วินาที)", (s) => (s.soldOut === null ? "ไม่หมด" : s.soldOut)],
    ];
    $("sim-compare").innerHTML = `<thead><tr><th>ตัวชี้วัด</th>${list.map((l) => `<th class="num">${l.name}</th>`).join("")}</tr></thead><tbody>` +
      rows.map(([n, f]) => `<tr><td>${n}</td>${list.map((l) => `<td class="num">${f(l.st)}</td>`).join("")}</tr>`).join("") + "</tbody>";
  }

  // ============================================================
  // Events
  // ============================================================
  function bindEvents() {
    $("btn-regen").onclick = () => rebuild();

    if ($("btn-theme")) {
      $("btn-theme").onclick = () => {
        document.body.classList.toggle("dark");
        const isDark = document.body.classList.contains("dark");
        $("btn-theme").textContent = isDark ? "☀️ โหมดสว่าง" : "🌙 โหมดมืด";
        applyChartTheme();
        renderSupervised();
        renderAnomaly();
        runUnsupervised(false);
      };
    }

    // ----- DB tab -----
    $("max-ticket").textContent = DBM.MAX_TICKETS_PER_ID;
    $("btn-id-check").onclick = () => {
      const raw = $("id-input").value.replace(/[\s-]/g, "");
      const v = data.validateThaiId(raw);
      let out = "";
      if (/^\d{13}$/.test(raw)) {
        const terms = [...raw.slice(0, 12)].map((d, i) => `${d}×${13 - i}`);
        const sum = [...raw.slice(0, 12)].reduce((s, d, i) => s + d * (13 - i), 0);
        out += `ผลรวม = ${terms.join(" + ")} = ${sum}\n${sum} mod 11 = ${sum % 11} → หลักตรวจ = (11 − ${sum % 11}) mod 10 = ${(11 - (sum % 11)) % 10}\n`;
      }
      out += (v.ok ? "✔ " : "✖ ") + v.reason + "\n";
      if (v.ok) {
        const h = data.hashId(raw);
        const row = S.db.query("SELECT u.user_id, (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.user_id) AS n FROM users u WHERE id_hash=?", [h])[0];
        out += `hash ที่เก็บใน DB = ${h}\n` + (row ? `พบในระบบ: user_id ${row.user_id} · ซื้อไปแล้ว ${row.n}/${DBM.MAX_TICKETS_PER_ID} ใบ` : "ยังไม่ลงทะเบียนในระบบ");
        if (row) $("book-user").value = row.user_id;
      }
      $("id-result").textContent = out;
    };
    $("btn-id-random").onclick = () => {
      const u = S.users[Math.floor(Math.random() * S.users.length)];
      $("id-input").value = u.thai_id;
      $("btn-id-check").click();
    };
    $("btn-race-naive").onclick = () => ($("race-log").textContent = S.db.raceNaive("A12", 101, 202).join("\n"));
    $("btn-race-safe").onclick = () => ($("race-log").textContent = S.db.raceSafe("A12", 101, 202).join("\n"));
    $("seatmap").addEventListener("click", (e) => {
      const seat = e.target.dataset.seat;
      if (!seat) return;
      const uid = +$("book-user").value;
      const r = S.db.bookSeat(uid, seat);
      const msgs = { SEAT_TAKEN: "ที่นั่งนี้ถูกจองแล้ว (UPDATE แก้ไข 0 แถว)", LIMIT_EXCEEDED: `Trigger ปฏิเสธ: user ${uid} ซื้อครบ ${DBM.MAX_TICKETS_PER_ID} ใบแล้ว — rollback` };
      $("book-msg").className = "msg " + (r.ok ? "ok" : "bad");
      $("book-msg").textContent = r.ok ? `✔ user ${uid} จอง ${seat} สำเร็จ (COMMIT)` : "✖ " + (msgs[r.reason] || r.reason);
      renderSeatMap("seatmap", true);
      renderSeatMap("lab-seatmap", true, S.labSelected);
    });
    $("btn-reset-sales").onclick = () => {
      S.db.resetSales();
      renderSeatMap("seatmap", true);
      renderSeatMap("lab-seatmap", true, S.labSelected);
      $("book-msg").textContent = "";
    };

    $("sql-presets").innerHTML = SQL_PRESETS.map((p, i) => `<button class="btn ghost small" data-i="${i}">${p.name}</button>`).join("");
    $("sql-presets").addEventListener("click", (e) => {
      const i = e.target.dataset.i; if (i === undefined) return;
      $("sql-input").value = SQL_PRESETS[i].sql; runSql();
    });
    $("btn-sql-run").onclick = runSql;
    $("sql-input").addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") runSql(); });
    $("btn-sql-schema").onclick = () => { $("sql-input").value = "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL;"; runSql(); };
    $("btn-sql-download").onclick = () => {
      const blob = new Blob([S.db.exportFile()], { type: "application/x-sqlite3" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "ticketflow.sqlite"; a.click();
    };

    // ----- Supervised tab -----
    const onModelChange = () => { savePredictions(); renderSupervised(); runUnsupervised(true); renderAnomaly(); if (S.labReady) updateLabEvaluation(); };
    $("sup-model").onchange = (e) => { S.cur = e.target.value; onModelChange(); };
    $("sup-thr").oninput = (e) => { S.thr = +e.target.value; $("sup-thr-val").textContent = S.thr.toFixed(2); renderSupervised(); if (S.labReady) updateLabEvaluation(); };
    $("sup-thr").onchange = onModelChange;
    $("cost-fp").oninput = $("cost-fn").oninput = renderSupervised;
    $("btn-best-thr").onclick = () => {
      S.thr = S.bestThr; $("sup-thr").value = S.thr; $("sup-thr-val").textContent = S.thr.toFixed(2); onModelChange();
    };

    // ----- Unsupervised tab -----
    $("uns-k").oninput = (e) => { $("uns-k-val").textContent = e.target.value; runUnsupervised(false); };
    $("uns-only-human").onchange = () => runUnsupervised(true);
    if ($("anom-method")) $("anom-method").onchange = () => { renderAnomaly(); if (S.labReady) updateLabEvaluation(); };
    $("anom-pct").oninput = (e) => { $("anom-pct-val").textContent = e.target.value; renderAnomaly(); tryPredict(); if (S.labReady) updateLabEvaluation(); };

    // ----- Simulation tab -----
    const MODE_LABELS = {
      none: "ไม่คัดกรอง",
      sup: `Supervised (${MODEL_NAMES[S.cur]})`,
      unsup: `Unsupervised (${ANOM_NAMES[S.anomMethod]})`,
      hybrid: "Hybrid (Supervised + Anomaly)",
    };
    $("btn-sim-run").onclick = () => {
      const mode = $("sim-mode") ? $("sim-mode").value : "hybrid";
      const st = simulate({ mode, quota: $("sim-quota").checked });
      renderSim(st);
      renderSimCompare([{ name: MODE_LABELS[mode] || mode, st }]);
    };
    $("btn-sim-compare").onclick = () => {
      const quota = $("sim-quota").checked;
      const mNone = simulate({ mode: "none", quota });
      const mSup = simulate({ mode: "sup", quota });
      const mUns = simulate({ mode: "unsup", quota });
      const mHyb = simulate({ mode: "hybrid", quota });
      renderSim(mHyb);
      renderSimCompare([
        { name: "ไม่คัดกรอง", st: mNone },
        { name: "Supervised อย่างเดียว", st: mSup },
        { name: "Unsupervised Anomaly", st: mUns },
        { name: "✨ Hybrid (รวม 2 ด่าน)", st: mHyb },
      ]);
    };
  }

  init().catch((e) => { console.error(e); setStatus("เกิดข้อผิดพลาด: " + e.message); });
})(window.CT);
