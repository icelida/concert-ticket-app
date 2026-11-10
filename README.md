# TicketFlow TH — ระบบจองตั๋วคอนเสิร์ตจำลองอัจฉริยะ
**Digital Chemical Engineering (2306565) — Final Project**

ต่อยอดจากโปรเจกต์ครึ่งแรก (**Database Management + Supervised Learning**) เข้ากับเนื้อหาครึ่งหลัง (**Unsupervised Learning: Dimensionality Reduction PCA + Clustering + Anomaly Detection หาบอทที่ไม่มี Label**) ในรูปแบบเว็บแอปพลิเคชันอินเทอร์แอกทีฟที่รันได้ทันทีบนเบราว์เซอร์และพร้อม Deploy ลง **Vercel**

---

## โครงสร้างไฟล์โปรเจกต์
- `index.html` — หน้าเว็บแอปหลัก แบ่งเป็น 5 แท็บตามลำดับเนื้อหาวิชา
- `css/style.css` — สไตล์ UI ธีมมืดสำหรับแดชบอร์ดและผังที่นั่งคอนเสิร์ต
- `js/rng.js` — Seeded Random Number Generator (ทำให้ผลการทดลองทำซ้ำได้ 100%)
- `js/data.js` — สร้างข้อมูลจำลอง 800 บัญชี (คนจริง 5 กลุ่ม persona, บอทที่มีใน Label `obvious`/`stealth`, และ **บอทสายพันธุ์ใหม่ไร้ Label `zeroday`**) พร้อมระบบตรวจเลขบัตรประชาชนไทย 13 หลัก (Checksum) และการเก็บแบบ Hash
- `js/db.js` — **Database Management (ครึ่งแรก)**: รันฐานข้อมูล **SQLite จริงในเบราว์เซอร์ (WebAssembly / `sql.js`)** พร้อม Primary/Foreign Key, `UNIQUE(seat_id)`, `BEFORE INSERT TRIGGER` จำกัดตั๋วไม่เกิน 4 ใบ/บัตรประชาชน และ Atomic Transaction (`BEGIN IMMEDIATE ... UPDATE seats WHERE status='AVAILABLE'`) ป้องกันการจองซ้ำ (Race Condition = 0)
- `js/ml.js` — **Supervised Learning (ครึ่งแรก)**: โมเดลที่เขียนด้วย JavaScript เองทั้งหมด ได้แก่ `Logistic Regression`, `Decision Tree (CART, Gini)`, `Random Forest` และ `Rule-based Baseline` พร้อม Confusion Matrix, ROC/AUC และการวิเคราะห์ต้นทุน `FP` vs `FN`
- `js/unsup.js` — **Unsupervised Learning (ครึ่งหลัง)**:
  - **Dimensionality Reduction**: `PCA (Eigen-decomposition)` พร้อม **PCA Loadings & 2D Biplot**
  - **Anomaly Detection (ตรวจจับบอทที่ไม่มี Label / Zero-Day Bot)** ครบทั้ง 5 วิธีจากคลาสเรียน:
    1. `Isolation Forest` (Ensemble)
    2. `Local Outlier Factor (LOF)` (Proximity / Local Density)
    3. `K-Means Distance to Normal Centroid` (Clustering-based / CBLOF)
    4. `DBSCAN Noise Detection (label = -1)` (Density-based)
    5. `Statistical Z-Score & Tukey's IQR Rule`
  - **Clustering (Segmentation)**: `K-Means (k-means++)` + `Elbow (Inertia)` + `Silhouette Score`
- `js/app.js` — เชื่อมฐานข้อมูล โมเดล และการจำลองวันเปิดขายเข้ากับ UI
- `vercel.json` & `package.json` — ไฟล์กำหนดค่าสำหรับ Deploy ขึ้น Vercel

---

## วิธีรันใช้งานบนเครื่อง (Local)
1. **เปิดไฟล์ตรง ๆ**: ดับเบิลคลิกไฟล์ `index.html` เปิดใน Chrome / Edge ได้เลย (ไม่ต้องติดตั้ง Python หรือ Node.js)
2. **หรือรันผ่าน Local Server**:
   ```bash
   npx serve .
   ```

---

## วิธีนำขึ้น Vercel (Deploy)
### วิธีที่ 1: ผ่าน Vercel CLI
```bash
cd concert-ticket-app
npx vercel --prod
```
### วิธีที่ 2: ผ่านเว็บ Vercel (GitHub หรือ Drag & Drop)
1. อัปโหลดโฟลเดอร์ `concert-ticket-app` ขึ้น GitHub Repository
2. ไปที่ https://vercel.com/new แล้วเลือก Import Repository นั้น
3. ตั้งค่า **Framework Preset** เป็น `Other` (Static Site) และกด **Deploy** ได้ทันที
