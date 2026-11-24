# Okay? Simulator & Auto-Solver + Multi-Size & Killer Sudoku Solver

Aplikasi web interaktif berbasis **React 19 + TypeScript + Vite + Tailwind CSS v4** yang menggabungkan dua pemecah puzzle visual lengkap dalam satu antarmuka dan berjalan **100% di sisi klien (browser)** tanpa memerlukan backend atau API eksternal:

1. **Okay? Simulator & Auto-Solver** — simulator fisika pantulan bola 2D, pemindai screenshot otomatis berbasis Computer Vision, editor level presisi, prediksi lintasan real-time saat membidik, dan mesin pencarian solusi otomatis (*Auto-Solver*) dengan analisis zona aman.
2. **Sudoku Scanner & Auto-Solver (Multi-Size + 16×16 + Killer Sudoku)** — pemindai screenshot otomatis untuk berbagai ukuran (**4×4, 6×6, 8×8, 9×9, 12×12, 16×16 `1–9, A–G`**) sekaligus **Killer Sudoku** (deteksi sangkar garis putus-putus & jumlah sangkar), solver cepat berbasis bitmask + propagasi kendala, editor sangkar interaktif, serta petunjuk logis bertahap.

---

## Fitur Utama

### 1. Mode Okay? Simulator & Auto-Solver

#### Simulasi Fisika 2D & Prediksi Bidikan Real-Time
- **Deteksi Tumbukan Kontinu (*Continuous Ray-Circle vs Segment*)**: Menghitung tumbukan bola terhadap seluruh sisi dan titik sudut poligon secara presisi agar bola tidak menembus sudut (*anti-tunneling*).
- **Mekanika Benang Putih Tipis (*Pass-Through*)**: Target putih yang sangat tipis (garis/benang) otomatis dikenali dengan `passThrough: true` — bola menghancurkannya dan **menembus lurus tanpa memantul**, sesuai fisika asli game *Okay?*.
- **Prediksi Lintasan Multi-Pantulan Real-Time (*Live Aim Prediction*)**: Saat menarik bidikan di kanvas, jalur pantulan penuh, titik tumbukan, dan pratinjau target yang akan hancur langsung digambar secara real-time sebelum bola dilepaskan.
- **Audio Kalimba Sintetik**: Efek suara nada pentatonik menggunakan Web Audio API dengan tombol mute/unmute di header.

#### Pemindai Screenshot Otomatis (`Scan Gambar`)
- **Upload, Drag & Drop, atau Paste (`Ctrl+V`)**: Mendukung unggah gambar dari perangkat maupun tempel langsung dari clipboard.
- **Computer Vision Resolusi Tinggi (`960px`)**:
  - Estimasi warna latar belakang dominan otomatis.
  - Ekstraksi **target putih** (termasuk benang tipis 1–2 px) dan **dinding hitam** sambil mengabaikan bayangan (*drop shadow*).
  - Pelestarian poligon bersudut 45° (trapesium, segilima/segienam miring) tanpa memaksanya menjadi persegi panjang.
  - Penghapusan otomatis elemen UI ponsel (status bar atas, toolbar bawah, dan tombol berongga seperti *"watch ad for hint"*).
- **Kalibrasi Interaktif**: Pengaturan sensitivitas deteksi, transparansi overlay gambar asli, tukar peran Target ↔ Dinding, ukuran jari-jari bola, dan tombol *Scan Ulang*.

