// Cliente global de Supabase usando la CDN
(function () {
  if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    console.error("[supabaseClient] Falta la CDN o los valores de config.");
    return;
  }
  window.supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  console.log("[supabaseClient] listo");
})();
