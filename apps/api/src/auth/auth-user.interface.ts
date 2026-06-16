/** The authenticated principal attached to a request by SupabaseAuthGuard. */
export interface AuthUser {
  id: string;
  email?: string;
}
