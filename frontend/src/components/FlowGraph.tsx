import { useEffect, useRef } from 'react'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import type { AccountRecord, TransactionRecord } from '../types'

type Props = {
  caseId: string
  accounts: AccountRecord[]
  transactions: TransactionRecord[]
  focusedAccountId: string
  focusedTransactionId: string
  replayTransactionId: string
  heldAccountIds: string[]
  interruptedTransferIds: string[]
  onAccount: (account: AccountRecord) => void
  onTransaction: (transaction: TransactionRecord) => void
}

export default function FlowGraph({ caseId, accounts, transactions, focusedAccountId, focusedTransactionId,
  replayTransactionId, heldAccountIds, interruptedTransferIds, onAccount, onTransaction }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const graph = useRef<Core | null>(null)
  const propsRef = useRef<Props | null>(null)
  const firstLayout = useRef(true)
  propsRef.current = { caseId, accounts, transactions, focusedAccountId, focusedTransactionId,
    replayTransactionId, heldAccountIds, interruptedTransferIds, onAccount, onTransaction }

  useEffect(() => {
    if (!container.current) return
    const cy = cytoscape({
      container: container.current,
      elements: [],
      minZoom: 0.35,
      maxZoom: 2.5,
      wheelSensitivity: 0.18,
      style: [
        { selector: 'node', style: {
          'background-color': '#172633', 'border-color': '#417f79', 'border-width': 1,
          label: 'data(label)', color: '#dce9e7', 'font-size': 10, 'font-weight': 600,
          'text-wrap': 'wrap', 'text-max-width': '94px', 'text-valign': 'bottom', 'text-margin-y': 10,
          width: 30, height: 30, 'overlay-opacity': 0,
        } },
        { selector: 'node[role = "collector"]', style: { 'background-color': '#482b31', 'border-color': '#ff8c79', 'border-width': 2, width: 42, height: 42 } },
        { selector: 'node[role = "intermediary"]', style: { 'background-color': '#3c3527', 'border-color': '#e7bb69', 'border-width': 2, width: 38, height: 38 } },
        { selector: 'node[role = "source"]', style: { 'background-color': '#1a3538', 'border-color': '#65c8b8' } },
        { selector: 'node[role = "destination"]', style: { 'background-color': '#252c3c', 'border-color': '#8b9ce1' } },
        { selector: 'edge', style: {
          width: 2, 'line-color': '#4f9d90', 'target-arrow-color': '#72dbc4', 'target-arrow-shape': 'triangle',
          'curve-style': 'bezier', 'control-point-step-size': 30, 'line-cap': 'round',
          label: 'data(label)', color: '#a9c9c5', 'font-size': 8, 'text-background-color': '#0e171e',
          'text-background-opacity': 0.94, 'text-background-padding': '3px', 'text-rotation': 'autorotate',
        } },
        { selector: '.focused', style: { 'border-color': '#f8d27f', 'border-width': 3, 'background-color': '#55452a' } },
        { selector: '.selected-edge', style: { 'line-color': '#f6c56d', 'target-arrow-color': '#f6c56d', width: 4, 'z-index': 9 } },
        { selector: '.replay-edge', style: { 'line-color': '#e9c77a', 'target-arrow-color': '#e9c77a', width: 3, 'z-index': 8 } },
        { selector: 'node.held', style: { 'border-color': '#ff5277', 'border-width': 4 } },
        { selector: 'edge.interrupted', style: { 'line-color': '#ff5277', 'target-arrow-color': '#ff5277', width: 4, 'line-style': 'dashed', 'z-index': 10 } },
      ],
    })
    cy.on('tap', 'node', event => {
      const account = propsRef.current?.accounts.find(item => item.account_id === event.target.id())
      if (account) propsRef.current?.onAccount(account)
    })
    cy.on('tap', 'edge', event => {
      const transaction = propsRef.current?.transactions.find(item => item.transaction_id === event.target.id())
      if (transaction) propsRef.current?.onTransaction(transaction)
    })
    graph.current = cy
    const observer = new ResizeObserver(() => cy.resize())
    observer.observe(container.current)
    return () => { observer.disconnect(); cy.destroy(); graph.current = null; firstLayout.current = true }
  }, [])

  useEffect(() => {
    const cy = graph.current
    if (!cy) return
    const currentAccounts = caseId
      ? accounts.filter(account => account.case_ids.includes(caseId))
      : accounts.filter(account => transactions.some(event => (event.source_account === account.account_id || event.destination_account === account.account_id) &&
          (!focusedAccountId || event.source_account === focusedAccountId || event.destination_account === focusedAccountId)))
    const accountIds = new Set(currentAccounts.map(account => account.account_id))
    const currentTransactions = transactions.filter(transaction => caseId
      ? transaction.case_id === caseId
      : focusedAccountId && (transaction.source_account === focusedAccountId || transaction.destination_account === focusedAccountId))
    const nodes: ElementDefinition[] = currentAccounts.map((account, index) => ({
      data: { id: account.account_id, label: account.display_name, role: account.role, risk: account.risk_score },
      position: { x: Math.cos(index * 2.399963) * (90 + index * 6), y: Math.sin(index * 2.399963) * (90 + index * 6) },
    }))
    const edges: ElementDefinition[] = currentTransactions
      .filter(transaction => accountIds.has(transaction.source_account) && accountIds.has(transaction.destination_account))
      .map(transaction => ({ data: {
        id: transaction.transaction_id,
        source: transaction.source_account,
        target: transaction.destination_account,
        label: `${transaction.amount} ${transaction.currency} · ${new Date(transaction.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        risk: transaction.risk_score,
      } }))
    const desiredIds = new Set([...nodes, ...edges].map(element => String(element.data?.id)))
    let addedNode = false
    cy.batch(() => {
      cy.elements().forEach(element => { if (!desiredIds.has(element.id())) element.remove() })
      nodes.forEach(element => {
        const id = String(element.data?.id)
        const existing = cy.getElementById(id)
        if (existing.length) existing.data(element.data ?? {})
        else { cy.add(element); addedNode = true }
      })
      edges.forEach(element => {
        const existing = cy.getElementById(String(element.data?.id))
        if (existing.length) existing.data(element.data ?? {})
        else cy.add(element)
      })
      cy.elements().removeClass('focused selected-edge replay-edge held interrupted')
      if (focusedAccountId) cy.getElementById(focusedAccountId).addClass('focused')
      if (focusedTransactionId) cy.getElementById(focusedTransactionId).addClass('selected-edge')
      else if (replayTransactionId) cy.getElementById(replayTransactionId).addClass('replay-edge')
      heldAccountIds.forEach(id => cy.getElementById(id).addClass('held'))
      interruptedTransferIds.forEach(id => cy.getElementById(id).addClass('interrupted'))
    })
    if (firstLayout.current && currentAccounts.length) {
      cy.layout({ name: 'cose', animate: false, fit: true, randomize: false, padding: 65 }).run()
      firstLayout.current = false
    } else if (addedNode) {
      cy.layout({ name: 'cose', animate: false, fit: false, randomize: false, padding: 35 }).run()
    }
  }, [caseId, accounts, transactions, focusedAccountId, focusedTransactionId, replayTransactionId, heldAccountIds, interruptedTransferIds])

  return <div className="flow-canvas" ref={container} aria-label={`Transaction flow for ${caseId || focusedAccountId || 'observed accounts'}`} />
}
