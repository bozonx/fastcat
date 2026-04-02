/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import type { AppNotificationService } from '~/services/app-notification.service';
import type { I18nService } from '~/services/i18n.service';

describe('Services Interfaces', () => {
  it('defines AppNotificationService correctly', () => {
    const mockService: AppNotificationService = {
      add: vi.fn(),
    };

    mockService.add({
      title: 'Test',
      description: 'Desc',
      color: 'success',
      actions: [{ label: 'Action', onClick: () => {} }],
    });

    expect(mockService.add).toHaveBeenCalled();
  });

  it('defines I18nService correctly', () => {
    const mockService: I18nService = {
      t: vi.fn().mockReturnValue('translated'),
    };

    const result = mockService.t('key', { param: 'value' });

    expect(result).toBe('translated');
    expect(mockService.t).toHaveBeenCalledWith('key', { param: 'value' });
  });
});
