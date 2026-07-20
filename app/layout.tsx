// @ts-ignore - global stylesheet is handled by the bundler
import '../components/design-system/styles/tokens.css'
import '../styles/global.css'
import SyncEngineProvider from '../components/SyncEngineProvider'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SyncEngineProvider>
          {children}
        </SyncEngineProvider>
      </body>
    </html>
  )
}
