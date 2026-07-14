import { prisma } from '@/lib/prisma';
import { plaidEnabled } from '@/lib/plaid';
import { Card, SectionHeader, Pill } from '../../_components/atoms';
import UploadForm from '../../_components/UploadForm';
import PlaidLinkButton from '../../_components/PlaidLinkButton';
import AmazonUploadForm from '../../_components/AmazonUploadForm';
import GmailSyncButton from '../../_components/GmailSyncButton';
import SimpleFinForm from '../../_components/SimpleFinForm';
import SimpleFinReconnectBtn from '../../_components/SimpleFinReconnectBtn';
import InstitutionDeleteBtn from '../../_components/InstitutionDeleteBtn';
import PayPalForm from '../../_components/PayPalForm';
import QuickenUploadForm from '../../_components/QuickenUploadForm';
import EmailArchiveUploadForm from '../../_components/EmailArchiveUploadForm';
import PdfUploadForm from '../../_components/PdfUploadForm';
import RefreshInstitutionBtn from '../../_components/RefreshInstitutionBtn';
import DataReadinessPanel from '../../_components/DataReadinessPanel';
import ConnectSourceGroup from '../../_components/ConnectSourceGroup';
import { ResizableTableShell } from '../../_components/useResizableColumns';
import { healthBadge } from '@/lib/syncHealth';
import { getDataReadiness } from '@/lib/dataReadiness';

const INST_COLS = [
  { key: 'name',     flex: 1.4,  min: 200 },
  { key: 'source',   width: 90,  min: 70 },
  { key: 'accounts', flex: 1,    min: 160 },
  { key: 'actions',  width: 220, min: 160, resizable: false },
];

export const dynamic = 'force-dynamic';

const REFRESHABLE = new Set(['simplefin', 'plaid', 'paypal']);

