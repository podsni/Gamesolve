# Changelog

Seluruh perubahan penting pada proyek **Okay? Simulator & Auto-Solver + Multi-Size & Killer Sudoku Solver** dicatat secara kronologis pada berkas ini.

Format catatan mengacu pada standar [Keep a Changelog](https://keepachangelog.com/id/1.1.0/).

---

## [1.7.0] - 2026-11-24

### Ditambahkan
- **Deteksi Otomatis Orientasi Sub-Kotak Persegi Panjang (`boxDims`)**: Mendukung orientasi kotak non-persegi secara otomatis maupun manual—termasuk **Sudoku 6×6 `2×3` maupun `3×2`**, `8×8` (`2×4`/`4×2`), dan `12×12` (`3×4`/`4×3`)—berdasarkan rasio kontras ketebalan garis pemisah kotak (*integrated ink-mass*).
- **Tombol Tukar Orientasi Kotak (`Kotak 2×3 ⇄` / `Kotak 3×2 ⇄`)**: Ditampilkan pada header papan Sudoku saat ukuran papan memiliki sub-kotak persegi panjang agar pengguna dapat menukar orientasi kotak dengan satu klik, sekaligus otomatis tersimpan lintas *refresh*.
- **Verifikasi Invarian Jumlah Global Killer Sudoku (`405` untuk 9×9)**: Memanfaatkan kandidat *runner-up* OCR (`secondCode`/`secondConfidence`) untuk mencocokkan total jumlah seluruh sangkar dengan invarian matematis $N^2(N+1)/2$ dan memvalidasi keterpecahannya secara otomatis.
- **Unit Test Orientasi Kotak & Papan Nyata**: Penambahan unit test ke-17 (`sudoku.test.ts`) yang memverifikasi papan `6×6` (`3×2` dan `2×3`) serta papan `9×9` terselesaikan dengan solusi unik.

### Diperbaiki
- **Deteksi Papan Tema Gelap / Navy dengan Efek Cahaya Latar (*Ambient Glow*)**: Menambahkan profil *local 1D ridge* (`rowRidgeGlobal` & `ridgeCol`) pada pemindai grid agar cahaya latar halus di sekitar papan tidak menyatu dengan garis tepi neon dan menyebabkan batas atas papan terbuang.
- **Deteksi Garis Sel Tipis Sangat Samar**: Menambahkan detektor *dual-tier ridge* (`combRow`/`combCol`) untuk garis `1×1` ber-kontras rendah (misalnya `#e6e6e6` di atas `#fdfdfd`) sehingga papan `9×9` bergaris tipis tidak lagi salah terdeteksi sebagai `6×6`.
- **Papan Bersudut Membulat (*Rounded Corners*) & Tema Gelap**: Mengabaikan margin sudut `7,5%` saat mengukur garis batas luar, menggunakan kontras kromatik RGB, serta memperbaiki estimasi luminansi latar per sel pada tema gelap (persentil ke-28 untuk gelap vs ke-72 untuk terang).
- **Pembacaan Angka Kecil `'0'` pada Sangkar Killer Sudoku (Bug `10` Terbaca `11`)**: Memperketat ambang rasio aspek pemisahan *blob* 2 digit (`bw > bh * 0.98 && bw >= 12`) dan menambahkan pelindung *closed-loop* agar angka tunggal berlubang seperti `'0'` atau `'8'` tidak terbelah di bagian tengahnya.
- **Pembersihan Baris Batas Dinamis di Pojok Sangkar Killer**: Menggeser awal ROI sudut kiri atas lebih dekat ke tepi dan memangkas garis pembatas kotak `3×3` secara dinamis tanpa memotong lengkungan atas angka jumlah sangkar.
- **Verifikasi Lintas 9 Screenshot Nyata**: Seluruh 9 variasi screenshot uji (terang `9×9`, gelap hitam pekat `9×9`, navy *glow* `9×9` & `6×6` `2×3`, garis samar `9×9`, sel terpilih biru `9×9`, Sudoku Bliss `6×6` `3×2`, `16×16` `1–9, A–G`, dan Killer Sudoku `9×9` 47 sangkar total `405`) kini terdeteksi 100% akurat dan langsung terselesaikan dengan solusi unik.

---

## [1.6.0] - 2026-11-24

### Ditambahkan
- **Dukungan Multi-Ukuran Sudoku Penuh**: Mendukung ukuran **4×4** (`2×2`), **6×6** (`2×3`), **8×8** (`2×4`), **9×9** (`3×3`), **12×12** (`3×4`, simbol `1–9, A–C`), dan **16×16** (`4×4`, simbol `1–9, A–G`) lengkap dengan keypad dinamis dan pintasan keyboard huruf `A–G`.
- **Deteksi Otomatis Ukuran & Varian (`Auto Deteksi`)**: Pemindai resolusi tinggi (`1800px`) yang otomatis menentukan ukuran papan dan membedakan **Sudoku Klasik** vs **Killer Sudoku**, disertai dropdown pemilihan mode manual dan tombol **Scan Ulang**.
- **Killer Sudoku Scanner, Solver & Editor Sangkar Interaktif**:
  - Deteksi otomatis garis putus-putus sangkar (*inset dashed borders*), pengelompokan sel berbasis **Union-Find**, dan OCR jumlah sangkar 1–2 digit di pojok kiri atas.
  - Pewarnaan graf (*greedy coloring*) agar sangkar bertetangga memiliki warna berbeda.
  - Panel **Editor Sangkar Killer** untuk membuat sangkar baru (`+ Buat Sangkar`), mengubah nilai jumlah secara inline, atau menghapus sangkar.
- **Mesin Solver Bitmask 16-bit + Propagasi Kendala**: Mendukung *Naked Singles*, *Hidden Singles*, pemangkasan batas minimum/maksimum sangkar Killer (*MRV Backtracking*), deteksi konflik sangkar, dan petunjuk `Hint 1 Langkah` dengan penjelasan teknik (`Killer Cage`, `Naked Single`, `Hidden Single`, `Logika Lanjutan`).
- **6 Contoh Soal Cepat**: `9×9 Mudah`, `Killer 9×9` (29 sangkar, 0 angka awal), `16×16 (1–G)`, `4×4 Mini`, `6×6 Klasik`, dan `9×9 Sulit`.
- **Persistensi Sudoku Skema v2**: Penyimpanan ukuran, varian, sangkar Killer, angka, dan hasil scan di IndexedDB dengan kompatibilitas mundur terhadap data v1.

---

## [1.5.0] - 2026-11-24

### Ditambahkan
- **Mode Sudoku Scanner & Auto-Solver (9×9)**: Tab pemilih mode di header atas untuk beralih antara **Okay? Solver** dan **Sudoku Solver**.
- **OCR Angka di Browser**: Normalisasi glyph `24×24`, pencocokan *Normalized Cross-Correlation* (NCC) multi-font, dan analisis lubang topologi BFS tanpa dependensi backend atau API eksternal.
- **Papan Sudoku Interaktif**: Mendukung unggah/seret/tempel (`Ctrl+V`) screenshot, pratinjau kotak deteksi grid, tombol **Solve Semua**, **Hint 1 Langkah**, **Reset Jawaban**, **Bersihkan**, toggle **Tampilkan Kandidat**, serta navigasi penuh menggunakan tombol panah dan angka keyboard.

---

## [1.4.0] - 2026-11-24

### Diperbaiki
- **Akurasi Deteksi Bentuk Computer Vision (`Okay?`)**:
  - Peningkatan pelestarian geometri poligon miring bersudut 45° (trapesium, segilima/segienam miring) agar bentuk hasil scan jauh lebih akurat mengikuti gambar asli tanpa dipaksa menjadi persegi panjang.
  - Penyaringan otomatis elemen UI ponsel pada screenshot—termasuk bilah status atas, toolbar bawah, dan tombol berongga (*hollow hint button*)—sehingga tidak ikut terdeteksi sebagai target atau dinding.
- **Penambahan Unit Test CV**: Penambahan pengujian otomatis untuk trapesium bersudut 45° dan pembersihan elemen UI screenshot.

---

## [1.3.0] - 2026-11-24

### Ditambahkan
- **Persistensi Workspace Otomatis Lintas Refresh**: Hasil unggah screenshot, bentuk poligon, pengaturan kalibrasi scan, pilihan mode aktif, dan hasil solusi kini disimpan otomatis di **IndexedDB** (dengan fallback `localStorage`) sehingga tidak hilang kembali ke bawaan saat halaman di-refresh.
- **Sanitasi Payload Penyimpanan**: Pembersihan status *hit* sementara sebelum menyimpan dan validasi payload saat pemulihan.

---

## [1.2.0] - 2026-11-24

### Diperbaiki
- **Mekanika Benang Putih Tipis (*Pass-Through*) pada `Okay?`**:
  - Deteksi otomatis target putih yang sangat tipis (`1–2 px`) dengan properti `passThrough: true` sambil mengabaikan bayangan (*drop shadow*).
  - Perbaikan mesin fisika (`physics.ts`) agar bola menghancurkan benang putih tipis dan **menembus lurus tanpa memantul**, sesuai mekanika asli game *Okay?*.
  - Penambahan opsi toggle **Mode Nembus (Benang Putih)** dan tombol tambah **Benang Putih (Nembus)** pada tab **Atur Posisi**.

---

## [1.1.0] - 2026-11-24

### Ditambahkan
- **Prediksi Lintasan Bidikan Real-Time (*Live Aim Prediction*)**: Saat pengguna menyeret bidikan langsung di kanvas `Okay?`, jalur pantulan lengkap multi-tumbukan, titik pantul, dan pratinjau target yang akan hancur langsung ditampilkan secara real-time sebelum bola dilepaskan.

---

## [1.0.0] - 2026-11-24

### Ditambahkan
- **Okay? Simulator & Auto-Solver**:
  - Mesin fisika pantulan 2D kontinu (*Ray-Circle vs Segment*) anti-*tunneling*.
  - Pemindai screenshot otomatis berbasis Canvas 2D dengan kontrol sensitivitas, transparansi overlay, tukar Target ↔ Dinding, dan kalibrasi jari-jari bola.
  - **Auto-Solver 3 Tahap** asinkron dengan pengelompokan rute unik, pemusatan **Zona Aman (*Safe Zone*)**, dan penilaian **Skor Kemudahan (0–100)**.
  - Editor bentuk manual (*Atur Posisi*), kontrol kamera (*Zoom*, *Pan*, `FIT`, `Fokus Awal`, *Slow-Mo* `0.4x`/`1x`), audio kalimba sintetik Web Audio API, serta 5 level bawaan siap uji.
  - Dokumentasi lengkap pada `README.md` dan rangkaian unit test otomatis berbasis `node:test`.
