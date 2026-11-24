import React, { useState } from 'react';
import {
  Upload,
  Eye,
  EyeOff,
  ArrowLeftRight,
  RefreshCw,
  Circle,
} from 'lucide-react';

interface ScanTabProps {
  hasUploadedImage: boolean;
  detectedTargets: number;
  detectedThinTargets: number;
  detectedWalls: number;
  showImageOverlay: boolean;
  onToggleImageOverlay: () => void;
  onSwapTargetWall: () => void;
  detectSensitivity: number;
  onChangeSensitivity: (value: number) => void;
  overlayAlphaPercent: number;
  onChangeOverlayAlpha: (percent: number) => void;
  ignoreStatusBars: boolean;
  onChangeIgnoreStatusBars: (checked: boolean) => void;
  onRescan: () => void;
  ballRadius: number;
  onChangeBallRadius: (radius: number) => void;
  onTriggerFilePicker: () => void;
  onFileDropped: (file: File) => void;
}

export const ScanTab: React.FC<ScanTabProps> = ({
  hasUploadedImage,
  detectedTargets,
  detectedThinTargets,
  detectedWalls,
  showImageOverlay,
  onToggleImageOverlay,
  onSwapTargetWall,
  detectSensitivity,
  onChangeSensitivity,
  overlayAlphaPercent,
  onChangeOverlayAlpha,
  ignoreStatusBars,
  onChangeIgnoreStatusBars,
  onRescan,
  ballRadius,
  onChangeBallRadius,
  onTriggerFilePicker,
  onFileDropped,
}) => {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 sm:p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-white leading-tight">
            Scan Screenshot Level Okay?
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Unggah atau tempel (Ctrl+V) screenshot dari HP untuk mendeteksi
            balok putih dan dinding hitam secara otomatis.
          </p>
        </div>

        {/* Restored DropZone */}
        <button
          type="button"
          data-testid="upload-dropzone"
          onClick={onTriggerFilePicker}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) onFileDropped(file);
          }}
          className={`w-full rounded-2xl border-2 border-dashed p-6 flex flex-col items-center justify-center text-center gap-2 transition cursor-pointer ${
            dragOver
              ? 'border-emerald-400 bg-emerald-500/15'
              : 'border-white/15 bg-slate-950/60 hover:border-sky-400/50 hover:bg-slate-950/80'
          }`}
        >
          <div className="w-11 h-11 rounded-xl bg-sky-500/15 text-sky-300 flex items-center justify-center">
            <Upload className="w-5 h-5" aria-hidden="true" />
          </div>
          <p className="text-sm font-bold text-white">
            Klik untuk pilih screenshot atau tarik file ke sini
          </p>
          <p className="text-xs text-slate-400">
            Mendukung PNG, JPG, WebP · Bisa juga tekan Ctrl+V langsung dari
            clipboard
          </p>
        </button>

        {/* Image Calibration Panel */}
        <div
          className={`pt-4 border-t border-white/10 space-y-4 ${
            hasUploadedImage ? '' : 'opacity-65'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-white">
                Kalibrasi Deteksi Gambar
              </p>
              <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                {hasUploadedImage
                  ? `Terdeteksi: ${detectedTargets} Target Putih${detectedThinTargets > 0 ? ` (${detectedThinTargets} Benang Nembus)` : ''} · ${detectedWalls} Dinding Hitam`
                  : 'Unggah screenshot terlebih dahulu untuk mengaktifkan deteksi'}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!hasUploadedImage}
                onClick={onToggleImageOverlay}
                aria-pressed={showImageOverlay}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 transition ${
                  showImageOverlay
                    ? 'bg-sky-500/20 border-sky-400/60 text-sky-200'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                }`}
              >
                {showImageOverlay ? (
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>Overlay: {showImageOverlay ? 'ON' : 'OFF'}</span>
              </button>
              <button
                type="button"
                disabled={!hasUploadedImage}
                onClick={onSwapTargetWall}
                className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap transition"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Tukar Warna</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1.5">
                <label htmlFor="sliderSens">Sensitivitas Deteksi</label>
                <span className="font-mono text-emerald-300 tabular-nums">
                  {detectSensitivity}
                </span>
              </div>
              <input
                id="sliderSens"
                type="range"
                min={14}
                max={95}
                value={detectSensitivity}
                disabled={!hasUploadedImage}
                onChange={(e) => onChangeSensitivity(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-lg cursor-pointer disabled:opacity-40"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1.5">
                <label htmlFor="sliderOverlayAlpha">
                  Transparansi Foto Asli
                </label>
                <span className="font-mono text-emerald-300 tabular-nums">
                  {overlayAlphaPercent}%
                </span>
              </div>
              <input
                id="sliderOverlayAlpha"
                type="range"
                min={0}
                max={85}
                value={overlayAlphaPercent}
                disabled={!hasUploadedImage}
                onChange={(e) => onChangeOverlayAlpha(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-lg cursor-pointer disabled:opacity-40"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={ignoreStatusBars}
                onChange={(e) => onChangeIgnoreStatusBars(e.target.checked)}
                className="rounded border-slate-600 bg-slate-800 accent-emerald-500"
              />
              <span>Abaikan status bar atas & bawah HP (5%)</span>
            </label>

            <button
              type="button"
              disabled={!hasUploadedImage}
              onClick={onRescan}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-sky-300 disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap transition"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Scan Ulang</span>
            </button>
          </div>
        </div>

        {/* Physics Ball Radius Setting */}
        <div className="pt-4 border-t border-white/10 space-y-1.5">
          <div className="flex justify-between text-xs text-slate-300">
            <label
              htmlFor="sliderBallSize"
              className="flex items-center gap-1.5"
            >
              <Circle className="w-3.5 h-3.5 text-sky-300" aria-hidden="true" />
              <span>Ukuran Bola Fisika (kecilkan jika celah sangat sempit)</span>
            </label>
            <span className="font-mono text-sky-300 tabular-nums">
              {ballRadius.toFixed(1)} px
            </span>
          </div>
          <input
            id="sliderBallSize"
            type="range"
            min={3.5}
            max={9.0}
            step={0.1}
            value={ballRadius}
            onChange={(e) => onChangeBallRadius(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-700 rounded-lg cursor-pointer"
          />
        </div>
      </section>
    </div>
  );
};
