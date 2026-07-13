// @ts-ignore - global stylesheet is handled by the bundler
import '../design-system/styles/tokens.css'
import '../styles/global.css'
import ServiceWorkerRegister from '../components/ServiceWorkerRegister'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  )
}
