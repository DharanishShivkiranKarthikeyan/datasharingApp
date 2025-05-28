export default {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'primary-bg': 'var(--primary-bg)',
        'secondary-bg': 'var(--secondary-bg)',
        'border-color': 'var(--border-color)',
        'text-primary': 'var(--text-primary)',
        'accent': 'var(--accent-color)',
      },
    },
  },
  plugins: [],
}