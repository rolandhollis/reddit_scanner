import * as React from "react";
import { cn } from "@/lib/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "block w-full rounded-md border border-rs-stone bg-white px-3 py-2 text-sm text-rs-ink placeholder:text-rs-slate/60 focus:border-rs-orange focus:outline-none focus:ring-1 focus:ring-rs-orange",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
