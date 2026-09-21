import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// Same helper the web app uses, so components copied from web/components/ui work unchanged.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
