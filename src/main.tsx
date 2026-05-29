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
import PolandApp from './pages/PolandApp.tsx'
import IndiaApp from './pages/IndiaApp.tsx'
import NigeriaApp from './pages/NigeriaApp.tsx'
import SouthKoreaApp from './pages/SouthKoreaApp.tsx'
import PortugalApp from './pages/PortugalApp.tsx'
import TurkeyApp from './pages/TurkeyApp.tsx'
import CountriesPage from './pages/CountriesPage.tsx'

const splash = document.getElementById('splash')
if (splash) {
  splash.classList.add('splash-hide')
  setTimeout(() => splash.remove(), 500)
}

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
        <Route path="/poland" element={<PolandApp />} />
        <Route path="/india" element={<IndiaApp />} />
        <Route path="/nigeria" element={<NigeriaApp />} />
        <Route path="/south-korea" element={<SouthKoreaApp />} />
        <Route path="/portugal" element={<PortugalApp />} />
        <Route path="/turkey" element={<TurkeyApp />} />
        <Route path="/countries" element={<CountriesPage />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
)
