import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import {
  createAssetProviderJobRecord,
  listAssetProviderJobRecordsByManifest,
  updateAssetProviderJobRecord,
} from "../../../backend/src/modules/assets/asset-provider-job.repository.js";

describe("asset provider job repository", () => {
  it("creates, updates, and lists provider jobs by manifest record id", async () => {
    const db = createDbClient();

    const created = await createAssetProviderJobRecord(db, {
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      executionId: "exec_img_001",
      taskId: "img_001",
      providerType: "image",
      providerName: "fake_image",
      providerJobId: "job_001",
      status: "submitted",
      attemptCount: 1,
      rawRequestJson: { prompt: "test" },
      rawResponseJson: null,
      errorCode: null,
      errorMessage: null,
    });

    expect(created.id).toBeTruthy();
    expect(created.status).toBe("submitted");

    const updated = await updateAssetProviderJobRecord(db, created.id, {
      status: "completed",
      rawResponseJson: { output: "ok" },
    });

    expect(updated?.status).toBe("completed");
    expect(updated?.rawResponseJson).toMatchObject({ output: "ok" });

    const jobs = await listAssetProviderJobRecordsByManifest(
      db,
      "manifest_001",
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0].taskId).toBe("img_001");
  });
});
