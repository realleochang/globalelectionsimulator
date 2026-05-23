import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import HomePage from './pages/HomePage.tsx'
import FranceApp from './pages/FranceApp.tsx'
import CanadaApp from './pages/CanadaApp.tsx'
import USAApp from './pages/USAApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/uk" element={<App />} />
        <Route path="/france" element={<FranceApp />} />
        <Route path="/canada" element={<CanadaApp />} />
        <Route path="/usa" element={<USAApp />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
)
