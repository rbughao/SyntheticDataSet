import { useRef, useCallback, useEffect, memo } from 'react'
import { VariableSizeList } from 'react-window'
import PairCard from './PairCard.jsx'

// Above this count the plain DOM list is swapped for a virtualized one.
// Below it, drag-to-reorder stays available (dnd-kit needs real DOM nodes).
export const VIRTUALIZE_THRESHOLD = 100

// Starting guess before a row has been measured.
const ESTIMATED_ROW_HEIGHT = 340

/**
 * Windowed pair list — renders only the ~15 cards in view regardless of how
 * many pairs exist, so 10 000 pairs scroll as smoothly as 10.
 *
 * Row heights vary (auto-growing textareas), so each row measures itself with a
 * ResizeObserver and reports back; the list then re-flows from that index.
 */
export default function VirtualPairList({
  pairs,
  height,
  selectedIds,
  issuesById,
  duplicateIds,
  onUpdate,
  onDelete,
  onRegenerate,
  onToggleSelect,
}) {
  const listRef = useRef(null)
  const heightsRef = useRef(new Map()) // pair.id -> measured px

  const getItemSize = useCallback(
    (index) => heightsRef.current.get(pairs[index]?.id) ?? ESTIMATED_ROW_HEIGHT,
    [pairs]
  )

  const setItemSize = useCallback((id, px, index) => {
    const prev = heightsRef.current.get(id)
    // Ignore sub-pixel jitter — re-flowing on every 0.5px change thrashes scroll
    if (prev !== undefined && Math.abs(prev - px) < 2) return
    heightsRef.current.set(id, px)
    listRef.current?.resetAfterIndex(index)
  }, [])

  // Pair set changed (filter, delete, new run) — drop stale measurements
  useEffect(() => {
    listRef.current?.resetAfterIndex(0)
  }, [pairs.length])

  const itemKey = useCallback((index) => pairs[index].id, [pairs])

  return (
    <VariableSizeList
      ref={listRef}
      height={height}
      width="100%"
      itemCount={pairs.length}
      itemSize={getItemSize}
      itemKey={itemKey}
      estimatedItemSize={ESTIMATED_ROW_HEIGHT}
      overscanCount={3}
    >
      {({ index, style }) => (
        <MeasuredRow
          style={style}
          index={index}
          pair={pairs[index]}
          isSelected={selectedIds.has(pairs[index].id)}
          issues={issuesById?.get(pairs[index].id)}
          isDuplicate={duplicateIds?.has(pairs[index].id)}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onRegenerate={onRegenerate}
          onToggleSelect={onToggleSelect}
          onMeasure={setItemSize}
        />
      )}
    </VariableSizeList>
  )
}

const MeasuredRow = memo(function MeasuredRow({
  style,
  index,
  pair,
  isSelected,
  issues,
  isDuplicate,
  onUpdate,
  onDelete,
  onRegenerate,
  onToggleSelect,
  onMeasure,
}) {
  const nodeRef = useRef(null)

  useEffect(() => {
    const el = nodeRef.current
    if (!el) return
    const report = () => onMeasure(pair.id, el.getBoundingClientRect().height, index)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pair.id, index, onMeasure])

  return (
    <div style={style}>
      <div ref={nodeRef}>
        <PairCard
          pair={pair}
          index={index}
          isSelected={isSelected}
          issues={issues}
          isDuplicate={isDuplicate}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onRegenerate={onRegenerate}
          onToggleSelect={onToggleSelect}
        />
      </div>
    </div>
  )
})
