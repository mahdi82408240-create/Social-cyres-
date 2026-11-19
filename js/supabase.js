// راه‌اندازی امن Supabase در مرورگر.
// فقط URL و کلید عمومی anon/publishable مجاز است؛ service_role هرگز در فرانت‌اند قرار نگیرد.
(() => {
  const config = window.SOCIAL_CYRUS_CONFIG || {};
  const ready = Boolean(
    window.supabase &&
    config.supabaseUrl && !config.supabaseUrl.startsWith("YOUR_") &&
    config.supabaseAnonKey && !config.supabaseAnonKey.startsWith("YOUR_")
  );

  window.cyrusSupabase = ready
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      })
    : null;

  window.CYRUS_DB_READY = Boolean(window.cyrusSupabase);
})();
