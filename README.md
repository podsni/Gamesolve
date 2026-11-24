# Okay? Simulator & Auto-Solver (+ Sudoku Scanner & Auto-Solver)

Aplikasi web interaktif berbasis **React 19 + TypeScript + Vite + Tailwind CSS v4** yang menggabungkan dua pemecah puzzle visual lengkap dalam satu antarmuka:

1. **Okay? Simulator & Auto-Solver** — simulator fisika pantulan bola 2D, pemindai screenshot otomatis berbasis Computer Vision di browser, editor level presisi, prediksi lintasan real-time saat membidik, dan mesin pencarian solusi otomatis (*Auto-Solver*) lengkap dengan analisis zona aman.
2. **Sudoku Scanner & Auto-Solver** — papan Sudoku 9×9 interaktif, pemindai angka otomatis dari screenshot HP (OCR lokal di browser tanpa API eksternal), solver super-cepat berbasis bitmask + MRV, serta sistem petunjuk bertahap (*Hint 1 Langkah*) dengan penjelasan logika.

Seluruh komputasi fisika, pengolahan citra (*Computer Vision*), OCR angka Sudoku, pencarian solusi, hingga penyimpanan lokal berjalan **100% di sisi klien (browser)**.

---

## Fitur Utama

### 1. Mode Okay? Simulator & Auto-Solver

#### Simulasi Fisika & Prediksi Bidikan Real-Time
- **Deteksi Tumbukan Kontinu (*Continuous Ray-Circle vs Segment*)**: Menghitung tumbukan bola terhadap seluruh sisi dan sudut poligon secara eksak sehingga bola tidak menembus sudut tajam (*anti-tunneling*).
- **Mekanika Benang Putih Tipis (*Pass-Through*)**: Bentuk target putih yang sangat tipis (seperti garis/benang) otomatis dikenali dengan properti `passThrough: true` — bola langsung menghancurkannya dan **menembus lurus tanpa memantul**, sesuai mekanika asli game *Okay?*.
- **Prediksi Lintasan Multi-Pantulan Langsung (*Live Aim Prediction*)**: Saat Anda menarik bidikan di kanvas, jalur pantulan penuh, titik tumbukan, serta pratinjau target yang akan hancur langsung ditampilkan secara real-time sebelum bola dilepaskan.
- **Audio Kalimba Sintetik**: Efek suara nada pentatonik menggunakan Web Audio API yang dapat dinyalakan atau dibisukan dari header.

#### Pemindai Screenshot Otomatis (`Scan Gambar`)
- **Upload, Drag & Drop, atau Paste (`Ctrl+V`)**: Unggah screenshot langsung dari ponsel atau tempel dari clipboard.
- **Pipeline Computer Vision Resolusi Tinggi (`960px`)**:
  - Mendeteksi warna latar belakang dominan secara otomatis.
  - Memisahkan **target putih** (termasuk benang putih tipis 1–2 px) dan **dinding hitam** sekaligus mengabaikan bayangan tipis (*drop shadow*).
  - Mempertahankan bentuk poligon bersudut 45° (seperti balok miring, trapesium, dan segilima berujung lancip) tanpa memaksanya menjadi persegi panjang.
  - Menyaring elemen UI ponsel secara otomatis (status bar atas, toolbar bawah, serta tombol berongga seperti *"watch ad for hint"*).
- **Kalibrasi Interaktif**: Pengaturan sensitivitas deteksi, transparansi overlay gambar asli, tukar peran Target ↔ Dinding, ukuran jari-jari bola, dan tombol *Scan Ulang*.

