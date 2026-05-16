import { describe, expect, it } from "vitest";

import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import type { AssetProviderAdapter } from "../../../backend/src/modules/assets/assets-provider-adapter.js";

describe("asset provider registry", () => {
  it("selects an adapter by task type and enabled provider type", () => {
    const adapter: AssetProviderAdapter = {
      providerName: "fake_image",
      providerType: "image",
      canHandle: ({ taskType }) => taskType === "image_still",
      prepare: async () => ({ providerJobId: null, rawRequestJson: {} }),
      submit: async () => ({ providerJobId: "job_001", rawResponseJson: {} }),
      poll: async () => ({ status: "completed", rawResponseJson: {} }),
      download: async () => [],
      normalizeResult: async () => ({ artifacts: [], notes: [] }),
      cancel: async () => undefined,
    };

    const registry = createAssetProviderRegistry([adapter]);
    const selected = registry.findAdapter({
      taskType: "image_still",
      enabledProviderTypes: ["image"],
    });

    expect(selected?.providerName).toBe("fake_image");
  });
});
