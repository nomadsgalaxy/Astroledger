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
import DismissTtlSetting from '../../_components/DismissTtlSetting';
import LlmProviderSetting from '../../_components/LlmProviderSetting';
import ExportPanel from '../../_components/ExportPanel';
import HouseholdCard from '../../_components/HouseholdCard';
import HouseholdSettingsPanel from '../../_components/HouseholdSettingsPanel';
import SettingsNav from '../../_components/SettingsNav';
import UpdateCheckCard from '../../_components/UpdateCheckCard';
import { redirect } from 'next/navigation';
import { listTagsFlat, ensureStarterTags, migrateCategoriesToTags, backfillUuids, reparentOrphanSecondaries } from '@/lib/tags';
import { getDismissTtlDays } from '@/lib/dismissedRecs';
import { getInactiveMonths } from '@/lib/inactiveAccounts';
import { getHousehold } from '@/lib/household';
import { getHouseholdSettingsView } from '@/lib/financialSpaces';

export const dynamic = 'force-dynamic';

const SECTIONS = [
  { id: 'household', label: 'Household & spaces' },
  { id: 'account', label: 'Account & security' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'organization', label: 'Organization' },
  { id: 'automation', label: 'Automation & AI' },
  { id: 'data', label: 'Data & safety' },
];

