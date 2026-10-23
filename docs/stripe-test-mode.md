# Stripe test-mode run (ticket 33)

How to run pay-online end to end against a Stripe sandbox, with webhooks forwarded by the Stripe CLI, and what the run on 2026-10-23 showed. Keys, account ids and webhook secrets never go in this file or any committed file. Use placeholders such as `acct_…`.

## Setup

1. Put the sandbox's `sk_test_…` key in the root `.env` as `STRIPE_SECRET_KEY`. The jobs process and the back-office API both read it.
2. Forward Connect events to the back-office API and print the signing secret:

   ```sh
   stripe listen --print-secret
   stripe listen --events checkout.session.completed,checkout.session.expired,payment_intent.amount_capturable_updated,payment_intent.succeeded,payment_intent.canceled,charge.refunded,refund.failed --forward-connect-to localhost:3001/webhooks/stripe --forward-to localhost:3001/webhooks/stripe
   ```

   Put the printed `whsec_…` in `apps/backoffice-api/.env` as `STRIPE_WEBHOOK_SECRET`. Keep `stripe listen` running. Without the secret, `/webhooks/stripe` is not registered. Stripe CLI 1.53 refuses `--forward-connect-to` without `--events`. `apps/jobs` must be running too: it makes every Stripe call.
3. `pnpm db:up && pnpm db:migrate && pnpm dev`.

## Runbook

1. **Onboard a Provider.** Admin → Providers → a Provider → Online payments → **Create onboarding link**. Open the link and finish Stripe's test onboarding with Stripe's test data. Back on the Provider page, the return refreshes the status; **Refresh status** must show *Active*.
2. **Pay.** Create an allotment Offer with payment mode online for that Provider, with a 12.5 % commission and a price, and publish it. In the guest app, book it in chat and confirm the card. The receipt shows **Pay now**. Pay with `4242 4242 4242 4242`. The page must show the Provider as the merchant, card and Link only. The receipt in My trip must turn *Confirmed · Paid*. In the connected account's dashboard, the charge must be captured with a 12.5 % application fee.
3. **Decline and expiry.** Book again and try `4000 0000 0000 0002`. The page shows the decline. Let the session expire, or run `stripe checkout sessions expire cs_…`. The Order must be *Expired*, Payment *Not paid*, the seat back, and the guest must get the "not completed in time" notice.
4. **Refund.** Confirm and pay an Order, then use the Provider's **Can't fulfil** on the order page. It must end *Refunded*, with the application fee refunded too.
5. **Late checkout.** Stop `stripe listen`, pay an open Checkout, then expire the Order from the admin (the release the hold timer also makes). Expiring the Order first and paying after does not work: the release expires the session at once. The `expire_session` job must find the session complete and void the authorization, and the receipt shows *Expired · Payment released*. Start `stripe listen` again and resend the completion: it must be `unchanged`.
6. **Replay.** Run `stripe events resend evt_… --account acct_…` for a `checkout.session.completed`. No new `OrderEvent` may appear.

## Results, 2026-10-23

`stripe@23.0.0`, API version `2026-09-30.endive`. One sandbox, test mode.

| Check | Result |
| --- | --- |
| Accounts v2 connected account for a Croatian Provider (`identity.country: hr`, `dashboard: full`, merchant `card_payments` requested, fees and losses collected by Stripe) | Created through the back-office **Create onboarding link**. The v1 `controller` fallback was not needed. |
| Card capability status after creation (v2 `configuration.merchant.capabilities.card_payments.status`) | `pending`, shown as *Onboarding* after **Refresh status**. |
| v2 account link (`use_case.type: account_onboarding`) | Created. It opens Stripe's hosted "Get started with Stripe" page with the Provider's email filled in. |
| `use_case.account_onboarding.configurations` | Not in the `2026-09-30.endive` typings, so it is not sent. The link onboarded the account as requested at creation. |
| Checkout Session create on the connected account (direct charge, manual capture, `expires_at` 30 minutes ahead, `client_reference_id`, our full `excluded_payment_method_types` list, no `payment_method_types`) | Accepted, even while the account was still `pending`. |
| `excluded_payment_method_types` values rejected | None. All 31 values in `NON_CARD_METHODS` were accepted. |
| The created session's `payment_method_types` | `["card", "link"]`. The card-only check passes. |
| Step 1, finishing hosted onboarding | Run by a person on 2026-10-23 (Stripe's hosted onboarding asks for an hCaptcha after the email step, so an agent cannot finish it). Filled with Stripe's test phone, code and bank account. Back on the Provider page, **Refresh status** showed *Active*, and the Provider's stored card status is `active`. |
| Step 2, pay and capture (review run, `stripe listen` forwarding to a second back-office API, `apps/jobs` running) | Paid with `4242…` on the hosted page (merchant shown: the Provider's account name; methods card and Link). `checkout.session.completed` → Payment *authorized* → the confirm job confirmed the Order through the adapter → the capture job captured 90.00 € with `application_fee_amount` 1125 (12.5 %). OrderEvents: `authorized` (payment_webhook), `confirmed` (adapter), `captured` (payment_job). The later `payment_intent.succeeded` was `unchanged`. |
| A completed manual-capture session's `payment_status` | `unpaid`, with `status: complete`, as the code expects (it gates on `status`). |
| Step 3, decline and expiry | `4000 0000 0000 0002` showed "Your credit card was declined" on the hosted page and changed nothing on our side. `stripe checkout sessions expire cs_…` → `checkout.session.expired` → Order *Expired* (trigger payment_webhook), Payment *Not paid*, the seat back on the slot, `order_checkout_expired` sent. |
| Step 4, refund | The Provider link's Can't fulfil on the captured Order → *Cancelled*, refund job → `charge.refunded` → Payment *Refunded*. At Stripe: refund of 90.00 € succeeded, and the 11.25 € application fee was refunded too. |
| Step 5, late checkout (paid while webhooks were not forwarded, then the Order expired by the admin) | First run: the `expire_session` job failed, because Stripe answers an expire of a `complete` session with no error code, only "Only Checkout Sessions with a status in ["open"] can be expired". Fixed in the review: that message maps to `session-not-open`, and any rejected expire reads the session. Rerun: `expire_session` read the session as complete → Payment *authorized* → void job → intent `canceled` at Stripe, Payment *Voided*, Order stays *Expired*. The `checkout.session.completed` delivered afterwards was `unchanged`. |
| Step 6, replay | `stripe events resend` of a processed `checkout.session.completed`: the webhook answered 200 with `unchanged`, and no OrderEvent was added. |
| Events forwarded by `stripe listen` | Rendered at the account's API version (`2026-03-25.dahlia`). The narrow parser read them unchanged. |
| v1 account with platform-collected requirements (a way to skip hosted onboarding in test mode) | Refused until the platform accepts responsibility for losses in Dashboard → Settings → Connect → Platform profile. This is not needed for the product path. |

Steps 2–6 ran against Stripe in the review. Steps 3–5 used Orders created on the dev DB with the machine's `createOrder`, not through the chat. Step 1 was finished by a person afterwards, on the same day.
