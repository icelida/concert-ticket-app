// ============================================================
// book.js — หน้าจองสำหรับลูกค้า (ไม่แสดงรายละเอียดระบบป้องกันบอท/หลังบ้านใดๆ)
// แอบเก็บ telemetry เบาๆ เพื่อให้เจ้าของดูใน admin.html
// ============================================================
(function () {
  const { ZONES, SHOWS, MAX_PER_ID } = TF;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("th-TH");
  const st = { show: SHOWS[0].id, sel: [], t0: performance.now(), pts: [], clicks: [], untrusted: 0, teleports: 0, hpSeat: false };

  // ---------- telemetry ----------
  document.addEventListener("mousemove", (e) => {
    const now = performance.now(), p = st.pts[st.pts.length - 1];
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 360 && now - p.t < 18) st.teleports++;
    st.pts.push({ x: e.clientX, y: e.clientY, t: now });
    if (st.pts.length > 80) st.pts.shift();
  });
  document.addEventListener("click", (e) => {
    if (!e.isTrusted) st.untrusted++;
    st.clicks.push(performance.now());
    if (st.clicks.length > 60) st.clicks.shift();
  }, true);

  function features() {
    const secs = Math.max(1, (performance.now() - st.t0) / 1000);
    const recent = st.clicks.filter((t) => performance.now() - t < 60000).length;
    let entropy = null;
    if (st.pts.length >= 8) {
      const a = [];
      for (let i = 2; i < st.pts.length; i++) {
        const a1 = Math.atan2(st.pts[i - 1].y - st.pts[i - 2].y, st.pts[i - 1].x - st.pts[i - 2].x);
        const a2 = Math.atan2(st.pts[i].y - st.pts[i - 1].y, st.pts[i].x - st.pts[i - 1].x);
        let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d; a.push(d);
      }
      const m = a.reduce((s, v) => s + v, 0) / a.length;
      const sd = Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
      entropy = +Math.min(0.95, 0.45 + sd * 0.65).toFixed(2);
    }
    return { secs: +secs.toFixed(1), clicksPerMin: Math.round((recent / Math.min(60, secs)) * 60), entropy, teleports: st.teleports };
  }

  /** ตรวจแบบ heuristic ฝั่ง client — ผลลัพธ์ละเอียดเห็นเฉพาะใน admin */
  function assess() {
    const f = features(), reasons = [];
    if (navigator.webdriver) reasons.push("webdriver");
    if (st.untrusted > 0) reasons.push("untrusted_click");
    if ($("hp").value || st.hpSeat) reasons.push("honeypot");
    if (f.secs < 6) reasons.push("too_fast");
    if (f.clicksPerMin > 120) reasons.push("burst_clicks");
    if (f.teleports > 2) reasons.push("mouse_teleport");
    if (f.entropy !== null && f.entropy < 0.15) reasons.push("robotic_mouse");
    const hard = ["webdriver", "untrusted_click", "honeypot"].some((r) => reasons.includes(r));
    return { f, reasons, block: hard || reasons.length >= 2 };
  }

  // ---------- UI ----------
  function render() {
    const sold = TF.soldSet(st.show);
    st.sel = st.sel.filter((s) => !sold.has(s));
    let html = `<div class="stage">STAGE</div>`;
    for (const z of ZONES) {
      let seats = "", left = 0;
      for (let r = 0; r < z.rows; r++) for (let c = 0; c < z.cols; c++) {
        const id = TF.seatId(z.zone, r, c), isSold = sold.has(id), isSel = st.sel.includes(id);
        if (!isSold) left++;
        seats += `<i class="seat ${isSold ? "SOLD" : "AVAILABLE"} ${isSel ? "SELECTED" : ""}" data-seat="${id}" title="${id} · ${fmt(z.price)}฿"></i>`;
      }
      html += `<div class="zone zone-${z.zone}"><div class="zone-label">โซน ${z.zone} · ${fmt(z.price)} บาท · เหลือ ${left}/${z.rows * z.cols}</div><div class="zone-grid" style="grid-template-columns:repeat(${z.cols},16px)">${seats}</div></div>`;
    }
    // ที่นั่งล่อบอท (คนมองไม่เห็น)
    html += `<button class="seat HONEYPOT" data-seat="Z99" tabindex="-1" aria-hidden="true"></button>`;
    $("map").innerHTML = html;
    $("lines").innerHTML = st.sel.length
      ? st.sel.map((s) => `<div class="line"><span>ที่นั่ง ${s}</span><span>${fmt(TF.priceOf(s))} ฿</span></div>`).join("")
      : `<p class="muted small">ยังไม่ได้เลือกที่นั่ง</p>`;
    $("total").textContent = fmt(st.sel.reduce((s, x) => s + TF.priceOf(x), 0)) + " ฿";
  }
  const say = (t, cls) => { $("msg").className = "msg " + cls; $("msg").textContent = t; };

  $("show").innerHTML = SHOWS.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
  $("show").onchange = (e) => { st.show = e.target.value; st.sel = []; render(); };
  $("map").addEventListener("click", (e) => {
    const id = e.target.dataset && e.target.dataset.seat;
    if (!id) return;
    if (id === "Z99") { st.hpSeat = true; return; }
    if (e.target.classList.contains("SOLD")) return;
    const i = st.sel.indexOf(id);
    if (i >= 0) st.sel.splice(i, 1);
    else if (st.sel.length < MAX_PER_ID) st.sel.push(id);
    else return say(`เลือกได้สูงสุด ${MAX_PER_ID} ที่นั่ง`, "warn");
    say("", "");
    render();
  });

  $("go").onclick = () => {
    const name = $("name").value.trim(), phone = $("phone").value.replace(/\D/g, ""), tid = $("tid").value.replace(/\D/g, "");
    const base = { show: st.show, seats: st.sel.length };
    if (!st.sel.length) return say("กรุณาเลือกที่นั่งอย่างน้อย 1 ที่", "warn");
    if (name.length < 2) return say("กรุณากรอกชื่อ-นามสกุล", "warn");
    if (!/^0\d{8,9}$/.test(phone)) return say("เบอร์โทรศัพท์ไม่ถูกต้อง", "warn");
    const v = CT.data.validateThaiId(tid);
    if (!v.ok) { TF.logEvent({ ...base, outcome: "invalid_id" }); return say("เลขบัตรประชาชนไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง", "bad"); }

    const a = assess();
    if (a.block) {
      TF.logEvent({ ...base, outcome: "blocked", reasons: a.reasons, ...a.f });
      return say("ขออภัย ไม่สามารถดำเนินการได้ในขณะนี้ กรุณาลองใหม่อีกครั้งหรือติดต่อเจ้าหน้าที่", "bad");
    }
    const r = TF.commitOrder({ show: st.show, seats: st.sel, name, phone, idHash: CT.data.hashId(tid) });
    if (!r.ok) {
      TF.logEvent({ ...base, outcome: r.reason === "SEAT_TAKEN" ? "seat_taken" : "limit", ...a.f });
      render();
      return say(r.reason === "SEAT_TAKEN" ? "ขออภัย มีผู้จองที่นั่งบางที่ไปก่อนแล้ว กรุณาเลือกใหม่" : `บัตรประชาชนนี้จองครบ ${MAX_PER_ID} ใบแล้วสำหรับรอบนี้`, "bad");
    }
    TF.logEvent({ ...base, outcome: "success", amount: r.order.amount, ...a.f });
    $("booking").style.display = "none";
    $("done").style.display = "block";
    $("done").innerHTML = `<div class="ticket"><div style="font-size:2rem">🎉</div><h2>จองสำเร็จ!</h2>
      <div class="code">${r.order.id}</div>
      <p>${SHOWS.find((s) => s.id === r.order.show).label}</p>
      <p><b>ที่นั่ง:</b> ${r.order.seats.join(", ")}<br><b>ยอดรวม:</b> ${fmt(r.order.amount)} บาท</p>
      <p class="muted small">แสดงรหัสนี้ที่หน้างาน (ระบบจำลอง ไม่มีการชำระเงินจริง)</p>
      <button class="btn" onclick="location.reload()">จองเพิ่ม</button></div>`;
  };

  TF.logEvent({ outcome: "visit" });
  render();
})();
