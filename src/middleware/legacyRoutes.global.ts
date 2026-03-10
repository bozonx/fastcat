export default defineNuxtRouteMiddleware((to) => {
  const path = to.path;

  if (path === '/files' || path === '/cut' || path === '/sound' || path === '/fullscreen') {
    return navigateTo('/');
  }
});
