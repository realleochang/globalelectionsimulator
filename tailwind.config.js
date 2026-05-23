/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans:    ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        display: ['"Barlow Condensed"', 'sans-serif'],
        title:   ['"Cinzel"', 'serif'],
      },
      colors: {
        'canvas':     '#f5f4f0',
        'surface':    '#ffffff',
        'surface2':   '#f0eeea',
        'card':       '#ffffff',
        'hover':      '#ebe9e5',
        'active':     '#e0ddd7',
        'muted-bg':   '#f8f7f4',
        'ink':        '#1a1a1a',
        'ink-2':      '#4a4844',
        'ink-3':      '#7a7870',
        'gold':       '#c8a020',
        'gold-soft':  '#e8cc80',
        'gold-deep':  '#9a7a18',
      },
      borderColor: {
        'subtle':  'rgba(0,0,0,0.06)',
        'default': 'rgba(0,0,0,0.09)',
        'strong':  'rgba(0,0,0,0.14)',
        'gold':    '#c8a020',
      },
      borderRadius: {
        'card': '6px',
        'btn':  '4px',
      },
      boxShadow: {
        'ctrl':    '0 1px 2px rgba(0,0,0,0.06)',
        'tooltip': '0 4px 16px rgba(0,0,0,0.12)',
        'panel':   '-2px 0 12px rgba(0,0,0,0.06)',
        'header':  '0 2px 10px rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
}