function Section({ id, title, subtitle, children }: {
  id: string; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <section id={id} aria-label={title} style={{ scrollMarginTop: 84, display: 'grid', gap: 14 }}>
      <div>
        <h2 style={{
          margin: 0, fontFamily: 'var(--font-product)', fontSize: 16, fontWeight: 700,
          letterSpacing: 'var(--tr-snug)', color: 'var(--fg-strong)',
        }}>{title}</h2>
        {subtitle && <p className="t-card-body" style={{ margin: '4px 0 0', maxWidth: 760 }}>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export default async function Settings() {
  const session = await auth();
  if (!session?.user) redirect('/auth/signin');
  const userId = (session.user as any).id as string;
  const isAdmin = !!(session.user as any).isAdmin;
  const [passkeys, householdSettings] = await Promise.all([
    prisma.authenticator.findMany({ where: { userId } }),
    getHouseholdSettingsView(userId),
    ensureStarterTags(),
  ]);
  // One-time, idempotent data migrations (categories → tags, UUID backfill,
  // orphan secondary reparenting) piggyback on settings loads.
  await migrateCategoriesToTags();
  await backfillUuids();
  await reparentOrphanSecondaries();
  const tags = await listTagsFlat();
  const inactiveMonths = await getInactiveMonths();
  const household = isAdmin ? await getHousehold(userId) : null;
  const dismissTtl = await getDismissTtlDays();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionHeader
        eyebrow="Account"
        title="Settings"
        subtitle={`Signed in as ${session.user.email}`}
      />

      <div className="settings-layout">
        <SettingsNav sections={SECTIONS} />

        <div style={{ display: 'grid', gap: 30, minWidth: 0 }}>
          <Section id="household" title="Household & spaces"
            subtitle="Every financial space you belong to, with the controls your role allows: people, permission presets, invitations, ownership, and continuity. Day-to-day sharing, split expenses, allowances, and documents live in Spaces.">
            <HouseholdSettingsPanel initial={householdSettings} />
            {isAdmin && household && (
              <Card eyebrow="Legacy" title="Instance household"
                    action={<Pill tone="ghost">{household.members.length} member{household.members.length === 1 ? '' : 's'}</Pill>}>
                <div className="t-card-body" style={{ marginBottom: 12 }}>
                  The legacy instance household seeds the shared household space. Prefer inviting people
                  through the space cards above; use this only to add someone to the legacy household itself.
                </div>
                <HouseholdCard initial={household} />
              </Card>
            )}
          </Section>

          <Section id="account" title="Account & security">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 16 }}>
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
                <div className="t-card-body" style={{ marginBottom: 14 }}>
                  {process.env.DEMO_MODE === 'true'
                    ? 'Drop your current sandbox and start fresh. Your edits will be lost.'
                    : "End your current Astroledger session. You'll be redirected to sign-in."}
                </div>
                <form action={async () => {
                  'use server';
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

              <Card eyebrow="Install" title="Get the app" action={<Pill tone="info">PWA</Pill>}>
                <InstallAppCard />
              </Card>
            </div>
          </Section>

          <Section id="preferences" title="Preferences">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 16 }}>
              <Card eyebrow="Alerts" title="Dismissed-alert retention"
                    action={<Pill tone="info">Default 12 days</Pill>}>
                <div className="t-card-body" style={{ marginBottom: 14 }}>
                  Dismissed recommendations in <a href="/alerts" style={{ color: 'var(--accent)' }}>Insights</a> stay
                  restorable for this many days, then delete automatically.
                </div>
                <DismissTtlSetting initial={dismissTtl} />
              </Card>

              <Card eyebrow="Accounts" title="Hide inactive accounts"
                    action={<Pill tone={inactiveMonths === 0 ? 'ghost' : 'info'}>{inactiveMonths === 0 ? 'Off' : `${inactiveMonths}m`}</Pill>}>
                <InactiveAccountsCard initialMonths={inactiveMonths} />
              </Card>

              <Card eyebrow="Theme" title="Appearance">
                <div className="t-card-body">
                  Theme, information density, and privacy mode live in the top bar so they stay available
                  everywhere. Device installation and account preferences stay on this page.
                </div>
              </Card>
            </div>
          </Section>

          <Section id="organization" title="Organization">
            <Card eyebrow="Organization" title="Tags" action={<Pill tone="info">Parent &gt; Child</Pill>}>
              <div className="t-card-body" style={{ marginBottom: 14 }}>
                Two-level hierarchy. <strong>Primary</strong> tags render as filled pills; <strong>secondary</strong> tags
                render as outlined chips. Either level can be attached to transactions or subscriptions. Edits autosave.
              </div>
              <TagManager initialTags={tags} />
            </Card>
            <Card eyebrow="Automation" title="Categorization rules" action={<Pill tone="info">Auto-applied</Pill>}>
              <RulesManager tags={tags} />
            </Card>
            <Card eyebrow="Automation · learned" title="Suggested rules" action={<Pill tone="info">From your edits</Pill>}>
              <SuggestedRules />
            </Card>
            <Card eyebrow="Foreign currency" title="FX rates" action={<Pill tone="info">USD base</Pill>}>
              <FxRatesCard />
            </Card>
          </Section>

          <Section id="automation" title="Automation & AI">
            {isAdmin ? (
              <>
                <Card eyebrow="Automation" title="Gmail auto-sync" action={<Pill tone="info">LLM-assisted</Pill>}>
                  <div className="t-card-body" style={{ marginBottom: 14 }}>
                    Periodically scan your inbox for new receipts, capped per run for rate-limit safety.
                    When the configured model is reachable, new receipts are classified and recurring
                    charges surface under Insights.
                  </div>
                  <GmailAutoSyncPanel />
                </Card>
                <Card eyebrow="AI" title="LLM provider" action={<Pill tone="info">Pluggable</Pill>}>
                  <div className="t-card-body" style={{ marginBottom: 14 }}>
                    Pick the model that powers <strong>Spacer</strong> chat and LLM-assisted auto-categorization.
                    Works with Ollama (local), OpenAI, Anthropic, or any OpenAI-compatible endpoint. API keys
                    are stored as env-var <em>names</em> only — the key value never enters the database.
                    Use <strong>Test connection</strong> before saving.
                  </div>
                  <LlmProviderSetting />
                </Card>
              </>
            ) : (
              <Card eyebrow="Automation & AI" title="Managed by your administrator">
                <div className="t-card-body">
                  Gmail auto-sync, the LLM provider, database backups, and updates are configured by the
                  instance administrator and apply to the whole deployment.
                </div>
              </Card>
            )}
          </Section>

          <Section id="data" title="Data & safety">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 16 }}>
              <Card eyebrow="Data" title="Export your data" action={<Pill tone="info">Leave anytime</Pill>}>
                <div className="t-card-body" style={{ marginBottom: 14 }}>
                  Download your visible financial history in open formats. Exports respect per-account
                  export permissions in the active space.
                </div>
                <ExportPanel />
              </Card>
              <Card eyebrow="Hygiene" title="De-duplication" action={<Pill tone="info">Idempotent</Pill>}>
                <DedupePanel />
              </Card>
              {isAdmin && (
                <Card eyebrow="Updates" title="Software updates"
                      action={<Pill tone="info">GitHub releases</Pill>}>
                  <UpdateCheckCard />
                </Card>
              )}
            </div>
            {isAdmin && (
              <Card eyebrow="Automation" title="Database backups" action={<Pill tone="info">Encrypted at rest</Pill>}>
                <div className="t-card-body" style={{ marginBottom: 14 }}>
                  Snapshots are created in memory-backed scratch space, compressed, and wrapped in an
                  authenticated AES-256-GCM envelope under the dedicated backup key. Restores verify the
                  envelope and database integrity before touching the live database.
                </div>
                <BackupPanel />
              </Card>
            )}
            <Card eyebrow="Data" title="Local-first">
              <div className="t-card-body">
                Astroledger keeps its database and uploads on this server. The full database is encrypted at
                rest, credentials carry a second field-encryption layer, and receipt/document files use
                authenticated file envelopes. Keys are mounted from root-managed files, never stored in
                Docker metadata.
              </div>
            </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}
