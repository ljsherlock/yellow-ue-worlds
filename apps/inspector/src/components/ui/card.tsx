import type { HTMLAttributes, Ref } from "react";

import { cn } from "@/lib/utils";

type DivProps = HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> };

export function Card({ className, ref, ...props }: DivProps) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-md border border-border bg-zinc-900/40 text-fg shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ref, ...props }: DivProps) {
  return (
    <div
      ref={ref}
      className={cn("flex flex-col gap-1.5 p-4 border-b border-border", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ref, ...props }: DivProps) {
  return (
    <h3
      ref={ref as Ref<HTMLHeadingElement>}
      className={cn("text-base font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ref, ...props }: DivProps) {
  return (
    <p
      ref={ref as Ref<HTMLParagraphElement>}
      className={cn("text-sm text-muted", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ref, ...props }: DivProps) {
  return <div ref={ref} className={cn("p-4", className)} {...props} />;
}

export function CardFooter({ className, ref, ...props }: DivProps) {
  return (
    <div
      ref={ref}
      className={cn(
        "flex items-center p-4 pt-0 border-t border-border",
        className,
      )}
      {...props}
    />
  );
}
