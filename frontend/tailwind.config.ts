import type { Config } from "tailwindcss";

/**
 * Design tokens for the Reddit Scanner. `rs-*` colors are consumed
 * via Tailwind utilities like `bg-rs-orange` or `text-rs-ink`. Swap
 * the hex values here to rebrand without touching component code.
 *
 * Palette picks a Reddit-adjacent orange as the primary CTA color so
 * the tool feels like it belongs in the same category, without
 * literally mimicking Reddit's UI.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        rs: {
          orange: "#FF4500",
          "orange-dark": "#D63A00",
          ink: "#0F172A",
          slate: "#475569",
          stone: "#E2E8F0",
          bg: "#F8FAFC",
          panel: "#FFFFFF",
        },
        status: {
          new: "#2563EB",
          worked: "#16A34A",
          resurfaced: "#D97706",
          ignored: "#6B7280",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto",
          "Helvetica Neue", "Arial", "sans-serif",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
