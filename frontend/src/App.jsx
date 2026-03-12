import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import MainPage from './components/MainPage.jsx';
import ArenaPage from './components/ArenaPage.jsx';
import RequestPage from './components/RequestPage.jsx';
import AdminPage from './components/AdminPage.jsx';
import SummaryDetailsPage from './components/SummaryDetailsPage.jsx';

function App() {
  return (
    <Routes>
      <Route path="/" element={<MainPage />} />
      <Route path="/arena" element={<ArenaPage />} />
      <Route path="/request" element={<RequestPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/summary/:type/:id" element={<SummaryDetailsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;