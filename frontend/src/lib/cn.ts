import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * `cn(...args)` — tailwind-aware clsx.
 *
 * `clsx` handles arrays/objects/falsy skipping; `twMerge` resolves
 * conflicts (e.g. `bg-red-500 bg-blue-500` → `bg-blue-500`) so
 * per-variant overrides in components don't produce competing
 * utilities in the final class string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
