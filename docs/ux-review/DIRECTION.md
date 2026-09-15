# Movement flow proposal contract

Scope: standalone HTML comparison, not production implementation. Preserve current app code and brand assets. Operate mode inside prototypes; Read mode in the review and comparison.

User request: review all UX/UI flows, especially adding, viewing, editing, and continuing movement drafts, then deliver multiple prototypes in HTML.

Evidence: current repository source, including both manual and assisted forms. Authenticated runtime verification is unavailable in this checkout; the existing localhost app belongs to another revision and is not evidence for this review.

Three proposals use the incumbent cream / teal / coral / blue system and Spanish voseo. The HTML is code-first because the deliverable is a set of interactive flow alternatives. It is not an approved replacement identity or a permanent build preference.

- A · Registro ágil: compact single-page editor. Amount and description lead, optional information expands, read mode is explicit, save shows balance impact. The user confirmed mobile as the primary device.
- B · Paso a paso: start, complete, confirm. Receipt uncertainty sits next to the affected field. Additional steps buy reassurance; manual entry goes directly to the fields. Both entry paths support optional attachments without extraction.
- C · Capturar y resolver: capture a description or receipt now, keep it pending, then review and post later. Mobile uses an inbox and focused detail; desktop adds a persistent inspector.

First viewport: comparison navigation and a working wallet, not a marketing hero or decorative mockup. The user selected B · Paso a paso. Its first step is now Empezar, with prominent manual completion above the receipt option. A and C remain available as comparison history. Every proposal covers add, view, edit, and continue draft with actual editable fields and in-browser state.

Signature interaction: a saved movement returns to its read-only detail with exact balance impact. Drafts never enter the posted total. Edits replace the previous contribution rather than double-counting it.

Quality bar: offline single HTML, coherent app chrome, 44px interaction targets, visible keyboard focus, real labels and errors, currency-aware parsing, responsive layouts, deterministic receipt demo, safe leave choices, useful empty/failure/expired states, and clearly labeled synthetic data. No external service calls. Comparison must describe genuine behavioral and implementation tradeoffs.

Documentation boundary: proposals and review artifacts under docs/ux-review; do not adopt proposal tokens in production DESIGN.md or change app sources. PRODUCT.md records source-grounded product facts and open assumptions only.

Selected refinement: manual entry is a full-width labeled action before receipt content, visible on the initial mobile screen in expanded mode. It jumps directly to the data fields and focuses amount. Switching to manual during a simulated read cancels application of that pending result.

Second-step refinement: B does not repeat the receipt acquisition/analysis invitation after the method was chosen. Both manual and assisted entry show optional Adjuntos in Completar. Adding files there only attaches them; it does not start extraction or change movement data. The source receipt appears once in that list and remains accessible beside an unresolved amount. Confirmation and read-only detail list all attachments, and edit/resume preserve them. Completed steps are keyboard-accessible return actions; going back to Empezar preserves the form values.

Attachment prototype: native multiple-file picker, file previews and downloads, removal, and persistence in the browser for B. The existing app limits (5 files, 2 MB each; JPG, PNG, WebP, PDF, TXT) apply, with the source receipt included in the count. This standalone demo saves contents in localStorage and reports insufficient browser storage without adding a file it cannot retain. No external upload or AI call. The attachment action has no AI entitlement dependency.

B keeps its action footer after the attachments in document flow on desktop and mobile, so it never covers files or their controls. The manual entry helper explicitly says files can be attached afterward.
