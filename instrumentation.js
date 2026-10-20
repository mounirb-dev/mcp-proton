// Al arrancar el servidor: migra las tablas de Better Auth, crea el administrador si no existe
// y arranca la sincronización automática de correos.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  try {
    const { initAuth } = await import('./lib/auth.js');
    await initAuth();
  } catch (err) {
    // sin configuración completa el panel muestra el error; el servidor sigue vivo para el healthcheck
    console.error('[auth] no inicializado:', err.message);
  }
  try {
    const { startAutoSync } = await import('./lib/auto-sync.js');
    startAutoSync();
  } catch (err) {
    console.error('[auto-sync] no iniciado:', err.message);
  }
}
