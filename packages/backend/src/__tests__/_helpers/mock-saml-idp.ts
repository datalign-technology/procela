import { randomUUID } from 'crypto';
import { SignedXml } from 'xml-crypto';
import selfsigned from 'selfsigned';

// Mock SAML IdP for integration tests. Generates a self-signed
// keypair + X.509 certificate via the `selfsigned` package, exposes
// the cert so Procela's SamlAuthProvider can trust assertions, and
// builds + signs a SAMLResponse XML the way a real IdP would.
//
// This isn't a network-facing IdP — SAML's SP-initiated flow only
// needs the IdP at the AuthnRequest URL (which Procela just builds
// and returns; no real login happens in tests). All the verification
// happens at the ACS endpoint, where the SP receives the signed
// assertion. The helper produces that assertion from a fixture.

export interface MockSamlIdpHandle {
  /** PEM-encoded X.509 certificate. Drop into SAML_IDP_CERT. */
  certificatePem: string;
  /** PEM-encoded RSA private key. Used by buildSamlResponse to sign. */
  privateKeyPem: string;
  /** Build a base64-encoded SAMLResponse for the given subject. The
   *  return value is what an IdP would POST to /saml/acs as the
   *  SAMLResponse form field. */
  buildSamlResponse: (args: SamlResponseArgs) => string;
}

export interface SamlResponseArgs {
  /** Issuer URL — must match SAML_ENTRY_POINT host on the SP side. */
  issuer: string;
  /** SP entity ID — must match SAML_ISSUER. The assertion's
   *  AudienceRestriction lists this value. */
  audience: string;
  /** ACS URL — must match SAML_CALLBACK_URL. The Subject's
   *  SubjectConfirmationData.Recipient and the Response.Destination
   *  attributes carry this. */
  recipient: string;
  /** Subject NameID. Maps to profile.nameID on the SP side. */
  nameID: string;
  /** Optional SAML attributes — email, name, role claims. Passed
   *  through as friendly names; the SP looks them up by name. */
  attributes?: Record<string, string | string[]>;
  /** Session index (carried back to /auth/logout for SP-initiated SLO). */
  sessionIndex?: string;
  /** Override the assertion's NotOnOrAfter — tests use this to force
   *  an expired assertion. Defaults to now + 5 min. */
  notOnOrAfter?: Date;
  /** Override the assertion's NotBefore — defaults to now - 5 min. */
  notBefore?: Date;
  /** Override the signing key. Tests pass a different keypair here to
   *  simulate a forged assertion signed by a non-trusted cert. */
  signWith?: { privateKeyPem: string; certificatePem: string };
}

export async function startMockSamlIdp(): Promise<MockSamlIdpHandle> {
  // selfsigned uses node-forge under the hood — generates a real,
  // parseable X.509 v3 cert that node-saml / xml-crypto can extract
  // the public key from. The generate() call is async in v5+.
  const attrs = [{ name: 'commonName', value: 'mock-saml-idp.test' }];
  const pems = await selfsigned.generate(attrs, { keySize: 2048 });
  return {
    certificatePem: pems.cert,
    privateKeyPem: pems.private,
    buildSamlResponse: (args) => {
      const signKey = args.signWith?.privateKeyPem || pems.private;
      const signCert = args.signWith?.certificatePem || pems.cert;
      return buildSamlResponse(args, signKey, signCert);
    },
  };
}

// ── SAMLResponse builder ──

function buildSamlResponse(args: SamlResponseArgs, privateKeyPem: string, certPem: string): string {
  const now = new Date();
  const notBefore = (args.notBefore || new Date(now.getTime() - 5 * 60_000)).toISOString();
  const notOnOrAfter = (args.notOnOrAfter || new Date(now.getTime() + 5 * 60_000)).toISOString();
  const issueInstant = now.toISOString();
  const responseId = '_' + randomUUID().replace(/-/g, '');
  const assertionId = '_' + randomUUID().replace(/-/g, '');
  const sessionIndex = args.sessionIndex || '_' + randomUUID().replace(/-/g, '');

  const attrXml = renderAttributes(args.attributes || {});

  // node-saml v5 defaults wantAuthnResponseSigned + wantAssertionsSigned
  // both to true, so we sign the Assertion first (inner-most), embed
  // it in the Response, then sign the Response wrapper. Real IdPs
  // commonly do both; matching that here gives the test the broadest
  // applicability.
  const unsignedAssertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" IssueInstant="${issueInstant}" Version="2.0"><saml:Issuer>${args.issuer}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${escapeXml(args.nameID)}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${args.recipient}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"><saml:AudienceRestriction><saml:Audience>${args.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${issueInstant}" SessionIndex="${sessionIndex}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>${attrXml ? `<saml:AttributeStatement>${attrXml}</saml:AttributeStatement>` : ''}</saml:Assertion>`;
  const signedAssertion = signElement(unsignedAssertion, privateKeyPem, certPem, assertionId, 'Assertion');

  const unsignedResponse = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${issueInstant}" Destination="${args.recipient}"><saml:Issuer>${args.issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${signedAssertion}</samlp:Response>`;
  const signedResponse = signElement(unsignedResponse, privateKeyPem, certPem, responseId, 'Response');

  return Buffer.from(signedResponse, 'utf-8').toString('base64');
}

function renderAttributes(attrs: Record<string, string | string[]>): string {
  return Object.entries(attrs)
    .map(([name, value]) => {
      const values = Array.isArray(value) ? value : [value];
      const valueXml = values
        .map((v) => `<saml:AttributeValue>${escapeXml(v)}</saml:AttributeValue>`)
        .join('');
      return `<saml:Attribute Name="${escapeXml(name)}">${valueXml}</saml:Attribute>`;
    })
    .join('');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function signElement(
  xml: string,
  privateKeyPem: string,
  certPem: string,
  elementId: string,
  localName: 'Assertion' | 'Response',
): string {
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  sig.addReference({
    xpath: `//*[@ID='${elementId}']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    // node-saml's validator looks for a Reference whose URI matches
    // `#<element ID>`. With an empty URI the validator rejects the
    // assertion as "Invalid document signature".
    uri: `#${elementId}`,
  });
  // Embed the signature inside the target element, after the Issuer
  // child (per SAML XML-DSig conventions).
  sig.computeSignature(xml, {
    location: {
      reference: `//*[local-name()='${localName}']/*[local-name()='Issuer']`,
      action: 'after',
    },
  });
  return sig.getSignedXml();
}
