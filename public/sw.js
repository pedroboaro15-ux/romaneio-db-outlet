// Service worker só pra notificação push (nada de cache/offline aqui — o app já
// tem seu próprio jeito de guardar dados offline no localStorage).
self.addEventListener('push', event => {
  let dados = { titulo: 'Romaneio', corpo: 'Você tem uma novidade.', url: '/' };
  try { dados = { ...dados, ...event.data.json() }; } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(dados.titulo, {
      body: dados.corpo,
      icon: '/logo.svg',
      badge: '/logo.svg',
      data: { url: dados.url }
    })
  );
});

// Clica na notificação: foca uma aba já aberta do app, ou abre uma nova.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
      for (const c of lista) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
      return self.clients.openWindow(url);
    })
  );
});
