# Backend · Technical architecture
## Runtime and deployment
Use JavaScript ESM, Express, MongoDB replica set (transactions required), one HTTP process and one separately restartable worker from the same codebase. Start on a VPS with reverse proxy and TLS; keep Mongo private and run encrypted off-host backups. A single-node replica set enables transactions but is a single point of failure. Split database hosting or add replication when uptime requirements demand it. Use Cloudinary for product and editorial media. Isolate staging and production keys, webhook secrets, buckets/folders and callback addresses.

## Persistence
| Collection | Critical fields | Index/invariant |
|---|---|---|
| products / variants | slug, aliases, category, sku, attributes, pricePaise, weight, media, revision, status | unique slug and SKU; price nonnegative; indexed published category |
| inventory / movements | location, sku, onHand, held, delta, reason, actionId | unique location+sku and movement actionId; reserve if onHand minus held is sufficient |
| coverage / quotes | PIN, locality, pickup hub, shifts, route bounds; quote lines, eligibility, fee, expiresAt | revisioned register, quote TTL; explicit expiry check on every submit |
| orders | publicRef, buyerId, line/terms/address snapshots, totals, placedAt, promiseBy, quoteId, state | unique publicRef and consumed quote; deadline+state queue index |
| payments / refunds | gatewayOrderId, paymentId, amount, currency, status, orderId, refund allocation | unique sparse external IDs; cumulative refunds may never exceed captured amount |
| plans / enrollments / cycles | versioned bill of materials, anchor, timezone, total, allocations, cycle number, due window | unique enrollment+cycle number; amounts summed across cycles equal total paid |
| shipments / trackingEvents | fulfillment ID, provider, merchantRef, partnerRef, status, event time, received time | one active booking per fulfillment; retain late history without regressing terminal state |
| holds / jobs / inbox | expiresAt, orderId, leaseUntil, attempts, runAt, dedupeKey, eventId | unique job key and provider+event ID; worker lease expiry permits restart |
| media / cms | publicId, version, resourceType, format, alt, focal point, use count; blocks, revision, live pointer | immutable revisions; atomic pointer swap; protected references |
| staff / sessions / audit | role, MFA state, session hash, expiry, entity, actor, action, redacted diff | TTL sessions; indexed entity+time; append-only audit permissions |

## Internal HTTP contract
All routes below use /v1. Validate bodies, restrict unknown fields and enforce ownership. Admin write endpoints in the admin TAD use the same envelope. Standard errors include code, message, requestId and fieldErrors. Use 400 invalid input, 401/403 auth, 404 absent, 409 stock/version/state conflicts, 422 serviceability, 429 throttling, 503 temporary provider unavailability.

| Method and path | Inputs | Success result |
|---|---|---|
| GET /home, /collections, /products, /products/:slug, /plans/:slug | published reads, cursor, q, category | published revision or paginated data, nextCursor |
| POST /serviceability | six-digit PIN, optional exact delivery point, basket weight | provisional or verified result, route, reason, checkedAt |
| POST /auth/challenges, /auth/challenges/verify | contact, opaque challenge, expiring OTP | verified buyer session; rate-limit attempts and resend |
| POST /quotes | cart lines or plan ID, address, start date | quoteId, lines, subtotalPaise, taxPaise, deliveryPaise, totalPaise, dates, expiresAt |
| POST /orders | quoteId, session, Idempotency-Key | orderRef, placedAt, promiseBy, gatewayOrderId, publicKey, amountPaise |
| POST /payments/verify | orderRef, paymentId, gatewayOrderId, signature | pending or confirmed state after server checks |
| GET /orders/:ref | verified owning session | redacted timeline, paid amount, deadline, shipment, drops |
| POST /orders/access/exchange | opaque one-time token sent to verified contact | rotate token into short-lived private session |
| POST /webhooks/razorpay, /webhooks/shipping/:partner | provider-authenticated incoming events | durable inbox receipt; process asynchronously |
| POST /admin/orders/:id/actions | expected revision, action and reason | updated order and audit reference |
| POST /admin/refunds | order, allocation lines, reason, idempotency key | refund record and gateway status |

Example quote response fields for a single purchase: {"subtotalPaise":18000,"taxPaise":0,"deliveryPaise":3000,"totalPaise":21000,"currency":"INR"}. This is test data. Seller supplies tax configuration and approves invoice fields. For tax-inclusive catalog prices extract included tax for display without double counting. Split package totals into per-cycle allocations in paise, putting residual rounding on the last cycle.

