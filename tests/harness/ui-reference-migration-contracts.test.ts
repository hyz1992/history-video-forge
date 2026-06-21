import { describe, expect, it } from "vitest";

import {
  getReferenceMigrationContract,
  listReferenceMigrationContracts,
} from "../../harness/scripts/ui-acceptance/reference-migration-contracts";

describe("reference migration contracts", () => {
  it("exposes the landing home contract", () => {
    const contracts = listReferenceMigrationContracts();
    expect(contracts.map((contract) => contract.id)).toContain("home-preview-landing");
  });

  it("keeps the home contract scoped to preview-landing and /", () => {
    const contract = getReferenceMigrationContract("home-preview-landing");

    expect(contract.referencePath).toBe("frontend/public/preview-landing.html");
    expect(contract.targetRoute).toBe("/");
    expect(contract.viewports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "desktop", width: 1440, height: 900 }),
        expect.objectContaining({ name: "mobile", width: 390, height: 844 }),
      ]),
    );
  });

  it("requires the home ui-acceptance hooks and migration sentinel hook", () => {
    const contract = getReferenceMigrationContract("home-preview-landing");
    const selectors = contract.requiredSelectors.map((item) => item.selector);

    expect(selectors).toEqual(
      expect.arrayContaining([
        "[data-testid='home-hero']",
        "[data-testid='home-topbar']",
        "[data-testid='home-heading']",
        "[data-testid='home-tagline']",
        "[data-testid='home-primary-cta']",
        "[data-testid='home-feature-rail']",
        "[data-testid='home-flow-strip']",
      ]),
    );
  });
});
