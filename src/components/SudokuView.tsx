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
  Plus,
  Layers,
} from 'lucide-react';
import {
  BoxDims,
  cloneGrid,
  countFilledCells,
  createEmptyGrid,
  digitToSymbol,
  findConflicts,
  getBoxDims,
  getCageHeadCell,
  getCellCandidates,
  getNextSudokuHint,
  KillerCage,
  resolveBoxDims,
  solveSudoku,
  SUDOKU_PRESETS,
  SudokuGrid,
  SudokuHint,
  SudokuSize,
  SudokuVariant,
  SUPPORTED_SUDOKU_SIZES,
  symbolToDigit,
} from '../sudoku/sudokuSolver';
import {
  scanSudokuFromImage,
  SudokuGridRect,
  SudokuScanOptions,
} from '../sudoku/sudokuScanner';
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

type ScanModeChoice =
  | 'auto'
  | 'classic-4'
  | 'classic-6'
  | 'classic-8'
  | 'classic-9'
  | 'classic-12'
  | 'classic-16'
  | 'killer-9';

const GRID_TEMPLATE_CLASSES: Record<SudokuSize, string> = {
  4: 'grid-cols-4 grid-rows-4',
  6: 'grid-cols-6 grid-rows-6',
  8: 'grid-cols-8 grid-rows-8',
  9: 'grid-cols-9 grid-rows-9',
  12: 'grid-cols-12 grid-rows-12',
  16: 'grid-cols-[repeat(16,minmax(0,1fr))] grid-rows-[repeat(16,minmax(0,1fr))]',
};

const CELL_TEXT_CLASSES: Record<SudokuSize, string> = {
  4: 'text-3xl sm:text-4xl',
  6: 'text-2xl sm:text-3xl',
  8: 'text-xl sm:text-2xl',
  9: 'text-lg sm:text-2xl',
  12: 'text-sm sm:text-base',
  16: 'text-[11px] sm:text-sm',
};

const CAGE_TINT_CLASSES = [
  'bg-sky-500/10',
  'bg-emerald-500/10',
  'bg-amber-500/10',
  'bg-violet-500/10',
  'bg-rose-500/10',
  'bg-cyan-500/10',
];

function mergeGrids(givens: SudokuGrid, userEntries: SudokuGrid): SudokuGrid {
  return givens.map((row, r) =>
    row.map((val, c) => (val !== 0 ? val : userEntries[r]?.[c] ?? 0))
  );
}

function scanModeToOptions(mode: ScanModeChoice): SudokuScanOptions {
  switch (mode) {
    case 'auto':
      return { sizeHint: 'auto', variantHint: 'auto' };
    case 'classic-4':
      return { sizeHint: 4, variantHint: 'classic' };
    case 'classic-6':
      return { sizeHint: 6, variantHint: 'classic' };
    case 'classic-8':
      return { sizeHint: 8, variantHint: 'classic' };
    case 'classic-9':
      return { sizeHint: 9, variantHint: 'classic' };
    case 'classic-12':
      return { sizeHint: 12, variantHint: 'classic' };
    case 'classic-16':
      return { sizeHint: 16, variantHint: 'classic' };
    case 'killer-9':
      return { sizeHint: 9, variantHint: 'killer' };
  }
}

