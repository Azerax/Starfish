// Starfish Foundry-governance sidecar -- Azure Container Apps deployment skeleton.
//
// `az bicep build` and `az bicep lint` both pass clean against this file (Azure CLI + `az bicep` were
// installed and this was first fixed and validated in IMPLEMENTATION_PLAN.md Sec 6a; this comment used to
// say neither was installed, which was only ever true before that point -- fixed here, since it was never
// updated at the source after Sec 6a's fix landed). That confirms the template is syntactically valid
// ARM/Bicep and free of the linter's structural warnings -- it does NOT confirm the template will actually
// deploy successfully against a real subscription (`az deployment group validate`/`what-if` still need a
// logged-in Azure account and a real resource group, which this sandbox genuinely does not have -- `az
// account show` fails with no credentials configured). Treat this as a first draft that has cleared the
// syntax/lint bar but not the "actually deploys" bar -- see the implementation plan's manual checklist,
// item 6.
//
// Deploys the customer's OWN application container and the Starfish sidecar container in the SAME
// Container App revision (Azure Container Apps' native multi-container-per-revision support), so the
// app container reaches the sidecar at 127.0.0.1:8787 -- required because serve.ts binds loopback-only
// by design (docs/design/azure.md Sec 6 finding). The sidecar's port is NOT exposed via ingress; only
// the customer's own app container's port is (if it needs one at all).
//
// Also provisions an Azure Files share (auditStorageAccount / auditFileShare / auditVolumeStorage) and
// mounts it at /data on the sidecar container, so the hash-chained audit log survives a revision
// restart -- an earlier draft of this template left that as an open TODO; it's fixed here. Replica
// count is still pinned to exactly 1 (see the `scale` block below) because concurrent writers to one
// audit chain is a correctness problem this template does not yet solve, separate from the durability
// problem the file share fixes.

@description('Name prefix for all resources this template creates.')
param namePrefix string = 'starfish-governed'

@description('Region for all resources.')
param location string = resourceGroup().location

@description('Container image for the Starfish sidecar (published Marketplace artifact).')
param sidecarImage string = 'mcr.microsoft.com/REPLACE/starfish-sidecar:latest' // placeholder -- real registry TBD at publish time

@description('Container image for the customer\'s own agent-orchestration app.')
param appImage string

@description('Key Vault URI holding the sidecar bearer tokens, e.g. https://<vault>.vault.azure.net/')
param keyVaultUri string

@description('Name of the Key Vault secret containing STARFISH_TOKENS_JSON.')
param tokensSecretName string = 'starfish-tokens-json'

@description('Login server (e.g. myregistry.azurecr.io) of a PRIVATE registry hosting sidecarImage, if any. Leave empty for a public image (e.g. Microsoft Container Registry). Found missing during the first real test deployment (2026-08-03): a private-ACR sidecarImage with no `registries` entry deploys "successfully" but the container never pulls -- Container Apps has no credential to authenticate to the registry, and there is nothing in `az deployment group create`\'s own success/failure signal that surfaces this; it only shows up later as the revision stuck ProvisioningState=Failed / container CrashLoop with an ImagePullBackOff-equivalent reason once you go looking. When set, the identity above is granted a `registries` entry using ITS OWN managed identity for pull auth (no admin-enabled ACR credentials, same identity-based pattern already used for the Key Vault secret) -- grant that identity "AcrPull" on the registry out-of-band, same manual-RBAC-step philosophy as the Key Vault Secrets User grant below; this template does not and should not do that grant itself, for the same cross-resource-boundary reason.')
param sidecarRegistryServer string = ''

@description('Storage account name for the Azure Files share backing the sidecar\'s /data volume (audit chain persistence). Must be globally unique, lowercase alphanumeric, <=24 chars -- the default derives one from namePrefix + a resource-group-scoped unique suffix; override if that collides or if the customer has a naming convention to follow.')
param auditStorageAccountName string = take(toLower(replace('${namePrefix}audit${uniqueString(resourceGroup().id)}', '-', '')), 24)

