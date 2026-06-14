// Publisher signing (Ed25519). A publisher signs a skill's manifest hash with its private key; we
// verify against a PINNED public key. This upgrades trust from a self-asserted provenance STRING
// (spoofable) to a cryptographic attestation. The hash is the content fingerprint; the signature is
// the attestation over it (key a central rated registry on the hash, with signatures as attestations).
import { createPublicKey, verify as edVerify, sign as edSign, generateKeyPairSync } from 'node:crypto';

export interface PinnedPublisher { id: string; publicKeyPem: string; }

export function verifyPublisherSignature(manifestHash: string, signatureB64: string, publicKeyPem: string): { verified: boolean; reason: string } {
  try {
    const key = createPublicKey(publicKeyPem);
    const ok = edVerify(null, Buffer.from(manifestHash, 'utf8'), key, Buffer.from(signatureB64, 'base64'));
    return ok ? { verified: true, reason: 'ed25519 signature valid' } : { verified: false, reason: 'signature mismatch' };
  } catch (e) { return { verified: false, reason: `verify-error: ${(e as Error).message}` }; }
}

/** Try a signature against every pinned publisher key; returns the matching publisher id if valid. */
export function verifyAgainstPinned(manifestHash: string, signatureB64: string | undefined, pinned: PinnedPublisher[]): { verified: boolean; publisherId?: string } {
  if (!signatureB64) return { verified: false };
  for (const p of pinned) if (verifyPublisherSignature(manifestHash, signatureB64, p.publicKeyPem).verified) return { verified: true, publisherId: p.id };
  return { verified: false };
}

// Publisher-side tooling (and tests): generate a keypair; sign a manifest hash.
export function generatePublisherKeypair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
}
export function signManifest(manifestHash: string, privateKeyPem: string): string {
  return edSign(null, Buffer.from(manifestHash, 'utf8'), privateKeyPem).toString('base64');
}
