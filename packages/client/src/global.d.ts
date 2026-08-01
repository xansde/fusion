/**
 * Ambient module declarations for packages without type definitions.
 */

declare module "@3d-dice/dice-box" {
  interface DiceBoxOptions {
    assetPath?: string;
    theme?: string;
    gravity?: number;
    [key: string]: unknown;
  }

  interface DiceNotation {
    notation: string;
    results?: number[];
    [key: string]: unknown;
  }

  class DiceBox {
    constructor(container: string, options?: DiceBoxOptions);
    init(): Promise<void>;
    roll(notation: DiceNotation[] | string): Promise<unknown>;
    clear(): void;
    hide(): void;
    show(): void;
    [key: string]: unknown;
  }

  export default DiceBox;
}
