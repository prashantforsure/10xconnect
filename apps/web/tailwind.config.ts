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
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
        // Command Dark tints for avatar/initials backgrounds (sit on the dark canvas)
        tint: {
          coral: "hsl(15 45% 18%)",
          blue: "hsl(210 45% 18%)",
          green: "hsl(159 35% 16%)",
          violet: "hsl(264 38% 20%)",
          amber: "hsl(40 45% 18%)",
        },
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        // Marketing (warm cream) elevation — unchanged.
        soft: "0 1px 2px 0 hsl(30 20% 20% / 0.04), 0 2px 8px -2px hsl(30 20% 20% / 0.06)",
        "soft-md": "0 2px 4px -1px hsl(30 20% 20% / 0.05), 0 8px 24px -6px hsl(30 20% 20% / 0.10)",
        "soft-lg": "0 10px 40px -8px hsl(30 20% 20% / 0.16)",
        // Command Dark elevation: raised cards/menus and overlay/modal/slide-over.
        raised: "0 8px 22px -10px rgba(0,0,0,.6)",
        overlay: "0 24px 60px -20px rgba(0,0,0,.8)",
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
