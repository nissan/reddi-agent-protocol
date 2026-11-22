import { NextRequest, NextResponse } from "next/server";
import { emitTorqueEvent } from "@/lib/torque/client";
import { TORQUE_EVENTS, type TorqueEventName } from "@/lib/torque/events";
import { legacyRouteGate } from "@/lib/http/route-gates";

export async function POST(req: NextRequest) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  const body = await req.json();
  const { userPubkey, eventName, fields } = body;

  if (!userPubkey || !eventName) {
    return NextResponse.json({ error: "userPubkey and eventName required" }, { status: 400 });
  }

  if (!Object.values(TORQUE_EVENTS).includes(eventName)) {
    return NextResponse.json({ error: "unknown eventName" }, { status: 400 });
  }

  await emitTorqueEvent({
    userPubkey,
    eventName: eventName as TorqueEventName,
    fields: fields ?? {},
  });

  return NextResponse.json({ ok: true });
}

