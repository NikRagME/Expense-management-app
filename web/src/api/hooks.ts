import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import {
  api,
  type Account,
  type Category,
  type CategoryGroup,
  type ImportRecord,
  type Me,
  type Overview,
  type RecurringItem,
  type ReviewItem,
  type Rule,
  type SettingsDto,
  type TxDetail,
  type TxList,
} from './client';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), retry: false, staleTime: 5 * 60_000 });
export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounts') });
export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => api<{ groups: CategoryGroup[]; categories: Category[] }>('/categories'), staleTime: 60_000 });
export const useOverview = (from: string, to: string) =>
  useQuery({ queryKey: ['overview', from, to], queryFn: () => api<Overview>(`/reports/overview?from=${from}&to=${to}`) });
export const useTransactions = (params: Record<string, string | undefined>) => {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return useQuery({ queryKey: ['transactions', qs], queryFn: () => api<TxList>(`/transactions?${qs}`), placeholderData: (prev) => prev });
};
export const useTransaction = (id: string | undefined) =>
  useQuery({ queryKey: ['tx', id], queryFn: () => api<TxDetail>(`/transactions/${id}`), enabled: !!id });
export const useReview = () => useQuery({ queryKey: ['review'], queryFn: () => api<{ items: ReviewItem[]; count: number }>('/review') });
export const useImports = () => useQuery({ queryKey: ['imports'], queryFn: () => api<ImportRecord[]>('/imports') });
export const useRules = () => useQuery({ queryKey: ['rules'], queryFn: () => api<Rule[]>('/rules') });
export const useRecurring = () => useQuery({ queryKey: ['recurring'], queryFn: () => api<RecurringItem[]>('/recurring') });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsDto>('/settings') });

/** A mutation that refreshes everything afterwards (the data set is small). */
export function useApiMutation<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: Omit<UseMutationOptions<TResult, Error, TVars>, 'mutationFn'> = {},
) {
  const qc = useQueryClient();
  return useMutation<TResult, Error, TVars>({
    mutationFn: fn,
    ...opts,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      await opts.onSuccess?.(...args);
    },
  });
}

/** Lookup helpers for categories. */
export function useCategoryLookup() {
  const { data } = useCategories();
  const byId = new Map((data?.categories ?? []).map((c) => [c.id, c]));
  const groupOf = new Map((data?.groups ?? []).map((g, i) => [g.id, { ...g, index: i }]));
  return {
    groups: data?.groups ?? [],
    categories: data?.categories ?? [],
    get: (id: string | null | undefined) => (id ? byId.get(id) : undefined),
    groupIndex: (groupId: string) => groupOf.get(groupId)?.index ?? 0,
  };
}
