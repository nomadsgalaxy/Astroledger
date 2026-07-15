import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from './prisma';
import { unlockVault } from './vault';
import { acceptPendingHouseholdInvite, currentHouseholdId, hasPendingHouseholdInvite } from './household';
import { acceptPendingFinancialSpaceInvites, acceptSuccessionNominations, hasPendingFinancialSpaceInvite, hasSuccessionNomination } from './financialSpaces';
import { ensureUserFinancialSpaces } from './financialAccess';
import { ensureAdminStatus } from './adminPromotion';

// Sign-in policy:
//   • If zero users exist, the first successful Google login becomes the admin.
//   • After that, only emails of existing User rows can sign in.
//   • The optional ALLOWED_EMAILS env var, if set, overrides as a hard allowlist
//     (useful for very-locked deployments where you want belt-and-suspenders).
const HARD_ALLOWLIST = (process.env.ALLOWED_EMAILS ?? '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma as any),
  session: { strategy: 'database' },
  // Trust X-Forwarded-Host/Proto from reverse proxies (Cloudflare Tunnel, Caddy,
  // nginx). Required so OAuth callback URLs resolve to the public domain
  // instead of the local Astroledger origin.
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
      if (HARD_ALLOWLIST.length && !HARD_ALLOWLIST.includes(email)) return false;

      const userCount = await prisma.user.count();
      if (userCount === 0) {
        // TOFU: first signer becomes admin. PrismaAdapter creates the User row
        // right after this returns true; the events.createUser hook promotes them.
        unlockVault();
        return true;
      }

      // After TOFU, known users and people with a live email-bound household
      // invitation may sign in. Google verifies control of the address; the
      // createUser/session hooks convert the invitation to membership.
      const existing = await prisma.user.findUnique({ where: { email } });
      if (!existing && !(await hasPendingHouseholdInvite(email)) && !(await hasPendingFinancialSpaceInvite(email)) && !(await hasSuccessionNomination(email))) return false;

      unlockVault();
      return true;
    },
    async session({ session, user }) {
      // Re-unlock on every session check so a server restart followed by an
      // active session cookie doesn't leave the vault locked.
      unlockVault();
      if (user.email) {
        await acceptPendingHouseholdInvite(user.id, user.email);
        await acceptPendingFinancialSpaceInvites(user.id, user.email);
        await acceptSuccessionNominations(user.id, user.email);
      }
      await ensureUserFinancialSpaces(prisma, user.id);
      (session.user as any).id = user.id;
      (session.user as any).isAdmin = await ensureAdminStatus(user.id, user.email, (user as any).isAdmin ?? false);
      const passkeyCount = await prisma.authenticator.count({ where: { userId: user.id } });
      (session.user as any).hasPasskey = passkeyCount > 0;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      // Promote the first-ever user to admin.
      const userCount = await prisma.user.count();
      if (userCount === 1 && user.id) {
        await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
      }
      if (user.id && user.email) {
        const accepted = await acceptPendingHouseholdInvite(user.id, user.email);
        const spaceAccepted = await acceptPendingFinancialSpaceInvites(user.id, user.email);
        const successionAccepted = await acceptSuccessionNominations(user.id, user.email);
        if (!accepted && !spaceAccepted && !successionAccepted) await currentHouseholdId(user.id);
        await ensureUserFinancialSpaces(prisma, user.id);
      }
    },
  },
  pages: { signIn: '/auth/signin' },
});
