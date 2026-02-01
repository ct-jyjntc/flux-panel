import {heroui} from "@heroui/theme"

const mdThemeLight = {
  background: { DEFAULT: "#F8F5F0" },
  foreground: { DEFAULT: "#1E1D1A" },
  divider: { DEFAULT: "rgba(30, 29, 26, 0.12)" },
  focus: { DEFAULT: "#2C6AED" },
  overlay: { DEFAULT: "#000000" },
  content1: { DEFAULT: "#FDFBF7", foreground: "#1E1D1A" },
  content2: { DEFAULT: "#EEE9E2", foreground: "#58534C" },
  content3: { DEFAULT: "#E8E3DC", foreground: "#58534C" },
  content4: { DEFAULT: "#E2DDD6", foreground: "#58534C" },
  default: { DEFAULT: "#C7C0B8", foreground: "#1E1D1A" },
  primary: { DEFAULT: "#2C6AED", foreground: "#FFFFFF" },
  secondary: { DEFAULT: "#007B6F", foreground: "#FFFFFF" },
  success: { DEFAULT: "#1F7D52", foreground: "#FFFFFF" },
  warning: { DEFAULT: "#C96B12", foreground: "#FFFFFF" },
  danger: { DEFAULT: "#BA1A1A", foreground: "#FFFFFF" },
};

const mdThemeDark = {
  background: { DEFAULT: "#111310" },
  foreground: { DEFAULT: "#E7E2DB" },
  divider: { DEFAULT: "rgba(231, 226, 219, 0.14)" },
  focus: { DEFAULT: "#A7C7FF" },
  overlay: { DEFAULT: "#000000" },
  content1: { DEFAULT: "#151714", foreground: "#E7E2DB" },
  content2: { DEFAULT: "#191B17", foreground: "#CAC4BC" },
  content3: { DEFAULT: "#1E201C", foreground: "#CAC4BC" },
  content4: { DEFAULT: "#242621", foreground: "#CAC4BC" },
  default: { DEFAULT: "#605C55", foreground: "#E7E2DB" },
  primary: { DEFAULT: "#A7C7FF", foreground: "#003064" },
  secondary: { DEFAULT: "#73E0D0", foreground: "#003630" },
  success: { DEFAULT: "#85DABB", foreground: "#003221" },
  warning: { DEFAULT: "#FFC46E", foreground: "#402000" },
  danger: { DEFAULT: "#FFB4AB", foreground: "#690005" },
};

const mdLayout = {
  radius: {
    small: "10px",
    medium: "16px",
    large: "24px",
  },
  borderWidth: {
    small: "1px",
    medium: "1px",
    large: "2px",
  },
  boxShadow: {
    small: "0 1px 2px rgb(0 0 0 / 0.12), 0 2px 8px rgb(0 0 0 / 0.08)",
    medium: "0 4px 14px rgb(0 0 0 / 0.16), 0 2px 6px rgb(0 0 0 / 0.1)",
    large: "0 12px 30px rgb(0 0 0 / 0.2), 0 6px 12px rgb(0 0 0 / 0.12)",
  },
};

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    './src/layouts/**/*.{js,ts,jsx,tsx,mdx}',
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["\"Spline Sans\"", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["\"Spline Sans Mono\"", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        sm: "0.625rem",
        md: "0.875rem",
        lg: "1.125rem",
        xl: "1.5rem",
        "2xl": "1.75rem",
        "3xl": "2rem",
      },
      boxShadow: {
        sm: "0 1px 2px rgb(var(--md-shadow) / 0.15), 0 2px 6px rgb(var(--md-shadow) / 0.08)",
        DEFAULT: "0 2px 8px rgb(var(--md-shadow) / 0.14), 0 1px 3px rgb(var(--md-shadow) / 0.1)",
        md: "0 6px 18px rgb(var(--md-shadow) / 0.18), 0 2px 6px rgb(var(--md-shadow) / 0.12)",
        lg: "0 14px 32px rgb(var(--md-shadow) / 0.2), 0 6px 12px rgb(var(--md-shadow) / 0.14)",
      },
    },
  },
  darkMode: "class",
  plugins: [
    heroui({
      themes: {
        light: { colors: mdThemeLight },
        dark: { colors: mdThemeDark },
      },
      defaultTheme: "light",
      layout: mdLayout,
    }),
  ],
}
