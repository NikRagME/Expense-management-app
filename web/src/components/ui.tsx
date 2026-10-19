import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link } from 'react-router';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink hover:opacity-90',
  secondary: 'bg-surface-2 text-ink hover:bg-brand-soft',
  ghost: 'text-brand hover:bg-brand-soft',
  danger: 'text-bad hover:bg-bad-soft',
};

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-semibold transition disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl bg-surface p-4 shadow-[0_1px_2px_rgba(20,10,60,0.06)] ring-1 ring-line ${className}`}>{children}</section>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, back, action }: { title: string; back?: string | boolean; action?: ReactNode }) {
  return (
    <header className="mb-4 flex min-h-11 items-center gap-2">
      {back && (
        <Link to={typeof back === 'string' ? back : '..'} className="-ml-2 rounded-full p-2 text-2xl leading-none text-brand" aria-label="Back">
          ‹
        </Link>
      )}
      <h1 className="flex-1 text-2xl font-bold tracking-tight">{title}</h1>
      {action}
    </header>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const inputClass = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-[16px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Chip({ active, children, onClick, className = '' }: { active?: boolean; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-sm font-medium ring-1 transition ${
        active ? 'bg-brand text-brand-ink ring-brand' : 'bg-surface text-ink ring-line hover:ring-brand'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** Bottom sheet on phones, centred dialog on wide screens. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none rounded-t-3xl bg-surface p-0 text-ink backdrop:bg-black/40 sm:m-auto sm:max-w-lg sm:rounded-3xl"
    >
      {open && (
        <div className="safe-bottom flex max-h-[92dvh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-lg font-bold">{title}</h2>
            <button className="rounded-full px-2 text-2xl leading-none text-muted" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <div className="overflow-y-auto p-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Empty({ emoji, title, children }: { emoji: string; title: string; children?: ReactNode }) {
  return (
    <div className="animate-pop py-10 text-center">
      <div className="mb-2 text-5xl">{emoji}</div>
      <p className="text-lg font-bold">{title}</p>
      {children && <div className="mt-1 text-ink-2">{children}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="py-10 text-center text-muted">Loading…</div>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

/** Status chip: colour always paired with an icon and a word. */
export function Status({ tone, icon, children }: { tone: 'good' | 'warn' | 'bad' | 'muted'; icon: string; children: ReactNode }) {
  const tones = { good: 'bg-good-soft text-good', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad', muted: 'bg-surface-2 text-muted' };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      <span aria-hidden>{icon}</span>
      {children}
    </span>
  );
}
