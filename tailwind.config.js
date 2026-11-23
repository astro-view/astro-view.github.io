/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep navy / near-black scientific instrument palette.
        void: '#05070d',
        abyss: '#080b14',
        panel: '#0c111c',
        panel2: '#111826',
        edge: '#1b2436',
        edge2: '#27344b',
        ink: '#e6ecf7',
        muted: '#8b9ab4',
        dim: '#5d6c86',
        accent: '#4da3ff',
        accent2: '#7cc4ff',
        warn: '#ffb648',
        bad: '#ff6b6b',
        good: '#4ade80',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '0.9rem' }],
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseRing: {
          '0%': { transform: 'scale(0.9)', opacity: '0.8' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 220ms ease-out',
        slideUp: 'slideUp 220ms cubic-bezier(0.22,1,0.36,1)',
        pulseRing: 'pulseRing 1.8s ease-out infinite',
      },
    },
  },
  plugins: [],
};
