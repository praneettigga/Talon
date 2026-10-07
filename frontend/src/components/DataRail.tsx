import { useMemo, useState } from 'react'
import { ChevronDown, Database, FileSpreadsheet, Search, Table2, X } from 'lucide-react'
import type { DataTable, SourceRowRef, TableRecord } from '../types'

type Props = {
  tables: DataTable[]
  activeTable: string
  source: SourceRowRef | null
  onTable: (file: string) => void
  onRow: (table: DataTable, row: TableRecord) => void
  open: boolean
  onClose: () => void
  dataset?: string
  cursor?: number
  total?: number
}

function displayValue(key: string, value: string) {
  if (key === 'risk_score' && value && Number.isFinite(Number(value))) return <span className={`table-risk ${Number(value) >= 85 ? 'risk-high' : Number(value) >= 60 ? 'risk-mid' : 'risk-low'}`}>{Number(value).toFixed(1)}</span>
  if (key === 'severity') return <span className={`severity-tag severity-${value?.toLowerCase()}`}>{value}</span>
  if (key === 'amount') return value
  if (key === 'source_row') return value ? `Source row ${value}` : '—'
  if (value?.includes('T')) return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return value || '—'
}

export default function DataRail({ tables, activeTable, source, onTable, onRow, open, onClose, dataset, cursor, total }: Props) {
  const [query, setQuery] = useState('')
  const [showAllColumns, setShowAllColumns] = useState(false)
  const table = tables.find((item) => item.name === activeTable) ?? tables[0]
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? table.rows.filter((row) => Object.values(row.values).some((value) => value.toLowerCase().includes(needle))) : table.rows
  }, [query, table])
  const columns = showAllColumns ? table.columns : table.columns.slice(0, 5)

  return (
    <>
      {open && <button className="rail-backdrop" aria-label="Close data panel" onClick={onClose} />}
      <aside className={`data-rail ${open ? 'data-rail-open' : ''}`}>
        <div className="rail-heading">
          <div className="rail-title-group">
            <span className="icon-tile"><Database size={16} /></span>
            <div><div className="eyebrow">SOURCE EXPLORER</div><h2>Data room</h2></div>
          </div>
          <button className="icon-button rail-close" onClick={onClose} aria-label="Close data room"><X size={17} /></button>
        </div>
        <div className="demo-source-banner"><span className="live-dot" /> OBSERVED REPLAY SNAPSHOT <span className="source-count">{tables.length} TABLES</span></div>
        <div className="data-scope-note">{dataset || 'Waiting for replay dataset'} · {cursor ?? 0} of {total ?? 0} transfers observed. Tables reflect the backend replay prefix.</div>
        <div className="table-file-list" role="tablist" aria-label="Talon replay data tables">
          {tables.map((item) => (
            <button key={item.name} className={`file-tab ${activeTable === item.name ? 'file-tab-active' : ''}`} onClick={() => { onTable(item.name); setQuery('') }} role="tab" aria-selected={activeTable === item.name}>
              <FileSpreadsheet size={14} /><span>{item.name}</span><small>{item.rows.length}</small>
            </button>
          ))}
        </div>
        <div className="table-caption">
          <div><span className="eyebrow">TABLE PREVIEW</span><strong>{table.label}</strong></div>
          <button className="icon-button tiny" aria-label="Choose visible columns" onClick={() => setShowAllColumns((value) => !value)} title="Toggle columns"><Table2 size={15} /></button>
        </div>
        <label className="table-search" data-shortcut="table-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${table.label.toLowerCase()}…`} /><kbd>⌘ K</kbd></label>
        {source?.file === table.name && (
          <div className="source-link-card">
            <span className="source-link-icon"><Database size={13} /></span>
            <div><strong>{source.value}</strong><span>{source.file}{source.sourceRow ? <> <b>·</b> source row {source.sourceRow}</> : <> <b>·</b> observed record</>}</span></div>
            <span className="linked-badge">LINKED</span>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead><tr><th className="row-index">#</th>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, index) => {
                const selected = source?.file === table.name && source.id === row.id
                return <tr key={row.id} className={selected ? 'source-row-selected' : ''} onClick={() => onRow(table, row)}>
                  <td className="row-index">{String(index + 1).padStart(2, '0')}</td>
                  {columns.map((column) => <td key={column} title={row.values[column]}>{displayValue(column, row.values[column])}</td>)}
                </tr>
              })}
              {rows.length === 0 && <tr><td colSpan={columns.length + 1} className="table-empty">No matching rows</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="rail-footer"><span><span className="tiny-status" /> Replay snapshot</span><span>{rows.length} visible <b>·</b> JSON</span></div>
        <button className="mobile-close-label" onClick={onClose}>Close data room <ChevronDown size={14} /></button>
      </aside>
    </>
  )
}
