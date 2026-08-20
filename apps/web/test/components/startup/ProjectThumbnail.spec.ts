import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ProjectThumbnail from '~/components/startup/ProjectThumbnail.vue';

// Mock the file thumbnail generator
const mockAddTask = vi.fn();
vi.mock('~/utils/file-thumbnail-generator', () => ({
  getFileThumbnailHash: vi.fn(() => 'mock-hash'),
  fileThumbnailGenerator: {
    addTask: (options: any) => {
      mockAddTask(options);
      // Automatically trigger completion for testing the image render
      options.onComplete('blob:http://localhost/mock-thumbnail');
    },
  },
}));

describe('ProjectThumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders placeholder when details are missing', async () => {
    const component = await mountSuspended(ProjectThumbnail, {
      props: {
        projectId: undefined,
        projectRelativePath: undefined,
      },
      global: {
        stubs: {
          UIcon: {
            props: ['name'],
            template: '<i :class="name"></i>',
          },
        },
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.find('img').exists()).toBe(false);
    expect(component.find('.i-heroicons-film').exists()).toBe(true);
  });

  it('calls fileThumbnailGenerator when props are provided', async () => {
    const component = await mountSuspended(ProjectThumbnail, {
      props: {
        projectId: 'project-1',
        projectRelativePath: 'timeline.json',
      },
      global: {
        stubs: {
          UIcon: true,
        },
      },
    });

    expect(mockAddTask).toHaveBeenCalled();
    const img = component.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('blob:http://localhost/mock-thumbnail');
  });

  it('uses object-contain class for desktop variant by default', async () => {
    const component = await mountSuspended(ProjectThumbnail, {
      props: {
        projectId: 'project-1',
        projectRelativePath: 'timeline.json',
      },
      global: {
        stubs: {
          UIcon: true,
        },
      },
    });

    const img = component.find('img');
    expect(img.classes()).toContain('object-contain');
    expect(img.classes()).not.toContain('object-cover');
  });

  it('uses object-cover class for mobile variant', async () => {
    const component = await mountSuspended(ProjectThumbnail, {
      props: {
        projectId: 'project-1',
        projectRelativePath: 'timeline.json',
        variant: 'mobile',
      },
      global: {
        stubs: {
          UIcon: true,
        },
      },
    });

    const img = component.find('img');
    expect(img.classes()).toContain('object-cover');
    expect(img.classes()).not.toContain('object-contain');
  });
});
