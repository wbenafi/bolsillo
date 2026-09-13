# CRC decimals and historical money compatibility

CRC and USD accept positive amounts with up to two decimal places. `45181.50`,
`45181,50`, `45181.5`, and `45181.00` are valid. Space-grouped thousands such as
`45 181,50` are valid; mixed punctuation (`45.181,50`, `45,181.50`), ambiguous
three-digit fractions (`1,000`), and excess precision require correction. The app
never guesses separators or rounds a submitted amount. AI output remains a
major-unit decimal string with a period and no grouping separators.

## Stored amounts

| Record | Meaning of `amountMinor` | Example |
| --- | --- | --- |
| No `moneyVersion`, CRC | Whole colones, original format | `45181` = ₡45 181,00 |
| No `moneyVersion`, USD | US cents, original format | `45181` = US$451,81 |
| `moneyVersion: 2`, CRC or USD | Hundredths of the wallet currency | `4518150` = ₡45 181,50 in CRC |

There is **no bulk rewrite or background migration**. Existing records remain
unchanged. `currentMoneyAmount` converts legacy CRC in memory; transaction queries
mark their returned copies as version 2. All wallet summaries, filtered totals,
admin summaries, and AI duplicate checks use the same units. New records and
explicit user edits save the amount and `moneyVersion: 2` atomically. Repeated
reads, edits, draft saves, and upload retries never multiply a versioned amount
again. Draft and extraction amounts remain major-unit strings; never multiply
them by 100.

Do not infer the version from the amount's size, decimal zeros, or creation time.
Do not run a blanket `amountMinor *= 100` migration: it would corrupt versioned
CRC and all USD amounts. Previously cleared AI amount suggestions cannot be
recovered from `null`; reread the receipt or enter the amount manually.

Both individual conversions and total arithmetic check safe-integer bounds. An
out-of-range value raises an error rather than being rounded or patched. The
maximum supported version-2 input is `90071992547409.91`; a legacy CRC amount
above `90071992547409` cannot be converted to a safe integer. Aggregate totals
can also exceed the supported range and must be reviewed before rollout.

Changing a wallet's currency is blocked while it contains transactions, active
unexpired drafts, or pending unexpired upload batches. This prevents changing the
meaning of historical money or pending work. Renaming and describing the wallet
remain available. An empty wallet without pending work can change currency.
Historical currency changes made before this release cannot be reconstructed;
compatibility preserves the meaning under each wallet's current currency.

## API/client compatibility

All APIs returning monetary transaction values or wallet totals require
`moneyVersion: 2` in their arguments. All save paths also require it: manual
create/update, draft save, attachment edits, and upload finalization. Missing
versions return `MONEY_VERSION_REQUIRED` with a reload instruction instead of
returning or accepting amounts in incompatible units. Upload finalization checks
the version before accessing object storage. Already completed internal save
retries may return their existing transaction ID without changing anything.

Updated callers must send version 2 and use hundredths for both currencies.
Legacy browser tabs cannot safely continue using their old bundle: queries fail
closed and saves cannot change money. An old bundle's error boundary may show a
generic error; reloading after the new frontend is available restores access.
Deploy backend and frontend together during a coordinated release window. Do not
point the new frontend at an old backend or leave an old frontend running against
the new backend as a steady state.

## Release and read-only preflight

1. Preserve a production backup/export before release. Validate a copy in an
   isolated staging deployment using this schema and code. Do not import fixtures
   or test data into production.
2. Run the internal **query** `transactions:auditMoneyCompatibility` against that
   deployment. For example, with the CLI already targeting the staging deployment:

   ```sh
   npx convex run transactions:auditMoneyCompatibility '{"paginationOpts":{"numItems":100,"cursor":null}}'
   ```

   Continue with the returned `continueCursor` until `isDone` is true. The query
   scans at most 100 records per page, counts legacy CRC/USD and versioned records,
   and reports missing wallets or amounts outside supported precision. It never
   patches data. Resolve every reported issue before rollout; do not round it.
   Audit counts are per page and this is not a snapshot while writes are active.
3. Reconcile each wallet's income, expense, and balance against the backup using
   its original units, including archived wallets. The transaction preflight
   checks individual records; it does not certify aggregate totals or detect
   historical currency changes. Exercise summary queries too.
4. Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
   Run the authenticated Playwright flow in an isolated Clerk/Convex test setup;
   it covers decimal entry, editing, filtering, reload, and balances.
5. Release the backend and frontend together. Refresh existing sessions. Verify
   an old whole-colón transaction retains its value, a decimal CRC receipt can
   be saved and reopened, mixed-format totals reconcile, and USD stays unchanged.
   Repeat the read-only audit on production after release.

Once any version-2 record has been saved, **do not roll back to code that assumes
all CRC integers are whole colones** or removes the version marker. Roll forward
with compatibility intact. A full backup restore would discard subsequent writes
and requires a separate, explicitly planned recovery. No data migration or
production deployment is performed by this PR.

## Regression coverage

`convex/moneyCompatibility.test.ts` inserts original unversioned records directly
and verifies unchanged stored documents, mixed-format active/archived/admin and
filtered balances, repeated edits, USD compatibility, old-client read/write
rejection, draft resume, attachment/upload saves and retries, currency locking,
and paginated read-only auditing. AI draft tests cover printed `.00`, nonzero
fractions, sub-colón amounts, and duplicate detection against both formats.
Money unit tests cover parsing, exact formatting, precision limits, and arithmetic.