export const SudokuView: React.FC<SudokuViewProps> = ({ onToast }) => {
  const [size, setSize] = useState<SudokuSize>(9);
  const [boxDims, setBoxDims] = useState<BoxDims>(() => getBoxDims(9));
  const [variant, setVariant] = useState<SudokuVariant>('classic');
  const [cages, setCages] = useState<KillerCage[]>([]);
  const [givens, setGivens] = useState<SudokuGrid>(() =>
    cloneGrid(SUDOKU_PRESETS[0].board)
  );
  const [userEntries, setUserEntries] = useState<SudokuGrid>(() =>
    createEmptyGrid(9)
  );
  const [solution, setSolution] = useState<SudokuGrid | null>(null);
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>([
    0, 2,
  ]);
  const [activeHint, setActiveHint] = useState<SudokuHint | null>(null);
  const [solveMeta, setSolveMeta] = useState<SolveMeta | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);

  // Killer cage editor state
  const [cageEditMode, setCageEditMode] = useState(false);
  const [draftCageCells, setDraftCageCells] = useState<string[]>([]);
  const [draftCageSum, setDraftCageSum] = useState('10');

  // Uploaded screenshot & OCR scan preview state
  const [scanMode, setScanMode] = useState<ScanModeChoice>('auto');
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

  const activeCages = useMemo(
    () => (variant === 'killer' ? cages : []),
    [variant, cages]
  );

  const workingGrid = useMemo(
    () => mergeGrids(givens, userEntries),
    [givens, userEntries]
  );

  const displayGrid = useMemo(() => {
    if (!solution || solution.length !== size) return workingGrid;
    return workingGrid.map((row, r) =>
      row.map((val, c) => (val !== 0 ? val : solution[r][c]))
    );
  }, [workingGrid, solution, size]);

  const resolvedBoxDims = useMemo(
    () => resolveBoxDims(size, boxDims),
    [size, boxDims]
  );
  const { boxRows, boxCols } = resolvedBoxDims;

  const conflicts = useMemo(
    () =>
      findConflicts(workingGrid, {
        size,
        boxDims: resolvedBoxDims,
        cages: activeCages,
      }),
    [workingGrid, size, resolvedBoxDims, activeCages]
  );

  const totalCells = size * size;
  const givenCount = useMemo(() => countFilledCells(givens), [givens]);
  const filledCount = useMemo(() => countFilledCells(displayGrid), [displayGrid]);
  const isComplete = filledCount === totalCells && conflicts.size === 0;

  const selectedValue =
    selectedCell &&
    selectedCell[0] < size &&
    selectedCell[1] < size
      ? displayGrid[selectedCell[0]][selectedCell[1]]
      : 0;

  // Fast lookup maps for Killer cage rendering & inline editing
  const { cellToCage, cageHeadMap, cageColorIdx } = useMemo(() => {
    const map = new Map<string, KillerCage>();
    const heads = new Map<string, KillerCage>();
    const colorMap = new Map<number, number>();

    for (const cg of activeCages) {
      for (const [r, c] of cg.cells) {
        map.set(`${r},${c}`, cg);
      }
      const head = getCageHeadCell(cg);
      if (head) heads.set(`${head[0]},${head[1]}`, cg);
    }

    // Greedy graph coloring so neighboring cages never share the same background tint
    for (const cg of activeCages) {
      const usedColors = new Set<number>();
      for (const [r, c] of cg.cells) {
        const neighbors: [number, number][] = [
          [r - 1, c],
          [r + 1, c],
          [r, c - 1],
          [r, c + 1],
        ];
        for (const [nr, nc] of neighbors) {
          const nb = map.get(`${nr},${nc}`);
          if (nb && nb.id !== cg.id && colorMap.has(nb.id)) {
            usedColors.add(colorMap.get(nb.id)!);
          }
        }
      }
      let chosen = 0;
      while (usedColors.has(chosen) && chosen < CAGE_TINT_CLASSES.length) {
        chosen++;
      }
      colorMap.set(cg.id, chosen % CAGE_TINT_CLASSES.length);
    }

    return { cellToCage: map, cageHeadMap: heads, cageColorIdx: colorMap };
  }, [activeCages]);

  const selectedCage = selectedCell
    ? cellToCage.get(`${selectedCell[0]},${selectedCell[1]}`) ?? null
    : null;

  const buildSnapshot = useCallback(
    (overrides?: Partial<PersistedSudokuState>): PersistedSudokuState => ({
      version: 2,
      savedAt: Date.now(),
      size,
      boxDims: resolvedBoxDims,
      variant,
      cages,
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
      size,
      resolvedBoxDims,
      variant,
      cages,
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
        setSize(saved.size);
        setBoxDims(resolveBoxDims(saved.size, saved.boxDims));
        setVariant(saved.variant);
        setCages(saved.cages ?? []);
        setGivens(cloneGrid(saved.givens));
        setUserEntries(cloneGrid(saved.userEntries));
        setSolution(saved.solution ? cloneGrid(saved.solution) : null);
        setUploadedImageDataUrl(saved.uploadedImageDataUrl ?? null);
        setGridRect(saved.gridRect ?? null);
        setImageWidth(saved.imageWidth ?? 0);
        setImageHeight(saved.imageHeight ?? 0);
        setDetectedCount(saved.detectedCount ?? 0);
        setShowCandidates(Boolean(saved.showCandidates));
        setSelectedCell([0, 0]);
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

  const switchSize = useCallback(
    (nextSize: SudokuSize, keepVariant?: SudokuVariant) => {
      const nextVar = keepVariant ?? variant;
      setSize(nextSize);
      setBoxDims(getBoxDims(nextSize));
      setVariant(nextVar);
      setGivens(createEmptyGrid(nextSize));
      setUserEntries(createEmptyGrid(nextSize));
      setCages([]);
      setSolution(null);
      setActiveHint(null);
      setSolveMeta(null);
      setCageEditMode(false);
      setDraftCageCells([]);
      setSelectedCell([0, 0]);
      if (nextSize >= 12) setShowCandidates(false);
    },
    [variant]
  );

  const toggleBoxOrientation = useCallback(() => {
    if (boxRows === boxCols) return;
    const nextDims: BoxDims = { boxRows: boxCols, boxCols: boxRows };
    setBoxDims(nextDims);
    setSolution(null);
    setActiveHint(null);
    setSolveMeta(null);
    onToast(`Susunan kotak diubah ke ${nextDims.boxRows}×${nextDims.boxCols}.`);
  }, [boxRows, boxCols, onToast]);

  const switchVariant = useCallback(
    (nextVariant: SudokuVariant) => {
      if (nextVariant === variant) return;
      setVariant(nextVariant);
      setSolution(null);
      setActiveHint(null);
      setSolveMeta(null);
      setCageEditMode(false);
      setDraftCageCells([]);
      if (nextVariant === 'killer' && size > 9) {
        // Default Killer to 9x9 when switching from 12x12/16x16
        setSize(9);
        setBoxDims(getBoxDims(9));
        setGivens(createEmptyGrid(9));
        setUserEntries(createEmptyGrid(9));
        setCages([]);
        setSelectedCell([0, 0]);
      }
    },
    [variant, size]
  );

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

  const handleSaveDraftCage = useCallback(() => {
    const parsedSum = parseInt(draftCageSum, 10);
    if (draftCageCells.length === 0) {
      onToast('Pilih minimal 1 sel di papan untuk membentuk sangkar.');
      return;
    }
    if (Number.isNaN(parsedSum) || parsedSum <= 0) {
      onToast('Masukkan jumlah sangkar yang valid (> 0).');
      return;
    }
    const chosenSet = new Set(draftCageCells);
    const chosenCoords: [number, number][] = draftCageCells.map((key) => {
      const [r, c] = key.split(',').map(Number);
      return [r, c];
    });

    setCages((prev) => {
      // Remove chosen cells from any existing cages
      const cleaned = prev
        .map((cg) => ({
          ...cg,
          cells: cg.cells.filter(([r, c]) => !chosenSet.has(`${r},${c}`)),
        }))
        .filter((cg) => cg.cells.length > 0);
      const maxId = cleaned.reduce((m, cg) => Math.max(m, cg.id), 0);
      return [
        ...cleaned,
        { id: maxId + 1, sum: parsedSum, cells: chosenCoords },
      ];
    });
    setDraftCageCells([]);
    setSolution(null);
    setSolveMeta(null);
    onToast(
      `Sangkar (${chosenCoords.length} sel, jumlah ${parsedSum}) tersimpan.`
    );
  }, [draftCageCells, draftCageSum, onToast]);

  const handleUpdateSelectedCageSum = useCallback(
    (cageId: number, nextSumStr: string) => {
      const parsed = parseInt(nextSumStr, 10);
      setCages((prev) =>
        prev.map((cg) =>
          cg.id === cageId
            ? { ...cg, sum: Number.isNaN(parsed) ? 0 : Math.max(0, parsed) }
            : cg
        )
      );
      setSolution(null);
      setSolveMeta(null);
    },
    []
  );

  const handleRemoveSelectedCage = useCallback(
    (cageId: number) => {
      setCages((prev) => prev.filter((cg) => cg.id !== cageId));
      setSolution(null);
      setSolveMeta(null);
      onToast('Sangkar dihapus.');
    },
    [onToast]
  );

  const runScanOnImage = useCallback(
    (img: HTMLImageElement, dataUrl: string, overrideMode?: ScanModeChoice) => {
      setScanning(true);
      try {
        const activeMode = overrideMode ?? scanMode;
        const res = scanSudokuFromImage(img, scanModeToOptions(activeMode));
        if (!res.gridRect) {
          setUploadedImageDataUrl(dataUrl);
          setGridRect(null);
          setImageWidth(res.imageWidth);
          setImageHeight(res.imageHeight);
          setDetectedCount(0);
          onToast(
            'Grid Sudoku tidak terdeteksi jelas. Pastikan screenshot menampilkan seluruh papan.'
          );
          return;
        }

        const nextGivens = cloneGrid(res.board);
        const emptyUser = createEmptyGrid(res.size);
        const nextBoxDims = resolveBoxDims(res.size, res.boxDims);
        setSize(res.size);
        setBoxDims(nextBoxDims);
        setVariant(res.variant);
        setCages(res.cages);
        setGivens(nextGivens);
        setUserEntries(emptyUser);
        setSolution(null);
        setActiveHint(null);
        setSolveMeta(null);
        setCageEditMode(false);
        setDraftCageCells([]);
        setSelectedCell([0, 0]);
        if (res.size >= 12) setShowCandidates(false);

        setUploadedImageDataUrl(dataUrl);
        setGridRect(res.gridRect);
        setImageWidth(res.imageWidth);
        setImageHeight(res.imageHeight);
        setDetectedCount(res.detectedCount);

        hydratedRef.current = true;
        void saveSudokuState(
          buildSnapshot({
            size: res.size,
            boxDims: nextBoxDims,
            variant: res.variant,
            cages: res.cages,
            givens: nextGivens,
            userEntries: emptyUser,
            solution: null,
            uploadedImageDataUrl: dataUrl,
            gridRect: res.gridRect,
            imageWidth: res.imageWidth,
            imageHeight: res.imageHeight,
            detectedCount: res.detectedCount,
            showCandidates: res.size >= 12 ? false : showCandidates,
          })
        );

        const scannedConflicts = findConflicts(nextGivens, {
          size: res.size,
          boxDims: nextBoxDims,
          cages: res.variant === 'killer' ? res.cages : [],
        });
        const boxInfo =
          nextBoxDims.boxRows !== nextBoxDims.boxCols
            ? ` Kotak ${nextBoxDims.boxRows}×${nextBoxDims.boxCols},`
            : '';
        const label =
          res.variant === 'killer'
            ? `Killer Sudoku ${res.size}×${res.size} (${res.detectedCount} angka, ${res.detectedCageCount} sangkar)`
            : `Sudoku ${res.size}×${res.size} (${boxInfo} ${res.detectedCount} simbol)`.replace('( ', '(');

        if (scannedConflicts.size > 0) {
          onToast(
            `Terdeteksi ${label} — ada sel bentrok merah, silakan koreksi sebelum solve.`
          );
        } else {
          onToast(`Berhasil memindai ${label}.`);
        }
      } finally {
        setScanning(false);
      }
    },
    [scanMode, buildSnapshot, showCandidates, onToast]
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

  const handleRescan = useCallback(
    (overrideMode?: ScanModeChoice) => {
      if (!uploadedImageDataUrl) return;
      const img = new Image();
      img.onload = () => runScanOnImage(img, uploadedImageDataUrl, overrideMode);
      img.onerror = () => onToast('Gagal memuat ulang gambar untuk scan.');
      img.src = uploadedImageDataUrl;
    },
    [uploadedImageDataUrl, runScanOnImage, onToast]
  );

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

  // Keyboard navigation & symbol entry (1-9, A-G) for selected cell
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!selectedCell || cageEditMode) return;
      const [r, c] = selectedCell;

      const parsed = symbolToDigit(e.key, size);
      if (parsed !== null) {
        e.preventDefault();
        setCellDigit(r, c, parsed);
      } else if (
        e.key === 'Backspace' ||
        e.key === 'Delete' ||
        e.key === '0'
      ) {
        e.preventDefault();
        setCellDigit(r, c, 0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCell([(r + size - 1) % size, c]);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCell([(r + 1) % size, c]);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedCell([r, (c + size - 1) % size]);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedCell([r, (c + 1) % size]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedCell, cageEditMode, size, setCellDigit]);

  const handleSolveAll = useCallback(() => {
    const res = solveSudoku(workingGrid, {
      size,
      boxDims: resolvedBoxDims,
      cages: activeCages,
    });
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
        ? `Solusi ${size}×${size} ditemukan dalam ${res.solveTimeMs.toFixed(1)} ms (lebih dari 1 solusi).`
        : `${variant === 'killer' ? 'Killer Sudoku' : 'Sudoku'} ${size}×${size} terselesaikan 100% dalam ${res.solveTimeMs.toFixed(1)} ms (Solusi Unik).`
    );
  }, [workingGrid, size, resolvedBoxDims, activeCages, variant, buildSnapshot, onToast]);

  const handleHintStep = useCallback(() => {
    if (conflicts.size > 0) {
      onToast('Perbaiki dulu sel bentrok (merah) sebelum meminta hint.');
      return;
    }
    const base = solution ? displayGrid : workingGrid;
    if (countFilledCells(base) === totalCells) {
      onToast(`Semua ${totalCells} sel Sudoku sudah terisi lengkap.`);
      return;
    }
    const hint = getNextSudokuHint(workingGrid, {
      size,
      boxDims: resolvedBoxDims,
      cages: activeCages,
    });
    if (!hint) {
      setSolveMeta({
        solveTimeMs: 0,
        hasMultipleSolutions: false,
        invalidReason:
          'Papan saat ini tidak memiliki solusi yang sah. Cek kembali simbol atau sangkar Killer yang terisi.',
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
      `Hint (${hint.technique}): Baris ${hint.row + 1}, Kolom ${hint.col + 1} = ${hint.symbol}`
    );
  }, [
    conflicts.size,
    solution,
    displayGrid,
    workingGrid,
    totalCells,
    size,
    resolvedBoxDims,
    activeCages,
    userEntries,
    onToast,
  ]);

  const handleResetAnswers = useCallback(() => {
    setUserEntries(createEmptyGrid(size));
    setSolution(null);
    setActiveHint(null);
    setSolveMeta(null);
    onToast('Jawaban direset — soal & sangkar tetap dipertahankan.');
  }, [size, onToast]);

  const handleClearBoard = useCallback(() => {
    setGivens(createEmptyGrid(size));
    setUserEntries(createEmptyGrid(size));
    setCages([]);
    setSolution(null);
    setActiveHint(null);
    setSolveMeta(null);
    setCageEditMode(false);
    setDraftCageCells([]);
    setUploadedImageDataUrl(null);
    setGridRect(null);
    setDetectedCount(0);
    setSelectedCell([0, 0]);
    onToast('Papan Sudoku dibersihkan.');
  }, [size, onToast]);

  const handleLoadPreset = useCallback(
    (preset: (typeof SUDOKU_PRESETS)[number]) => {
      setSize(preset.size);
      setBoxDims(resolveBoxDims(preset.size, preset.boxDims));
      setVariant(preset.variant);
      setCages(
        preset.cages
          ? preset.cages.map((cg) => ({
              ...cg,
              cells: cg.cells.map(([r, c]) => [r, c] as [number, number]),
            }))
          : []
      );
      setGivens(cloneGrid(preset.board));
      setUserEntries(createEmptyGrid(preset.size));
      setSolution(null);
      setActiveHint(null);
      setSolveMeta(null);
      setCageEditMode(false);
      setDraftCageCells([]);
      setUploadedImageDataUrl(null);
      setGridRect(null);
      setDetectedCount(0);
      setSelectedCell([0, 0]);
      if (preset.size >= 12) setShowCandidates(false);
      onToast(`Contoh "${preset.label}" dimuat.`);
    },
    [onToast]
  );

  const symbolsList = useMemo(
    () => Array.from({ length: size }, (_, i) => i + 1),
    [size]
  );

  const boardMaxWidthClass =
    size >= 16
      ? 'max-w-[560px]'
      : size >= 12
        ? 'max-w-[520px]'
        : 'max-w-[476px]';

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

      {/* LEFT COLUMN: Variant/Size Bar + Interactive Multi-Size Board + Actions + Keypad */}
      <section className="lg:col-span-7 flex flex-col items-center gap-3 w-full">
        {/* Variant & Size Selector Strip */}
        <div
          className={`w-full ${boardMaxWidthClass} bg-slate-900/90 border border-white/10 rounded-2xl p-2.5 flex flex-wrap items-center justify-between gap-2`}
        >
          <div className="flex items-center gap-1 bg-slate-950/70 p-1 rounded-xl border border-white/10">
            <button
              type="button"
              data-testid="sudoku-variant-classic"
              aria-pressed={variant === 'classic'}
              onClick={() => switchVariant('classic')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                variant === 'classic'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Klasik
            </button>
            <button
              type="button"
              data-testid="sudoku-variant-killer"
              aria-pressed={variant === 'killer'}
              onClick={() => switchVariant('killer')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                variant === 'killer'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Killer Sudoku
            </button>
          </div>

          <div
            role="group"
            aria-label="Pilih ukuran papan Sudoku"
            className="flex flex-wrap items-center gap-1"
          >
            {SUPPORTED_SUDOKU_SIZES.map((sz) => {
              const disabledForKiller = variant === 'killer' && sz > 9;
              return (
                <button
                  key={sz}
                  type="button"
                  data-testid={`sudoku-size-${sz}`}
                  disabled={disabledForKiller}
                  aria-pressed={size === sz}
                  onClick={() => switchSize(sz)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-bold border transition disabled:opacity-30 ${
                    size === sz
                      ? 'bg-sky-500/25 border-sky-400/70 text-sky-100'
                      : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {sz}×{sz}
                </button>
              );
            })}
          </div>
        </div>

        {/* Board Card */}
        <div
          className={`w-full ${boardMaxWidthClass} bg-slate-900/90 border border-white/10 rounded-2xl p-2.5 sm:p-4 shadow-2xl`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Grid3X3 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              <span data-testid="sudoku-board-title">
                {variant === 'killer'
                  ? `Killer Sudoku ${size}×${size}`
                  : `Papan Sudoku ${size}×${size}`}
                {size >= 12 ? ` (1–${digitToSymbol(size)})` : ''}
              </span>
              {boxRows !== boxCols && (
                <button
                  type="button"
                  data-testid="sudoku-box-toggle"
                  onClick={toggleBoxOrientation}
                  title="Ubah orientasi blok kotak (misal 2×3 ↔ 3×2)"
                  className="px-2 py-0.5 rounded-md bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/40 text-[11px] font-bold text-sky-200 transition"
                >
                  Kotak {boxRows}×{boxCols} ⇄
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] font-semibold">
              {variant === 'killer' && (
                <span
                  data-testid="sudoku-cage-count"
                  className="text-amber-300"
                >
                  {activeCages.length} sangkar
                </span>
              )}
              <span className="text-slate-400">
                Terisi:{' '}
                <strong
                  data-testid="sudoku-filled-count"
                  className={isComplete ? 'text-emerald-400' : 'text-white'}
                >
                  {filledCount}/{totalCells}
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

          {/* Dynamic N x N Grid */}
          <div
            data-testid="sudoku-board"
            data-size={size}
            data-box-rows={boxRows}
            data-box-cols={boxCols}
            data-variant={variant}
            role="grid"
            aria-label={`Papan Sudoku ${size} kali ${size}`}
            className={`w-full aspect-square grid ${GRID_TEMPLATE_CLASSES[size]} bg-slate-950 border-2 border-slate-500/85 rounded-xl overflow-hidden select-none`}
          >
            {displayGrid.map((rowVals, r) =>
              rowVals.map((val, c) => {
                const key = `${r},${c}`;
                const isGiven = (givens[r]?.[c] ?? 0) !== 0;
                const isHintOrUser = !isGiven && (userEntries[r]?.[c] ?? 0) !== 0;
                const isAutoSolved =
                  !isGiven && !isHintOrUser && solution !== null && val !== 0;
                const isSelected =
                  selectedCell !== null &&
                  selectedCell[0] === r &&
                  selectedCell[1] === c;
                const isDraftCell =
                  cageEditMode && draftCageCells.includes(key);
                const isPeer =
                  !cageEditMode &&
                  selectedCell !== null &&
                  !isSelected &&
                  (selectedCell[0] === r ||
                    selectedCell[1] === c ||
                    (Math.floor(selectedCell[0] / boxRows) ===
                      Math.floor(r / boxRows) &&
                      Math.floor(selectedCell[1] / boxCols) ===
                        Math.floor(c / boxCols)));
                const isSameDigit =
                  !cageEditMode &&
                  selectedValue !== 0 &&
                  val === selectedValue &&
                  !isSelected;
                const isConflict = conflicts.has(key);
                const isActiveHintCell =
                  activeHint !== null &&
                  activeHint.row === r &&
                  activeHint.col === c;

                const borderRight =
                  c === size - 1
                    ? ''
                    : c % boxCols === boxCols - 1
                      ? 'border-r-2 border-r-slate-400/85'
                      : 'border-r border-r-slate-800';
                const borderBottom =
                  r === size - 1
                    ? ''
                    : r % boxRows === boxRows - 1
                      ? 'border-b-2 border-b-slate-400/85'
                      : 'border-b border-b-slate-800';

                // Killer cage borders & tint
                const cage = variant === 'killer' ? cellToCage.get(key) : undefined;
                const cageHead =
                  variant === 'killer' ? cageHeadMap.get(key) : undefined;
                const cageTint =
                  cage !== undefined
                    ? CAGE_TINT_CLASSES[cageColorIdx.get(cage.id) ?? 0]
                    : '';

                let bgClass = cageTint || 'bg-slate-900/75';
                if (isConflict) {
                  bgClass = 'bg-rose-500/25 hover:bg-rose-500/35';
                } else if (isDraftCell) {
                  bgClass = 'bg-amber-500/30 ring-2 ring-inset ring-amber-400';
                } else if (isSelected) {
                  bgClass = 'bg-sky-500/30 ring-2 ring-inset ring-sky-400';
                } else if (isActiveHintCell) {
                  bgClass =
                    'bg-amber-500/20 ring-2 ring-inset ring-amber-400/80';
                } else if (isSameDigit) {
                  bgClass = 'bg-emerald-500/20';
                } else if (isPeer) {
                  bgClass = cageTint
                    ? `${cageTint} brightness-125`
                    : 'bg-slate-800/65';
                } else {
                  bgClass = `${bgClass} hover:bg-slate-800/85`;
                }

                let textClass = 'text-white font-extrabold';
                if (isConflict) {
                  textClass = 'text-rose-300 font-extrabold';
                } else if (isHintOrUser) {
                  textClass = 'text-sky-300 font-bold';
                } else if (isAutoSolved) {
                  textClass = 'text-emerald-400 font-bold';
                }

                const cageWallTop =
                  cage && cellToCage.get(`${r - 1},${c}`)?.id !== cage.id;
                const cageWallBot =
                  cage && cellToCage.get(`${r + 1},${c}`)?.id !== cage.id;
                const cageWallLeft =
                  cage && cellToCage.get(`${r},${c - 1}`)?.id !== cage.id;
                const cageWallRight =
                  cage && cellToCage.get(`${r},${c + 1}`)?.id !== cage.id;

                const canShowCands = showCandidates && size <= 9 && val === 0;
                const cellCandidates = canShowCands
                  ? getCellCandidates(workingGrid, r, c, {
                      size,
                      boxDims: resolvedBoxDims,
                      cages: activeCages,
                    })
                  : [];

                const sym = digitToSymbol(val);

                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    data-row={r}
                    data-col={c}
                    data-val={val}
                    data-sym={sym}
                    data-cage-id={cage?.id ?? ''}
                    data-cage-sum={cageHead ? cageHead.sum : ''}
                    data-kind={
                      isGiven
                        ? 'given'
                        : isHintOrUser
                          ? 'hint'
                          : isAutoSolved
                            ? 'solved'
                            : 'empty'
                    }
                    aria-label={`Baris ${r + 1} Kolom ${c + 1}${sym ? ` simbol ${sym}` : ' kosong'}${cageHead && cageHead.sum > 0 ? ` sangkar jumlah ${cageHead.sum}` : ''}`}
                    onClick={() => {
                      setSelectedCell([r, c]);
                      if (cageEditMode && variant === 'killer') {
                        setDraftCageCells((prev) =>
                          prev.includes(key)
                            ? prev.filter((k) => k !== key)
                            : [...prev, key]
                        );
                      }
                    }}
                    className={`relative flex items-center justify-center focus:outline-none transition-colors ${borderRight} ${borderBottom} ${bgClass}`}
                  >
                    {/* Killer dashed cage inner frame */}
                    {cage && (
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-[2px] border-sky-300/65 ${
                          cageWallTop ? 'border-t border-dashed' : ''
                        } ${cageWallBot ? 'border-b border-dashed' : ''} ${
                          cageWallLeft ? 'border-l border-dashed' : ''
                        } ${cageWallRight ? 'border-r border-dashed' : ''}`}
                      />
                    )}

                    {/* Killer cage sum badge in top-left corner of cage head */}
                    {cageHead && cageHead.sum > 0 && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-[2px] left-[3px] text-[8px] sm:text-[10px] leading-none font-bold text-amber-300 bg-slate-950/75 px-0.5 rounded-sm z-10 tabular-nums"
                      >
                        {cageHead.sum}
                      </span>
                    )}

                    {val !== 0 ? (
                      <span
                        className={`${CELL_TEXT_CLASSES[size]} leading-none tabular-nums ${textClass} ${
                          variant === 'killer' ? 'translate-y-[2px]' : ''
                        }`}
                      >
                        {sym}
                      </span>
                    ) : canShowCands && cellCandidates.length > 0 ? (
                      <span className="grid grid-cols-3 grid-rows-3 w-full h-full p-0.5 text-[8px] sm:text-[9px] leading-none text-slate-400 font-medium">
                        {symbolsList.map((d) => (
                          <span
                            key={d}
                            className="flex items-center justify-center"
                          >
                            {cellCandidates.includes(d) ? digitToSymbol(d) : ''}
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
              {size >= 12
                ? `Ketik 1–9, A–${digitToSymbol(size)} / panah`
                : `Ketik 1–${size} / panah untuk edit`}
            </span>
          </div>
        </div>

        {/* Primary Action Buttons */}
        <div className={`w-full ${boardMaxWidthClass} grid grid-cols-2 gap-2`}>
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
        <div className={`w-full ${boardMaxWidthClass} grid grid-cols-3 gap-1.5`}>
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

        {/* Dynamic On-Screen Keypad (1..size + Erase) */}
        <div
          className={`w-full ${boardMaxWidthClass} grid ${
            size >= 12
              ? 'grid-cols-6 sm:grid-cols-9'
              : size <= 6
                ? 'grid-cols-4 sm:grid-cols-7'
                : 'grid-cols-5 sm:grid-cols-10'
          } gap-1.5`}
        >
          {symbolsList.map((digit) => (
            <button
              key={digit}
              type="button"
              disabled={!selectedCell || cageEditMode}
              onClick={() => {
                if (selectedCell) {
                  setCellDigit(selectedCell[0], selectedCell[1], digit);
                }
              }}
              className="py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 active:scale-95 disabled:opacity-40 border border-white/10 text-sm font-bold text-white transition"
            >
              {digitToSymbol(digit)}
            </button>
          ))}
          <button
            type="button"
            disabled={!selectedCell || cageEditMode}
            aria-label="Hapus simbol pada sel terpilih"
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

      {/* RIGHT COLUMN: Status & Hint, Killer Cage Editor, Screenshot Scanner, Presets */}
      <section className="lg:col-span-5 flex flex-col gap-4 w-full">
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

            {size <= 9 && (
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
            )}
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
                  {variant === 'killer' ? 'Killer Sudoku' : 'Sudoku'} {size}×
                  {size} Terselesaikan ({totalCells}/{totalCells} Sel Valid)
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
              Unggah screenshot Sudoku ukuran apa saja (4×4, 6×6, 8×8, 9×9,
              12×12, 16×16, atau Killer Sudoku) untuk deteksi otomatis, lalu
              klik <strong className="text-emerald-300">Solve Semua</strong>.
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
                  <strong>{activeHint.symbol}</strong>
                </span>
              </div>
              <p className="text-xs text-slate-200 leading-relaxed">
                {activeHint.reason}
              </p>
            </div>
          )}
        </div>

        {/* Killer Sudoku Cage Editor (shown in Killer mode) */}
        {variant === 'killer' && (
          <div
            data-testid="killer-cage-editor"
            className="bg-slate-900/90 border border-amber-400/25 rounded-2xl p-4 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                <Layers className="w-4 h-4" aria-hidden="true" />
                <span>Editor Sangkar Killer</span>
              </h2>
              <button
                type="button"
                aria-pressed={cageEditMode}
                onClick={() => {
                  setCageEditMode((v) => !v);
                  setDraftCageCells([]);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                  cageEditMode
                    ? 'bg-amber-400 text-slate-950 border-amber-300'
                    : 'bg-white/5 text-amber-200 border-amber-400/35 hover:bg-amber-400/15'
                }`}
              >
                {cageEditMode ? 'Selesai Pilih Sel' : '+ Buat Sangkar'}
              </button>
            </div>

            {cageEditMode ? (
              <div className="flex flex-col gap-2.5 text-xs">
                <p className="text-slate-300">
                  Klik beberapa sel di papan untuk memilih anggota sangkar (
                  <strong className="text-amber-300">
                    {draftCageCells.length} sel terpilih
                  </strong>
                  ), lalu isi target jumlahnya:
                </p>
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor="draft-cage-sum">
                    Jumlah sangkar baru
                  </label>
                  <input
                    id="draft-cage-sum"
                    type="number"
                    min={1}
                    max={45}
                    value={draftCageSum}
                    onChange={(e) => setDraftCageSum(e.target.value)}
                    placeholder="Jumlah"
                    className="w-24 px-3 py-1.5 rounded-lg bg-slate-950 border border-white/15 text-white text-xs font-bold focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={handleSaveDraftCage}
                    className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold flex items-center gap-1 transition"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    Simpan Sangkar
                  </button>
                </div>
              </div>
            ) : selectedCage ? (
              <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/60 border border-white/10 rounded-xl p-2.5 text-xs">
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-white">
                    Sangkar Terpilih ({selectedCage.cells.length} sel)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Ubah jumlah sangkar jika hasil scan kurang tepat
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <label
                    htmlFor="selected-cage-sum"
                    className="text-[11px] text-slate-400"
                  >
                    Jumlah:
                  </label>
                  <input
                    id="selected-cage-sum"
                    type="number"
                    min={0}
                    max={45}
                    value={selectedCage.sum || ''}
                    onChange={(e) =>
                      handleUpdateSelectedCageSum(
                        selectedCage.id,
                        e.target.value
                      )
                    }
                    className="w-16 px-2 py-1 rounded-lg bg-slate-900 border border-amber-400/40 text-amber-200 text-xs font-bold text-center focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveSelectedCage(selectedCage.id)}
                    className="px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-rose-200 text-[11px] font-semibold transition"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Klik sel di papan untuk mengedit jumlah sangkarnya, atau klik{' '}
                <strong className="text-amber-300">+ Buat Sangkar</strong> untuk
                menambahkan sangkar Killer secara manual.
              </p>
            )}
          </div>
        )}

        {/* Screenshot Scanner Dropzone + Auto/Manual Size Selector + Preview */}
        <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <ScanLine className="w-4 h-4 text-sky-400" aria-hidden="true" />
              <span>Scan Screenshot Sudoku</span>
            </h2>

            <div className="flex items-center gap-1.5">
              <label htmlFor="sudoku-scan-mode" className="sr-only">
                Mode deteksi ukuran scan
              </label>
              <select
                id="sudoku-scan-mode"
                data-testid="sudoku-scan-mode"
                value={scanMode}
                onChange={(e) => {
                  const next = e.target.value as ScanModeChoice;
                  setScanMode(next);
                  if (uploadedImageDataUrl) handleRescan(next);
                }}
                className="px-2 py-1 rounded-lg bg-slate-950 border border-white/15 text-[11px] font-semibold text-slate-200 focus:outline-none focus:border-sky-400"
              >
                <option value="auto">Auto Deteksi</option>
                <option value="classic-4">4×4 Klasik</option>
                <option value="classic-6">6×6 Klasik</option>
                <option value="classic-8">8×8 Klasik</option>
                <option value="classic-9">9×9 Klasik</option>
                <option value="killer-9">Killer 9×9</option>
                <option value="classic-12">12×12 (1–C)</option>
                <option value="classic-16">16×16 (1–G)</option>
              </select>

              {uploadedImageDataUrl && (
                <button
                  type="button"
                  onClick={() => handleRescan()}
                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-sky-300 transition"
                >
                  Scan Ulang
                </button>
              )}
            </div>
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
            className={`w-full rounded-xl border-2 border-dashed p-3.5 text-center transition flex flex-col items-center justify-center gap-1.5 ${
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
              Deteksi otomatis 4×4, 6×6, 8×8, 9×9, 12×12, 16×16 (1–G) &amp;
              Killer Sudoku
            </span>
          </button>

          {uploadedImageDataUrl && (
            <div className="flex items-start gap-3 bg-slate-950/70 border border-white/10 rounded-xl p-3">
              <div className="relative w-24 shrink-0 rounded-lg overflow-hidden border border-white/15 bg-slate-900">
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
                  {variant === 'killer'
                    ? `Killer Sudoku ${size}×${size}`
                    : `Sudoku ${size}×${size}`}
                </span>
                <span className="text-emerald-300 font-semibold">
                  {detectedCount} simbol terdeteksi
                  {variant === 'killer' ? ` · ${cages.length} sangkar` : ''}
                </span>
                <span className="text-[11px] text-slate-400 leading-relaxed">
                  Kotak hijau menandai area grid terdeteksi. Klik sel pada papan
                  jika perlu koreksi manual.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Sample Presets (4x4, 6x6, 9x9, Killer 9x9, 16x16) */}
        <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-4 flex flex-col gap-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Contoh Soal Cepat
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SUDOKU_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                data-testid={`preset-${preset.key}`}
                onClick={() => handleLoadPreset(preset)}
                className="py-2 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left flex flex-col gap-0.5 transition"
              >
                <span className="text-xs font-bold text-white">
                  {preset.label}
                </span>
                <span className="text-[11px] text-slate-400 truncate">
                  {preset.variant === 'killer'
                    ? `${preset.cages?.length ?? 0} sangkar`
                    : `${countFilledCells(preset.board)} simbol awal`}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};
