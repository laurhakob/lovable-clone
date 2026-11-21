# Agent prompt: finish the "Lovable clone" AI app builder

Copy everything below the line into your AI coding agent, run from the root of your project.

---

You are finishing an existing project: an AI app builder (a "Lovable clone"). Users chat with an AI model, it generates a React app as files, and the app shows a live preview, a code editor and version history. It has auth, credits and paid plans.

The project is already partly built. **Before writing anything, explore the repo** and learn the existing structure, naming, types (`ProjectFile`, `VersionMeta`, `UserCredits`, etc.), the API client, the auth middleware, and how files/versions/chat sessions/credits are stored. Match the existing conventions. The spec below comes from a video transcript, so some names may differ slightly from the real code. When they conflict, the existing code wins. If something below already exists, check it against the spec and move on.

## Stack (already in place)

- **Frontend:** Next.js App Router + TypeScript, Tailwind, shadcn/ui (`Button`, `Badge`, `Dialog`, `ScrollArea`, `Skeleton`, `Progress`, `Popover`), lucide-react icons, `cn()` helper, `sonner` toasts, Clerk (`@clerk/nextjs`) for auth.
- **Backend:** Cloudflare Worker using **Hono** (`new Hono<{ Bindings: Env; Variables: AppVariables }>()`), run locally with `npx wrangler dev` on port **8787**. Uses a **KV** namespace (user credits, chat sessions, project metadata) and an object store binding `c.env.FILES` (version snapshots at `${projectId}/v${n}/files.json`). Clerk auth middleware gives `userId`. There's a helper like `getOwnProject(...)`.
- **AI output format:** The model streams markdown with file blocks in tags. The frontend parses them into files.

## What's left to build (in this order)

### 1. Chat: generation progress + message bubble
**`components/editor/generation-progress.tsx`** (client component). Props: `content`, `isStreaming`, `changedFiles`. Parse file progress from the streaming content (path + status: open tag seen → "writing", close tag seen → "complete").
- Phase 1, **thinking**: streaming and no files yet. Show a brain/circuit icon + "Thinking… Analyzing your request".
- Phase 2, **generating**: streaming with files. Show the file list with per-file status and a progress bar.
- Phase 3, **done**: show a summary card of the changed files.
- Not streaming and no files: render `null`.

**`message-bubble.tsx`:**
- System messages render as a small centered **pill**.
- User and assistant messages show an avatar (user icon, or bot icon plus the model name).
- Image attachments show as thumbnails. Clicking one opens a **lightbox**.
- Display content is cleaned of file tags and of partial/incomplete file blocks during streaming. Render it with `react-markdown` + `remark-gfm` (tables etc.). Below it, render `<GenerationProgress>`.
- Fix: the chat **auto-scroll to bottom** isn't working. Make it scroll on new messages and while streaming.

### 2. Live preview (Sandpack)
**`components/editor/preview-panel.tsx`** (client). Props: `files: Record<string,string>`, `onError?: (error: { message: string }) => void`.
- `extractDependencies(files)`: base deps `react`, `react-dom`, merged with `dependencies` from `package.json` in files (safe JSON parse, fall back to base).
- `toSandpackFiles(files)`: normalize paths to Sandpack format (leading `/`). Reuse the version that already exists in `project-preview` if there is one.
- `ErrorListener` component: uses `useSandpack()` `listen` to subscribe to bundler/runtime errors. Dedupe with refs (last error), call `onError` via `useCallback`/`useEffect`, unsubscribe on cleanup. Renders `null`.
- A small "Built with <app name>" badge linking to `/dashboard`, passed as `actionsChildren`. Use our own brand name and logo, not Lovable's.
- Layout: `<SandpackProvider template="react-ts" theme files options customSetup={{ dependencies }}>` (copy the props from `project-preview`), `{onError && <ErrorListener/>}`, then `<SandpackLayout style={{height:'100%',border:'none',borderRadius:0}}>` containing `<SandpackPreview showNavigator showRefreshButton showOpenInCodeSandbox={false} actionsChildren={<Badge/>} style={{height:'100%'}}/>`. The wrapper div is `h-full w-full` with a class that stretches Sandpack to full height.
- **`preview-skeleton.tsx`**: plain skeleton JSX.
- In the project page (`app/.../projects/[projectId]/page.tsx`), import `PreviewPanel` with `next/dynamic` (`ssr: false`, `loading: PreviewSkeleton`). Replace the placeholder div with `<PreviewPanel files={files} onError={handleSandpackError} />`.

