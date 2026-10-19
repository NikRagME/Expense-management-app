import { useState } from 'react';
import { api, type Category } from '../api/client';
import { useApiMutation, useCategories } from '../api/hooks';
import { Button, Card, ErrorText, Field, Input, Loading, PageHeader, SectionTitle, Select, Sheet } from '../components/ui';

export function Categories() {
  const q = useCategories();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  if (q.isLoading) return <Loading />;
  const { groups, categories } = q.data!;
  return (
    <div className="space-y-4">
      <PageHeader title="Categories" back="/more" action={<Button variant="primary" onClick={() => setEditing('new')}>+ Add</Button>} />
      {groups.map((g) => (
        <Card key={g.id}>
          <SectionTitle>{g.name}</SectionTitle>
          <ul className="divide-y divide-line">
            {categories
              .filter((c) => c.groupId === g.id)
              .map((c) => (
                <li key={c.id}>
                  <button className={`flex w-full items-center gap-3 py-2.5 text-left ${c.hidden ? 'opacity-50' : ''}`} onClick={() => setEditing(c)}>
                    <span className="text-xl" aria-hidden>
                      {c.emoji}
                    </span>
                    <span className="flex-1 font-medium">
                      {c.name} {c.hidden && <span className="text-xs text-muted">(hidden)</span>}
                    </span>
                    <span className="text-xs text-muted">{c.uses} used</span>
                  </button>
                </li>
              ))}
          </ul>
        </Card>
      ))}
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New category' : 'Edit category'}>
        {editing && <CategoryForm category={editing === 'new' ? null : editing} groups={groups} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}

function CategoryForm({ category, groups, onDone }: { category: Category | null; groups: { id: string; name: string }[]; onDone: () => void }) {
  const [name, setName] = useState(category?.name ?? '');
  const [emoji, setEmoji] = useState(category?.emoji ?? '');
  const [groupId, setGroupId] = useState(category?.groupId ?? groups[0]?.id ?? '');
  const save = useApiMutation(
    (body: Record<string, unknown>) => (category ? api(`/categories/${category.id}`, { method: 'PATCH', body }) : api('/categories', { method: 'POST', body })),
    { onSuccess: onDone },
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[5rem_1fr] gap-3">
        <Field label="Emoji">
          <Input value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)} className="text-center" />
        </Field>
        <Field label="Name">
          <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Field label="Group">
        <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorText error={save.error} />
      <Button variant="primary" className="w-full" disabled={!name.trim()} onClick={() => save.mutate({ name: name.trim(), emoji, groupId })}>
        Save
      </Button>
      {category && (
        <Button className="w-full" onClick={() => save.mutate({ hidden: !category.hidden })}>
          {category.hidden ? 'Show in pickers again' : 'Hide from pickers'}
        </Button>
      )}
    </div>
  );
}
