import React from 'react';
import {
  Play,
  SlidersHorizontal,
  ShieldCheck,
  GitBranch,
  Layers,
  Crosshair,
} from 'lucide-react';
import {
  AnalyzedSolution,
  LOGICAL_H,
  LOGICAL_W,
  PresetDefinition,
} from '../engine/types';
import { angleToCompassText, normalizeAngleDeg } from '../engine/geometry';

interface SolveTabProps {
  presets: PresetDefinition[];
  activePresetKey: string | null;
  onSelectPreset: (key: string) => void;
  solutions: AnalyzedSolution[];
  activeSolutionIdx: number;
  solutionShot: AnalyzedSolution | null;
  onSelectSolution: (index: number) => void;
  showSafeZone: boolean;
  onToggleSafeZone: () => void;
  showAltPaths: boolean;
  onToggleAltPaths: () => void;
  fineX: number;
  fineY: number;
  fineAng: number;
  fineBlocked: boolean;
  onFineTuneChange: (x: number, y: number, angDeg: number) => void;
  onAnalyzeFineTune: () => void;
  onFireFineTune: () => void;
  totalTargets: number;
  solving: boolean;
}

export const SolveTab: React.FC<SolveTabProps> = ({
  presets,
  activePresetKey,
  onSelectPreset,
  solutions,
  activeSolutionIdx,
  solutionShot,
  onSelectSolution,
  showSafeZone,
  onToggleSafeZone,
  showAltPaths,
  onToggleAltPaths,
  fineX,
  fineY,
  fineAng,
  fineBlocked,
  onFineTuneChange,
  onAnalyzeFineTune,
  onFireFineTune,
  totalTargets,
  solving,
}) => {
  const solvedCount = solutions.filter((s) => s.solved).length;
  const sim = solutionShot?.simResult ?? null;
  const analysis = solutionShot?.analysis ?? null;

  const deg = sim ? normalizeAngleDeg(sim.angle) : null;
  const startPctX = sim ? Math.round((sim.sx / LOGICAL_W) * 100) : null;
  const startPctY = sim ? Math.round((sim.sy / LOGICAL_H) * 100) : null;

  const activePreset = presets.find((p) => p.key === activePresetKey);

  const statusText = fineBlocked
    ? 'Titik Tertutup Balok'
    : sim
      ? sim.solved
        ? 'Solved 100%'
        : `Parsial ${sim.targetsHit}/${sim.totalTargets}`
      : activePreset
        ? activePreset.name
        : 'Siap di-Solve';

  const statusColor = fineBlocked
    ? 'text-rose-300'
    : sim?.solved
      ? 'text-emerald-300'
      : sim
        ? 'text-amber-300'
        : 'text-slate-300';

  const getScoreBarColor = (score: number) => {
    if (score >= 78) return 'bg-emerald-400';
    if (score >= 60) return 'bg-sky-400';
    if (score >= 42) return 'bg-amber-400';
    return 'bg-rose-400';
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Multi-Solution Picker & Comparison */}
      {solutions.length > 0 && (
        <section
          aria-label="Pilihan solusi"
          className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 sm:p-5 space-y-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-white leading-tight">
                Pilihan Solusi & Analisis Termudah
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {solvedCount > 0
                  ? `${solvedCount} jalur solusi dianalisis · Diurutkan dari yang paling mudah ditiru`
                  : `${solutions.length} kandidat terbaik · Pilih untuk menyempurnakan`}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleSafeZone}
                aria-pressed={showSafeZone}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap border transition ${
                  showSafeZone
                    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Zona Aman</span>
              </button>
              <button
                type="button"
                onClick={onToggleAltPaths}
                aria-pressed={showAltPaths}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap border transition ${
                  showAltPaths
                    ? 'bg-sky-500/20 border-sky-400/60 text-sky-200'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Semua Jalur</span>
              </button>
            </div>
          </div>

          <div
            data-testid="solutions-list"
            className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[260px] overflow-y-auto pr-0.5"
          >
            {solutions.map((sol, idx) => {
              const a = sol.analysis;
              const sDeg = normalizeAngleDeg(sol.angle);
              const isActive = idx === activeSolutionIdx;
              const score = a?.easeScore ?? 0;

              return (
                <button
                  key={`${sol.sx.toFixed(1)}-${sol.sy.toFixed(1)}-${idx}`}
                  type="button"
                  onClick={() => onSelectSolution(idx)}
                  aria-pressed={isActive}
                  className={`text-left p-3 rounded-xl border transition flex flex-col gap-2 ${
                    isActive
                      ? 'bg-emerald-500/15 border-emerald-400/75 shadow-sm'
                      : 'bg-slate-950/60 border-white/10 hover:border-white/25 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white">
                      Solusi #{idx + 1}
                    </span>
                    <span
                      className={`text-[11px] font-semibold ${
                        idx === 0 && sol.solved
                          ? 'text-emerald-300'
                          : 'text-slate-400'
                      }`}
                    >
                      {sol.badges[0] ?? a?.tierLabel ?? 'Kandidat'}
                    </span>
                  </div>

                  {a && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${getScoreBarColor(score)}`}
                          style={{ width: `${score}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono font-semibold text-slate-200 tabular-nums">
                        {score}/100
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-300 tabular-nums pt-0.5 border-t border-white/5">
                    <span>
                      Sudut{' '}
                      <strong className="text-emerald-300">
                        ±{(a?.angleTolDeg ?? 0).toFixed(1)}°
                      </strong>
                    </span>
                    <span>
                      Posisi{' '}
                      <strong className="text-sky-300">
                        ±{(a?.posTolPx ?? 0).toFixed(0)}px
                      </strong>
                    </span>
                    <span>
                      <strong className="text-slate-100">
                        {sol.simResult.bounces}x
                      </strong>{' '}
                      pantul
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span>
                      {angleToCompassText(sDeg)} ({sDeg.toFixed(0)}°)
                    </span>
                    <span className="text-emerald-300 font-semibold">
                      {isActive ? 'Aktif' : 'Pilih'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Active Solution Summary, Ease Analysis & Precision Shot Fine-Tuner */}
      <section className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white leading-tight">
              Ringkasan & Analisis Solusi Aktif
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Panduan titik mulai, sudut bidik, dan margin toleransi aman
            </p>
          </div>
          <span
            data-testid="solution-status"
            className={`text-xs font-bold font-mono tabular-nums ${statusColor}`}
          >
            {statusText}
          </span>
        </div>

        {/* Ease & Forgiveness Analysis Summary */}
        {analysis && sim && (
          <div
            data-testid="ease-analysis-box"
            className="bg-slate-950/70 border border-emerald-400/25 rounded-xl p-3.5 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-white">
                <span className="text-emerald-300">
                  {activeSolutionIdx === 0 && sim.solved
                    ? `${analysis.tierLabel} · Rekomendasi`
                    : analysis.tierLabel}
                </span>
                <span className="text-slate-500" aria-hidden="true">
                  /
                </span>
                <span className="font-mono tabular-nums text-slate-200">
                  Skor {analysis.easeScore}/100
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                <span className="text-slate-400">
                  Sudut:{' '}
                  <strong className="text-emerald-300">
                    ±{analysis.angleTolDeg.toFixed(2)}°
                  </strong>
                </span>
                <span className="text-slate-400">
                  Posisi:{' '}
                  <strong className="text-sky-300">
                    ±{analysis.posTolPx.toFixed(1)}px
                  </strong>
                </span>
              </div>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${getScoreBarColor(analysis.easeScore)}`}
                style={{ width: `${analysis.easeScore}%` }}
              />
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {analysis.reasonText}
            </p>
          </div>
        )}

        {/* 3-Step Visual Metrics Strip (clean hairline grid, no nested card-in-card clutter) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/10 bg-slate-950/60 border border-white/10 rounded-xl">
          <div className="p-3">
            <div className="text-[11px] font-semibold text-emerald-300 mb-1">
              1. Titik Mulai (X, Y)
            </div>
            <div className="text-sm font-bold text-white font-mono tabular-nums">
              {startPctX !== null && startPctY !== null
                ? `${startPctX}%, ${startPctY}%`
                : 'Belum ada'}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Lingkaran hijau di kanvas
            </p>
          </div>

          <div className="p-3">
            <div className="text-[11px] font-semibold text-sky-300 mb-1">
              2. Arah & Sudut
            </div>
            <div className="text-sm font-bold text-sky-300 font-mono tabular-nums">
              {deg !== null ? `${deg.toFixed(1)}°` : '—'}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {deg !== null
                ? `Arah ${angleToCompassText(deg)}`
                : 'Ikuti panah arah tembak'}
            </p>
          </div>

          <div className="p-3">
            <div className="text-[11px] font-semibold text-indigo-300 mb-1">
              3. Hasil Pantulan
            </div>
            <div className="text-sm font-bold text-indigo-300 font-mono tabular-nums">
              {sim
                ? `${sim.targetsHit} / ${sim.totalTargets}`
                : `0 / ${totalTargets}`}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {sim ? `${sim.bounces} pantulan berantai` : 'Klik Auto Solve'}
            </p>
          </div>
        </div>

        {/* Instructional Guidance */}
        <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
          {sim ? (
            sim.solved ? (
              <>
                Sentuh tepat di{' '}
                <strong className="text-emerald-300">lingkaran hijau</strong> (
                {startPctX}% kiri, {startPctY}% atas), lalu bidik ke arah{' '}
                <strong className="text-sky-300">
                  {angleToCompassText(deg!)} ({deg!.toFixed(1)}°)
                </strong>
                . Klik <strong className="text-white">Fokus Awal</strong> untuk
                memperbesar titik mulai dan melihat lebar Zona Aman.
              </>
            ) : (
              <>
                Lintasan saat ini mengenai{' '}
                <strong className="text-white">
                  {sim.targetsHit} dari {sim.totalTargets} target
                </strong>
                . Geser slider{' '}
                <strong className="text-white">
                  Kalibrasi Tembakan Presisi
                </strong>{' '}
                di bawah untuk menyempurnakan sudutnya secara langsung, atau
                rapikan balok di tab <strong className="text-white">Atur Posisi</strong>.
              </>
            )
          ) : (
            <>
              Klik <strong className="text-emerald-400">Auto Solve</strong>{' '}
              untuk mencari lintasan pemenang secara otomatis, atau tarik
              langsung di papan untuk membidik manual.
            </>
          )}
        </p>

        {/* Precision Shot Fine-Tuner (Restored X, Y, Angle Sliders!) */}
        <div className="pt-4 border-t border-white/10 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
              <SlidersHorizontal
                className="w-3.5 h-3.5 text-emerald-400"
                aria-hidden="true"
              />
              <span>Kalibrasi Tembakan Presisi</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!solutionShot || solving}
                onClick={onAnalyzeFineTune}
                className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-sky-300 disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap transition"
                title="Ukur toleransi & pusatkan ke zona aman"
              >
                <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Analisis</span>
              </button>
              <button
                type="button"
                disabled={!solutionShot || solving}
                onClick={onFireFineTune}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/60 text-xs font-bold text-emerald-200 disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap transition"
              >
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Tembakkan</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1.5">
                <label htmlFor="sliderFineX">Posisi X</label>
                <span className="font-mono text-emerald-300 tabular-nums">
                  {fineX.toFixed(1)}
                </span>
              </div>
              <input
                id="sliderFineX"
                type="range"
                min={10}
                max={LOGICAL_W - 10}
                step={0.5}
                value={fineX}
                onChange={(e) =>
                  onFineTuneChange(Number(e.target.value), fineY, fineAng)
                }
                className="w-full h-1.5 bg-slate-700 rounded-lg cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1.5">
                <label htmlFor="sliderFineY">Posisi Y</label>
                <span className="font-mono text-emerald-300 tabular-nums">
                  {fineY.toFixed(1)}
                </span>
              </div>
              <input
                id="sliderFineY"
                type="range"
                min={10}
                max={LOGICAL_H - 10}
                step={0.5}
                value={fineY}
                onChange={(e) =>
                  onFineTuneChange(fineX, Number(e.target.value), fineAng)
                }
                className="w-full h-1.5 bg-slate-700 rounded-lg cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1.5">
                <label htmlFor="sliderFineAng">Sudut Bidik</label>
                <span className="font-mono text-sky-300 tabular-nums">
                  {fineAng.toFixed(1)}°
                </span>
              </div>
              <input
                id="sliderFineAng"
                type="range"
                min={0}
                max={360}
                step={0.2}
                value={fineAng}
                onChange={(e) =>
                  onFineTuneChange(fineX, fineY, Number(e.target.value))
                }
                className="w-full h-1.5 bg-slate-700 rounded-lg cursor-pointer"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Preset Levels Selector (Restored!) */}
      <section className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-300" aria-hidden="true" />
            <h2 className="text-sm font-bold text-white">Level Bawaan</h2>
          </div>
          <span className="text-xs text-slate-400">
            5 skenario puzzle siap uji
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {presets.map((preset) => {
            const active = preset.key === activePresetKey;
            return (
              <button
                key={preset.key}
                type="button"
                disabled={solving}
                onClick={() => onSelectPreset(preset.key)}
                aria-pressed={active}
                className={`px-3 py-2.5 rounded-xl text-xs font-semibold text-left border transition truncate ${
                  active
                    ? 'bg-emerald-500/20 border-emerald-400/70 text-white'
                    : 'bg-slate-950/60 border-white/10 text-slate-300 hover:bg-slate-800/70 hover:text-white'
                }`}
              >
                {preset.name}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};
