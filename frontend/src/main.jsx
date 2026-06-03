import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme.css'
import App from './App.jsx'
import { ThemeProvider } from './ThemeContext.jsx'
import { ModelProvider } from './ModelContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <ModelProvider>
        <App />
      </ModelProvider>
    </ThemeProvider>
  </StrictMode>,
)
