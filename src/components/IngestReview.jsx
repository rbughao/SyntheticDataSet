import { useState, useMemo } from 'react'
import { REASON, REASON_LABEL } from '../sources/exclusions.js'
import { getModelPricing, formatCost, formatDuration, formatCompact } from '../utils/pricing.js'
import { CHUNK_SIZE, CHUNK_OVERLAP } from '../utils/chunker.js'

/** Default cap so a 5,000-file folder doesn't arrive pre-selected. */
export const DEFAULT_SELECTION_CAP = 200

function formatBytes(b) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Estimate a run from file sizes, before any file has been read.
 *
 * Bytes stand in for characters, which is close enough for text and errs high
 * for multi-byte content — the right direction for a cost warning.
 */
function estimateFromSizes(totalBytes, fileCount, settings) {
  const perDoc = settings.pairCount || 10
  const step = CHUNK_SIZE - CHUNK_OVERLAP
  // Mirrors useGenerate: a document never yields more chunks than requested pairs
  const chunksPerDoc = Math.max(1, Math.ceil(totalBytes / fileCount / step) || 1)
  const chunkCount = fileCount * Math.min(chunksPerDoc, perDoc)

  const inputTokens = Math.ceil((totalBytes + chunkCount * 1200) / 4)
  const totalPairs = perDoc * fileCount
  const outputTokens = Math.ceil((totalPairs * 500) / 4)

  const pricing = getModelPricing(settings.providerSlug, settings.model)
  const costUSD = pricing
    ? (inputTokens / 1_000_000) * pricing.in + (outputTokens / 1_000_000) * pricing.out
    : null

  const seconds = Math.ceil((chunkCount / Math.max(1, settings.concurrency || 3)) * 6)

  return {
    chunkCount, totalPairs, inputTokens, outputTokens,
    costUSD, isFree: !!pricing?.free, unknownPricing: !pricing, seconds,
  }
}

/**
 * Selection + cost gate for bulk ingestion.
 *
 * Pointing at a folder can mean thousands of files, so nothing is ingested
 * until the user has seen what was found, what was excluded and why, and what
 * generating from the selection would cost.
 */
