// The issue's title (edited in place: ↵ or leaving the field saves, Esc reverts) and description
// (markdown; click or E to edit, ⌘↵ saves, Esc cancels).
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { Kbd } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { Markdown } from "../Markdown";

/** Grow a textarea to its content. */
function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, min = 0) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(min, el.scrollHeight)}px`;
  }, [ref, value, min]);
}

export function TitleEditor({ value, onSave, readOnly }: { value: string; onSave: (title: string) => void; readOnly?: boolean }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosize(ref, draft);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.replace(/\s+/g, " ").trim();
    if (!next) setDraft(value);
    else if (next !== value) onSave(next);
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      dir="auto"
      value={draft}
      readOnly={readOnly}
      aria-label={t("issue.titleLabel")}
      spellCheck
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setDraft(value);
          setEditing(false);
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
      className="-mx-1.5 w-[calc(100%+12px)] resize-none overflow-hidden rounded-md bg-transparent px-1.5 py-0.5 text-[21px] leading-[1.35] font-semibold tracking-[-0.01em] text-grid-fg outline-none placeholder:text-grid-muted hover:bg-grid-soft/40 focus:bg-transparent"
      data-issue-title
    />
  );
}

export interface DescriptionHandle {
  edit: () => void;
}

export const DescriptionEditor = forwardRef<DescriptionHandle, { value: string; onSave: (text: string) => void; readOnly?: boolean }>(function DescriptionEditor(
  { value, onSave, readOnly },
  handle,
) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosize(ref, editing ? draft : "", 120);

  const start = () => {
    if (readOnly) return;
    setDraft(value);
    setEditing(true);
  };
  useImperativeHandle(handle, () => ({ edit: start }));
  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const save = () => {
    setEditing(false);
    if (draft.trim() !== value.trim()) onSave(draft.trim());
  };
  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-2" data-description-editor>
        <textarea
          ref={ref}
          dir="auto"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("issue.addDescription")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
          }}
          className="-mx-2 w-[calc(100%+16px)] resize-none rounded-md border border-line bg-grid-card px-2 py-1.5 font-mono text-[12.5px] leading-[1.6] text-grid-fg outline-none focus:border-[color-mix(in_oklab,var(--grid-action)_55%,var(--grid-line))]"
        />
        <div className="flex items-center justify-end gap-2">
          <span className="me-auto flex items-center gap-1.5 text-[11.5px] text-grid-muted">
            <Kbd combo="mod+enter" /> {t("common.save")} · <Kbd combo="Esc" /> {t("common.cancel")}
          </span>
          <Button size="sm" variant="ghost" onClick={cancel}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={save} data-description-save>
            {t("common.save")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      role={readOnly ? undefined : "button"}
      tabIndex={readOnly ? undefined : 0}
      onClick={(e) => {
        // A link inside opens in the browser; anything else edits.
        if ((e.target as HTMLElement).closest("a")) return;
        start();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          start();
        }
      }}
      className={cn("-mx-2 min-h-9 rounded-md px-2 py-1.5 outline-none", !readOnly && "hover:bg-grid-soft/40 focus-visible:bg-grid-soft/40")}
      data-description
    >
      {value.trim() ? <Markdown source={value} /> : <p className="text-[13px] text-grid-muted">{readOnly ? t("issue.noDescription") : t("issue.addDescription")}</p>}
    </div>
  );
});