export default async function Connect() {
  const [insts, readiness] = await Promise.all([
    prisma.institution.findMany({
      include: {
        accounts: { include: { _count: { select: { transactions: true } } } },
      },
    }),
    getDataReadiness(),
  ]);
  const liveInsts = insts.filter(i => REFRESHABLE.has(i.source));
  const onetimeInsts = insts.filter(i => !REFRESHABLE.has(i.source));
  const liveCount = liveInsts.length;
  const txCountByInst = (i: typeof insts[number]) =>
    i.accounts.reduce((s, a) => s + a._count.transactions, 0);
  // SimpleFIN institutions with no accessToken are stuck - sync silently skips
  // them. Surface them at the top so the user can paste a fresh setup token.
  const disconnectedSf = insts.filter(i => i.source === 'simplefin' && !i.accessToken);
  const plaidOn = plaidEnabled();
  const lastSyncRow = await prisma.appSetting.findUnique({ where: { key: 'gmail_last_sync' } });
  // Detect if any user has granted gmail.readonly. Stored in the OAuth Account
  // `scope` column (space-delimited list of scopes granted).
  const gmailAccount = await prisma.account.findFirst({
    where: { provider: 'google', scope: { contains: 'gmail.readonly' } },
  });
  const gmailConnected = !!gmailAccount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow={`${insts.length} institution${insts.length === 1 ? '' : 's'} connected`}
        title="Connect"
        subtitle="Wire up banks, cards, ecommerce, and email. The more sources, the better the picture."
      />

      <DataReadinessPanel readiness={readiness} />

      {disconnectedSf.length > 0 && (
        <Card eyebrow="⚠ Needs reconnect" title="SimpleFIN institutions missing access token" padding={0}>
          <div style={{ padding: '10px 22px', fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
            These connections lost their access token. SimpleFIN sync silently skips them, which is why new charges (and new accounts like x2506) aren't appearing.
            Grab a fresh Setup Token at <a style={{ color: 'var(--accent)' }} href="https://beta-bridge.simplefin.org/" target="_blank" rel="noreferrer">beta-bridge.simplefin.org</a> and reconnect each one below.
          </div>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {disconnectedSf.map(i => (
              <div key={i.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 18, padding: '14px 22px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{i.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                    {i.accounts.length} account{i.accounts.length === 1 ? '' : 's'} attached - they keep their history, just need fresh credentials to refresh
                  </div>
                </div>
                <SimpleFinReconnectBtn institutionId={i.id} institutionName={i.name} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <div id="sources" style={{ display: 'flex', flexDirection: 'column', gap: 12, scrollMarginTop: 90 }}>
      <ConnectSourceGroup
        id="import-history"
        eyebrow="One-time imports"
        title="Bring in existing account history"
        description="Start with files you already have. Re-importing newer exports is safe because Astroledger de-duplicates transactions."
      >
        <Card eyebrow="Upload" title="CSV import">
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14 }}>
            Most banks export a CSV with Date, Description, Amount (or Debit/Credit). Works for checking, savings, credit cards, PayPal, Venmo. Duplicates are deduped by hash.
          </div>
          <UploadForm />
        </Card>

        <Card eyebrow="Upload · LLM" title="PDF bank statement"
              action={<Pill tone="info">Local Ollama</Pill>}>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14, lineHeight: 1.6 }}>
            Drop in any bank's monthly PDF statement. The local LLM extracts a structured transaction list - no per-bank parser required. Stays on this machine. Image-only/scanned PDFs need OCR (coming later).
          </div>
          <PdfUploadForm accounts={insts.flatMap(i => i.accounts.map(a => ({ id: a.id, label: `${i.name} ${a.mask ? `· ${a.mask}` : ''} (${a.name})` })))} />
        </Card>

        <Card eyebrow="Quicken family" title=".OFX / .QFX / .QBO / .QIF">
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14 }}>
            Most banks offer "Download for Quicken/QuickBooks" - that's an OFX-family file (<code>.qfx</code>, <code>.ofx</code>, or QuickBooks Web Connect <code>.qbo</code>) Astroledger parses directly. Quicken Desktop users: File → Export → QIF (include all accounts). A multi-account QIF brings over <strong>every account at once</strong> - checking, savings, credit, loans, AND investment accounts (securities, share lots, dividends, price history → holdings with FIFO cost basis). Quicken's <code>.QDF</code> binary itself isn't readable; export to QIF first.
          </div>
          <QuickenUploadForm />
        </Card>
      </ConnectSourceGroup>

      <ConnectSourceGroup
        id="automatic-connections"
        eyebrow="Automatic connections"
        title="Keep accounts current"
        description="Use a live provider when you want new transactions to arrive automatically. SimpleFIN is the recommended self-hoster-friendly option."
        open
      >

        <Card eyebrow="SimpleFIN" title="Bank link ($1.50/mo or $15/yr)"
              action={<Pill tone="success">Recommended</Pill>}>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14 }}>
            Personal-use bank aggregator covering most US banks. Cheapest real-bank option. No API keys needed - just paste a Setup Token from the SimpleFIN Bridge.
          </div>
          <SimpleFinForm />
        </Card>

        <Card eyebrow="Plaid" title="Bank Link (free dev tier)"
              action={plaidOn ? <Pill tone="success">Configured</Pill> : <Pill tone="warning">Not configured</Pill>}>
          {plaidOn ? (
            <>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14 }}>
                Plaid covers US/CA banks, PayPal, Venmo. Use <code>PLAID_ENV=development</code> for real banks free (up to 100 accounts). Sandbox creds: <code>user_good / pass_good</code>.
              </div>
              <PlaidLinkButton />
            </>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
              Set <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code> in <code>.env</code> to enable. Free at <a style={{ color: 'var(--accent)' }} href="https://dashboard.plaid.com/" target="_blank" rel="noreferrer">dashboard.plaid.com</a> (use <code>development</code> env for free real banks).
            </div>
          )}
        </Card>

        <Card eyebrow="Gmail" title="Receipt sync"
              action={<Pill tone={gmailConnected ? 'success' : 'ghost'}>{gmailConnected ? 'Connected' : 'Opt-in'}</Pill>}>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14 }}>
            Scans for order confirmations (Amazon, DoorDash, Uber, Apple, Lyft, Instacart, Etsy, Stripe-powered services).
            Sign-in does NOT request Gmail access - you have to opt in here.
          </div>
          <GmailSyncButton lastSync={lastSyncRow?.value ?? null} gmailConnected={gmailConnected} />
        </Card>

        <Card eyebrow="PayPal" title="REST API"
              action={<Pill tone="warning">Business only</Pill>}>
          <PayPalForm />
        </Card>

      </ConnectSourceGroup>

      <ConnectSourceGroup
        id="purchase-context"
        eyebrow="Receipts and orders"
        title="Explain what each charge purchased"
        description="Add item-level context from retailer exports or email without changing the bank ledger underneath."
      >

        <Card eyebrow="Amazon" title="Order history">
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14 }}>
            Request your data at <a style={{ color: 'var(--accent)' }} href="https://www.amazon.com/gp/privacycentral/dsar/preview.html" target="_blank" rel="noreferrer">amazon.com/gp/privacycentral</a> → "Your Orders". Upload the <code>Retail.OrderHistory</code> CSV here to tie items to charges.
          </div>
          <AmazonUploadForm />
        </Card>

        <Card eyebrow="Email archive" title="Upload .eml / .mbox / .zip">
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14 }}>
            Bring your own email archive - works with Outlook, Proton, Fastmail, Apple Mail, Google Takeout, etc. without granting any provider live read access. Parses receipts the same way Gmail sync does.
          </div>
          <EmailArchiveUploadForm />
        </Card>
      </ConnectSourceGroup>
      </div>

      <div id="connections" style={{ scrollMarginTop: 90 }}>
      <Card eyebrow="Live connections"
            title="Connected institutions"
            padding={0}
            action={liveCount > 0 ? <RefreshInstitutionBtn label="Refresh all" /> : undefined}>
        <div style={{ padding: '10px 22px', fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.55 }}>
          Plaid and SimpleFIN can pull new transactions on a schedule. Click <em>Refresh</em>
          to pull now, or wire up automatic syncs by pointing a scheduler (Task Scheduler,
          cron, GitHub Actions) at <code>POST /api/cron/sync</code> with your <code>CRON_SECRET</code>.
          The badge on each row shows when it last synced and whether credentials are still good.
        </div>
        <ResizableTableShell storageKey="astroledger-cols-institutions" columns={INST_COLS} gap={18}>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {liveInsts.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center' }}>
              No live connections yet - link a bank via Plaid or paste a SimpleFIN setup token above.
            </div>
          ) : liveInsts.map(i => {
            const disconnected = i.source === 'simplefin' && !i.accessToken;
            const health = healthBadge(i);
            return (
              <div key={i.id} style={{ display: 'grid', gridTemplateColumns: 'var(--cols)', gap: 18, padding: '14px 22px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    {i.name}
                    <Pill tone={health.tone} style={{ fontSize: 9 }} title={health.detail}>{health.label}</Pill>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{i.accounts.length} account{i.accounts.length === 1 ? '' : 's'}</div>
                </div>
                <Pill tone={i.source === 'plaid' ? 'success' : 'ghost'}>{i.source}</Pill>
                <div style={{ fontSize: 12, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {i.accounts.map(a => a.name).join(', ')}
                </div>
                <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center' }}>
                  {disconnected
                    ? <SimpleFinReconnectBtn institutionId={i.id} institutionName={i.name} />
                    : <RefreshInstitutionBtn institutionId={i.id} label="Refresh" size="sm" />}
                  <InstitutionDeleteBtn
                    institutionId={i.id}
                    institutionName={i.name}
                    accountCount={i.accounts.length}
                    txCount={txCountByInst(i)}
                    canDisconnect={!disconnected}
                  />
                </div>
              </div>
            );
          })}
        </div>
        </ResizableTableShell>
      </Card>
      </div>

      {onetimeInsts.length > 0 && (
        <Card eyebrow="One-time · file imports"
              title="Imported files"
              padding={0}>
          <div style={{ padding: '10px 22px', fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.55 }}>
            CSV, QIF, and PDF imports are snapshots - they don't sync. To pick
            up new activity, import a fresh export, or migrate the account to a
            live source (Plaid / SimpleFIN) above.
          </div>
          <ResizableTableShell storageKey="astroledger-cols-imports" columns={INST_COLS} gap={18}>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {onetimeInsts.map(i => (
              <div key={i.id} style={{ display: 'grid', gridTemplateColumns: 'var(--cols)', gap: 18, padding: '14px 22px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>{i.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{i.accounts.length} account{i.accounts.length === 1 ? '' : 's'} · {txCountByInst(i).toLocaleString()} transactions</div>
                </div>
                <Pill tone="info">{i.source}</Pill>
                <div style={{ fontSize: 12, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {i.accounts.map(a => a.name).join(', ')}
                </div>
                <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>one-time import</span>
                  <InstitutionDeleteBtn
                    institutionId={i.id}
                    institutionName={i.name}
                    accountCount={i.accounts.length}
                    txCount={txCountByInst(i)}
                    canDisconnect={false}
                  />
                </div>
              </div>
            ))}
          </div>
          </ResizableTableShell>
        </Card>
      )}
    </div>
  );
}
