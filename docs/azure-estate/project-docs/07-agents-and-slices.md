# Agents inside containers — focus vs leak

2026-08-31. Scott's second sketch: one box holding **two** LLM + folder pairs —
`/marketing/*.*` and `/marketing/specific project/`. Nested paths, same box.

That is a real and common shape, and it forced the distinction the design was
missing.

## The unit is the agent

- **Container** = one audience. One Entra group, one Foundry project, one
  managed identity. This is the security boundary.
- **Agent** = one model bound to one folder slice, inside a container. Several
  per container is normal — a broad assistant and a focused one for the same
  team.
- **Drive** = the existing company store.

Previously the canvas had loose LLMs and loose slices in a container and the
generated spec just grabbed the first model. The sketch pairs them, and the
pairing is the thing.

## The rule that falls out

**Within a container, a narrower slice is FOCUS. Across containers, an
overlapping slice is a LEAK.**

`/marketing` and `/marketing/spring-launch` in the same box: fine. Same people,
same group, nobody crosses a boundary. The narrower slice exists for answer
quality, not for access control.

The same two paths in different boxes: blocked. One team's model can answer from
another team's documents.

## The caveat that has to be said out loud

Nesting inside a container is **not isolation**. Every agent in a Foundry
project shares that project's managed identity, so the project needs Search
Index Data Reader on *every* index it hosts — which means the focused agent's
identity can technically reach the broad agent's index too.

Within one audience that is harmless. But it means: **if two agents need
different people, they need different containers.** There is no half-boundary.

The gate says this in the "nested inside a container — allowed" section rather
than hiding it, because someone will eventually try to use nesting as a
permission mechanism.

## Path notation

`folderPath` is a recursive prefix, so all of these mean the same thing and the
canvas normalises them rather than rejecting any:

```
/marketing/*.*   /marketing/*   /marketing/**   /marketing/   marketing
```

Worth knowing: **there is no way to index one folder without its subfolders.**
If `/marketing/*.*` was meant as "files directly in marketing, not below", Azure
cannot express it — the slice has to move or the folders have to be
reorganised.

Repeated separators collapse and Windows backslashes convert, since paths get
pasted from Explorer.

## Generated shape

```yaml
- kind: Workspace                 # one Foundry project, one managed identity
  name: marketing
  purpose: "Campaign work for the marketing team"
  access:
    entraGroup: sg-ai-marketing
    scope: agentApplication
  agents:
    - name: marketing-assistant
      model: gpt-frontier
      knowledge:
        kind: azureBlob           # blob knowledge source, GA
        name: ks-marketing-marketing-assistant
        containerName: company-drive
        folderPath: marketing
    - name: spring-launch
      model: gpt-frontier-mini
      knowledge:
        folderPath: marketing/spring-launch
```

Each agent's slice provisions its own data source, indexer, skillset and index —
so the tier ceiling (S1 = 50, S2/S3 = 200 of each) now counts **agents with
knowledge**, not containers.
