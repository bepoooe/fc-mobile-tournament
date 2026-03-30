/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        night: '#0a0a0f',
        neonPink: '#ff00ff',
        neonPurple: '#cc00ff',
        neonSoft: '#ff4dff',
      },
      fontFamily: {
        pixel: ['"Press Start 2P"', 'cursive'],
      },
      boxShadow: {
        neon: '0 0 12px rgba(255, 0, 255, 0.6), 0 0 28px rgba(204, 0, 255, 0.35)',
      },
      backgroundImage: {
        'grid-overlay':
          'radial-gradient(circle at 10% 10%, rgba(255,0,255,0.15) 0px, rgba(255,0,255,0) 55%), radial-gradient(circle at 90% 20%, rgba(204,0,255,0.13) 0px, rgba(204,0,255,0) 50%), linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid-overlay': 'auto, auto, 40px 40px, 40px 40px',
      },
      keyframes: {
        confetti: {
          '0%': { transform: 'translateY(-30px) rotate(0deg)', opacity: '0' },
          '10%': { opacity: '1' },
          '100%': { transform: 'translateY(480px) rotate(360deg)', opacity: '0' },
        },
      },
      animation: {
        confetti: 'confetti 3.2s linear infinite',
      },
      screens: {
        'xs': '320px',
        'sm': '640px',
        'md': '768px',
        'lg': '1024px',
        'xl': '1280px',
        '2xl': '1536px',
      },
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
    },
  },
  plugins: [],
}

