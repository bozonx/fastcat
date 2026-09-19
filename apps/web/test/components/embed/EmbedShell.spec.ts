import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EmbedShell from '~/components/embed/EmbedShell.vue';
import { DEFAULT_TIMELINE_FORMAT } from '~/timeline/format';
import { setEmbedFeatures } from '~/utils/embed-features';
import { embedDialog } from '~/utils/embed/embed-export';

const session = vi.hoisted(() => ({
  startExport: vi.fn(),
  requestClose: vi.fn(),
  requestResize: vi.fn(),
  start: vi.fn(),
}));

const layout = vi.hoisted(() => ({ mode: 'desktop' as 'desktop' | 'mobile' }));

vi.mock('~/composables/embed/useEmbedSession', async () => {
  const { ref, computed } = await import('vue');
  const phase = ref('ready');
  const isIngesting = ref(false);
  (globalThis as Record<string, unknown>).__embedSessionState = { phase, isIngesting };
  return {
    useEmbedSession: () => ({
      ...session,
      phase,
      isIngesting,
      errorMessage: ref(null),
      layoutPreference: ref('auto'),
      canExport: computed(() => phase.value === 'ready'),
    }),
  };
});

const projectStore = reactive({ currentView: 'cut', setView: vi.fn() });
const timelineStore = reactive({
  timelineFormat: { ...DEFAULT_TIMELINE_FORMAT },
  timelineDoc: { tracks: [] as { items: { kind: string }[] }[] },
});
const workspaceStore = reactive({ inDevelopmentFeaturesEnabled: false });

vi.mock('~/stores/project.store', () => ({ useProjectStore: () => projectStore }));
vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => timelineStore }));
vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => workspaceStore }));

vi.mock('~/components/editor/EditorRoot.vue', () => ({
  default: defineComponent({
    name: 'EditorRoot',
    props: ['layout', 'mobileTabs', 'showMobileNav', 'navMode', 'embedded'],
    setup(_, { expose }) {
      expose({ mode: computed(() => layout.mode), toggle: vi.fn() });
      return {};
    },
    template: '<div data-testid="editor-root" />',
  }),
}));

vi.mock('~/components/embed/EmbedFormatDialog.vue', () => ({
  default: defineComponent({
    name: 'EmbedFormatDialog',
    props: ['open', 'purpose'],
    emits: ['update:open', 'applied'],
    template: '<div v-if="open" data-testid="format-dialog" :data-purpose="purpose" />',
  }),
}));

vi.mock('~/components/embed/EmbedExportDialog.vue', () => ({
  default: defineComponent({
    name: 'EmbedExportDialog',
    props: ['open', 'isExporting'],
    template: '<div v-if="open" data-testid="export-dialog" />',
  }),
}));

function sessionState() {
  return (globalThis as Record<string, unknown>).__embedSessionState as {
    phase: { value: string };
    isIngesting: { value: boolean };
  };
}

const resolvedFormat = {
  ...DEFAULT_TIMELINE_FORMAT,
  width: 1080,
  height: 1920,
  fps: 30,
  geometryResolved: true,
  settingsSource: 'firstClip' as const,
};

async function mountShell() {
  const wrapper = await mountSuspended(EmbedShell);
  // The toolbar reads the layout off the editor root's ref, set after mount.
  await nextTick();
  return wrapper;
}

describe('EmbedShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    layout.mode = 'desktop';
    projectStore.currentView = 'cut';
    timelineStore.timelineFormat = { ...resolvedFormat };
    timelineStore.timelineDoc = { tracks: [] };
    workspaceStore.inDevelopmentFeaturesEnabled = false;
    sessionState().phase.value = 'ready';
    sessionState().isIngesting.value = false;
    embedDialog.value = null;
    setEmbedFeatures(undefined);
  });

  afterEach(() => {
    embedDialog.value = null;
  });

  it('offers no view switcher when the timeline is the only view', async () => {
    const wrapper = await mountShell();

    expect(wrapper.find('[data-testid="embed-view-cut"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="embed-view-export"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="embed-export"]').exists()).toBe(true);
  });

  it('switches between the views the host enabled, never to an export view', async () => {
    setEmbedFeatures(['export', 'sound']);
    const wrapper = await mountShell();

    expect(wrapper.find('[data-testid="embed-view-cut"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="embed-view-sound"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="embed-view-export"]').exists()).toBe(false);

    await wrapper.find('[data-testid="embed-view-sound"]').trigger('click');
    expect(projectStore.setView).toHaveBeenCalledWith('sound');
  });

  it('hides the bottom bar of the touch shell and switches its views from the toolbar', async () => {
    layout.mode = 'mobile';
    setEmbedFeatures(['export', 'sound', 'settings']);
    const wrapper = await mountShell();

    expect(wrapper.findComponent({ name: 'EditorRoot' }).props('showMobileNav')).toBe(false);
    // The touch shell has no sound view.
    expect(wrapper.find('[data-testid="embed-view-sound"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="embed-view-settings"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'EditorRoot' }).props('mobileTabs')).toEqual([
      'edit',
      'settings',
    ]);
  });

  it('exports straight away once the format is known', async () => {
    const wrapper = await mountShell();

    await wrapper.find('[data-testid="embed-export"]').trigger('click');

    expect(session.startExport).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="format-dialog"]').exists()).toBe(false);
  });

  it('asks for the format before rendering one nobody chose', async () => {
    timelineStore.timelineFormat = { ...DEFAULT_TIMELINE_FORMAT };
    const wrapper = await mountShell();

    await wrapper.find('[data-testid="embed-export"]').trigger('click');

    expect(session.startExport).not.toHaveBeenCalled();
    const dialog = wrapper.find('[data-testid="format-dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes('data-purpose')).toBe('export');

    await wrapper.findComponent({ name: 'EmbedFormatDialog' }).vm.$emit('applied');
    expect(session.startExport).toHaveBeenCalledTimes(1);
  });

  it('asks for the format once the media settles without deciding it', async () => {
    timelineStore.timelineFormat = { ...DEFAULT_TIMELINE_FORMAT };
    sessionState().isIngesting.value = true;
    const wrapper = await mountShell();
    expect(wrapper.find('[data-testid="format-dialog"]').exists()).toBe(false);

    timelineStore.timelineDoc = { tracks: [{ items: [{ kind: 'clip' }] }] };
    sessionState().isIngesting.value = false;
    await nextTick();
    await nextTick();

    const dialog = wrapper.find('[data-testid="format-dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes('data-purpose')).toBe('edit');
  });

  it('shows the format and where it came from', async () => {
    const wrapper = await mountShell();

    const badge = wrapper.find('[data-testid="embed-format"]');
    expect(badge.attributes('data-source')).toBe('firstClip');
    expect(badge.text()).toContain('1080×1920');
  });

  it('keeps the layout switch to development builds', async () => {
    const production = await mountShell();
    expect(production.find('[data-testid="embed-toggle-layout"]').exists()).toBe(false);

    workspaceStore.inDevelopmentFeaturesEnabled = true;
    const development = await mountShell();
    expect(development.find('[data-testid="embed-toggle-layout"]').exists()).toBe(true);
  });

  it('asks the host to close', async () => {
    const wrapper = await mountShell();

    await wrapper.find('[data-testid="embed-close"]').trigger('click');

    expect(session.requestClose).toHaveBeenCalledTimes(1);
  });
});
