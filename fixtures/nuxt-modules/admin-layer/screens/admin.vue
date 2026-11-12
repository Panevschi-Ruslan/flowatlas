<template>
  <main>
    <button @click="showReport">Report</button>
  </main>
</template>

<script setup lang="ts">
const { fetchReport } = useReports();

const showReport = async (): Promise<void> => {
  await fetchReport();
};
</script>
