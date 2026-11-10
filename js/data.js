// ============================================================
// data.js — สร้างข้อมูลจำลอง (synthetic data)
//   - เลขบัตรประชาชนไทย 13 หลัก (ผ่าน checksum) + hash
//   - พฤติกรรมการใช้งาน (สำหรับ Supervised: คน vs บอท)
//   - ประวัติการซื้อ (สำหรับ Unsupervised: แบ่งกลุ่มลูกค้า)
// ============================================================
window.CT = window.CT || {};
(function (CT) {
  // ---------- Thai national ID ----------
  function thaiIdCheckDigit(first12) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (13 - i);
    return (11 - (sum % 11)) % 10;
  }

  function validateThaiId(id) {
    const s = String(id).replace(/[\s-]/g, "");
    if (!/^\d{13}$/.test(s)) return { ok: false, reason: "ต้องเป็นตัวเลข 13 หลัก" };
    const cd = thaiIdCheckDigit(s.slice(0, 12));
    if (cd !== Number(s[12]))
      return { ok: false, reason: `หลักตรวจไม่ตรง (ควรเป็น ${cd} แต่ได้ ${s[12]})`, expected: cd };
    return { ok: true, reason: "ถูกต้องตาม checksum" };
  }

  function randomThaiId(rng) {
    let s = String(rng.int(1, 8));
    for (let i = 0; i < 11; i++) s += rng.int(0, 9);
    return s + thaiIdCheckDigit(s);
  }

  // cyrb53 — hash แบบ synchronous (ในระบบจริงควรใช้ SHA-256 + salt / HMAC)
  function hashId(str, seed = 20261111) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
  }

  // ---------- Personas (ความจริงที่ซ่อนอยู่ — ใช้ตรวจผล clustering เท่านั้น) ----------
  const PERSONAS = [
    { key: "superfan", name: "แฟนตัวยง", w: 0.2, age: [24, 4], cpy: [8, 2], price: [4500, 900], lead: [45, 10], group: [1.8, 0.5], vip: [0.55, 0.12] },
    { key: "student", name: "นักศึกษา/สายประหยัด", w: 0.28, age: [21, 2], cpy: [3, 1], price: [1400, 300], lead: [25, 8], group: [3, 0.8], vip: [0.04, 0.03] },
    { key: "family", name: "ครอบครัว/กลุ่ม", w: 0.17, age: [40, 6], cpy: [1.5, 0.6], price: [2600, 500], lead: [35, 10], group: [4, 0.4], vip: [0.15, 0.08] },
    { key: "casual", name: "ผู้ชมทั่วไป", w: 0.23, age: [30, 6], cpy: [1.5, 0.7], price: [2200, 500], lead: [7, 4], group: [2, 0.5], vip: [0.1, 0.06] },
    { key: "premium", name: "พรีเมียม/VIP", w: 0.12, age: [42, 7], cpy: [4, 1.2], price: [9000, 1800], lead: [30, 10], group: [2, 0.4], vip: [0.9, 0.06] },
  ];

  const BEHAVIOR_FEATURES = [
    { key: "clicks_per_min", label: "คลิก/นาที" },
    { key: "req_per_sec", label: "request/วินาที" },
    { key: "accounts_per_ip", label: "บัญชีต่อ IP" },
    { key: "checkout_time_s", label: "เวลาจ่ายเงิน (วินาที)" },
    { key: "mouse_entropy", label: "ความสุ่มของเมาส์ (0-1)" },
    { key: "account_age_days", label: "อายุบัญชี (วัน)" },
    { key: "captcha_fail", label: "CAPTCHA ล้มเหลว (ครั้ง)" },
  ];

  const SEGMENT_FEATURES = [
    { key: "age", label: "อายุ" },
    { key: "concerts_per_year", label: "คอนเสิร์ต/ปี" },
    { key: "avg_ticket_price", label: "ราคาตั๋วเฉลี่ย (บาท)" },
    { key: "lead_time_days", label: "ซื้อล่วงหน้า (วัน)" },
    { key: "group_size", label: "จำนวนตั๋ว/ครั้ง" },
    { key: "vip_ratio", label: "สัดส่วนซื้อโซน VIP" },
  ];

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function pickPersona(rng) {
    let u = rng.random(), acc = 0;
    for (const p of PERSONAS) { acc += p.w; if (u <= acc) return p; }
    return PERSONAS[PERSONAS.length - 1];
  }

  function humanBehavior(rng) {
    // คนบางส่วน "รีบกด" (rusher) → ค่าใกล้บอท ทำให้โจทย์ไม่ง่ายเกินไป
    const rusher = rng.random() < 0.25;
    return {
      clicks_per_min: clamp(rng.lognormal(rusher ? 40 : 15, 0.5), 2, 400),
      req_per_sec: clamp(rng.lognormal(rusher ? 2.2 : 0.7, 0.55), 0.05, 60),
      accounts_per_ip: rng.random() < 0.82 ? 1 : rng.int(2, 3),
      checkout_time_s: clamp(rng.lognormal(rusher ? 35 : 75, 0.45), 4, 900),
      mouse_entropy: clamp(rng.normal(0.7, 0.13), 0, 1),
      account_age_days: Math.round(clamp(rng.lognormal(450, 1.2), 1, 4000)),
      captcha_fail: rng.random() < 0.75 ? 0 : rng.int(1, 2),
    };
  }

  function botBehavior(rng) {
    // บอท 3 แบบ:
    // 1) obvious (50%): บอทกดรัวโจ่งแจ้ง (มี label ในชุดฝึก Supervised)
    // 2) stealth (20%): บอทเนียนเลียนแบบคนรีบกด (มี label ในชุดฝึก Supervised)
    // 3) zeroday (30%): บอทสายพันธุ์ใหม่ (Zero-Day Anomaly — ไม่มี label ในชุดฝึก!)
    //    ตั้งใจกดช้าและรอเวลาจ่ายเงินนานเหมือนคนปกติเพื่อหลอก Supervised
    //    แต่ใช้ IP ซ้ำจำนวนมาก (botnet farm), เมาส์ลากเส้นตรง (entropy ต่ำมาก) และติด CAPTCHA บ่อย
    const u = rng.random();
    if (u < 0.30) {
      return {
        clicks_per_min: clamp(rng.lognormal(10, 0.25), 4, 22),
        req_per_sec: clamp(rng.lognormal(0.42, 0.25), 0.1, 1.1),
        accounts_per_ip: rng.int(6, 14),
        checkout_time_s: clamp(rng.lognormal(95, 0.2), 60, 180),
        mouse_entropy: clamp(rng.normal(0.07, 0.03), 0.01, 0.18),
        account_age_days: Math.round(clamp(rng.lognormal(650, 0.4), 200, 2500)),
        captcha_fail: rng.int(3, 7),
        _botType: "zeroday",
      };
    }
    if (u < 0.50) {
      return {
        clicks_per_min: clamp(rng.lognormal(42, 0.45), 10, 400),
        req_per_sec: clamp(rng.lognormal(2.6, 0.5), 0.4, 60),
        accounts_per_ip: rng.random() < 0.5 ? 1 : rng.int(2, 4),
        checkout_time_s: clamp(rng.lognormal(24, 0.4), 3, 300),
        mouse_entropy: clamp(rng.normal(0.50, 0.12), 0, 1),
        account_age_days: Math.round(clamp(rng.lognormal(90, 1.0), 1, 3000)),
        captcha_fail: rng.random() < 0.5 ? 0 : rng.int(1, 3),
        _botType: "stealth",
      };
    }
    return {
      clicks_per_min: clamp(rng.lognormal(220, 0.4), 30, 1000),
      req_per_sec: clamp(rng.lognormal(18, 0.45), 3, 120),
      accounts_per_ip: rng.int(3, 12),
      checkout_time_s: clamp(rng.lognormal(6, 0.4), 1, 60),
      mouse_entropy: clamp(rng.normal(0.15, 0.08), 0, 1),
      account_age_days: Math.round(clamp(rng.lognormal(6, 0.9), 0, 300)),
      captcha_fail: rng.int(1, 6),
      _botType: "obvious",
    };
  }

  function sample(p, key, rng) {
    const [mu, sd] = p[key];
    return rng.normal(mu, sd);
  }

  function humanPurchase(p, rng) {
    return {
      age: Math.round(clamp(sample(p, "age", rng), 16, 75)),
      concerts_per_year: +clamp(sample(p, "cpy", rng), 0.3, 20).toFixed(1),
      avg_ticket_price: Math.round(clamp(sample(p, "price", rng), 800, 20000)),
      lead_time_days: Math.round(clamp(sample(p, "lead", rng), 0, 120)),
      group_size: +clamp(sample(p, "group", rng), 1, 4).toFixed(1),
      vip_ratio: +clamp(sample(p, "vip", rng), 0, 1).toFixed(2),
    };
  }

  function botPurchase(rng) {
    // บอทนักเก็งกำไร: ซื้อเต็มสิทธิ์ ซื้อทันทีที่เปิดขาย เน้นโซนแพง
    return {
      age: Math.round(clamp(rng.normal(30, 8), 18, 70)),
      concerts_per_year: +clamp(rng.normal(14, 3), 3, 30).toFixed(1),
      avg_ticket_price: Math.round(clamp(rng.normal(6500, 1500), 1500, 20000)),
      lead_time_days: Math.round(clamp(rng.normal(60, 6), 30, 120)),
      group_size: +clamp(rng.normal(3.9, 0.15), 3, 4).toFixed(1),
      vip_ratio: +clamp(rng.normal(0.7, 0.12), 0, 1).toFixed(2),
    };
  }

  /**
   * สร้างบัญชีผู้ใช้จำลอง
   * @returns {Array<Object>} user records
   */
  function generateUsers({ n = 800, botRatio = 0.2, seed = 42 } = {}) {
    const rng = new CT.Rng(seed);
    const users = [];
    const usedIds = new Set();
    for (let i = 0; i < n; i++) {
      const isBot = rng.random() < botRatio;
      let tid;
      do { tid = randomThaiId(rng); } while (usedIds.has(tid));
      usedIds.add(tid);
      const persona = isBot ? null : pickPersona(rng);
      const beh = isBot ? botBehavior(rng) : humanBehavior(rng);
      const pur = isBot ? botPurchase(rng) : humanPurchase(persona, rng);
      const botType = beh._botType || null;
      delete beh._botType;
      for (const k of ["clicks_per_min", "req_per_sec", "checkout_time_s", "mouse_entropy"]) beh[k] = +beh[k].toFixed(2);
      users.push({
        user_id: i + 1,
        thai_id: tid, // เก็บไว้ในหน่วยความจำเพื่อสาธิตเท่านั้น — ไม่บันทึกลงฐานข้อมูล
        id_hash: hashId(tid),
        phone: "08" + String(rng.int(10000000, 99999999)),
        is_bot: isBot ? 1 : 0,
        // known_label = label ที่มีในชุดฝึก Supervised (บอท zeroday ยังไม่ถูกติด label จึงมีค่าเป็น 0)
        known_label: isBot && botType !== "zeroday" ? 1 : 0,
        bot_type: botType,
        persona: isBot ? "bot" : persona.key,
        persona_name: isBot ? "บอท" : persona.name,
        ...beh,
        ...pur,
      });
    }
    return users;
  }

  CT.data = {
    thaiIdCheckDigit, validateThaiId, randomThaiId, hashId,
    PERSONAS, BEHAVIOR_FEATURES, SEGMENT_FEATURES, generateUsers,
  };
})(window.CT);
