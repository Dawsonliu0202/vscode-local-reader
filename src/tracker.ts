import { randomUUID } from 'node:crypto';
import { Book, localDate, Position, Session } from './model';

export interface Clock { wall(): number; mono(): number }
const realClock: Clock = { wall: () => Date.now(), mono: () => performance.now() };
export class Tracker {
  session?: Session;
  private lastMono = 0; private lastWall = 0; private lastInput = 0;
  private visible = false; private focused = false;
  readonly owner = randomUUID();
  constructor(private readonly clock: Clock = realClock) {}
  start(book: Book) {
    this.lastMono = this.clock.mono(); this.lastWall = this.clock.wall(); this.lastInput = this.lastMono;
    this.session = { id: randomUUID(), owner: this.owner, bookId: book.id, startedAt: this.lastWall, checkpointAt: this.lastWall,
      startPosition: { ...book.position }, endPosition: { ...book.position }, days: {} };
  }
  setVisible(visible: boolean) { this.tick(); this.visible = visible; }
  setFocused(focused: boolean) { this.tick(); this.focused = focused; }
  activity() { this.tick(); this.lastInput = this.clock.mono(); }
  position(position: Position) { if (this.session) this.session.endPosition = { ...position }; }
  tick() {
    const mono = this.clock.mono(), wall = this.clock.wall();
    const gap = mono - this.lastMono; const wallGap = wall - this.lastWall;
    // A normal tick runs every second. Long gaps signal suspend/blocking: do not invent reading time.
    if (this.session && this.visible && this.focused && gap >= 0 && gap <= 5000 && Math.abs(wallGap - gap) < 5000) {
      const ms = Math.max(0, Math.min(mono, this.lastInput + 120000) - this.lastMono);
      this.addInterval(this.lastWall, ms);
    }
    this.lastMono = mono; this.lastWall = wall;
    if (this.session) this.session.checkpointAt = wall;
  }
  private addInterval(start: number, ms: number) {
    const end = start + ms;
    while (start < end) {
      const d = new Date(start); const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const next = Math.min(end, midnight); const date = localDate(start);
      this.session!.days[date] = (this.session!.days[date] ?? 0) + (next - start) / 1000; start = next;
    }
  }
  snapshot(): Session | undefined { this.tick(); return this.session ? structuredClone(this.session) : undefined; }
  end(): Session | undefined {
    this.tick(); if (!this.session) return;
    this.session.endedAt = this.clock.wall(); const final = structuredClone(this.session); this.session = undefined; this.visible = false; return final;
  }
}
