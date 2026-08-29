import { getTaskRepository } from "@/db/client";
import { getCurrentActor } from "@/features/actors/server/current-actor";
import { apiErrorResponse } from "@/features/tasks/server/http";

export async function GET() {
  try {
    const actor = await getCurrentActor();
    return Response.json({ ok: true, data: { tasks: await getTaskRepository().listPool(actor) } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
