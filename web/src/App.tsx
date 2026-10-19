import type { ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { ApiError } from './api/client';
import { useMe, useOverview } from './api/hooks';
import { Loading } from './components/ui';
import { calendarMonth } from '../../shared/periods';
import { todayIso } from '../../shared/dates';
import { Accounts } from './screens/Accounts';
import { Activity } from './screens/Activity';
import { Categories } from './screens/Categories';
import { Home } from './screens/Home';
import { Import } from './screens/Import';
import { ImportHistory } from './screens/ImportHistory';
import { Login } from './screens/Login';
import { More } from './screens/More';
import { ParentPaid } from './screens/ParentPaid';
import { QuickAdd } from './screens/QuickAdd';
import { Review } from './screens/Review';
import { Rules } from './screens/Rules';
import { Settings } from './screens/Settings';
import { Setup } from './screens/Setup';
import { SpreadsheetImport } from './screens/SpreadsheetImport';
import { TransactionDetail } from './screens/TransactionDetail';

export function App() {
  const me = useMe();
  const location = useLocation();

  if (location.pathname === '/login') return <Login />;
  if (me.isLoading) return <Loading />;
  if (me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403)) return <Navigate to="/login" replace />;
  if (me.error) return <div className="p-6 text-bad">Couldn't reach the app. Check your connection and try again.</div>;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/tx/:id" element={<TransactionDetail />} />
        <Route path="/add" element={<QuickAdd />} />
        <Route path="/review" element={<Review />} />
        <Route path="/import" element={<Import />} />
        <Route path="/more" element={<More />} />
        <Route path="/more/accounts" element={<Accounts />} />
        <Route path="/more/imports" element={<ImportHistory />} />
        <Route path="/more/categories" element={<Categories />} />
        <Route path="/more/rules" element={<Rules />} />
        <Route path="/more/parent-paid" element={<ParentPaid />} />
        <Route path="/more/settings" element={<Settings />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/setup/spreadsheet" element={<SpreadsheetImport />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const month = calendarMonth(todayIso().slice(0, 7));
  const overview = useOverview(month.from, month.to);
  const reviewCount = overview.data?.needsAttentionCount ?? 0;

  const tabs = [
    { to: '/', label: 'Home', icon: '🏠', end: true },
    { to: '/activity', label: 'Activity', icon: '🧾' },
    { to: '/add', label: 'Add', icon: '＋', primary: true },
    { to: '/review', label: 'Review', icon: '👀', badge: reviewCount },
    { to: '/more', label: 'More', icon: '☰' },
  ];

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-line bg-surface p-4 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-2 text-xl font-extrabold">
          <img src="/icons/icon.svg" alt="" className="size-8" /> Pocket
        </div>
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => `flex items-center gap-3 rounded-2xl px-3 py-2.5 font-semibold ${isActive ? 'bg-brand-soft text-brand' : 'text-ink-2 hover:bg-surface-2'}`}
          >
            <span aria-hidden className="w-6 text-center">
              {t.icon}
            </span>
            {t.primary ? 'Add expense' : t.label}
            {!!t.badge && <span className="ml-auto rounded-full bg-brand px-2 text-xs font-bold text-brand-ink">{t.badge}</span>}
          </NavLink>
        ))}
      </aside>

      <main className="safe-top mx-auto w-full max-w-2xl px-4 pt-4 pb-28 lg:pb-10">{children}</main>

      {/* Phone tab bar */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur lg:hidden" aria-label="Main">
        <div className="mx-auto flex max-w-2xl items-end justify-around px-2 pt-1.5 pb-1">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => `relative flex min-w-14 flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[11px] font-semibold ${isActive ? 'text-brand' : 'text-muted'}`}
            >
              {t.primary ? (
                <span className="-mt-5 grid size-14 place-items-center rounded-full bg-brand text-3xl text-brand-ink shadow-lg" aria-hidden>
                  ＋
                </span>
              ) : (
                <span className="text-xl" aria-hidden>
                  {t.icon}
                </span>
              )}
              {t.label}
              {!!t.badge && <span className="absolute top-0 right-2 min-w-5 rounded-full bg-brand px-1 text-center text-[11px] font-bold text-brand-ink">{t.badge}</span>}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
