// ============================================================
// admin.js — หลังบ้านเจ้าของงาน: ยอดขาย / funnel / ประสิทธิภาพระบบป้องกันบอท
// หมายเหตุ: รหัสผ่านฝั่ง client เป็นเพียงการกันคนเข้าผิดหน้า ไม่ใช่ความปลอดภัยจริง
// ============================================================
(function () {
  const PASSCODE = "admin1234"; // ← เปลี่ยนก่อนใช้งานจริง
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 0) => Number(n).toLocaleString("th-TH", { maximumFractionDigits: d });
  const REASONS = {
    webdriver: "Headless/WebDriver", untrusted_click: "คลิกจากสคริปต์ (isTrusted=false)", honeypot: "ติดกับดัก Honeypot",
    too_fast: "ทำรายการเร็วผิดมนุษย์", burst_clicks: "คลิกรัว", mouse_teleport: "เมาส์วาร์ป", robotic_mouse: "เมาส์เส้นตรง/ไม่เป็นธรรมชาติ",
  };
  const OUT = { success: ["จองสำเร็จ", "#16a34a"], blocked: ["บล็อกบอท", "#dc2626"], invalid_id: ["เลขบัตรผิด", "#d97706"], seat_taken: ["ที่นั่งถูกแย่ง", "#0284c7"], limit: ["เกินโควตา 4 ใบ", "#a855f7"] };
  const charts = {};
  const mk = (id, cfg) => { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($(id), cfg); };

  function unlock() { $("lock").style.display = "none"; $("app").style.display = "block"; sessionStorage.setItem("tf_admin", "1"); init(); }
  $("login").onclick = () => ($("pw").value === PASSCODE ? unlock() : ($("lock-msg").className = "msg bad", $("lock-msg").textContent = "รหัสผ่านไม่ถูกต้อง"));
  $("pw").addEventListener("keydown", (e) => e.key === "Enter" && $("login").click());
  $("btn-logout").onclick = () => { sessionStorage.removeItem("tf_admin"); location.reload(); };
  if (sessionStorage.getItem("tf_admin")) unlock();

  function init() {
    $("f-show").innerHTML = `<option value="ALL">ทุกรอบ</option>` + TF.SHOWS.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
    $("f-show").onchange = render;
    $("btn-refresh").onclick = render;
    $("btn-clear").onclick = () => { if (confirm("ลบข้อมูลคำสั่งซื้อและ log ทั้งหมดในเบราว์เซอร์นี้?")) { localStorage.removeItem(TF.KEYS.orders); localStorage.removeItem(TF.KEYS.events); render(); } };
    $("btn-seed").onclick = seed;
    $("btn-csv").onclick = csv;
    render();
    setInterval(render, 10000);
  }

  function seed() {
    const seats = TF.allSeats(), now = Date.now(), orders = TF.load("orders"), events = TF.load("events");
    const used = new Set(orders.map((o) => o.show + o.seats.join()));
    const pick = () => seats[Math.floor(Math.random() * seats.length)];
    for (let i = 0; i < 70; i++) {
      const show = Math.random() < 0.6 ? "SAT" : "SUN";
      const taken = TF.soldSet(show);
      const n = 1 + Math.floor(Math.random() * 3), ss = [];
      while (ss.length < n) { const s = pick(); if (!taken.has(s) && !ss.includes(s) && !used.has(show + s)) ss.push(s); }
      const ts = now - Math.random() * 6 * 3600e3;
      orders.push({ id: "DEMO" + i, ts, show, seats: ss, name: "ลูกค้าตัวอย่าง " + i, phone: "08" + Math.floor(1e7 + Math.random() * 9e7), idHash: "demo" + i, amount: ss.reduce((s, x) => s + TF.priceOf(x), 0), demo: true });
      events.push({ ts: ts - 20000, outcome: "success", show, seats: n, secs: 25 + Math.random() * 90 });
    }
    for (let i = 0; i < 260; i++) events.push({ ts: now - Math.random() * 6 * 3600e3, outcome: "visit" });
    const rs = Object.keys(REASONS);
    for (let i = 0; i < 45; i++) {
      const r = [rs[Math.floor(Math.random() * rs.length)]]; if (Math.random() < 0.4) r.push(rs[Math.floor(Math.random() * rs.length)]);
      events.push({ ts: now - Math.random() * 6 * 3600e3, outcome: "blocked", reasons: [...new Set(r)], show: "SAT", seats: 4, secs: +(Math.random() * 5).toFixed(1), clicksPerMin: Math.round(100 + Math.random() * 250) });
    }
    for (let i = 0; i < 14; i++) events.push({ ts: now - Math.random() * 6 * 3600e3, outcome: "invalid_id" });
    for (let i = 0; i < 9; i++) events.push({ ts: now - Math.random() * 6 * 3600e3, outcome: "seat_taken" });
    for (let i = 0; i < 5; i++) events.push({ ts: now - Math.random() * 6 * 3600e3, outcome: "limit" });
    TF.save("orders", orders); TF.save("events", events.sort((a, b) => a.ts - b.ts)); render();
  }

  function csv() {
    const rows = [["order_id", "time", "show", "seats", "amount", "name", "phone"], ...TF.load("orders").map((o) => [o.id, new Date(o.ts).toISOString(), o.show, o.seats.join(" "), o.amount, o.name, o.phone])];
    const blob = new Blob(["\ufeff" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "orders.csv"; a.click();
  }

  function render() {
    const show = $("f-show").value, inShow = (x) => show === "ALL" || x.show === show || (!x.show && x.outcome === "visit");
    const orders = TF.load("orders").filter(inShow), events = TF.load("events").filter(inShow);
    const seatsSold = orders.reduce((n, o) => n + o.seats.length, 0);
    const revenue = orders.reduce((s, o) => s + o.amount, 0);
    const cap = TF.totalSeats * (show === "ALL" ? TF.SHOWS.length : 1);
    const cnt = (o) => events.filter((e) => e.outcome === o).length;
    const visits = cnt("visit"), success = cnt("success"), blocked = cnt("blocked");
    const attempts = events.filter((e) => e.outcome !== "visit").length;
    const humanAttempts = attempts - blocked;
    const times = events.filter((e) => e.outcome === "success" && e.secs).map((e) => e.secs);
    const avgSecs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    $("kpis").innerHTML = [
      ["รายได้รวม", fmt(revenue) + " ฿"], ["ตั๋วที่ขายแล้ว", `${fmt(seatsSold)} / ${fmt(cap)}`], ["Sell-through", fmt((seatsSold / cap) * 100, 1) + "%"],
      ["คำสั่งซื้อ", fmt(orders.length)], ["ราคาเฉลี่ย/ออเดอร์", orders.length ? fmt(revenue / orders.length) + " ฿" : "-"],
      ["Visit → จองสำเร็จ", visits ? fmt((success / visits) * 100, 1) + "%" : "-"], ["ความพยายามจอง", fmt(attempts)],
      ["บอทที่ถูกบล็อก", `${fmt(blocked)} (${attempts ? fmt((blocked / attempts) * 100, 1) : 0}%)`],
      ["สำเร็จ / ความพยายามของคน", humanAttempts ? fmt((success / humanAttempts) * 100, 1) + "%" : "-"], ["เวลาจองเฉลี่ย", avgSecs ? fmt(avgSecs) + " วินาที" : "-"],
    ].map(([l, v]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

    // เวลา
    const sorted = orders.slice().sort((a, b) => a.ts - b.ts); let acc = 0;
    mk("c-time", { type: "line", data: { datasets: [{ label: "รายได้สะสม", data: sorted.map((o) => ({ x: o.ts, y: (acc += o.amount) })), borderColor: "#6d28d9", backgroundColor: "#6d28d933", fill: true, pointRadius: 0, stepped: true }] },
      options: { parsing: false, scales: { x: { type: "linear", ticks: { callback: (v) => new Date(v).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }), maxTicksLimit: 6 } } }, plugins: { legend: { display: false } } } });
    // โซน
    mk("c-zone", { type: "bar", data: { labels: TF.ZONES.map((z) => "โซน " + z.zone), datasets: [{ data: TF.ZONES.map((z) => orders.reduce((s, o) => s + o.seats.filter((x) => TF.zoneOf(x) === z.zone).length * z.price, 0)), backgroundColor: ["#d97706", "#6d28d9", "#0284c7", "#16a34a"] }] }, options: { plugins: { legend: { display: false } } } });
    // outcome
    const ok = Object.keys(OUT);
    mk("c-out", { type: "doughnut", data: { labels: ok.map((k) => OUT[k][0]), datasets: [{ data: ok.map(cnt), backgroundColor: ok.map((k) => OUT[k][1]) }] }, options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } } } } });
    // reasons
    const rc = {}; events.filter((e) => e.outcome === "blocked").forEach((e) => (e.reasons || []).forEach((r) => (rc[r] = (rc[r] || 0) + 1)));
    const rk = Object.keys(rc).sort((a, b) => rc[b] - rc[a]);
    mk("c-reason", { type: "bar", data: { labels: rk.map((k) => REASONS[k] || k), datasets: [{ data: rk.map((k) => rc[k]), backgroundColor: "#dc2626" }] }, options: { indexAxis: "y", plugins: { legend: { display: false } } } });
    // funnel + fill
    const bar = (l, v, max, c) => `<div style="margin:8px 0"><div class="row between small"><span>${l}</span><b>${fmt(v)}</b></div><div class="bar"><i style="width:${max ? (v / max) * 100 : 0}%;${c ? "background:" + c : ""}"></i></div></div>`;
    $("funnel").innerHTML = bar("เข้าชมหน้าจอง", visits, visits) + bar("พยายามกดจอง", attempts, visits) + bar("ผ่านระบบป้องกัน", attempts - blocked, visits) + bar("จองสำเร็จ", success, visits, "linear-gradient(90deg,#16a34a,#22c55e)");
    $("fill").innerHTML = TF.ZONES.map((z) => {
      const tot = z.rows * z.cols * (show === "ALL" ? TF.SHOWS.length : 1);
      const s = orders.reduce((n, o) => n + o.seats.filter((x) => TF.zoneOf(x) === z.zone).length, 0);
      return bar(`โซน ${z.zone} (${fmt(s)}/${fmt(tot)})`, s, tot);
    }).join("");
    // ตาราง
    const mask = (s) => s.length > 3 ? s.slice(0, 2) + "•••" + s.slice(-1) : s;
    const t = (ts) => new Date(ts).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
    $("t-orders").innerHTML = `<thead><tr><th>รหัส</th><th>เวลา</th><th>ผู้จอง</th><th>ที่นั่ง</th><th class="num">ยอด</th></tr></thead><tbody>` +
      orders.slice(-12).reverse().map((o) => `<tr><td class="mono">${o.id}</td><td>${t(o.ts)}</td><td>${mask(o.name)}</td><td>${o.seats.join(", ")}</td><td class="num">${fmt(o.amount)}</td></tr>`).join("") + `</tbody>`;
    const bl = events.filter((e) => ["blocked", "invalid_id", "limit", "seat_taken"].includes(e.outcome)).slice(-12).reverse();
    $("t-blocked").innerHTML = `<thead><tr><th>เวลา</th><th>ผล</th><th>เหตุผล/ค่าที่วัดได้</th></tr></thead><tbody>` +
      bl.map((e) => `<tr><td>${t(e.ts)}</td><td><span class="tag ${e.outcome === "blocked" ? "bad" : "warn"}">${OUT[e.outcome][0]}</span></td><td class="small">${(e.reasons || []).map((r) => REASONS[r] || r).join(", ") || "-"}${e.clicksPerMin ? ` · ${e.clicksPerMin} คลิก/นาที` : ""}${e.secs != null ? ` · ${e.secs}s` : ""}</td></tr>`).join("") + `</tbody>`;
  }
})();
