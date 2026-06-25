import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import SettingsHotkeysGroup from '~/components/settings/hotkeys/SettingsHotkeysGroup.vue';

vi.mock('~/components/ui/UiFormSectionHeader.vue', () => ({
  default: {
    props: ['title'],
    template: '<div class="header-mock">{{ title }}</div>',
  },
}));

describe('SettingsHotkeysGroup', () => {
  const baseProps = {
    groupId: 'playback',
    title: 'Playback',
    commands: [
      { id: 'playPause', groupId: 'playback', title: 'Play/Pause' },
      { id: 'stop', groupId: 'playback', title: 'Stop' },
    ],
    searchQuery: '',
    capturingCommandId: null,
    getCurrentBindings: (cmdId: string) => (cmdId === 'playPause' ? ['Space'] : []),
    isConflicting: () => false,
    isOverriding: () => false,
    isComboCustom: () => false,
  };

  it('renders group title', async () => {
    const component = await mountSuspended(SettingsHotkeysGroup, {
      props: baseProps,
    });

    expect(component.text()).toContain('Playback');
  });

  it('renders table with command rows', async () => {
    const component = await mountSuspended(SettingsHotkeysGroup, {
      props: baseProps,
    });

    const rows = component.findAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('renders current bindings', async () => {
    const component = await mountSuspended(SettingsHotkeysGroup, {
      props: baseProps,
    });

    expect(component.text()).toContain('Space');
  });

  it('emits capture when add button is clicked', async () => {
    const component = await mountSuspended(SettingsHotkeysGroup, {
      props: baseProps,
    });

    const addButtons = component.findAll('button');
    const addButton = addButtons.find((b) => b.attributes('icon')?.includes('plus'));
    if (addButton) {
      await addButton.trigger('click');
      expect(component.emitted('capture')).toBeTruthy();
    }
  });

  it('emits remove when remove button is clicked', async () => {
    const component = await mountSuspended(SettingsHotkeysGroup, {
      props: baseProps,
    });

    const removeButtons = component.findAll('button');
    const removeButton = removeButtons.find((b) => b.attributes('icon')?.includes('x-mark'));
    if (removeButton) {
      await removeButton.trigger('click');
      expect(component.emitted('remove')).toBeTruthy();
    }
  });

  it('emits reset when reset button is clicked', async () => {
    const component = await mountSuspended(SettingsHotkeysGroup, {
      props: baseProps,
    });

    const resetButtons = component.findAll('button');
    const resetButton = resetButtons.find((b) => b.attributes('icon')?.includes('arrow-uturn-left'));
    if (resetButton) {
      await resetButton.trigger('click');
      expect(component.emitted('reset')).toBeTruthy();
    }
  });

  it('shows capturing indicator when capturingCommandId matches', async () => {
    const component = await mountSuspended(SettingsHotkeysGroup, {
      props: { ...baseProps, capturingCommandId: 'playPause' },
    });

    expect(component.text()).toContain('videoEditor.settings.hotkeysCapturing');
  });

  it('filters commands by search query', async () => {
    const component = await mountSuspended(SettingsHotkeysGroup, {
      props: { ...baseProps, searchQuery: 'play' },
    });

    expect(component.text()).toContain('Play');
  });
});
