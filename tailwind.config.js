/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#0a0b10', 900: '#11131c', 800: '#181b27', 700: '#222637', 500: '#5a6280', 300: '#a8b0c8' },
        accent: { 400: '#6ee7b7', 500: '#34d399', 600: '#10b981' },
        warn: { 500: '#f59e0b' },
        danger: { 500: '#ef4444' },
      },
    },
  },
  plugins: [],
};
