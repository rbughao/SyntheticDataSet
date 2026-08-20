import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import DocumentPanel from './components/DocumentPanel.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import GenerateButton from './components/GenerateButton.jsx'
import PairCard from './components/PairCard.jsx'
import WorkspaceHeader from './components/WorkspaceHeader.jsx'
import ExportModal from './components/ExportModal.jsx'
import LargeOutputModal from './components/LargeOutputModal.jsx'
import PreflightEstimate from './components/PreflightEstimate.jsx'
import VirtualPairList, { VIRTUALIZE_THRESHOLD } from './components/VirtualPairList.jsx'

import { useDocuments } from './hooks/useDocuments.js'
import { useGenerate } from './hooks/useGenerate.js'
import { exportBufferAs } from './hooks/useExport.js'
import { PROVIDERS } from './providers/index.js'
import { findDuplicates } from './utils/dedup.js'
import { validateAll } from './utils/quality.js'
import {
  saveSettings, loadSettings,
  saveSession, loadSession, clearSession, formatSavedAt,
} from './utils/storage.js'

// ---------------------------------------------------------------------------
// SortablePairCard — thin dnd-kit wrapper around PairCard
// ---------------------------------------------------------------------------
function SortablePairCard(props) {
  const { pair } = props
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: pair.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <PairCard {...props} listeners={listeners} attributes={attributes} isDragging={isDragging} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Default settings — merged over any persisted values
// ---------------------------------------------------------------------------
function makeDefaultSettings() {
  const defaultSlug = 'anthropic'
  const meta = PROVIDERS[defaultSlug]
  const base = {
    providerSlug: defaultSlug,
    model: meta.defaultModel,
    apiKey: localStorage.getItem(`apiKey_${defaultSlug}`) || '',
    baseURL: localStorage.getItem(`baseURL_${defaultSlug}`) || '',
    proxyBaseUrl: '',
    subProvider: meta.defaultSubProvider || '',
    pairCount: 10,
    styles: ['factual'],
    difficulty: 'intermediate',
    domainTag: '',
    temperatureHint: 'balanced',
    concurrency: 3,
  }

  // Restore persisted settings; API key always comes from its own secure-ish slot
  const saved = loadSettings()
  if (!saved) return base

  const merged = { ...base, ...saved }
  merged.apiKey = localStorage.getItem(`apiKey_${merged.providerSlug}`) || ''
  return merged
}

// How long to wait after the last change before writing a session snapshot.
const AUTOSAVE_DEBOUNCE_MS = 1500

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const {
    documents,
    activeDocument,
    activeDocumentId,
    loading: docLoading,
    error: docError,
    addFile,
    addPaste,
    removeDocument,
    setActiveDocument,
    restoreDocuments,
    clearAllDocuments,
    clearError: clearDocError,
  } = useDocuments()

  const {
    generateAll,
    regeneratePair,
    retryFailedChunks,
    failedChunks,
    clearFailedChunks,
    isLoading,
    progress,
    fileProgress,
    error: genError,
    clearError: clearGenError,
    cancelGeneration,
  } = useGenerate()

  const [pairs, setPairs] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [filterRating, setFilterRating] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [settings, setSettings] = useState(makeDefaultSettings)
  const [showExportModal, setShowExportModal] = useState(false)

  // ── Session restore ────────────────────────────────────────────────────────
  const [restorable, setRestorable] = useState(null) // { savedAt, documents, pairs }
  const hasRestoredRef = useRef(false)

  // ── Large output mode (pairCount > 1000) ───────────────────────────────────
  const isLargeOutputMode = settings.pairCount > 1000
  const [showLargeOutputModal, setShowLargeOutputModal] = useState(false)
  const [largeOutputFormat, setLargeOutputFormat] = useState(null)
  const [largeOutputCount, setLargeOutputCount] = useState(0)
  const [largeOutputComplete, setLargeOutputComplete] = useState(false)
  const largeBufferRef = useRef([])

  // ── Duplicate + quality analysis ───────────────────────────────────────────
  const [dedupDismissed, setDedupDismissed] = useState(false)

  // Both passes are pure functions of `pairs` — memoized so editing one card
  // doesn't re-scan the whole dataset on every keystroke.
  const duplicates = useMemo(
    () => (pairs.length > 1 ? findDuplicates(pairs) : { duplicateIds: new Set(), exactCount: 0, fuzzyCount: 0, fuzzySkipped: false }),
    [pairs]
  )
  const quality = useMemo(() => validateAll(pairs), [pairs])

  // Workspace body height for the virtualized list
  const bodyRef = useRef(null)
  const [bodyHeight, setBodyHeight] = useState(600)

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const measure = () => setBodyHeight(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Load a persisted session once on mount ─────────────────────────────────
  useEffect(() => {
    let cancelled = false
    loadSession().then((snapshot) => {
      if (!cancelled && snapshot) setRestorable(snapshot)
    })
    return () => { cancelled = true }
  }, [])

  // ── Persist settings whenever they change ──────────────────────────────────
  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  // ── Autosave documents + pairs (debounced, skipped mid-generation) ─────────
  useEffect(() => {
    // Don't snapshot a half-finished run, and don't overwrite a restorable
    // snapshot before the user has decided what to do with it.
    if (isLoading || restorable) return
    if (!documents.length && !pairs.length) return

    const t = setTimeout(() => {
      saveSession({ documents, pairs })
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [documents, pairs, isLoading, restorable])

  function handleRestore() {
    if (hasRestoredRef.current || !restorable) return
    hasRestoredRef.current = true
    restoreDocuments(restorable.documents)
    setPairs(restorable.pairs || [])
    setRestorable(null)
  }

  function handleDiscardRestore() {
    setRestorable(null)
    clearSession()
  }

  // Merge partial settings updates
  const updateSettings = useCallback((changes) => {
    setSettings((prev) => ({ ...prev, ...changes }))
  }, [])

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setPairs((items) => {
      const oldIndex = items.findIndex((i) => i.id === active.id)
      const newIndex = items.findIndex((i) => i.id === over.id)
      return arrayMove(items, oldIndex, newIndex)
    })
  }

  // ── Generation ─────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!documents.length) return
    clearGenError()
    clearFailedChunks()
    setLargeOutputComplete(false)
    setDedupDismissed(false)

    if (isLargeOutputMode) {
      setShowLargeOutputModal(true)
      return
    }

    setPairs([])
    await generateAll(
      documents,
      settings,
      (chunkPairs) => setPairs((prev) => [...prev, ...chunkPairs]),
      (docId, orderedPairs) =>
        setPairs((prev) => [
          ...prev.filter((p) => p.sourceDocId !== docId),
          ...orderedPairs,
        ])
    )
  }

  async function handleLargeOutputConfirm(format) {
    setLargeOutputFormat(format)
    setShowLargeOutputModal(false)
    largeBufferRef.current = []
    setLargeOutputCount(0)
    setPairs([])
    clearGenError()

    await generateAll(
      documents,
      settings,
      (chunkPairs) => {
        largeBufferRef.current.push(...chunkPairs)
        setLargeOutputCount(largeBufferRef.current.length)
      },
      () => {}
    )

    if (largeBufferRef.current.length > 0) {
      exportBufferAs(format, largeBufferRef.current)
      setLargeOutputComplete(true)
    }
    largeBufferRef.current = []
  }

  // Retry only the chunks that errored — recovered pairs are appended
  async function handleRetryFailed() {
    await retryFailedChunks((recovered) => {
      setPairs((prev) => [...prev, ...recovered])
    })
  }

  // Regenerate single pair in place
  async function handleRegeneratePair(pair) {
    const sourceDoc =
      documents.find((d) => d.id === pair.sourceDocId) || activeDocument
    if (!sourceDoc) return
    await regeneratePair(pair, sourceDoc, settings, (updated) => {
      setPairs((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    })
  }

  // ── Pair mutations ─────────────────────────────────────────────────────────
  const updatePair = useCallback((id, changes) => {
    setPairs((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...changes, edited: true } : p))
    )
  }, [])

  const deletePair = useCallback((id) => {
    setPairs((prev) => prev.filter((p) => p.id !== id))
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next })
  }, [])

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  function deleteSelected() {
    setPairs((prev) => prev.filter((p) => !selectedIds.has(p.id)))
    setSelectedIds(new Set())
  }

  function removeAllDuplicates() {
    setPairs((prev) => prev.filter((p) => !duplicates.duplicateIds.has(p.id)))
    setDedupDismissed(true)
  }

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filteredPairs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return pairs.filter((p) => {
      if (filterType !== 'all' && p.type !== filterType) return false

      switch (filterRating) {
        case 'up': if (p.rating !== 'up') return false; break
        case 'down': if (p.rating !== 'down') return false; break
        case 'unrated': if (p.rating != null) return false; break
        case 'edited': if (!p.edited) return false; break
        case 'flagged': if (!quality.issuesById.has(p.id)) return false; break
        case 'duplicate': if (!duplicates.duplicateIds.has(p.id)) return false; break
        default: break
      }

      if (q) {
        const haystack = `${p.instruction || ''} ${p.output || ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [pairs, filterType, filterRating, searchQuery, quality, duplicates])

  function selectAll() {
    setSelectedIds(new Set(filteredPairs.map((p) => p.id)))
  }

  function deselectAll() {
    setSelectedIds(new Set())
  }

  const useVirtual = filteredPairs.length > VIRTUALIZE_THRESHOLD
  const duplicateCount = duplicates.duplicateIds.size
  const showDedupBanner = duplicateCount > 0 && !dedupDismissed && !isLoading

  return (
    <div className="flex h-screen overflow-hidden flex-col md:flex-row bg-gray-50">
      {/* ── Left sidebar ── */}
      <div className="w-full md:w-80 md:flex-shrink-0 flex flex-col border-r border-gray-200 bg-white overflow-y-auto md:h-screen">
        <DocumentPanel
          documents={documents}
          activeDocumentId={activeDocumentId}
          loading={docLoading}
          error={docError}
          fileProgress={fileProgress}
          onAddFile={addFile}
          onAddPaste={addPaste}
          onRemove={removeDocument}
          onSetActive={setActiveDocument}
          onClearError={clearDocError}
        />
        <SettingsPanel settings={settings} onChange={updateSettings} />

        {documents.length > 0 && (
          <div className="px-4">
            <PreflightEstimate documents={documents} settings={settings} />
          </div>
        )}

        <GenerateButton
          isLoading={isLoading}
          disabled={documents.length === 0}
          onClick={handleGenerate}
          onCancel={cancelGeneration}
          progress={progress}
          documentCount={documents.length}
          largeOutputCount={isLargeOutputMode && isLoading ? largeOutputCount : undefined}
        />
      </div>

      {/* ── Right workspace ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <WorkspaceHeader
          documentName={
            documents.length > 1
              ? `${documents.length} documents`
              : activeDocument?.name
          }
          pairs={filteredPairs}
          totalPairs={pairs.length}
          providerSlug={settings.providerSlug}
          model={settings.model}
          selectedIds={selectedIds}
          filterRating={filterRating}
          filterType={filterType}
          searchQuery={searchQuery}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onDeleteSelected={deleteSelected}
          onFilterChange={setFilterRating}
          onFilterTypeChange={setFilterType}
          onSearchChange={setSearchQuery}
          onExport={() => setShowExportModal(true)}
          isLargeOutputMode={isLargeOutputMode}
          isGenerating={isLoading}
        />

        <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-4">
          {/* Session restore prompt */}
          {restorable && (
            <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-semibold text-indigo-900">Restore previous session?</p>
                <p className="text-sm text-indigo-700 mt-0.5">
                  {(restorable.pairs?.length || 0).toLocaleString()} pairs from{' '}
                  {restorable.documents?.length || 0} document
                  {restorable.documents?.length !== 1 ? 's' : ''}, saved{' '}
                  {formatSavedAt(restorable.savedAt)}.
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={handleRestore}
                  className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  Restore
                </button>
                <button
                  onClick={handleDiscardRestore}
                  className="px-3 py-1.5 text-xs text-indigo-500 hover:text-indigo-700"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Failed chunks — retry without regenerating everything */}
          {failedChunks.length > 0 && !isLoading && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0l-7.1 12.25A2 2 0 005 19z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-900">
                  {failedChunks.length} chunk{failedChunks.length !== 1 ? 's' : ''} failed
                </p>
                <p className="text-sm text-amber-700 mt-0.5">
                  Their pairs are missing from the dataset. Retrying re-runs only these
                  chunks — the rest of your results are kept.
                </p>
                <details className="mt-1.5">
                  <summary className="text-xs text-amber-600 cursor-pointer">Show errors</summary>
                  <ul className="mt-1 space-y-0.5 max-h-28 overflow-y-auto">
                    {failedChunks.slice(0, 20).map(({ spec, message }, i) => (
                      <li key={i} className="text-xs text-amber-700">
                        <span className="font-medium">{spec.docName}</span> chunk{' '}
                        {spec.chunkIndex + 1}/{spec.totalChunks} — {message}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={handleRetryFailed}
                  className="px-3 py-1.5 text-xs font-semibold bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                >
                  Retry {failedChunks.length}
                </button>
                <button
                  onClick={clearFailedChunks}
                  className="px-3 py-1.5 text-xs text-amber-600 hover:text-amber-800"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Duplicate detection */}
          {showDedupBanner && (
            <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-semibold text-orange-900">
                  {duplicateCount.toLocaleString()} duplicate pair
                  {duplicateCount !== 1 ? 's' : ''} found
                </p>
                <p className="text-sm text-orange-700 mt-0.5">
                  {duplicates.exactCount} exact, {duplicates.fuzzyCount} near-identical.
                  Chunks overlap by design, so repeats are expected — but duplicate
                  training examples cause overfitting.
                  {duplicates.fuzzySkipped && ' (Similarity scan skipped above 2 000 pairs.)'}
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={removeAllDuplicates}
                  className="px-3 py-1.5 text-xs font-semibold bg-orange-600 text-white rounded-lg hover:bg-orange-700"
                >
                  Remove all
                </button>
                <button
                  onClick={() => { setFilterRating('duplicate'); setDedupDismissed(true) }}
                  className="px-3 py-1.5 text-xs text-orange-600 hover:text-orange-800"
                >
                  Review
                </button>
              </div>
            </div>
          )}

          {/* Quality summary */}
          {quality.flaggedCount > 0 && !isLoading && filterRating !== 'flagged' && (
            <button
              onClick={() => setFilterRating('flagged')}
              className="mb-4 w-full text-left bg-white border border-gray-200 rounded-xl px-4 py-2.5 hover:border-gray-300 transition-colors flex items-center gap-2"
            >
              <span className="text-sm text-gray-600">
                <span className="font-semibold text-gray-800">{quality.flaggedCount}</span> pair
                {quality.flaggedCount !== 1 ? 's' : ''} flagged by quality checks
              </span>
              {quality.errorCount > 0 && (
                <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  {quality.errorCount} error{quality.errorCount !== 1 ? 's' : ''}
                </span>
              )}
              {quality.warnCount > 0 && (
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                  {quality.warnCount} warning{quality.warnCount !== 1 ? 's' : ''}
                </span>
              )}
              <span className="flex-1" />
              <span className="text-xs text-indigo-600 font-medium">Review →</span>
            </button>
          )}

          {/* Generation error banner */}
          {genError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-800">
                    {genError.type === 'parse' ? 'Failed to parse LLM response' : 'Generation failed'}
                  </p>
                  <p className="text-sm text-red-600 mt-1">{genError.message}</p>
                  {genError.type === 'network' && settings.providerSlug === 'anthropic' && (
                    <p className="text-xs text-red-500 mt-1">
                      Anthropic blocks browser CORS. Add a proxy URL in Settings, or switch to Google Gemini.
                    </p>
                  )}
                  {genError.type === 'network' && settings.providerSlug === 'ollama' && (
                    <p className="text-xs text-red-500 mt-1">
                      Ollama may not be running. Run <code className="bg-red-100 px-1 rounded">ollama serve</code> and set <code className="bg-red-100 px-1 rounded">OLLAMA_ORIGINS=*</code>.
                    </p>
                  )}
                  {genError.rawText && (
                    <details className="mt-2">
                      <summary className="text-xs text-red-500 cursor-pointer">Show raw response</summary>
                      <pre className="mt-1 text-xs bg-red-100 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-40">{genError.rawText}</pre>
                    </details>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={handleGenerate}
                    className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700"
                  >
                    Retry
                  </button>
                  <button
                    onClick={clearGenError}
                    className="px-3 py-1.5 text-xs text-red-500 hover:text-red-700"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Large output mode — in-progress panel */}
          {isLargeOutputMode && isLoading && (
            <div className="flex flex-col items-center justify-center h-full text-center py-20 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center">
                <svg className="w-8 h-8 text-indigo-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-gray-700">
                {largeOutputCount.toLocaleString()} pairs generated
              </p>
              <p className="text-sm text-gray-400 max-w-xs">
                Pairs are being written to a <strong>{largeOutputFormat?.toUpperCase()}</strong> file.
                The workspace is intentionally blank to keep the UI responsive.
              </p>
            </div>
          )}

          {/* Large output mode — success panel */}
          {isLargeOutputMode && largeOutputComplete && !isLoading && (
            <div className="flex flex-col items-center justify-center h-full text-center py-20 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-gray-700">Download complete</p>
              <p className="text-sm text-gray-400 max-w-xs">
                {largeOutputCount.toLocaleString()} pairs saved as <strong>{largeOutputFormat?.toUpperCase()}</strong>.
                Upload new documents or adjust settings to generate another batch.
              </p>
              <button
                onClick={() => setLargeOutputComplete(false)}
                className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
              >
                Start over
              </button>
            </div>
          )}

          {/* Loading skeleton — normal mode only */}
          {!isLargeOutputMode && isLoading && pairs.length === 0 && (
            <div className="space-y-3 mb-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-3 w-6 bg-gray-200 rounded" />
                    <div className="h-4 w-16 bg-gray-200 rounded-full" />
                  </div>
                  <div className="h-3 bg-gray-200 rounded mb-1.5 w-3/4" />
                  <div className="h-3 bg-gray-200 rounded mb-4 w-1/2" />
                  <div className="h-3 bg-gray-200 rounded mb-1.5" />
                  <div className="h-3 bg-gray-200 rounded mb-1.5 w-5/6" />
                  <div className="h-3 bg-gray-200 rounded w-2/3" />
                </div>
              ))}
            </div>
          )}

          {/* Pair list — virtualized above the threshold, drag-sortable below */}
          {!isLargeOutputMode && filteredPairs.length > 0 && (
            useVirtual ? (
              <>
                <p className="text-xs text-gray-400 mb-2">
                  Showing {filteredPairs.length.toLocaleString()} pairs in a windowed list —
                  drag-to-reorder is disabled above {VIRTUALIZE_THRESHOLD} pairs.
                </p>
                <VirtualPairList
                  pairs={filteredPairs}
                  height={Math.max(320, bodyHeight - 80)}
                  selectedIds={selectedIds}
                  issuesById={quality.issuesById}
                  duplicateIds={duplicates.duplicateIds}
                  onUpdate={updatePair}
                  onDelete={deletePair}
                  onRegenerate={handleRegeneratePair}
                  onToggleSelect={toggleSelect}
                />
              </>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={filteredPairs.map((p) => p.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {filteredPairs.map((pair, index) => (
                    <SortablePairCard
                      key={pair.id}
                      pair={pair}
                      index={index}
                      isSelected={selectedIds.has(pair.id)}
                      issues={quality.issuesById.get(pair.id)}
                      isDuplicate={duplicates.duplicateIds.has(pair.id)}
                      onUpdate={updatePair}
                      onDelete={deletePair}
                      onRegenerate={handleRegeneratePair}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )
          )}

          {/* Empty states */}
          {!isLargeOutputMode && !isLoading && filteredPairs.length === 0 && (
            pairs.length > 0 ? (
              /* Filters matched nothing */
              <div className="flex flex-col items-center justify-center h-full text-center py-20">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-gray-700 mb-1">No matching pairs</h3>
                <p className="text-sm text-gray-400 max-w-xs mb-4">
                  {pairs.length.toLocaleString()} pairs exist, but none match the current filters.
                </p>
                <button
                  onClick={() => { setSearchQuery(''); setFilterRating('all'); setFilterType('all') }}
                  className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                >
                  Clear filters
                </button>
              </div>
            ) : !largeOutputComplete && (
              /* Nothing generated yet */
              <div className="flex flex-col items-center justify-center h-full text-center py-20">
                <div className="w-20 h-20 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
                  <svg className="w-10 h-10 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-gray-700 mb-1">
                  {activeDocument ? 'Ready to generate' : 'No document loaded'}
                </h3>
                <p className="text-sm text-gray-400 max-w-xs">
                  {activeDocument
                    ? 'Configure your settings and click "Generate Dataset" to create Q&A pairs.'
                    : 'Upload a document or paste text on the left to get started.'}
                </p>
              </div>
            )
          )}
        </div>
      </div>

      {/* Export modal */}
      {showExportModal && (
        <ExportModal
          pairs={pairs}
          selectedIds={selectedIds}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* Large output format picker modal */}
      {showLargeOutputModal && (
        <LargeOutputModal
          pairCount={settings.pairCount}
          onConfirm={handleLargeOutputConfirm}
          onCancel={() => setShowLargeOutputModal(false)}
        />
      )}
    </div>
  )
}
