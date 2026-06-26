export type AssetErrorSeverity = "fatal" | "transient" | "partial";

export interface AssetError {
  severity: AssetErrorSeverity;
  code: string;
  message: string;
  recoverable: boolean;
}

export function classifyError(error: string | AssetError): AssetError {
  if (typeof error !== "string") return error;
  if (error.includes("network") || error.includes("fetch")) {
    return { severity: "transient", code: "NETWORK", message: error, recoverable: true };
  }
  if (error.includes("timeout") || error.includes("超时")) {
    return { severity: "transient", code: "TIMEOUT", message: error, recoverable: true };
  }
  if (error.includes("permission") || error.includes("权限") || error.includes("401") || error.includes("403")) {
    return { severity: "fatal", code: "AUTH", message: error, recoverable: false };
  }
  return { severity: "fatal", code: "UNKNOWN", message: error, recoverable: true };
}