## Transactions and recovery
1. On submit, enforce quote ownership, unchanged contents, expiry and current coverage, then transactionally consume quote, conditionally reserve each SKU, freeze the order and enqueue gateway-order creation. Place time is the original submission accepted by the server. Stable key plus payload hash returns the same order on identical retries; reject conflicting payload reuse.
2. Use merchant order reference with provider requests and persist external IDs. If gateway creation is uncertain, reconcile before creating another payable order. Use short processing response with polling when needed. Reserve for a proposed 15 minutes, capped by the route’s latest safe payment time; worker releases once after expiry. Never rely on TTL deletion to release stock.
3. Verify Checkout signature server-side using stored gateway order ID and secret. Verify webhook signature on raw body using separate webhook secret before JSON parsing; persist deduped event before acknowledgment. Reconcile gateway captured status, amount, currency and local order binding. Use a transaction to convert held stock to sold and enqueue fulfillment once. If capture arrives after expiry, recheck stock and original deadline; if impossible, route to refund and notify buyer. Flag surplus captures for reconciliation.
4. Keep payment, fulfillment and refund states separate. Payment created → pending → captured/failed; failed attempt may coexist with later successful attempt. Fulfillment held → ready → booked → picked up → delivered; branches include cancelled, failed attempt, returned or intervention required. Refund requested → submitted → processed/failed. Unknown status stays pending reconciliation. Process out-of-order events by source timestamp and permitted transitions. Refund issuance never automatically restocks damaged or shipped goods.
5. Persist job and domain mutation in one transaction. Workers use atomic leases with expiry, bounded exponential retries, jitter and a dead-letter queue with audited replay. For all external side effects reconcile unknown outcomes before retry. Send confirmation and private link once per order using a transactional notification provider selected before launch.

## Delivery adapter
Implement checkServiceability, book, getStatus, markReady and cancel against the merchant-enabled Shadowfax Hyperlocal product. Map the merchant pickup ID, coordinates, exact destination, item dimensions/weight, prepaid amount to collect = zero and merchant reference into the contracted schema. Keep provider token server-side. Use serviceability endpoint and placement/tracking/status simulation listed in official Hyperlocal docs. Confirm actual account fields, sandbox credentials, goods restrictions, event authentication, quotas, cancellation fees and any delivery time bound during onboarding. A serviceable response alone cannot guarantee a 24-hour delivery. Keep polling as baseline where authenticated callbacks are unavailable.
 
For placement, find next feasible pack/pickup interval plus conservative transit estimate and buffer. Compare arrival to placedAt + 24h before payment. Validate exact delivery address and permitted cart types. If partner is unavailable, use only a verified staffed backup route; persist route decision and source. After payment, rebook via approved fallback if safe, preserve original deadline and log customer contact. Reconcile using merchantRef when booking times out; where lookup is unavailable hold for operator confirmation before another attempt. Limit full rider-location retention to the operational need.

## Packages and stock
Expand kit components into SKU quantities before reserving. Snapshot each cycle’s contents, price allocation and address. Reserve first-drop stock at checkout, create all cycle records on capture, forecast future stock separately. At configured procurement lead time flag shortages; at dispatch lead time reserve components transactionally, recheck exact route and issue one shipment per cycle. A skipped, rescheduled or cancelled cycle records actor, buyer agreement, quantity release and financial allocation. Preserve the monthly anchor across February. Plan purchase and ad hoc items use separate checkout in v1 for clear fulfillment and refund accounting.

## Media, deployment and acceptance
Server signs uploads for authenticated staff with allowed folder, type, size, format and timestamp. On completion verify response and allowed metadata with Cloudinary before marking ready. Keep secret out of browser. Use versioned delivery URLs, responsive transformations and a poster for every video. Block deletion of referenced assets. Store only non-sensitive marketing media in public folders.
 
At proxy and Express set request size limits, strict origin policy and rate limits. Hash session/access tokens, encrypt backups, mask contact fields in logs and scope production DB access. Keep request IDs across gateway, courier and worker records. Set alerts for growing job lag, expired holds, stale tracking and payment mismatches. Deploy backward-compatible database changes before apps; pause dispatch workers during rollback and reconcile leases on restart. Test a backup restore to staging and replay events there with external outbound calls disabled. Proposed recovery targets: 24-hour maximum data loss from daily backups and four-hour restore; merchant should choose tighter recovery for live transactions and use point-in-time backup accordingly.

## Integration references
- Razorpay Standard Checkout and verification — https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
- Razorpay webhook validation and duplicate handling — https://razorpay.com/docs/webhooks/validate-test/
- Shadowfax Hyperlocal serviceability, orders and sandbox events — https://developer.shadowfax.in/docs/api/hyperlocal-marketplace/serviceability
- Cloudinary media uploads — https://cloudinary.com/documentation/upload_images
- React Router rendering modes — https://reactrouter.com/start/framework/rendering
