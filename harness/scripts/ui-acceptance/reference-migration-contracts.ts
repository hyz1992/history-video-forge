export type ReferenceMigrationViewportName = "desktop" | "mobile";

export interface ReferenceMigrationViewport {
  name: ReferenceMigrationViewportName;
  width: number;
  height: number;
}

export interface ReferenceMigrationRequiredSelector {
  key: string;
  selector: string;
  mustBeInViewport?: boolean;
}

export interface ReferenceMigrationInteractionCheck {
  key: string;
  selector: string;
  action: "click";
  expectRoute?: string;
}

export interface ReferenceMigrationStyleIsolation {
  forbiddenGlobalSelectors: string[];
  sentinelRoutes: string[];
  forbiddenBodyClasses?: string[];
  forbiddenVisibleSelectors?: string[];
  reviewedGlobalSelectors?: string[];
}

export interface ReferenceMigrationContract {
  id: string;
  title: string;
  referencePath: string;
  targetRoute: string;
  outputName: string;
  viewports: ReferenceMigrationViewport[];
  requiredSelectors: ReferenceMigrationRequiredSelector[];
  interactionChecks: ReferenceMigrationInteractionCheck[];
  styleIsolation: ReferenceMigrationStyleIsolation;
  manualReviewItems: string[];
}

const contracts: ReferenceMigrationContract[] = [
  {
    id: "home-preview-landing",
    title: "首页 preview-landing.html 到 HomePage.vue 迁移",
    referencePath: "frontend/public/preview-landing.html",
    targetRoute: "/",
    outputName: "home-preview-landing",
    viewports: [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ],
    requiredSelectors: [
      { key: "homeHero", selector: "[data-testid='home-hero']" },
      { key: "homeTopbar", selector: "[data-testid='home-topbar']" },
      { key: "homeHeading", selector: "[data-testid='home-heading']", mustBeInViewport: true },
      { key: "homeTagline", selector: "[data-testid='home-tagline']" },
      { key: "homePrimaryCta", selector: "[data-testid='home-primary-cta']", mustBeInViewport: true },
      { key: "homeFeatureRail", selector: "[data-testid='home-feature-rail']" },
      { key: "homeFlowStrip", selector: "[data-testid='home-flow-strip']" },
    ],
    interactionChecks: [
      {
        key: "homePrimaryCtaRoute",
        selector: "[data-testid='home-primary-cta']",
        action: "click",
        expectRoute: "/projects",
      },
    ],
    styleIsolation: {
      forbiddenGlobalSelectors: ["body::before", "footer", ".container"],
      sentinelRoutes: ["/projects"],
      forbiddenBodyClasses: ["landing-page-bg"],
      forbiddenVisibleSelectors: ["[data-testid='home-topbar']", ".landing-topbar"],
      reviewedGlobalSelectors: [],
    },
    manualReviewItems: [
      "桌面截图是否接近参考 HTML",
      "移动端截图是否接近参考 HTML",
      "字体差异是否可接受",
      "滚动淡入、齿轮、传送带等动画是否等价",
      "CTA、控制台预览、流水线节点是否视觉跑偏",
    ],
  },
];

export function listReferenceMigrationContracts() {
  return contracts;
}

export function getReferenceMigrationContract(id: string) {
  const contract = contracts.find((item) => item.id === id);
  if (!contract) {
    throw new Error(`unknown_reference_migration_contract:${id}`);
  }
  return contract;
}
