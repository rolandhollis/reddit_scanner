import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAdmin } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import type { SearchTermRow } from "../types.js";

export const searchTermsRouter = Router();

const createSchema = z.object({
  term: z.string().min(1).max(200),
});
const updateSchema = z.object({
  term: z.string().min(1).max(200).optional(),
  active: z.boolean().optional(),
});

searchTermsRouter.get("/", async (_req, res) => {
  const { rows } = await query<SearchTermRow>(
    `SELECT * FROM search_terms ORDER BY created_at ASC`,
  );
  res.json({ search_terms: rows });
});

searchTermsRouter.post("/", requireAdmin, async (req, res) => {
  const body = createSchema.parse(req.body);
  const { rows } = await query<SearchTermRow>(
    `INSERT INTO search_terms (term) VALUES ($1) RETURNING *`,
    [body.term.trim()],
  );
  res.status(201).json({ search_term: rows[0] });
});

searchTermsRouter.put("/:id", requireAdmin, async (req, res) => {
  const body = updateSchema.parse(req.body);
  const { rows } = await query<SearchTermRow>(
    `UPDATE search_terms
        SET term   = COALESCE($1, term),
            active = COALESCE($2, active),
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [body.term ?? null, body.active ?? null, req.params.id],
  );
  if (!rows[0]) throw new HttpError(404, "search term not found");
  res.json({ search_term: rows[0] });
});

searchTermsRouter.delete("/:id", requireAdmin, async (req, res) => {
  const { rowCount } = await query(`DELETE FROM search_terms WHERE id = $1`, [req.params.id]);
  if (rowCount === 0) throw new HttpError(404, "search term not found");
  res.status(204).end();
});
