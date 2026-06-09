import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * `cn` — conditional class names + Tailwind class merging.
 * Used by every shadcn-style component. Resolves conflicts like
 * `cn("p-2", "p-4")` to `"p-4"`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
