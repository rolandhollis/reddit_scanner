import * as React from "react";
import { cn } from "@/lib/cn";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "block w-full rounded-md border border-rs-stone bg-white px-3 py-2 text-sm text-rs-ink placeholder:text-rs-slate/60 focus:border-rs-orange focus:outline-none focus:ring-1 focus:ring-rs-orange",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
