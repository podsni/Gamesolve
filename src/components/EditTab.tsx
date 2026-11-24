import React from 'react';
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Crosshair,
  Copy,
  Trash2,
  ArrowLeftRight,
  FlipHorizontal2,
} from 'lucide-react';
import { ShapeType } from '../engine/types';

export interface SelectedShapeInfo {
  id: number;
  kindLabel: string;
  roleLabel: string;
  type: ShapeType;
  passThrough: boolean;
  cx: number;
  cy: number;
}

interface EditTabProps {
  snapToGrid: boolean;
  onChangeSnapToGrid: (checked: boolean) => void;
  selectedShape: SelectedShapeInfo | null;
  onAddRectTarget: () => void;
  onAddThinTarget: () => void;
  onAddTriTarget: () => void;
  onAddRectWall: () => void;
  onAddTriWall: () => void;
  onFlipType: () => void;
  onTogglePassThrough: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onNudge: (dx: number, dy: number) => void;
  onCenterShape: () => void;
  onRotate: (deg: number) => void;
  onScale: (factor: number) => void;
  onMirrorX: () => void;
  onClearAll: () => void;
}

export const EditTab: React.FC<EditTabProps> = ({
  snapToGrid,
  onChangeSnapToGrid,
  selectedShape,
  onAddRectTarget,
  onAddThinTarget,
  onAddTriTarget,
  onAddRectWall,
  onAddTriWall,
  onFlipType,
  onTogglePassThrough,
  onDuplicate,
  onDelete,
  onNudge,
  onCenterShape,
  onRotate,
  onScale,
  onMirrorX,
  onClearAll,
}) => {
  return (
    <div className="flex flex-col gap-4">
      <section className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            <h2 className="text-sm font-bold text-white leading-tight">
              Editor Posisi & Bentuk Presisi
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Pilih balok di kanvas untuk menggeser, atau tarik titik hijau di
              atasnya untuk memutar.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 self-start sm:self-center shrink-0 bg-slate-950/70 border border-white/10 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-200 cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={(e) => onChangeSnapToGrid(e.target.checked)}
              className="rounded border-slate-600 bg-slate-800 accent-emerald-500"
            />
            <span>Snap Grid (5px)</span>
          </label>
        </div>

        {/* Add Shapes Palette */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <button
            type="button"
            onClick={onAddRectTarget}
            className="py-2.5 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white flex items-center justify-center gap-1.5 whitespace-nowrap transition"
          >
            <span className="w-3 h-3 bg-white rounded-[2px] inline-block shrink-0" />
            <span>+ Kotak Putih</span>
          </button>
          <button
            type="button"
            onClick={onAddThinTarget}
            className="py-2.5 px-2.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-400/30 text-xs font-semibold text-sky-100 flex items-center justify-center gap-1.5 whitespace-nowrap transition"
            title="Garis putih tipis yang tembus saat terkena bola"
          >
            <span className="w-3.5 h-[2px] bg-white inline-block shrink-0" />
            <span>+ Benang Putih</span>
          </button>
          <button
            type="button"
            onClick={onAddTriTarget}
            className="py-2.5 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white flex items-center justify-center gap-1.5 whitespace-nowrap transition"
          >
            <span aria-hidden="true">◢</span>
            <span>+ Segitiga Putih</span>
          </button>
          <button
            type="button"
            onClick={onAddRectWall}
            className="py-2.5 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 whitespace-nowrap transition"
          >
            <span className="w-3 h-3 bg-slate-950 border border-slate-400 rounded-[2px] inline-block shrink-0" />
            <span>+ Dinding Hitam</span>
          </button>
          <button
            type="button"
            onClick={onAddTriWall}
            className="py-2.5 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 whitespace-nowrap transition"
          >
            <span className="text-slate-400" aria-hidden="true">
              ◢
            </span>
            <span>+ Segitiga Hitam</span>
          </button>
        </div>

        {/* Selected Shape Inspector */}
        <div className="bg-slate-950/60 border border-white/10 rounded-xl p-4">
          {!selectedShape ? (
            <p className="text-center py-3 text-xs text-slate-400 leading-relaxed">
              Belum ada bentuk terpilih. Ketuk salah satu bentuk di kanvas atau
              tambahkan bentuk baru di atas untuk mengatur posisi, rotasi, dan
              ukurannya secara presisi.
            </p>
          ) : (
            <div data-testid="shape-inspector" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-emerald-300">
                    {selectedShape.kindLabel} ({selectedShape.roleLabel})
                  </span>
                  <span className="text-slate-500" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono text-slate-300 tabular-nums">
                    X: {Math.round(selectedShape.cx)}, Y:{' '}
                    {Math.round(selectedShape.cy)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedShape.type === 'target' && (
                    <button
                      type="button"
                      onClick={onTogglePassThrough}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap transition ${
                        selectedShape.passThrough
                          ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                          : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-200'
                      }`}
                      title="Ubah antara Nembus (benang tipis) dan Pantul (balok padat)"
                    >
                      {selectedShape.passThrough ? 'Mode: Nembus' : 'Mode: Pantul'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onFlipType}
                    className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white flex items-center gap-1 whitespace-nowrap transition"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Putih/Hitam</span>
                  </button>
                  <button
                    type="button"
                    onClick={onDuplicate}
                    className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-sky-300 flex items-center gap-1 whitespace-nowrap transition"
                  >
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Duplikat</span>
                  </button>
                  <button
                    type="button"
                    onClick={onDelete}
                    className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 border border-white/10 text-xs font-semibold text-rose-300 flex items-center gap-1 whitespace-nowrap transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Hapus</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                {/* D-Pad Nudge */}
                <div className="flex flex-col items-center gap-1.5 py-2">
                  <span className="text-[11px] font-semibold text-slate-400 mb-0.5">
                    Geser Halus (2px · Panah keyboard)
                  </span>
                  <button
                    type="button"
                    aria-label="Geser ke atas"
                    onClick={() => onNudge(0, -2)}
                    className="w-10 h-9 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-white flex items-center justify-center transition"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="Geser ke kiri"
                      onClick={() => onNudge(-2, 0)}
                      className="w-10 h-9 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-white flex items-center justify-center transition"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Pusatkan ke tengah kanvas"
                      onClick={onCenterShape}
                      className="w-10 h-9 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/40 text-emerald-300 flex items-center justify-center transition"
                      title="Tengah Kanvas"
                    >
                      <Crosshair className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Geser ke kanan"
                      onClick={() => onNudge(2, 0)}
                      className="w-10 h-9 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-white flex items-center justify-center transition"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label="Geser ke bawah"
                    onClick={() => onNudge(0, 2)}
                    className="w-10 h-9 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-white flex items-center justify-center transition"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                </div>

                {/* Rotate & Scale */}
                <div className="space-y-3">
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 block mb-1.5">
                      Putar Presisi
                    </span>
                    <div className="grid grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={() => onRotate(-15)}
                        className="py-2 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-mono font-bold text-white transition"
                      >
                        -15°
                      </button>
                      <button
                        type="button"
                        onClick={() => onRotate(-1)}
                        className="py-2 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-mono font-bold text-white transition"
                      >
                        -1°
                      </button>
                      <button
                        type="button"
                        onClick={() => onRotate(1)}
                        className="py-2 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-mono font-bold text-white transition"
                      >
                        +1°
                      </button>
                      <button
                        type="button"
                        onClick={() => onRotate(15)}
                        className="py-2 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-mono font-bold text-white transition"
                      >
                        +15°
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 block mb-1.5">
                      Ukuran & Cermin
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => onScale(0.92)}
                        className="py-2 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-semibold text-white transition"
                      >
                        − Kecil
                      </button>
                      <button
                        type="button"
                        onClick={() => onScale(1.08)}
                        className="py-2 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-semibold text-white transition"
                      >
                        + Besar
                      </button>
                      <button
                        type="button"
                        onClick={onMirrorX}
                        className="py-2 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-semibold text-sky-300 flex items-center justify-center gap-1 transition"
                      >
                        <FlipHorizontal2
                          className="w-3.5 h-3.5"
                          aria-hidden="true"
                        />
                        <span>Balik</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClearAll}
            className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-rose-500/20 border border-white/10 text-xs font-semibold text-rose-300 hover:text-rose-200 flex items-center gap-1.5 transition"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Bersihkan Semua Bentuk</span>
          </button>
        </div>
      </section>
    </div>
  );
};
