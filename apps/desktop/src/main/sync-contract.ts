export interface SyncStatus {
  state: 'offline'|'syncing'|'online'|'error'|'auth-required';
  pending: number;
  message?: string;
}
export interface DesktopSync { status(): Promise<SyncStatus>; retry(): Promise<void> }
