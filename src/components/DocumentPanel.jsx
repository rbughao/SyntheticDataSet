import { useState, useRef, useEffect } from 'react'
import { estimateChunks, CHUNK_SIZE } from '../utils/chunker.js'
import { SUPPORTED_TYPES, HINT_TYPES } from '../utils/fileReader.js'
import { fromFileList, fromDataTransfer, dragHasDirectory } from '../sources/folderSource.js'
import { partition } from '../sources/exclusions.js'
import CloudBrowser from './CloudBrowser.jsx'

const PREVIEW_LENGTH = 500
const CHAR_LIMIT = 10000

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Status badge shown on each document row during/after batch processing
function DocStatusBadge({ status, pairCount }) {
  if (!status || status === 'pending') return null
  if (status === 'processing') {
    return (
      <span className="flex items-center gap-1 text-xs text-brand-ink flex-shrink-0">
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </span>
    )
  }
  if (status === 'done') {
    return (
      <span className="flex items-center gap-1 text-xs text-ok-ink flex-shrink-0 font-medium">
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        {pairCount}
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-bad flex-shrink-0">
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
        error
      </span>
    )
  }
  return null
}

export default function DocumentPanel({
  documents,
  activeDocumentId,
  loading,
  error,
  fileProgress = {},
  onAddFile,
  onAddPaste,
  onRemove,
  onSetActive,
  onClearError,
  onFolderPicked,
  onAddUrl,
  urlLoading = false,
  urlError = null,
  crawlProgress = null,
  onCancelCrawl,
  connections = {},
  cloudBusy = null,
  cloudProgress = null,
  cloudError = null,
  onCloudImport,
  onCancelCloud,
}) {
  const [activeTab, setActiveTab] = useState('upload')
  const [pasteText, setPasteText] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [showFullPreview, setShowFullPreview] = useState(false)
  const fileInputRef = useRef(null)
  const folderInputRef = useRef(null)
  const [urlValue, setUrlValue] = useState('')
  const [crawl, setCrawl] = useState(false)
  const [crawlDepth, setCrawlDepth] = useState(1)
  const [crawlMax, setCrawlMax] = useState(25)

  const activeDoc = documents.find((d) => d.id === activeDocumentId)

  // Auto-dismiss error toast after 4 seconds
  useEffect(() => {
    if (!error) return
    const t = setTimeout(onClearError, 4000)
    return () => clearTimeout(t)
  }, [error, onClearError])

  function handleFiles(files) {
    Array.from(files).forEach((file) => onAddFile(file))
  }

  async function handleDrop(e) {
    e.preventDefault()
    setIsDragging(false)
    // A dropped folder appears only via the entry API — dataTransfer.files is
    // empty for directories, so check before falling back to plain files.
    if (onFolderPicked && dragHasDirectory(e.dataTransfer)) {
      const items = await fromDataTransfer(e.dataTransfer.items)
      onFolderPicked(partition(items))
      return
    }
    handleFiles(e.dataTransfer.files)
  }

  function handleFolderInput(e) {
    if (!e.target.files?.length) return
    onFolderPicked?.(fromFileList(e.target.files))
    e.target.value = ''   // let the same folder be re-picked
  }

  function handleUrlSubmit(e) {
    e.preventDefault()
    if (!urlValue.trim() || urlLoading) return
    const crawlOpts = crawl
      ? { maxDepth: Number(crawlDepth), maxPages: Number(crawlMax) }
      : null
    onAddUrl?.(urlValue.trim(), () => setUrlValue(''), crawlOpts)
  }

  function handlePasteAdd() {
    if (!pasteText.trim()) return
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    onAddPaste(pasteText, `Pasted text (${time})`)
    setPasteText('')
  }

  const previewText = activeDoc
    ? showFullPreview
      ? activeDoc.text
      : activeDoc.text.slice(0, PREVIEW_LENGTH)
    : null

  const needsExpand = activeDoc && activeDoc.text.length > PREVIEW_LENGTH && !showFullPreview

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <h1 className="font-display text-[17px] font-semibold text-ink leading-tight">Synthetic Dataset Generator</h1>
        <p className="text-xs text-ink-3 mt-0.5">by BughaoLab</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line px-5">
        {['upload', 'folder', 'cloud', 'url', 'paste'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-2 py-2 text-[12.5px] font-medium border-b-2 transition-colors capitalize ${
              activeTab === tab
                ? 'border-brand text-brand-ink'
                : 'border-transparent text-ink-3 hover:text-ink-2'
            }`}
          >
            {tab === 'url' ? 'URL' : tab}
          </button>
        ))}
      </div>

      <div className="px-5 py-4">
        {/* Upload tab */}
        {activeTab === 'upload' && (
          <div>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-brand bg-brand-soft'
                  : 'border-line hover:border-line-strong hover:bg-surface-2'
              }`}
            >
              <svg className="w-8 h-8 mx-auto text-ink-3 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-ink-3">
                Drop files here or <span className="text-brand-ink font-medium">browse</span>
              </p>
              <p
                className="text-xs text-ink-3 mt-1"
                title={`All supported types:\n${SUPPORTED_TYPES.join('  ')}`}
              >
                {HINT_TYPES}
              </p>
              {loading && (
                <p className="text-xs text-brand-ink mt-2 flex items-center justify-center gap-1">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Reading file…
                </p>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_TYPES.join(',')}
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        )}

        {/* Folder tab */}
        {activeTab === 'folder' && (
          <div>
            <div
              onClick={() => folderInputRef.current?.click()}
              className="border-2 border-dashed border-line hover:border-line-strong hover:bg-surface-2 rounded-xl p-6 text-center cursor-pointer transition-colors"
            >
              <svg className="w-8 h-8 mx-auto text-ink-3 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
              <p className="text-sm text-ink-3">
                Choose a <span className="text-brand-ink font-medium">folder</span>
              </p>
              <p className="text-xs text-ink-3 mt-1">Includes every subfolder</p>
            </div>
            <input
              ref={folderInputRef}
              type="file"
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={handleFolderInput}
            />
            <p className="mt-2 text-xs text-ink-3 leading-relaxed">
              You'll see what was found and what it costs before anything is imported.
              Secrets like <code className="font-mono">.env</code> and private keys are
              excluded automatically.
            </p>
          </div>
        )}

        {/* Cloud tab */}
        {activeTab === 'cloud' && (
          <CloudBrowser
            connections={connections}
            cloudBusy={cloudBusy}
            cloudProgress={cloudProgress}
            cloudError={cloudError}
            onImport={onCloudImport}
            onCancel={onCancelCloud}
          />
        )}

        {/* URL tab */}
        {activeTab === 'url' && (
          <div>
            <form onSubmit={handleUrlSubmit}>
              <input
                type="text"
                inputMode="url"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                placeholder="example.com/article"
                className="w-full text-sm border border-line rounded-lg px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-brand"
              />
              {/* Crawl toggle */}
              <label className="flex items-center gap-2 mt-2.5 text-xs text-ink-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={crawl}
                  onChange={(e) => setCrawl(e.target.checked)}
                  className="w-3.5 h-3.5 accent-brand"
                />
                Also follow links on this page
              </label>

              {crawl && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-xs text-ink-3">
                    Depth
                    <select
                      value={crawlDepth}
                      onChange={(e) => setCrawlDepth(e.target.value)}
                      className="mt-1 w-full text-xs bg-surface-3 rounded-lg px-2 py-1.5 text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      <option value={1}>1 — linked pages</option>
                      <option value={2}>2 — and their links</option>
                    </select>
                  </label>
                  <label className="text-xs text-ink-3">
                    Max pages
                    <select
                      value={crawlMax}
                      onChange={(e) => setCrawlMax(e.target.value)}
                      className="mt-1 w-full text-xs bg-surface-3 rounded-lg px-2 py-1.5 text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </label>
                </div>
              )}

              <button
                type="submit"
                disabled={!urlValue.trim() || urlLoading}
                className="mt-2 w-full py-2 text-sm font-medium bg-brand hover:bg-brand-hover text-brand-on rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {urlLoading && (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {urlLoading ? (crawl ? 'Crawling…' : 'Fetching…') : (crawl ? 'Crawl Site' : 'Fetch Page')}
              </button>
            </form>

            {/* Live crawl progress */}
            {crawlProgress && (
              <div className="mt-2 bg-surface-3 rounded-lg px-3 py-2.5">
                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-ink-2">
                  <span>{crawlProgress.fetched} fetched</span>
                  <span className="text-ink-3">{crawlProgress.queued} queued</span>
                </div>
                {crawlProgress.current && (
                  <p className="mt-1 text-[11px] text-ink-3 font-mono break-url leading-snug">
                    {crawlProgress.current}
                  </p>
                )}
                <button
                  onClick={onCancelCrawl}
                  className="mt-2 w-full py-1.5 text-xs font-medium text-ink-3 hover:text-bad-ink hover:bg-bad-soft rounded-full transition-colors"
                >
                  Stop crawling
                </button>
              </div>
            )}

            {urlError && (
              <p className="mt-2 text-xs text-bad-ink bg-bad-soft border border-bad-line rounded-lg px-3 py-2 break-url">
                {urlError}
              </p>
            )}

            <p className="mt-2 text-xs text-ink-3 leading-relaxed">
              {crawl
                ? 'Follows same-origin links only, honours robots.txt, and pauses between requests. You review everything found before it is imported.'
                : 'Fetches the page and extracts its readable text, dropping navigation and scripts. HTML, PDF, Markdown, CSV, JSON and Office files all work.'}
            </p>
            {!import.meta.env.DEV && (
              <p className="mt-2 text-xs text-warn-ink bg-warn-soft border border-warn-line rounded-lg px-3 py-2">
                This is a production build with no CORS proxy, so most sites will refuse
                the request. URL import works under <code className="font-mono">npm run dev</code>.
              </p>
            )}
          </div>
        )}

        {/* Paste tab */}
        {activeTab === 'paste' && (
          <div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste your document text here…"
              className="w-full text-sm border border-line rounded-lg px-3 py-2 text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand h-32 resize-y overflow-auto"
            />
            <button
              onClick={handlePasteAdd}
              disabled={!pasteText.trim()}
              className="mt-2 w-full py-2 text-sm font-medium bg-brand hover:bg-brand-hover text-brand-on rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add Document
            </button>
          </div>
        )}
      </div>

      {/* Document list */}
      {documents.length > 0 && (
        <div className="px-5 pb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-ink-3 uppercase tracking-wide">
              Documents
            </p>
            {documents.length > 1 && (
              <span className="text-xs text-ink-3">
                {documents.length} queued
              </span>
            )}
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
            {documents.map((doc) => {
              const fp = fileProgress[doc.id]
              return (
                <div
                  key={doc.id}
                  onClick={() => onSetActive(doc.id)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                    doc.id === activeDocumentId
                      ? 'bg-brand-soft border border-brand-soft'
                      : 'hover:bg-surface-2 border border-transparent'
                  } ${fp?.status === 'processing' ? 'ring-1 ring-brand' : ''}`}
                >
                  <svg className="w-4 h-4 text-ink-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-ink-2 truncate">{doc.name}</p>
                    <p className="text-xs text-ink-3">{doc.sizeFormatted} · {doc.charCount.toLocaleString()} chars</p>
                  </div>
                  {/* Processing status badge */}
                  <DocStatusBadge status={fp?.status} pairCount={fp?.pairCount} />
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(doc.id) }}
                    title={`Remove ${doc.name}`}
                    aria-label={`Remove ${doc.name}`}
                    className="text-ink-3 hover:text-bad transition-colors flex-shrink-0 ml-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Active document preview */}
      {activeDoc && (
        <div className="px-4 pb-3">
          {/* Long doc info */}
          {activeDoc.charCount > CHAR_LIMIT && (
            <div className="mb-2 bg-info-soft border border-info-line rounded-lg p-2.5 text-xs text-info-ink">
              <p className="font-semibold mb-1">
                Large document — {activeDoc.charCount.toLocaleString()} chars
              </p>
              {(() => {
                const chunkCount = estimateChunks(activeDoc.text, CHUNK_SIZE)
                return (
                  <p>
                    Will be split into ~{chunkCount} chunk{chunkCount !== 1 ? 's' : ''} and processed
                    in parallel. Pairs are distributed evenly across chunks for full coverage.
                  </p>
                )
              })()}
            </div>
          )}

          <p className="text-xs font-medium text-ink-3 uppercase tracking-wide mb-1">Preview</p>
          <div className="bg-surface-2 rounded-lg p-2.5 text-xs text-ink-2 leading-relaxed max-h-32 overflow-y-auto scrollbar-thin font-mono whitespace-pre-wrap break-words">
            {previewText}
            {needsExpand && <span className="text-ink-3">…</span>}
          </div>
          {activeDoc.text.length > PREVIEW_LENGTH && (
            <button
              onClick={() => setShowFullPreview((v) => !v)}
              className="mt-1 text-xs text-brand-ink hover:text-brand-ink"
            >
              {showFullPreview ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 z-50 bg-bad text-surface text-sm px-4 py-3 rounded-xl shadow-lg flex items-start gap-2 max-w-xs">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="flex-1 min-w-0 break-url">{error}</p>
          <button onClick={onClearError} className="text-surface/70 hover:text-surface">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
