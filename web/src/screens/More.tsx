import { Link } from 'react-router';
import { useMe } from '../api/hooks';
import { Card, PageHeader } from '../components/ui';

const ITEMS = [
  { to: '/more/accounts', icon: '🏦', label: 'Accounts & balances', hint: 'Add accounts, update balances' },
  { to: '/import', icon: '📥', label: 'Import a statement', hint: 'Citi, SFCU, Venmo…' },
  { to: '/more/parent-paid', icon: '🤝', label: 'Paid by parent', hint: 'Rent, phone plan and other costs' },
  { to: '/more/categories', icon: '🏷️', label: 'Categories', hint: 'Rename, add or hide' },
  { to: '/more/rules', icon: '🪄', label: 'Rules', hint: 'Automatic categories' },
  { to: '/more/imports', icon: '🗂️', label: 'Import history', hint: 'See or undo imports' },
  { to: '/more/settings', icon: '⚙️', label: 'Settings', hint: 'Allowance, Venmo, export, install' },
];

export function More() {
  const me = useMe();
  return (
    <div className="space-y-4">
      <PageHeader title="More" />
      <Card className="p-1">
        <ul>
          {ITEMS.map((i) => (
            <li key={i.to}>
              <Link to={i.to} className="flex items-center gap-3 rounded-2xl px-3 py-3 hover:bg-surface-2">
                <span className="text-2xl" aria-hidden>
                  {i.icon}
                </span>
                <span className="flex-1">
                  <span className="block font-semibold">{i.label}</span>
                  <span className="block text-sm text-muted">{i.hint}</span>
                </span>
                <span className="text-muted" aria-hidden>
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      {me.data && (
        <p className="text-center text-sm text-muted">
          Signed in as {me.data.name || me.data.email} ({me.data.role})
        </p>
      )}
    </div>
  );
}
