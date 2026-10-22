/**
 * SoundPanel.test.ts — what each seat sees in the Som tab.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "svelte/server";
import SoundPanel from "../SoundPanel.svelte";
import { soundStore } from "../../../lib/sound/soundStore.svelte.js";
import { soundUnlockBadge } from "../../../lib/sound/soundBadge.js";
import "../../../lib/i18n/index.js";

const props = (isGm: boolean) => ({
  socket: {} as never,
  worldId: "w",
  userId: "u",
  isGm,
  activeSceneId: null,
});

beforeEach(() => {
  soundStore.track = { src: "tavern.ogg", startedAt: 1 };
  soundStore.unlocked = true;
  soundStore.volume = 0.5;
});

describe("SoundPanel", () => {
  it("shows a player what is playing and the local volume, with no GM controls", () => {
    const html = render(SoundPanel, { props: props(false) }).body;
    expect(html).toContain("tavern.ogg");
    expect(html).toContain("50%");
    expect(html).not.toContain("Parar");
    expect(html).not.toContain("Escolher faixa");
  });

  it("gives the GM the choose / stop controls", () => {
    const html = render(SoundPanel, { props: props(true) }).body;
    expect(html).toContain("Escolher faixa");
    expect(html).toContain("Parar");
  });

  it("shows the clickable enable-sound notice only while blocked with a track on", () => {
    expect(render(SoundPanel, { props: props(false) }).body).not.toContain("sound-unlock");
    soundStore.unlocked = false;
    const html = render(SoundPanel, { props: props(false) }).body;
    expect(html).toContain('data-testid="sound-unlock"');
    expect(html).toContain("Clique para ativar o som");
    expect(soundUnlockBadge.value).toBe(true);
    soundStore.track = null;
    expect(soundUnlockBadge.value).toBe(false);
  });
});
