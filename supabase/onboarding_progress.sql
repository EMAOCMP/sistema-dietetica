-- ============================================
-- Progreso de onboarding por usuario
-- Ejecutar en Supabase SQL Editor
-- ============================================

-- Estado de onboarding (guías completadas, secciones vistas, tooltips vistos).
-- Sigue al usuario entre dispositivos: es la nube del "Centro de guías".
CREATE TABLE IF NOT EXISTS user_onboarding_progress (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  tour_done BOOLEAN NOT NULL DEFAULT false,
  completed_chapters TEXT[] NOT NULL DEFAULT '{}',
  seen_sections TEXT[] NOT NULL DEFAULT '{}',
  seen_tips TEXT[] NOT NULL DEFAULT '{}',
  visited_sections TEXT[] NOT NULL DEFAULT '{}',
  checklist_hidden BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_onboarding_progress ENABLE ROW LEVEL SECURITY;

-- Cada usuario solo puede leer y escribir su propia fila.
DROP POLICY IF EXISTS "onboarding_progress_select" ON user_onboarding_progress;
CREATE POLICY "onboarding_progress_select" ON user_onboarding_progress
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "onboarding_progress_insert" ON user_onboarding_progress;
CREATE POLICY "onboarding_progress_insert" ON user_onboarding_progress
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "onboarding_progress_update" ON user_onboarding_progress;
CREATE POLICY "onboarding_progress_update" ON user_onboarding_progress
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "onboarding_progress_delete" ON user_onboarding_progress;
CREATE POLICY "onboarding_progress_delete" ON user_onboarding_progress
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- Merge idempotente (unión) del progreso
-- ============================================
-- La app es offline-first: puede escribir un estado viejo (sin conexión) y
-- hacerlo después de otro dispositivo. Por eso el merge es por unión y nunca
-- pisa progreso existente.
--
-- p_reset = true sobrescribe la fila en lugar de unirla. Lo usa el botón
-- "Reiniciar progreso" del Centro de guías.
CREATE OR REPLACE FUNCTION merge_onboarding_progress(
  p_user_id UUID,
  p_tour_done BOOLEAN DEFAULT false,
  p_completed_chapters TEXT[] DEFAULT '{}',
  p_seen_sections TEXT[] DEFAULT '{}',
  p_seen_tips TEXT[] DEFAULT '{}',
  p_visited_sections TEXT[] DEFAULT '{}',
  p_checklist_hidden BOOLEAN DEFAULT false,
  p_reset BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_onboarding_progress AS t
    (user_id, tour_done, completed_chapters, seen_sections, seen_tips, visited_sections, checklist_hidden)
  VALUES (
    p_user_id,
    COALESCE(p_tour_done, false),
    COALESCE(p_completed_chapters, '{}'),
    COALESCE(p_seen_sections, '{}'),
    COALESCE(p_seen_tips, '{}'),
    COALESCE(p_visited_sections, '{}'),
    COALESCE(p_checklist_hidden, false)
  )
  ON CONFLICT (user_id) DO UPDATE SET
    tour_done = CASE
      WHEN p_reset THEN EXCLUDED.tour_done
      ELSE (t.tour_done OR EXCLUDED.tour_done)
    END,
    completed_chapters = CASE
      WHEN p_reset THEN EXCLUDED.completed_chapters
      ELSE (
        SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::TEXT[])
        FROM unnest(t.completed_chapters || EXCLUDED.completed_chapters) AS x
      )
    END,
    seen_sections = CASE
      WHEN p_reset THEN EXCLUDED.seen_sections
      ELSE (
        SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::TEXT[])
        FROM unnest(t.seen_sections || EXCLUDED.seen_sections) AS x
      )
    END,
    seen_tips = CASE
      WHEN p_reset THEN EXCLUDED.seen_tips
      ELSE (
        SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::TEXT[])
        FROM unnest(t.seen_tips || EXCLUDED.seen_tips) AS x
      )
    END,
    visited_sections = CASE
      WHEN p_reset THEN EXCLUDED.visited_sections
      ELSE (
        SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::TEXT[])
        FROM unnest(t.visited_sections || EXCLUDED.visited_sections) AS x
      )
    END,
    checklist_hidden = CASE
      WHEN p_reset THEN EXCLUDED.checklist_hidden
      ELSE (t.checklist_hidden OR EXCLUDED.checklist_hidden)
    END,
    updated_at = now();
END;
$$;

-- ============================================
-- Seed: copiar el progreso local de los usuarios existentes
-- ============================================
-- El progreso local vive en el navegador (localStorage). Esta función sirve
-- para volcarlo a la nube una vez, desde el navegador:
--   await supabase.rpc('merge_onboarding_progress', { p_user_id, ... })
-- No hay forma de leer el localStorage desde SQL, por eso el volcado lo hace
-- la app con merge_onboarding_progress (que ya es idempotente).
