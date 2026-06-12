/**
 * SystemRegistry — runtime registry for loaded SystemModules.
 *
 * Provides register/get/list and enforces uniqueness of system IDs.
 */
import type { SystemModule } from "./system-module.js";

export class DuplicateSystemIdError extends Error {
  constructor(id: string) {
    super(`A system with id "${id}" is already registered`);
    this.name = "DuplicateSystemIdError";
  }
}

export class SystemNotFoundError extends Error {
  constructor(id: string) {
    super(`System "${id}" is not registered`);
    this.name = "SystemNotFoundError";
  }
}

/**
 * Registry for loaded SystemModules.
 * Typically one instance exists per engine boot.
 */
export class SystemRegistry {
  private readonly _systems = new Map<string, SystemModule>();

  /**
   * Register a SystemModule.
   * Throws DuplicateSystemIdError if a system with the same id is already registered.
   */
  register(module: SystemModule): void {
    const { id } = module.manifest;
    if (this._systems.has(id)) {
      throw new DuplicateSystemIdError(id);
    }
    this._systems.set(id, module);
  }

  /**
   * Retrieve a registered system by id.
   * Throws SystemNotFoundError if not registered.
   */
  get(id: string): SystemModule {
    const module = this._systems.get(id);
    if (!module) throw new SystemNotFoundError(id);
    return module;
  }

  /**
   * Retrieve a registered system by id, or undefined if not found.
   */
  tryGet(id: string): SystemModule | undefined {
    return this._systems.get(id);
  }

  /**
   * List all registered system IDs.
   */
  list(): string[] {
    return [...this._systems.keys()];
  }

  /**
   * Check whether a system ID is registered.
   */
  has(id: string): boolean {
    return this._systems.has(id);
  }

  /**
   * Number of registered systems.
   */
  get size(): number {
    return this._systems.size;
  }
}
