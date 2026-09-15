"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { createClientId } from "@/lib/client-id";
import { errorMessage } from "@/lib/errors";
import { applyReceiptToEmptyFields } from "@/lib/transaction-flow";
import type { ExtractionResult } from "@/lib/transaction-extraction";
import type { WalletTag } from "@/types/domain";
import type { TransactionDraftController } from "./use-transaction-draft";

export function useReceiptExtraction(
  draft: TransactionDraftController,
  enabled: boolean,
  tags: WalletTag[] | undefined,
  onReady: () => void,
) {
  const start = useMutation(api.transactionExtractions.start);
  const cancel = useMutation(api.transactionExtractions.cancel);
  const usage = useQuery(
    api.transactionExtractions.usage,
    enabled ? {} : "skip",
  );
  const [starting, setStarting] = useState(false);
  const request = useRef(false);
  const generation = useRef(0);
  const applied = useRef(new Set<string>());
  const job = draft.remote?.extraction;
  const analyzing =
    starting || job?.status === "queued" || job?.status === "processing";
  const result =
    job?.status === "ready"
      ? (job.result as ExtractionResult | undefined)
      : undefined;
  const usable =
    result && ["ok", "partial"].includes(result.status) ? result : undefined;
  const limitReached = !!usage && usage.used + usage.reserved >= usage.limit;
  const { change, state, busy } = draft;

  useEffect(() => {
    if (
      busy ||
      !usable ||
      !job ||
      !tags ||
      state.mode !== "documents" ||
      applied.current.has(job._id)
    )
      return;
    applied.current.add(job._id);
    change((previous) => ({
      ...previous,
      values: applyReceiptToEmptyFields(
        previous.values,
        usable,
        previous.reviewedFields,
        tags,
      ),
    }));
    onReady();
  }, [busy, usable, job, tags, state.mode, change, onReady]);

  async function analyze(reanalyze = false) {
    if (!enabled || draft.busy || analyzing || request.current) return;
    const currentGeneration = ++generation.current;
    request.current = true;
    setStarting(true);
    draft.setMessage(undefined);
    draft.change((previous) => ({
      ...previous,
      mode: "documents",
      reviewedFields: [],
    }));
    try {
      await draft.flush();
      if (currentGeneration !== generation.current) return;
      const draftId = await draft.ensureDraft();
      await start({
        draftId,
        version: draft.version.current,
        reanalyze,
        requestKey: createClientId(),
      });
      if (currentGeneration !== generation.current) await cancel({ draftId });
    } catch (error) {
      draft.setMessage(errorMessage(error));
    } finally {
      request.current = false;
      setStarting(false);
    }
  }

  async function completeManually() {
    generation.current += 1;
    if (job) applied.current.add(job._id);
    // Changing the mode is persisted through the same queue as field changes.
    // The server cancels a pending extraction atomically with that update.
    draft.change((previous) => ({ ...previous, mode: "manual" }));
    try {
      await draft.flush();
      if (analyzing) await cancel({ draftId: await draft.ensureDraft() });
      return true;
    } catch {
      return false;
    }
  }

  return {
    job,
    result,
    usable,
    analyzing,
    starting,
    limitReached,
    usage,
    analyze,
    completeManually,
    needsAmountReview: !!usable && !state.reviewedFields.includes("amount"),
  };
}

export type ReceiptExtractionController = ReturnType<
  typeof useReceiptExtraction
>;
