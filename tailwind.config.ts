/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    './app/**/*.{ts,tsx,mdx}',
    './styles/**/*.{css}',
    `./public/**/*.html`,
  ],
  theme: {
    extend: {},
  },
  darkMode: 'class',
}

export default config
