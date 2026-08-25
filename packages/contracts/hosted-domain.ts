export const HOSTED_DOMAIN = "realmlabs.co";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeHostedDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  const at = normalizeEmail(email).lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) {
    return "";
  }
  return normalizeEmail(email).slice(at + 1);
}

/** Login is restricted to Google Workspace users on the allowed hosted domain. */
export function isHostedDomainEmail(
  email: string,
  domain: string = HOSTED_DOMAIN,
): boolean {
  return emailDomain(email) === normalizeHostedDomain(domain);
}

export function isHostedDomainClaim(
  hd: string | null | undefined,
  domain: string = HOSTED_DOMAIN,
): boolean {
  return (hd ?? "").trim().toLowerCase() === normalizeHostedDomain(domain);
}
