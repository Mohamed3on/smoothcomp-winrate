import { forwardRef, useState } from 'react';
import { TableVirtuoso } from 'react-virtuoso';
import NumberFlow from '@number-flow/react';
import { ChevronDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useMedia } from '@/lib/media';

// width: the column's width from lg up; compact: its width below lg (width by default); narrow: left off below lg.
export interface Column<T> {
  key: string; label: string; width?: string; compact?: string; sort?: string; align?: 'start' | 'end'; title?: string; narrow?: boolean;
  cell: (row: T, index: number) => React.ReactNode;
}

const cellClass = (c: { align?: string; narrow?: boolean }, sorted: boolean) =>
  cn('px-2 py-2.5 align-middle first:pl-3 last:pr-3 sm:px-3 sm:first:pl-5 sm:last:pr-5', c.align === 'start' ? 'text-left' : 'text-right', c.narrow && 'max-lg:hidden', sorted && 'bg-primary/6');

// A ranked ledger: sortable headers, every row reachable, only the rows on screen drawn.
export function Ledger<T>({ rows, columns, sort, asc = false, onSort, rowKey, loading, empty, expand, openAll }: {
  rows: T[] | undefined; columns: Column<T>[]; sort?: string; asc?: boolean; onSort?: (s: string, asc: boolean) => void; rowKey: (r: T) => string; loading: boolean;
  empty: React.ReactNode; expand?: (r: T) => React.ReactNode; openAll?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(openAll ? rows?.map(rowKey) : []));
  const [fresh, setFresh] = useState<string | null>(null);
  // An expansion spans only the columns shown: spanning hidden ones would add empty columns that take width.
  const span = useMedia('(width >= 64rem)') ? columns.length : columns.filter((c) => !c.narrow).length;
  const header = (
    <tr className="text-xs text-muted-foreground">
      {columns.map((c) => (
        <th key={c.key} scope="col" style={{ '--w': c.width, '--cw': c.compact ?? c.width } as React.CSSProperties} aria-sort={c.sort && c.sort === sort ? (asc ? 'ascending' : 'descending') : undefined}
          className={cn(cellClass(c, false), 'h-10 w-(--cw) bg-card font-medium lg:w-(--w) whitespace-nowrap', c.sort === sort && c.sort && 'text-primary')}>
          {c.sort && onSort
            ? <button type="button" title={c.title ?? `Rank by ${c.label.toLowerCase()}`} onClick={() => onSort(c.sort!, c.sort === sort && !asc)} className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                {c.label}<ChevronDown className={cn('size-3.5 transition-[opacity,rotate]', c.sort === sort ? 'opacity-100' : 'opacity-0', c.sort === sort && asc && 'rotate-180')} />
              </button>
            : <span title={c.title}>{c.label}</span>}
        </th>
      ))}
    </tr>
  );
  if (loading && !rows) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full table-fixed text-sm"><thead>{header}</thead>
          <tbody>{Array.from({ length: 10 }, (_, i) => <tr key={i} className="border-t">{columns.map((c) => <td key={c.key} className={cellClass(c, false)}><Skeleton className="h-3 w-full" /></td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (!rows?.length) return <div className="rounded-xl border bg-card">{empty}</div>;
  // Each row, then its expansion when open: one flat list for the virtualizer.
  type Item = { row: T; index: number; detail: boolean };
  const items: Item[] = rows.flatMap((row, index) => (open.has(rowKey(row)) && expand ? [{ row, index, detail: false }, { row, index, detail: true }] : [{ row, index, detail: false }]));
  const toggle = (key: string) => { setFresh(open.has(key) ? null : key); setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; }); };
  return (
    <div className={cn('rounded-xl border bg-card transition-opacity', loading && 'opacity-60')} aria-busy={loading}>
      <TableVirtuoso
        useWindowScroll
        data={items}
        increaseViewportBy={800}
        computeItemKey={(_, item) => `${rowKey(item.row)}${item.detail ? ':detail' : ''}`}
        components={{
          Table: (props) => <table {...props} className="w-full table-fixed border-separate border-spacing-0 text-sm" />,
          TableHead: forwardRef((props, ref) => <thead {...props} ref={ref} className="sticky top-24! z-10 sm:top-14! [&_th]:border-b" />),
          TableRow: ({ item, ...props }) => (
            <tr {...props}
              aria-expanded={expand && !item.detail ? open.has(rowKey(item.row)) : undefined}
              onClick={expand && !item.detail ? (e) => { if (!(e.target as HTMLElement).closest('a,button')) toggle(rowKey(item.row)); } : undefined}
              className={cn('[&>td]:border-b [&>td]:border-border', !item.detail && 'transition-colors hover:bg-muted/40', expand && !item.detail && 'cursor-pointer',
                expand && open.has(rowKey(item.row)) && 'bg-primary/8 hover:bg-primary/10')} />
          ),
        }}
        fixedHeaderContent={() => header}
        itemContent={(_, item) => item.detail
          ? <td colSpan={span} className="bg-primary/8 px-3 pb-4 sm:px-5 sm:pl-16"><div className={cn(rowKey(item.row) === fresh && 'transition-[opacity,translate] duration-200 ease-out-strong starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0')}>{expand!(item.row)}</div></td>
          : <>{columns.map((c) => <td key={c.key} className={cellClass(c, !!c.sort && c.sort === sort)}>{c.cell(item.row, item.index)}</td>)}</>}
      />
    </div>
  );
}

export const Count = ({ n, unit }: { n: number; unit: string }) => (
  <span className="text-sm text-muted-foreground"><NumberFlow value={n} className="font-semibold text-foreground" /> {unit} match</span>
);