@description('Azure Files share name for the audit volume.')
param auditFileShareName string = 'starfish-audit-data'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30 // audit-export retention; align with the customer's own compliance needs
  }
}

resource containerAppEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// Azure Files-backed persistence for the sidecar's /data volume (governed root + hash-chained audit log).
// Fixes the gap flagged in an earlier draft of this template: Container Apps' container filesystem is
// ephemeral and does NOT survive a revision restart on its own, which would silently reset the audit
// chain -- exactly the kind of silent data loss GOVERNANCE.md's audit-integrity requirements rule out.
// Standard_LRS + a standard (SMB) file share is the documented minimum for Container Apps' Azure Files
// volume-mount integration; if the customer's compliance posture needs zone/geo redundancy, swap the
// SKU below (that's a config change, not a structural one).
resource auditStorageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: auditStorageAccountName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource auditFileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-01-01' = {
  name: '${auditStorageAccount.name}/default/${auditFileShareName}'
  properties: {
    shareQuota: 100 // GiB -- generous headroom for a hash-chained append-only audit log; revisit if a
                     // customer's decision volume is high enough to approach this before log rotation
                     // policy (not yet designed -- open item) exists.
  }
}

// Registers the file share as a mountable volume source at the Container Apps ENVIRONMENT level (not the
// app level) -- this is how Azure Container Apps' Azure Files integration works: the environment holds
// the storage credentials, individual container apps reference it by name in their `volumes` list.
resource auditVolumeStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: containerAppEnv
  name: 'audit-data'
  properties: {
    azureFile: {
      accountName: auditStorageAccount.name
      accountKey: auditStorageAccount.listKeys().keys[0].value
      shareName: auditFileShareName
      accessMode: 'ReadWrite'
    }
  }
}

