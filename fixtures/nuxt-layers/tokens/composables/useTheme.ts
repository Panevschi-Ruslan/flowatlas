export const useTheme = () => ({
  load: () => $fetch('/theme'),
});
