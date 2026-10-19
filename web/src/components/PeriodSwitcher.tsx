import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { todayIso } from '../../../shared/dates';
import { calendarMonth, shiftMonth, type Period } from '../../../shared/periods';
import { prettyDate } from '../lib/format';
import { Button, Input, Sheet } from './ui';

/**
 * The period lives in the URL (?from&to). Defaults to the current calendar
 * month; any custom range works too (spec A7 is still open).
 */
export function usePeriod(): Period & { setPeriod: (p: { from: string; to: string }) => void; isMonth: boolean } {
  const [params, setParams] = useSearchParams();
  const fallback = calendarMonth(todayIso().slice(0, 7));
  const from = params.get('from') ?? fallback.from;
  const to = params.get('to') ?? fallback.to;
  const month = calendarMonth(from.slice(0, 7));
  const isMonth = month.from === from && month.to === to;
  return {
    from,
    to,
    isMonth,
    label: isMonth ? month.label : `${prettyDate(from, { year: true })} – ${prettyDate(to, { year: true })}`,
    setPeriod: (p) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('from', p.from);
          next.set('to', p.to);
          return next;
        },
        { replace: true },
      ),
  };
}

export function PeriodSwitcher() {
  const period = usePeriod();
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const ym = period.from.slice(0, 7);
  const thisMonth = todayIso().slice(0, 7);
  const go = (delta: number) => period.setPeriod(calendarMonth(shiftMonth(ym, delta)));

  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <button className="grid size-11 place-items-center rounded-full text-2xl text-brand hover:bg-brand-soft" onClick={() => go(-1)} aria-label="Previous month">
        ‹
      </button>
      <button className="flex-1 rounded-2xl py-2 text-center text-lg font-bold" onClick={() => setCustom(true)} aria-label="Choose dates">
        {period.label}
      </button>
      <button
        className="grid size-11 place-items-center rounded-full text-2xl text-brand hover:bg-brand-soft disabled:opacity-30"
        onClick={() => go(1)}
        disabled={period.isMonth && ym >= thisMonth}
        aria-label="Next month"
      >
        ›
      </button>
      <Sheet open={custom} onClose={() => setCustom(false)} title="Choose dates">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                period.setPeriod(calendarMonth(thisMonth));
                setCustom(false);
              }}
            >
              This month
            </Button>
            <Button
              onClick={() => {
                period.setPeriod({ from: calendarMonth(shiftMonth(thisMonth, -2)).from, to: calendarMonth(thisMonth).to });
                setCustom(false);
              }}
            >
              Last 3 months
            </Button>
          </div>
          <Button
            variant="primary"
            className="w-full"
            disabled={!from || !to || from > to}
            onClick={() => {
              period.setPeriod({ from, to });
              setCustom(false);
            }}
          >
            Show this range
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
