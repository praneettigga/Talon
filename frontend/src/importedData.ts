export interface ImportedTransaction {
  id: string
  accountId: string
  counterparty: string
  direction: 'outgoing' | 'incoming'
  amount: number | null
  device: string
  merchant: string
  txRisk: number | null
  fraudType: string
  timestamp: string
  sourceFile: string
  sourceRow: number
}

export interface ImportedAccount {
  id: string
  fraudType: string
  risk: number
  sourceRisk: number | null
  reportedTransactions: number | null
  reportedAmount: number | null
  reportedDevices: number | null
  reportedMerchants: number | null
  transactions: ImportedTransaction[]
  devices: string[]
  merchants: string[]
  linked: boolean
}

export interface ImportedDataset {
  name: string
  accounts: ImportedAccount[]
  transactionCount: number
}

interface ParsedRow {
  values: Record<string, string>
  rowNumber: number
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(value)
      value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(value)
      if (row.some(cell => cell.trim())) rows.push(row)
      row = []
      value = ''
    } else value += character
  }
  row.push(value)
  if (row.some(cell => cell.trim())) rows.push(row)
  return rows
}

function key(value: string) {
  return value.replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function cell(values: Record<string, string>, ...names: string[]) {
  for (const name of names) {
    const found = values[key(name)]
    if (found?.trim()) return found.trim()
  }
  return ''
}

function numberValue(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value.replace(/[,\s$€£]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function riskValue(value: string): number | null {
  const parsed = numberValue(value)
  if (parsed == null) return null
  return Math.max(0, Math.min(100, parsed > 0 && parsed <= 1 ? parsed * 100 : parsed))
}

function fraudLabel(values: Record<string, string>) {
  const label = cell(values, 'fraud_type', 'fraudType', 'fraud_typology', 'typology', 'scam_type', 'fraud_label')
  if (label && !['0', 'false', 'no', 'clean', 'none', 'normal'].includes(label.toLowerCase())) return label
  const fraudFlag = cell(values, 'is_fraud', 'isFraud', 'fraud_flag', 'fraudulent', 'flagged')
  if (['1', 'true', 'yes', 'fraud', 'flagged'].includes(fraudFlag.toLowerCase())) return 'Flagged transaction'
  return ''
}

function rowsFromFile(filename: string, text: string): ParsedRow[] {
  const [header = [], ...rows] = parseCsv(text)
  const columns = header.map(key)
  return rows.map((row, index) => ({
    values: Object.fromEntries(columns.map((column, columnIndex) => [column, row[columnIndex] ?? ''])),
    rowNumber: index + 2,
  }))
}

export function parseImportedFiles(files: Array<{ name: string; text: string }>): ImportedDataset {
  const accounts = new Map<string, ImportedAccount>()
  const sharedTransactions = new Map<string, ImportedTransaction>()
  const sourceRows = new Set<string>()
  const deviceOwners = new Map<string, Set<string>>()

  const accountFor = (id: string, type: string, sourceRisk: number | null = null) => {
    if (!id) return null
    const current = accounts.get(id) ?? {
      id, fraudType: '', risk: 18, sourceRisk: null, reportedTransactions: null, reportedAmount: null,
      reportedDevices: null, reportedMerchants: null, transactions: [], devices: [], merchants: [], linked: false,
    }
    if (type) current.fraudType = type
    if (sourceRisk != null) current.sourceRisk = sourceRisk
    accounts.set(id, current)
    return current
  }

  for (const file of files) {
    const rows = rowsFromFile(file.name, file.text)
    for (const row of rows) {
      const values = row.values
      const from = cell(values, 'account_id', 'accountId', 'account', 'customer_id', 'user_id', 'nameOrig', 'source_account', 'from_account', 'origin_account')
      const to = cell(values, 'destination_account', 'to_account', 'target_account', 'counterparty_account', 'nameDest')
      const transactionRisk = cell(values, 'tx_risk', 'txRisk', 'transaction_risk')
      const genericRisk = cell(values, 'risk_score', 'riskScore', 'risk')
      const amount = numberValue(cell(values, 'amount', 'transaction_amount', 'amount_paid', 'value', 'transaction_value'))
      const device = cell(values, 'device_id', 'deviceId', 'device', 'device_fingerprint', 'terminal_id')
      const merchant = cell(values, 'merchant_id', 'merchantId', 'merchant', 'merchant_name', 'payee', 'store_id')
      const reportedTransactions = numberValue(cell(values, 'tx_count', 'transaction_count', 'total_transactions', 'transactions_count'))
      const reportedAmount = numberValue(cell(values, 'total_amount', 'transaction_total', 'amount_total'))
      const reportedDevices = numberValue(cell(values, 'device_count', 'devices_count'))
      const reportedMerchants = numberValue(cell(values, 'merchant_count', 'merchants_count'))
      const type = fraudLabel(values)
      const transactionId = cell(values, 'transaction_id', 'transactionId', 'tx_id', 'transfer_id', 'event_id')
      const id = transactionId || `${file.name}:${row.rowNumber}`
      const timestamp = cell(values, 'timestamp', 'datetime', 'date_time', 'date', 'created_at', 'step')
      const isTransaction = amount != null || Boolean(transactionRisk) || Boolean(to) || Boolean(transactionId)
      const directRisk = riskValue(transactionRisk || (isTransaction ? genericRisk : ''))
      const sourceRisk = riskValue(cell(values, 'account_risk', 'account_risk_score', 'entity_risk')) ?? (!isTransaction ? riskValue(genericRisk) : null)

      const fromAccount = from ? accountFor(from, type, sourceRisk) : null
      if (fromAccount && !isTransaction) {
        if (reportedTransactions != null) fromAccount.reportedTransactions = reportedTransactions
        if (reportedAmount != null) fromAccount.reportedAmount = reportedAmount
        if (reportedDevices != null) fromAccount.reportedDevices = reportedDevices
        if (reportedMerchants != null) fromAccount.reportedMerchants = reportedMerchants
      }
      if (device && fromAccount && !fromAccount.devices.includes(device)) fromAccount.devices.push(device)
      if (merchant && fromAccount && !fromAccount.merchants.includes(merchant)) fromAccount.merchants.push(merchant)
      if (device && fromAccount) {
        const owners = deviceOwners.get(device) ?? new Set<string>()
        owners.add(from)
        deviceOwners.set(device, owners)
      }
      if (to) accountFor(to, type, sourceRisk)
      if (!isTransaction) continue
      sourceRows.add(`${file.name}:${row.rowNumber}`)

      for (const [accountId, counterparty, direction] of [[from, to, 'outgoing'], [to, from, 'incoming']] as const) {
        const account = accountFor(accountId, type, sourceRisk)
        if (!account) continue
        const transaction: ImportedTransaction = {
          id, accountId, counterparty, direction, amount, device, merchant,
          txRisk: directRisk, fraudType: type, timestamp,
          sourceFile: file.name, sourceRow: row.rowNumber,
        }
        const transactionKey = `${accountId}\u0000${id}`
        if (!sharedTransactions.has(transactionKey)) {
          sharedTransactions.set(transactionKey, transaction)
          account.transactions.push(transaction)
        }
        account.linked = true
        if (device && !account.devices.includes(device)) account.devices.push(device)
        if (merchant && !account.merchants.includes(merchant)) account.merchants.push(merchant)
        if (device) {
          const owners = deviceOwners.get(device) ?? new Set<string>()
          owners.add(accountId)
          deviceOwners.set(device, owners)
        }
      }
    }
  }

  for (const account of accounts.values()) {
    const txRisks = account.transactions.map(item => item.txRisk).filter((score): score is number => score != null)
    const roundAmountCount = account.transactions.filter(item => item.amount != null && item.amount > 0 && item.amount % 100 === 0).length
    const sharedDevice = account.devices.some(device => (deviceOwners.get(device)?.size ?? 0) > 1)
    const observedSignals = (account.transactions.length >= 5 ? 1 : 0) + (account.devices.length > 1 ? 1 : 0) + (roundAmountCount > 0 ? 1 : 0) + (sharedDevice ? 1 : 0)
    const derivedRisk = Math.min(82, 22 + observedSignals * 12 + (account.transactions.length >= 10 ? 8 : 0))
    account.risk = account.sourceRisk ?? (txRisks.length ? Math.max(...txRisks) : account.fraudType ? 96 : account.linked ? derivedRisk : 18)
    account.fraudType ||= account.linked ? 'Unlabelled' : 'Unlinked'
  }

  const importedAccounts = [...accounts.values()].sort((a, b) => b.risk - a.risk || a.id.localeCompare(b.id))
  const reportedTransactionTotal = importedAccounts.reduce((sum, account) => sum + (account.reportedTransactions ?? 0), 0)
  return {
    name: files.map(file => file.name).join(' · '),
    accounts: importedAccounts,
    transactionCount: sourceRows.size || reportedTransactionTotal,
  }
}

export function accountReasons(account: ImportedAccount, allAccounts: ImportedAccount[]): string[] {
  const reasons: string[] = []
  const transactionCount = Math.max(account.transactions.length, account.reportedTransactions ?? 0)
  const sharedDevices = account.devices.filter(device => allAccounts.some(other => other.id !== account.id && other.devices.includes(device)))
  const roundAmounts = account.transactions.filter(item => item.amount != null && item.amount > 0 && item.amount % 100 === 0).length
  const nearThresholdAmounts = account.transactions.filter(item => item.amount != null && [500, 1_000, 5_000, 10_000, 50_000, 100_000].some(limit => item.amount! < limit && item.amount! >= limit * 0.95)).length
  const highRiskTransactions = account.transactions.filter(item => item.txRisk != null && item.txRisk >= 70).length

  reasons.push(`${transactionCount} transaction row${transactionCount === 1 ? '' : 's'} observed for this account.`)
  if (account.devices.length > 1) reasons.push(`Activity spans ${account.devices.length} distinct devices.`)
  else if (account.devices.length === 1) reasons.push(account.transactions.length
    ? `One device identifier appears across ${account.transactions.filter(item => item.device === account.devices[0]).length} transaction rows.`
    : 'One device identifier is present in the imported account data.')
  else if (account.reportedDevices != null) reasons.push(`The dataset reports ${account.reportedDevices} devices, but their identifiers are not included.`)
  else reasons.push('No device identifiers were supplied in the imported rows.')
  if (sharedDevices.length) {
    const otherAccounts = allAccounts.filter(other => other.id !== account.id && sharedDevices.some(device => other.devices.includes(device))).length
    reasons.push(`Device ${sharedDevices[0]} is also used by ${otherAccounts} other account(s).`)
  }
  else reasons.push('No shared device links were found in the imported rows.')
  if (nearThresholdAmounts) reasons.push(`${nearThresholdAmounts} amount${nearThresholdAmounts === 1 ? '' : 's'} fall just below common round thresholds.`)
  else if (roundAmounts) reasons.push(`${roundAmounts} amount${roundAmounts === 1 ? '' : 's'} use a round value, which can warrant review against transfer limits.`)
  else if (account.transactions.some(item => item.amount != null)) reasons.push('No round-value amounts were found in this account’s imported transactions.')
  else if (account.reportedAmount != null) reasons.push(`A total amount of ${account.reportedAmount.toLocaleString()} was reported without per-transaction amounts.`)
  else reasons.push('Transaction amount values were not supplied for this account.')
  if (highRiskTransactions) reasons.push(`${highRiskTransactions} transaction risk value${highRiskTransactions === 1 ? '' : 's'} are at or above 70.`)
  else if (account.sourceRisk != null && account.sourceRisk >= 70) reasons.push(`The imported account risk score is ${account.sourceRisk.toFixed(1)}.`)
  else if (account.fraudType !== 'Unlabelled' && account.fraudType !== 'Unlinked') reasons.push(`The imported label marks this account as ${account.fraudType}.`)
  else if (account.merchants.length > 1) reasons.push(`Activity spans ${account.merchants.length} distinct merchants.`)
  else if (transactionCount > 1) reasons.push('Repeated transactions are present in the imported account rows.')
  else reasons.push('No additional risk labels were supplied for this account.')
  return reasons.slice(0, 5)
}
