// Quick create (C anywhere, ⌘N, the sidebar's pen): a Linear-style composer — project, title,
// description, then status / priority / assignees as pills — submitted with ⌘↵. "Create more"
// keeps it open for the next one.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AssigneePicker, PriorityPicker, ProjectPicker, StatusPicker } from "@/components/pickers";
import { Kbd } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useBoard, useMembers, useProjects, useUserId } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { openPalette } from "@/lib/native";
import { useRouter } from "@/lib/router";

const LAST_PROJECT = "mahaam.lastProject";

// The shell's openCreate(project) has no status; a column's "+" leaves one here first.
let presetStatus: string | null = null;

/** Quick create in a project and a status (a list group's or a board column's "+"): the Spotlight panel. */
export function openCreateIn(_openCreate: (projectId?: string | null) => void, projectId: string, statusId?: string | null): void {
  void openPalette("create", { project: projectId, status: statusId ?? null });
}

export function CreateIssue({ open, onOpenChange, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; projectId?: string | null }) {
  const { t } = useI18n();
  const { ws } = useApp();
  const me = useUserId();
  const qc = useQueryClient();
  const { navigate } = useRouter();
  const projects = useProjects();
  const members = useMembers();
  const [project, setProject] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [priority, setPriority] = useState("none");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [more, setMore] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const board = useBoard(project);

  // Opening picks the project in view, else the last one used, else the first.
  useEffect(() => {
    if (!open) return;
    const list = projects.data ?? [];
    const last = localStorage.getItem(LAST_PROJECT);
    const pick = projectId || (last && list.some((p) => p.id === last) ? last : null) || list[0]?.id || null;
    setProject(pick);
    setTitle("");
    setDescription("");
    setPriority("none");
    setAssignees(me ? [me] : []);
    setStatus(presetStatus);
    presetStatus = null;
  }, [open, projectId, projects.data, me]);

  const statuses = useMemo(() => [...(board.data?.statuses ?? [])].sort((a, b) => a.position - b.position), [board.data]);
  // Default status: the first "todo" that is not the backlog, else the first column.
  useEffect(() => {
    if (!statuses.length || (status && statuses.some((s) => s.id === status))) return;
    setStatus((statuses.find((s) => s.category === "todo" && s.stage !== "backlog") ?? statuses[0])?.id ?? null);
  }, [statuses, status]);

  const create = useMutation({
    mutationFn: () =>
      api.createTask(project!, {
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(status ? { status } : {}),
        priority: priority as "none",
        assignee_ids: assignees,
      }),
    onSuccess: (task) => {
      localStorage.setItem(LAST_PROJECT, project!);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === ws && ["tasks", "board", "project"].includes(String(q.queryKey[2])) });
      toast.success(t("create.created", { key: task.key }), {
        action: { label: t("issue.open"), onClick: () => navigate({ name: "issue", key: task.key }) },
      });
      if (more) {
        setTitle("");
        setDescription("");
        titleRef.current?.focus();
      } else onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("common.error")),
  });

  const ready = !!project && !!title.trim() && !create.isPending;
  const submit = () => ready && create.mutate();
  const noProjects = projects.data && projects.data.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[14%] translate-y-0 gap-0 p-0 sm:max-w-[640px]"
        data-create-issue
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <DialogHeader className="flex-row items-center gap-2 px-4 pt-3.5 pb-1">
          <ProjectPicker projects={projects.data ?? []} value={project} onChange={setProject} />
          <span className="text-grid-muted">›</span>
          <DialogTitle className="text-[13.5px] font-normal text-grid-muted">{t("create.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("create.titlePlaceholder")}</DialogDescription>
        </DialogHeader>
        {noProjects ? (
          <p className="px-4 py-6 text-[14px] text-grid-muted">{t("create.noProject")}</p>
        ) : (
          <div className="flex flex-col gap-1 px-4 pt-2">
            <input
              ref={titleRef}
              autoFocus
              dir="auto"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("create.titlePlaceholder")}
              className="h-9 w-full bg-transparent text-[18px] font-medium text-grid-fg outline-none placeholder:text-grid-muted/70"
              data-create-title
            />
            <textarea
              dir="auto"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("create.descriptionPlaceholder")}
              rows={4}
              className="min-h-24 w-full resize-none bg-transparent text-[14px] leading-relaxed text-grid-body outline-none placeholder:text-grid-muted/70"
            />
            <div className="flex flex-wrap items-center gap-1.5 pb-3">
              <StatusPicker statuses={statuses} value={status} onChange={setStatus} />
              <PriorityPicker value={priority} onChange={setPriority} />
              <AssigneePicker
                members={members.data ?? []}
                value={assignees}
                onToggle={(id) => setAssignees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))}
              />
            </div>
          </div>
        )}
        <div className="flex items-center justify-end gap-3 border-t border-line px-4 py-2.5">
          <label className="flex items-center gap-2 text-[13px] text-grid-muted">
            <Switch checked={more} onCheckedChange={setMore} size="sm" />
            {t("create.more")}
          </label>
          <Button size="sm" onClick={submit} disabled={!ready} data-create-submit>
            {t("create.submit")}
            <Kbd combo="mod+enter" className="border-primary-foreground/30 bg-transparent text-primary-foreground/80" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
