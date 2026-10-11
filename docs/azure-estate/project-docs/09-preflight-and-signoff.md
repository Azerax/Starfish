# Pre-implementation checklist and the mapping sign-off

2026-08-31. Scott: *"there will be / should be a pre-implementation check list
that includes a drive tree map"*, then *"customer sign off on drive to knowledge
base mapping"*, then *"and this also logged in our built in governance"*.

Published as an artifact. Seven sections, 29 items, 11 blocking.

## Why this is the front of the engagement

The canvas assumes a clean drive that no real client has, and the hierarchy rule
will block on almost every real tenant. The checklist is what turns that from a
dead end into a discovery engagement. It also front-loads every permission ask,
which is the difference between a client saying yes in advance and saying "let
me check with security" while you are on the call.

## The drive tree map, specified

Not a folder listing. The deliverable is the **permission-variance column**:

- Tree to full depth — file count, size, oldest/newest modified, dominant types.
- **Whether each folder's internal permissions are uniform.** A folder whose
  documents do not all share the same access can never be a clean slice, because
  indexing it flattens those differences. This is the column that decides which
  folders can be boundaries.
- Mixed-sensitivity folders — where a folder boundary is coarser than the access
  boundary it would have to carry.
- Duplicates, so one document is not indexed into three containers.
- Dead weight — folders untouched for years. Usually the largest share;
  excluding them cuts cost and improves answers at once.

## The sign-off, as a gate rather than an email

The mapping is presented as a table — folder, container, audience, document
count as of the survey date — and approved by a **named person on the client
side**. The count is what makes "this is what you approved" checkable later
rather than a matter of recollection.

It is recorded as a change gate bound to the plan hash:

```yaml
- id: knowledge-mapping
  description: The folder each container may read.
  when: knowledge.sourceAdded || knowledge.pathChanged
  requires: humanApproval
  approvers:
    - data-owner@client.com      # theirs, not yours
  record:
    planHash: true               # which mapping, not just that one was approved
    commit: true
    countsAsOf: true
```

An approval in an inbox is not evidence. An approval bound to a plan hash says
*which* mapping was approved. The gate fires again on every later change, so the
mapping is approved as a state rather than as a policy.

**This should be added to the estate spec's `governance.changeGates` baseline.**
It is not there yet — the delivered `estate.yaml` has gates for access widening,
new write and external tools, and knowledge source additions, but not one that
captures a named client approver against the mapping specifically.

## The item most likely to be forgotten

A container's folder path is a **recursive prefix**, so anything created under
it after sign-off is indexed automatically. If someone adds
`/marketing/confidential-2027` next month, the marketing container picks it up
and nobody approves anything.

The signature covers documents that existed on the survey date. That argues for
a scheduled re-survey and an owner who watches for new folders — otherwise the
signed mapping quietly stops being true, which is worse than never having signed
one.

## Where it sits

Survey → cluster → agree mapping → **sign-off** → draw on the canvas → deploy.

The canvas is step five of six. The checklist is steps one to four, and the
drive remediation tool (see `10-next-drive-remediation.md`) is what makes step
two possible on a messy drive.
