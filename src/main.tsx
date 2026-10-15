import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { GameReview } from './GameReview';
import './styles.scss';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.hash === '#review' ? <GameReview /> : <App />}
  </React.StrictMode>
);
