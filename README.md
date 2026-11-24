# Okay? Simulator & Auto-Solver

Simulator fisika interaktif, pemindai screenshot (*Computer Vision*), editor level presisi, dan **Auto-Solver multi-solusi** berbasis web untuk game puzzle pantulan **Okay?**. Dibangun dengan **React 19**, **TypeScript**, **Vite**, **Tailwind CSS v4**, **HTML5 Canvas 2D (HiDPI)**, dan **Web Audio API**.

---

## Daftar Isi

- [Fitur Utama](#fitur-utama)
- [Mekanik Game Okay? yang Didukung](#mekanik-game-okay-yang-didukung)
- [Teknologi yang Digunakan](#teknologi-yang-digunakan)
- [Struktur Proyek](#struktur-proyek)
- [Arsitektur & Cara Kerja Teknis](#arsitektur--cara-kerja-teknis)
  - [1. Fisika Continuous Swept-Circle Collision](#1-fisika-continuous-swept-circle-collision)
  - [2. Pemindai Screenshot (Computer Vision)](#2-pemindai-screenshot-computer-vision)
  - [3. Auto-Solver 4 Tahap & Analisis Zona Aman](#3-auto-solver-4-tahap--analisis-zona-aman)
  - [4. Prediksi Lintasan Real-Time Saat Membidik](#4-prediksi-lintasan-real-time-saat-membidik)
  - [5. Sintesis Audio Kalimba (Web Audio API)](#5-sintesis-audio-kalimba-web-audio-api)
- [Panduan Penggunaan](#panduan-penggunaan)
- [Kontrol & Pintasan Keyboard](#kontrol--pintasan-keyboard)
- [Level Bawaan (Preset)](#level-bawaan-preset)
- [Instalasi & Menjalankan Lokal](#instalasi--menjalankan-lokal)
- [Pengujian (Unit Tests & Lint)](#pengujian-unit-tests--lint)

---

## Fitur Utama

- **Simulasi Fisika Presisi 60 FPS**: Deteksi tumbukan lingkaran tersapu (*swept-circle collision*) kontinu terhadap segmen sisi dan titik sudut poligon sehingga bola tidak menembus sudut tipis (*anti-tunneling*).
- **Prediksi Pantulan *Real-Time* Saat Membidik**: Saat menekan dan menarik jari/mouse di mode **Tembak**, lintasan pantulan penuh langsung tergambar secara *live* lengkap dengan animasi arah gerak, sorotan target yang akan hancur, titik pantulan bernomor, serta badge sudut & hasil target (`OK!` hijau saat bidikan langsung menamatkan 100% level).
- **Auto-Solver Multi-Solusi & Analisis Kemudahan**:
  - Menemukan hingga **6 solusi berbeda** untuk satu level.
  - Memusatkan setiap solusi ke titik tengah **Zona Aman** (*safe aiming cone* & ruang toleransi jari).
  - Memberi **Skor Kemudahan (0–100)** berdasarkan toleransi sudut (`±°`), toleransi posisi jari (`±px`), ruang bebas titik sentuh, kelurusan sudut (lurus 90°/diagonal 45°), dan jumlah pantulan.
  - Menampilkan badge rekomendasi otomatis: `Cara Termudah`, `Toleransi Terlebar`, `Pantulan Tersingkat`, dan `Sudut Lurus`.
- **Scan Screenshot Level Otomatis**:
  - Mendukung unggah file (`PNG`, `JPG`, `WebP`), *drag & drop*, maupun tempel langsung dari clipboard (`Ctrl+V`).
  - Otomatis mendeteksi warna latar dominan, balok/segitiga putih (target), garis putih tipis (**Benang Nembus**), dan dinding hitam, sambil mengabaikan bayangan halus (*drop shadow*) serta status bar HP.
  - Dilengkapi kalibrasi sensitivitas, overlay foto asli transparan, tukar warna target/dinding, dan pengaturan radius bola fisika.
- **Kalibrasi Tembakan Presisi (*Fine-Tuner*)**: Slider `Posisi X`, `Posisi Y`, dan `Sudut Bidik` per `0.1°` dengan tombol **Analisis** (pusatkan ulang & ukur toleransi) dan **Tembakkan**.
- **Editor Posisi & Bentuk Presisi**: Tambah kotak putih, benang putih nembus, segitiga putih, dinding hitam, atau segitiga hitam; geser bebas atau *Snap Grid (5px)*, putar melalui handle hijau di kanvas maupun tombol `-15° / -1° / +1° / +15°`, ubah ukuran, cermin horizontal, duplikat, ubah tipe Putih/Hitam, dan ubah mode `Nembus / Pantul`.
- **Kamera Interaktif**: Zoom (`75%–450%`) via scroll mouse, cubit 2 jari (*pinch-zoom*), atau tombol `+/FIT/-`, geser papan (*pan*) via mode **Geser** atau tahan `Spasi`, serta tombol **Fokus Awal** untuk memperbesar area titik mulai solusi.
- **Audio Kalimba Pentatonis**: Efek nada Kalimba naik per kombo target, bunyi pantulan dinding, dan akor kemenangan yang disintesis langsung tanpa aset audio eksternal.

---

## Mekanik Game Okay? yang Didukung

| Jenis Objek | Tampilan di Kanvas | Perilaku Saat Tersentuh Bola |
| :--- | :--- | :--- |
| **Target Putih Padat** (`target`, `passThrough: false`) | Balok / segitiga putih solid | Target **hancur** (+1 target), memicu partikel & nada Kalimba, lalu bola **memantul** sesuai hukum refleksi. |
| **Benang Putih Tipis** (`target`, `passThrough: true`) | Garis putih tipis dengan tepi cyan halus | Target **hancur / terputus** (+1 target), memicu partikel & nada Kalimba, lalu bola **melaju lurus menembus tanpa memantul** (tidak dihitung sebagai pantulan). |
| **Dinding Hitam** (`wall`) | Balok / segitiga gelap | Dinding **tetap utuh** (tidak hancur), berkedip singkat (*hit flash*), mengeluarkan bunyi *thud*, dan **memantulkan** bola. |

---

## Teknologi yang Digunakan

- **Frontend Framework**: React `19.0.1` + TypeScript `7.0.2`
- **Build Tool**: Vite `8.3.0`
- **Styling**: Tailwind CSS `4.3.3` (`@tailwindcss/vite`)
- **Ikon**: `lucide-react`
- **Rendering**: HTML5 Canvas 2D (HiDPI `devicePixelRatio` + `ResizeObserver`) dengan loop imperatif terpisah dari React state agar animasi stabil 60 FPS
- **Audio**: Web Audio API (sintesis prosedural Kalimba)
- **Testing**: `node:test` + `tsx`

---

## Struktur Proyek

```text
.
├── index.html                    # Entry HTML, metadata halaman, font Plus Jakarta Sans & JetBrains Mono
├── metadata.json                 # Metadata aplikasi
├── package.json                  # Dependensi & skrip (dev, build, preview, lint)
├── tsconfig.json                 # Konfigurasi TypeScript
├── vite.config.ts                # Konfigurasi Vite + Tailwind CSS v4
└── src/
    ├── main.tsx                  # Mount React root
    ├── index.css                 # Import Tailwind CSS v4 & utilitas dasar
    ├── App.tsx                   # Koordinator utama UI, state tab, solver, scanner, editor, & toast
    ├── components/
    │   ├── StageCanvas.tsx       # Kanvas HiDPI, loop 60fps, gesture zoom/pan/aim/edit, HUD & win banner
    │   ├── SolveTab.tsx          # Kartu perbandingan multi-solusi, analisis Zona Aman, Fine-Tuner, & preset
    │   ├── ScanTab.tsx           # Dropzone screenshot, kalibrasi CV, overlay transparansi, & radius bola
    │   └── EditTab.tsx           # Palet tambah bentuk (+ Benang Putih), inspektor presisi, D-Pad, rotasi & skala
    └── engine/
        ├── types.ts              # Konstanta papan (400×680), tipe Shape, SimResult, AnalyzedSolution, dll.
        ├── geometry.ts           # Matematika poligon: convex hull, Minimum-Area OBB, transformasi & sudut
        ├── physics.ts            # Engine tumbukan swept-circle, anti-tunneling, pass-through & simulasi tembakan
        ├── cvDetector.ts         # Ekstraksi bentuk dari screenshot (960px, outer-corner hull, klasifikasi benang)
        ├── solver.ts             # Auto-Solver 4 tahap, multi-corridor exploration & Safe-Zone centering
        ├── renderer.ts           # Renderer Canvas 2D (overlay, grid, bentuk, Zona Aman, prediksi live, partikel)
        ├── controller.ts         # Controller imperatif state animasi, kamera, partikel & audio
        ├── presets.ts            # 5 level bawaan siap uji
        ├── audio.ts              # Synthesizer Kalimba pentatonis berbasis Web Audio API
        └── engine.test.ts        # Suite unit test otomatis (8 skenario pengujian)
```

---

## Arsitektur & Cara Kerja Teknis

### 1. Fisika Continuous Swept-Circle Collision
Berlokasi di `src/engine/physics.ts`:
- Papan menggunakan sistem koordinat logis tetap **`400 × 680` px** dengan batas maksimal `MAX_BOUNCES = 120` dan proteksi *wall trap* (`wallStreak > 24`).
- `rayCircleVsSegment` menguji interseksi lingkaran berjari-jari `R` yang bergerak sepanjang vektor arah `(dx, dy)` terhadap:
  1. **Badan segmen** (*offset* sejajar sejauh `R` sepanjang normal permukaan), dengan perbaikan *grazing contact* (`dist` di rentang `[R - 0.08, R]`) agar bola tidak pernah menembus dinding pada sudut sangat landai.
  2. **Dua titik ujung segmen** (lingkaran sudut berjari-jari `R`) agar pantulan di pojok balok atau segitiga tetap akurat secara fisika.
- Jika target memiliki `passThrough: true` (Benang Putih), target langsung ditandai `alive = 0` sementara vektor arah `(dx, dy)` **tidak direfleksikan** dan posisi bola dimajukan sedikit sepanjang arah gerak (`hit + d * 0.06`).
- Skor heuristik simulasi mengukur **jarak terdekat dari seluruh segmen lintasan** ke titik sudut, titik tengah sisi, dan sentroid target yang belum tersentuh sehingga solver memiliki gradien optimasi yang mulus bahkan di labirin berdinding padat.

### 2. Pemindai Screenshot (Computer Vision)
Berlokasi di `src/engine/cvDetector.ts`:
1. **Resolusi Pemrosesan Tinggi (`maxDim = 960px`)**: Menjaga garis putih tipis (`6px` pada screenshot HP `1170×2532`) tetap utuh saat *downscaling* sekaligus mempertahankan celah sempit antar rintangan hitam.
2. **Deteksi Latar Dominan**: Menggunakan histogram warna terkuantisasi 3-bit pada area aktif (opsional memotong `5.5%` atas & bawah untuk mengabaikan status bar / *home indicator* HP).
3. **Klasifikasi Foreground & Penolakan Bayangan**: Memisahkan latar gelap/terang secara adaptif terhadap `detectSensitivity`, mempertahankan piksel garis putih tipis yang terkena *anti-aliasing* tanpa menangkap *drop shadow* halus di belakang balok hitam.
4. **Connected Components + Outer-Corner Hull**: Setiap piksel tepi komponen menyumbang 4 sudut luar piksel `(x, y)..(x+1, y+1)` ke *convex hull* sehingga garis setipis `1px` tidak pernah kolinear/terbuang dan selalu menghasilkan *Minimum-Area Oriented Bounding Box (OBB)* 4 sudut yang presisi.
5. **Fitting Bentuk & Klasifikasi Benang Nembus**:
   - Garis putih memanjang ultra-tipis (`ketebalan logis <= 6.5px`, `panjang >= 30px`, `rasio panjang/tebal >= 8:1`) otomatis diberi `passThrough: true`.
   - Bentuk dengan *rectangularity* tinggi (`>= 0.78`) dipetakan ke 4 sudut OBB; segitiga (`triRatio >= 0.88`) disederhanakan menjadi 3 titik sudut tajam; bentuk lain disederhanakan menjadi poligon konveks hingga 6 sudut.

### 3. Auto-Solver 4 Tahap & Analisis Zona Aman
Berlokasi di `src/engine/solver.ts`:
- **Tahap 1 — Face-Guided Backward Ray Sweep**: Menyapu sisi-sisi target (lebih rapat saat jumlah target sedikit, mis. `<= 4` target) dan dinding, memproyeksikan titik awal nyaman ke belakang (`findComfortableSpawn`), lalu menyimulasikan lintasan dalam mode cepat.
- **Tahap 2 — Multi-Resolution Local Refinement**: Menyempurnakan kandidat *near-miss* terbaik melalui 3 putaran grid lokal yang makin halus (`±3.5° → ±0.6° → ±0.12°` dan pergeseran tegak lurus `±12px → ±3.2px → ±0.9px`).
- **Tahap 3 — Multi-Corridor Exploration (PRNG Deterministik)**: Jika solusi menang masih `< 2`, melakukan eksplorasi terarah dengan PRNG deterministik (`LCG`) yang memvariasikan koridor pantulan dari 14 kandidat beragam terbaik sekaligus membidik titik-titik acak di sepanjang sisi target.
- **Tahap 4 — Safe-Zone Centering & Ease Scoring**:
  - Mengukur jendela toleransi sudut (`±0.12°` per langkah hingga `±6.0°`) dan toleransi posisi tegak lurus jari (`±1px` hingga `±20px`).
  - Memusatkan ulang titik mulai & sudut tepat di **titik tengah Zona Aman**.
  - Menghitung **Ease Score (5–99)** berbobot: toleransi sudut (40%), toleransi posisi jari (28%), kelonggaran ruang sekitar titik sentuh (12%), keselarasan sudut 90°/45° (10%), dan efisiensi pantulan (10%).

### 4. Prediksi Lintasan Real-Time Saat Membidik
Berlokasi di `src/components/StageCanvas.tsx` dan `src/engine/renderer.ts`:
- Setiap pergerakan pointer di mode **Tembak** langsung menjalankan `simulateShot` dan menyimpan hasilnya pada `engine.aimPreviewSim` (tanpa memicu re-render React).
- Kanvas merender seluruh rantai pantulan dengan garis putus-putus animatif searah gerak bola:
  - **Hijau Emerald (`OK!`)**: Bidikan diprediksi menyapu bersih 100% target (semua target yang terkena menyala hijau).
  - **Biru Langit**: Bidikan mengenai sebagian target (target yang terkena menyala biru + nomor urutan hantaman).
  - **Putih**: Bidikan hanya mengenai dinding atau meleset.
- Badge melayang di dekat kursor menampilkan sudut presisi dan jumlah target (contoh: `84.0° · 1/2` atau `179.6° · 16/16 OK!`), otomatis terjepit di dalam batas kanvas agar tidak terpotong.

### 5. Sintesis Audio Kalimba (Web Audio API)
Berlokasi di `src/engine/audio.ts`:
- Menggunakan tangga nada pentatonis (`C5` hingga `A6`) dengan osilator fundamental *triangle* + harmonik *sine* beramplop *decay* eksponensial sehingga setiap target yang hancur terdengar musikal sesuai kombo.
- Dinding hitam menghasilkan bunyi *thud* frekuensi rendah singkat (`145Hz → 65Hz`), dan penyelesaian level memainkan arpeggio akor kemenangan (`C5–E5–G5–C6`).

---

## Panduan Penggunaan

1. **Menggunakan Level Bawaan**:
   - Buka tab **Solve & Level**, pilih salah satu dari 5 level di bagian **Level Bawaan**, lalu klik **Auto Solve** atau langsung tarik jari/mouse di kanvas untuk mencoba menembak manual dengan prediksi *live*.
2. **Menyelesaikan Screenshot Level dari HP**:
   - Klik **Upload Screenshot** (atau buka tab **Scan Gambar**), lalu unggah gambar / tarik file / tekan `Ctrl+V`.
   - Periksa hasil deteksi di panel **Kalibrasi Deteksi Gambar** (misalnya `Terdeteksi: 2 Target Putih (2 Benang Nembus) · 13 Dinding Hitam`).
   - Jika celah antar dinding sangat sempit, perkecil slider **Ukuran Bola Fisika** (default `4.8 px`), atau ubah **Sensitivitas Deteksi** lalu klik **Scan Ulang**.
   - Jika ada bentuk yang sedikit miring/bergeser, perbaiki di tab **Atur Posisi** (Anda juga bisa mengubah target putih antara `Mode: Nembus` dan `Mode: Pantul`).
   - Klik **Auto Solve** untuk mendapatkan hingga 6 jalur solusi terbaik.
3. **Meniru Solusi di Game Asli**:
   - Pilih solusi berlabel **Cara Termudah** atau **Toleransi Terlebar**.
   - Aktifkan **Zona Aman** dan klik **Fokus Awal** untuk melihat posisi titik sentuh (`% kiri, % atas`), kerucut aman hijau, lingkaran toleransi jari biru, dan sudut kompas arah tembak.
   - Gunakan tombol `0.4x` (Slow-Mo) dan **Ulang** untuk mengamati urutan pantulan secara perlahan.

---

## Kontrol & Pintasan Keyboard

| Aksi | Mouse / Sentuh | Keyboard |
| :--- | :--- | :--- |
| **Membidik & Prediksi Live** (Mode `Tembak`) | Tekan di ruang kosong lalu tarik, lepas untuk menembak | — |
| **Zoom Kanvas** | Scroll mouse / Cubit 2 jari (*pinch-zoom*) / Tombol `+`, `FIT`, `-` | — |
| **Geser Kamera (Pan)** | Mode `Geser` + tarik, Klik tengah + tarik, atau 2 jari | Tahan `Spasi` + tarik |
| **Pilih & Geser Bentuk** (Mode `Edit Posisi`) | Klik bentuk lalu tarik | `Panah Atas/Bawah/Kiri/Kanan` (`2px`, tahan `Shift` untuk `10px`) |
| **Putar Bentuk** (Mode `Edit Posisi`) | Tarik titik hijau di atas bentuk terpilih | — |
| **Hapus Bentuk Terpilih** | Tombol **Hapus** di inspektor | `Delete` / `Backspace` |
| **Batalkan Seleksi Bentuk** | Klik area kosong kanvas | `Escape` |
| **Tempel Screenshot** | Dropzone di tab **Scan Gambar** | `Ctrl+V` / `Cmd+V` di mana saja |

---

## Level Bawaan (Preset)

1. **Grid Segitiga 4×5** (`triangles4x5`): 16 segitiga target putih dan 4 segitiga dinding hitam dalam formasi grid 4×5.
2. **Level 30 (Lorong 2 Garis)** (`level30`): 2 balok target putih panjang di dalam koridor dinding hitam miring.
3. **Level 1 (Zig-Zag Dasar)** (`level1`): 3 balok target putih bertingkat untuk latihan pantulan zig-zag dasar.
4. **Level 14 (Pantulan Hitam)** (`level14`): 2 target putih di sisi berlawanan dengan dinding pemantul hitam di tengah.
5. **Level 24 (Berlian 5 Balok)** (`level24`): 5 balok target putih dalam formasi simetris berlian + 2 dinding miring.

---

## Instalasi & Menjalankan Lokal

Pastikan **Node.js** (disarankan v20+) sudah terpasang.

```bash
# 1. Instal dependensi
npm install

# 2. Jalankan server pengembangan (port 3000)
npm run dev

# 3. Build versi produksi
npm run build

# 4. Pratinjau hasil build produksi
npm run preview
```

Buka `http://localhost:3000` di browser.

---

## Pengujian (Unit Tests & Lint)

Proyek ini memiliki suite unit test untuk modul murni (*geometry*, *physics*, *pass-through strings*, *CV detector*, dan *auto-solver*) serta pemeriksaan tipe TypeScript ketat:

```bash
# Jalankan seluruh unit test (8 skenario)
npx tsx --test src/engine/engine.test.ts

# Jalankan pengecekan tipe TypeScript
npm run lint
```

### Cakupan Unit Test (`src/engine/engine.test.ts`)
1. Konstruksi persegi/segitiga, uji titik dalam poligon, translasi, rotasi, skala, dan cermin horizontal.
2. *Convex hull* dan *Minimum-Area OBB* pada kumpulan titik.
3. Refleksi `rayCircleVsSegment` dan pencegahan *grazing tunneling*.
4. Simulasi `simulateShot` menghancurkan target dan memantul pada dinding hitam.
5. Auto-Solver menyelesaikan `level1`, `level14`, dan `level24` lengkap dengan validasi *Safe-Zone centering* dan metrik kemudahan.
6. Auto-Solver menyelesaikan preset default `triangles4x5` (16 target, 4 dinding) 100%.
7. `extractShapesFromImageData` mendeteksi garis putih ultra-tipis (`1px` & `2px`), otomatis mengklasifikasikannya sebagai `passThrough: true`, mendeteksi dinding gelap, dan mengabaikan *drop shadow*.
8. Fisika `passThrough` memastikan bola menghancurkan dua benang putih berurutan sambil terus melaju lurus tanpa memantul (`bounces === 0`).
