/** Nightly cron: recurring parent-paid entries + backup to R2 (architecture §9). */
import type { Env } from '../env';
import { generateRecurring } from '../routes/recurring';
import { fullBackup } from '../routes/exports';

const KEEP_DAILY = 30;
const KEEP_MONTHLY = 12;

export async function runNightly(env: Env, now = new Date()): Promise<{ recurringCreated: number; backupKey: string | null }> {
  const recurringCreated = await generateRecurring(env.DB, null);
  let backupKey: string | null = null;
  if (env.BACKUPS) {
    const day = now.toISOString().slice(0, 10);
    const body = JSON.stringify(await fullBackup(env.DB));
    backupKey = `daily/${day}.json`;
    await env.BACKUPS.put(backupKey, body, { httpMetadata: { contentType: 'application/json' } });
    if (day.endsWith('-01')) await env.BACKUPS.put(`monthly/${day.slice(0, 7)}.json`, body, { httpMetadata: { contentType: 'application/json' } });
    await prune(env.BACKUPS, 'daily/', KEEP_DAILY);
    await prune(env.BACKUPS, 'monthly/', KEEP_MONTHLY);
  }
  return { recurringCreated, backupKey };
}

async function prune(bucket: R2Bucket, prefix: string, keep: number) {
  const listed = await bucket.list({ prefix, limit: 1000 });
  const keys = listed.objects.map((o) => o.key).sort();
  const remove = keys.slice(0, Math.max(0, keys.length - keep));
  if (remove.length) await bucket.delete(remove);
}
