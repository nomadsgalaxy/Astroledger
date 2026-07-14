// Next.js instrumentation hook - runs once on server boot.
// https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Lazy-import so Edge runtime doesn't try to pull in Node-only modules.
    const [{ initSchedulerOnce }, { initBackupSchedulerOnce }] = await Promise.all([
      import('./lib/gmailScheduler'),
      import('./lib/backup'),
    ]);
    initSchedulerOnce().catch(e => console.error('[boot] gmail scheduler init failed:', e));
    initBackupSchedulerOnce().catch(e => console.error('[boot] backup scheduler init failed:', e));
  }
}
