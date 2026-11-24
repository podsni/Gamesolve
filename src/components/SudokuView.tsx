import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Zap,
  ImageUp,
  Lightbulb,
  RotateCcw,
  Trash2,
  ScanLine,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Delete,
  Grid3X3,
} from 'lucide-react';
import {
  cloneGrid,
  countFilledCells,
  createEmptyGrid,
  findConflicts,
  getCellCandidates,
  getNextSudokuHint,
  solveSudoku,
  SUDOKU_PRESETS,
  SudokuGrid,
  SudokuHint,
} from '../sudoku/sudokuSolver';
import { scanSudokuFromImage, SudokuGridRect } from '../sudoku/sudokuScanner';
import {
  loadSudokuState,
  PersistedSudokuState,
  saveSudokuState,
} from '../sudoku/sudokuPersistence';

interface SudokuViewProps {
  onToast: (msg: string) => void;
}

interface SolveMeta {
  solveTimeMs: number;
  hasMultipleSolutions: boolean;
  invalidReason: string | null;
}

function mergeGrids(givens: SudokuGrid, userEntries: SudokuGrid): SudokuGrid {
  return givens.map((row, r) =>
    row.map((val, c) => (val !== 0 ? val : userEntries[r][c]))
  );
}

export const SudokuView: React.FC<SudokuViewProps> = ({ onToast }) => {
  const [givens, setGivens] = useState<SudokuGrid>(() =>
    cloneGrid(SUDOKU_PRESETS[0].board)
  );
  const [userEntries, setUserEntries] = useState<SudokuGrid>(() =>
    createEmptyGrid()
  );
  const [solution, setSolution] = useState<SudokuGrid | null>(null);
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>([
    0, 2,
  ]);
  const [activeHint, setActiveHint] = useState<SudokuHint | null>(null);
  const [solveMeta, setSolveMeta] = useState<SolveMeta | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);

  // Uploaded screenshot & OCR scan preview state
  const [uploadedImageDataUrl, setUploadedImageDataUrl] = useState<
    string | null
  >(null);
  const [gridRect, setGridRect] = useState<SudokuGridRect | null>(null);
  const [imageWidth, setImageWidth] = useState(0);
  const [imageHeight, setImageHeight] = useState(0);
  const [detectedCount, setDetectedCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hydratedRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Working grid (givens + step hints) and displayed grid (+ full solution if solved)
  const workingGrid = useMemo(
    () => mergeGrids(givens, userEntries),
    [givens, userEntries]
  );

  const displayGrid = useMemo(() => {
    if (!solution) return workingGrid;
    return workingGrid.map((row, r) =>
      row.map((val, c) => (val !== 0 ? val : solution[r][c]))
    );
  }, [workingGrid, solution]);

  const conflicts = useMemo(() => findConflicts(workingGrid), [workingGrid]);
  const givenCount = useMemo(() => countFilledCells(givens), [givens]);
  const filledCount = useMemo(() => countFilledCells(displayGrid), [displayGrid]);
  const isComplete = filledCount === 81 && conflicts.size === 0;

  const selectedValue = selectedCell
    ? displayGrid[selectedCell[0]][selectedCell[1]]
    : 0;

  const buildSnapshot = useCallback(
    (overrides?: Partial<PersistedSudokuState>): PersistedSudokuState => ({
      version: 1,
      savedAt: Date.now(),
      givens,
      userEntries,
      solution,
      uploadedImageDataUrl,
      gridRect,
      imageWidth,
      imageHeight,
      detectedCount,
      showCandidates,
      ...overrides,
    }),
    [
      givens,
      userEntries,
      solution,
      uploadedImageDataUrl,
      gridRect,
      imageWidth,
      imageHeight,
      detectedCount,
      showCandidates,
    ]
  );

  // Hydrate persisted Sudoku workspace on mount
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const saved = await loadSudokuState();
      if (cancelled) return;
      if (saved) {
        setGivens(cloneGrid(saved.givens));
        setUserEntries(cloneGrid(saved.userEntries));
        setSolution(saved.solution ? cloneGrid(saved.solution) : null);
        setUploadedImageDataUrl(saved.uploadedImageDataUrl ?? null);
        setGridRect(saved.gridRect ?? null);
        setImageWidth(saved.imageWidth ?? 0);
        setImageHeight(saved.imageHeight ?? 0);
        setDetectedCount(saved.detectedCount ?? 0);
        setShowCandidates(Boolean(saved.showCandidates));
      }
      hydratedRef.current = true;
    };
    void hydrate();

    return () => {
      cancelled = true;
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  // Debounced auto-save on state edits
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      void saveSudokuState(buildSnapshot());
    }, 180);
  }, [buildSnapshot]);

  const setCellDigit = useCallback(
    (row: number, col: number, digit: number) => {
      setGivens((prev) => {
        const next = cloneGrid(prev);
        next[row][col] = digit;
        return next;
      });
      setUserEntries((prev) => {
        if (prev[row][col] === 0) return prev;
        const next = cloneGrid(prev);
        next[row][col] = 0;
        return next;
      });
      setSolution(null);
      setActiveHint(null);
      setSolveMeta(null);
    },
    []
  );

  const runScanOnImage = useCallback(
    (img: HTMLImageElement, dataUrl: string) => {
      setScanning(true);
      try {
        const res = scanSudokuFromImage(img);
        if (!res.gridRect) {
          setUploadedImageDataUrl(dataUrl);
          setGridRect(null);
          setImageWidth(res.imageWidth);
          setImageHeight(res.imageHeight);
          setDetectedCount(0);
          onToast(
            'Grid 9×9 tidak terdeteksi jelas. Pastikan screenshot menampilkan seluruh papan Sudoku.'
          );
          return;
        }

        const nextGivens = cloneGrid(res.board);
        const emptyUser = createEmptyGrid();
        setGivens(nextGivens);
        setUserEntries(emptyUser);
        setSolution(null);
        setActiveHint(null);
        setSolveMeta(null);
        setUploadedImageDataUrl(dataUrl);
        setGridRect(res.gridRect);
        setImageWidth(res.imageWidth);
        setImageHeight(res.imageHeight);
        setDetectedCount(res.detectedCount);

        hydratedRef.current = true;
        void saveSudokuState(
          buildSnapshot({
            givens: nextGivens,
            userEntries: emptyUser,
            solution: null,
            uploadedImageDataUrl: dataUrl,
            gridRect: res.gridRect,
            imageWidth: res.imageWidth,
            imageHeight: res.imageHeight,
            detectedCount: res.detectedCount,
          })
        );

        const scannedConflicts = findConflicts(nextGivens);
        if (scannedConflicts.size > 0) {
          onToast(
            `Memindai ${res.detectedCount} angka (ada angka bentrok merah, silakan koreksi sel tersebut).`
          );
        } else {
          onToast(
            `Berhasil memindai ${res.detectedCount} angka dari screenshot Sudoku.`
          );
        }
      } finally {
        setScanning(false);
      }
    },
    [buildSnapshot, onToast]
  );

  const handleImageFile = useCallback(
    (file: File | null | undefined) => {
      if (!file || !file.type.startsWith('image/')) {
        onToast('Pilih file gambar screenshot Sudoku (PNG / JPG / WebP).');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result !== 'string') return;
        const img = new Image();
        img.onload = () => runScanOnImage(img, result);
        img.onerror = () => onToast('Gagal membaca file gambar.');
        img.src = result;
      };
      reader.readAsDataURL(file);
    },
    [onToast, runScanOnImage]
  );

  const handleRescan = useCallback(() => {
    if (!uploadedImageDataUrl) return;
    const img = new Image();
    img.onload = () => runScanOnImage(img, uploadedImageDataUrl);
    img.onerror = () => onToast('Gagal memuat ulang gambar untuk scan.');
    img.src = uploadedImageDataUrl;
  }, [uploadedImageDataUrl, runScanOnImage, onToast]);

  // Clipboard paste support while SudokuView is mounted
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          handleImageFile(items[i].getAsFile());
          break;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleImageFile]);

  // Keyboard navigation & digit entry for selected cell
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!selectedCell) return;
      const [r, c] = selectedCell;

      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        setCellDigit(r, c, Number(e.key));
      } else if (
        e.key === 'Backspace' ||
        e.key === 'Delete' ||
        e.key === '0'
      ) {
        e.preventDefault();
        setCellDigit(r, c, 0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCell([(r + 8) % 9, c]);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCell([(r + 1) % 9, c]);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedCell([r, (c + 8) % 9]);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedCell([r, (c + 1) % 9]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedCell, setCellDigit]);

  const handleSolveAll = useCallback(() => {
    const res = solveSudoku(workingGrid);
    if (!res.solved || !res.solution) {
      setSolution(null);
      setSolveMeta({
        solveTimeMs: res.solveTimeMs,
        hasMultipleSolutions: false,
        invalidReason: res.invalidReason,
      });
      onToast(res.invalidReason || 'Tidak ditemukan solusi valid.');
      return;
    }

    setSolution(res.solution);
    setActiveHint(null);
    setSolveMeta({
      solveTimeMs: res.solveTimeMs,
      hasMultipleSolutions: res.hasMultipleSolutions,
      invalidReason: null,
    });

    void saveSudokuState(
      buildSnapshot({
        solution: res.solution,
      })
    );

    onToast(
      res.hasMultipleSolutions
        ? `Solusi ditemukan dalam ${res.solveTimeMs.toFixed(1)} ms (memiliki lebih dari 1 solusi).`
        : `Sudoku terselesaikan 100% dalam ${res.solveTimeMs.toFixed(1)} ms (Solusi Unik).`
    );
  }, [workingGrid, buildSnapshot, onToast]);

  const handleHintStep = useCallback(() => {
    if (conflicts.size > 0) {
      onToast('Perbaiki dulu angka bentrok (merah) sebelum meminta hint.');
      return;
    }
    const base = solution ? displayGrid : workingGrid;
    if (countFilledCells(base) === 81) {
      onToast('Semua 81 sel Sudoku sudah terisi lengkap.');
      return;
    }
    const hint = getNextSudokuHint(workingGrid);
    if (!hint) {
      setSolveMeta({
        solveTimeMs: 0,
        hasMultipleSolutions: false,
        invalidReason:
          'Papan saat ini tidak memiliki solusi yang sah. Cek kembali angka yang terisi.',
      });
      onToast('Tidak dapat menemukan hint — papan tidak memiliki solusi sah.');
      return;
    }

    const nextUser = cloneGrid(userEntries);
    nextUser[hint.row][hint.col] = hint.value;
    setUserEntries(nextUser);
    setSelectedCell([hint.row, hint.col]);
    setActiveHint(hint);
    setSolveMeta(null);
    onToast(
      `Hint (${hint.technique}): Baris ${hint.row + 1}, Kolom ${hint.col + 1} = ${hint.value}`
    );
  }, [conflicts.size, solution, displayGrid, workingGrid, userEntries, onToast]);

  const handleResetAnswers = useCallback(() => {
    setUserEntries(createEmptyGrid());
    setSolution(null);
    setActiveHint(null);
    setSolveMeta(null);
    onToast('Jawaban direset — angka soal tetap dipertahankan.');
  }, [onToast]);

  const handleClearBoard = useCallback(() => {
    const empty = createEmptyGrid();
    setGivens(empty);
    setUserEntries(createEmptyGrid());
    setSolution(null);
    setActiveHint(null);
    setSolveMeta(null);
    setUploadedImageDataUrl(null);
    setGridRect(null);
    setDetectedCount(0);
    setSelectedCell([0, 0]);
    onToast('Papan Sudoku dibersihkan.');
  }, [onToast]);

  const handleLoadPreset = useCallback(
    (board: SudokuGrid, label: string) => {
      setGivens(cloneGrid(board));
      setUserEntries(createEmptyGrid());
      setSolution(null);
      setActiveHint(null);
      setSolveMeta(null);
      setUploadedImageDataUrl(null);
      setGridRect(null);
      setDetectedCount(0);
      setSelectedCell([0, 0]);
      onToast(`Level contoh "${label}" dimuat.`);
    },
    [onToast]
  );

  return (
    <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <input
        ref={fileInputRef}
        data-testid="sudoku-file-input"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageFile(file);
          e.target.value = '';
        }}
      />

      {/* LEFT COLUMN: Interactive 9x9 Sudoku Board + Keypad + Primary Actions */}
      <section className="lg:col-span-6 flex flex-col items-center gap-3.5 w-full">
        {/* Board Card */}
        <div className="w-full max-w-[468px] bg-slate-900/90 border border-white/10 rounded-2xl p-3 sm:p-4 shadow-2xl">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Grid3X3 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              <span>Papan Sudoku 9×9</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-semibold">
              <span className="text-slate-400">
                Terisi:{' '}
                <strong
                  data-testid="sudoku-filled-count"
                  className={isComplete ? 'text-emerald-400' : 'text-white'}
                >
                  {filledCount}/81
                </strong>
              </span>
              {conflicts.size > 0 && (
                <span className="text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                  Bentrok
                </span>
              )}
            </div>
          </div>

          {/* 9x9 Grid */}
          <div
            data-testid="sudoku-board"
            role="grid"
            aria-label="Papan Sudoku 9 kali 9"
            className="w-full aspect-square grid grid-cols-9 grid-rows-9 bg-slate-950 border-2 border-slate-500/80 rounded-xl overflow-hidden select-none"
          >
            {displayGrid.map((rowVals, r) =>
              rowVals.map((val, c) => {
                const isGiven = givens[r][c] !== 0;
                const isHintOrUser = !isGiven && userEntries[r][c] !== 0;
                const isAutoSolved =
                  !isGiven && !isHintOrUser && solution !== null && val !== 0;
                const isSelected =
                  selectedCell !== null &&
                  selectedCell[0] === r &&
                  selectedCell[1] === c;
                const isPeer =
                  selectedCell !== null &&
                  !isSelected &&
                  (selectedCell[0] === r ||
                    selectedCell[1] === c ||
                    (Math.floor(selectedCell[0] / 3) === Math.floor(r / 3) &&
                      Math.floor(selectedCell[1] / 3) === Math.floor(c / 3)));
                const isSameDigit =
                  selectedValue !== 0 && val === selectedValue && !isSelected;
                const isConflict = conflicts.has(`${r},${c}`);
                const isActiveHintCell =
                  activeHint !== null &&
                  activeHint.row === r &&
                  activeHint.col === c;

                const borderRight =
                  c === 8
                    ? ''
                    : c === 2 || c === 5
                      ? 'border-r-2 border-r-slate-500/80'
                      : 'border-r border-r-slate-800';
                const borderBottom =
                  r === 8
                    ? ''
                    : r === 2 || r === 5
                      ? 'border-b-2 border-b-slate-500/80'
                      : 'border-b border-b-slate-800';

                let bgClass = 'bg-slate-900/75 hover:bg-slate-800/85';
                if (isConflict) {
                  bgClass = 'bg-rose-500/25 hover:bg-rose-500/35';
                } else if (isSelected) {
                  bgClass = 'bg-sky-500/30 ring-2 ring-inset ring-sky-400';
                } else if (isActiveHintCell) {
                  bgClass =
                    'bg-amber-500/20 ring-2 ring-inset ring-amber-400/80';
                } else if (isSameDigit) {
                  bgClass = 'bg-emerald-500/18';
                } else if (isPeer) {
                  bgClass = 'bg-slate-800/65';
                }

                let textClass = 'text-white font-extrabold';
                if (isConflict) {
                  textClass = 'text-rose-300 font-extrabold';
                } else if (isHintOrUser) {
                  textClass = 'text-sky-300 font-bold';
                } else if (isAutoSolved) {
                  textClass = 'text-emerald-400 font-bold';
                }

                const cellCandidates =
                  val === 0 && showCandidates
                    ? getCellCandidates(workingGrid, r, c)
                    : [];

                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    data-row={r}
                    data-col={c}
                    data-val={val}
                    data-kind={
                      isGiven
                        ? 'given'
                        : isHintOrUser
                          ? 'hint'
                          : isAutoSolved
                            ? 'solved'
                            : 'empty'
                    }
                    aria-label={`Baris ${r + 1} Kolom ${c + 1}${val ? ` angka ${val}` : ' kosong'}`}
                    onClick={() => setSelectedCell([r, c])}
                    className={`relative flex items-center justify-center focus:outline-none transition-colors ${borderRight} ${borderBottom} ${bgClass}`}
                  >
                    {val !== 0 ? (
                      <span
                        className={`text-lg sm:text-2xl leading-none tabular-nums ${textClass}`}
                      >
                        {val}
                      </span>
                    ) : showCandidates && cellCandidates.length > 0 ? (
                      <span className="grid grid-cols-3 grid-rows-3 w-full h-full p-0.5 text-[8px] sm:text-[9px] leading-none text-slate-400 font-medium">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                          <span
                            key={d}
                            className="flex items-center justify-center"
                          >
                            {cellCandidates.includes(d) ? d : ''}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          {/* Legend */}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-white inline-block" />
                Soal ({givenCount})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-sky-400 inline-block" />
                Hint
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />
                Solusi
              </span>
            </div>
            <span className="text-slate-500">
              Ketik 1–9 / panah untuk edit
            </span>
          </div>
        </div>

        {/* Primary Action Buttons */}
        <div className="w-full max-w-[468px] grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="sudoku-solve-btn"
            onClick={handleSolveAll}
            className="py-2.5 px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 text-sm font-bold flex items-center justify-center gap-2 whitespace-nowrap shadow-[0_8px_22px_-6px_rgba(16,185,129,0.55)] transition"
          >
            <Zap className="w-4 h-4 fill-current" aria-hidden="true" />
            <span>Solve Semua</span>
          </button>

          <button
            type="button"
            data-testid="sudoku-upload-btn"
            disabled={scanning}
            onClick={() => fileInputRef.current?.click()}
            className="py-2.5 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-[0.98] disabled:opacity-50 border border-white/15 text-white text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition"
          >
            <ImageUp className="w-4 h-4 text-sky-300" aria-hidden="true" />
            <span>{scanning ? 'Memindai...' : 'Upload Screenshot'}</span>
          </button>
        </div>

        {/* Secondary Action Row */}
        <div className="w-full max-w-[468px] grid grid-cols-3 gap-1.5">
          <button
            type="button"
            data-testid="sudoku-hint-btn"
            onClick={handleHintStep}
            className="py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-amber-300 flex items-center justify-center gap-1.5 whitespace-nowrap transition"
          >
            <Lightbulb className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Hint 1 Langkah</span>
          </button>

          <button
            type="button"
            onClick={handleResetAnswers}
            className="py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 whitespace-nowrap transition"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Reset Jawaban</span>
          </button>

          <button
            type="button"
            onClick={handleClearBoard}
            className="py-2 px-2 rounded-xl bg-white/5 hover:bg-rose-500/15 border border-white/10 hover:border-rose-400/35 text-xs font-semibold text-slate-300 hover:text-rose-200 flex items-center justify-center gap-1.5 whitespace-nowrap transition"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Bersihkan</span>
          </button>
        </div>

        {/* On-Screen Digit Keypad (1-9 + Erase) */}
        <div className="w-full max-w-[468px] grid grid-cols-5 sm:grid-cols-10 gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
            <button
              key={digit}
              type="button"
              disabled={!selectedCell}
              onClick={() => {
                if (selectedCell) {
                  setCellDigit(selectedCell[0], selectedCell[1], digit);
                }
              }}
              className="py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 active:scale-95 disabled:opacity-40 border border-white/10 text-sm font-bold text-white transition"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            disabled={!selectedCell}
            aria-label="Hapus angka pada sel terpilih"
            title="Hapus Sel"
            onClick={() => {
              if (selectedCell) {
                setCellDigit(selectedCell[0], selectedCell[1], 0);
              }
            }}
            className="py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 active:scale-95 disabled:opacity-40 border border-rose-400/30 text-rose-200 flex items-center justify-center transition"
          >
            <Delete className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      {/* RIGHT COLUMN: Screenshot Scanner Preview, Status & Hint, Sample Presets */}
      <section className="lg:col-span-6 flex flex-col gap-4 w-full">
        {/* Status & Solution / Hint Card */}
        <div
          data-testid="sudoku-status"
          className="bg-slate-900/90 border border-white/10 rounded-2xl p-4 flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              <span>Status & Solusi Sudoku</span>
            </h2>

            <button
              type="button"
              aria-pressed={showCandidates}
              onClick={() => setShowCandidates((v) => !v)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition ${
                showCandidates
                  ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
              }`}
            >
              {showCandidates ? (
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>Tampilkan Kandidat</span>
            </button>
          </div>

          {solveMeta?.invalidReason ? (
            <div className="rounded-xl bg-rose-500/12 border border-rose-400/35 p-3 text-xs text-rose-200 flex items-start gap-2.5">
              <AlertTriangle
                className="w-4 h-4 text-rose-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span>{solveMeta.invalidReason}</span>
            </div>
          ) : isComplete ? (
            <div className="rounded-xl bg-emerald-500/12 border border-emerald-400/35 p-3 text-xs text-emerald-100 flex items-start gap-2.5">
              <CheckCircle2
                className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-emerald-300">
                  Sudoku Terselesaikan 100% (81/81 Sel Valid)
                </span>
                {solveMeta && (
                  <span className="text-emerald-200/80">
                    Waktu hitung: {solveMeta.solveTimeMs.toFixed(1)} ms ·{' '}
                    {solveMeta.hasMultipleSolutions
                      ? 'Lebih dari 1 solusi memungkinkan'
                      : 'Solusi Unik'}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-300 leading-relaxed">
              Upload screenshot Sudoku dari HP atau ketik angka langsung pada
              papan, lalu klik{' '}
              <strong className="text-emerald-300">Solve Semua</strong> untuk
              menampilkan jawaban lengkap atau{' '}
              <strong className="text-amber-300">Hint 1 Langkah</strong> untuk
              petunjuk bertahap.
            </p>
          )}

          {activeHint && (
            <div
              data-testid="sudoku-hint-box"
              className="rounded-xl bg-amber-500/12 border border-amber-400/35 p-3 flex flex-col gap-1"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-amber-300 flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
                  Teknik: {activeHint.technique}
                </span>
                <span className="font-mono text-[11px] text-amber-200">
                  B{activeHint.row + 1} · K{activeHint.col + 1} →{' '}
                  <strong>{activeHint.value}</strong>
                </span>
              </div>
              <p className="text-xs text-slate-200 leading-relaxed">
                {activeHint.reason}
              </p>
            </div>
          )}
        </div>

        {/* Screenshot Scanner Dropzone + Preview */}
        <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <ScanLine className="w-4 h-4 text-sky-400" aria-hidden="true" />
              <span>Scan Screenshot Sudoku</span>
            </h2>
            {uploadedImageDataUrl && (
              <button
                type="button"
                onClick={handleRescan}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-sky-300 transition"
              >
                Scan Ulang
              </button>
            )}
          </div>

          <button
            type="button"
            data-testid="sudoku-upload-dropzone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleImageFile(file);
            }}
            className={`w-full rounded-xl border-2 border-dashed p-4 text-center transition flex flex-col items-center justify-center gap-1.5 ${
              dragOver
                ? 'border-sky-400 bg-sky-500/15'
                : 'border-white/15 bg-slate-950/60 hover:border-sky-400/50 hover:bg-slate-800/50'
            }`}
          >
            <ImageUp className="w-6 h-6 text-sky-400" aria-hidden="true" />
            <span className="text-xs font-semibold text-white">
              Klik, seret gambar ke sini, atau tekan Ctrl+V
            </span>
            <span className="text-[11px] text-slate-400">
              Mendukung screenshot Sudoku HP (tema terang & gelap) · otomatis
              tersimpan saat refresh
            </span>
          </button>

          {uploadedImageDataUrl && (
            <div className="flex items-start gap-3 bg-slate-950/70 border border-white/10 rounded-xl p-3">
              <div className="relative w-24 sm:w-28 shrink-0 rounded-lg overflow-hidden border border-white/15 bg-slate-900">
                <img
                  src={uploadedImageDataUrl}
                  alt="Pratinjau screenshot Sudoku"
                  className="w-full h-auto block"
                />
                {gridRect && imageWidth > 0 && imageHeight > 0 && (
                  <svg
                    viewBox={`0 0 ${imageWidth} ${imageHeight}`}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    aria-hidden="true"
                  >
                    <rect
                      x={gridRect.x}
                      y={gridRect.y}
                      width={gridRect.w}
                      height={gridRect.h}
                      fill="rgba(16, 185, 129, 0.14)"
                      stroke="#34d399"
                      strokeWidth={Math.max(4, imageWidth * 0.012)}
                    />
                  </svg>
                )}
              </div>

              <div className="flex flex-col gap-1 text-xs min-w-0">
                <span className="font-bold text-white">
                  Hasil Pemindaian Otomatis
                </span>
                <span className="text-emerald-300 font-semibold">
                  {detectedCount} angka terdeteksi di papan 9×9
                </span>
                <span className="text-[11px] text-slate-400 leading-relaxed">
                  Kotak hijau menandai area grid yang terdeteksi. Jika ada 1–2
                  angka kurang tepat, klik sel pada papan untuk mengoreksi
                  langsung.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Sample Presets */}
        <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-4 flex flex-col gap-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Contoh Soal Cepat
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {SUDOKU_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => handleLoadPreset(preset.board, preset.label)}
                className="py-2.5 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left flex flex-col gap-0.5 transition"
              >
                <span className="text-xs font-bold text-white">
                  {preset.difficulty}
                </span>
                <span className="text-[11px] text-slate-400 truncate">
                  {countFilledCells(preset.board)} angka awal
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};
