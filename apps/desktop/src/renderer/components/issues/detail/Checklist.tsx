// The issue's checklist: tick, rename (click the text), remove, and add (↵ keeps the field open
// for the next one). Every change shows at once and rolls back if the API refuses.
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import type { ChecklistItem, TaskDetail } from "../../../../shared/types";
import { LtrText } from "@/components/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { cn } from "@/lib/utils";

import { ProgressBar, SectionTitle } from "../controls";

export function Checklist({ task, readOnly }: { task: TaskDetail; readOnly?: boolean }) {
  const { t, number } = useI18n();
  const { ws } = useApp();
  const qc = useQueryClient();
  const key = qk.task(ws, task.key);
  const items = [...(task.checklist ?? [])].sort((a, b) => a.position - b.position);
  const done = items.filter((i) => i.done).length;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const patch = (fn: (list: ChecklistItem[]) => ChecklistItem[]) =>
    qc.setQueryData<TaskDetail>(key, (d) => {
      if (!d) return d;
      const list = fn(d.checklist ?? []);
      return { ...d, checklist: list, checklist_total: list.length, checklist_done: list.filter((i) => i.done).length };
    });
  const change = async (optimistic: (list: ChecklistItem[]) => ChecklistItem[], call: () => Promise<unknown>) => {
    const before = qc.getQueryData<TaskDetail>(key);
    patch(optimistic);
    try {
      await call();
    } catch (e) {
      if (before) qc.setQueryData(key, before);
      toast.error(e instanceof Error && e.message ? e.message : t("common.error"));
    } finally {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: qk.taskActivity(ws, task.key) });
    }
  };

  const toggle = (item: ChecklistItem) =>
    change(
      (l) => l.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
      () => api.updateChecklistItem(item.id, { done: !item.done }),
    );
  const rename = (item: ChecklistItem, title: string) =>
    change(
      (l) => l.map((i) => (i.id === item.id ? { ...i, title } : i)),
      () => api.updateChecklistItem(item.id, { title }),
    );
  const remove = (item: ChecklistItem) =>
    change(
      (l) => l.filter((i) => i.id !== item.id),
      () => api.deleteChecklistItem(item.id),
    );
  const add = (title: string) => {
    const temp: ChecklistItem = { id: `pending-${Date.now()}`, title, done: false, done_at: null, done_by: null, position: (items.at(-1)?.position ?? 0) + 1024 };
    return change(
      (l) => [...l, temp],
      () => api.addChecklistItem(task.key, title),
    );
  };

  if (!items.length && !adding && readOnly) return null;

  return (
    <section className="flex flex-col" data-checklist aria-label={t("issue.checklist")}>
      <SectionTitle
        actions={
          readOnly ? null : (
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                requestAnimationFrame(() => input.current?.focus());
              }}
              title={t("issue.addItem")}
              aria-label={t("issue.addItem")}
              className="flex size-6 items-center justify-center rounded-md text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
            >
              <PlusIcon className="size-3.5" />
            </button>
          )
        }
      >
        <span className="flex items-center gap-2">
          {t("issue.checklist")}
          {items.length ? (
            <LtrText className="tabular-nums">
              {number(done)}/{number(items.length)}
            </LtrText>
          ) : null}
        </span>
      </SectionTitle>
      {items.length ? <ProgressBar value={done} total={items.length} className="mt-1 mb-1.5 h-[3px]" /> : null}
      <ul className="flex flex-col">
        {items.map((item) => (
          <Item key={item.id} item={item} readOnly={readOnly} onToggle={() => void toggle(item)} onRename={(title) => void rename(item, title)} onRemove={() => void remove(item)} />
        ))}
      </ul>
      {!readOnly && (adding || !items.length) ? (
        <form
          className="flex h-8 items-center gap-2 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            const title = draft.trim();
            if (!title) return;
            setDraft("");
            void add(title);
          }}
        >
          <PlusIcon className="size-4 shrink-0 text-grid-muted" />
          <input
            ref={input}
            value={draft}
            dir="auto"
            onChange={(e) => setDraft(e.target.value)}
            // Typing into the empty list's field keeps it open after the first item, for the next.
            onFocus={() => setAdding(true)}
            onBlur={() => !draft.trim() && setAdding(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDraft("");
                setAdding(false);
                e.currentTarget.blur();
              }
            }}
            placeholder={t("issue.addItemPlaceholder")}
            className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-grid-fg outline-none placeholder:text-grid-muted"
            data-checklist-add
          />
        </form>
      ) : null}
    </section>
  );
}

function Item({ item, readOnly, onToggle, onRename, onRemove }: { item: ChecklistItem; readOnly?: boolean; onToggle: () => void; onRename: (t: string) => void; onRemove: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const pending = item.id.startsWith("pending-");
  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== item.title) onRename(v);
    else setDraft(item.title);
  };
  return (
    <li className={cn("group flex min-h-8 items-center gap-2.5 rounded-md px-1 hover:bg-grid-soft/50", pending && "opacity-60")} data-checklist-item={item.title} data-done={item.done || undefined}>
      <Checkbox checked={item.done} onCheckedChange={onToggle} disabled={readOnly || pending} aria-label={item.title} className="ms-0.5" />
      {editing ? (
        <input
          autoFocus
          value={draft}
          dir="auto"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDraft(item.title);
              setEditing(false);
            }
          }}
          className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-grid-fg outline-none"
        />
      ) : (
        <span
          dir="auto"
          onClick={() => !readOnly && !pending && (setDraft(item.title), setEditing(true))}
          className={cn("min-w-0 flex-1 py-1 text-[13px] break-words", item.done ? "text-grid-muted line-through decoration-grid-muted/60" : "text-grid-fg")}
        >
          {item.title}
        </span>
      )}
      {readOnly || pending ? null : (
        <button
          type="button"
          onClick={onRemove}
          title={t("common.delete")}
          aria-label={t("common.delete")}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-grid-muted opacity-0 group-hover:opacity-100 hover:bg-grid-soft hover:text-grid-fg focus-visible:opacity-100"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </li>
  );
}
