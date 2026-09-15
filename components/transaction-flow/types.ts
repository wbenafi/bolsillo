import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { TransactionMode } from "@/lib/transaction-flow";
import type { TransactionFormValues } from "@/lib/validators";
import type {
  TransactionFile,
  TransactionAttachment,
  TransactionType,
  WalletSummary,
  WalletTransaction,
} from "@/types/domain";

export type SavedTransactionDraft = NonNullable<
  FunctionReturnType<typeof api.transactionDrafts.get>
>;
export type TransactionFormProps = {
  wallet: WalletSummary;
  initialType?: TransactionType;
  transaction?: WalletTransaction;
};
export type TransactionEditorState<TFile extends TransactionAttachment = TransactionFile> = {
  values: TransactionFormValues;
  mode: TransactionMode;
  files: TFile[];
  selectedFileIds: Id<"transactionFiles">[];
  reviewedFields: string[];
};
