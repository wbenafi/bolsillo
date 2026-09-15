# Movement-flow documentation handoff

Status: complete for the implemented B · Paso a paso surface. The user's production authorization includes the necessary product and implementation documentation. This is an ordinary extension of Bolsillo's incumbent identity.

## Files updated

- `PRODUCT.md`: records production authorization, the implemented flow, independent attachment/AI permissions, 24-hour manual and assisted drafts, explicit amount review, currency protection, and available runtime evidence.
- `README.md`: replaces the old Manual/Comprobantes tabs and remembered-mode descriptions with Empezar → Completar → Confirmar; updates source-file invalidation, supporting attachments, field suggestions, draft behavior, deployment order, and the link to the implementation direction. Provider configuration and unrelated sections are preserved.
- `docs/movement-flow.md`: records current architecture and behavior, source versus backing files, compatibility requirements, exact verification results and limits, and the historical role of `docs/ux-review/`.
- `.impeccable/review/movement-flow/documentation.md`: this handoff and evidence record.

## Incumbent comparison

Checked `app/globals.css` and its diff, `app/movements.css`, the start/fields/receipt-suggestion components, the flow and extraction hooks, `lib/transaction-flow.ts`, and the relevant draft/schema logic. The only global stylesheet change is the movement stylesheet import; the existing tokens remain intact. The surface uses existing button and field patterns and scopes its extra layout, focus, and state styles to movements.

Directly opened `start-mobile.png` and `confirm-desktop.png`: the prominent manual action, cream canvas, light surface, teal actions, coral expense figure, familiar app header, three-step navigation, and balance-changing confirmation agree with the source. `finish-review.md` records the reviewer's inspection of all eight captures, including complete and detail at both widths; this documentation pass relies on that review for the remaining captures and does not claim another runtime pass.

1. Palette: incumbent cream, teal, coral expense, and blue income tokens are preserved.
2. Typography: existing Geist Sans and restrained headings remain; movement amounts use tabular numerals.
3. Layout: the 650 px editor column adapts to mobile, with actions after attachments in document flow.
4. Components: native fields, existing buttons, Lucide icons, visible focus, and 44 px movement actions preserve the incumbent vocabulary.
5. Rules: manual entry leads; optional attachments remain independent of AI; explicit confirmation changes the balance. These are movement-surface commitments, not new global named design rules.

No `DESIGN.md` or `.impeccable/design.json` was created or rewritten. No pre-existing system file was found by the earlier context pass. `docs/ux-review/`, brand assets, and UI/backend/test code were preserved by this documentation task. The historical prototype-only wording in the comparison remains intentional evidence of the earlier phase; current authorization and behavior are documented above it.

## Validation and limits

Read `validation.json`, `browser-checks.json`, and the `ship` finish review. They record passing ESLint, TypeScript, production build, whitespace checks, 101 tests across 18 files, and isolated real browser checks at 390 × 844 and 1440 × 1100. Browser checks used a development Clerk account, synthetic data, local Convex/object storage, and `localhost:3034`; they covered manual files, preview/rename, saved-draft reload, confirmation/detail, pending-edit preservation, operation without AI access, and destructive confirmations.

The external AI provider was not called. The modified standard main-flow Playwright suite was not executed against the shared default server. No production deployment occurred. Convex functions, optional schema fields, and `by_user_wallet_status` must be deployed before the new client; old open clients may need a reload for explicit amount review. This pass did not rerun context, the detector, application tests, or browser verification.

Not canonized or repaired: no material visual defect was identified by the supplied finish review; historical proposal constraints and any unrelated pre-existing system drift are not promoted into new global rules or repaired by this bounded documentation pass.

Follow-up verification: the existing attachment QA harness was adapted after this handoff, with no subsequent production UI changes. All 11 scenarios passed against isolated local services; concurrency was rerun after a Clerk chunk download error. `attachment-checks.json` records both runs and the combined result. The parent agent verified the updated harness with ESLint, TypeScript, Node syntax checking, and whitespace checks. The incumbent visual comparison and `ship` review remain applicable.
