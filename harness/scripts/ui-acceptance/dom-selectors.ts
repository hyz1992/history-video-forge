export const uiAcceptanceSelectors = {
  homePrimaryCta: "[data-testid='home-primary-cta']",
  createProject: "[data-testid='create-project']",
  generateTopic: "[data-testid='system-generate']",
  candidateDrawer: "[data-testid='candidate-drawer']",
  confirmCandidate: "[data-testid='confirm-candidate']",
  scriptText: "[data-testid='script-text']",
  scriptTraceEntry: "[data-testid='script-trace-entry']",
} as const;

export const uiAcceptanceDynamicSelectors = {
  firstCandidateItem: "[data-testid^='candidate-item-']",
} as const;
