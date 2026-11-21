/**
 * scripts/strip-dev-env.mjs
 *
 * OpenNext embeds the variables from every .env file into
 * .open-next/cloudflare/next-env.mjs, grouped by mode (production,
 * development, test). The deployed worker only reads the "production"
 * group (NEXTJS_ENV defaults to "production"), but the "development" group
 * is filled from .env.local and contains real secrets such as
 * CLERK_SECRET_KEY. This empties every group except "production" so those
 * values are never uploaded. Secrets reach production as Cloudflare
 * secrets instead (`wrangler secret put`).
 *
 * Run after `opennextjs-cloudflare build`, before deploy/preview.
 */

import { readFileSync, writeFileSync } from "node:fs";

const FILE = ".open-next/cloudflare/next-env.mjs";
const KEEP = new Set(["production"]);

const source = readFileSync(FILE, "utf8");
const stripped = [];

const output = source.replace(
  /export const (\w+)\s*=\s*\{[\s\S]*?\};/g,
  (match, name) => {
    if (KEEP.has(name)) return match;
    stripped.push(name);
    return `export const ${name} = {};`;
  },
);

if (!/export const production\s*=/.test(output)) {
  console.error(`[strip-dev-env] No "production" export found in ${FILE}; aborting.`);
  process.exit(1);
}

writeFileSync(FILE, output);
console.log(
  `[strip-dev-env] Emptied env groups: ${stripped.join(", ") || "(none)"}`,
);