### 3. Code editor (Monaco)
**`code-editor-panel.tsx`** (client). Props: `files`, `activeFile`, `onActiveFileChange(path)`, `onFileContentChange(path, content)`.
- `getLanguageFromPath`: tsx/ts → typescript, jsx/js → javascript, css, json, html, md → markdown, else plaintext. `getFileName(path)` returns the last path segment.
- `beforeMount`: configure `monaco.languages.typescript.typescriptDefaults` compiler options (JSX react-jsx, ESNext, module resolution, allowJs, esModuleInterop…). Set diagnostics options so missing-module errors don't flood the editor. `onMount` stores the editor in a ref.
- `onChange`: if the value isn't `undefined`, call `onFileContentChange(activeFile, value)`.
- Layout: `flex h-full`. Left: file explorer (`hidden md:block w-52 shrink-0`). Right: `flex-1 flex-col` with a file tab showing the active file name + icon, then the `<Editor>` (height 100%, language, value, theme follows app theme, options: minimap off, font size, word wrap, automaticLayout).

**`file-explorer.tsx`** (client). Props: `files`, `activeFile`, `onFileSelect(path)`.
- `buildFileTree(paths)`: split each path on `/` and build a `TreeNode { name, path, children? }` tree (folders have `children`).
- Sort recursively: folders first, then `localeCompare` by name.
- `TreeNodeItem`: recursive, with indent by `depth`, its own open state, chevron down/right + folder icon for folders, file icon for files, and the active file highlighted.

**`editor-skeleton.tsx`**: plain skeleton. Import `CodeEditorPanel` dynamically (`ssr:false`). Wire `onFileContentChange={(path, content) => setFiles(prev => ({ ...prev, [path]: content }))}`.

**Layout bug to fix:** the panels for preview, code and history are stacked. Each panel must be `absolute inset-0` and toggled with `activeTab === 'preview' ? 'visible z-10' : 'invisible z-0'` (same for `code` and `history`), not unmounted, so Sandpack stays alive. Each is wrapped in its panel error boundary. Check the div nesting in the editor layout: there was an extra closing/opening div that put the code panel on top of everything.

**Manual edits must be saved as versions:** debounce edits (or add a Save action) and call `versions.saveManual(projectId, files)` (see §4).

### 4. Version history (backend: `worker/src/routes/versions.ts`)
The list route `GET /` already exists. All routes check `userId`, load the project via `getOwnProject`, return 404 if missing, validate version numbers (`isNaN` or `< 0` → 400; greater than `project.currentVersion` → 400/404).

The version object (stored at `${projectId}/v${n}/files.json`) contains `versionNumber, prompt, model, files: ProjectFile[], changedFiles: string[], type: 'ai' | 'manual' | 'restore', createdAt (ISO), fileCount, restoredFrom?`.

- `GET /:v` → `{ files, meta }` for one version (404 "Version not found" if the object is missing).
- `GET /:v1/diff/:v2` → reject equal versions. Fetch both objects with `Promise.all` (404 if either is missing). Build `Map<path, content>` for each. `changes: { path, type: 'added' | 'removed' | 'modified', oldContent: string | null, newContent: string | null }[]` covers: in v2 but not v1 → added, content differs → modified, identical → skip, in v1 but not v2 → removed. Sort modified (0), added (1), removed (2). Return `{ from: v1, to: v2, changes }`.
- `POST /:v/restore` → load the source version and create a **new** version `currentVersion + 1` with `type: 'restore'`, `prompt: "Restored from version N"`, the source's model/files/fileCount, `changedFiles` = all paths, `restoredFrom: N`. Update `project.currentVersion` and `updatedAt`, then write the version object and project together. In a try/catch, append a **system message** ("Restored to version N") to the project's chat session in KV. Log failures without failing the request. Return the restored files + new meta.
- `POST /` (manual save) → body `{ files }` (400 if missing). Compare with the current version to compute changed and removed files. If nothing changed, don't create a version. Otherwise store a `type: 'manual'` version N+1, update the project, and return `{ versionNumber, meta }`.

**API client** (`versions`): add `get(projectId, v)`, `diff(projectId, v1, v2)`, `restore(projectId, v)`, `saveManual(projectId, files)` alongside `list`, using the existing authenticated-fetch + `getToken` pattern.

