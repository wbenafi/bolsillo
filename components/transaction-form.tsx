"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TransactionFlow } from "./transaction-flow/transaction-flow";
import { TransactionEdit } from "./transaction-flow/transaction-edit";
import type {
  SavedTransactionDraft,
  TransactionFormProps,
} from "./transaction-flow/types";

export type { TransactionFormProps } from "./transaction-flow/types";

/** Resolve the initial draft before mounting an editor. Live query updates never reset user input. */
export function TransactionForm(props: TransactionFormProps) {
  const search = useSearchParams();
  const [requestedDraft] = useState(
    () => search.get("draft") as Id<"transactionDrafts"> | null,
  );
  if (props.transaction && !requestedDraft)
    return (
      <TransactionEdit wallet={props.wallet} transaction={props.transaction} />
    );
  return <DraftLoader {...props} initialResumeId={requestedDraft} />;
}

function EditorLoading() {
  return (
    <div
      className="movement-loading"
      role="status"
      aria-label="Recuperando tu movimiento"
    >
      <span />
      <span />
      <span />
      <p>Recuperando tu movimiento…</p>
    </div>
  );
}

function DraftLoader({
  initialResumeId,
  ...props
}: TransactionFormProps & {
  initialResumeId?: Id<"transactionDrafts"> | null;
}) {
  const [resumeId] = useState(initialResumeId);
  const [initialDraft, setInitialDraft] = useState<SavedTransactionDraft>();
  const draft = useQuery(
    api.transactionDrafts.get,
    resumeId ? { draftId: resumeId } : "skip",
  );
  if (
    !initialDraft &&
    draft?.status === "active" &&
    draft.walletId === props.wallet._id &&
    draft.transactionId === props.transaction?._id
  )
    setInitialDraft(draft);
  if (initialDraft || !resumeId)
    return <TransactionFlow {...props} initialDraft={initialDraft} />;
  if (
    draft === undefined ||
    (draft?.status === "active" &&
      draft.walletId === props.wallet._id &&
      draft.transactionId === props.transaction?._id)
  )
    return <EditorLoading />;
  return (
    <div className="form-card movement-unavailable">
      <h1>Este borrador ya no está disponible</h1>
      <p>
        Puede haber vencido, haberse descartado o estar registrado. Consultá los
        movimientos de tu bolsillo.
      </p>
      <Link className="button secondary" href={`/wallets/${props.wallet._id}`}>
        Volver al bolsillo
      </Link>
    </div>
  );
}
