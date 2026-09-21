// supabase-client.js
// Phase 3: a SAFE Supabase JS client wrapper. READ-ONLY. No DDL, no DML
// against application data, no auth mutations, no storage uploads. The
// existing localStorage Store in store-data.js is the runtime source of
// truth — this module is an isolated read-only connection probe.
//
// Configuration is read from window.SUPABASE_CONFIG (provided by
// assets/js/supabase-config.js, which is git-ignored). If the config is
// missing or empty, the module is a no-op and the existing app is
// completely unaffected.
//
// The browser is expected to load the official Supabase JS via the
// jsDelivr CDN in index.html / admin.html (or in a separate test page)
// BEFORE this file. The CDN exposes window.supabase as the createClient
// factory.

(function () {
  'use strict';

  function log(msg, extra) {
    // Never print the URL's key or any sensitive value. Only status info.
    try { console.log('[supabase] ' + msg, extra == null ? '' : extra); } catch (e) {}
  }

  function readConfig() {
    var c = (typeof window !== 'undefined') ? window.SUPABASE_CONFIG : null;
    if (!c || typeof c !== 'object') return null;
    var url = (typeof c.url === 'string') ? c.url.trim() : '';
    var key = (typeof c.anonKey === 'string') ? c.anonKey.trim() : '';
    if (!url || !key) return null;
    return { url: url, anonKey: key };
  }

  function makeSafeNoopClient(reason) {
    return {
      isConfigured: false,
      reason: reason || 'not-configured',
      from: function () { return makeSafeNoopClient(reason); },
      select: function () { return Promise.resolve({ data: null, error: { message: reason || 'not-configured' } }); }
    };
  }

  // The actual init is wrapped so a missing config or missing global
  // window.supabase does not break the existing site. If anything goes
  // wrong we fall back to a no-op client and log a clear reason.
  var client = null;
  var config = readConfig();

  if (!config) {
    log('Supabase client not configured (window.SUPABASE_CONFIG missing or empty). The existing localStorage Store is the active source of truth.');
    client = makeSafeNoopClient('SUPABASE_CONFIG missing or empty');
  } else if (typeof window === 'undefined' || !window.supabase || typeof window.supabase.createClient !== 'function') {
    log('window.supabase (CDN) not loaded yet. supabase-client.js will be a no-op until the CDN script is available.');
    client = makeSafeNoopClient('window.supabase not loaded');
  } else {
    try {
      client = window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        db: { schema: 'public' },
        global: { headers: { 'x-application-name': 'anwar-admin' } }
      });
      log('Supabase client initialized');
    } catch (e) {
      log('Supabase client init failed; falling back to no-op', (e && e.message) || e);
      client = makeSafeNoopClient('init failed');
    }
  }

  // Expose the client (real or no-op) on a dedicated namespace so the
  // existing window.* surface is not polluted.
  if (typeof window !== 'undefined') {
    window.__supabase = { client: client, isReal: !!config && !!window.supabase };

    // Late-CDN recovery: if the CDN loads after this script (e.g. async),
    // re-initialize the real Supabase client.
    window.__supabase.reconnect = function () {
      var s = window.__supabase;
      if (s.isReal) return;
      var cfg = readConfig();
      if (!cfg || !window.supabase || typeof window.supabase.createClient !== 'function') return;
      try {
        s.client = window.supabase.createClient(cfg.url, cfg.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
          db: { schema: 'public' },
          global: { headers: { 'x-application-name': 'anwar-admin' } }
        });
        s.isReal = true;
        log('Supabase client re-initialized (late CDN load)');
        try { console.log('[DEBUG-INIT] reconnect: client isReal=true, url=' + (cfg.url || 'none').replace(/\/\/([^/]+).*/, '//$1')); } catch(e) {}
      } catch (e) {
        log('Supabase late re-init failed', (e && e.message) || e);
      }
    };

    // The READ-ONLY connection test. Safe: select 1 row from settings.
    // Returns a plain serializable result. Does NOT write, update, or
    // delete anything. Does not touch localStorage.
    window.runSupabaseConnectionTest = async function () {
      var result = { ok: false, configured: !!config, error: null, sample: null };
      if (!config) {
        result.error = 'SUPABASE_CONFIG is missing or empty. Fill in assets/js/supabase-config.js (git-ignored) with SUPABASE_URL and the publishable (anon) key.';
        log('Supabase read test skipped: not configured');
        return result;
      }
      try {
        var res = await client.from('settings').select('store_name').limit(1);
        if (res.error) {
          result.error = res.error.message || String(res.error);
          log('Supabase read test failed', res.error);
        } else {
          result.ok = true;
          result.sample = (res.data && res.data[0]) || null;
          log('Supabase read test successful');
        }
      } catch (e) {
        result.error = (e && e.message) || String(e);
        log('Supabase read test threw', result.error);
      }
      return result;
    };
  }
})();
