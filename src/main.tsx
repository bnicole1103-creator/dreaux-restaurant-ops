import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const rootElement = document.getElementById('root')

function showFatalError(error: unknown) {
  if (!rootElement) return

  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}\n\n${error.stack ?? ''}`
      : String(error)

  rootElement.innerHTML = ''

  const wrapper = document.createElement('div')
  wrapper.style.padding = '24px'
  wrapper.style.fontFamily = 'system-ui, sans-serif'
  wrapper.style.background = '#ffffff'
  wrapper.style.color = '#111111'
  wrapper.style.minHeight = '100vh'

  const heading = document.createElement('h1')
  heading.textContent = 'LNX App Error'

  const description = document.createElement('p')
  description.textContent =
    'The app loaded, but something crashed during startup.'

  const details = document.createElement('pre')
  details.textContent = message
  details.style.whiteSpace = 'pre-wrap'
  details.style.wordBreak = 'break-word'
  details.style.padding = '16px'
  details.style.background = '#f3f4f6'
  details.style.borderRadius = '8px'

  wrapper.appendChild(heading)
  wrapper.appendChild(description)
  wrapper.appendChild(details)

  rootElement.appendChild(wrapper)
}

window.addEventListener('error', (event) => {
  showFatalError(event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  showFatalError(event.reason)
})

async function startApp() {
  if (!rootElement) {
    throw new Error('Root element #root was not found.')
  }

  try {
    const { default: App } = await import('./App')

    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  } catch (error) {
    console.error('Startup error:', error)
    showFatalError(error)
  }
}

void startApp()
