"use client"

import { createContext, useContext } from "react"

import type { ProjectDetail } from "@/lib/work"

export type ProjectCtx = {
  project: ProjectDetail
  /** Revalidate the project (and everything that hangs off it). */
  reload: () => void
  /** Open the task side-over (?task=MH-12). */
  openTask: (key: string) => void
  /** /<locale>/w/<slug>/projects/<id> */
  base: string
}

export const ProjectContext = createContext<ProjectCtx | null>(null)

export function useProjectCtx(): ProjectCtx {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error("useProjectCtx must be used inside a project layout")
  return ctx
}
