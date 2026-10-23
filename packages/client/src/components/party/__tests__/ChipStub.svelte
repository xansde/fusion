<script lang="ts">
  let { name = "" }: { name?: string } = $props();
</script>

<div data-testid="chip-stub">{name}</div>