#### Auto-Solver Multi-Solusi & Analisis Zona Aman
- **Pencarian Asinkron 3 Tahap** (*non-blocking* dengan tombol batal):
  1. Memindai beragam titik awal dan sudut tembakan untuk menemukan beberapa rute pemenang yang berbeda.
  2. Mengelompokkan rute yang unik agar pengguna mendapat variasi pilihan solusi (Solusi #1, #2, dst.).
  3. Memusatkan setiap solusi ke tengah **Zona Aman (*Safe Zone*)** dan menghitung **Skor Kemudahan (0–100)** berdasarkan margin toleransi sudut (± derajat) dan toleransi posisi awal (± piksel).
- **Kalibrasi Tembakan Presisi**: Geser `Posisi X`, `Posisi Y`, dan `Sudut Bidik` secara halus, lalu jalankan *Analisis* atau *Tembakkan*.
- **Kontrol Kamera & Pemutaran**: Zoom in/out (scroll mouse atau cubit 2 jari), geser kanvas (*Pan*), `FIT`, `Fokus Awal` (zoom langsung ke titik mulai & panah bidik), *Slow-Mo* (`0.4x` / `1x`), dan 5 level bawaan siap uji.

#### Editor Bentuk & Posisi (`Atur Posisi`)
- Tambah bentuk baru: Balok Target, Benang Putih (Nembus), Segitiga Target, Balok Dinding, dan Segitiga Dinding.
- Manipulasi langsung di kanvas atau panel kontrol: seret posisi, geser presisi (*nudge*), pusatkan ke tengah layar, putar sudut, ubah skala, cermin horizontal (*Mirror X*), duplikat, balik tipe Target ↔ Dinding, aktif/nonaktifkan sifat *Nembus*, dan *Snap to Grid*.

---

### 2. Mode Sudoku Scanner & Auto-Solver

#### Pemindai Screenshot Sudoku Otomatis (OCR Lokal)
- **Deteksi Grid 9×9 Otomatis**: Menganalisis proyeksi garis horizontal dan vertikal (hingga resolusi `1080px`) untuk menemukan area papan 9×9 secara presisi sambil mengabaikan status bar, statistik atas, keypad angka, dan banner iklan di bawah layar.
- **Pratinjau Overlay Grid Hijau**: Menampilkan thumbnail screenshot yang diunggah lengkap dengan kotak hijau penanda area 9×9 yang terdeteksi serta jumlah angka yang terbaca.
- **Adaptif Terhadap Warna Sel**: Menghitung luminansi latar per sel dari tepi dalam sel sehingga tetap akurat membaca angka pada sel putih, sel sorotan abu-abu, sel terpilih berwarna biru, maupun aplikasi bertema gelap.
- **Klasifikasi Angka 1–9 Presisi Tinggi**: Menggunakan ekstraksi komponen 8-connected, normalisasi glyph `24×24`, pencocokan **Normalized Cross-Correlation (NCC)** terhadap beberapa template font sans-serif, rasio aspek, dan analisis lubang topologi BFS (membedakan `8` dengan 2 lubang, `6`/`9`/`4` dengan 1 lubang berdasarkan posisi vertikal lubang, serta `1`/`2`/`3`/`5`/`7` tanpa lubang).

#### Solver Cepat, Hint Logis & Papan Interaktif
- **Bitmask + MRV Backtracking Solver**: Menyelesaikan papan Sudoku dalam hitungan sub-milidetik (`< 1 ms` untuk sebagian besar puzzle), sekaligus memverifikasi apakah puzzle memiliki **Solusi Unik** atau lebih dari satu solusi.
- **Hint 1 Langkah**: Mencari langkah logis paling jelas terlebih dahulu secara berurutan:
  1. **Naked Single** (sel yang hanya memiliki 1 kandidat sah).
  2. **Hidden Single** (angka yang hanya dapat masuk di 1 posisi dalam baris, kolom, atau kotak 3×3).
  3. **Logika Lanjutan** (deduksi solver jika tidak ada single dasar).
- **Visualisasi Jelas & Validasi Real-Time**:
  - Membedakan warna **Soal** (putih tebal), **Hint** (biru langit), **Solusi** (hijau zamrud), dan **Konflik Duplikat** (merah).
  - Fitur **Tampilkan Kandidat** (*pencil marks* 1–9 kecil di setiap sel kosong).
  - Sorotan otomatis pada baris, kolom, kotak 3×3, dan angka yang sama dengan sel terpilih.
- **Input Fleksibel & Preset**: Mendukung klik + keypad layar (1–9 & hapus), navigasi keyboard penuh, *Reset Jawaban* (mempertahankan angka soal), *Bersihkan*, serta 3 contoh soal cepat (*Mudah*, *Sedang*, *Sulit*).

---

### 3. Persistensi Otomatis Lintas Refresh

Agar pekerjaan dan screenshot yang sudah diunggah tidak hilang saat halaman dimuat ulang (*refresh*):
- **Mode Aktif** (`Okay? Solver` atau `Sudoku Solver`) disimpan otomatis di `localStorage` (`okay_app_mode_v1`).
- **Workspace Okay?** (gambar screenshot, seluruh poligon bentuk, kalibrasi scan, pengaturan grid/jalur, dan hasil solusi) disimpan otomatis ke **IndexedDB** (`okay_simulator_workspace_db`) dengan fallback `localStorage`.
- **Workspace Sudoku** (screenshot yang diunggah, kotak grid terdeteksi, angka soal, isian hint, solusi, dan toggle kandidat) disimpan otomatis ke **IndexedDB** terpisah (`okay_simulator_sudoku_db`) dengan fallback `localStorage`.

---

## Struktur Proyek

```text
├── index.html                      # Entry HTML, metadata judul & deskripsi aplikasi
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
    │   └── SudokuView.tsx          # Antarmuka lengkap Sudoku 9×9, keypad, OCR preview & hint
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
    │   └── engine.test.ts          # Unit test geometri, fisika, solver, CV & persistensi Okay?
    └── sudoku/                     # Mesin solver, OCR & persistensi untuk Sudoku
        ├── sudokuSolver.ts         # Bitmask + MRV solver, deteksi konflik, kandidat, hint & preset
        ├── sudokuScanner.ts        # Deteksi grid 9×9 & OCR angka 1–9 (NCC + topologi lubang)
        ├── sudokuPersistence.ts    # Persistensi IndexedDB + localStorage untuk Sudoku
        └── sudoku.test.ts          # Unit test solver, konflik, kandidat, hint & validasi storage
```

---

## Menjalankan Proyek Secara Lokal

### Prasyarat
- **Node.js** versi 18 atau lebih baru (disarankan Node.js 20+)
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
Aplikasi memiliki **15 unit test otomatis** menggunakan runner bawaan `node:test` melalui `tsx` yang memverifikasi geometri, fisika pantulan, mekanika tembus benang putih, deteksi CV, solver Okay?, persistensi, serta seluruh logika solver & hint Sudoku:

```bash
npx --yes tsx --test src/engine/engine.test.ts src/sudoku/sudoku.test.ts
```

---

## Panduan Penggunaan Cepat

### Mode Okay? Solver
1. **Uji Level Bawaan atau Upload Screenshot**:
   - Pilih salah satu level di bagian **Level Bawaan**, atau klik **Upload Screenshot** / tekan `Ctrl+V` untuk memindai level dari screenshot HP.
2. **Periksa Hasil Scan (Opsional)**:
   - Buka tab **Scan Gambar** untuk menyesuaikan *Sensitivitas*, *Transparansi Overlay*, *Abaikan Status Bar*, atau klik **Tukar Target/Dinding**.
   - Jika perlu penyesuaian manual, buka tab **Atur Posisi** untuk menggeser, memutar, menambah, atau mengubah properti *Nembus (Benang Putih)*.
3. **Cari Solusi atau Bidik Manual**:
   - Klik **Auto Solve** untuk menemukan lintasan pemenang beserta zona aman terbaik.
   - Atau langsung klik & tarik di kanvas pada mode **Tembak** untuk melihat prediksi pantulan secara langsung.

### Mode Sudoku Solver
1. Klik tombol **Sudoku Solver** pada bilah pemilih mode di bagian atas halaman.
2. **Scan Screenshot atau Isi Manual**:
   - Klik **Upload Screenshot**, seret file gambar ke area dropzone, atau tekan `Ctrl+V` untuk menempel screenshot Sudoku.
   - Anda juga bisa mengklik sel mana saja lalu mengetik angka `1–9` (atau memilih dari keypad layar).
3. **Selesaikan atau Minta Petunjuk**:
   - Klik **Solve Semua** untuk langsung menampilkan seluruh jawaban valid (ditandai hijau).
   - Klik **Hint 1 Langkah** untuk membuka satu sel secara bertahap lengkap dengan penjelasan teknik logikanya (*Naked Single* / *Hidden Single*).
   - Aktifkan **Tampilkan Kandidat** untuk melihat semua angka kandidat yang sah di setiap sel kosong.

### Pintasan Keyboard
| Mode | Tombol | Fungsi |
| :--- | :--- | :--- |
| **Umum** | `Ctrl + V` / `Cmd + V` | Tempel screenshot langsung dari clipboard ke mode yang sedang aktif |
| **Okay? (Edit)** | `Delete` / `Backspace` | Hapus bentuk yang sedang dipilih di kanvas |
| **Sudoku** | `Arrow Up/Down/Left/Right` | Pindah sel terpilih pada papan 9×9 |
| **Sudoku** | `1` – `9` | Isi angka pada sel terpilih |
| **Sudoku** | `0` / `Backspace` / `Delete` | Kosongkan angka pada sel terpilih |

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

## Tips Pemecahan Masalah (*Troubleshooting*)

- **Bentuk pada screenshot Okay? kurang terdeteksi atau terlalu banyak noise**:
  Buka tab **Scan Gambar**, geser slider **Sensitivitas Deteksi**, lalu sesuaikan **Transparansi Overlay** untuk mencocokkan poligon hijau/biru dengan gambar asli. Anda dapat menyempurnakan posisi satu-per-satu di tab **Atur Posisi**.
- **Benang putih tipis pada Okay? malah memantulkan bola**:
  Pilih bentuk tersebut di mode **Edit Posisi**, lalu aktifkan opsi **Mode Nembus (Benang Putih)**.
- **Ada 1–2 angka hasil scan Sudoku yang kurang tepat atau ditandai merah (bentrok)**:
  Klik langsung sel tersebut di papan 9×9 dan ketik angka yang benar (atau tekan `Backspace` untuk menghapus), lalu klik **Solve Semua** kembali.
- **Grid Sudoku tidak terdeteksi dari gambar**:
  Pastikan screenshot menampilkan seluruh bingkai papan 9×9 secara utuh, tidak miring/terpotong, dan memiliki kontras garis grid yang cukup jelas.
