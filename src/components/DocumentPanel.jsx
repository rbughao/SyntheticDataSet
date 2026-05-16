import { useState, useRef, useEffect } from 'react'

const PREVIEW_LENGTH = 500
const CHAR_LIMIT = 10000

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentPanel({
  documents,
  activeDocumentId,
  loading,
  error,
  onAddFile,
  onAddPaste,
  onRemove,
  onSetActive,
  onClearError,
  onToggleAutoTruncate,
}) {
  const [activeTab, setActiveTab] = useState('upload')
  const [pasteText, setPasteText] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [showFullPreview, setShowFullPreview] = useState(false)
  const fileInputRef = useRef(null)

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

  function handleDrop(e) {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
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
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-base font-bold text-gray-900">Synthetic Dataset Generator</h1>
        <p className="text-xs text-gray-400 mt-0.5">by BughaoLabs</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 px-4">
        {['upload', 'paste'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'upload' ? 'Upload' : 'Paste'}
          </button>
        ))}
      </div>

      <div className="px-4 py-3">
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
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <svg className="w-8 h-8 mx-auto text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-gray-500">
                Drop files here or <span className="text-indigo-600 font-medium">browse</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">.txt · .md · .pdf · .docx</p>
              {loading && (
                <p className="text-xs text-indigo-500 mt-2 flex items-center justify-center gap-1">
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
              accept=".txt,.md,.pdf,.docx"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        )}

        {/* Paste tab */}
        {activeTab === 'paste' && (
          <div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste your document text here…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 h-32 resize-y overflow-auto"
            />
            <button
              onClick={handlePasteAdd}
              disabled={!pasteText.trim()}
              className="mt-2 w-full py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add Document
            </button>
          </div>
        )}
      </div>

      {/* Document list */}
      {documents.length > 0 && (
        <div className="px-4 pb-2">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Documents</p>
          <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
            {documents.map((doc) => (
              <div
                key={doc.id}
                onClick={() => onSetActive(doc.id)}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                  doc.id === activeDocumentId
                    ? 'bg-indigo-50 border border-indigo-200'
                    : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">{doc.name}</p>
                  <p className="text-xs text-gray-400">{doc.sizeFormatted} · {doc.charCount.toLocaleString()} chars</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(doc.id) }}
                  className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active document preview */}
      {activeDoc && (
        <div className="px-4 pb-3">
          {/* Long doc warning */}
          {activeDoc.charCount > CHAR_LIMIT && (
            <div className="mb-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-800">
              <p className="font-semibold mb-1">Document is long ({activeDoc.charCount.toLocaleString()} chars)</p>
              <p className="mb-1.5">Generation uses the first 6,000 characters.</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activeDoc.autoTruncate}
                  onChange={() => onToggleAutoTruncate(activeDoc.id)}
                  className="w-3.5 h-3.5 text-amber-600 rounded border-amber-300"
                />
                Auto-truncate enabled
              </label>
            </div>
          )}

          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Preview</p>
          <div className="bg-gray-50 rounded-lg p-2.5 text-xs text-gray-600 leading-relaxed max-h-32 overflow-y-auto scrollbar-thin font-mono whitespace-pre-wrap break-words">
            {previewText}
            {needsExpand && <span className="text-gray-400">…</span>}
          </div>
          {activeDoc.text.length > PREVIEW_LENGTH && (
            <button
              onClick={() => setShowFullPreview((v) => !v)}
              className="mt-1 text-xs text-indigo-500 hover:text-indigo-700"
            >
              {showFullPreview ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-600 text-white text-sm px-4 py-3 rounded-xl shadow-lg flex items-start gap-2 max-w-xs">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="flex-1">{error}</p>
          <button onClick={onClearError} className="text-red-200 hover:text-white">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
