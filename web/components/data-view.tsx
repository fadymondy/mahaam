"use client"

import type { ReactNode } from "react"
import {
  DataTable,
  DataTablePagination,
  DataTableSearch,
  DataTableToolbar,
  DataTableViewOptions,
  type DataTableInstance,
  type DataTableProps,
} from "@fadymondy/nasaq/web"

/*
A Nasaq DataTable with its toolbar: search (when `search` is set, over the columns' searchValue),
the page's facet filters and controls (`filters`), the View menu, the framed table, and pagination
when the table has a pageSize. Every list table in the workspace goes through it so they all search,
filter, sort and page the same way.
*/
export function DataView<T>({
  table,
  search,
  filters,
  toolbarEnd,
  ...props
}: DataTableProps<T> & {
  table: DataTableInstance<T>
  /** Placeholder of the search box; omit for no search. */
  search?: string
  /** Facet filters and other controls, after the search box. */
  filters?: ReactNode
  /** Controls at the toolbar's end, before the View menu. */
  toolbarEnd?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {search || filters || toolbarEnd ? (
        <DataTableToolbar>
          {search ? <DataTableSearch table={table} placeholder={search} aria-label={search} className="min-w-48 flex-1 sm:max-w-xs" /> : null}
          {filters}
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {toolbarEnd}
            <DataTableViewOptions table={table} />
          </div>
        </DataTableToolbar>
      ) : null}
      <DataTable table={table} frame {...props} />
      <DataTablePagination table={table} />
    </div>
  )
}
