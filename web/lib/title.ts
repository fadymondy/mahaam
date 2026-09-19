"use client"

import { useEffect } from "react"

import { brandName } from "@/lib/brand-name"

/** Every route sets its own document title: "<page> · Mahaam". */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    const name = brandName(document.documentElement.lang)
    document.title = title ? `${title} · ${name}` : name
  }, [title])
}
