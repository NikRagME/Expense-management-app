import { useState } from 'react';
import { useCategoryLookup } from '../api/hooks';
import { Chip } from './ui';

/** Category chips: most-used first, with "show all" grouped by category group. */
export function CategoryPicker({ value, onChange, includeAllowance = false }: { value: string | null; onChange: (id: string) => void; includeAllowance?: boolean }) {
  const { categories, groups } = useCategoryLookup();
  const [all, setAll] = useState(false);
  const visible = categories.filter((c) => !c.hidden && (includeAllowance || c.id !== 'allowance'));
  const top = [...visible].sort((a, b) => b.uses - a.uses).slice(0, 8);
  if (value && !top.some((c) => c.id === value)) {
    const current = visible.find((c) => c.id === value);
    if (current) top.unshift(current);
  }

  if (!all) {
    return (
      <div className="flex flex-wrap gap-2">
        {top.map((c) => (
          <Chip key={c.id} active={c.id === value} onClick={() => onChange(c.id)}>
            <span aria-hidden>{c.emoji}</span> {c.name}
          </Chip>
        ))}
        <Chip onClick={() => setAll(true)}>More…</Chip>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const cats = visible.filter((c) => c.groupId === g.id);
        if (!cats.length) return null;
        return (
          <div key={g.id}>
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">{g.name}</div>
            <div className="flex flex-wrap gap-2">
              {cats.map((c) => (
                <Chip key={c.id} active={c.id === value} onClick={() => onChange(c.id)}>
                  <span aria-hidden>{c.emoji}</span> {c.name}
                </Chip>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
