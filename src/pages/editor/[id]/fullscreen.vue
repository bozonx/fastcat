<script setup lang="ts">
const route = useRoute();
const router = useRouter();

onMounted(async () => {
  const projectId = route.params.id as string;
  if (!projectId) {
    await router.push('/');
    return;
  }

  await router.replace(`/editor/${encodeURIComponent(projectId)}`);
});
</script>

<template>
  <div class="hidden" />
</template>
