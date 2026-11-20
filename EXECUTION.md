# Express API and worker · Execution plan
Indicative workstream within the shared eight-week solo-developer schedule. Weeks overlap across projects. Seller handles operational decisions and partner onboarding. Progress by exit evidence.

| Week / phase | Implementation work | Exit evidence |
|---|---|---|
| 1 · Contracts | Open merchant partner onboarding; collect real sample payloads, pickup hours, coverage boundary and permitted goods. Define OpenAPI examples and Mongo indexes. | Sandbox credentials available or explicit fixture mode; identify any live-launch blocker. |
| 2–3 · Commerce core | Set up replica set, migrations, catalog, stock ledger, holds, quote engine, coverage calendars and signed Cloudinary upload. | Two buyers contend for final unit; exactly one successful hold. Invalid PIN and overloaded shift cannot obtain payable quote. |
| 4–5 · Money and shipment | Implement raw webhook endpoints, capture reconciliation, idempotent side effects, partner adapter and polling. Drill timeouts. | Sandbox capture and booking resolve once after duplicate/out-of-order events. Unknown booking is reconciled before fallback. |
| 6 · Recurrence | Build versioned plans, enrollments, calendar arithmetic, cycle allocation, shortage forecast and dispatch jobs. | Short-month, leap-year, worker restart and partial cancellation fixtures pass; refunded amount never exceeds capture. |
| 7 · Resilience | Enable audit, request tracing, alerting, cache invalidation and daily ledger reconciliation. Restore encrypted backup to isolated staging. | Seller can trace one reference to payment, shipment and refund; developer demonstrates replay without side effects. |
| 8 · Launch | Verify live low-value prepaid order, real pickup, delivery timestamp and refund. Activate eligible routes in batches. | Every target PIN has verified operational cover before citywide claim. Review actual SLA daily. |

## Release and rollback
Stop taking new orders if stock or money diverges. Keep webhook intake durable. Pause affected workers, reconcile external IDs with provider records, roll back compatible code, then replay and compare counts before reopening.
