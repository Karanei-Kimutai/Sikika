/**
 * main.jsx
 * --------
 * Application entry point. Mounts the React tree inside React.StrictMode
 * (enables additional runtime warnings in development) onto the `#root`
 * element defined in index.html. Font weight imports are co-located here so
 * they are bundled into the initial chunk alongside App.jsx and are available
 * before the first paint, rather than being loaded lazily later.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/nunito-sans/400.css'
import '@fontsource/nunito-sans/600.css'
import '@fontsource/nunito-sans/700.css'
import '@fontsource/nunito-sans/800.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/700.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
