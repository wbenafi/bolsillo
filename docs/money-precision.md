# CRC decimals and the one-time data migration

All persisted `amountMinor` values now mean integer hundredths of the wallet
currency, for both CRC and USD. For example, `4518150` means ₡45 181,50 in a CRC
wallet. There are no per-record money versions, API version arguments, or legacy
conversions on reads.

CRC and USD accept positive amounts with up to two decimal places. `45181.50`,
`45181,50`, `45181.5`, and `45181.00` are valid. Space-grouped thousands such as
`45 181,50` are valid; ambiguous grouping and excess precision require correction.
The app never guesses punctuation or rounds a submitted amount. AI output remains
a major-unit decimal string with a period and no grouping separators.

## Migration

`migrations:migrateCrcToHundredths` is an internal, one-time maintenance mutation.
It multiplies original whole-colón CRC transaction amounts by 100. USD amounts
already use cents and stay unchanged. Draft and extraction strings, timestamps,
revisions, transaction IDs, and file references stay unchanged.

The mutation requires a monetary snapshot from the pre-migration backup containing
each transaction's ID, wallet ID, wallet currency, amount, and update timestamp.
It refuses a changed dataset, duplicate snapshot entries, missing wallets,
noninteger amounts, unsafe precision, or overflowing totals. The operation is
bounded to 1,000 transactions; a larger dataset requires a different migration.

All checks, patches, and a single `dataMigrations` completion record commit
atomically. A failed operation changes nothing; a retry after success reports
`alreadyApplied: true` without touching any transactions, including subsequently
created decimal transactions. The completion record is operational history only:
normal application reads and writes never consult it. Keep it to prevent reruns.

## Execution and verification

1. Verify the deployment still uses whole CRC and export a full backup.
2. Build `expectedTransactions` from the backup. Test the migration against an
   isolated copy and run the automated suite before touching production.
3. Prepare the decimal-aware frontend/backend together. Original browser bundles
   must be refreshed at cutover; this release intentionally has no compatibility
   protocol for old clients. Do not allow writes from old bundles during migration.
4. Run the internal migration with the backed-up snapshot using the explicitly
   selected production deployment, then export a second snapshot.
5. Compare every transaction: only CRC `amountMinor` changes, by exactly 100.
   Confirm USD and all other transaction fields are identical. Reconcile income,
   expense, and balance for every wallet, including archived ones; compare draft
   and file records too. Confirm one completion record exists.
6. Promote the matching frontend and verify production. Do not roll back to code
   that interprets CRC integers as whole colones after conversion. A backup restore
   requires coordinating the old code and any writes made since the snapshot.

Existing development databases also need this one-time migration before using
the new code. Fresh databases already write hundredths and must not be migrated
as if their transactions were whole colones. Never generate a new "original"
snapshot after conversion and delete the completion record to rerun the migration.

## Validation coverage

Migration tests cover exact CRC conversion, unchanged USD and metadata, all-or-
nothing failure, changed snapshots, repeat invocation, precision and aggregate
limits, draft resume, ordinary edits, and active/archived/admin/filtered totals.
Extraction tests cover `.00`, nonzero fractions, sub-colón amounts, duplicate
checks, draft persistence, and saves. The authenticated Playwright flow covers
decimal entry, edits, reload, filtering, and balances.

Changing a wallet's currency remains blocked while it contains transactions,
active drafts, or pending uploads, so existing money cannot be reinterpreted.
Previously discarded AI suggestions need re-extraction or manual correction;
the migration cannot recover an amount that was already stored as `null`.
