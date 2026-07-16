import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAdmin } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import type { TopicKeywordRow } from "../types.js";

export const topicKeywordsRouter = Router();

const createSchema = z.object({
  keyword: z.string().min(1).max(200),
  topic_label: z.string().min(1).max(200),
});
const updateSchema = z.object({
  keyword: z.string().min(1).max(200).optional(),
  topic_label: z.string().min(1).max(200).optional(),
  active: z.boolean().optional(),
});

topicKeywordsRouter.get("/", async (_req, res) => {
  const { rows } = await query<TopicKeywordRow>(
    `SELECT * FROM topic_keywords ORDER BY topic_label ASC, keyword ASC`,
  );
  res.json({ topic_keywords: rows });
});

topicKeywordsRouter.post("/", requireAdmin, async (req, res) => {
  const body = createSchema.parse(req.body);
  const { rows } = await query<TopicKeywordRow>(
    `INSERT INTO topic_keywords (keyword, topic_label) VALUES ($1, $2) RETURNING *`,
    [body.keyword.trim(), body.topic_label.trim()],
  );
  res.status(201).json({ topic_keyword: rows[0] });
});

topicKeywordsRouter.put("/:id", requireAdmin, async (req, res) => {
  const body = updateSchema.parse(req.body);
  const { rows } = await query<TopicKeywordRow>(
    `UPDATE topic_keywords
        SET keyword     = COALESCE($1, keyword),
            topic_label = COALESCE($2, topic_label),
            active      = COALESCE($3, active),
            updated_at  = NOW()
      WHERE id = $4
      RETURNING *`,
    [body.keyword ?? null, body.topic_label ?? null, body.active ?? null, req.params.id],
  );
  if (!rows[0]) throw new HttpError(404, "topic keyword not found");
  res.json({ topic_keyword: rows[0] });
});

topicKeywordsRouter.delete("/:id", requireAdmin, async (req, res) => {
  const { rowCount } = await query(`DELETE FROM topic_keywords WHERE id = $1`, [req.params.id]);
  if (rowCount === 0) throw new HttpError(404, "topic keyword not found");
  res.status(204).end();
});
