import type { DeviceContext, EnrichmentSnapshot, InfrastructureLink } from './api';

export function Enrichment({ context, links, account }: { context: EnrichmentSnapshot; links: InfrastructureLink[]; account?: DeviceContext }) {
  return <section className="synthetic-context" aria-label="Synthetic infrastructure context"><h3>Synthetic infrastructure context</h3>
    <p className="muted">{context.label}. Context only; frozen model scores and severity are unchanged.</p>
    {context.status === 'unavailable' ? <p className="muted">Unavailable: {context.error}</p> : <>
      {account && <p className="muted">{account.accountId}: {account.deviceId} · {account.ipCluster} · {account.location}<br />
        {account.scenario} · available since {account.firstSeen.replace('T', ' ')}</p>}
      {!links.length && <p className="muted">No shared synthetic context observed among this case's accounts.</p>}
      {links.map(link => <article key={link.id} className="context-card"><strong>{link.kind === 'device' ? 'Shared synthetic device' : 'Shared synthetic network'} · {link.value}</strong>
        <p>{link.facts[0]}</p><p className="muted">Accounts: {link.accountIds.join(', ')} · {link.scenarios.join(', ')}<br />
          {link.supportsStructure ? 'Additional context around an observed structure; not a model input.' : 'Sharing alone is not corroboration for escalation.'}<br />
          Available since {link.firstSeen.replace('T', ' ')}. {link.facts[1]}</p></article>)}
    </>}
  </section>;
}

export function EnrichmentControls({ context }: { context: EnrichmentSnapshot }) {
  const controls = context.links.filter(link => link.scenarios.includes('shared-network control'));
  return <section className="panel enrichment-summary" aria-label="Synthetic context controls"><h2>Synthetic device/network context · {context.status}</h2>
    <p className="muted">{context.label}. Sharing alone creates no alert and does not change frozen model scores or severity.</p>
    {context.status === 'unavailable' ? <p className="muted">{context.error}</p> : <details><summary>Legitimate-sharing demonstration control · {controls.length} observed shared network</summary>
      <p className="muted">This is a synthetic control scenario, not a classification of the IBM source accounts.</p>
      {controls.map(link => <p key={link.id} className="muted">{link.facts[0]}<br />Accounts: {link.accountIds.join(', ')} · distinct individual devices · {link.firstSeen.replace('T', ' ')}</p>)}
      {!controls.length && <p className="muted">The control appears when both assigned accounts are observed.</p>}
      <p className="muted">{Object.keys(context.accounts).length} observed accounts have synthetic context. Shared-device context is visible in the supporting case graph.</p>
    </details>}
  </section>;
}
