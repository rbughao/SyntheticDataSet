/** @type {import('tailwindcss').Config} */

// Every colour is a CSS variable holding space-separated RGB channels, so
// Tailwind's `/opacity` modifier still works (e.g. `bg-brand/10`) and switching
// the whole theme is a matter of changing variable values in index.css —
// not re-editing class names across the app.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),

        surface: {
          DEFAULT: token('surface'),
          2: token('surface-2'),
          3: token('surface-3'),
        },

        line: {
          DEFAULT: token('line'),
          strong: token('line-strong'),
        },

        ink: {
          DEFAULT: token('ink'),
          2: token('ink-2'),
          3: token('ink-3'),
        },

        brand: {
          DEFAULT: token('brand'),
          hover: token('brand-hover'),
          soft: token('brand-soft'),
          ink: token('brand-ink'),
          on: token('brand-on'),
        },

        warn: {
          DEFAULT: token('warn'),
          soft: token('warn-soft'),
          line: token('warn-line'),
          ink: token('warn-ink'),
        },
        bad: {
          DEFAULT: token('bad'),
          soft: token('bad-soft'),
          line: token('bad-line'),
          ink: token('bad-ink'),
        },
        ok: {
          DEFAULT: token('ok'),
          soft: token('ok-soft'),
          line: token('ok-line'),
          ink: token('ok-ink'),
        },
        info: {
          soft: token('info-soft'),
          line: token('info-line'),
          ink: token('info-ink'),
        },
        alt: {
          soft: token('alt-soft'),
          ink: token('alt-ink'),
        },

        // Stays dark in both themes
        code: {
          bg: token('code-bg'),
          fg: token('code-fg'),
        },
      },

      fontFamily: {
        // Editorial display face for headings and generated questions.
        // All fallbacks ship with macOS/Windows — no webfont, stays offline.
        display: ['Iowan Old Style', 'Palatino Linotype', 'Palatino', 'Georgia', 'serif'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'Cascadia Mono', 'Menlo', 'Consolas', 'monospace'],
      },

      // Roomier than Tailwind's defaults, so existing rounded-* classes pick up
      // the editorial feel without touching a single class name.
      borderRadius: {
        md: '10px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
        '3xl': '26px',
      },

      boxShadow: {
        sm: '0 1px 2px rgb(var(--shadow) / 0.05)',
        DEFAULT: '0 1px 3px rgb(var(--shadow) / 0.06)',
        md: '0 2px 8px -2px rgb(var(--shadow) / 0.08)',
        lg: '0 8px 24px -8px rgb(var(--shadow) / 0.12)',
        xl: '0 16px 48px -12px rgb(var(--shadow) / 0.18)',
      },

      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out',
        'slide-up': 'slide-up .22s cubic-bezier(.16,1,.3,1)',
      },
    },
  },
  plugins: [],
}
