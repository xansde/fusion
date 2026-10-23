<script lang="ts">
  let { name = "" }: { name?: string } = $props();
</script>

<div data-testid="summary-stub">{name}</div>
