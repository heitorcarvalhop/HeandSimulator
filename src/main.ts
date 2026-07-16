import './styles/main.css';
import { App } from './app/App';

const app = new App();
app.initialize().catch((error: unknown) => {
  console.error('Falha crítica ao inicializar a aplicação:', error);
  const errorScreen = document.getElementById('error-screen');
  const errorMessage = document.getElementById('error-message');
  const permissionScreen = document.getElementById('permission-screen');
  if (errorScreen && errorMessage) {
    permissionScreen?.classList.add('hidden');
    errorScreen.classList.remove('hidden');
    errorMessage.textContent = error instanceof Error ? error.message : 'Erro desconhecido ao iniciar a aplicação.';
  }
});
