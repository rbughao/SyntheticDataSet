import { useReducer, useCallback } from 'react'
import { readFile, readPastedText } from '../utils/fileReader.js'

const CHAR_LIMIT = 10000

function docsReducer(state, action) {
  switch (action.type) {
    case 'ADD':
      return {
        ...state,
        documents: [...state.documents, action.doc],
        activeDocumentId: state.activeDocumentId ?? action.doc.id,
      }
    case 'ADD_MANY':
      return {
        ...state,
        documents: [...state.documents, ...action.docs],
        activeDocumentId: state.activeDocumentId ?? action.docs[0]?.id ?? null,
      }
    case 'REMOVE': {
      const remaining = state.documents.filter((d) => d.id !== action.id)
      const activeId =
        state.activeDocumentId === action.id
          ? (remaining[0]?.id ?? null)
          : state.activeDocumentId
      return { ...state, documents: remaining, activeDocumentId: activeId }
    }
    case 'SET_ACTIVE':
      return { ...state, activeDocumentId: action.id }
    case 'RESTORE':
      return {
        ...state,
        documents: action.documents,
        activeDocumentId: action.documents[0]?.id ?? null,
      }
    case 'CLEAR_ALL':
      return { ...state, documents: [], activeDocumentId: null }
    case 'SET_ERROR':
      return { ...state, error: action.message }
    case 'CLEAR_ERROR':
      return { ...state, error: null }
    case 'SET_LOADING':
      return { ...state, loading: action.value }
    default:
      return state
  }
}

const initialState = {
  documents: [],
  activeDocumentId: null,
  error: null,
  loading: false,
}

export function useDocuments() {
  const [state, dispatch] = useReducer(docsReducer, initialState)

  const makeDoc = (raw) => ({
    id: crypto.randomUUID(),
    name: raw.name,
    text: raw.text,
    // 'prose' | 'code' | 'data' — selects the chunker's boundary strategy
    kind: raw.kind || 'prose',
    size: raw.size,
    sizeFormatted: raw.sizeFormatted,
    charCount: raw.charCount,
  })

  const addFile = useCallback(async (file) => {
    dispatch({ type: 'SET_LOADING', value: true })
    try {
      const raw = await readFile(file)
      dispatch({ type: 'ADD', doc: makeDoc(raw) })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', message: err.message })
    } finally {
      dispatch({ type: 'SET_LOADING', value: false })
    }
  }, [])

  /**
   * Read and add many files at once (folder import, URL fetch).
   *
   * Files are read sequentially rather than in parallel: reads are fast and
   * local, but a few thousand concurrent FileReaders will exhaust memory.
   * Individual failures are collected and reported instead of aborting the
   * whole import.
   *
   * @param {File[]} files
   * @param {(done:number, total:number)=>void} [onProgress]
   * @returns {Promise<{ added:number, failed:Array<{name:string,message:string}> }>}
   */
  const addFiles = useCallback(async (files, onProgress) => {
    dispatch({ type: 'SET_LOADING', value: true })
    const docs = []
    const failed = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const raw = await readFile(file)
        docs.push(makeDoc(raw))
      } catch (err) {
        failed.push({ name: file.name, message: err.message })
      }
      onProgress?.(i + 1, files.length)
    }

    if (docs.length) dispatch({ type: 'ADD_MANY', docs })
    if (failed.length) {
      dispatch({
        type: 'SET_ERROR',
        message: failed.length === 1
          ? `Could not read ${failed[0].name}: ${failed[0].message}`
          : `Skipped ${failed.length} unreadable files (e.g. ${failed[0].name}).`,
      })
    }
    dispatch({ type: 'SET_LOADING', value: false })
    return { added: docs.length, failed }
  }, [])

  const addPaste = useCallback((text, label) => {
    if (!text.trim()) return
    const raw = readPastedText(text, label)
    dispatch({ type: 'ADD', doc: makeDoc(raw) })
  }, [])

  const removeDocument = useCallback((id) => {
    dispatch({ type: 'REMOVE', id })
  }, [])

  const setActiveDocument = useCallback((id) => {
    dispatch({ type: 'SET_ACTIVE', id })
  }, [])

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' })
  }, [])

  /** Rehydrate documents from a persisted session snapshot. */
  const restoreDocuments = useCallback((documents) => {
    if (documents?.length) dispatch({ type: 'RESTORE', documents })
  }, [])

  const clearAllDocuments = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL' })
  }, [])

  const activeDocument = state.documents.find((d) => d.id === state.activeDocumentId) ?? null

  return {
    documents: state.documents,
    activeDocument,
    activeDocumentId: state.activeDocumentId,
    loading: state.loading,
    error: state.error,
    addFile,
    addFiles,
    addPaste,
    removeDocument,
    setActiveDocument,
    restoreDocuments,
    clearAllDocuments,
    clearError,
    CHAR_LIMIT,
  }
}
