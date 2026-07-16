/**
 * Dev + CI seed.
 *
 * Idempotently plants:
 *   * a fixed super-admin user with a stable UUID (so the smoke test
 *     can send `x-mock-user-id: 00000000-…001` without having to look
 *     the id up), plus a couple of reviewer / viewer users for the
 *     mock switcher.
 *   * a starter set of search terms, negative keywords, and
 *     topic→keyword mappings pulled from the RetailMeNot PRD so a
 *     fresh install has something to look at right away.
 *
 * We deliberately do NOT seed a sample flagged_mention. The whole point
 * of this app is that real Reddit hits show up after the first scan —
 * fake seed data with fabricated `r/…/comments/seed…/` permalinks
 * confuses reviewers who click through and hit a Reddit 404.
 *
 * Safe to re-run. Everything uses INSERT … ON CONFLICT DO NOTHING /
 * UPSERT so a partial state ends up in the same shape as a clean one.
 */
import { pool } from "./pool.js";

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const VIEWER_ID = "00000000-0000-0000-0000-000000000003";

async function seed() {
  console.log("Seeding users…");
  await pool.query(
    `INSERT INTO users (id, email, name, role, is_super_user)
     VALUES
       ($1, 'admin@example.com',   'Admin User',   'admin',  TRUE),
       ($2, 'reviewer@example.com','Review User',  'user',   FALSE),
       ($3, 'viewer@example.com',  'Viewer User',  'viewer', FALSE)
     ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            name  = EXCLUDED.name,
            role  = EXCLUDED.role,
            is_super_user = EXCLUDED.is_super_user,
            updated_at = NOW()`,
    [ADMIN_ID, USER_ID, VIEWER_ID],
  );

  console.log("Seeding search terms…");
  const searchTerms = ["RetailMeNot", "RMN", "retail me not"];
  for (const term of searchTerms) {
    await pool.query(
      `INSERT INTO search_terms (term) VALUES ($1)
       ON CONFLICT (lower(term)) DO NOTHING`,
      [term],
    );
  }

  console.log("Seeding negative keywords…");
  const negativeKeywords = [
    "scam", "fraud", "ripoff", "rip off", "fake",
    "broken", "doesn't work", "doesnt work", "not working",
    "expired", "invalid", "hate", "terrible", "worst",
    "unsubscribe", "cancel", "refund", "chargeback",
    "disappointed", "frustrated", "misleading",
  ];
  for (const kw of negativeKeywords) {
    await pool.query(
      `INSERT INTO negative_keywords (keyword) VALUES ($1)
       ON CONFLICT (lower(keyword)) DO NOTHING`,
      [kw],
    );
  }

  console.log("Seeding topic keywords…");
  const topicKeywords: [string, string][] = [
    ["app", "App"],
    ["mobile", "App"],
    ["ios", "App"],
    ["android", "App"],
    ["website", "Website"],
    ["site", "Website"],
    ["browser", "Website / Extension"],
    ["extension", "Website / Extension"],
    ["chrome", "Website / Extension"],
    ["code", "Coupon Codes"],
    ["coupon", "Coupon Codes"],
    ["promo", "Coupon Codes"],
    ["cashback", "Cashback"],
    ["cash back", "Cashback"],
    ["payout", "Cashback"],
    ["customer service", "Customer Service"],
    ["support", "Customer Service"],
    ["help desk", "Customer Service"],
    ["account", "Account"],
    ["login", "Account"],
    ["password", "Account"],
  ];
  for (const [kw, topic] of topicKeywords) {
    await pool.query(
      `INSERT INTO topic_keywords (keyword, topic_label) VALUES ($1, $2)
       ON CONFLICT (lower(keyword)) DO UPDATE SET topic_label = EXCLUDED.topic_label, updated_at = NOW()`,
      [kw, topic],
    );
  }

  console.log("Seed complete.");
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
