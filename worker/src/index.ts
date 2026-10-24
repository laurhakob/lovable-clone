import { Hono } from "hono";
import { cors } from "hono/cors";
import { Env, AppVariables } from "./types";
// import { authMiddleware } from './middleware/auth'

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
  return c.json({ status: "ok", timpestamp: new Date().toISOString() });
});

export default app