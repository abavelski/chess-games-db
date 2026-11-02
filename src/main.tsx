import React from 'react';
import { createRoot } from 'react-dom/client';
import WorkspaceRoot from './WorkspaceRoot';
import './styles.scss';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WorkspaceRoot />
  </React.StrictMode>
);
