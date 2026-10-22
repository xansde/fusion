/**
 * registerCoreChatCardExtensions.ts — CORE-owned chat card extensions
 * (ALQ-F1-10).
 *
 * `chatCardExtensionRegistry.svelte.ts` was built for a SYSTEM to plug its
 * own card in (`registerPf2eSheets.ts`'s `abilityCardExtension` — see that
 * module's header). `flags.fusion.damageApplied` is different: it is a
 * CORE-level shape (DF-02, `ActorMechanicsService`'s own summary broadcast),
 * so CORE registers its own extension here, the same way
 * `registerCoreTabs.ts` registers the core sidebar tabs through the same
 * public door a mod would use (DEC-GAV-07) instead of an `{#if}` baked into
 * `ChatMessage.svelte`.
 *
 * Called once from `TableScreen.svelte`, synchronously, right alongside
 * `registerCoreSidebarTabs()` — see that call site's comment on why a
 * remount is harmless. This module adds its OWN idempotency guard (a module
 * flag) because `chatCardExtensionRegistry` itself has no per-extension id
 * to dedupe by, unlike the sidebar-tab registry.
 */

import {
  registerChatCardExtension,
  type ChatCardExtension,
} from "./chatCardExtensionRegistry.svelte.js";
import { recognizeDamageApplied } from "./damageAppliedDisplay.js";
import DamageAppliedCard from "../../components/chat/DamageAppliedCard.svelte";

let registered = false;

/** Register every CORE chat card extension. Idempotent — a remount (or a
 * second seat mounting TableScreen in the same session) is harmless. */
export function registerCoreChatCardExtensions(): void {
  if (registered) return;
  registered = true;

  const damageAppliedExtension: ChatCardExtension = {
    recognize: recognizeDamageApplied,
    component: DamageAppliedCard,
  };
  registerChatCardExtension(damageAppliedExtension);
}

/** Test-only: lets a test re-arm the guard after `resetChatCardExtensions()`. */
export function resetCoreChatCardExtensionsGuard(): void {
  registered = false;
}
