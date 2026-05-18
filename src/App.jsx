import { useState, useCallback, useRef } from 'react'
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

import { useDocuments } from './hooks/useDocuments.js'
import { useGenerate } from './hooks/useGenerate.js'
import { exportBufferAs } from './hooks/useExport.js'
import { PROVIDERS } from './providers/index.js'

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
// Default settings
// ---------------------------------------------------------------------------
function makeDefaultSettings() {
  const defaultSlug = 'anthropic'
  const meta = PROVIDERS[defaultSlug]
  return {
    providerSlug: defaultSlug,
    model: meta.defaultModel,
    apiKey: localStorage.getItem(`apiKey_${defaultSlug}`) || '',
    // Restore persisted base URL in case user previously used custom/ollama
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
}

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
    clearError: clearDocError,
  } = useDocuments()

  const {
    generateAll,
    regeneratePair,
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
  const [settings, setSettings] = useState(makeDefaultSettings)
  const [showExportModal, setShowExportModal] = useState(false)

  // ── Large output mode (pairCount > 1000) ───────────────────────────────────
  // Pairs bypass React state entirely to avoid re-rendering thousands of cards.
  const isLargeOutputMode = settings.pairCount > 1000
  const [showLargeOutputModal, setShowLargeOutputModal] = useState(false)
  const [largeOutputFormat, setLargeOutputFormat] = useState(null)
  const [largeOutputCount, setLargeOutputCount] = useState(0)
  const [largeOutputComplete, setLargeOutputComplete] = useState(false)
  const largeBufferRef = useRef([])

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

  // Generation — processes ALL loaded documents sequentially
  async function handleGenerate() {
    if (!documents.length) return
    clearGenError()
    setLargeOutputComplete(false)

    // Large output mode: show format picker modal instead of generating directly
    if (isLargeOutputMode) {
      setShowLargeOutputModal(true)
      return
    }

    // Normal mode — clear workspace and stream pairs into React state
    setPairs([])

    await generateAll(
      documents,
      settings,
      // onChunkPairs: stream pairs as each chunk finishes (append, tagged by source doc)
      (chunkPairs) => {
        setPairs((prev) => [...prev, ...chunkPairs])
      },
      // onFileDone: atomically replace this file's streamed pairs with the
      // final document-order result (fixes any out-of-order chunk arrival)
      (docId, orderedPairs) => {
        setPairs((prev) => [
          ...prev.filter((p) => p.sourceDocId !== docId),
          ...orderedPairs,
        ])
      }
    )
  }

  // Large output mode: user confirmed format — buffer into ref, download on completion
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
      // onChunkPairs: push to ref buffer only — no React state, no re-renders
      (chunkPairs) => {
        largeBufferRef.current.push(...chunkPairs)
        setLargeOutputCount(largeBufferRef.current.length)
      },
      // onFileDone: order doesn't matter for a file download — no-op
      () => {}
    )

    // Trigger browser download when generation completes (or was cancelled mid-run)
    if (largeBufferRef.current.length > 0) {
      exportBufferAs(format, largeBufferRef.current)
      setLargeOutputComplete(true)
    }
    largeBufferRef.current = []
  }

  // Regenerate single pair in place
  async function handleRegeneratePair(pair) {
    if (!activeDocument) return
    await regeneratePair(pair, activeDocument, settings, (updated) => {
      setPairs((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    })
  }

  // Pair mutations
  function updatePair(id, changes) {
    setPairs((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...changes, edited: true } : p))
    )
  }

  function deletePair(id) {
    setPairs((prev) => prev.filter((p) => p.id !== id))
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next })
  }

  // Selection
  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(filteredPairs.map((p) => p.id)))
  }

  function deselectAll() {
    setSelectedIds(new Set())
  }

  function deleteSelected() {
    setPairs((prev) => prev.filter((p) => !selectedIds.has(p.id)))
    setSelectedIds(new Set())
  }

  // Filtering
  const filteredPairs = pairs.filter((p) => {
    if (filterRating === 'up') return p.rating === 'up'
    if (filterRating === 'down') return p.rating === 'down'
    if (filterRating === 'unrated') return p.rating === null
    return true
  })

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
          providerSlug={settings.providerSlug}
          model={settings.model}
          selectedIds={selectedIds}
          filterRating={filterRating}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onDeleteSelected={deleteSelected}
          onFilterChange={setFilterRating}
          onExport={() => setShowExportModal(true)}
          isLargeOutputMode={isLargeOutputMode}
          isGenerating={isLoading}
        />

        <div className="flex-1 overflow-y-auto px-4 py-4">
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

          {/* Large output mode — in-progress panel (replaces pair cards) */}
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
          {!isLargeOutputMode && isLoading && (
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

          {/* Pair cards — hidden during large output mode */}
          {!isLargeOutputMode && filteredPairs.length > 0 ? (
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
                    onUpdate={updatePair}
                    onDelete={deletePair}
                    onRegenerate={handleRegeneratePair}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (!isLoading && !isLargeOutputMode && !largeOutputComplete) && (
            /* Empty state */
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
          )}
        </div>
      </div>

      {/* Export modal */}
      {showExportModal && (
        <ExportModal
          pairs={pairs}
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