export default function IngestReview({ result, settings, onConfirm, onCancel }) {
  const { included, excluded, counts, reasonLabels, title } = result
  // Crawl results carry their own reason vocabulary (robots, noindex, …)
  const LABELS = { ...REASON_LABEL, ...(reasonLabels || {}) }

  // Pre-select up to the cap, so a huge folder doesn't arrive fully checked
  const [selected, setSelected] = useState(
    () => new Set(included.slice(0, DEFAULT_SELECTION_CAP).map((f) => f.path))
  )
  const [showExcluded, setShowExcluded] = useState(false)

  const selectedFiles = useMemo(
    () => included.filter((f) => selected.has(f.path)),
    [included, selected]
  )
  const totalBytes = useMemo(
    () => selectedFiles.reduce((sum, f) => sum + f.size, 0),
    [selectedFiles]
  )
  const est = useMemo(
    () => (selectedFiles.length ? estimateFromSizes(totalBytes, selectedFiles.length, settings) : null),
    [totalBytes, selectedFiles.length, settings]
  )

  const secretCount = counts[REASON.SECRET] || 0
  const isPricey = est?.costUSD !== null && est?.costUSD >= 5
  const overCap = included.length > DEFAULT_SELECTION_CAP

  function toggle(path) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-surface rounded-3xl shadow-xl animate-slide-up w-full max-w-2xl max-h-[88vh] flex flex-col">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">{title || 'Review before importing'}</h2>
            <p className="text-xs text-ink-3 mt-1 font-mono">
              {included.length.toLocaleString()} usable ·{' '}
              {excluded.length.toLocaleString()} excluded ·{' '}
              {selected.size.toLocaleString()} selected
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Cancel import"
            className="text-ink-3 hover:text-ink transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Secrets get their own prominent notice — this is the one exclusion
            reason the user genuinely needs to know about. */}
        {secretCount > 0 && (
          <div className="mx-6 mb-3 bg-bad-soft border border-bad-line rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-bad-ink">
              {secretCount} possible {secretCount === 1 ? 'secret' : 'secrets'} excluded
            </p>
            <p className="text-xs text-bad-ink/90 mt-0.5 break-url">
              Files like <code className="font-mono">.env</code> and private keys were left out.
              Document text is sent to your LLM provider, so these are never imported.
            </p>
          </div>
        )}

        {overCap && (
          <div className="mx-6 mb-3 bg-warn-soft border border-warn-line rounded-xl px-4 py-2.5">
            <p className="text-xs text-warn-ink">
              {included.length.toLocaleString()} usable items found. The first{' '}
              {DEFAULT_SELECTION_CAP} are selected — tick more below if you need them.
            </p>
          </div>
        )}

        {/* Bulk selection controls */}
        <div className="px-6 pb-2 flex items-center gap-3 text-xs">
          <button
            onClick={() => setSelected(new Set(included.map((f) => f.path)))}
            className="text-brand-ink hover:underline font-medium"
          >
            Select all {included.length.toLocaleString()}
          </button>
          <span className="text-ink-3">·</span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-ink-3 hover:text-ink-2"
          >
            Clear
          </button>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto px-6 scrollbar-thin min-h-[8rem]">
          <ul className="divide-y divide-line">
            {included.map((f) => (
              <li key={f.path}>
                <label className="flex items-center gap-3 py-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selected.has(f.path)}
                    onChange={() => toggle(f.path)}
                    className="w-4 h-4 accent-brand flex-shrink-0"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-ink truncate">{f.name}</span>
                    {f.path !== f.name && (
                      <span className="block text-[11px] text-ink-3 font-mono truncate">{f.path}</span>
                    )}
                  </span>
                  <span className="text-[11px] text-ink-3 font-mono flex-shrink-0 tabular-nums">
                    {formatBytes(f.size)}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {/* Excluded, collapsed — visible but out of the way */}
          {excluded.length > 0 && (
            <div className="py-3 border-t border-line mt-1">
              <button
                onClick={() => setShowExcluded((v) => !v)}
                className="text-xs text-ink-3 hover:text-ink-2 flex items-center gap-1.5"
              >
                <span>{showExcluded ? '▾' : '▸'}</span>
                {excluded.length.toLocaleString()} excluded —{' '}
                {Object.entries(counts)
                  .map(([reason, n]) => `${n} ${LABELS[reason]?.toLowerCase() ?? reason}`)
                  .join(', ')}
              </button>
              {showExcluded && (
                <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
                  {excluded.slice(0, 400).map((f) => (
                    <li key={f.path} className="flex items-baseline gap-2 text-[11px]">
                      <span className={`font-mono flex-shrink-0 ${
                        f.reason === REASON.SECRET ? 'text-bad-ink' : 'text-ink-3'
                      }`}>
                        {LABELS[f.reason] ?? f.reason}
                      </span>
                      <span className="text-ink-3 font-mono truncate min-w-0">{f.path}</span>
                    </li>
                  ))}
                  {excluded.length > 400 && (
                    <li className="text-[11px] text-ink-3 italic">
                      …and {(excluded.length - 400).toLocaleString()} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Estimate + confirm */}
        <div className="px-6 py-4 border-t border-line">
          {est ? (
            <div className={`rounded-xl px-4 py-3 mb-3 ${isPricey ? 'bg-warn-soft' : 'bg-surface-3'}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="eyebrow">If you generate from this selection</span>
                {isPricey && <span className="text-xs font-semibold text-warn-ink">⚠ High cost</span>}
              </div>
              <div className="flex items-center justify-between text-xs text-ink-2 font-mono tabular-nums">
                <span>
                  {est.totalPairs.toLocaleString()} pairs · {est.chunkCount.toLocaleString()} requests ·{' '}
                  {formatCompact(est.inputTokens)} in
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-ink-3">{formatDuration(est.seconds)}</span>
                  <span className={`text-sm font-bold ${
                    est.isFree ? 'text-ok-ink' : isPricey ? 'text-warn-ink' : 'text-ink'
                  }`}>
                    {est.isFree ? 'Free' : est.unknownPricing ? 'Cost unknown' : formatCost(est.costUSD)}
                  </span>
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink-3 mb-3">Select at least one file to import.</p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-ink-3 hover:text-ink-2 transition-colors"
            >
              Cancel
            </button>
            <div className="flex-1" />
            <button
              onClick={() => onConfirm(selectedFiles)}
              disabled={selectedFiles.length === 0}
              className="px-5 py-2.5 bg-brand hover:bg-brand-hover disabled:bg-surface-3 disabled:text-ink-3 text-brand-on text-sm font-semibold rounded-full transition-colors shadow-sm"
            >
              Import {selectedFiles.length.toLocaleString()}{' '}
              {selectedFiles.length === 1 ? 'file' : 'files'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
