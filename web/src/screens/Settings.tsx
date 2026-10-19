import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useApiMutation, useSettings } from '../api/hooks';
import { Button, Card, ErrorText, Field, Input, Loading, PageHeader, SectionTitle } from '../components/ui';

export function Settings() {
  const q = useSettings();
  const [names, setNames] = useState('');
  useEffect(() => {
    if (q.data) setNames(q.data.parentZelleNames.join(', '));
  }, [q.data]);
  const save = useApiMutation((body: Record<string, unknown>) => api('/settings', { method: 'PATCH', body }));
  const logout = async (everywhere = false) => {
    await fetch(everywhere ? '/auth/logout-everywhere' : '/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'expense-app' } });
    window.location.href = '/login';
  };
  if (q.isLoading) return <Loading />;
  const s = q.data!;

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" back="/more" />
      <ErrorText error={q.error ?? save.error} />

      <Card className="space-y-3">
        <SectionTitle>Allowance</SectionTitle>
        <Field label="Parent's name as it appears on Zelle" hint="Incoming Zelle or Venmo payments with this name count as allowance (income). Separate several with commas.">
          <Input value={names} onChange={(e) => setNames(e.target.value)} placeholder="e.g. Nikhil" />
        </Field>
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() => save.mutate({ parentZelleNames: names.split(',').map((n) => n.trim()).filter(Boolean) })}
        >
          Save
        </Button>
      </Card>

      <Card className="space-y-3">
        <SectionTitle>Money from friends on Venmo</SectionTitle>
        <p className="text-sm text-ink-2">When a friend pays you on Venmo, should Pocket ask what it is, or assume they're paying you back?</p>
        <div className="grid gap-2">
          {(
            [
              ['ask', 'Ask me each time (recommended for now)'],
              ['repayment', "Assume it's paying me back"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-3">
              <input type="radio" name="venmo" className="size-5" checked={s.venmoIncomingDefault === value} onChange={() => save.mutate({ venmoIncomingDefault: value })} />
              {label}
            </label>
          ))}
        </div>
      </Card>

      <Card className="space-y-2">
        <SectionTitle>Who can sign in</SectionTitle>
        <ul className="text-sm">
          {s.users.map((u) => (
            <li key={u.id} className="py-1">
              {u.name || u.email} <span className="text-muted">· {u.email} · {u.role}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">The allow-list is set in the app's server settings (ALLOWED_USERS). See docs/SETUP.md.</p>
      </Card>

      <Card className="space-y-2">
        <SectionTitle>Your data</SectionTitle>
        <p className="text-sm text-ink-2">Download everything any time. A full backup is also saved automatically every night.</p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/export/transactions.csv" className="inline-flex min-h-11 items-center rounded-2xl bg-surface-2 px-4 font-semibold">
            Transactions (CSV)
          </a>
          <a href="/api/export/backup.json" className="inline-flex min-h-11 items-center rounded-2xl bg-surface-2 px-4 font-semibold">
            Full backup (JSON)
          </a>
        </div>
      </Card>

      <Card className="space-y-2">
        <SectionTitle>Install on iPhone</SectionTitle>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
          <li>Open Pocket in Safari</li>
          <li>Tap the Share button (square with an arrow)</li>
          <li>Choose "Add to Home Screen"</li>
        </ol>
      </Card>

      <Card className="space-y-2">
        <Button className="w-full" onClick={() => logout()}>
          Sign out
        </Button>
        <Button variant="danger" className="w-full" onClick={() => confirm('Sign out on every device?') && logout(true)}>
          Sign out everywhere
        </Button>
      </Card>
    </div>
  );
}
