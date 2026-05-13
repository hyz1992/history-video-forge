import { ref, watch } from "vue";

export type ThemeName = "cinematic-dark" | "light-modern";

const STORAGE_KEY = "svf-theme";

const currentTheme = ref<ThemeName>(
  (localStorage.getItem(STORAGE_KEY) as ThemeName) || "cinematic-dark"
);

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
