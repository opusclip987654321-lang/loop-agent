// Démarrage de Loop Agent dans le navigateur.
// Charge l'état depuis le serveur, expose window.LA (le « stockage » utilisé
// par app.js à la place de localStorage), puis charge l'interface.
//
// Règles :
// - chaque projet et la page Argent sont un document versionné côté serveur ;
// - une écriture annonce la version lue ; si quelqu'un (un agent) a écrit
//   entre-temps, le serveur refuse (409) : on fusionne sa version avec celle
//   de Walid (public/merge.js) et on renvoie, sans rien perdre ;
// - toutes les 20 s, on regarde si un agent a écrit, et on recharge l'écran.
(function () {
  'use strict';

  const POLL_MS = 20000;
  const DEBOUNCE_MS = 400;

  function statusEl() {
    return document.getElementById('syncStatus');
  }
  function setStatus(text, kind) {
    const el = statusEl();
    if (!el) return;
    el.textContent = text;
    el.className = 'badge' + (kind ? ' ' + kind : '');
  }

  async function api(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    if (r.status === 401) {
      location.href = '/login';
      throw new Error('Connexion requise');
    }
    return r;
  }

  function createStore(state) {
    const cache = {};
    const versions = {};
    // Dernière valeur connue du serveur : la base de la fusion en cas de conflit.
    const bases = {};
    const dirty = new Set();
    const inflight = new Set();
    const timers = {};
    let failing = false;

    for (const [key, d] of Object.entries(state.docs || {})) {
      cache[key] = d.value;
      versions[key] = d.version;
      bases[key] = d.value;
    }

    const store = {
      projects: state.projects,
      // Appelé quand un document a changé côté serveur (agent ou conflit).
      onRemoteChange: null,

      get(key) {
        return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
      },

      set(key, value) {
        if (cache[key] === value) return;
        cache[key] = value;
        dirty.add(key);
        clearTimeout(timers[key]);
        timers[key] = setTimeout(() => flush(key), DEBOUNCE_MS);
        setStatus('Enregistrement…', 'yellow');
      },

      pending() {
        return dirty.size > 0 || inflight.size > 0;
      },
    };

    store.upload = async function (file) {
      const r = await fetch('/api/files', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      });
      if (r.status === 401) {
        location.href = '/login';
        throw new Error('Connexion requise');
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Envoi impossible.');
      return j;
    };

    // Envoie tout ce qui attend et patiente (5 s max). Utilisé avant de se déconnecter.
    store.flushAll = async function (timeoutMs = 5000) {
      const until = Date.now() + timeoutMs;
      for (const key of [...dirty]) {
        clearTimeout(timers[key]);
        flush(key);
      }
      while (store.pending() && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
      return !store.pending();
    };

    store.deleteFile = async function (id) {
      await api('DELETE', '/api/files/' + encodeURIComponent(id));
    };

    async function flush(key) {
      if (inflight.has(key)) {
        // Une écriture est déjà partie : on relancera à sa fin.
        clearTimeout(timers[key]);
        timers[key] = setTimeout(() => flush(key), DEBOUNCE_MS);
        return;
      }
      if (!dirty.has(key)) return;
      dirty.delete(key);
      inflight.add(key);
      const value = cache[key];
      try {
        const r = await api('PUT', '/api/docs/' + encodeURIComponent(key), {
          value,
          base: versions[key] || 0,
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 409) {
          // Un agent a écrit entre-temps : on fusionne ses changements avec
          // ceux de Walid, puis on renvoie sur sa version.
          const local = cache[key] === value ? value : cache[key];
          const merged = window.LAMerge ? window.LAMerge.mergeDocs(bases[key], local, j.value) : null;
          versions[key] = j.version;
          bases[key] = j.value;
          if (merged && merged !== j.value) {
            cache[key] = merged;
            dirty.add(key);
            clearTimeout(timers[key]);
            timers[key] = setTimeout(() => flush(key), 50);
            notifyRemote(key, 'merged');
          } else {
            cache[key] = merged || j.value;
            if (!merged) dirty.delete(key);
            notifyRemote(key, merged ? 'merged' : true);
          }
          return;
        }
        if (!r.ok) throw new Error(j.error || 'Erreur ' + r.status);
        versions[key] = j.version;
        bases[key] = value;
        failing = false;
      } catch (e) {
        // Réseau coupé ou serveur indisponible : on réessaie.
        failing = true;
        dirty.add(key);
        setStatus('Hors ligne · nouvel essai…', 'red');
        clearTimeout(timers[key]);
        timers[key] = setTimeout(() => flush(key), 5000);
      } finally {
        inflight.delete(key);
      }
      if (!store.pending() && !failing) setStatus('Enregistré', 'green');
    }

    function notifyRemote(key, conflict) {
      if (typeof store.onRemoteChange === 'function') {
        try {
          store.onRemoteChange(key, conflict);
        } catch (e) {
          console.error(e);
        }
      }
    }

    async function poll() {
      try {
        const r = await api('GET', '/api/versions');
        if (!r.ok) return;
        const remote = await r.json();
        for (const [key, v] of Object.entries(remote)) {
          if (v === versions[key] || dirty.has(key) || inflight.has(key)) continue;
          const d = await (await api('GET', '/api/docs/' + encodeURIComponent(key))).json();
          if (dirty.has(key) || inflight.has(key)) continue;
          cache[key] = d.value;
          versions[key] = d.version;
          bases[key] = d.value;
          notifyRemote(key, false);
        }
        if (!store.pending()) setStatus('Enregistré', 'green');
      } catch {
        /* on réessaiera au prochain tour */
      }
    }

    setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') poll();
      else for (const key of dirty) flush(key);
    });
    window.addEventListener('beforeunload', (e) => {
      if (store.pending()) {
        for (const key of dirty) flush(key);
        e.preventDefault();
      }
    });

    return store;
  }

  window.logout = async function () {
    if (window.LA && !(await window.LA.flushAll())) {
      if (!confirm('Des modifications ne sont pas encore enregistrées. Se déconnecter quand même ?')) return;
    }
    try {
      await api('POST', '/api/logout', {});
    } finally {
      location.href = '/login';
    }
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Impossible de charger ' + src));
      document.body.appendChild(s);
    });
  }

  (async function start() {
    try {
      const r = await api('GET', '/api/state');
      if (!r.ok) throw new Error('Erreur ' + r.status);
      window.LA = createStore(await r.json());
      await loadScript('/merge.js');
      await loadScript('/periodes.js');
      await loadScript('/app.js');
      await loadScript('/glue.js');
      await loadScript('/historique.js');
      await loadScript('/objectifs.js');
      await loadScript('/resultats.js');
      await loadScript('/documents.js');
      await loadScript('/frais.js');
      setStatus('Enregistré', 'green');
    } catch (e) {
      const main = document.getElementById('main');
      if (main)
        main.innerHTML =
          '<p class="note">Loop Agent n’a pas pu démarrer : ' + String(e.message || e) + '. Recharge la page.</p>';
      console.error(e);
    }
  })();
})();
