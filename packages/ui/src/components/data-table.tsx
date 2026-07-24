import { useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { cn } from '../lib/cn.js';

export type { ColumnDef } from '@tanstack/react-table';

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: readonly T[] | undefined;
  isPending?: boolean;
  isError?: boolean;
  /** Localized state messages — the table renders them, callers own the words. */
  loadingMessage: string;
  errorMessage: string;
  emptyMessage: ReactNode;
  className?: string;
}

/**
 * The platform list table (ui-design-system §9): token-styled, sortable,
 * wide content scrolls inside its own container. Client-side ops only —
 * fine under 200 rows; server-driven sorting/pagination lands when a list
 * outgrows that (spec §9.1).
 */
export function DataTable<T>({
  columns,
  data,
  isPending,
  isError,
  loadingMessage,
  errorMessage,
  emptyMessage,
  className,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: (data ?? []) as T[],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (isPending) {
    return (
      <p className="text-sm text-muted-foreground" aria-busy="true">
        {loadingMessage}
      </p>
    );
  }
  if (isError) {
    return (
      <p role="alert" className="text-sm text-danger-text">
        {errorMessage}
      </p>
    );
  }
  if (table.getRowModel().rows.length === 0) {
    return <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{emptyMessage}</div>;
  }

  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border bg-card', className)}>
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr
              key={headerGroup.id}
              className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {headerGroup.headers.map((header) => {
                const sortDir = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                return (
                  <th
                    key={header.id}
                    className="px-4 py-2.5 text-start"
                    aria-sort={sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : undefined}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 uppercase tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span aria-hidden="true" className="text-[9px]">
                          {sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : ''}
                        </span>
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-b-0 hover:bg-muted">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-2.5">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
