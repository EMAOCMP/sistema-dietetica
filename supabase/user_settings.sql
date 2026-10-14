-- ============================================
-- Tabla de configuración por usuario
-- Ejecutar en Supabase SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  daily_goal NUMERIC(12,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_select" ON user_settings;
CREATE POLICY "settings_select" ON user_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "settings_insert" ON user_settings;
CREATE POLICY "settings_insert" ON user_settings
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "settings_update" ON user_settings;
CREATE POLICY "settings_update" ON user_settings
  FOR UPDATE USING (true) WITH CHECK (true);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_settings_updated ON user_settings;
CREATE TRIGGER trg_user_settings_updated
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
