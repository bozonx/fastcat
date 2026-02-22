import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import App from '../src/app.vue'

describe('App Smoke Test', () => {
  it('can mount the app root component', async () => {
    const component = await mountSuspended(App)
    expect(component.exists()).toBe(true)
  })
})
