"use client"

import { useEffect } from "react"

/** Every route sets its own document title: "<page> · Managy". */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Managy` : "Managy"
  }, [title])
}
