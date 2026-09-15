import type {
  ExtractionField,
  ExtractionResult,
} from "@/lib/transaction-extraction";
import type { TransactionFormValues } from "@/lib/validators";
import type { WalletTag } from "@/types/domain";

export function ReceiptFieldSuggestion({
  field,
  result,
  values,
  reviewed,
  tags,
  disabled,
  onApply,
  onKeep,
}: {
  field: ExtractionField;
  result?: ExtractionResult;
  values: TransactionFormValues;
  reviewed: string[];
  tags: WalletTag[];
  disabled: boolean;
  onApply: (field: ExtractionField) => void;
  onKeep: (field: ExtractionField) => void;
}) {
  if (
    !result ||
    reviewed.includes(field) ||
    (field === "amount" && result.currencyMismatch)
  )
    return null;
  const suggestion = result.fields[field];
  if (suggestion.value === null) return null;
  const current =
    field === "tags"
      ? tags
          .filter((tag) => values.tagIds.includes(tag._id))
          .map((tag) => tag.label)
      : values[field];
  if (
    JSON.stringify(current) === JSON.stringify(suggestion.value) &&
    suggestion.confidence !== "low"
  )
    return null;
  const value =
    field === "type"
      ? suggestion.value === "income"
        ? "Ingreso"
        : "Gasto"
      : Array.isArray(suggestion.value)
        ? suggestion.value.join(", ")
        : suggestion.value;
  return (
    <div className="movement-suggestion">
      <p>
        {suggestion.confidence === "low"
          ? "No se lee con claridad"
          : "En el comprobante"}
        : <strong>{value || "Sin etiquetas"}</strong>
      </p>
      <div className="movement-inline-actions">
        <button
          type="button"
          className="movement-text-button"
          disabled={disabled}
          onClick={() => onApply(field)}
        >
          Usar este dato
        </button>
        {field !== "amount" && (
          <button
            type="button"
            className="movement-text-button"
            disabled={disabled}
            onClick={() => onKeep(field)}
          >
            Conservar mi dato
          </button>
        )}
      </div>
      <details>
        <summary>Por qué se sugiere</summary>
        <p>{suggestion.reason}</p>
        {suggestion.evidence && (
          <p>
            Página {suggestion.evidence.page}: “{suggestion.evidence.quote}”
          </p>
        )}
      </details>
    </div>
  );
}
