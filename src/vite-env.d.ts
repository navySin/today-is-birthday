interface ImportMetaEnv {
  readonly VITE_HALL_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_PICKLIKE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
