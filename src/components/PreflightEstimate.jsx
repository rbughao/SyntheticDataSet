import { useMemo } from 'react'
import { estimateRun, formatCost, formatDuration, formatCompact } from '../utils/pricing.js'

/**
 * Pre-flight cost / time strip shown above the Generate button.
 *
 * Without this the user commits to a run with no idea whether it costs
 * $0.40 or $40, or takes 30 seconds or 40 minutes.
 */
export default function PreflightEstimate({ documents, settings }) {
  const est = useMemo(() => {
    if (!documents.length) return null
    try {
      return estimateRun(documents, settings)
    } catch {
      return null
    }
  }, [documents, settings])

  if (!est) return null

  // Warn when a single run is about to get expensive
  const isPricey = est.costUSD !== null && est.costUSD >= 5

  return (
    <div
      className={`rounded-xl px-3.5 py-3 space-y-1.5 ${
        isPricey ? 'bg-warn-soft ring-1 ring-warn-line' : 'bg-surface-3'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="eyebrow">
          Estimate
        </span>
        {isPricey && (
          <span className="text-xs font-semibold text-warn-ink">⚠ High cost</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <Row label="Pairs" value={est.totalPairs.toLocaleString()} />
        <Row label="Requests" value={est.chunkCount.toLocaleString()} />
        <Row label="Tokens in" value={formatCompact(est.inputTokens)} />
        <Row label="Tokens out" value={formatCompact(est.outputTokens)} />
      </div>

      <div className="flex items-center justify-between pt-1.5 border-t border-line/70">
        <span className="text-xs text-ink-3">{formatDuration(est.seconds)}</span>
        <span
          className={`text-sm font-bold ${
            est.isFree
              ? 'text-ok-ink'
              : isPricey
              ? 'text-warn-ink'
              : 'text-ink'
          }`}
        >
          {est.isFree
            ? 'Free (local)'
            : est.unknownPricing
            ? 'Cost unknown'
            : formatCost(est.costUSD)}
        </span>
      </div>

      {est.unknownPricing && (
        <p className="text-xs text-ink-3 leading-snug">
          No price on file for this model — token counts above are still accurate.
        </p>
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-3">{label}</span>
      <span className="font-medium text-ink-2">{value}</span>
    </div>
  )
}