// User-assigned managed identity so the Container App can read the tokens secret from Key Vault without
// any credential baked into the image or the template. Grant this identity "Key Vault Secrets User" on
// the vault out-of-band (RBAC assignment is deliberately NOT in this template -- it crosses a resource
// boundary the sidecar's own deployment shouldn't own, and is exactly the kind of thing worth a human
// reviewing explicitly rather than a template silently granting).
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-identity'
  location: location
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-app'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      secrets: [
        {
          name: 'starfish-tokens-json'
          keyVaultUrl: '${keyVaultUri}secrets/${tokensSecretName}'
          identity: identity.id
        }
      ]
      // No external ingress on the sidecar's port -- see header comment. If the customer's own app
      // container needs to be internet- or VNet-reachable, that ingress config belongs to THEIR image's
      // needs, not this template's job to guess; left unset here deliberately.
      //
      // Only present when sidecarRegistryServer is non-empty (public sidecarImage needs no registry
      // credential at all -- an empty `registries` array is valid and simply means "no private pulls").
      // See sidecarRegistryServer's own description above for why this exists and what it does NOT do
      // (it does not grant the AcrPull role itself).
      registries: sidecarRegistryServer == '' ? [] : [
        {
          server: sidecarRegistryServer
          identity: identity.id
        }
      ]
      // activeRevisionsMode set explicitly to 'Single' (this is already Container Apps' documented
      // default when the field is omitted -- confirmed against Microsoft's current docs, checked
      // 2026-08-03 -- but pinned here rather than relying on an unstated default that could change).
      // IMPORTANT, and NOT solved by this: even in Single mode, Container Apps deliberately runs the OLD
      // and NEW revision's replicas SIMULTANEOUSLY during every deployment/update -- "the existing active
      // revision isn't deactivated until the new revision is ready" is the documented zero-downtime
      // behavior, not a bug. See the `scale` block's comment below for what this means for the
      // single-writer audit-chain assumption this template otherwise relies on.
      activeRevisionsMode: 'Single'
    }
    template: {
      containers: [
        {
          name: 'app'
          image: appImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'STARFISH_SIDECAR_URL', value: 'http://127.0.0.1:8787' }
          ]
        }
        {
          name: 'starfish-sidecar'
          image: sidecarImage
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          // DELIBERATELY NO `probes` array on this container -- do not add one. Confirmed via Microsoft's
          // own Container Apps docs (Health probes: https://learn.microsoft.com/en-us/azure/container-apps/health-probes,
          // checked 2026-08-03): Container Apps supports only httpGet and tcpSocket probes -- "exec
          // probes aren't supported" -- and both types are dispatched by the platform against the
          // container's port, not executed inside the container's own network namespace. serve.ts (the
          // sidecar's HTTP layer) rejects any connection whose remoteAddress isn't 127.0.0.1/::1 by
          // design (see Sec 1 of IMPLEMENTATION_PLAN.md) -- the same behavior already confirmed tonight
          // for `docker run -p` port-published traffic, which the sidecar also rejects for the identical
          // reason. A platform-dispatched HTTP or TCP probe against this container's port 8787 would
          // almost certainly get the same rejection, reporting this container permanently unhealthy and
          // likely triggering restart loops for a container that is actually working correctly -- a
          // confusing failure mode, not a helpful health signal. If liveness monitoring for the sidecar
          // is ever wanted, it has to come from the co-located `app` container calling
          // `http://127.0.0.1:8787/v1/health` itself (a real loopback call from a container that shares
          // this pod's network namespace, per Sec 1) and surfacing that via the app container's OWN
          // probe/metrics, not a probe on this container directly.
          env: [
            { name: 'STARFISH_TOKENS_JSON', secretRef: 'starfish-tokens-json' }
            { name: 'STARFISH_ROOT', value: '/data/governed-root' }
            { name: 'PORT', value: '8787' }
          ]
          // Persistent audit/state storage: mounted from the Azure Files share registered above
          // (auditVolumeStorage), fixing the gap an earlier draft of this template only flagged with a
          // TODO. /data now survives a revision restart -- the hash-chained audit log written under
          // STARFISH_ROOT persists on the file share, not the container's ephemeral local disk.
          volumeMounts: [
            { volumeName: 'audit-data', mountPath: '/data' }
          ]
        }
      ]
      volumes: [
        {
          name: 'audit-data'
          storageType: 'AzureFile'
          storageName: auditVolumeStorage.name
        }
      ]
      scale: {
        // The persistence gap is fixed, but replica-count safety is a SEPARATE concern this template
        // still does not fully solve: two replicas mounting the same Azure Files share and both appending
        // to the same hash-chained audit log concurrently is a correctness problem (interleaved/racing
        // writes to one chain), not just a durability one. Pinning min/maxReplicas to 1 prevents Container
        // Apps from ever SCALING OUT this revision to more than one replica -- but it does NOT prevent the
        // separate, real overlap that happens on every deployment/update of this same app: confirmed
        // against Microsoft's current Container Apps docs (checked 2026-08-03, see the comment above
        // activeRevisionsMode) that even in the default Single revision mode, "the existing active
        // revision isn't deactivated until the new revision is ready" -- meaning during any future update
        // to this template's images/config, there IS a real (if narrow, typically seconds to low minutes)
        // window where the OLD revision's one sidecar replica and the NEW revision's one sidecar replica
        // are BOTH running, both mounted to the same Azure Files share, both able to append to the same
        // hash-chained audit log. An earlier version of this comment implied pinning replica count was
        // "the honest fix" for the concurrent-writer problem -- that overclaimed what a scale rule alone
        // can guarantee; it solves the scale-out case, not the deployment-overlap case. Left unsolved
        // here, same as it was before this correction, deliberately: a real fix needs governance-core to
        // have an actual concurrent-writer story (a single-writer lease acquired against the audit file
        // itself, or a per-replica chain-segment design that merges on read) -- that's shared code this
        // workstream doesn't own, flagged in IMPLEMENTATION_PLAN.md's manual checklist as a real,
        // production-relevant risk to weigh before this template is used for anything that gets updated
        // while live traffic depends on audit-chain integrity.
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output containerAppFqdn string = containerApp.properties.configuration.ingress != null ? containerApp.properties.configuration.ingress.fqdn : ''
output identityPrincipalId string = identity.properties.principalId // grant this "Key Vault Secrets User" on the vault, out-of-band