#### Auto-Solver Multi-Solusi & Analisis Zona Aman
- **Pencarian Asinkron 3 Tahap** (*non-blocking* dengan tombol batal):
  1. Memindai beragam titik mulai dan sudut tembakan untuk menemukan berbagai rute pemenang.
  2. Mengelompokkan rute yang unik agar tersedia beberapa alternatif solusi (Solusi #1, #2, dst.).
  3. Memusatkan setiap solusi ke tengah **Zona Aman (*Safe Zone*)** dan menghitung **Skor Kemudahan (0–100)** berdasarkan toleransi sudut (± derajat) dan toleransi posisi (± piksel).
- **Kalibrasi Tembakan Presisi**: Slider halus untuk `Posisi X`, `Posisi Y`, dan `Sudut Bidik` beserta tombol *Analisis* dan *Tembakkan*.
- **Kontrol Kamera & Pemutaran**: Zoom in/out (scroll mouse / cubit 2 jari), geser kanvas (*Pan*), `FIT`, `Fokus Awal`, *Slow-Mo* (`0.4x` / `1x`), dan 5 level bawaan siap uji.

#### Editor Bentuk & Posisi (`Atur Posisi`)
- Tambah Balok Target, Benang Putih (Nembus), Segitiga Target, Balok Dinding, dan Segitiga Dinding.
- Transformasi lengkap: seret langsung, geser presisi (*nudge*), pusatkan ke tengah layar, putar, ubah skala, cermin horizontal (*Mirror X*), duplikat, tukar tipe Target ↔ Dinding, toggle *Mode Nembus*, dan *Snap to Grid*.

---

### 2. Mode Sudoku Scanner & Auto-Solver (Multi-Size + 16×16 + Killer)

#### Dukungan Ukuran Papan & Simbol Lengkap
| Ukuran | Sub-Kotak | Simbol yang Digunakan | Dukungan |
| :--- | :---: | :--- | :--- |
| **4×4** | `2×2` | `1–4` | Klasik, Killer, Auto-Scan |
| **6×6** | `2×3` | `1–6` | Klasik, Killer, Auto-Scan |
| **8×8** | `2×4` | `1–8` | Klasik, Killer, Auto-Scan |
| **9×9** | `3×3` | `1–9` | Klasik, Killer, Auto-Scan |
| **12×12** | `3×4` | `1–9, A–C` | Klasik, Auto-Scan |
| **16×16** | `4×4` | `1–9, A–G` | Klasik, Auto-Scan |

#### Pemindai Screenshot Otomatis (`1800px` High-Res OCR)
- **Auto-Deteksi Bingkai & Ukuran Grid**:
  - Mendeteksi bingkai papan persegi maupun sedikit persegi panjang (seperti papan 16×16 di layar ponsel) sembari menolak banner header aplikasi yang tebal, status bar, keypad bawah, dan iklan.
  - Memilih ukuran grid (`4`, `6`, `8`, `9`, `12`, `16`) secara otomatis dengan membandingkan kekuatan garis grid internal terhadap area tengah sel (*midpoint suppression*) sehingga papan `16×16` tidak pernah salah dikenali sebagai `4×4` atau `8×8`.
  - Dilengkapi dropdown **Mode Scan** (`Auto Deteksi` atau kunci manual ke ukuran tertentu) dan tombol **Scan Ulang**.
- **OCR Simbol `0–9` & `A–G` di Browser**:
  - Estimasi luminansi latar adaptif per sel (bekerja pada tema terang, tema gelap, sel abu-abu, maupun sel terpilih berwarna biru).
  - Normalisasi glyph `24×24`, pencocokan **Normalized Cross-Correlation (NCC)** multi-font sans-serif, rasio aspek, analisis lubang topologi BFS (`8`/`B` = 2 lubang, `0`/`4`/`6`/`9`/`A`/`D` = 1 lubang, lainnya = 0 lubang), serta fitur struktural untuk membedakan pasangan mirip (`B` vs `8`, `E` vs `F`, `C` vs `G`, `0` vs `1`).
- **Deteksi Otomatis Killer Sudoku**:
  - Mendeteksi keberadaan garis sangkar putus-putus (*inset dashed borders*) secara otomatis.
  - Mengelompokkan sel yang terhubung menjadi sangkar menggunakan **Union-Find**.
  - Membaca angka jumlah sangkar (1–2 digit) di pojok kiri atas setiap sangkar menggunakan 4-connectivity, threshold adaptif, serta pemisahan otomatis 2 digit yang berdempet di lembah proyeksi vertikal.

#### Mesin Solver Cepat, Hint Bertahap & Editor Sangkar Killer
- **Bitmask (hingga 16-bit) + Constraint Propagation + MRV Backtracking**:
  - Menjalankan propagasi *Naked Singles*, *Hidden Singles* (baris, kolom, kotak), dan pemangkasan batas minimum/maksimum jumlah angka unik sangkar Killer di setiap node pencarian.
  - Menyelesaikan papan `9×9` dalam sub-milidetik (`< 1 ms`), Killer Sudoku `9×9` (termasuk 0 angka awal), serta `16×16` dalam hitungan puluhan milidetik, lengkap dengan pemeriksaan **Solusi Unik** vs **Multi-Solusi**.
- **Hint 1 Langkah**: Memberikan petunjuk satu sel demi satu sel disertai teknik logikanya secara berurutan:
  1. **Killer Cage** (sangkar yang tinggal menyisakan 1 sel kosong).
  2. **Naked Single** (sel yang hanya punya 1 kandidat sah).
  3. **Hidden Single** (simbol yang hanya muat di 1 sel pada baris/kolom/kotak).
  4. **Logika Lanjutan** (deduksi solver).
- **Editor Sangkar Killer Interaktif**:
  - Tampilan papan Killer dengan pewarnaan graf (*greedy coloring*) agar sangkar yang bertetangga memiliki warna tint berbeda, garis putus-putus hanya pada batas luar sangkar, serta badge jumlah di pojok kiri atas.
  - Klik **+ Buat Sangkar** untuk memilih sel-sel anggota sangkar dan memasukkan target jumlahnya.
  - Klik sel mana saja pada mode Killer untuk mengubah jumlah sangkar terpilih secara inline atau menghapus sangkar tersebut.
- **6 Contoh Soal Cepat**: `9×9 Mudah`, `Killer 9×9` (29 sangkar, 0 angka awal), `16×16 (1–G)`, `4×4 Mini`, `6×6 Klasik`, dan `9×9 Sulit`.

---

### 3. Persistensi Otomatis Lintas Refresh

Semua hasil scan dan progres tersimpan otomatis di browser sehingga tidak hilang saat halaman di-refresh:
- **Mode Aplikasi Aktif** (`Okay? Solver` / `Sudoku Solver`): disimpan di `localStorage` (`okay_app_mode_v1`).
- **Workspace Okay?**: screenshot, seluruh bentuk poligon, pengaturan kalibrasi scan, grid/jalur, dan hasil solusi disimpan di **IndexedDB** (`okay_simulator_workspace_db`) dengan fallback `localStorage`.
- **Workspace Sudoku (Skema v2)**: ukuran papan (`4`–`16`), varian (`classic` / `killer`), daftar sangkar Killer, angka soal, hint, solusi, screenshot, kotak grid terdeteksi, dan toggle kandidat disimpan di **IndexedDB** (`okay_simulator_sudoku_db`) dengan dukungan kompatibilitas mundur (*backward compatibility*) untuk data v1.

---

## Struktur Proyek

```text
├── index.html                      # Entry HTML, judul & metadata halaman
├── metadata.json                   # Metadata aplikasi AI Studio
├── package.json                    # Dependensi & skrip npm
├── tsconfig.json                   # Konfigurasi TypeScript
├── vite.config.ts                  # Konfigurasi Vite + Tailwind CSS v4
└── src/
    ├── main.tsx                    # Bootstrap React root
    ├── index.css                   # Import Tailwind CSS & gaya global
    ├── App.tsx                     # Shell utama, pemilih mode Okay? / Sudoku, header & toast
    ├── components/
    │   ├── StageCanvas.tsx         # Kanvas 2D interaktif Okay? (aim, pan, zoom, edit, HUD)
    │   ├── SolveTab.tsx            # Panel solusi aktif, daftar rute, kalibrasi presisi & preset
    │   ├── ScanTab.tsx             # Panel upload screenshot, sensitivitas CV & kalibrasi bola
    │   ├── EditTab.tsx             # Panel editor bentuk, transformasi & properti nembus
    │   └── SudokuView.tsx          # Antarmuka multi-size Sudoku (4×4–16×16), Killer editor & OCR
    ├── engine/                     # Mesin fisika, CV & solver untuk Okay?
    │   ├── types.ts                # Tipe data bentuk, simulasi, analisis solusi & state UI
    │   ├── geometry.ts             # Utilitas vektor, poligon, convex hull & min-area OBB
    │   ├── physics.ts              # Ray-circle vs segment collision & simulasi lintasan bola
    │   ├── solver.ts               # Auto-solver 3 tahap, clustering rute & analisis zona aman
    │   ├── cvDetector.ts           # Ekstraksi bentuk, benang tipis & filter UI dari screenshot
    │   ├── renderer.ts             # Renderer Canvas 2D (papan, jalur bidik, zona aman, overlay)
    │   ├── controller.ts           # Loop animasi rAF, interaksi pointer/touch & state kanvas
    │   ├── presets.ts              # 5 level bawaan Okay?
    │   ├── audio.ts                # Synthesizer suara kalimba berbasis Web Audio API
    │   ├── persistence.ts          # Persistensi IndexedDB + localStorage untuk Okay?
    │   └── engine.test.ts          # 10 unit test geometri, fisika, solver, CV & persistensi
    └── sudoku/                     # Mesin solver, OCR & persistensi untuk Sudoku
        ├── sudokuSolver.ts         # Multi-size (4–16) & Killer solver, konflik, kandidat & hint
        ├── sudokuScanner.ts        # Auto-size detector, OCR 0–9/A–G & Killer cage/sum extractor
        ├── sudokuPersistence.ts    # Persistensi IndexedDB v2 + localStorage untuk Sudoku
        └── sudoku.test.ts          # 6 unit test (4×4, 6×6, 8×8, 9×9, 12×12, 16×16 & Killer)
```

---

## Menjalankan Proyek Secara Lokal

### Prasyarat
- **Node.js** versi 18+ (disarankan Node.js 20+)
- **npm**

### 1. Instalasi Dependensi
```bash
npm install
```

### 2. Menjalankan Mode Pengembangan (*Development Server*)
```bash
npm run dev
```
Aplikasi akan berjalan pada **`http://localhost:3000`**.

### 3. Build Produksi & Pratinjau
```bash
npm run build
npm run preview
```

### 4. Pemeriksaan Tipe TypeScript (*Typecheck / Lint*)
```bash
npm run lint
```

### 5. Menjalankan Unit Test
Tersedia **16 unit test otomatis** berbasis `node:test` melalui `tsx` yang memverifikasi seluruh inti mesin Okay? (geometri, fisika pantulan, benang tipis tembus, CV, solver, persistensi) dan seluruh inti mesin Sudoku (konversi simbol `1–G`, solver `4×4`, `6×6`, `8×8`, `9×9`, `12×12`, `16×16`, Killer Sudoku 0-clue, deteksi konflik sangkar, kandidat, hint `Killer Cage`/`Naked Single`/`Hidden Single`, serta validasi penyimpanan v1/v2):

```bash
npx --yes tsx --test src/engine/engine.test.ts src/sudoku/sudoku.test.ts
```

---

## Panduan Penggunaan & Pintasan Keyboard

### Mode Okay? Solver
1. Pilih salah satu dari 5 **Level Bawaan**, atau unggah/tempel (`Ctrl+V`) screenshot game *Okay?*.
2. Gunakan tab **Scan Gambar** untuk mengatur sensitivitas/overlay, atau tab **Atur Posisi** untuk penyempurnaan manual (termasuk opsi *Mode Nembus* untuk benang putih tipis).
3. Klik **Auto Solve** untuk mencari solusi paling aman, atau tarik langsung di kanvas pada mode **Tembak** untuk melihat prediksi pantulan secara langsung.

### Mode Sudoku Solver
1. Klik **Sudoku Solver** pada bilah pemilih mode di header atas.
2. Pilih **Klasik** atau **Killer Sudoku** serta ukuran papan (`4×4` s.d. `16×16`), **atau** langsung unggah/tempel (`Ctrl+V`) screenshot dengan mode **Auto Deteksi** agar ukuran, varian, angka, dan sangkar terdeteksi otomatis.
3. Jika perlu koreksi 1–2 angka atau jumlah sangkar Killer hasil scan, klik sel tersebut untuk mengedit angka lewat keyboard/keypad atau ubah jumlah sangkar di panel **Editor Sangkar Killer**.
4. Klik **Solve Semua** untuk menampilkan seluruh solusi valid atau **Hint 1 Langkah** untuk petunjuk bertahap.

### Daftar Pintasan Keyboard
| Mode | Tombol | Fungsi |
| :--- | :--- | :--- |
| **Umum** | `Ctrl + V` / `Cmd + V` | Tempel screenshot langsung dari clipboard ke mode yang aktif |
| **Okay? (Edit)** | `Delete` / `Backspace` | Hapus bentuk yang sedang dipilih di kanvas |
| **Sudoku** | `Arrow Up/Down/Left/Right` | Pindah sel terpilih pada papan (mendukung semua ukuran `4×4`–`16×16`) |
| **Sudoku** | `1` – `9` | Isi angka pada sel terpilih |
| **Sudoku** | `A` – `G` (atau `a` – `g`) | Isi simbol huruf pada papan `12×12` (`A–C`) dan `16×16` (`A–G`) |
| **Sudoku** | `0` / `Backspace` / `Delete` | Kosongkan simbol pada sel terpilih |

---

## Stack Teknologi

- **Framework UI**: React 19 + TypeScript
- **Build Tool**: Vite 8
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`)
- **Ikon**: Lucide React
- **Grafis & Pengolahan Citra**: HTML5 Canvas 2D API
- **Audio**: Web Audio API
- **Penyimpanan Lokal**: IndexedDB API + `localStorage` fallback
- **Pengujian**: Node Test Runner (`node:test`) + `tsx`

---

## Pemecahan Masalah (*Troubleshooting*)

- **Ukuran grid Sudoku tidak terdeteksi otomatis sesuai keinginan**:
  Ubah pilihan **Auto Deteksi** pada kartu *Scan Screenshot Sudoku* ke ukuran spesifik (misalnya `6×6 Klasik`, `Killer 9×9`, atau `16×16 (1–G)`), lalu klik **Scan Ulang**.
- **Pada Killer Sudoku, 1–2 angka jumlah sangkar yang sangat kecil kurang tepat** (misalnya `10` terbaca `11`):
  Klik salah satu sel di dalam sangkar tersebut, ubah angka pada kolom **Jumlah** di panel **Editor Sangkar Killer**, lalu klik **Solve Semua**.
- **Ada sel bertanda merah (*Bentrok*) setelah scan**:
  Sel merah menandakan ada angka duplikat (pada baris, kolom, kotak, atau sangkar Killer) atau jumlah sangkar yang tidak mungkin dipenuhi. Klik sel terkait untuk mengoreksinya sebelum menekan **Solve Semua**.
- **Benang putih tipis pada Okay? malah memantulkan bola**:
  Masuk ke tab **Atur Posisi**, klik bentuk benang tersebut, lalu aktifkan **Mode Nembus (Benang Putih)**.
