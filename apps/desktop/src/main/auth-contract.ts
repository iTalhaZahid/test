export interface LocalUser { id: string; username: string; displayName: string; role: 'superuser' | 'admin' | 'cashier'; manageCreditsExpenses?: boolean; shopId?: string }
export type LoginResult = { ok: true; user: LocalUser } | { ok: false; message: string };
export interface AuthState { user: LocalUser | null; demo: boolean }
export interface DesktopAuth {
  state(): Promise<AuthState>;
  login(username: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}
