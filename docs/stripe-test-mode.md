# Stripe test-mode run (ticket 33)

How to run pay-online end to end against a Stripe sandbox, with webhooks forwarded by the Stripe CLI, and what the run on 2026-10-23 showed. Keys, account ids and webhook secrets never go in this file or any committed file. Use placeholders such as `acct_…`.

## Setup

1. Put the sandbox's `sk_test_…` key in the root `.env` as `STRIPE_SECRET_KEY`. The jobs process and the back-office API both read it.
2. Forward Connect events to the back-office API and print the signing secret:

   ```sh
   stripe listen --forward-connect-to localhost:3001/webhooks/stripe --forward-to localhost:3001/webhooks/stripe --print-secret
   ```

   Put the printed `whsec_…` in `apps/backoffice-api/.env` as `STRIPE_WEBHOOK_SECRET`. Keep `stripe listen` running. Without the secret, `/webhooks/stripe` is not registered.
3. `pnpm db:up && pnpm db:migrate && pnpm dev`.

## Runbook

1. **Onboard a Provider.** Admin → Providers → a Provider → Online payments → **Create onboarding link**. Open the link and finish Stripe's test onboarding with Stripe's test data. Back on the Provider page, the return refreshes the status; **Refresh status** must show *Active*.
2. **Pay.** Create an allotment Offer with payment mode online for that Provider, with a 12.5 % commission and a price, and publish it. In the guest app, book it in chat and confirm the card. The receipt shows **Pay now**. Pay with `4242 4242 4242 4242`. The page must show the Provider as the merchant, card and Link only. The receipt in My trip must turn *Confirmed · Paid*. In the connected account's dashboard, the charge must be captured with a 12.5 % application fee.
3. **Decline and expiry.** Book again and try `4000 0000 0000 0002`. The page shows the decline. Let the session expire, or run `stripe checkout sessions expire cs_…`. The Order must be *Expired*, Payment *Not paid*, the seat back, and the guest must get the "not completed in time" notice.
4. **Refund.** Confirm and pay an Order, then use the Provider's **Can't fulfil** on the order page. It must end *Refunded*, with the application fee refunded too.
5. **Late checkout.** Keep a Checkout page open and expire the Order from the admin (the hold timer's path). Then pay. The authorization must be voided, and the receipt shows *Expired · Payment released*.
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
| Steps 1 (finishing onboarding) to 6 | **Not run yet.** Stripe's hosted onboarding asks for an hCaptcha after the email step, and paying needs a person at the Checkout page. A person has to run these. |
| A completed manual-capture session's `payment_status` | Not observed yet (step 2). The code gates on `status === 'complete'`, not on `payment_status`. |
| v1 account with platform-collected requirements (a way to skip hosted onboarding in test mode) | Refused until the platform accepts responsibility for losses in Dashboard → Settings → Connect → Platform profile. This is not needed for the product path. |

Once steps 1–6 have been run, replace the "Not run yet" rows with what happened.
