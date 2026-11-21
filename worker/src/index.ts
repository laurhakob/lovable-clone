import { Hono } from "hono";
import { cors } from "hono/cors";
import { Env, AppVariables } from "./types";
import { authMiddleware } from "./middleware/auth";
import { projectRoutes } from "./routes/project";
import { chatRoutes } from "./routes/chat";
import { creditsRoutes } from "./routes/credits";
import { versionsRoutes } from "./routes/versions";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use("*", async (c, next) => {
  const allowedOrigins = c.env.FRONTEND_URL || "http://localhost:3000";
  const middleware = cors({
    origin: [allowedOrigins],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
    credentials: true,
  });
  return middleware(c, next);
});

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/*", authMiddleware);
app.route("/api/projects", projectRoutes);
app.route("/api/chat", chatRoutes);
app.route("/api/credits", creditsRoutes);
// versionsRoutes defines its own "/:id/versions" paths, so mount at /api/projects
app.route("/api/projects", versionsRoutes);

// ---------------------------------------------------------------
// Error handling – always respond with JSON
// ---------------------------------------------------------------

/**
 * Catch-all for unhandled exceptions in any route handler.
 * Without this, Workers returns a plain-text 500, which the frontend
 * cannot parse — every such failure showed up as "Unknown error".
 */
app.onError((err, c) => {
  console.error(`[${c.req.method} ${c.req.path}] Unhandled error:`, err);
  return c.json(
    {
      error: err instanceof Error ? err.message : "Internal server error",
      code: "INTERNAL_ERROR",
    },
    500
  );
});

/**
 * JSON 404 so unmatched API paths are also machine-readable.
 */
app.notFound((c) => {
  return c.json(
    { error: `No route for ${c.req.method} ${c.req.path}`, code: "NOT_FOUND" },
    404
  );
});

export default app;
