'use strict';
/**
 * E-signature provider interface. Provider: SignEasy (the business workspace account).
 * The workflow only ever calls these four functions, so another provider could be added later
 * without touching the workflow.
 *
 * Phase 3 implements the providers. Until then this file fixes the contract.
 *
 * createRequest({ leaseId, pdfBuffer, filename, signers: [{ order, name, email, role }], signaturePage })
 *   → { providerRequestId }
 *   signers[0] = CEO/COO/CFO, signers[1] = landlord contact. Signing order is enforced by the provider.
 *   signaturePage: fixed field positions on the ScootHero page appended to the landlord's lease.
 *
 * getStatus(providerRequestId)
 *   → { status: 'pending' | 'partially_signed' | 'completed' | 'declined' | 'expired',
 *       signers: [{ email, signedAt | null }] }
 *
 * downloadSigned(providerRequestId)
 *   → { pdfBuffer, auditTrailBuffer }
 *
 * handleWebhook(req)
 *   → { providerRequestId, event: 'signer_signed' | 'completed' | 'declined', signerEmail, at }
 *   Must verify the provider's webhook signature before trusting the payload.
 */

const providers = {
  signeasy: () => require('./signeasy'),
};

function esign() {
  const name = (process.env.ESIGN_PROVIDER || 'signeasy').toLowerCase();
  if (!providers[name]) throw new Error(`Unknown ESIGN_PROVIDER "${name}"`);
  return providers[name]();
}

module.exports = { esign };
