// @starfish/governance-overlay — the portable product. `starfish govern <pack>`.
export const VERSION = '0.7.0';
export { inventory, type InventoryItem } from './inventory';
export { govern, governDefaults, type GovernOutcome } from './govern';
export { loadDefaultCatalog, defaultCatalogPath, type DefaultSkill } from './defaults';
export { seedInstall, isInitialized, readLock, lockPath, GOVERNANCE_SEED, type SeedOptions, type SeedResult, type SeedTool, type SeedAgent, type SeedPolicy } from './seed';