**`version-timeline.tsx`** (client). Props: `versions: VersionMeta[]`, `currentVersion`, `viewingVersion: number | null`, `onViewVersion`, `onRestoreVersion`, `onCompareVersions(from, to)`, `isLoading`.
- Type badge (shadcn `Badge` from `components/ui/badge`, **not** lucide): ai → "AI generation" + `Bot` icon, variant default. manual → "Manual edit" + `Pencil`, secondary. restore → "Restored" + `RotateCcw`, outline.
- Relative timestamp formatter. `truncatePrompt(prompt, max = 60)` cuts to `max - 3` and appends "...".
- On mount, scroll the current version into view (ref). Loading → `VersionTimelineSkeleton`. Empty → "No version history yet. Send a message to generate your first version."
- Header "Version History" with a Compare button (`GitCompare`) only when there are 2+ versions. A `ScrollArea` list shows badge, truncated prompt, model, file count, time, and buttons for View, Restore and "Compare with current".
- Restore opens a confirm `Dialog`.
- **Skip versions with no `versionNumber`** (old projects stored a v0 with only `fileCount`, which crashed the badge lookup).

**`version-diff.tsx`** (client, Monaco `DiffEditor`). Props: `from`, `to`, `changes`, `onClose`. Header with a file selector listing changes with added/removed/modified icons, and a diff editor for the selected file with language from the path. Empty state: "No differences found between version X and Y". Import dynamically with `ssr:false`.

**Project page handlers:**
- `handleViewVersion(n)`: if n is the current version, exit viewing mode. Otherwise fetch the version, show its files read-only, and set `viewingVersion`.
- `handleCompareVersions(from, to)`: fetch the diff and set the diff state, which shows `VersionDiff` in place of the timeline.
- `handleRestoreVersion(n)`: call restore, set files plus the current/last files refs, update project metadata, clear `viewingVersion` and the diff, add the system message to local chat, refresh the version list.

### 5. Credits & billing (backend)
Credits are stored per user in KV (`UserCredits { remaining, total, plan: 'free' | 'pro', periodStart, periodEnd, isUnlimited }`). Free plan is **50 credits/month** and **max 3 projects**. Pro is unlimited.

In the credits service:
- `deductCredits(userId, cost, env)`: unlimited → return unchanged. Otherwise `remaining = Math.max(0, remaining - cost)`, then save. One version may already exist in the credits route and be used by `chat.ts`. Keep a **single** implementation.
- `upgradePlan(userId, env)`: plan `pro`, unlimited.
- `downgradePlan(userId, env)`: plan `free`, 50 credits, new billing period.

**`routes/billing.ts`**: `POST /plan-change` with body `{ action: 'upgrade' | 'downgrade' }` (400 if missing). Returns `{ success: true, credits: { remaining, total, plan, periodEnd, isUnlimited } }`.

**`routes/webhooks.ts`** (Clerk Billing webhooks, verified with **svix**: `npm i svix` in the worker):
- Read the `svix-id`, `svix-timestamp` and `svix-signature` headers (400 if any is missing) and the raw body text. Verify with `new Webhook(c.env.CLERK_WEBHOOK_SECRET).verify(body, headers)`. Invalid signature → 400.
- Payload: `{ data: { id, plan: { id, name, slug }, payer: { user_id, email }, status, payer_id }, type, timestamp }`.
- Event handling. Check the exact event names in the Clerk dashboard; Clerk spells "canceled" with one L.
  - `subscriptionItem.active` with plan slug `pro` → `upgradePlan`.
  - `subscriptionItem.canceled` → log only. The user keeps Pro until the period ends.
  - `subscriptionItem.ended` with slug `pro` → `downgradePlan`.
  - `subscriptionItem.pastDue` / `subscription.pastDue` → log only. Clerk retries the payment.
  - Default → log "Unhandled webhook type".
- Return `{ received: true, type }`.

