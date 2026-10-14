import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Faltan las variables de entorno de Supabase (SUPABASE_URL y SUPABASE_ANON_KEY). Asegúrate de configurarlas en tu archivo .env.local o en Vercel')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
