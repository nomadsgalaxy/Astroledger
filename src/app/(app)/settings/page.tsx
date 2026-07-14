import { auth, signOut } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, SectionHeader, Pill, Btn } from '../../_components/atoms';
import PasskeyEnrollButton from '../../_components/PasskeyEnrollButton';
import GmailAutoSyncPanel from '../../_components/GmailAutoSyncPanel';
import BackupPanel from '../../_components/BackupPanel';
import TagManager from '../../_components/TagManager';
import DedupePanel from '../../_components/DedupePanel';
import InstallAppCard from '../../_components/InstallAppCard';
import InactiveAccountsCard from '../../_components/InactiveAccountsCard';
import RulesManager from '../../_components/RulesManager';
import SuggestedRules from '../../_components/SuggestedRules';
import FxRatesCard from '../../_components/FxRatesCard';
import { redirect } from 'next/navigation';
import { listTagsFlat, ensureStarterTags, migrateCategoriesToTags, backfillUuids, reparentOrphanSecondaries } from '@/lib/tags';
import { getDismissTtlDays } from '@/lib/dismissedRecs';
import DismissTtlSetting from '../../_components/DismissTtlSetting';
import LlmProviderSetting from '../../_components/LlmProviderSetting';
import ExportPanel from '../../_components/ExportPanel';
import { getInactiveMonths } from '@/lib/inactiveAccounts';
import HouseholdCard from '../../_components/HouseholdCard';
import { getHousehold } from '@/lib/household';

export const dynamic = 'force-dynamic';

