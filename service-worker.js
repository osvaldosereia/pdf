const CACHE_NAME = 'dona-antonia-v1';
const URLS_TO_CACHE = [
  './',
  './index.html',
  // Se tiveres um ficheiro CSS externo, adiciona aqui.
  // Como o CSS está inline no HTML, não é necessário.
];

// Instalação do Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache aberto');
        return cache.addAll(URLS_TO_CACHE);
      })
  );
});

// Estratégia de Cache: Stale-While-Revalidate
// 1. Tenta servir do cache (rápido).
// 2. Em segundo plano, vai à internet buscar a versão nova.
// 3. Atualiza o cache para a próxima vez.
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Se encontrou no cache, retorna.
        if (response) {
          return response;
        }
        
        // Se não, busca na rede.
        return fetch(event.request).then(
          function(response) {
            // Verifica se a resposta é válida
            if(!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clona a resposta para guardar no cache
            var responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then(function(cache) {
                // Guarda imagens e outros recursos no cache
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      })
  );
});

// Ativação: Limpa caches antigos se mudarmos a versão (CACHE_NAME)
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
