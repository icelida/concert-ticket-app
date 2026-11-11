// ============================================================
// store.js — ที่เก็บข้อมูลร่วมของหน้าลูกค้า (book.html) และหลังบ้าน (admin.html)
// เว็บนี้เป็น static ไม่มี server จึงใช้ localStorage ของเบราว์เซอร์
// (ข้อมูลจะใช้ร่วมกันได้เฉพาะบนเบราว์เซอร์/โดเมนเดียวกัน — ดู README หากต้องการใช้งานจริงหลายเครื่อง)
// ============================================================
window.TF = (function () {
  const ZONES = [
    { zone: "VIP", price: 6500, rows: 5, cols: 12 },
    { zone: "A", price: 3800, rows: 8, cols: 14 },
    { zone: "B", price: 2500, rows: 10, cols: 16 },
    { zone: "C", price: 1500, rows: 12, cols: 20 },
  ];
  const SHOWS = [
    { id: "SAT", label: "เสาร์ 15 พ.ย. 19:00 · IMPACT Arena" },
    { id: "SUN", label: "อาทิตย์ 16 พ.ย. 18:00 · IMPACT Arena" },
  ];
  const MAX_PER_ID = 4;
  const KEYS = { orders: "tf_orders", events: "tf_events" };

  const load = (k) => { try { return JSON.parse(localStorage.getItem(KEYS[k])) || []; } catch (e) { return []; } };
  const save = (k, v) => localStorage.setItem(KEYS[k], JSON.stringify(v));
  const seatId = (zone, r, c) => `${zone}-${String.fromCharCode(65 + r)}${String(c + 1).padStart(2, "0")}`;
  const zoneOf = (seat) => seat.split("-")[0];
  const priceOf = (seat) => ZONES.find((z) => z.zone === zoneOf(seat)).price;
  const totalSeats = ZONES.reduce((s, z) => s + z.rows * z.cols, 0);
  const allSeats = () => ZONES.flatMap((z) => Array.from({ length: z.rows * z.cols }, (_, i) => seatId(z.zone, Math.floor(i / z.cols), i % z.cols)));

  function soldSet(show) {
    const s = new Set();
    load("orders").filter((o) => o.show === show).forEach((o) => o.seats.forEach((x) => s.add(x)));
    return s;
  }
  function ticketsOfId(show, idHash) {
    return load("orders").filter((o) => o.show === show && o.idHash === idHash).reduce((n, o) => n + o.seats.length, 0);
  }
  function logEvent(ev) {
    const list = load("events");
    list.push({ ts: Date.now(), ...ev });
    if (list.length > 5000) list.splice(0, list.length - 5000);
    save("events", list);
  }
  /** จองแบบ atomic: ตรวจที่นั่งว่าง + โควตาต่อบัตร แล้วค่อยเขียน (JS เป็น single-thread ต่อแท็บ) */
  function commitOrder({ show, seats, name, phone, idHash }) {
    const sold = soldSet(show);
    const taken = seats.filter((s) => sold.has(s));
    if (taken.length) return { ok: false, reason: "SEAT_TAKEN", taken };
    if (ticketsOfId(show, idHash) + seats.length > MAX_PER_ID) return { ok: false, reason: "LIMIT_EXCEEDED" };
    const orders = load("orders");
    const order = {
      id: "TF" + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 90 + 10),
      ts: Date.now(), show, seats, name, phone, idHash,
      amount: seats.reduce((s, x) => s + priceOf(x), 0),
    };
    orders.push(order);
    save("orders", orders);
    return { ok: true, order };
  }
  return { ZONES, SHOWS, MAX_PER_ID, KEYS, load, save, seatId, zoneOf, priceOf, totalSeats, allSeats, soldSet, ticketsOfId, logEvent, commitOrder };
})();
