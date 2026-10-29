import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource/poppins/200.css'
import '@fontsource/poppins/300.css'
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import './styles.css'

document.documentElement.dataset.platform = window.platform

// Un fichier lâché à côté d'une zone prévue ne doit pas remplacer l'appli par l'image.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
