/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        // LeetCode-adjacent accent, dark-first since the popup is small and
        // most people run LeetCode's dark theme.
        brand: { DEFAULT: "#ffa116", dim: "#c97d0d" },
        easy: "#00b8a3",
        medium: "#ffb800",
        hard: "#ff375f",
      },
    },
  },
};
