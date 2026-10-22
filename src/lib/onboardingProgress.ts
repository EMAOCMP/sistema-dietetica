import { supabase } from './supabase';
import type { OnboardingProgress } from '../features/onboarding/progressStore';

/**
 * Persistencia en la nube del progreso de onboarding.
 *
 * El merge se delega en la función `merge_onboarding_progress` (unión por
 * servidor) para que un write offline viejo nunca pise progreso más nuevo.
 */

/** Lee el progreso del usuario en Supabase. Devuelve null si no hay fila o falla. */
export async function fetchRemoteProgress(userId: string): Promise<OnboardingProgress | null> {
  try {
    const { data, error } = await supabase
      .from('user_onboarding_progress')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.warn('[onboarding] No se pudo leer el progreso remoto:', error.message);
      return null;
    }
    if (!data) return null;

    return {
      tourDone: data.tour_done === true,
      chapters: Array.isArray(data.completed_chapters) ? data.completed_chapters : [],
      sections: Array.isArray(data.seen_sections) ? data.seen_sections : [],
      tips: Array.isArray(data.seen_tips) ? data.seen_tips : [],
      visited: Array.isArray(data.visited_sections) ? data.visited_sections : [],
      checklistHidden: data.checklist_hidden === true,
    };
  } catch (err: any) {
    console.warn('[onboarding] Error leyendo el progreso remoto:', err?.message || err);
    return null;
  }
}

/**
 * Sube el progreso local. El merge en servidor es idempotente y por unión,
 * así que se puede llamar en cada cambio sin riesgo de perder progreso.
 *
 * `reset = true` sobrescribe la fila en vez de unirla (botón "Reiniciar
 * progreso"): el siguiente push manda el estado local tal cual.
 * Devuelve true si la nube quedó actualizada.
 */
export async function pushRemoteProgress(
  userId: string,
  progress: OnboardingProgress,
  reset = false,
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('merge_onboarding_progress', {
      p_user_id: userId,
      p_tour_done: progress.tourDone,
      p_completed_chapters: progress.chapters,
      p_seen_sections: progress.sections,
      p_seen_tips: progress.tips,
      p_visited_sections: progress.visited,
      p_checklist_hidden: progress.checklistHidden,
      p_reset: reset,
    });

    if (error) {
      console.warn('[onboarding] No se pudo guardar el progreso remoto:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[onboarding] Error guardando el progreso remoto:', err?.message || err);
    return false;
  }
}
