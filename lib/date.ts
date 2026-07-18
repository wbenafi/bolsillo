export function todayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

const transactionDateFormatter = new Intl.DateTimeFormat("es-CR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const weekdayFormatter = new Intl.DateTimeFormat("es-CR", {
  weekday: "long",
  timeZone: "UTC",
});

export function formatTransactionDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return `${weekdayFormatter.format(date)}, ${transactionDateFormatter.format(date)}`;
}
