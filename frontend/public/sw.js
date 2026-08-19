self.addEventListener('install', (event) => {
  console.log('SW instalado');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('SW activado');
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'FitTrack Pro', body: '¡Es hora de entrenar!' };
  
  const options = {
    body: data.body,
    icon: '/apple-icon.png',
    badge: '/icon-light-32x32.png',
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
