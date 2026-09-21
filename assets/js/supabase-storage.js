// supabase-storage.js
// Supabase Storage image upload/delete/resolve helpers for the media bucket.
// Requires supabase-client.js to be loaded first (provides window.__supabase.client).

(function () {
  'use strict';

  var BUCKET = 'media';
  var MAX_SIZE = 10 * 1024 * 1024; // 10 MB (matches bucket limit)
  var ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  var COMPRESS_MAX_DIM = 1200;
  var COMPRESS_QUALITY = 0.85;

  function getClient() {
    try {
      var s = window.__supabase;
      return s && s.client ? s.client : null;
    } catch (e) { return null; }
  }

  function validateFile(file) {
    if (!file || !file.name) return 'ملف غير صالح';
    if (ALLOWED_TYPES.indexOf(file.type) === -1) {
      return 'نوع الملف غير مدعوم. يُسمح فقط بـ JPG, PNG, WebP, GIF';
    }
    if (file.size > MAX_SIZE) {
      return 'حجم الملف يتجاوز 10 ميجابايت';
    }
    return null;
  }

  /**
   * Compress/resize an image File before upload.
   * - Resizes to max COMPRESS_MAX_DIM on the longest side (preserves aspect ratio).
   * - Converts to JPEG at COMPRESS_QUALITY unless the original is PNG (keeps PNG for transparency).
   * - If the image is already smaller, returns the original file.
   * - On any error, returns the original file (never breaks the upload flow).
   * Returns a Promise<File>.
   */
  function compressImage(file) {
    return new Promise(function (resolve) {
      try {
        if (!file || !file.type || file.type.indexOf('image/') !== 0) { resolve(file); return; }
        // Don't compress GIFs (animated) or files already small
        if (file.type === 'image/gif' || file.size < 50 * 1024) { resolve(file); return; }

        var reader = new FileReader();
        reader.onload = function (e) {
          var img = new Image();
          img.onload = function () {
            try {
              var w = img.naturalWidth;
              var h = img.naturalHeight;
              var needsResize = w > COMPRESS_MAX_DIM || h > COMPRESS_MAX_DIM;
              var isPNG = file.type === 'image/png';

              // If already small and not PNG (which might benefit from WebP), return original
              if (!needsResize && !isPNG) { resolve(file); return; }

              var canvas = document.createElement('canvas');
              var ctx = canvas.getContext('2d');
              if (needsResize) {
                var ratio = Math.min(COMPRESS_MAX_DIM / w, COMPRESS_MAX_DIM / h);
                canvas.width = Math.round(w * ratio);
                canvas.height = Math.round(h * ratio);
              } else {
                canvas.width = w;
                canvas.height = h;
              }
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

              // Try WebP first (lossy, good for photos)
              canvas.toBlob(function (webpBlob) {
                if (webpBlob && webpBlob.size < file.size) {
                  var newName = file.name.replace(/\.[^.]+$/, '.webp');
                  resolve(new File([webpBlob], newName, { type: 'image/webp', lastModified: Date.now() }));
                  return;
                }
                // WebP failed or larger — fallback to original format
                var outType = isPNG ? 'image/png' : 'image/jpeg';
                var quality = isPNG ? undefined : COMPRESS_QUALITY;
                canvas.toBlob(function (fallbackBlob) {
                  if (!fallbackBlob || fallbackBlob.size >= file.size) { resolve(file); return; }
                  var ext = isPNG ? '.png' : '.jpg';
                  var newName = file.name.replace(/\.[^.]+$/, ext);
                  resolve(new File([fallbackBlob], newName, { type: outType, lastModified: Date.now() }));
                }, outType, quality);
              }, 'image/webp', COMPRESS_QUALITY);
            } catch (err) {
              resolve(file);
            }
          };
          img.onerror = function () { resolve(file); };
          img.src = e.target.result;
        };
        reader.onerror = function () { resolve(file); };
        reader.readAsDataURL(file);
      } catch (err) {
        resolve(file);
      }
    });
  }

  /**
   * Upload a File to Storage under media/products/<productId>/<unique-name>.
   * Returns { ok, path, url, error }.
   * path is the Storage object path (e.g. "products/<id>/<filename>").
   * url is the full public URL.
   */
  async function uploadProductImage(file, productId) {
    var client = getClient();
    if (!client) return { ok: false, error: 'Supabase client not available' };

    var err = validateFile(file);
    if (err) return { ok: false, error: err };

    // Compress before upload
    var compressed = await compressImage(file);

    var pid = productId || 'tmp_' + Date.now();
    var ext = (compressed.name.split('.').pop() || 'jpg').toLowerCase();
    var uniqueName = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    var path = 'products/' + pid + '/' + uniqueName;

    try {
      var uploadRes = await client.storage.from(BUCKET).upload(path, compressed, {
        cacheControl: '31536000',
        upsert: false
      });
      if (uploadRes.error) {
        console.error('[Storage] Upload error:', uploadRes.error);
        return { ok: false, error: uploadRes.error.message || 'Upload failed' };
      }
      var urlRes = client.storage.from(BUCKET).getPublicUrl(path);
      var url = urlRes && urlRes.data ? (urlRes.data.publicUrl || urlRes.data.url) : null;
      if (!url) return { ok: false, error: 'Failed to get public URL' };
      return { ok: true, path: path, url: url };
    } catch (e) {
      console.error('[Storage] Upload exception:', e);
      return { ok: false, error: (e && e.message) || 'Upload failed' };
    }
  }

  /**
   * Delete a Storage object by its path.
   * path should be the relative storage path (e.g. "products/<id>/<filename>").
   * Returns { ok, error }.
   */
  async function deleteFile(path) {
    var client = getClient();
    if (!client || !path) return { ok: false, error: 'Not available' };

    try {
      var res = await client.storage.from(BUCKET).remove([path]);
      if (res.error) {
        console.warn('[Storage] Delete error:', res.error);
        return { ok: false, error: res.error.message };
      }
      return { ok: true };
    } catch (e) {
      console.warn('[Storage] Delete exception:', e);
      return { ok: false, error: (e && e.message) || 'Delete failed' };
    }
  }

  /**
   * Resolve an image value to a displayable URL.
   * - Full HTTP/HTTPS URLs are returned as-is.
   * - Storage paths (e.g. "products/<id>/<file>") are resolved to public URLs.
   * - Falsy values return an empty string.
   */
  function resolveImageUrl(val) {
    if (!val || typeof val !== 'string') return '';
    var v = val.trim();
    if (!v) return '';
    if (v.indexOf('http://') === 0 || v.indexOf('https://') === 0) return v;
    // Storage path: resolve to public URL
    var client = getClient();
    if (client && client.storage) {
      try {
        var urlRes = client.storage.from(BUCKET).getPublicUrl(v);
        if (urlRes && urlRes.data) {
          return urlRes.data.publicUrl || urlRes.data.url || v;
        }
      } catch (e) {}
    }
    return '';
  }

  /**
   * Extract the Storage path from a full public URL.
   * Returns null if the URL is not a Storage URL for this project.
   * e.g. "https://...supabase.co/storage/v1/object/public/media/products/..." -> "products/..."
   */
  function extractStoragePath(url) {
    if (!url || typeof url !== 'string') return null;
    var marker = '/object/public/' + BUCKET + '/';
    var i = url.indexOf(marker);
    if (i === -1) return null;
    return url.substring(i + marker.length);
  }

  /**
   * Upload a settings/category image to Storage under media/<folder>/<unique-name>.
   * Returns { ok, url, error }.
   * Does NOT delete any previous image — caller must handle cleanup.
   */
  async function uploadSettingsImage(file, folder) {
    var client = getClient();
    if (!client) return { ok: false, error: 'Supabase client not available' };

    var err = validateFile(file);
    if (err) return { ok: false, error: err };

    var compressed = await compressImage(file);

    var dir = folder || 'settings';
    var ext = (compressed.name.split('.').pop() || 'jpg').toLowerCase();
    var uniqueName = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    var path = dir + '/' + uniqueName;

    try {
      var uploadRes = await client.storage.from(BUCKET).upload(path, compressed, {
        cacheControl: '31536000',
        upsert: false
      });
      if (uploadRes.error) {
        console.error('[Storage] Settings upload error:', uploadRes.error);
        return { ok: false, error: uploadRes.error.message || 'Upload failed' };
      }
      var urlRes = client.storage.from(BUCKET).getPublicUrl(path);
      var url = urlRes && urlRes.data ? (urlRes.data.publicUrl || urlRes.data.url) : null;
      if (!url) return { ok: false, error: 'Failed to get public URL' };
      return { ok: true, url: url };
    } catch (e) {
      console.error('[Storage] Settings upload exception:', e);
      return { ok: false, error: (e && e.message) || 'Upload failed' };
    }
  }

  window.SupabaseStorage = {
    BUCKET: BUCKET,
    validateFile: validateFile,
    compressImage: compressImage,
    uploadProductImage: uploadProductImage,
    uploadSettingsImage: uploadSettingsImage,
    deleteFile: deleteFile,
    resolveImageUrl: resolveImageUrl,
    extractStoragePath: extractStoragePath
  };
})();
