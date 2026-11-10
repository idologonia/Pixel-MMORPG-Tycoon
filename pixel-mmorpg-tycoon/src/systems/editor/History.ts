import type { RpgConfig } from '@/models/rpg';
import type { EntityChange } from '@/simulation/EntityStore';
import type { TileGrid } from '@/models/TileGrid';
import type { WorldRuntime } from '@/simulation/WorldRuntime';

/** A reversible editor operation. New editor features add new command kinds. */
export interface EditorCommand {
  label: string;
  undo(world: WorldRuntime): void;
  redo(world: WorldRuntime): void;
}

/** Tile paint: stores only changed tiles (index, before, after). */
export class TileEditCommand implements EditorCommand {
  constructor(
    readonly label: string,
    private indices: Uint32Array,
    private before: Uint8Array,
    private after: Uint8Array,
  ) {}
  get size(): number {
    return this.indices.length;
  }
  undo(world: WorldRuntime): void {
    world.setTiles(this.indices, this.before);
  }
  redo(world: WorldRuntime): void {
    world.setTiles(this.indices, this.after);
  }
}

/** Zone painting (one stroke = one undo step). */
export class ZoneEditCommand implements EditorCommand {
  constructor(readonly label: string, private indices: Uint32Array, private before: Uint8Array, private after: Uint8Array) {}
  get size(): number {
    return this.indices.length;
  }
  undo(world: WorldRuntime): void {
    world.setZones(this.indices, this.before);
  }
  redo(world: WorldRuntime): void {
    world.setZones(this.indices, this.after);
  }
}

/** Whole-map replacement (resize, regenerate). */
export class ReplaceMapCommand implements EditorCommand {
  constructor(readonly label: string, private before: TileGrid, private after: TileGrid) {}
  undo(world: WorldRuntime): void {
    world.replaceGrid(this.before.clone());
  }
  redo(world: WorldRuntime): void {
    world.replaceGrid(this.after.clone());
  }
}

export class History {
  private undoStack: EditorCommand[] = [];
  private redoStack: EditorCommand[] = [];
  constructor(private limit = 200, private onChange?: () => void) {}

  push(cmd: EditorCommand): void {
    const last = this.undoStack[this.undoStack.length - 1];
    if ((last instanceof EntityCommand && cmd instanceof EntityCommand && last.absorb(cmd)) || (last instanceof RpgCommand && cmd instanceof RpgCommand && last.absorb(cmd))) {
      this.redoStack.length = 0;
      this.onChange?.();
      return;
    }
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange?.();
  }

  undo(world: WorldRuntime): string | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo(world);
    this.redoStack.push(cmd);
    this.onChange?.();
    return cmd.label;
  }

  redo(world: WorldRuntime): string | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.redo(world);
    this.undoStack.push(cmd);
    this.onChange?.();
    return cmd.label;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange?.();
  }
}


/** Any set of entity creations/updates/deletions. Consecutive edits with the same mergeKey collapse into one step. */
export class EntityCommand implements EditorCommand {
  /** Budget hook so undo refunds / redo charges in standard mode. */
  static budget: { apply(changes: EntityChange[], mode: 'forward' | 'backward' | 'undo'): void } | null = null;
  at = Date.now();
  constructor(readonly label: string, public changes: EntityChange[], readonly mergeKey?: string) {}
  undo(world: WorldRuntime): void {
    world.entities.applyChanges(this.changes, 'backward');
    EntityCommand.budget?.apply(this.changes, 'undo');
  }
  redo(world: WorldRuntime): void {
    world.entities.applyChanges(this.changes, 'forward');
    EntityCommand.budget?.apply(this.changes, 'forward');
  }
  /** Fold a newer edit of the same thing into this command (keeps the oldest `before`). */
  absorb(next: EntityCommand): boolean {
    if (!this.mergeKey || this.mergeKey !== next.mergeKey || next.at - this.at > 1500) return false;
    for (const c of next.changes) {
      const mine = this.changes.find((m) => m.col === c.col && m.id === c.id);
      if (mine) mine.after = c.after;
      else this.changes.push(c);
    }
    this.at = next.at;
    return true;
  }
}

/** Several commands applied/undone as one step (e.g. populate = terrain + objects + NPCs). */
export class CompositeCommand implements EditorCommand {
  constructor(readonly label: string, private parts: EditorCommand[]) {}
  undo(world: WorldRuntime): void {
    for (let i = this.parts.length - 1; i >= 0; i--) this.parts[i].undo(world);
  }
  redo(world: WorldRuntime): void {
    for (const p of this.parts) p.redo(world);
  }
}

/** Economy / progression rule edits. Consecutive edits with the same mergeKey collapse into one step. */
export class RpgCommand implements EditorCommand {
  at = Date.now();
  constructor(readonly label: string, private before: RpgConfig, public after: RpgConfig, readonly mergeKey?: string) {}
  undo(world: WorldRuntime): void {
    world.rpg = structuredClone(this.before);
    world.events.emit('rpg:changed', undefined);
    world.markDirty();
  }
  redo(world: WorldRuntime): void {
    world.rpg = structuredClone(this.after);
    world.events.emit('rpg:changed', undefined);
    world.markDirty();
  }
  absorb(next: RpgCommand): boolean {
    if (!this.mergeKey || this.mergeKey !== next.mergeKey || next.at - this.at > 1500) return false;
    this.after = next.after;
    this.at = next.at;
    return true;
  }
}
