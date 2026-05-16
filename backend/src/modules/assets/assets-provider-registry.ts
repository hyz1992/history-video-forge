import type {
  AssetProviderAdapter,
  AssetProviderType,
} from "./assets-provider-adapter.js";
import type { AssetTaskExecution } from "../../../../shared/src/index.js";

export interface AssetProviderRegistry {
  findAdapter(input: {
    taskType: AssetTaskExecution["task_type"];
    enabledProviderTypes: AssetProviderType[];
  }): AssetProviderAdapter | null;
}

export function createAssetProviderRegistry(
  adapters: AssetProviderAdapter[],
): AssetProviderRegistry {
  return {
    findAdapter(input) {
      return (
        adapters.find(
          (adapter) =>
            input.enabledProviderTypes.includes(adapter.providerType) &&
            adapter.canHandle({ taskType: input.taskType }),
        ) ?? null
      );
    },
  };
}
