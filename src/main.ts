import { createApp } from './app/create-app.ts';
import './style.css';

const app = createApp('#workspace');

if (import.meta.hot) {
  import.meta.hot.dispose(() => app.destroy());
}
