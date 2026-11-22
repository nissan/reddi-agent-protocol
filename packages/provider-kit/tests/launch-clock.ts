/**
 * Runs a test file's clock inside the launch rate (2.5%) once today is near or past its end, so tests that build
 * fee terms from the current time keep their answers after 1 April 2027. Tests of the switch pass explicit times.
 */
import { after, before } from "node:test";
import { LAUNCH_RATE_ENDS_AT_MS } from "@redditech/x402-solana";

/** A fixed instant well inside the launch rate. */
export const LAUNCH_CLOCK_MS = Date.UTC(2027, 0, 15);

export function pinLaunchRateClock(): void {
  const RealDate = Date;
  let installed = false;
  before(() => {
    const realNow = RealDate.now();
    // Leave the clock alone while it is already at least a month inside the launch rate.
    if (realNow < LAUNCH_RATE_ENDS_AT_MS - 31 * 24 * 3600 * 1000) return;
    const offset = LAUNCH_CLOCK_MS - realNow;
    const now = () => RealDate.now() + offset;
    class LaunchDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(now());
        else super(...(args as [string | number | Date]));
      }
      static now(): number {
        return now();
      }
    }
    globalThis.Date = LaunchDate as DateConstructor;
    installed = true;
  });
  after(() => {
    if (installed) globalThis.Date = RealDate;
  });
}
