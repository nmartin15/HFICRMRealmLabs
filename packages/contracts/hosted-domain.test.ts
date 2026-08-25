import { describe, expect, it } from "vitest";
import {
  HOSTED_DOMAIN,
  emailDomain,
  isHostedDomainClaim,
  isHostedDomainEmail,
  normalizeEmail,
} from "./hosted-domain";

describe("hosted domain restriction", () => {
  it("allows realmlabs.co emails", () => {
    expect(isHostedDomainEmail("nathan@realmlabs.co")).toBe(true);
    expect(isHostedDomainEmail("  Application@RealmLabs.CO ")).toBe(true);
    expect(emailDomain("nathan@realmlabs.co")).toBe(HOSTED_DOMAIN);
  });

  it("rejects any other domain", () => {
    expect(isHostedDomainEmail("nathan@gmail.com")).toBe(false);
    expect(isHostedDomainEmail("user@google.com")).toBe(false);
    expect(isHostedDomainEmail("nathan@mail.realmlabs.co")).toBe(false);
    expect(isHostedDomainEmail("realmlabs.co")).toBe(false);
    expect(isHostedDomainEmail("")).toBe(false);
  });

  it("requires the Google hd claim to be realmlabs.co", () => {
    expect(isHostedDomainClaim("realmlabs.co")).toBe(true);
    expect(isHostedDomainClaim("RealmLabs.CO")).toBe(true);
    expect(isHostedDomainClaim("gmail.com")).toBe(false);
    expect(isHostedDomainClaim(null)).toBe(false);
    expect(isHostedDomainClaim(undefined)).toBe(false);
  });

  it("normalizes email for matching", () => {
    expect(normalizeEmail(" Nathan@RealmLabs.CO ")).toBe("nathan@realmlabs.co");
  });

  it("honors an explicit allowed hosted domain", () => {
    expect(isHostedDomainEmail("user@example.com", "example.com")).toBe(true);
    expect(isHostedDomainEmail("nathan@realmlabs.co", "example.com")).toBe(
      false,
    );
    expect(isHostedDomainClaim("example.com", "example.com")).toBe(true);
    expect(isHostedDomainClaim("realmlabs.co", "example.com")).toBe(false);
  });
});