export default async function Settings() {
  const session = await auth();
  if (!session?.user) redirect('/auth/signin');
  const userId = (session.user as any).id as string;
  const isAdmin = !!(session.user as any).isAdmin;
  const [passkeys, spaceMemberships] = await Promise.all([
    prisma.authenticator.findMany({ where: { userId } }),
    prisma.financialSpaceMember.findMany({
      where: { userId, space: { status: { not: 'archived' } } },
      include: { space: { select: { id: true, name: true, kind: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    ensureStarterTags(),
  ]);
  // One-time data migration from categories → tags. Idempotent.
  await migrateCategoriesToTags();
  // Backfill universal UUIDs onto every tag + transaction. Idempotent.
  await backfillUuids();
  // Move legacy orphan secondaries (Reimbursable, Tax deductible) under
  // the catch-all Modifier primary. Idempotent. Every secondary must
  // have a parent going forward; new writes are guarded at the API +
  // MCP boundaries.
  await reparentOrphanSecondaries();
  const tags = await listTagsFlat();
  const inactiveMonths = await getInactiveMonths();
  const household = await getHousehold(userId);
  const dismissTtl = await getDismissTtlDays();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHeader
        eyebrow="Account"
        title="Settings"
        subtitle={`Signed in as ${session.user.email}`}
      />

      <SettingsNav />

      <div id="account" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, scrollMarginTop: 90 }}>
        <Card eyebrow="Security" title={`Passkeys (${passkeys.length})`}
              action={<Pill tone={passkeys.length > 0 ? 'success' : 'warning'}>{passkeys.length > 0 ? 'Active' : 'None'}</Pill>}>
          {passkeys.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 14 }}>
              No passkey enrolled. Enroll one now to sign in without Google.
            </div>
          )}
          {passkeys.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {passkeys.map(p => (
                <li key={p.credentialID} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)' }}>
                  {p.credentialID.slice(0, 28)}…
                  <span style={{ color: 'var(--fg-subtle)', marginLeft: 8 }}>({p.credentialDeviceType})</span>
                </li>
              ))}
            </ul>
          )}
          <PasskeyEnrollButton />
        </Card>

        <Card eyebrow="Account" title={process.env.DEMO_MODE === 'true' ? 'Reset demo' : 'Sign out'}>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14 }}>
            {process.env.DEMO_MODE === 'true'
              ? 'Drop your current sandbox and start fresh. Your edits will be lost.'
              : "End your current Astroledger session. You'll be redirected to sign-in."}
          </div>
          <form action={async () => {
            'use server';
            // In demo mode, point signOut at start-session so the next request
            // immediately mints a fresh sandbox + cookie. /auth/signin would
            // technically also bounce there, but RSC streaming can't chain
            // through API-route redirects without erroring on the client.
            const redirectTo = process.env.DEMO_MODE === 'true'
              ? '/api/demo/start-session?next=%2F'
              : '/auth/signin';
            await signOut({ redirectTo });
          }}>
            <Btn variant="outline" type="submit">
              {process.env.DEMO_MODE === 'true' ? 'Reset demo' : 'Sign out'}
            </Btn>
          </form>
        </Card>

        <Card eyebrow="Install" title="Get the app"
              action={<Pill tone="info">PWA</Pill>}>
          <InstallAppCard />
        </Card>

        <Card eyebrow="Household" title="Financial spaces"
              action={<Pill tone="info">{spaceMemberships.length} space{spaceMemberships.length === 1 ? '' : 's'}</Pill>}>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12, lineHeight: 1.6 }}>
            Members, invitations, account sharing, allowances, split expenses, succession, and the
            audit trail are all managed per space on{' '}
            <a href="/spaces" style={{ color: 'var(--accent)' }}>Spaces &amp; sharing</a>.
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {spaceMemberships.map(membership => (
              <li key={membership.spaceId} style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                <strong style={{ color: 'var(--fg-strong)' }}>{membership.space.name}</strong>
                {' '}· {membership.space.kind} · you are {membership.role}
              </li>
            ))}
          </ul>
        </Card>

        {isAdmin && (
          <Card eyebrow="Household · legacy" title="Instance household"
                action={<Pill tone="ghost">{household ? `${household.members.length} member${household.members.length === 1 ? '' : 's'}` : '—'}</Pill>}>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12, lineHeight: 1.6 }}>
              The legacy instance household seeds the shared household space. Prefer inviting people
              directly on <a href="/spaces" style={{ color: 'var(--accent)' }}>Spaces &amp; sharing</a>;
              use this only to add someone to the legacy household itself.
            </div>
            <HouseholdCard initial={household} />
          </Card>
        )}

        <Card eyebrow="Theme" title="Appearance">
          <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            Theme, information density, and privacy mode live in the top bar so they remain available everywhere. Device installation and account preferences stay on this page.
          </div>
        </Card>

        <Card eyebrow="Data" title="Local-first">
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
            Astroledger keeps its database and uploaded receipts on this server. The full database is encrypted at rest, credentials and raw provider payloads receive a second field-encryption layer, and receipt files use authenticated file envelopes. Keys are mounted from root-managed files rather than stored in Docker metadata.
          </div>
        </Card>
      </div>

      <div id="automation" style={{ scrollMarginTop: 90 }}>
      {isAdmin ? (
        <Card eyebrow="Automation" title="Gmail auto-sync"
              action={<Pill tone="info">LLM-assisted</Pill>}>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14, lineHeight: 1.6 }}>
            Periodically scan your inbox for new receipts, capped per run for rate-limit safety.
            When the local LLM is reachable, each new receipt is also classified - recurring charges
            are flagged as new subscriptions (or matched to existing ones) and surfaced under Insights.
          </div>
          <GmailAutoSyncPanel />
        </Card>
      ) : (
        <Card eyebrow="Automation & AI" title="Managed by your administrator">
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
            Gmail auto-sync, the LLM provider, and database backups are configured by the
            instance administrator and apply to the whole deployment.
          </div>
        </Card>
      )}
      </div>

      {isAdmin && <Card eyebrow="AI" title="LLM provider"
            action={<Pill tone="info">Pluggable</Pill>}>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14, lineHeight: 1.6 }}>
          Pick the model that powers <strong>Spacer</strong> chat and LLM-assisted
          auto-categorization. Works with Ollama (local), OpenAI, Anthropic, or any
          OpenAI-compatible endpoint (LM Studio, vLLM, OpenRouter, Groq, your own
          server). API keys are stored as <em>env var names</em> only — the actual
          key value never enters the database, only the running process reads it
          from <code>process.env</code> at call time. Hit <strong>Test connection</strong>
          before saving to confirm the model can answer.
        </div>
        <LlmProviderSetting />
      </Card>}

      <Card eyebrow="Alerts" title="Dismissed-alert TTL"
            action={<Pill tone="info">Default 12 days</Pill>}>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14, lineHeight: 1.6 }}>
          Dismissed recommendations in <a href="/alerts" style={{ color: 'var(--accent)' }}>Insights</a> are kept
          around so you can restore one if you change your mind, then auto-deleted after this many days.
          Range: 1–365. Cleanup runs whenever Insights loads.
        </div>
        <DismissTtlSetting initial={dismissTtl} />
      </Card>

      <div id="organization" style={{ scrollMarginTop: 90 }}>
      <Card eyebrow="Organization" title="Tags"
            action={<Pill tone="info">Parent &gt; Child</Pill>}>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14, lineHeight: 1.6 }}>
          Two-level hierarchy. <strong>Primary</strong> tags render as filled pills; <strong>secondary</strong> tags
          render as outlined chips. Either level can be attached to transactions or subscriptions. Edits autosave.
          Deleting a parent orphans its children (they remain usable, just lose the prefix).
        </div>
        <TagManager initialTags={tags} />
      </Card>
      </div>

      <Card eyebrow="Hygiene" title="De-duplication"
            action={<Pill tone="info">Idempotent</Pill>}>
        <DedupePanel />
      </Card>

      <Card eyebrow="Hygiene" title="Hide inactive accounts"
            action={<Pill tone={inactiveMonths === 0 ? 'ghost' : 'info'}>{inactiveMonths === 0 ? 'Off' : `${inactiveMonths}m`}</Pill>}>
        <InactiveAccountsCard initialMonths={inactiveMonths} />
      </Card>

      <Card eyebrow="Automation" title="Categorization rules"
            action={<Pill tone="info">Auto-applied</Pill>}>
        <RulesManager tags={tags} />
      </Card>

      <Card eyebrow="Automation · learned" title="Suggested rules"
            action={<Pill tone="info">From your edits</Pill>}>
        <SuggestedRules />
      </Card>

      <Card eyebrow="Foreign currency" title="FX rates"
            action={<Pill tone="info">USD base</Pill>}>
        <FxRatesCard />
      </Card>

      <div id="data" style={{ scrollMarginTop: 90 }}>
      {isAdmin && <Card eyebrow="Automation" title="Database backups"
            action={<Pill tone="info">Encrypted at rest</Pill>}>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14, lineHeight: 1.6 }}>
          Online <code>VACUUM INTO</code> snapshots are created in memory-backed scratch space,
          compressed, and wrapped in an authenticated AES-256-GCM envelope using the dedicated
          backup key. Retention is automatic, and restore verifies the envelope and database
          integrity before replacing the live encrypted database.
        </div>
        <BackupPanel />
      </Card>}
      </div>

      <Card eyebrow="Data" title="Export your data"
            action={<Pill tone="info">Leave anytime</Pill>}>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14, lineHeight: 1.6 }}>
          Download your complete financial history in open formats - for spreadsheets, migration to
          another app, or archival. Your data is yours; take it whenever you want. (For an encrypted
          full-database snapshot instead, use the password-encrypted backup above.)
        </div>
        <ExportPanel />
      </Card>
    </div>
  );
}

function SettingsNav() {
  const sections = [
    ['#account', 'Account & app'],
    ['#automation', 'Automation & AI'],
    ['#organization', 'Organization'],
    ['#data', 'Data & safety'],
  ] as const;
  return (
    <nav className="m3-tab-strip" aria-label="Settings sections" style={{
      display: 'flex', gap: 8, paddingBottom: 2,
      borderBottom: '1px solid var(--border)',
    }}>
      {sections.map(([href, label]) => (
        <a key={href} href={href} style={{
          padding: '9px 12px', borderRadius: 'var(--r-sm)',
          color: 'var(--fg-muted)', textDecoration: 'none',
          fontFamily: 'var(--font-product)', fontSize: 10, fontWeight: 700,
          letterSpacing: 'var(--tr-wider)', textTransform: 'uppercase',
          background: 'var(--bg-subtle)', border: '1px solid var(--border)',
        }}>{label}</a>
      ))}
    </nav>
  );
}
