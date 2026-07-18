export const brandColors = {
  background: "#f8f5ed",
  border: "#e2e6e3",
  expense: "#c75d45",
  expenseSoft: "#faebe7",
  foreground: "#202522",
  income: "#2878b5",
  incomeSoft: "#e6f2fa",
  mutedForeground: "#69736e",
  onPrimary: "#fffaf2",
  primary: "#176b5b",
  primaryHover: "#105247",
  primarySoft: "#ddefea",
  separator: "#edf0ee",
  shareShadow: "rgba(23, 107, 91, 0.10)",
  surface: "#fffdfa",
} as const;

export const clerkAppearance = {
  variables: {
    borderRadius: "0.875rem",
    colorBackground: brandColors.surface,
    colorDanger: brandColors.expense,
    colorInputBackground: brandColors.surface,
    colorInputText: brandColors.foreground,
    colorPrimary: brandColors.primary,
    colorText: brandColors.foreground,
    colorTextSecondary: brandColors.mutedForeground,
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  },
};
