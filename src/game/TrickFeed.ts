export class TrickFeed {
  private pieces: string[] = [];
  get list() { return this.pieces; }

  resetWithOllie() { this.pieces = ['Ollie']; }
  clear() { this.pieces.length = 0; }

  // Always append — allow consecutive duplicates to show live
  addUnique(name: string) {
    this.pieces.push(name);
  }
}
