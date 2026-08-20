import { defineNuxtPlugin } from 'nuxt/app';
import { initEffects } from '~/effects';

export default defineNuxtPlugin(() => {
  initEffects();
});
