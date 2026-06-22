import { ref, watch } from "vue";

export type ThemeName = "cinematic-dark" | "light-modern";

const STORAGE_KEY = "svf-theme";

const VALID_THEMES: readonly ThemeName[] = ["cinematic-dark", "light-modern"];

const DEFAULT_THEME: ThemeName = "cinematic-dark";

function isThemeName(value: string | null): value is ThemeName {
  return value !== null && (VALID_THEMES as readonly string[]).includes(value);
}

function loadTheme(): ThemeName {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isThemeName(stored) ? stored : DEFAULT_THEME;
}

const currentTheme = ref<ThemeName>(loadTheme());

function applyTheme(name: ThemeName) {
  document.documentElement.setAttribute("data-theme", name);
  localStorage.setItem(STORAGE_KEY, name);
}

export function useTheme() {
  watch(currentTheme, (name) => applyTheme(name), { immediate: true });

  return {
    currentTheme,
    setTheme: (name: ThemeName) => {
      currentTheme.value = name;
    },
    toggleTheme: () => {
      currentTheme.value =
        currentTheme.value === "cinematic-dark" ? "light-modern" : "cinematic-dark";
    },
  };
}

export function initTheme(): ThemeName {
  const name = loadTheme();
  applyTheme(name);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (
        m.type === "attributes" &&
        m.attributeName === "data-theme" &&
        document.documentElement.getAttribute("data-theme") !== currentTheme.value
      ) {
        observer.disconnect();
        applyTheme(currentTheme.value);
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme"],
        });
        return;
      }
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  return name;
}
