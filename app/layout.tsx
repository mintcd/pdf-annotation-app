// @ts-ignore - global stylesheet is handled by the bundler
import '../components/design-system/styles/tokens.css'
import '../styles/global.css'
import BrowserResizeObserverErrorGuard from '../components/BrowserResizeObserverErrorGuard'

export const runtime = 'edge'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <BrowserResizeObserverErrorGuard />
        {children}
      </body>
    </html>
  )
}
