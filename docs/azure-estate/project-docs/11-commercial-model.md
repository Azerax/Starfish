# Commercial model: delivery, access, and pricing

Decisions and research from Aug 31 2026, covering three linked questions:
how Scott gets access to a client tenant, whether he should host client
containers himself, and what the tool is worth per month.

---

## 1. Access to a client tenant

Four options, not two.

| Option | Verdict |
|---|---|
| Guest account (`#EXT#` UPN) in their tenant | Ruled out by Scott's own "no users outside the tenant's domain" rule |
| **Member account in their domain** | **Use this until CSP enrollment** |
| Azure Lighthouse delegation | Leaves the data-plane coverage question unresolved |
| CSP + GDAP | The destination once enrolled |

**Why a member account beats Lighthouse:** their Conditional Access and PIM
apply to it normally, their offboarding removes it, audit attribution is
native in their logs, access reviews cover it — and it removes the Lighthouse
data-plane unknown currently sitting on the preflight checklist as "settle by
test."

**Conditions:** named human, never shared (a shared account destroys
attribution, which is the whole point). Agree a review date up front — a
lingering consultant account is the mirror image of a lingering delegation.

**Cost:** credential and MFA sprawl across clients. Manageable at 3-4 clients.

---

## 2. Hosting client containers in Scott's own tenant — rejected

Considered as a way to guarantee no rogue estates and to bill monthly on
usage. It fails in three places:

1. **It inverts the hard rule.** Client staff become guests in *Scott's*
   directory. His tenant becomes the source of truth for who can read their
   payroll folder; their offboarding no longer revokes access.
2. **Their data lands in his tenant.** Their Conditional Access, Purview,
   DLP, retention and eDiscovery stop applying. He becomes the processor,
   and a breach is his notification obligation.
3. **The knowledge source is their drive.** Indexing their SharePoint or file
   share from a Search service in another tenant means either copying their
   corpus into his storage (worse) or cross-tenant data-plane auth that Azure
   AI Search does not do cleanly. This is the practical killer, ahead of the
   legal one.

Billing informally — their consumption on his card, invoiced with a markup —
is not a supported model. That is what CSP exists for.

---

## 3. What replaces it

### Azure Managed Applications — the control mechanism

Resources deploy into **the client's subscription**, inside a managed resource
group carrying a **deny assignment**: the customer cannot modify or delete
what is in it. Scott's identity manages it.

This is a stronger claim than self-hosting — the no-rogue-estate guarantee is
enforced by the platform rather than by policy — while the data stays in the
client tenant under their controls and their bill.

The `estate.yaml` spec plus the validator becomes the Bicep behind the offer.
This is the productization path for what is already built.

Permission modes: Publisher Managed (default, deny assignment on), Publisher
and Customer Access, Locked Mode, Customer Managed.

### CSP indirect reseller — the billing mechanism

FY26 requirements:

- Active Microsoft AI Cloud Partner Program membership with a Partner Location
  Account (PLA) ID
- **USD $1,000 in CSP transactional revenue over the trailing 12 months**
  (measured at PLA level; excludes CPOR/DPOR/PAL revenue)
- MFA enabled for all administrative users, plus a designated security contact
- Signed CSP Indirect Reseller Microsoft Partner Agreement
- Transacts through a distributor (no direct Microsoft relationship)

Enforcement: 90-day warning window before deauthorization.

Also unlocks **GDAP** — granular, scoped, time-bound delegated admin — which
is the correct long-term answer to question 1.

### The combination

CSP + Managed Application: client tenant, client subscription, client data
controls — but **Scott's billing account**. Control and clean data without
custody.

---

## 4. The credits / lower-rates theory

The pooling lever is real but it is **PTU reservations**, not a volume
discount.

- Reservations scope to a resource group, a subscription, a **shared billing
  scope**, or a **management group**
- Every matching deployment inside that scope shares the discount up to the
  reserved PTU quantity — matching is by deployment type (Global / Data Zone /
  Regional) and region, *not* by model or deployment ID
