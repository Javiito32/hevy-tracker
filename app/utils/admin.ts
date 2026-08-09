/**
 * Shapes shared between the admin page and the cards it composes.
 *
 * `<script setup>` cannot export, so a type used by both the page and a child
 * component has to live outside the SFC — the same reason `Verdict` sits in
 * `theme.ts` rather than in `UiBadge`.
 */

/** A row of `GET /api/admin/users`. */
export interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  is_active: boolean
  last_login_at: string | null
  last_ai_use_at: string | null
  tokens_used: number
  input_tokens: number
  output_tokens: number
  ai_cost: number
  _count: { workouts: number; mesocycles: number; conversations: number }
}
