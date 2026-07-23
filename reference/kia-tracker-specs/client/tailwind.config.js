/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        brand: {
          red: 'var(--color-brand-red)',
          accent: 'var(--color-accent)',
          'accent-hover': 'var(--color-accent-hover)',
        },
        surface: {
          page: 'var(--color-bg-page)',
          sidebar: 'var(--color-bg-sidebar)',
          card: 'var(--color-bg-card)',
          elevated: 'var(--color-bg-elevated)',
          input: 'var(--color-bg-input)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          subtle: 'var(--color-border-subtle)',
        },
        content: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
          inverse: 'var(--color-text-inverse)',
        },
        status: {
          success: 'var(--color-success)',
          'success-light': 'var(--color-success-light)',
          warning: 'var(--color-warning)',
          'warning-light': 'var(--color-warning-light)',
          danger: 'var(--color-danger)',
          'danger-light': 'var(--color-danger-light)',
          info: 'var(--color-info)',
          'info-light': 'var(--color-info-light)',
        },
        pipeline: {
          new: '#3B82F6',
          garage: '#6366F1',
          'finance-pending': '#F59E0B',
          approved: '#06B6D4',
          funded: '#14B8A6',
          delivered: '#10B981',
          lost: '#EF4444',
        },
      },
      spacing: {
        sidebar: '240px',
        'sidebar-collapsed': '60px',
      },
      transitionDuration: {
        DEFAULT: '200ms',
        fast: '150ms',
        normal: '250ms',
        slow: '350ms',
      },
      animation: {
        'slide-in-right': 'slideInRight 250ms ease-out',
        'slide-out-right': 'slideOutRight 200ms ease-in',
        'fade-in': 'fadeIn 200ms ease-out',
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
      },
      keyframes: {
        slideInRight: {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        slideOutRight: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
    },
  },
  plugins: [],
};