- Minimum purchase: 1 PTU. Terms: 1-month and 1-year
- Exchangeable and cancellable; refunds capped at USD $50,000 per rolling
  12 months. Exchanging resets the term

**Consequence:** aggregation only helps if deployments sit under one billing
account or management group Scott controls. Managed App alone (their billing
account) does **not** pool. CSP does. This is the strongest argument for CSP.

**Caveat:** PTU only beats pay-as-you-go under sustained near-constant load.
Three or four SMB clients running chat and RAG will not saturate a minimum PTU
deployment — that is paid idle capacity. Run break-even per client before
committing, and do not put the discount in the business model.

Partner program Azure credits are dev/test allowances, not resale margin.

---

## 5. What the tool is worth per month

### Comparables

| Category | Price | Fit |
|---|---|---|
| Enterprise AI governance (Credo AI, Holistic AI) | $30k–150k+/yr = $2.5k–12.5k/mo | Wrong buyer — sells to orgs with data science teams and MLflow/SageMaker integrations |
| MSP multi-tenant config/governance (Inforcer, Augmentt) | Not published — demo-and-quote, per-seat or per-tenant, volume discounts, terms to 3 years | Closest structural analogue: set baseline once, push across tenants, detect drift, assess against a benchmark |

That nobody in the MSP category publishes pricing is itself the signal: this
is a negotiated market set by the value story, not a lookup.

### The distinction that sets the number

**A design canvas is used once per rollout — that is a project fee.
Drift detection runs continuously — that is a subscription.**

Only recurring things earn recurring money. The canvas gets Scott in the room;
the scanner is what someone pays for monthly.

### Realistic bands

- **Assessment / rollout engagement** — $4k–15k one-time. This is where the
  money is first, and it is available now.
- **Bundled into his own managed AI service** — $300–1,500/tenant/month, not
  as a line item but as the reason the retainer exists.
- **Sold to other MSPs as a tool** — $150–500/tenant/month, or a platform fee
  plus per-tenant. Requires the product to survive without Scott in the room.

### The blocker on all recurring revenue

No collector has ever run against a live tenant (BLOCKERS.md #1). Until the
drift loop demonstrably runs continuously against real estates, the monthly
number is hypothetical and the per-engagement number is not.

Superseded in part on 2026-09-01: Scott has his own Azure account to run
against. See `../tool-notes/FIXTURES.md` — that converts blocker 1 from
"needs a client" to "needs an afternoon".

---

## Recommendation

CSP indirect reseller as the destination, Managed Application as the product
wrapper, member-account-in-their-tenant as the bridge until enough CSP revenue
has been transacted to enroll.

Price the first deliveries per engagement. Earn the subscription by proving
the scanner runs.

---

## Open item

Scott's "no users outside the tenant's domain" rule has a second and more
useful reading: **no guest or external principals in any `sg-ai-*` group
backing a container**. Buildable as validator rule R13, verifiable by the
collector against a live tenant. Offered, not yet accepted.

## Sources

- [Indirect Reseller Eligibility Requirements — Partner Center](https://learn.microsoft.com/en-us/partner-center/enroll/new-indirect-reseller-requirement)
- [Azure Managed Applications overview](https://learn.microsoft.com/en-us/azure/azure-resource-manager/managed-applications/overview)
- [PTU costs and billing — Microsoft Foundry](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/provisioned-throughput-onboarding?view=foundry-classic)
- [Microsoft Foundry Provisioned Throughput reservations](https://learn.microsoft.com/en-us/azure/cost-management-billing/reservations/microsoft-foundry)
- [Multitenancy and content isolation — Azure AI Search](https://learn.microsoft.com/en-us/azure/search/search-modeling-multitenant-saas-applications)
- [Credo AI pricing review 2026 — CO-AIMS](https://co-aims.com/blog/credo-ai-review-2026-compliance-officers)
- [Augmentt pricing](https://www.augmentt.com/pricing/)
