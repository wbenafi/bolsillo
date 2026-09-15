# Bolsillo

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who want to understand their spending and income, organizing money into purpose-specific wallets.

## Product Purpose

Bolsillo separates money by purpose into wallets, records income and expenses, and calculates each wallet's balance. The existing README describes a mobile-first interface.

## Capabilities and Constraints

- Existing implementation: Next.js, React, Convex, and Clerk. Wallets use CRC or USD, both with two decimal places stored as integer hundredths. Currency amounts must not be combined across currencies.
- Movements have a type, positive amount, description, date, optional notes, tags, and feature-gated attachments.
- Creation follows Empezar → Completar → Confirmar, with prominent manual completion before optional receipt assistance. Resuming a creation draft opens Completar. Normal editing follows Completar → Confirmar without AI entry or Continuar después; confirmation shows the balance impact and opens the saved movement's read-only detail.
- Attachments and receipt assistance have independent feature permissions. Both manual and assisted entry can attach files without running AI. Reading a receipt requires both file and AI access; manual entry requires neither.
- Users explicitly confirm the reviewed amount after a useful extraction. A receipt in another currency requires an amount in the wallet's currency; no automatic conversion is provided. Confirmation also checks that the wallet currency has not changed during editing.
- Manual and assisted creation drafts expire 24 hours after creation and autosave after 650 ms of inactivity. Saving a draft does not change the wallet balance; committing the movement does.
- Normal editing creates no drafts. Fields, attachment names, removals, and new files stay in memory until Guardar cambios; cancelling preserves the recorded movement and balance. Explicit links can still recover preexisting edit drafts, while the server rejects new edit-draft creation.
- Edit saves check movement revision and wallet currency, plus file revision when attachments change, including after uploads. An open editor retains local work when the wallet is archived or management access is revoked and disables saving until restored. Terminal missing/expired upload batches allow a fresh retry; uncertain responses retain the batch for idempotency.
- Local cancellation does not await Convex cleanup, but navigation requires the app to remain reachable. Internal links and page close/reload protect pending changes; browser history can abandon local edits. Offline browsing and persistence after leaving the page are not provided.
- Archiving, sharing a wallet summary, tag management, account feature controls, and superadmin operations are present.

- Wallet statistics operate within one wallet: date ranges, income and expense totals, net cash flow, daily spending average, trends, tag breakdowns, comparisons, and transaction drilldowns.
- Available balance and net cash flow for a selected period have different meanings and must remain distinct.
- Combined wallet reporting, budgets, recurring transactions, goals, and projections are outside this release.

## Product Principles

- Explain numbers in plain language and let users inspect the transactions behind them.
- Present observations neutrally, without judging spending habits.
- Make missing history and overlapping tags explicit.

## Brand Commitments

The existing product name is Bolsillo. The interface uses Spanish with voseo. The incumbent implementation remains the visual authority: cream surfaces, teal actions, coral expenses, blue income, and the existing type and component vocabulary. The user has not requested a rebrand or a global design-system replacement.

## Evidence on Hand

README.md, app routes, components, Convex domain code, and public brand assets. `docs/ux-review/` and `.impeccable/review/movement-flow/` preserve the earlier prototype and implementation evidence. The implementation review before integration with `origin/main` is `.impeccable/review/movement-edit-review/`: lint, typecheck, production build and 111 tests across 18 files passed, with one unchanged build retry after a font download failure. Authenticated checks used real development Clerk, isolated local Convex and MinIO, synthetic data and `localhost:3034`, with 18 mobile/desktop captures and 12 passing attachment scenarios. Network observation found no mutations before normal edit confirmation and no draft mutations throughout normal edit/cancel/save. Recovery checks include explicit fault injection and an authentication retry. The external AI provider and standard main-flow Playwright suite against shared `localhost:3000` were not exercised. That review covered local changes before commit. Integration with main passed 177 tests across 21 files, lint, typecheck and production build, plus authenticated decimal creation/draft/edit/attachment and statistics drilldown checks with 16 mobile/desktop captures. The separate results are recorded in `docs/movement-flow.md` and `.impeccable/review/movement-main-integration/`. No production deployment was performed.

## Approved Movement Flow

The user selected B · Paso a paso after comparing HTML prototypes, requested greater prominence for manual entry, and explicitly authorized implementation in the real application with mobile-first UX and maintainable production code. The later request required a rigorous review and no drafts during normal editing. The implemented direction and architecture are recorded in `docs/movement-flow.md`. The current initial finish review found two recovery issues; `movement-edit-review/verdict.md` marks both resolved with a `ship` disposition limited to that fix list, not a new whole-surface approval. `docs/ux-review/` remains the historical comparison; its prototype-only boundary describes that earlier phase and does not limit the later implementation authorization.
