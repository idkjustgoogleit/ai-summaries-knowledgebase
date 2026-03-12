/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'dark-bg': '#0f172a',
        'dark-card': '#1e293b',
        'dark-border': '#334155',
        'text-primary': '#f1f5f9',
        'text-secondary': '#94a3b8',
        'accent': '#3b82f6',
        'accent-hover': '#2563eb',
        'danger': '#ef4444',
        'success': '#10b981',
        'warning': '#f59e0b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}