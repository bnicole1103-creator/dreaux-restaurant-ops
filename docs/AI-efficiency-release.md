# App review fixes and connected AI workflows

Source changes implement the review's immediate engineering fixes and add review-only AI assistance in existing work screens. They do not assert live production verification or calibrated turn-time/stock forecasts.

## Included

- Lazy route loading and a recoverable page-load error boundary.
- One reservation/section/seating/rotation refresh coordinator per location; visible-page refreshes and a polling fallback remain even when realtime connects, because subscription success does not prove every table is published.
- Confirmation summaries batch up to 250 IDs with no link tokens. A 50-row regression uses one batch request. Older deployments fall back with at most four simultaneous requests; authorization errors never fall back.
- Active staff can generate policy-bound guest links using an isolated endpoint. Policy editing and provider sending keep their existing authorization. Conversion handoff uses the same popup as list actions, removing a management-only UI gate.
- Accepted confirmation evidence survives link expiry and arrival status changes; edits to guest/date/time/party/contact/room invalidate the matching receipt. Link validity remains separate. No old confirmations are invented from an operational status label.
- Centralized inquiry integration address. Browser override: VITE_INQUIRY_STUDIO_URL; Edge Function override: INQUIRY_STUDIO_URL. The browser default and the dispatcher's legacy fallback are preserved until the canonical deployment can be verified; set both overrides to that verified origin. A configuration change is provided without silently switching the live notification feed to an unverified site.
- Tenant loading deduplicates concurrent calls for 30 seconds per signed-in user, clears on auth changes and discards failed requests. Existing server authorization still decides every operation.
- Floor shows live seated guests/tables per server alongside recorded shift covers and next rotation.
- AI reservation extraction in manual and inquiry forms; proposals require staff review before filling the editable form. Existing saving and override checks still run.
- AI closeout checklist explanations, computed-report explanations, service-material practice and menu-backed selling prompts. These use bounded context, evidence references, age/change invalidation, request limits and content-free usage telemetry. They cannot send, save, award points, publish or perform arithmetic.
- Existing Prepare Day review/release, receipt extraction reuse and quiz answer verification are preserved rather than replaced by another workflow.
- Fixed the case-sensitive wording regression without removing factual checks. Added an all-tests runner, declared test dependencies and GitHub CI.

## Required deployment

1. Review and merge the pull request. CI runs `npm ci`, `npm run test` and the production build.
2. Apply these additive migrations, in order, against the existing app database:
   - `supabase/migrations/20261118_confirmation_workspace.sql`
   - `supabase/migrations/20261118_operations_assistant.sql`
   They require the existing consent/house-policy tables and membership/access helpers. Do not replace any live permission functions to get past a failed prerequisite.
3. Deploy Supabase Edge Functions `operations-assistant` and the updated `operations-dispatch`. Keep the existing OPENAI_API_KEY as a server-side secret. OPERATIONS_AI_MODEL is optional; the default matches the app's existing lightweight model family. Never put an AI or service-role key in Vercel frontend variables.
4. Verify the actual inquiry deployment serves both `/api/main-app` and `/api/notification-feed`. If a different canonical deployment is correct, set both overrides to the same HTTPS origin before releasing the dispatcher. Code inspection cannot prove two sites contain identical data. Read-only endpoint checks from this environment were blocked with HTTP 403 on both aliases; this is not evidence that either deployment is broken.
5. Redeploy Vercel with the existing VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the target environment.
6. Test host/server/management accounts, cross-location denial, a fresh inquiry-to-booking-to-guest-response journey, expired confirmation evidence, changed party sizes, composer behavior, closeout and actual notification delivery.

## Evidence and limits

Build assets are compared by the main JS entry size, not a claimed percentage improvement in real-world load time. Run phone/tablet measurements to establish end-to-end timings.

Database tests use PGlite fixtures. AI parsing tests use synthetic responses, not paid provider calls. The assistant's report and closeout snapshots are explicitly the visible computed report or unsaved form, not an independent production audit.

Predictive dining durations, stock forecasts and automatic staffing optimization need verified historical outcomes and accuracy evaluations before they can safely influence decisions. Until then the app retains configured service duration, reset windows, explicit table combinations and deterministic financial rules. Real SMS/push delivery and Twilio suspension are deployment/provider issues, not repaired by a frontend commit.
