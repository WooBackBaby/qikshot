import React from 'react';
import ReactDOM from 'react-dom/client';
import { AnnotationEditor } from './AnnotationEditor';
import '../styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AnnotationEditor />
  </React.StrictMode>
);
