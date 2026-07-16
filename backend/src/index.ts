import "express-async-errors";
import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { bootstrapSuperAdmin } from "./auth/bootstrap.js";
import { config } from "./config.js";
import { startScheduler } from "./jobs/scanCron.js";
import { authenticate } from "./middleware/auth.js";
import { csrfGuard } from "./middleware/csrf.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { authRouter } from "./routes/auth.js";
import { configRouter } from "./routes/config.js";
import { mentionsRouter } from "./routes/mentions.js";
import { negativeKeywordsRouter } from "./routes/negativeKeywords.js";
import { scanRouter } from "./routes/scan.js";
import { searchTermsRouter } from "./routes/searchTerms.js";
import { topicKeywordsRouter } from "./routes/topicKeywords.js";
import { usersRouter } from "./routes/users.js";

const app = express();

app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// CSRF defense (no-op in mock mode; see middleware/csrf.ts).
app.use(csrfGuard);

app.get("/api/health", (_req, res) => res.json({ ok: true, auth: config.authMode }));

// Auth endpoints (login/logout/me/change-password) intentionally NOT
// behind authenticate — auth.ts attaches it selectively.
app.use("/api/auth", authRouter);

// Unauthenticated: mock roster for the dev switcher. Only reachable in
// mock mode; the router itself 404s otherwise.
app.use("/api/users", (req, res, next) => {
  if (req.method === "GET" && req.path === "/mock-roster" && config.authMode === "mock") {
    return next();
  }
  return authenticate(req, res, next);
}, usersRouter);

// Everything else is behind auth. Role gating (admin vs user vs
// viewer) happens inside each router on the individual write endpoints.
app.use("/api/config", authenticate, configRouter);
app.use("/api/search-terms", authenticate, searchTermsRouter);
app.use("/api/negative-keywords", authenticate, negativeKeywordsRouter);
app.use("/api/topic-keywords", authenticate, topicKeywordsRouter);
app.use("/api/mentions", authenticate, mentionsRouter);

// scanRouter attaches auth itself so it can accept EITHER the bearer
// token OR a session cookie on /run.
app.use("/api/scan", scanRouter);

// When STATIC_DIR is set (Docker image), serve the compiled SPA from
// the same origin as the API and fall back to index.html for any
// unknown non-/api path so react-router's client-side routes resolve
// on reload.
if (config.staticDir) {
  const dir = path.resolve(config.staticDir);
  if (!existsSync(dir)) {
    console.warn(`[api] STATIC_DIR=${dir} does not exist; skipping SPA mount`);
  } else {
    const indexHtml = path.join(dir, "index.html");
    app.use(express.static(dir, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(indexHtml);
    });
    console.log(`[api] serving SPA from ${dir}`);
  }
}

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port} (auth=${config.authMode})`);
  bootstrapSuperAdmin().catch((err) => console.error("[auth] super-admin bootstrap failed", err));
  startScheduler().catch((err) => console.error("[cron] scheduler start failed", err));
});
