export interface AppNotificationAction {
  label: string;
  onClick: () => void;
}

export interface AppNotification {
  title: string;
  description?: string;
  color?: 'success' | 'warning' | 'error' | 'info';
  actions?: AppNotificationAction[];
}

export interface AppNotificationService {
  add(notification: AppNotification): void;
}
