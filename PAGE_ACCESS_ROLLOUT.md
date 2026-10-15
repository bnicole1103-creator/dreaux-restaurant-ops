# Pages, sections, styling and Guest Services

Apply supabase/migrations/20261015_page_section_access.sql in Supabase SQL Editor BEFORE merging/deploying this branch. No employee choices change until management saves rules. Then deploy staff-preview and the app.

Settings → Permissions → Pages & sections: choose position or employee, expand a page, use default / show within role / hide. Individual section choices override position defaults. A whole-page hide takes precedence over section choices. Management retains access to the permissions controls so the app cannot lock its administrators out. Stale saves are rejected; use Reload saved choices.

This is additional page/section visibility within existing roles; it does not elevate staff to management, expose another employee’s private closeout, or authorize new financial operations. Shared resources can remain available through another allowed page (for example Floor reservations and Calendar reservations). Existing ownership and financial authorization checks remain in place. New RPCs added later must be assigned their resource and re-guarded by this migration.

Styling: Settings → Styling groups colors/fonts, stickers, screen sections and the staff layout preview. Calendar-specific style controls remain on Calendar with a link from Styling.

Guest Services replaces the Inquiries navigation label. Large buttons open Host inquiry, Inquiry inbox, Guest feedback, Guest forms & QR codes, and Edit guest forms in dialogs. Existing deep URLs remain usable, subject to permissions and existing role limits. Public guest forms still need no account. Only public form URLs are encoded in QR codes.

The separate Inquiry Studio has been updated to check app_guest_authorize for inbox and studio access. Until this migration is installed, it falls back only for the explicit missing-RPC response; denied permissions never fall back. Studio admin responses omit inquiries when inbox access is denied.

Screen editor: click a semantic section, edit complete labels/paragraphs together and save all section wording. Text is not flattened over form controls. Operational records (employee names, posts, reservations and answers) are edited in their existing editors. Existing stored role keys remain unchanged; displayed GM / general manager wording becomes Management.

Validation: TypeScript, production build, mock DOM access save/direct URL checks, PGlite permission/membership/version/RLS checks and Inquiry Studio denied/missing-RPC/error checks. Real iPad and authenticated production accounts have not been tested.

SQL regression test: install @electric-sql/pglite as a temporary development dependency, then run node tests/page-access.test.mjs from this repository root.

Deploy Staff View:

npx --yes supabase functions deploy staff-preview --project-ref ipgkhvnedtkfqtfflgow --no-verify-jwt
