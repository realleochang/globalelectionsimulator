import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import HomePage from './pages/HomePage.tsx'
import FranceApp from './pages/FranceApp.tsx'
import CanadaApp from './pages/CanadaApp.tsx'
import USAApp from './pages/USAApp.tsx'
import AustraliaApp from './pages/AustraliaApp.tsx'
import GermanyApp from './pages/GermanyApp.tsx'
import BrazilApp from './pages/BrazilApp.tsx'
import NetherlandsApp from './pages/NetherlandsApp.tsx'
import TaiwanApp from './pages/TaiwanApp.tsx'
import SouthAfricaApp from './pages/SouthAfricaApp.tsx'
import RomaniaApp from './pages/RomaniaApp.tsx'
import SwedenApp from './pages/SwedenApp.tsx'
import SpainApp from './pages/SpainApp.tsx'
import NewZealandApp from './pages/NewZealandApp.tsx'
import CountriesPage from './pages/CountriesPage.tsx'

document.getElementById('splash')?.remove()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/uk" element={<App />} />
        <Route path="/france" element={<FranceApp />} />
        <Route path="/canada" element={<CanadaApp />} />
        <Route path="/usa" element={<USAApp />} />
        <Route path="/australia" element={<AustraliaApp />} />
        <Route path="/germany" element={<GermanyApp />} />
        <Route path="/brazil" element={<BrazilApp />} />
        <Route path="/netherlands" element={<NetherlandsApp />} />
        <Route path="/taiwan" element={<TaiwanApp />} />
        <Route path="/south-africa" element={<SouthAfricaApp />} />
        <Route path="/romania" element={<RomaniaApp />} />
        <Route path="/sweden" element={<SwedenApp />} />
        <Route path="/spain" element={<SpainApp />} />
        <Route path="/new-zealand" element={<NewZealandApp />} />
        <Route path="/countries" element={<CountriesPage />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
)
