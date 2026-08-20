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
    addPaste,
    removeDocument,
    setActiveDocument,
    restoreDocuments,
    clearAllDocuments,
    clearError,
    CHAR_LIMIT,
  }
}
