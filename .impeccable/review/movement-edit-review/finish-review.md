# Finish review: movement editing

Disposition: **fix**

## persistence

The operative contract is `.impeccable/review/movement-edit-review/contract.md`. This review concerns the local branch changes; no PR exists for this branch and no production deployment was performed. The approved B interaction is implemented in the real app, with the incumbent interface as visual authority. The old prototype-only boundary does not apply.

Normal editing has a separate local controller. `TransactionForm` mounts `TransactionEdit` without resolving or creating a draft unless an explicit legacy `?draft=` link was requested. `useTransactionEdit` captures the original transaction, currency, values, and attachment manifest; field changes, attachment additions, renames, and removals affect local state. `transactionDrafts.create` rejects any new request with `transactionId`. Explicit recovery of old edit drafts remains separate. This satisfies the user's central request.

At inspection, `PRODUCT.md` and `docs/movement-flow.md` still described the superseded edit-draft behavior and earlier 101-test evidence. The parent reports that the documenter is correcting them. The current contract and evidence, rather than those stale passages, govern this review. The handoff must retain the distinction between creation drafts, local normal edits, and explicit legacy recovery; it must not carry forward the older unconditional `ship` claim.

## fidelity

**8.5/10 for the approved interaction and incumbent visual identity.** All 14 supplied captures were opened: start, complete, confirm, detail, edit, edit-confirm, and cancel at 390 × 844 and 1440 × 1100. They correspond to the named states and provide usable evidence. No approved raster comp or replacement identity exists, so this is not a pixel-fidelity score.

Manual entry is prominent within the first mobile viewport. Creation presents three meaningful steps; normal editing presents Completar → Confirmar. The cream, teal, coral, and blue vocabulary remains intact. Attachments have their own controls and explanatory copy, and the final actions follow the files in document flow. Confirmation distinguishes the original amount, replacement amount, and resulting balance. Edit screens omit Continuar después and draft status. The cancel dialog names the pending changes and new files, explains that the recorded movement survives, and offers a clear safe return.

The screenshots show coherent wrapping and hierarchy at both supplied widths. CSS establishes 44 px icon/text targets, 48 px primary actions, labeled fields, visible focus, tabular money values, and scoped selection/caret colors. Native dialog semantics, linked field errors, error focus, and status messages are present in source. This review did not independently measure computed contrast, perform a keyboard session, or examine additional device widths. The development badge, avatar, transient success toast, and viewport-sized native backdrop in full-page captures are understood capture conditions; they do not require recapture for this review.

## ceiling

**7/10 operational finish; a focused fix batch is sufficient.** The central save/cancel semantics and visual direction are sound. Saving uses the same movement ID, revision and currency preconditions, and file revision checks when the manifest changes. Upload finalization checks those preconditions again and provides an idempotent committed-batch result. These decisions prevent duplicate balance contributions and stale overwrites.

The supplied validation reports passing lint, TypeScript, production build, whitespace checks, and 108 tests in 18 files. Its authenticated isolated browser runs report no edit/draft mutations before confirmation, no draft mutations on edit save, preserved originals on cancel, creation-draft recovery, and 11 attachment scenarios. Those are supplied results, not tests rerun by this reviewer. The detector report contains zero findings. The external AI provider, shared-server main-flow Playwright suite, and production deployment were not exercised.

The remaining defects concern losing or trapping pending work during recovery, not a need to redesign the surface.

## material_fixes

1. **Preserve an already-open editor when the wallet is archived or management permission changes.** `app/wallets/[walletId]/transactions/[transactionId]/edit/page.tsx:22` and `:34` replace the form with `FeatureUnavailable` on live query/feature updates. Reproduction from source: enter a new description and attach a local file; archive that wallet in another session, or disable `transactions.manage`. React unmounts the editor, destroying its local state without a navigation prompt. The archive notice inside `TransactionEdit` cannot handle this because its parent has already removed it. Keep initial-entry restrictions, but retain a mounted editing session and show the unavailable state with saving disabled; preserve the values and local files for inspection, discard, or recovery after restoration. Verify both live transitions and that the original movement and draft count remain unchanged.

2. **Make failed-upload recovery terminate cleanly while keeping ambiguous saves idempotent.** `components/transaction-flow/use-transaction-edit.ts:192` reuses a saved batch for identical input, while `:262` clears it only if failure happened before finalization. After a finalize failure, a 24-hour-expired or cleaned batch returns `UPLOAD_EXPIRED`/`UPLOAD_NOT_FOUND`; every unchanged retry repeats the same unusable batch. Also, `cancel()` awaits `abort()` before allowing local discard. If that pending batch exists and the connection is down, the queued Convex mutation can hold Cancelar edición until reconnection. Clear positively terminal unavailable/expired attempts so the next explicit save uploads the retained local files again; retain the batch for uncertain outcomes to preserve idempotency. Make cleanup best effort without making local discard/navigation depend on its response. Verify expiry/not-found retry, cancel while disconnected after a failed finalize, and the existing lost-response/idempotent path.

These two items are the complete material-fix list from this pass. Both are supported by control flow in source; neither was reproduced in a new browser session by this reviewer.

## keep

- The dedicated local edit controller and server rejection of newly created edit drafts.
- Explicit legacy draft recovery without silently redirecting ordinary Editar into it.
- Prominent manual start, independent attachments, and sequential confirmation with balance impact.
- The frozen edit baseline, revision/currency/file checks, and idempotent upload commit.
- The original-preservation copy, safe cancel choice, named attachment actions, and mobile action order.
- The incumbent palette, restrained typography, document-flow footer, and existing component vocabulary.

Do not expand this fix batch into new branding, new draft persistence for edits, or additional visual polish. Return the two material fixes for resolved/partial/unresolved scoring with the resulting evidence.
