import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "sans-serif"],
      },
      colors: {
        // --border / --input bake their own white-alpha, so no <alpha-value>.
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          foreground: "hsl(var(--success-foreground) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          foreground: "hsl(var(--warning-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        chart: {
          1: "hsl(var(--chart-1) / <alpha-value>)",
          2: "hsl(var(--chart-2) / <alpha-value>)",
          3: "hsl(var(--chart-3) / <alpha-value>)",
          4: "hsl(var(--chart-4) / <alpha-value>)",
          5: "hsl(var(--chart-5) / <alpha-value>)",
        },
        // Design surface levels (near-black, cool-neutral).
        rail: "#0A0B0D", // sidebar, inbox lead panel
        surface: "#101113", // cards / list containers (= card)
        inset: "#0C0D0F", // inputs, table sub-rows, footers
        elevated: "#18191B", // modals, toast, menus
        avatar: "#2A2C33", // avatar circles
        // Design accent extras.
        indigo: {
          DEFAULT: "#5E6AD2",
          text: "#9BA3EB", // indigo text on dark (links, AI labels)
        },
        branch: "#B79CEF", // sequence branch / condition nodes
        linkedin: "#3C8FE2", // LinkedIn glyph
        // Cool low-alpha tints for avatar/initials backgrounds on the dark canvas.
        tint: {
          coral: "hsl(234 40% 22%)",
          blue: "hsl(210 45% 20%)",
          green: "hsl(144 30% 18%)",
          violet: "hsl(263 40% 24%)",
          amber: "hsl(34 45% 20%)",
        },
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)", // 12px — modals
        lg: "var(--radius)", // 8px — cards
        md: "calc(var(--radius) - 1px)", // 7px — controls
        sm: "calc(var(--radius) - 2px)", // 6px — small controls
      },
      boxShadow: {
        // Marketing (warm cream) elevation — retained for the reskinned marketing.
        soft: "0 1px 2px 0 rgba(0,0,0,0.3), 0 2px 8px -2px rgba(0,0,0,0.4)",
        "soft-md": "0 2px 4px -1px rgba(0,0,0,0.3), 0 8px 24px -6px rgba(0,0,0,0.5)",
        "soft-lg": "0 10px 40px -8px rgba(0,0,0,0.6)",
        // Cool-dark elevation.
        raised: "0 8px 22px -10px rgba(0,0,0,.6)",
        overlay: "0 24px 60px -20px rgba(0,0,0,.8)",
        // Design spec shadows.
        modal: "0 40px 100px -20px rgba(0,0,0,0.8)",
        toast: "0 20px 50px -15px rgba(0,0,0,0.7)",
        drawer: "-30px 0 80px -20px rgba(0,0,0,0.6)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { opacity: "0.3", transform: "translateX(28px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
        "slide-in-right": "slide-in-right 0.18s cubic-bezier(0.2, 0.7, 0.2, 1)",
      },
    },
  },
  plugins: [animate],
};

export default config;
