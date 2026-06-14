# Default skills catalog

`default-skills.json` is the starter set offered during onboarding and by `starfish govern`.
It is sourced from Anthropic's public skills repo (https://github.com/anthropics/skills).

**These skills are not trusted by default.** Every entry passes through Toby's intake on first use:
static review + provenance + hash-on-vet. The `expectedRisk` field is a hint only — the registered
disposition is whatever the vet produces. Low auto-enables; Medium and above are quarantined until
the operator consents (the governance model; nothing bypasses it).

License note: `document-skills` (docx/pdf/pptx/xlsx) are **source-available** (not OSS);
`example-skills` and `claude-api` are **Apache-2.0**. Confirm terms before commercial redistribution.
