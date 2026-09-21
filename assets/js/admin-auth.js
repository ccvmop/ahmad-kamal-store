// assets/js/admin-auth.js
// ============================================================
// Phase 11 — Supabase Auth admin gate.
//
// Replaces the insecure client-side FNV-1a / localStorage /
// sessionStorage "anwar_admin" flag with Supabase Auth + a
// profiles.is_admin = true lookup.
//
// The store-side RLS (Phase 2 migration 003_rls_policies.sql) is the
// only source of authorization. This file is the browser-side
// reader of that decision; it does not decide it.
//
// REQUIRES (set up by supabase-client.js):
//   window.__supabase.client    a configured supabase-js client.
//
// PROVIDES:
//   window.AdminAuth = {
//     signIn(email, password),
//     signOut(),
//     getCurrentSession(),
//     getCurrentUser(),
//     isAdmin(),         // { ok, isAdmin, reason }   never throws
//     refresh()          // re-evaluates session + admin status
//   }
//
// NEVER touches:
//   - service-role / secret keys
//   - the old `anwar_admin_creds` localStorage credential
//   - sessionStorage.anwar_admin as the source of truth
//   - localStorage write paths (we may write a tiny cache key, see below)
// ============================================================

(function () {
  'use strict';

  var CACHE_KEY = 'anwar_admin_auth_cache_v1';
  var CACHE_TTL_MS = 30 * 1000;

  function getClient() {
    try {
      if (typeof window === 'undefined') return null;
      var s = window.__supabase;
      if (!s || !s.client || !s.client.auth) return null;
      return s.client;
    } catch (e) { return null; }
  }

  function safeReadCache() {
    try {
      var raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      if (typeof obj.ts !== 'number') return null;
      if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
      return obj;
    } catch (e) { return null; }
  }

  function safeWriteCache(payload) {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(Object.assign({ ts: Date.now() }, payload)));
    } catch (e) { /* never throw from cache writes */ }
  }

  function clearCache() {
    try { window.localStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  function toSafeUser(user) {
    if (!user || typeof user !== 'object') return null;
    return {
      id:     user.id     || null,
      email:  user.email  || null,
      role:   (user.app_metadata && user.app_metadata.role) || null
    };
  }

  function toSafeSession(session) {
    if (!session || typeof session !== 'object') return null;
    return {
      user:        toSafeUser(session.user),
      expires_at: session.expires_at || null,
      access_token_present: !!session.access_token
    };
  }

  // -------------------------------------------------------------
  // The adapter
  // -------------------------------------------------------------
  var AdminAuth = {

    signIn: async function (email, password) {
      var client = getClient();
      if (!client) {
        return { ok: false, reason: 'supabase_not_configured', message: 'Supabase client is not available.' };
      }
      if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
        return { ok: false, reason: 'invalid_input', message: 'Email and password are required.' };
      }
      try {
        var res = await client.auth.signInWithPassword({ email: email, password: password });
        if (res && res.error) {
          // Generic error message. Do NOT reveal whether the account exists.
          return { ok: false, reason: 'auth_failed', message: 'Invalid email or password.' };
        }
        var session = res && res.data && res.data.session;
        var user = res && res.data && res.data.user;
        if (!session || !user) {
          return { ok: false, reason: 'no_session', message: 'Invalid email or password.' };
        }
        // Check the profiles.is_admin flag. This is the only authority.
        console.log('[admin-auth] signIn: calling _checkIsAdmin with user.id=', user.id);
        var admin = await this._checkIsAdmin(user.id);
        if (!admin.ok || !admin.isAdmin) {
          // The user is authenticated but not an admin. Tear the
          // session down so we don't leave a logged-in but unauthorized
          // session in the browser.
          try { await client.auth.signOut(); } catch (e) {}
          clearCache();
          var reason = (admin && admin.reason) || 'not_admin';
          var detail = (admin && admin.message) || '';
          console.warn('[admin-auth] signIn: ACCESS DENIED. reason=' + reason + ' detail=' + detail);
          return { ok: false, reason: reason, message: 'Access denied. This account is not authorized. [' + reason + ']' };
        }
        safeWriteCache({ isAdmin: true, user: toSafeUser(user) });
        return { ok: true, isAdmin: true, user: toSafeUser(user) };
      } catch (e) {
        return { ok: false, reason: 'exception', message: 'Invalid email or password.' };
      }
    },

    resetPassword: async function (email) {
      var client = getClient();
      if (!client) {
        return { ok: false, reason: 'supabase_not_configured', message: 'Supabase client is not available.' };
      }
      if (typeof email !== 'string' || !email) {
        return { ok: false, reason: 'invalid_input', message: 'Email is required.' };
      }
      try {
        var redirectUrl = window.location.origin + '/reset-password.html';
        try {
          var path = window.location.pathname || '';
          var base = path.replace(/[^/]*$/, '');
          redirectUrl = window.location.origin + base + 'reset-password.html';
        } catch (e) { /* use default */ }
        var res = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
        if (res && res.error) {
          return { ok: false, reason: 'reset_failed', message: 'Failed to send reset email. Please try again.' };
        }
        return { ok: true, message: 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.' };
      } catch (e) {
        return { ok: false, reason: 'exception', message: 'Failed to send reset email. Please try again.' };
      }
    },

    signOut: async function () {
      clearCache();
      try {
        var client = getClient();
        if (client) await client.auth.signOut();
      } catch (e) { /* never throw */ }
      return { ok: true };
    },

    getCurrentSession: async function () {
      var client = getClient();
      if (!client) return null;
      try {
        var res = await client.auth.getSession();
        if (res && res.data && res.data.session) {
          return toSafeSession(res.data.session);
        }
        if (res && res.error) return null;
        return null;
      } catch (e) { return null; }
    },

    getCurrentUser: async function () {
      var client = getClient();
      if (!client) return null;
      try {
        var res = await client.auth.getUser();
        if (res && res.data && res.data.user) {
          return toSafeUser(res.data.user);
        }
        if (res && res.error) return null;
        return null;
      } catch (e) { return null; }
    },

    isAdmin: async function () {
      var user = await this.getCurrentUser();
      if (!user || !user.id) return { ok: false, isAdmin: false, reason: 'no_session' };
      return await this._checkIsAdmin(user.id);
    },

    refresh: async function () {
      clearCache();
      return await this.isAdmin();
    },

    // Internal: ask the database whether the given user is an admin.
    // Uses the existing profiles table. The existing RLS policy
    // `profiles_select_self` permits the current authenticated user to
    // read their own row (id = auth.uid() OR is_admin()).
    _checkIsAdmin: async function (userId) {
      var client = getClient();
      console.log('[admin-auth] _checkIsAdmin: userId=', userId, 'clientExists=', !!client, 'clientHasAuth=', !!(client && client.auth));
      if (!client || !userId) { console.warn('[admin-auth] _checkIsAdmin: ABORT no client or userId'); return { ok: false, isAdmin: false, reason: 'no_client_or_user' }; }
      try {
        var query = client.from('profiles').select('is_admin').eq('id', userId);
        var res;
        if (typeof query.maybeSingle === 'function') {
          res = await query.maybeSingle();
        } else {
          var fallback = await query.limit(1);
          res = { data: (fallback.data && fallback.data[0]) || null, error: fallback.error, status: fallback.status };
        }
        if (res && res.error) {
          console.warn('[admin-auth] _checkIsAdmin: RLS or table error:', res.error.message, res.error.code, res.error.hint);
          return { ok: false, isAdmin: false, reason: 'rls_or_missing', message: (res.error && res.error.message) || 'unable to read profile' };
        }
        var row = res && res.data;
        if (row && row.is_admin === true) {
          console.log('[admin-auth] _checkIsAdmin: SUCCESS is_admin=true');
          return { ok: true, isAdmin: true };
        }
        console.warn('[admin-auth] _checkIsAdmin: row exists but is_admin is not true. row=', JSON.stringify(row));
        return { ok: true, isAdmin: false, reason: 'not_admin' };
      } catch (e) {
        console.error('[admin-auth] _checkIsAdmin: EXCEPTION:', e && e.message, e && e.stack);
        return { ok: false, isAdmin: false, reason: 'exception', message: (e && e.message) || 'unable to read profile' };
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.AdminAuth = AdminAuth;
  }
})();
