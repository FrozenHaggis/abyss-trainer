/**
 * Types for `three-m2loader`, which ships none.
 *
 * Only the surface this app touches, and deliberately no more. A fuller
 * transcription of the package would be a second copy of somebody else's API
 * kept in sync by hand; this is a contract for the five calls the barrel makes,
 * so an upgrade that changes one of them fails the typecheck instead of the
 * browser.
 */
declare module 'three-m2loader' {
  import { Group, Loader, LoadingManager } from 'three'

  /** One animation the model carries, as listed by the sequence manager. */
  export interface M2Sequence {
    id: number
    name: string
    variationIndex?: number
  }

  /**
   * Playback for a model's own animations.
   *
   * Reached through `group.userData.sequenceManager` rather than returned, and
   * it does not drive itself: `update(delta)` has to be called every frame the
   * model is meant to be moving.
   */
  export interface SequenceManager {
    listSequences(): M2Sequence[]
    listVariations(id: number): number[]
    playSequence(id: number, variationIndex?: number): void
    stopSequence(id: number, variationIndex?: number): void
    playGlobalSequences(): void
    update(delta: number): void
  }

  /**
   * Per-load overrides. The only one that matters here is `setSkin`, which
   * fills the creature texture slots a model leaves blank for
   * CreatureDisplayInfo — without it those models refuse to load at all.
   */
  export class M2Options {
    setSkin(id1?: number | null, id2?: number | null, id3?: number | null): this
  }

  export class M2Loader extends Loader {
    constructor(manager?: LoadingManager)
    load(
      url: string,
      onLoad: (group: Group) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (err: unknown) => void,
      options?: M2Options,
    ): void
    /** Note the argument order: options is third, where `load` has it fifth. */
    loadAsync(
      url: string,
      onProgress?: (event: ProgressEvent) => void,
      options?: M2Options,
    ): Promise<Group>
  }
}