**Mount in `worker/src/index.ts`:** `app.route('/webhooks/clerk-billing', webhookRoutes)` **before** the auth middleware (webhooks aren't authenticated by Clerk session), and `app.route('/api/billing', billingRoutes)`. Add `CLERK_WEBHOOK_SECRET` to the `Env` type. Don't create a Next.js webhook route; the worker handles it.

### 6. Credits & billing (frontend)
- **`credits-display.tsx`** (client, takes no props, fetches its own data). Use `useAuth().getToken` → `createApiClient(getToken).credits.get()` in `useEffect`, with loading → Skeleton and failure → "Credits unavailable".
  - Pro: "∞ Unlimited" + "Manage subscription".
  - Free: `Progress` bar of used/total, "resets in N days", and an Upgrade button using Clerk's `CheckoutButton` with `planId={process.env.NEXT_PUBLIC_CLERK_PRO_PLAN_ID}` and `planPeriod="month"`. Check the current Clerk docs for the import path. In the video it was `@clerk/nextjs/experimental`; it may be stable now.
  - Put it in the app layout sidebar where the credits TODO placeholder is.
- **`upgrade-cta.tsx`** (client). Props `{ reason: string, resetDays?: number }`. Shows a Zap icon, the reason, a checklist of Pro features (Check icons), an Upgrade button and a link to `/pricing`. Show it:
  - above the chat input when credits are exhausted ("You've used all 50 free messages this month"), with the input disabled
  - when a free user picks a premium model
  - when a free user tries to create a 4th project
  - when a free user clicks Export
- **Pricing page** at `app/(marketing)/pricing/page.tsx`: `relative min-h-screen bg-background`, the landing `Navbar`, `<main className="mx-auto max-w-5xl px-6 pb-20 pt-28">`, a back-to-home link (`ArrowLeft`), a header, Clerk `<PricingTable />`, and a footnote: "All plans include live preview, code editor, version control and dark mode."
- Env: `NEXT_PUBLIC_CLERK_PRO_PLAN_ID` in `.env.local` (frontend), `CLERK_WEBHOOK_SECRET` in `.dev.vars` (worker). Never print or commit secret values. Add placeholder entries to any `.env.example`.

### 7. Multi-model selector
- On the project page, `handleModelChange = useCallback(async (modelId) => { setSelectedModelId(modelId); setProject(p => ({ ...p, model: modelId })); try { await client.projects.update(projectId, { model: modelId }) } catch { toast.error('Failed to update model. Try again.') } }, [getToken, projectId])`.
- **`model-selector.tsx`** (client). Props: `selectedModelId`, `onModelChange`, `userPlan`, `disabled`. A `Popover` trigger shows the current model's display name. The content lists models **grouped by provider** (e.g. OpenAI, Anthropic), each with speed and quality indicators. Premium models are locked for free users and show the upgrade CTA. Use the model registry that already exists in the codebase.
- In the chat panel, when credits aren't exhausted, render a `border-t border-border/50 bg-card/50 backdrop-blur-sm` container holding a `px-3 pt-2` row with `<ModelSelector disabled={isStreaming} …/>`, then the chat input below it. The selected model must persist across reloads.

### 8. Not shown in the video, but needed to call the project done
- **Auto-heal:** implement `handleSandpackError`. When the preview reports a compile/runtime error after a generation, automatically send a fix request to the AI with the error message and the affected file. Limit to about 2 automatic attempts per error, dedupe identical errors, and show it in chat as a system pill ("Auto-fixing error…"). In the video the presenter pasted errors into the chat by hand.
- **Export button** (Pro only): download the project files as a .zip (e.g. `jszip`). **Preview button**: open the preview in a new tab or full screen.
- **Free-plan limits** enforced on the **backend** too: credits checked before generation, 3-project limit, premium models.
- Settings and analytics pages, if the sidebar links to them.

## Local webhook testing (tell me the steps; don't run anything that needs my accounts)
1. `npx wrangler dev` (port 8787), then `ngrok http 8787`.
2. Clerk dashboard → Developers → Webhooks → add endpoint `https://<ngrok-url>/webhooks/clerk-billing`. Subscribe to the subscriptionItem active/canceled/ended/pastDue events and subscription.pastDue. Copy the signing secret into `.dev.vars` as `CLERK_WEBHOOK_SECRET` and restart wrangler. Use "Send example" to test.
3. Clerk → Billing → enable user billing. Free plan: 50 credits/month, 3 projects. Pro plan, key `pro`: $25/month or $20/month billed annually, unlimited credits, unlimited projects, all models, export. Copy the Pro plan ID into `NEXT_PUBLIC_CLERK_PRO_PLAN_ID`.

## Rules
- Run the type checker and build for both frontend and worker after each section. Fix all errors before moving on.
- Don't rewrite working code that isn't in scope. Don't hardcode secrets.
- At the end, give me a checklist of what you built, what you verified, and the manual dashboard steps I still need to do.
