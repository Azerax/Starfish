# Installing Project Starfish

The `starfish` CLI brings any Claude / AI agent & skill build under governance. It ships as one
self-contained bundle (no runtime dependencies), installable from **npm** or **GitHub**.

## From npm (recommended)

```bash
npm install -g project-starfish      # global `starfish` command
starfish govern ./my-skill-pack

# or run without installing:
npx project-starfish govern ./my-skill-pack
```

## From GitHub

```bash
# global install straight from the repo (npm builds the bundle on install):
npm install -g github:Azerax/Starfish
starfish govern ./my-skill-pack

# or run once:
npx github:Azerax/Starfish govern ./my-skill-pack
```

### From a clone (contributors)

```bash
git clone https://github.com/Azerax/Starfish.git
cd Starfish
npm install            # runs `prepare` → builds the CLI bundle
npm run build:cli      # rebuild the bundle anytime
node packages/cli/dist/cli.mjs govern ./my-skill-pack
```

## Requirements
Node.js >= 18.

## What you get
`starfish govern <pack>` inventories a build, vets each capability (static review + provenance +
prompt-injection screen → a risk tier), and installs the gate: low auto-registers, medium+ is
quarantined pending your `--approve`. Local-only; nothing runs ungoverned.

## Publishing (maintainers)
```bash
npm publish -w project-starfish      # prepublishOnly bundles dist/cli.mjs first
```
The desktop app (GCS Starfish) is distributed separately; this package is the governance CLI/overlay.
