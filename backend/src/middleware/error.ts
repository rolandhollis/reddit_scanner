import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

/**
 * Top-level error handler.
 *
 * Zod validation errors become 400 with the parsed issues surfaced —
 * the frontend renders them inline next to the offending field. Every
 * other error is opaque 500; the message goes to server logs.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "validation_failed",
      issues: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  if (err instanceof HttpError) {
    if (err.status >= 500) {
      console.error(`[${req.method} ${req.path}] ${err.status}`, err);
    }
    res.status(err.status).json({ error: err.message, ...(err.details ?? {}) });
    return;
  }

  const anyErr = err as { code?: string; constraint?: string; detail?: string };
  // Postgres unique_violation → 409. Message keeps the constraint name
  // so the client can map it back to the offending field if needed.
  if (anyErr?.code === "23505") {
    res.status(409).json({
      error: "duplicate",
      constraint: anyErr.constraint,
      detail: anyErr.detail,
    });
    return;
  }

  console.error(`[${req.method} ${req.path}]`, err);
  res.status(500).json({ error: "internal_error" });
}

export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: "not_found", path: req.path });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
