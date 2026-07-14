// Named permission presets for financial-space invitations. Each preset is a
// plain bundle over the existing granular primitives (role + capability
// flags) — nothing bypasses the service-side validation, and the granular
// controls stay available after a preset is applied.
export type MemberPreset = {
  id: string;
  label: string;
  role: string;
  canManageDocuments: boolean;
  canExport: boolean;
  canInvite: boolean;
  description: string;
};

export const MEMBER_PRESETS: MemberPreset[] = [
  {
    id: 'spouse', label: 'Spouse / co-owner', role: 'owner',
    canManageDocuments: true, canExport: true, canInvite: true,
    description: 'Full ownership of this space, including administration and invitations.',
  },
  {
    id: 'helper', label: 'Financial helper', role: 'manager',
    canManageDocuments: true, canExport: false, canInvite: false,
    description: 'Day-to-day management of accounts and documents, without export or invitation authority.',
  },
  {
    id: 'accountant', label: 'Accountant / advisor', role: 'advisor',
    canManageDocuments: true, canExport: true, canInvite: false,
    description: 'Read-only financials with document and export access for tax or advisory work.',
  },
  {
    id: 'guardian', label: 'Guardian', role: 'guardian',
    canManageDocuments: true, canExport: true, canInvite: false,
    description: 'Manages a dependent’s ledger until autonomy is granted.',
  },
  {
    id: 'teenager', label: 'Teenager / dependent', role: 'beneficiary',
    canManageDocuments: false, canExport: false, canInvite: false,
    description: 'Sees their own ledger and earns through chores and allowances. Becomes owner at autonomy.',
  },
  {
    id: 'viewer', label: 'Viewer', role: 'viewer',
    canManageDocuments: false, canExport: false, canInvite: false,
    description: 'Read-only visibility into this space.',
  },
  {
    id: 'successor', label: 'Successor (continuity only)', role: 'successor',
    canManageDocuments: false, canExport: false, canInvite: false,
    description: 'No financial access at all until a quorum-approved succession is executed.',
  },
];

// The contributor role intentionally maps to a manage-level ceiling (see
// roleLevel in financialAccess.ts). Present it with that ceiling spelled out
// wherever roles are listed so nobody mistakes it for a lighter grant.
export const ROLE_HINTS: Record<string, string> = {
  owner: 'owner — full control',
  manager: 'manager — manage accounts',
  contributor: 'contributor — manage accounts',
  guardian: 'guardian — manage (dependent ledger)',
  viewer: 'viewer — read only',
  beneficiary: 'beneficiary — read only until autonomy',
  advisor: 'advisor — read only',
  successor: 'successor — no access before succession',
};
