// ============================================================
// db.js — Database Management (SQLite ในเบราว์เซอร์ผ่าน sql.js / WebAssembly)
//   - Schema + constraints + trigger จำกัดจำนวนตั๋วต่อบัตร
//   - Transaction ล็อกที่นั่ง (กันจองซ้ำ)
//   - สาธิต race condition: แบบไม่ป้องกัน vs แบบป้องกัน
// ============================================================
window.CT = window.CT || {};
(function (CT) {
  const SQLJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";
  const MAX_TICKETS_PER_ID = 4;

  const ZONES = [
    { zone: "VIP", price: 6500, rows: 5, cols: 12 },
    { zone: "A", price: 3800, rows: 8, cols: 14 },
    { zone: "B", price: 2500, rows: 10, cols: 16 },
    { zone: "C", price: 1500, rows: 12, cols: 20 },
  ];

  const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE users (
    user_id     INTEGER PRIMARY KEY,
    id_hash     TEXT    NOT NULL UNIQUE,          -- เก็บเลขบัตรแบบ hash เท่านั้น
    phone       TEXT,
    age         INTEGER,
    is_bot      INTEGER NOT NULL DEFAULT 0,       -- ground truth จริงทั้งหมด (รวม zeroday)
    known_label INTEGER NOT NULL DEFAULT 0,       -- label ที่มีตอนฝึก Supervised (zeroday = 0 เพราะไม่มี label)
    bot_type    TEXT,                             -- obvious / stealth / zeroday / NULL
    persona     TEXT                              -- ground truth ของกลุ่ม (ใช้ประเมินเท่านั้น)
  );

  CREATE TABLE user_features (
    user_id           INTEGER PRIMARY KEY REFERENCES users(user_id),
    clicks_per_min    REAL, req_per_sec REAL, accounts_per_ip INTEGER,
    checkout_time_s   REAL, mouse_entropy REAL, account_age_days INTEGER, captcha_fail INTEGER,
    concerts_per_year REAL, avg_ticket_price REAL, lead_time_days REAL,
    group_size        REAL, vip_ratio REAL
  );

  CREATE TABLE zones (
    zone  TEXT PRIMARY KEY,
    price INTEGER NOT NULL CHECK (price > 0)
  );

  CREATE TABLE seats (
    seat_id  TEXT PRIMARY KEY,                    -- เช่น VIP-A01
    zone     TEXT NOT NULL REFERENCES zones(zone),
    row_no   INTEGER, col_no INTEGER,
    status   TEXT NOT NULL DEFAULT 'AVAILABLE'
             CHECK (status IN ('AVAILABLE','HELD','SOLD')),
    held_by  INTEGER REFERENCES users(user_id)
  );

  CREATE TABLE orders (
    order_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(user_id),
    seat_id    TEXT    NOT NULL UNIQUE REFERENCES seats(seat_id),  -- 1 ที่นั่งขายได้ครั้งเดียว
    price      INTEGER NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID','CANCELLED')),
    sim_tick   INTEGER                                              -- เวลาจำลอง (วินาทีหลังเปิดขาย)
  );

  -- จำกัดจำนวนตั๋วต่อบัตรประชาชน (บังคับที่ระดับฐานข้อมูล ไม่ใช่แค่หน้าเว็บ)
  CREATE TRIGGER trg_limit_per_id
  BEFORE INSERT ON orders
  WHEN (SELECT COUNT(*) FROM orders WHERE user_id = NEW.user_id AND status = 'PAID') >= ${MAX_TICKETS_PER_ID}
  BEGIN
    SELECT RAISE(ABORT, 'LIMIT_EXCEEDED');
  END;

  CREATE TABLE predictions (                      -- ผลจาก Supervised + Unsupervised Anomaly
    user_id    INTEGER PRIMARY KEY REFERENCES users(user_id),
    bot_prob   REAL,
    decision   TEXT,                              -- ผลตัดสินของ Supervised (ALLOW / BLOCK)
    anom_score REAL,                              -- คะแนนความผิดปกติจาก Unsupervised (ไม่ใช้ label)
    anom_flag  INTEGER,                           -- 1 = ติดธง Anomaly, 0 = ปกติ
    model      TEXT
  );

  CREATE TABLE segments (                         -- ผลจาก Unsupervised learning
    user_id      INTEGER PRIMARY KEY REFERENCES users(user_id),
    cluster      INTEGER, segment_name TEXT, pc1 REAL, pc2 REAL
  );

  CREATE INDEX idx_orders_user ON orders(user_id);
  CREATE INDEX idx_seats_status ON seats(zone, status);
  `;

  let SQL = null;

  async function loadSqlJs() {
    if (SQL) return SQL;
    SQL = await initSqlJs({ locateFile: (f) => SQLJS_CDN + f });
    return SQL;
  }

  function rowLabel(i) { return String.fromCharCode(65 + i); }

  class TicketDB {
    constructor(SQLlib) {
      this.db = new SQLlib.Database();
      this.db.exec(SCHEMA);
    }

    // ---------- helpers ----------
    query(sql, params = []) {
      const stmt = this.db.prepare(sql);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    }
    scalar(sql, params = []) {
      const r = this.query(sql, params)[0];
      return r ? Object.values(r)[0] : null;
    }
    exec(sql) { return this.db.exec(sql); }
    run(sql, params = []) { this.db.run(sql, params); return this.db.getRowsModified(); }

    // ---------- seed ----------
    seed(users) {
      this.db.exec("BEGIN");
      const zs = this.db.prepare("INSERT INTO zones VALUES (?,?)");
      const ss = this.db.prepare("INSERT INTO seats(seat_id,zone,row_no,col_no) VALUES (?,?,?,?)");
      for (const z of ZONES) {
        zs.run([z.zone, z.price]);
        for (let r = 0; r < z.rows; r++)
          for (let c = 0; c < z.cols; c++)
            ss.run([`${z.zone}-${rowLabel(r)}${String(c + 1).padStart(2, "0")}`, z.zone, r, c]);
      }
      zs.free(); ss.free();

      const us = this.db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?,?)");
      const fs = this.db.prepare("INSERT INTO user_features VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
      for (const u of users) {
        us.run([u.user_id, u.id_hash, u.phone, u.age, u.is_bot, u.known_label, u.bot_type, u.persona]);
        fs.run([u.user_id, u.clicks_per_min, u.req_per_sec, u.accounts_per_ip, u.checkout_time_s,
          u.mouse_entropy, u.account_age_days, u.captcha_fail, u.concerts_per_year,
          u.avg_ticket_price, u.lead_time_days, u.group_size, u.vip_ratio]);
      }
      us.free(); fs.free();
      this.db.exec("COMMIT");
    }

    resetSales() {
      this.db.exec("DELETE FROM orders; UPDATE seats SET status='AVAILABLE', held_by=NULL; DELETE FROM sqlite_sequence WHERE name='orders';");
    }

    // ---------- core: จองที่นั่งแบบ atomic ----------
    /**
     * จองที่นั่งใน transaction เดียว
     * @returns {{ok:boolean, reason?:string}}
     */
    bookSeat(userId, seatId, tick = 0) {
      try {
        this.db.exec("BEGIN IMMEDIATE");
        // 1) ล็อกที่นั่ง — สำเร็จเฉพาะเมื่อยังว่างอยู่ (compare-and-set)
        this.db.run("UPDATE seats SET status='HELD', held_by=? WHERE seat_id=? AND status='AVAILABLE'", [userId, seatId]);
        if (this.db.getRowsModified() !== 1) {
          this.db.exec("ROLLBACK");
          return { ok: false, reason: "SEAT_TAKEN" };
        }
        // 2) สร้าง order (trigger จะตรวจจำนวนตั๋วต่อบัตร)
        const price = this.scalar("SELECT z.price FROM seats s JOIN zones z USING(zone) WHERE s.seat_id=?", [seatId]);
        this.db.run("INSERT INTO orders(user_id,seat_id,price,sim_tick) VALUES (?,?,?,?)", [userId, seatId, price, tick]);
        // 3) ยืนยันการขาย
        this.db.run("UPDATE seats SET status='SOLD' WHERE seat_id=?", [seatId]);
        this.db.exec("COMMIT");
        return { ok: true };
      } catch (e) {
        try { this.db.exec("ROLLBACK"); } catch (_) {}
        const msg = String(e.message || e);
        return { ok: false, reason: msg.includes("LIMIT_EXCEEDED") ? "LIMIT_EXCEEDED" : msg };
      }
    }

    availableSeats(zone, limit = 4) {
      return this.query(
        "SELECT seat_id FROM seats WHERE zone=? AND status='AVAILABLE' ORDER BY row_no, col_no LIMIT ?",
        [zone, limit]
      ).map((r) => r.seat_id);
    }

    // ---------- สาธิต race condition ----------
    /** แบบไม่ป้องกัน: อ่านก่อน (SELECT) แล้วค่อยเขียน → ทั้งสองคนเห็นว่า "ว่าง" */
    raceNaive(seatId, userA, userB) {
      this.db.exec(`
        DROP TABLE IF EXISTS demo_seats; DROP TABLE IF EXISTS demo_orders;
        CREATE TEMP TABLE demo_seats(seat_id TEXT PRIMARY KEY, status TEXT);
        CREATE TEMP TABLE demo_orders(order_id INTEGER PRIMARY KEY, user_id INT, seat_id TEXT);
      `);
      this.db.run("INSERT INTO demo_seats VALUES (?, 'AVAILABLE')", [seatId]);
      const log = [];
      const sA = this.scalar("SELECT status FROM demo_seats WHERE seat_id=?", [seatId]);
      log.push(`t=1  ผู้ใช้ ${userA}: SELECT status → ${sA}`);
      const sB = this.scalar("SELECT status FROM demo_seats WHERE seat_id=?", [seatId]);
      log.push(`t=2  ผู้ใช้ ${userB}: SELECT status → ${sB}`);
      if (sA === "AVAILABLE") {
        this.db.run("UPDATE demo_seats SET status='SOLD' WHERE seat_id=?", [seatId]);
        this.db.run("INSERT INTO demo_orders(user_id,seat_id) VALUES (?,?)", [userA, seatId]);
        log.push(`t=3  ผู้ใช้ ${userA}: UPDATE + INSERT order ✔`);
      }
      if (sB === "AVAILABLE") {
        this.db.run("UPDATE demo_seats SET status='SOLD' WHERE seat_id=?", [seatId]);
        this.db.run("INSERT INTO demo_orders(user_id,seat_id) VALUES (?,?)", [userB, seatId]);
        log.push(`t=4  ผู้ใช้ ${userB}: UPDATE + INSERT order ✔`);
      }
      const n = this.scalar("SELECT COUNT(*) FROM demo_orders WHERE seat_id=?", [seatId]);
      log.push(`ผลลัพธ์: ที่นั่ง ${seatId} ถูกขาย ${n} ครั้ง ${n > 1 ? "❌ จองซ้ำ!" : ""}`);
      return log;
    }

    /** แบบป้องกัน: UPDATE ... WHERE status='AVAILABLE' (atomic) + UNIQUE(seat_id) */
    raceSafe(seatId, userA, userB) {
      this.db.exec(`
        DROP TABLE IF EXISTS demo_seats; DROP TABLE IF EXISTS demo_orders;
        CREATE TEMP TABLE demo_seats(seat_id TEXT PRIMARY KEY, status TEXT);
        CREATE TEMP TABLE demo_orders(order_id INTEGER PRIMARY KEY, user_id INT, seat_id TEXT UNIQUE);
      `);
      this.db.run("INSERT INTO demo_seats VALUES (?, 'AVAILABLE')", [seatId]);
      const log = [];
      for (const [t, u] of [[1, userA], [2, userB]]) {
        this.db.exec("BEGIN IMMEDIATE");
        this.db.run("UPDATE demo_seats SET status='SOLD' WHERE seat_id=? AND status='AVAILABLE'", [seatId]);
        const changed = this.db.getRowsModified();
        if (changed === 1) {
          this.db.run("INSERT INTO demo_orders(user_id,seat_id) VALUES (?,?)", [u, seatId]);
          this.db.exec("COMMIT");
          log.push(`t=${t}  ผู้ใช้ ${u}: UPDATE ... WHERE status='AVAILABLE' → แก้ไข 1 แถว ✔ ได้ที่นั่ง`);
        } else {
          this.db.exec("ROLLBACK");
          log.push(`t=${t}  ผู้ใช้ ${u}: UPDATE ... WHERE status='AVAILABLE' → แก้ไข 0 แถว ✖ ที่นั่งถูกจองแล้ว`);
        }
      }
      const n = this.scalar("SELECT COUNT(*) FROM demo_orders WHERE seat_id=?", [seatId]);
      log.push(`ผลลัพธ์: ที่นั่ง ${seatId} ถูกขาย ${n} ครั้ง ✔ ไม่มีการจองซ้ำ`);
      return log;
    }

    // ---------- เขียนผล ML กลับลงฐานข้อมูล ----------
    savePredictions(rows, model) {
      this.db.exec("BEGIN; DELETE FROM predictions;");
      const st = this.db.prepare("INSERT INTO predictions VALUES (?,?,?,?,?,?)");
      for (const r of rows) {
        st.run([
          r.user_id,
          +r.prob.toFixed(4),
          r.decision,
          r.anom_score != null ? +r.anom_score.toFixed(4) : 0,
          r.anom_flag ? 1 : 0,
          model,
        ]);
      }
      st.free();
      this.db.exec("COMMIT");
    }
    saveSegments(rows) {
      this.db.exec("BEGIN; DELETE FROM segments;");
      const st = this.db.prepare("INSERT INTO segments VALUES (?,?,?,?,?)");
      for (const r of rows) st.run([r.user_id, r.cluster, r.segment_name, +r.pc1.toFixed(4), +r.pc2.toFixed(4)]);
      st.free();
      this.db.exec("COMMIT");
    }

    exportFile() { return this.db.export(); }
  }

  CT.db = { loadSqlJs, TicketDB, ZONES, MAX_TICKETS_PER_ID, SCHEMA };
})(window.CT);
