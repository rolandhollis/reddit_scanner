import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAdmin } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import type { NegativeKeywordRow } from "../types.js";

export const negativeKeywordsRouter = Router();

const createSchema = z.object({
  keyword: z.string().min(1).max(200),
});
const updateSchema = z.object({
  keyword: z.string().min(1).max(200).optional(),
  active: z.boolean().optional(),
});

negativeKeywordsRouter.get("/", async (_req, res) => {
  const { rows } = await query<NegativeKeywordRow>(
    `SELECT * FROM negative_keywords ORDER BY created_at ASC`,
  );
  res.json({ negative_keywords: rows });
});

negativeKeywordsRouter.post("/", requireAdmin, async (req, res) => {
  const body = createSchema.parse(req.body);
  const { rows } = await query<NegativeKeywordRow>(
    `INSERT INTO negative_keywords (keyword) VALUES ($1) RETURNING *`,
    [body.keyword.trim()],
  );
  res.status(201).json({ negative_keyword: rows[0] });
});

negativeKeywordsRouter.put("/:id", requireAdmin, async (req, res) => {
  const body = updateSchema.parse(req.body);
  const { rows } = await query<NegativeKeywordRow>(
    `UPDATE negative_keywords
        SET keyword = COALESCE($1, keyword),
            active  = COALESCE($2, active),
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [body.keyword ?? null, body.active ?? null, req.params.id],
  );
  if (!rows[0]) throw new HttpError(404, "negative keyword not found");
  res.json({ negative_keyword: rows[0] });
});

negativeKeywordsRouter.delete("/:id", requireAdmin, async (req, res) => {
  const { rowCount } = await query(`DELETE FROM negative_keywords WHERE id = $1`, [req.params.id]);
  if (rowCount === 0) throw new HttpError(404, "negative keyword not found");
  res.status(204).end();
});
