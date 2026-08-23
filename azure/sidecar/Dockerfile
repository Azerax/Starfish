# Starfish sidecar -- Azure Container offer artifact.
#
# BUILD-TESTED tonight against a real, full checkout of this repo once a reachable Docker daemon turned
# out to be available in this session after all -- see IMPLEMENTATION_PLAN.md Sec 6 for the full account,
# including four real bugs this build process found and fixed. The image now builds AND boots AND serves
# real /v1/decide requests through the real governance-core PDP -- upgraded from "written" to "verified"
# in the plan's honesty table, with the specific scope of what was and wasn't covered spelled out there.
#
# TWO-STEP BUILD, not one -- this is a deliberate change from an earlier single-`docker build` draft:
#   1. From the repo root, with dependencies already installed (`npm ci`):
#        node azure/sidecar/build.mjs
#      This uses esbuild (already a root devDependency, same tool scripts/bundle-cli.mjs uses for the
#      CLI) to bundle entrypoint.mjs and its full @starfish/* import graph into ONE flat, dependency-free
#      file at azure/sidecar/dist/sidecar.mjs. See build.mjs's header comment for exactly why this
#      bundling step is required and not optional (short version: this repo's own tsconfig assumes a
#      bundler resolves its ~267 extensionless relative imports; Node's native module resolver doesn't).
#   2. THEN, from the repo root:
#        docker build -f azure/sidecar/Dockerfile -t starfish-sidecar:dev .
#      This Dockerfile does not run npm or esbuild itself -- it only packages the artifact step 1
#      already produced. That's not just simpler; it sidesteps a real problem found tonight: fetching a
#      fresh package (esbuild, when an earlier draft tried installing it INSIDE the Docker build) hit a
#      SELF_SIGNED_CERT_IN_CHAIN failure against registry.npmjs.org from inside a `docker build` layer in
#      this sandbox, even though the same host's plain `npm install` worked fine outside Docker. Whether
#      that's specific to this sandbox's networking or would recur in a real CI runner wasn't isolated
#      tonight -- avoiding any network fetch inside `docker build` sidesteps the question entirely rather
#      than resting on an assumption about a proxy/cert setup that wasn't fully diagnosed.

FROM node:22-slim AS runtime
RUN groupadd --system starfish && useradd --system --gid starfish --home /data starfish
WORKDIR /app

# Requires azure/sidecar/dist/sidecar.mjs to already exist -- see step 1 above. `docker build` fails
# immediately and legibly (COPY: file not found) if that step was skipped, rather than doing something
# less obvious.
COPY azure/sidecar/dist/sidecar.mjs /app/sidecar.mjs

# The source tree's own file permissions (0700, root-owned in the repo this was built from) survive
# COPY unchanged -- without this chown, the non-root `starfish` user below can't read its own bundled
# application code at all. Found by actually running the built image, not by reading the Dockerfile.
RUN chown starfish:starfish /app/sidecar.mjs
RUN mkdir -p /data/governed-root && chown -R starfish:starfish /data
USER starfish

ENV STARFISH_ROOT=/data/governed-root
ENV PORT=8787
# STARFISH_TOKENS_JSON is intentionally NOT set here -- it must come from a Container Apps / Key Vault
# secret reference at deploy time, never baked into the image. entrypoint.mjs fails closed (refuses to
# start) if it's missing, which is the correct behavior for a governance product's own boot sequence.
#
# STARFISH_ROOT ALSO must point at an already-seeded governed root (governance/{tools,agents,policies}.json
# etc. already present) -- entrypoint.mjs / createGovernance() correctly refuse to start against an
# unseeded root rather than silently running with an empty registry, and NOTHING in this image seeds one
# itself (deliberately -- seeding is a deploy-time step with customer-specific inputs, not something to
# bake into the image). Run `azure/sidecar/foundry-seed.mjs` against the volume-mounted root BEFORE this
# container's first boot -- it builds a real, Foundry-shaped governed root from a customer-supplied list
# of tool/agent specs (not the desktop product's own demo org-chart, which `seedInstall()` would produce
# and which is meaningless for a Foundry customer's actual agents and function names). Verified against a
# real running container across all four risk tiers, an `allowedAgents` identity-scoping fix, and an
# `allowedTools` per-agent capability fix -- see IMPLEMENTATION_PLAN.md Sec 6b/6d for the full account, and
# Sec 7 item 2 for what still needs a human review before this touches a real customer's deployment.

VOLUME ["/data"]
EXPOSE 8787
# This port is reachable only within the pod's network namespace (serve.ts binds 127.0.0.1 and rejects
# non-loopback callers by design -- see entrypoint.mjs's header comment). Do not add a Container Apps
# ingress rule for this port; only the co-located app container should ever call it.

ENTRYPOINT ["node", "/app/sidecar.mjs"]
