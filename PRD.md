# Backend · Product requirements
The service is the authority for price, serviceability, payment, stock, delivery promises and package entitlements. One accepted checkout must produce one commercial order, a traceable payment and the intended number of deliveries.

| Capability | Business rule | Acceptance evidence |
|---|---|---|
| Quote | Compute price, tax, delivery and packaging in integer paise from current seller configuration. Include stock, deadline and expiry. | Browser-modified totals have no effect; stale quote cannot start payment. |
| Coverage | Combine merchant-approved PINs, exact address/coordinates, pickup hours, pack time, available stock, partner reach and travel bounds. | At 23:30 IST a next-day pickup plus transit must still fit within 24 hours. No promise when the partner status is unknown and no confirmed backup exists. |
| Placement | Freeze immutable order lines, address, tax, terms, deadline and plan version at server acceptance of order submission. | A payment callback after midnight does not extend the initial 24-hour deadline. Unpaid orders expire. |
| Payment | Accept one confirmed INR capture for the order; record failures, uncertain attempts, duplicate captures and refunds. | Client success alone never releases merchandise. Late capture is reconciled even if stock hold expired. |
| Dispatch | Deliver one parcel per order/cycle. Retain partner booking ID, timeline, dispatch readiness, proof and exceptions. | Courier timeouts do not create duplicate riders; scheduled polling recovers a missed event. |
| Packages | Allocate prepaid value to deliveries, reserve initial stock and schedule later inventory/dispatch checks. | Four weekly deliveries create four fulfillment records and one payment. A price edit changes only future purchases. |
| CMS and media | Serve only published revisions and approved assets to public clients. | Draft media reference cannot expose private content; referenced published asset cannot be deleted. |
| Operations | Surface overdue shipments, unpaid holds, unknown payment/refund status, missing tracking and failed jobs. | Shift operator can identify owner, next action and time of last attempt for every exception. |

## Policy mechanics
Normalize currency to INR and store UTC instants. Render date commitments and recurring calendar dates in Asia/Kolkata. Clamp a monthly start on the 31st to the last day of a shorter month, then return to the original anchor when possible. A later-cycle window and lead time must be visible at purchase. No substitutions without consent. For cancelled undelivered cycles, show proposed refundable allocation against the agreed policy and record gateway confirmation. Staff cannot rewrite delivered history. Merchant defines safe packaging and permitted courier goods before enabling fragile, liquid or otherwise restricted SKUs.

## Service objectives and ownership
Developer owns payment reconciliation, data recovery and partner errors. Seller owns inventory accuracy, packaging and coverage signoff. Proposed initial alerts: paid order unassigned after 15 minutes, no movement past expected pickup, due within four hours without dispatch, missed deadline, refund unresolved past merchant SLA. Set actual thresholds against pickup calendar in the pilot. Measure rolling-24-hour delivery independently of courier claims.
