import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { ACTIVE_SPACE_COOKIE } from '@/lib/financialAccess';
import { prisma } from '@/lib/prisma';
import {
  FinancialSpaceError, approveSuccession, cancelSuccession, createStewardedSpace, executeSuccession,
  getFinancialWorkspace, grantDependentAutonomy, inviteFinancialSpaceMember,
  moveAccountToSpace, moveConnectionToSpace, removeAccountGrant, removeFinancialSpaceMember,
  requestSuccession, revokeFinancialSpaceInvite, setAccountGrant,
  transferSpaceOwnership, updateFinancialSpace, updateFinancialSpaceMember,
  updateSuccessionPlan, setAllOwnedAccountGrants,
} from '@/lib/financialSpaces';

export const runtime = 'nodejs';

function failure(error: unknown) {
  if (error instanceof FinancialSpaceError) return NextResponse.json({ error: error.message }, { status: error.status });
  const candidate = error as { message?: string; status?: number };
  if (candidate?.status === 403) return NextResponse.json({ error: candidate.message ?? 'Forbidden' }, { status: 403 });
  console.error('financial-spaces:', error);
  return NextResponse.json({ error: 'Could not update the financial workspace' }, { status: 500 });
}

async function userId() {
  const session = await auth();
  return session?.user ? (session.user as { id: string }).id : null;
}

export async function GET() {
  const id = await userId();
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json({ workspace: await getFinancialWorkspace(id) }); }
  catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  const id = await userId();
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as Record<string, any>;
  try {
    switch (body.action) {
      case 'select_space': {
        const member = await prisma.financialSpaceMember.findUnique({ where: { spaceId_userId: { spaceId: String(body.spaceId), userId: id } } });
        if (!member) throw new FinancialSpaceError('You do not belong to that financial space', 403);
        const response = NextResponse.json({ ok: true });
        response.cookies.set(ACTIVE_SPACE_COOKIE, String(body.spaceId), {
          httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 365 * 86_400,
        });
        return response;
      }
      case 'create_stewarded':
        await createStewardedSpace(id, { name: String(body.name ?? ''), beneficiaryEmail: body.beneficiaryEmail });
        break;
      case 'rename_space':
        await updateFinancialSpace(id, String(body.spaceId), { name: String(body.name ?? '') });
        break;
      case 'invite_member':
        await inviteFinancialSpaceMember(id, String(body.spaceId), {
          email: String(body.email ?? ''), role: body.role,
          canManageDocuments: body.canManageDocuments, canExport: body.canExport, canInvite: body.canInvite,
        });
        break;
      case 'revoke_invite':
        await revokeFinancialSpaceInvite(id, String(body.spaceId), String(body.inviteId));
        break;
      case 'update_member':
        await updateFinancialSpaceMember(id, String(body.spaceId), String(body.memberId), body);
        break;
      case 'remove_member':
        await removeFinancialSpaceMember(id, String(body.spaceId), String(body.memberId));
        break;
      case 'set_account_grant':
        if (body.accountId === '*') await setAllOwnedAccountGrants(id, body);
        else await setAccountGrant(id, String(body.accountId), body);
        break;
      case 'remove_account_grant':
        await removeAccountGrant(id, String(body.accountId), String(body.grantId));
        break;
      case 'move_account':
        await moveAccountToSpace(id, String(body.accountId), String(body.targetSpaceId));
        break;
      case 'move_connection':
        await moveConnectionToSpace(id, String(body.institutionId), String(body.targetSpaceId));
        break;
      case 'transfer_ownership':
        await transferSpaceOwnership(id, String(body.spaceId), String(body.targetUserId));
        break;
      case 'grant_autonomy':
        await grantDependentAutonomy(id, String(body.spaceId), { beneficiaryUserId: body.beneficiaryUserId, guardianAccess: body.guardianAccess });
        break;
      case 'update_succession':
        await updateSuccessionPlan(id, String(body.spaceId), body);
        break;
      case 'request_succession':
        await requestSuccession(id, String(body.spaceId), body.reason);
        break;
      case 'approve_succession':
        await approveSuccession(id, String(body.requestId), body.decision === 'reject' ? 'reject' : 'approve');
        break;
      case 'execute_succession':
        await executeSuccession(id, String(body.requestId));
        break;
      case 'cancel_succession':
        await cancelSuccession(id, String(body.requestId));
        break;
      default:
        throw new FinancialSpaceError('Unknown action');
    }
    return NextResponse.json({ workspace: await getFinancialWorkspace(id) });
  } catch (error) {
    return failure(error);
  }
}
