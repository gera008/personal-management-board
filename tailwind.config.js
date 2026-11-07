/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        card: v('card'),
        surface: v('surface'),
        line: v('line'),
        accent: v('accent'),
        fg: v('fg'),
        muted: v('muted'),
        border: v('border'),
        expense: v('expense'),
        income: v('income'),
        transfer: v('transfer'),
        calendar: v('calendar'),
        tasks: v('tasks'),
        habit: v('habit'),
        slip: v('slip'),
      },
      fontFamily: { sans: ['-apple-system', '"SF Pro Display"', 'Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
