import { Check } from "lucide-react";
import type { TransactionStep } from "@/lib/transaction-flow";

export function TransactionStepper({
  step,
  disabled,
  onBack,
  editing = false,
}: {
  step: TransactionStep;
  disabled: boolean;
  onBack: (step: TransactionStep) => void;
  editing?: boolean;
}) {
  return (
    <ol className="movement-steps" aria-label="Progreso del movimiento">
      {(["Empezar", "Completar", "Confirmar"] as const).map((label, index) => {
        if (editing && index === 0) return null;
        const target = (index + 1) as TransactionStep;
        const number = (
          <span className="movement-step-number" aria-hidden="true">
            {step > target ? (
              <Check size={14} />
            ) : editing ? (
              target - 1
            ) : (
              target
            )}
          </span>
        );
        return (
          <li
            key={label}
            className={step === target ? "active" : step > target ? "done" : ""}
            aria-current={step === target ? "step" : undefined}
          >
            {step > target ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onBack(target)}
                aria-label={`Volver a ${label}`}
              >
                {number}
                {label}
              </button>
            ) : (
              <span>
                {number}
                {label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
