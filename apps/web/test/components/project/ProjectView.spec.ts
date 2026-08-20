import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import ProjectView from '~/components/project/ProjectView.vue';
import { ref, defineComponent } from 'vue';

const mockFocusStore = {
  isPanelFocused: vi.fn(() => false),
  setPanelFocus: vi.fn(),
};

const mockActiveStaticComponent = ref<any>(null);
const mockActiveFileTab = ref<any>(null);
const mockActivateProjectFocus = vi.fn();

vi.mock('~/stores/focus.store', () => ({
  useFocusStore: () => mockFocusStore,
}));

vi.mock('~/composables/project/useProjectTabs', () => ({
  useProjectTabs: () => ({
    activateProjectFocus: mockActivateProjectFocus,
    activeFileTab: mockActiveFileTab,
    activeStaticComponent: mockActiveStaticComponent,
  }),
}));

vi.mock('~/components/project/ProjectTabBar.vue', () => ({
  default: {
    name: 'ProjectTabBar',
    template: '<div class="mock-tab-bar">Mock Tab Bar</div>',
  },
}));

vi.mock('~/components/project/ProjectTabFileViewer.vue', () => ({
  default: {
    name: 'ProjectTabFileViewer',
    props: ['filePath', 'fileName', 'mediaType'],
    template: '<div class="mock-file-viewer">File: {{ fileName }}</div>',
  },
}));

const MockStaticComponent = defineComponent({
  name: 'MockStaticComponent',
  props: ['compact'],
  template: '<div class="mock-static">Static Component (Compact: {{ compact }})</div>',
});

describe('ProjectView.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveStaticComponent.value = null;
    mockActiveFileTab.value = null;
    mockFocusStore.isPanelFocused.mockReturnValue(false);
  });

  it('renders correctly with default state', async () => {
    const component = await mountWithNuxt(ProjectView);

    expect(component.exists()).toBe(true);
    expect(component.find('.mock-tab-bar').exists()).toBe(true);
    expect(component.classes()).not.toContain('panel-focus-frame--active');
  });

  it('adds active class when panel is focused', async () => {
    mockFocusStore.isPanelFocused.mockReturnValue(true);

    const component = await mountWithNuxt(ProjectView);

    expect(component.classes()).toContain('panel-focus-frame--active');
  });

  it('renders static component when activeStaticComponent is set', async () => {
    mockActiveStaticComponent.value = MockStaticComponent;

    const component = await mountWithNuxt(ProjectView, {
      props: {
        compact: true,
      },
    });

    expect(component.find('.mock-static').exists()).toBe(true);
    expect(component.text()).toContain('Static Component (Compact: true)');
    expect(component.find('.mock-file-viewer').exists()).toBe(false);
  });

  it('renders file viewer when activeFileTab is set', async () => {
    mockActiveFileTab.value = {
      filePath: 'media/test.mp4',
      fileName: 'test.mp4',
      mediaType: 'video',
    };

    const component = await mountWithNuxt(ProjectView);

    expect(component.find('.mock-file-viewer').exists()).toBe(true);
    expect(component.text()).toContain('File: test.mp4');
    expect(component.find('.mock-static').exists()).toBe(false);
  });
});
